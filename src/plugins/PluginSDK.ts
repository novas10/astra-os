/**
 * AstraOS — PluginSDK.ts
 * Developer-facing SDK for creating AstraOS plugins/extensions.
 * Provides the base class, context wiring, and helpers that plugin authors use.
 *
 * Usage:
 *   import { definePlugin } from 'astra-os/dist/plugins/PluginSDK';
 *
 *   export default definePlugin({
 *     name: 'my-plugin',
 *     version: '1.0.0',
 *     description: 'Does something useful',
 *     async onLoad(ctx) { ctx.logger.info('Loaded!'); },
 *     async onMessage(msg) { return msg; },
 *   });
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";
import type {
  AstraPlugin,
  PluginContext,
  PluginLogger,
  PluginMemoryAccess,
  PluginVaultAccess,
  PluginConfigAccess,
  PluginManifest,
  PluginMessage,
  PluginResponse,
  PluginRoute,
  PluginTool,
  PluginCronJob,
} from "./types";

// Re-export all types for convenience
export type {
  AstraPlugin,
  PluginContext,
  PluginLogger,
  PluginMemoryAccess,
  PluginVaultAccess,
  PluginConfigAccess,
  PluginManifest,
  PluginMessage,
  PluginResponse,
  PluginRoute,
  PluginTool,
  PluginCronJob,
};

// ---------------------------------------------------------------------------
// Host version — consumers can check compatibility
// ---------------------------------------------------------------------------

export const ASTRA_HOST_VERSION = "4.0.0";

// ---------------------------------------------------------------------------
// definePlugin — factory function plugin authors use
// ---------------------------------------------------------------------------

/**
 * Convenience factory for defining a plugin. Validates required fields at
 * definition time so typos surface early.
 */
export function definePlugin(plugin: AstraPlugin): AstraPlugin {
  if (!plugin.name || typeof plugin.name !== "string") {
    throw new Error("Plugin must have a non-empty `name` string");
  }
  if (!plugin.version || typeof plugin.version !== "string") {
    throw new Error("Plugin must have a non-empty `version` string");
  }
  if (!plugin.description || typeof plugin.description !== "string") {
    throw new Error("Plugin must have a non-empty `description` string");
  }
  return plugin;
}

// ---------------------------------------------------------------------------
// Context factories — used by PluginLoader to build sandboxed contexts
// ---------------------------------------------------------------------------

/**
 * Creates a scoped logger that prefixes all messages with the plugin name.
 */
export function createPluginLogger(pluginName: string): PluginLogger {
  const prefix = `[plugin:${pluginName}]`;
  return {
    debug: (msg, ...args) => logger.debug(`${prefix} ${msg}`, ...args),
    info: (msg, ...args) => logger.info(`${prefix} ${msg}`, ...args),
    warn: (msg, ...args) => logger.warn(`${prefix} ${msg}`, ...args),
    error: (msg, ...args) => logger.error(`${prefix} ${msg}`, ...args),
  };
}

/**
 * Creates a file-backed key/value memory store scoped to a single plugin.
 * Each plugin gets its own `.astra-plugins/<name>/data/` directory.
 */
export function createPluginMemory(dataDir: string): PluginMemoryAccess {
  const storePath = path.join(dataDir, "kv-store.json");

  function loadStore(): Record<string, unknown> {
    try {
      if (fs.existsSync(storePath)) {
        return JSON.parse(fs.readFileSync(storePath, "utf-8")) as Record<string, unknown>;
      }
    } catch {
      // Corrupted store — start fresh
    }
    return {};
  }

  function saveStore(store: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
  }

  return {
    async get(key: string): Promise<unknown | null> {
      const store = loadStore();
      return store[key] ?? null;
    },

    async set(key: string, value: unknown): Promise<void> {
      const store = loadStore();
      store[key] = value;
      saveStore(store);
    },

    async delete(key: string): Promise<void> {
      const store = loadStore();
      delete store[key];
      saveStore(store);
    },

    async list(prefix?: string): Promise<string[]> {
      const store = loadStore();
      const keys = Object.keys(store);
      return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
    },
  };
}

