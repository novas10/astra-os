/**
 * AstraOS — PluginLoader.ts
 * Dynamic plugin loader: discovers, validates, and instantiates plugins from the
 * `plugins/` directory. Supports hot-reload via fs.watch, sandboxed execution,
 * dependency resolution, and lifecycle management.
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";
import {
  buildPluginContext,
  validateManifest,
} from "./PluginSDK";
import type {
  AstraPlugin,
  PluginManifest,
  PluginEntry,
  PluginStatus,
  PluginEvent,
  PluginVaultAccess,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLUGIN_DIR_NAME = "plugins";
const MANIFEST_FILE = "plugin.json";
const ENTRY_FILES = ["plugin.ts", "plugin.js", "index.ts", "index.js"];

// ---------------------------------------------------------------------------
// PluginLoader
// ---------------------------------------------------------------------------

export class PluginLoader {
  private pluginsDir: string;
  private plugins: Map<string, PluginEntry> = new Map();
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private eventListeners: Array<(event: PluginEvent) => void> = [];
  private vaultAccess?: PluginVaultAccess;
  private hotReloadEnabled: boolean;

  constructor(options?: {
    pluginsDir?: string;
    vaultAccess?: PluginVaultAccess;
    hotReload?: boolean;
  }) {
    this.pluginsDir = options?.pluginsDir ?? path.join(process.cwd(), PLUGIN_DIR_NAME);
    this.vaultAccess = options?.vaultAccess;
    this.hotReloadEnabled = options?.hotReload ?? false;
  }

  // -----------------------------------------------------------------------
  // Event system
  // -----------------------------------------------------------------------

  onEvent(listener: (event: PluginEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  private emit(type: PluginEvent["type"], pluginName: string, detail?: string): void {
    const event: PluginEvent = { type, pluginName, timestamp: Date.now(), detail };
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error(`[PluginLoader] Event listener error: ${err}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  /**
   * Discover all plugin directories under the plugins root.
   * Each must contain a plugin.json manifest.
   */
  discoverPlugins(): Array<{ dir: string; manifest: PluginManifest }> {
    if (!fs.existsSync(this.pluginsDir)) {
      logger.info(`[PluginLoader] Plugins directory does not exist: ${this.pluginsDir}`);
      return [];
    }

    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    const discovered: Array<{ dir: string; manifest: PluginManifest }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginDir = path.join(this.pluginsDir, entry.name);
      const manifestPath = path.join(pluginDir, MANIFEST_FILE);

      if (!fs.existsSync(manifestPath)) {
        logger.warn(`[PluginLoader] Skipping ${entry.name}: no ${MANIFEST_FILE}`);
        continue;
      }

      try {
        const raw = fs.readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(raw) as PluginManifest;

        const validation = validateManifest(manifest);
        if (!validation.valid) {
          logger.error(
            `[PluginLoader] Invalid manifest in ${entry.name}: ${validation.errors.join("; ")}`
          );
          continue;
        }

        if (validation.warnings.length > 0) {
          for (const w of validation.warnings) {
            logger.warn(`[PluginLoader] ${entry.name}: ${w}`);
          }
        }

        discovered.push({ dir: pluginDir, manifest });
      } catch (err) {
        logger.error(`[PluginLoader] Failed to parse ${manifestPath}: ${err}`);
      }
    }

    return discovered;
  }

  // -----------------------------------------------------------------------
  // Dependency Resolution
  // -----------------------------------------------------------------------

  /**
   * Topological sort of plugins based on their dependency declarations.
   * Throws if circular dependencies are detected.
   */
  resolveDependencies(
    plugins: Array<{ dir: string; manifest: PluginManifest }>
  ): Array<{ dir: string; manifest: PluginManifest }> {
    const nameMap = new Map(plugins.map((p) => [p.manifest.name, p]));
    const visited = new Set<string>();
    const visiting = new Set<string>(); // cycle detection
    const sorted: Array<{ dir: string; manifest: PluginManifest }> = [];

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular plugin dependency detected involving "${name}"`);
      }

      visiting.add(name);
      const plugin = nameMap.get(name);
      if (!plugin) {
        throw new Error(`Plugin dependency "${name}" not found`);
      }

      const deps = plugin.manifest.dependencies ?? [];
      for (const dep of deps) {
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(plugin);
    };

    for (const plugin of plugins) {
      visit(plugin.manifest.name);
    }

    return sorted;
  }

  // -----------------------------------------------------------------------
  // Loading
  // -----------------------------------------------------------------------

  /**
   * Resolve the entry file for a plugin directory.
   */
  private resolveEntryFile(pluginDir: string, manifest: PluginManifest): string | null {
    // Explicit main field
    if (manifest.main) {
      const mainPath = path.join(pluginDir, manifest.main);
      if (fs.existsSync(mainPath)) return mainPath;
      // Try without extension
      for (const ext of [".ts", ".js"]) {
        if (fs.existsSync(mainPath + ext)) return mainPath + ext;
      }
    }

    // Convention-based
    for (const entryFile of ENTRY_FILES) {
      const entryPath = path.join(pluginDir, entryFile);
      if (fs.existsSync(entryPath)) return entryPath;
    }

    return null;
  }

  /**
   * Load a single plugin by directory path.
   */
  async loadPlugin(pluginDir: string, manifest: PluginManifest): Promise<PluginEntry | null> {
    const entryFile = this.resolveEntryFile(pluginDir, manifest);
    if (!entryFile) {
      logger.error(`[PluginLoader] No entry file found for plugin "${manifest.name}" in ${pluginDir}`);
      return null;
    }

    try {
      // Clear require cache for hot-reload support
      const resolvedPath = require.resolve(entryFile);
      if (require.cache[resolvedPath]) {
        delete require.cache[resolvedPath];
      }

      // Load the module
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(entryFile);
      const pluginInstance: AstraPlugin = mod.default ?? mod;

      // Validate the plugin instance
      if (!pluginInstance || typeof pluginInstance !== "object") {
        throw new Error("Plugin module must export an AstraPlugin object");
      }
      if (!pluginInstance.name || !pluginInstance.version) {
        throw new Error("Plugin must export name and version");
      }

      // Merge config: defaults from manifest + any overrides
      const config: Record<string, unknown> = {
        ...(manifest.defaultConfig ?? {}),
      };

      // Build the sandboxed context
      const context = buildPluginContext(manifest, pluginDir, config, this.vaultAccess);

      // Call onLoad lifecycle hook
      if (pluginInstance.onLoad) {
        await pluginInstance.onLoad(context);
      }

      const entry: PluginEntry = {
        manifest,
        instance: pluginInstance,
        status: "enabled",
        directory: pluginDir,
        loadedAt: Date.now(),
        config,
      };

      this.plugins.set(manifest.name, entry);
      this.emit("plugin:loaded", manifest.name);
      logger.info(
        `[PluginLoader] Loaded plugin "${manifest.name}" v${manifest.version} from ${pluginDir}`
      );

      return entry;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[PluginLoader] Failed to load plugin "${manifest.name}": ${message}`);

      const errorEntry: PluginEntry = {
        manifest,
        instance: { name: manifest.name, version: manifest.version, description: manifest.description } as AstraPlugin,
        status: "error",
        directory: pluginDir,
        loadedAt: Date.now(),
        lastError: message,
        config: {},
      };
      this.plugins.set(manifest.name, errorEntry);
      this.emit("plugin:error", manifest.name, message);
      return null;
    }
  }

  /**
   * Load all discovered plugins in dependency order.
   */
  async loadAll(): Promise<{ loaded: string[]; failed: string[] }> {
    const discovered = this.discoverPlugins();
    const loaded: string[] = [];
    const failed: string[] = [];

    if (discovered.length === 0) {
      logger.info("[PluginLoader] No plugins discovered");
      return { loaded, failed };
    }

    let sorted: typeof discovered;
    try {
      sorted = this.resolveDependencies(discovered);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[PluginLoader] Dependency resolution failed: ${message}`);
      return { loaded, failed: discovered.map((d) => d.manifest.name) };
    }

    for (const { dir, manifest } of sorted) {
      // Check that all dependencies are loaded and enabled
      const deps = manifest.dependencies ?? [];
      const missingDeps = deps.filter((dep) => {
        const entry = this.plugins.get(dep);
        return !entry || entry.status !== "enabled";
      });

      if (missingDeps.length > 0) {
        logger.error(
          `[PluginLoader] Skipping "${manifest.name}": missing dependencies: ${missingDeps.join(", ")}`
        );
        failed.push(manifest.name);
        continue;
      }

      const result = await this.loadPlugin(dir, manifest);
      if (result && result.status === "enabled") {
        loaded.push(manifest.name);
      } else {
        failed.push(manifest.name);
      }
    }

    // Start hot-reload watchers
    if (this.hotReloadEnabled) {
      this.startWatching();
    }

    logger.info(
      `[PluginLoader] Load complete: ${loaded.length} loaded, ${failed.length} failed`
    );
    return { loaded, failed };
  }

  // -----------------------------------------------------------------------
  // Unloading
  // -----------------------------------------------------------------------

  /**
   * Unload a single plugin by name.
   */
  async unloadPlugin(name: string): Promise<boolean> {
    const entry = this.plugins.get(name);
    if (!entry) {
      logger.warn(`[PluginLoader] Cannot unload "${name}": not loaded`);
      return false;
    }

    try {
      if (entry.instance.onUnload) {
        await entry.instance.onUnload();
      }
    } catch (err) {
      logger.error(`[PluginLoader] Error during onUnload for "${name}": ${err}`);
    }

    // Stop file watcher
    const watcher = this.watchers.get(name);
    if (watcher) {
      watcher.close();
      this.watchers.delete(name);
    }

    entry.status = "unloaded";
    this.plugins.delete(name);
    this.emit("plugin:unloaded", name);
    logger.info(`[PluginLoader] Unloaded plugin "${name}"`);
    return true;
  }

  /**
   * Unload all plugins (in reverse load order to respect dependencies).
   */
  async unloadAll(): Promise<void> {
    const names = [...this.plugins.keys()].reverse();
    for (const name of names) {
      await this.unloadPlugin(name);
    }
  }

  // -----------------------------------------------------------------------
  // Enable / Disable
  // -----------------------------------------------------------------------

  async enablePlugin(name: string): Promise<boolean> {
    const entry = this.plugins.get(name);
    if (!entry) return false;
    if (entry.status === "enabled") return true;

    entry.status = "enabled";
    this.emit("plugin:enabled", name);
    logger.info(`[PluginLoader] Enabled plugin "${name}"`);
    return true;
  }

  async disablePlugin(name: string): Promise<boolean> {
    const entry = this.plugins.get(name);
    if (!entry) return false;
    if (entry.status === "disabled") return true;

    entry.status = "disabled";
    this.emit("plugin:disabled", name);
    logger.info(`[PluginLoader] Disabled plugin "${name}"`);
    return true;
  }

  // -----------------------------------------------------------------------
  // Hot Reload
  // -----------------------------------------------------------------------

  private startWatching(): void {
    for (const [name, entry] of this.plugins) {
      if (this.watchers.has(name)) continue;

      try {
        const watcher = fs.watch(entry.directory, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          // Debounce: ignore rapid successive events
          this.handleFileChange(name, entry.directory, entry.manifest, filename);
        });

        this.watchers.set(name, watcher);
      } catch {
        logger.warn(`[PluginLoader] Could not watch directory for plugin "${name}"`);
      }
    }
  }

  private reloadTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private handleFileChange(
    name: string,
    dir: string,
    manifest: PluginManifest,
    _filename: string
  ): void {
    // Debounce: wait 500ms after last change before reloading
    const existing = this.reloadTimers.get(name);
    if (existing) clearTimeout(existing);

    this.reloadTimers.set(
      name,
      setTimeout(async () => {
        this.reloadTimers.delete(name);
        logger.info(`[PluginLoader] Hot-reloading plugin "${name}"...`);

        try {
          await this.unloadPlugin(name);
          await this.loadPlugin(dir, manifest);
          logger.info(`[PluginLoader] Hot-reload complete for "${name}"`);
        } catch (err) {
          logger.error(`[PluginLoader] Hot-reload failed for "${name}": ${err}`);
        }
      }, 500)
    );
  }

  stopWatching(): void {
    for (const [name, watcher] of this.watchers) {
      watcher.close();
      logger.debug(`[PluginLoader] Stopped watching plugin "${name}"`);
    }
    this.watchers.clear();

    for (const timer of this.reloadTimers.values()) {
      clearTimeout(timer);
    }
    this.reloadTimers.clear();
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  getPlugin(name: string): PluginEntry | undefined {
    return this.plugins.get(name);
  }

  getAllPlugins(): Map<string, PluginEntry> {
    return new Map(this.plugins);
  }

  getEnabledPlugins(): PluginEntry[] {
    return [...this.plugins.values()].filter((p) => p.status === "enabled");
  }

  getPluginsByPriority(): PluginEntry[] {
    return this.getEnabledPlugins().sort(
      (a, b) => (a.manifest.priority ?? 100) - (b.manifest.priority ?? 100)
    );
  }

  isLoaded(name: string): boolean {
    return this.plugins.has(name);
  }
}
