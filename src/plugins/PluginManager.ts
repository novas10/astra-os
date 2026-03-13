/**
 * AstraOS — PluginManager.ts
 * Plugin lifecycle orchestrator. Manages loaded plugins, routes hooks to
 * plugins in priority order, handles plugin errors without crashing the host,
 * provides plugin health monitoring, and exposes a management API.
 */

import * as fs from "fs";
import * as path from "path";
import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "../utils/logger";
import { PluginLoader } from "./PluginLoader";
import type {
  AstraPlugin,
  PluginEntry,
  PluginMessage,
  PluginResponse,
  PluginRoute,
  PluginTool,
  PluginCronJob,
  PluginEvent,
  PluginManifest,
  PluginVaultAccess,
} from "./types";
import { validateManifest } from "./PluginSDK";

// ---------------------------------------------------------------------------
// Health tracking
// ---------------------------------------------------------------------------

interface PluginHealthRecord {
  name: string;
  totalCalls: number;
  totalErrors: number;
  lastErrorAt?: number;
  lastError?: string;
  avgLatencyMs: number;
  latencySamples: number[];
  consecutiveErrors: number;
  /** If true, hooks are bypassed until health recovers. */
  circuitOpen: boolean;
  circuitOpenedAt?: number;
}

const MAX_LATENCY_SAMPLES = 50;
const CIRCUIT_BREAK_THRESHOLD = 5;
const CIRCUIT_HALF_OPEN_MS = 30_000;

// ---------------------------------------------------------------------------
// PluginManager
// ---------------------------------------------------------------------------

export class PluginManager {
  private loader: PluginLoader;
  private health: Map<string, PluginHealthRecord> = new Map();
  private cronTimers: Map<string, ReturnType<typeof setInterval>[]> = new Map();