/**
 * Creates a vault accessor scoped to a plugin namespace.
 * Keys are automatically prefixed with `plugin:<name>:` for isolation.
 */
export function createPluginVault(
  pluginName: string,
  vaultStore?: { get: (k: string) => Promise<string>; set: (k: string, v: string) => Promise<void>; delete: (k: string) => Promise<void>; list: () => Promise<string[]> }
): PluginVaultAccess {
  const prefix = `plugin:${pluginName}:`;

  if (!vaultStore) {
    // Stub vault when no real vault is connected
    const mem = new Map<string, string>();
    return {
      async get(name) {
        const val = mem.get(prefix + name);
        if (val === undefined) throw new Error(`Secret "${name}" not found`);
        return val;
      },
      async set(name, value) {
        mem.set(prefix + name, value);
      },
      async delete(name) {
        mem.delete(prefix + name);
      },
      async list() {
        return [...mem.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
      },
    };
  }

  return {
    async get(name) {
      return vaultStore.get(prefix + name);
    },
    async set(name, value) {
      return vaultStore.set(prefix + name, value);
    },
    async delete(name) {
      return vaultStore.delete(prefix + name);
    },
    async list() {
      const all = await vaultStore.list();
      return all.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    },
  };
}

/**
 * Creates a read-only config accessor backed by the plugin's resolved config.
 */
export function createPluginConfig(config: Record<string, unknown>): PluginConfigAccess {
  return {
    get<T = unknown>(key: string, defaultValue?: T): T {
      const value = config[key];
      if (value === undefined) {
        if (defaultValue !== undefined) return defaultValue;
        throw new Error(`Config key "${key}" not found and no default provided`);
      }
      return value as T;
    },
    getAll(): Record<string, unknown> {
      return { ...config };
    },
  };
}

/**
 * Builds a full PluginContext for a given plugin.
 */
export function buildPluginContext(
  manifest: PluginManifest,
  pluginDir: string,
  config: Record<string, unknown>,
  vaultStore?: PluginVaultAccess
): PluginContext {
  const dataDir = path.join(pluginDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  return {
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    logger: createPluginLogger(manifest.name),
    config: createPluginConfig(config),
    memory: createPluginMemory(dataDir),
    vault: vaultStore ?? createPluginVault(manifest.name),
    dataDir,
    hostVersion: ASTRA_HOST_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Manifest Validation
// ---------------------------------------------------------------------------

const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates a plugin.json manifest object.
 */
export function validateManifest(manifest: unknown): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["Manifest must be a JSON object"], warnings };
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  if (!m.name || typeof m.name !== "string") {
    errors.push("Missing or invalid `name` (must be a non-empty string)");
  } else if (!/^[a-z0-9][a-z0-9-]*$/.test(m.name as string)) {
    errors.push("Plugin name must be lowercase alphanumeric with hyphens");
  }

  if (!m.version || typeof m.version !== "string") {
    errors.push("Missing or invalid `version` (must be a non-empty string)");
  } else if (!SEMVER_RE.test(m.version as string)) {
    warnings.push(`Version "${m.version}" is not valid semver`);
  }

  if (!m.description || typeof m.description !== "string") {
    errors.push("Missing or invalid `description`");
  }

  // Permissions
  if (!Array.isArray(m.permissions)) {
    errors.push("Missing `permissions` array");
  }

  // Optional fields
  if (m.priority !== undefined && (typeof m.priority !== "number" || m.priority < 0)) {
    warnings.push("Priority should be a non-negative number");
  }

  if (m.dependencies !== undefined && !Array.isArray(m.dependencies)) {
    warnings.push("Dependencies should be an array of plugin names");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