  constructor(options?: {
    pluginsDir?: string;
    vaultAccess?: PluginVaultAccess;
    hotReload?: boolean;
  }) {
    this.loader = new PluginLoader(options);

    // Subscribe to loader events for logging
    this.loader.onEvent((event: PluginEvent) => {
      logger.info(`[PluginManager] Event: ${event.type} — ${event.pluginName}`);
      if (event.type === "plugin:loaded" || event.type === "plugin:enabled") {
        this.ensureHealth(event.pluginName);
      }
      if (event.type === "plugin:unloaded") {
        this.health.delete(event.pluginName);
        this.stopCronJobs(event.pluginName);
      }
    });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Initialize: discover, load, and start all plugins.
   */
  async initialize(): Promise<{ loaded: string[]; failed: string[] }> {
    const result = await this.loader.loadAll();

    // Register cron jobs for enabled plugins
    for (const entry of this.loader.getEnabledPlugins()) {
      this.startCronJobs(entry);
    }

    logger.info(
      `[PluginManager] Initialized with ${result.loaded.length} plugin(s) active`
    );
    return result;
  }

  /**
   * Graceful shutdown: stop cron jobs, unload all plugins.
   */
  async shutdown(): Promise<void> {
    // Stop all cron timers
    for (const name of this.cronTimers.keys()) {
      this.stopCronJobs(name);
    }

    this.loader.stopWatching();
    await this.loader.unloadAll();
    logger.info("[PluginManager] Shutdown complete");
  }

  // -----------------------------------------------------------------------
  // Plugin Management API
  // -----------------------------------------------------------------------

  listPlugins(): Array<{
    name: string;
    version: string;
    description: string;
    status: string;
    author?: string;
    health: PluginHealthRecord | null;
  }> {
    const all = this.loader.getAllPlugins();
    return [...all.entries()].map(([name, entry]) => ({
      name,
      version: entry.manifest.version,
      description: entry.manifest.description,
      status: entry.status,
      author: entry.manifest.author,
      health: this.health.get(name) ?? null,
    }));
  }

  getPlugin(name: string): PluginEntry | undefined {
    return this.loader.getPlugin(name);
  }

  async enablePlugin(name: string): Promise<boolean> {
    const ok = await this.loader.enablePlugin(name);
    if (ok) {
      const entry = this.loader.getPlugin(name);
      if (entry) this.startCronJobs(entry);
    }
    return ok;
  }

  async disablePlugin(name: string): Promise<boolean> {
    this.stopCronJobs(name);
    return this.loader.disablePlugin(name);
  }

  /**
   * Install a plugin from a directory or archive path.
   * Copies plugin files to the plugins directory, validates, and loads.
   */
  async installPlugin(
    sourcePath: string
  ): Promise<{ success: boolean; name?: string; error?: string }> {
    try {
      // Verify source has a valid manifest
      const manifestPath = path.join(sourcePath, "plugin.json");
      if (!fs.existsSync(manifestPath)) {
        return { success: false, error: "No plugin.json found in source" };
      }

      const rawManifest = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(rawManifest) as PluginManifest;

      const validation = validateManifest(manifest);
      if (!validation.valid) {
        return { success: false, error: `Invalid manifest: ${validation.errors.join("; ")}` };
      }

      // Check if already installed
      if (this.loader.isLoaded(manifest.name)) {
        return { success: false, error: `Plugin "${manifest.name}" is already installed` };
      }

      // Copy to plugins directory
      const targetDir = path.join(
        (this.loader as unknown as { pluginsDir: string }).pluginsDir ?? path.join(process.cwd(), "plugins"),
        manifest.name
      );

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Copy files recursively
      this.copyDirSync(sourcePath, targetDir);

      // Load the plugin
      const entry = await this.loader.loadPlugin(targetDir, manifest);
      if (entry && entry.status === "enabled") {
        this.startCronJobs(entry);
        this.loader["emit"]("plugin:installed", manifest.name);
        return { success: true, name: manifest.name };
      }

      return { success: false, name: manifest.name, error: "Plugin loaded but failed to enable" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Hook Routing — messages
  // -----------------------------------------------------------------------

  /**
   * Run the onMessage hook through all enabled plugins in priority order.
   * Each plugin can modify or suppress the message.
   * Returns null if any plugin suppresses the message.
   */
  async runMessageHooks(message: PluginMessage): Promise<PluginMessage | null> {
    const plugins = this.loader.getPluginsByPriority();
    let current: PluginMessage | null = message;

    for (const entry of plugins) {
      if (!entry.instance.onMessage) continue;
      if (this.isCircuitOpen(entry.manifest.name)) continue;

      const start = Date.now();
      try {
        current = await entry.instance.onMessage(current!);
        this.recordSuccess(entry.manifest.name, Date.now() - start);
        if (current === null) {
          logger.debug(
            `[PluginManager] Plugin "${entry.manifest.name}" suppressed message ${message.id}`
          );
          return null;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.recordError(entry.manifest.name, errMsg);
        logger.error(
          `[PluginManager] Plugin "${entry.manifest.name}" onMessage error: ${errMsg}`
        );
        // Continue to next plugin — don't crash the host
      }
    }

    return current;
  }

  /**
   * Run the onResponse hook through all enabled plugins in priority order.
   */
  async runResponseHooks(response: PluginResponse): Promise<PluginResponse | null> {
    const plugins = this.loader.getPluginsByPriority();
    let current: PluginResponse | null = response;

    for (const entry of plugins) {
      if (!entry.instance.onResponse) continue;
      if (this.isCircuitOpen(entry.manifest.name)) continue;

      const start = Date.now();
      try {
        current = await entry.instance.onResponse(current!);
        this.recordSuccess(entry.manifest.name, Date.now() - start);
        if (current === null) return null;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.recordError(entry.manifest.name, errMsg);
        logger.error(
          `[PluginManager] Plugin "${entry.manifest.name}" onResponse error: ${errMsg}`
        );
      }
    }

    return current;
  }

  /**
   * Run the onToolCall hook through all enabled plugins.
   * First non-null result wins (allows plugins to intercept/transform tool calls).
   */
  async runToolCallHooks(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const plugins = this.loader.getPluginsByPriority();

    for (const entry of plugins) {
      if (!entry.instance.onToolCall) continue;
      if (this.isCircuitOpen(entry.manifest.name)) continue;

      const start = Date.now();
      try {
        const result = await entry.instance.onToolCall(toolName, input);
        this.recordSuccess(entry.manifest.name, Date.now() - start);
        if (result !== null) return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.recordError(entry.manifest.name, errMsg);
        logger.error(
          `[PluginManager] Plugin "${entry.manifest.name}" onToolCall error: ${errMsg}`
        );
      }
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Tool & Route aggregation
  // -----------------------------------------------------------------------

  /**
   * Collect all custom tools from enabled plugins.
   */
  getAllTools(): PluginTool[] {
    const tools: PluginTool[] = [];
    for (const entry of this.loader.getEnabledPlugins()) {
      if (entry.instance.tools) {
        for (const tool of entry.instance.tools) {
          tools.push(tool);
        }
      }
    }
    return tools;
  }

  /**
   * Collect all custom routes from enabled plugins.
   */
  getAllRoutes(): Array<PluginRoute & { pluginName: string }> {
    const routes: Array<PluginRoute & { pluginName: string }> = [];
    for (const entry of this.loader.getEnabledPlugins()) {
      if (entry.instance.routes) {
        for (const route of entry.instance.routes) {
          routes.push({ ...route, pluginName: entry.manifest.name });
        }
      }
    }
    return routes;
  }

  // -----------------------------------------------------------------------
  // Cron Job Management
  // -----------------------------------------------------------------------

  private startCronJobs(entry: PluginEntry): void {
    if (!entry.instance.cron || entry.instance.cron.length === 0) return;

    const timers: ReturnType<typeof setInterval>[] = [];

    for (const job of entry.instance.cron) {
      // Simple cron: parse the schedule to an interval in ms.
      // For production, use a proper cron library. Here we do a best-effort
      // interpretation for common patterns.
      const intervalMs = this.parseCronToInterval(job.schedule);
      if (intervalMs <= 0) {
        logger.warn(
          `[PluginManager] Could not parse cron schedule "${job.schedule}" for ` +
            `plugin "${entry.manifest.name}" job "${job.name}"`
        );
        continue;
      }

      const context = {
        pluginName: entry.manifest.name,
        pluginVersion: entry.manifest.version,
        logger: {
          debug: (msg: string, ...args: unknown[]) => logger.debug(`[plugin:${entry.manifest.name}:cron] ${msg}`, ...args),
          info: (msg: string, ...args: unknown[]) => logger.info(`[plugin:${entry.manifest.name}:cron] ${msg}`, ...args),
          warn: (msg: string, ...args: unknown[]) => logger.warn(`[plugin:${entry.manifest.name}:cron] ${msg}`, ...args),
          error: (msg: string, ...args: unknown[]) => logger.error(`[plugin:${entry.manifest.name}:cron] ${msg}`, ...args),
        },
        config: { get: () => undefined as never, getAll: () => ({}) },
        memory: {
          get: async () => null,
          set: async () => {},
          delete: async () => {},
          list: async () => [] as string[],
        },
        vault: {
          get: async () => { throw new Error("Not available in cron context"); return "" as never; },
          set: async () => {},
          delete: async () => {},
          list: async () => [] as string[],
        },
        dataDir: path.join(entry.directory, "data"),
        hostVersion: "4.0.0",
      };

      const timer = setInterval(async () => {
        try {
          await job.handler(context);
        } catch (err) {
          logger.error(
            `[PluginManager] Cron job "${job.name}" in plugin "${entry.manifest.name}" failed: ${err}`
          );
        }
      }, intervalMs);

      timers.push(timer);
      logger.info(
        `[PluginManager] Started cron job "${job.name}" for plugin "${entry.manifest.name}" ` +
          `(every ${Math.round(intervalMs / 1000)}s)`
      );
    }

    this.cronTimers.set(entry.manifest.name, timers);
  }

  private stopCronJobs(name: string): void {
    const timers = this.cronTimers.get(name);
    if (timers) {
      for (const timer of timers) clearInterval(timer);
      this.cronTimers.delete(name);
    }
  }

  /**
   * Best-effort cron expression to millisecond interval parser.
   * Handles common patterns. For full cron, integrate node-cron or croner.
   */
  private parseCronToInterval(schedule: string): number {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length < 5) return -1;

    // Every minute: * * * * *
    if (parts.every((p) => p === "*")) return 60 * 1000;

    // Every N minutes: */N * * * *
    const minMatch = parts[0].match(/^\*\/(\d+)$/);
    if (minMatch && parts.slice(1).every((p) => p === "*")) {
      return parseInt(minMatch[1], 10) * 60 * 1000;
    }

    // Every hour at minute M: M * * * *
    if (/^\d+$/.test(parts[0]) && parts.slice(1).every((p) => p === "*")) {
      return 60 * 60 * 1000; // hourly
    }

    // Every day at H:M: M H * * *
    if (/^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) && parts.slice(2).every((p) => p === "*")) {
      return 24 * 60 * 60 * 1000; // daily
    }

    // Default: run every hour as a safe fallback
    return 60 * 60 * 1000;
  }

  // -----------------------------------------------------------------------
  // Health Monitoring
  // -----------------------------------------------------------------------

  private ensureHealth(name: string): PluginHealthRecord {
    if (!this.health.has(name)) {
      this.health.set(name, {
        name,
        totalCalls: 0,
        totalErrors: 0,
        avgLatencyMs: 0,
        latencySamples: [],
        consecutiveErrors: 0,
        circuitOpen: false,
      });
    }
    return this.health.get(name)!;
  }

  private recordSuccess(name: string, latencyMs: number): void {
    const h = this.ensureHealth(name);
    h.totalCalls++;
    h.consecutiveErrors = 0;

    // Track latency
    h.latencySamples.push(latencyMs);
    if (h.latencySamples.length > MAX_LATENCY_SAMPLES) {
      h.latencySamples.shift();
    }
    h.avgLatencyMs =
      h.latencySamples.reduce((a, b) => a + b, 0) / h.latencySamples.length;

    // Close circuit on success
    if (h.circuitOpen) {
      h.circuitOpen = false;
      h.circuitOpenedAt = undefined;
      logger.info(`[PluginManager] Circuit closed for plugin "${name}" after successful call`);
    }
  }

  private recordError(name: string, error: string): void {
    const h = this.ensureHealth(name);
    h.totalCalls++;
    h.totalErrors++;
    h.consecutiveErrors++;
    h.lastErrorAt = Date.now();
    h.lastError = error;

    // Open circuit after threshold consecutive failures
    if (h.consecutiveErrors >= CIRCUIT_BREAK_THRESHOLD && !h.circuitOpen) {
      h.circuitOpen = true;
      h.circuitOpenedAt = Date.now();
      logger.warn(
        `[PluginManager] Circuit OPEN for plugin "${name}" after ${CIRCUIT_BREAK_THRESHOLD} consecutive failures`
      );
    }
  }

  private isCircuitOpen(name: string): boolean {
    const h = this.health.get(name);
    if (!h || !h.circuitOpen) return false;

    // Half-open: allow a single request after the cooldown
    if (h.circuitOpenedAt && Date.now() - h.circuitOpenedAt > CIRCUIT_HALF_OPEN_MS) {
      logger.info(`[PluginManager] Circuit half-open for plugin "${name}" — allowing probe request`);
      return false; // Allow the request through; recordSuccess/Error will close or re-open
    }

    return true;
  }

  getHealth(name: string): PluginHealthRecord | null {
    return this.health.get(name) ?? null;
  }

  getAllHealth(): PluginHealthRecord[] {
    return [...this.health.values()];
  }

  // -----------------------------------------------------------------------
  // Express Router
  // -----------------------------------------------------------------------

  getRouter(): Router {
    const router = Router();

    // GET /plugins — list all plugins
    router.get("/", (_req: Request, res: Response) => {
      res.json({ success: true, plugins: this.listPlugins() });
    });

    // GET /plugins/health — all health records
    router.get("/health", (_req: Request, res: Response) => {
      res.json({ success: true, health: this.getAllHealth() });
    });

    // GET /plugins/:name — single plugin details
    router.get("/:name", (req: Request, res: Response) => {
      const entry = this.getPlugin(req.params.name);
      if (!entry) {
        res.status(404).json({ success: false, error: "Plugin not found" });
        return;
      }
      res.json({
        success: true,
        plugin: {
          name: entry.manifest.name,
          version: entry.manifest.version,
          description: entry.manifest.description,
          status: entry.status,
          author: entry.manifest.author,
          permissions: entry.manifest.permissions,
          loadedAt: entry.loadedAt,
          lastError: entry.lastError,
          health: this.getHealth(entry.manifest.name),
          tools: (entry.instance.tools ?? []).map((t) => ({ name: t.name, description: t.description })),
          routes: (entry.instance.routes ?? []).map((r) => ({ method: r.method, path: r.path, description: r.description })),
          cron: (entry.instance.cron ?? []).map((c) => ({ name: c.name, schedule: c.schedule, description: c.description })),
        },
      });
    });

    // POST /plugins/:name/enable
    router.post("/:name/enable", async (req: Request, res: Response) => {
      try {
        const ok = await this.enablePlugin(req.params.name);
        res.json({ success: ok });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    // POST /plugins/:name/disable
    router.post("/:name/disable", async (req: Request, res: Response) => {
      try {
        const ok = await this.disablePlugin(req.params.name);
        res.json({ success: ok });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    // POST /plugins/install — install from source path
    router.post("/install", async (req: Request, res: Response) => {
      try {
        const { sourcePath } = req.body ?? {};
        if (!sourcePath) {
          res.status(400).json({ success: false, error: "sourcePath is required" });
          return;
        }
        const result = await this.installPlugin(sourcePath);
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    // GET /plugins/tools/all — aggregate tools
    router.get("/tools/all", (_req: Request, res: Response) => {
      const tools = this.getAllTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      res.json({ success: true, tools });
    });

    // GET /plugins/routes/all — aggregate routes
    router.get("/routes/all", (_req: Request, res: Response) => {
      const routes = this.getAllRoutes().map((r) => ({
        pluginName: r.pluginName,
        method: r.method,
        path: r.path,
        description: r.description,
      }));
      res.json({ success: true, routes });
    });

    return router;
  }
}
