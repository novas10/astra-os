/**
 * AstraOS — Plugin System Tests
 * Tests for PluginSDK, PluginLoader, and PluginManager.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger before any imports
vi.mock("../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  unlinkSync: vi.fn(),
  copyFileSync: vi.fn(),
  watch: vi.fn(() => ({ close: vi.fn() })),
}));

// Mock express Router
vi.mock("express", () => ({
  Router: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}));

import * as fs from "fs";
import { logger } from "../utils/logger";
import {
  definePlugin,
  validateManifest,
  createPluginLogger,
  createPluginMemory,
  createPluginVault,
  createPluginConfig,
  buildPluginContext,
  ASTRA_HOST_VERSION,
} from "../plugins/PluginSDK";
import { PluginLoader } from "../plugins/PluginLoader";
import { PluginManager } from "../plugins/PluginManager";
import type { AstraPlugin, PluginManifest, PluginMessage, PluginResponse } from "../plugins/types";

// ---------------------------------------------------------------------------
// PluginSDK — definePlugin
// ---------------------------------------------------------------------------

describe("PluginSDK — definePlugin", () => {
  it("should return a valid plugin object when all required fields are present", () => {
    const plugin = definePlugin({
      name: "test-plugin",
      version: "1.0.0",
      description: "A test plugin",
    });
    expect(plugin.name).toBe("test-plugin");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.description).toBe("A test plugin");
  });

  it("should throw if name is missing", () => {
    expect(() =>
      definePlugin({ name: "", version: "1.0.0", description: "desc" })
    ).toThrow("Plugin must have a non-empty `name` string");
  });

  it("should throw if name is not a string", () => {
    expect(() =>
      definePlugin({ name: 123 as any, version: "1.0.0", description: "desc" })
    ).toThrow("Plugin must have a non-empty `name` string");
  });

  it("should throw if version is missing", () => {
    expect(() =>
      definePlugin({ name: "test", version: "", description: "desc" })
    ).toThrow("Plugin must have a non-empty `version` string");
  });

  it("should throw if version is not a string", () => {
    expect(() =>
      definePlugin({ name: "test", version: null as any, description: "desc" })
    ).toThrow("Plugin must have a non-empty `version` string");
  });

  it("should throw if description is missing", () => {
    expect(() =>
      definePlugin({ name: "test", version: "1.0.0", description: "" })
    ).toThrow("Plugin must have a non-empty `description` string");
  });

  it("should preserve optional fields like onLoad and onMessage", () => {
    const onLoad = vi.fn();
    const plugin = definePlugin({
      name: "test",
      version: "1.0.0",
      description: "desc",
      onLoad,
    });
    expect(plugin.onLoad).toBe(onLoad);
  });

  it("should preserve routes, tools, and cron arrays", () => {
    const plugin = definePlugin({
      name: "test",
      version: "1.0.0",
      description: "desc",
      routes: [],
      tools: [],
      cron: [],
    });
    expect(plugin.routes).toEqual([]);
    expect(plugin.tools).toEqual([]);
    expect(plugin.cron).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PluginSDK — validateManifest
// ---------------------------------------------------------------------------

describe("PluginSDK — validateManifest", () => {
  const validManifest: PluginManifest = {
    name: "my-plugin",
    version: "1.0.0",
    description: "A valid plugin",
    permissions: ["network"],
  };

  it("should validate a correct manifest", () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should reject null manifest", () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Manifest must be a JSON object");
  });

  it("should reject non-object manifest", () => {
    const result = validateManifest("not an object");
    expect(result.valid).toBe(false);
  });

  it("should reject missing name", () => {
    const result = validateManifest({ ...validManifest, name: undefined });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("should reject invalid name format (uppercase)", () => {
    const result = validateManifest({ ...validManifest, name: "MyPlugin" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("lowercase"))).toBe(true);
  });

  it("should reject name starting with hyphen", () => {
    const result = validateManifest({ ...validManifest, name: "-invalid" });
    expect(result.valid).toBe(false);
  });

  it("should reject missing version", () => {
    const result = validateManifest({ ...validManifest, version: undefined });
    expect(result.valid).toBe(false);
  });

  it("should warn on non-semver version", () => {
    const result = validateManifest({ ...validManifest, version: "abc" });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("semver"))).toBe(true);
  });

  it("should accept semver with prerelease", () => {
    const result = validateManifest({ ...validManifest, version: "1.0.0-beta.1" });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("should reject missing description", () => {
    const result = validateManifest({ ...validManifest, description: undefined });
    expect(result.valid).toBe(false);
  });

  it("should reject missing permissions array", () => {
    const result = validateManifest({ ...validManifest, permissions: undefined as any });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("permissions"))).toBe(true);
  });

  it("should warn on negative priority", () => {
    const result = validateManifest({ ...validManifest, priority: -5 });
    expect(result.warnings.some((w) => w.includes("Priority"))).toBe(true);
  });

  it("should warn on non-array dependencies", () => {
    const result = validateManifest({ ...validManifest, dependencies: "not-array" as any });
    expect(result.warnings.some((w) => w.includes("Dependencies"))).toBe(true);
  });

  it("should accept valid dependencies array", () => {
    const result = validateManifest({ ...validManifest, dependencies: ["other-plugin"] });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PluginSDK — Context Factories
// ---------------------------------------------------------------------------

describe("PluginSDK — createPluginLogger", () => {
  it("should create a logger with all four methods", () => {
    const pLogger = createPluginLogger("test-plugin");
    expect(typeof pLogger.debug).toBe("function");
    expect(typeof pLogger.info).toBe("function");
    expect(typeof pLogger.warn).toBe("function");
    expect(typeof pLogger.error).toBe("function");
  });

  it("should prefix log messages with the plugin name", () => {
    const mockedLogger = logger as any;
    const pLogger = createPluginLogger("my-plugin");
    pLogger.info("hello");
    expect(mockedLogger.info).toHaveBeenCalledWith("[plugin:my-plugin] hello");
  });
});

describe("PluginSDK — createPluginConfig", () => {
  it("should return a config value by key", () => {
    const config = createPluginConfig({ key1: "value1", key2: 42 });
    expect(config.get("key1")).toBe("value1");
    expect(config.get("key2")).toBe(42);
  });

  it("should return default value when key is missing", () => {
    const config = createPluginConfig({});
    expect(config.get("missing", "default")).toBe("default");
  });

  it("should throw if key is missing and no default is provided", () => {
    const config = createPluginConfig({});
    expect(() => config.get("missing")).toThrow('Config key "missing" not found');
  });

  it("should return all config values via getAll", () => {
    const config = createPluginConfig({ a: 1, b: 2 });
    expect(config.getAll()).toEqual({ a: 1, b: 2 });
  });

  it("should return a copy from getAll, not the original reference", () => {
    const original = { a: 1 };
    const config = createPluginConfig(original);
    const all = config.getAll();
    all.a = 999;
    expect(config.get("a")).toBe(1);
  });
});

describe("PluginSDK — createPluginVault (stub)", () => {
  it("should store and retrieve secrets", async () => {
    const vault = createPluginVault("test-plugin");
    await vault.set("api-key", "secret123");
    const value = await vault.get("api-key");
    expect(value).toBe("secret123");
  });

  it("should throw when getting a non-existent secret", async () => {
    const vault = createPluginVault("test-plugin");
    await expect(vault.get("nonexistent")).rejects.toThrow('Secret "nonexistent" not found');
  });

  it("should delete secrets", async () => {
    const vault = createPluginVault("test-plugin");
    await vault.set("key", "value");
    await vault.delete("key");
    await expect(vault.get("key")).rejects.toThrow();
  });

  it("should list secrets for the plugin namespace", async () => {
    const vault = createPluginVault("test-plugin");
    await vault.set("key1", "val1");
    await vault.set("key2", "val2");
    const list = await vault.list();
    expect(list).toContain("key1");
    expect(list).toContain("key2");
  });
});

describe("PluginSDK — ASTRA_HOST_VERSION", () => {
  it("should export a semver host version", () => {
    expect(ASTRA_HOST_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// PluginLoader
// ---------------------------------------------------------------------------

describe("PluginLoader — constructor and discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a loader with default options", () => {
    const loader = new PluginLoader();
    expect(loader).toBeDefined();
  });

  it("should create a loader with custom pluginsDir", () => {
    const loader = new PluginLoader({ pluginsDir: "/custom/plugins" });
    expect(loader).toBeDefined();
  });

  it("should return empty array if plugins directory does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const loader = new PluginLoader({ pluginsDir: "/nonexistent" });
    const discovered = loader.discoverPlugins();
    expect(discovered).toEqual([]);
  });

  it("should discover plugins with valid manifests", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: "my-plugin", isDirectory: () => true, isFile: () => false } as any,
    ]);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        name: "my-plugin",
        version: "1.0.0",
        description: "A test plugin",
        permissions: [],
      })
    );

    const loader = new PluginLoader({ pluginsDir: "/plugins" });
    const discovered = loader.discoverPlugins();
    expect(discovered).toHaveLength(1);
    expect(discovered[0].manifest.name).toBe("my-plugin");
  });

  it("should skip non-directory entries", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: "file.txt", isDirectory: () => false, isFile: () => true } as any,
    ]);

    const loader = new PluginLoader({ pluginsDir: "/plugins" });
    const discovered = loader.discoverPlugins();
    expect(discovered).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PluginLoader — Dependency Resolution
// ---------------------------------------------------------------------------

describe("PluginLoader — resolveDependencies", () => {
  const loader = new PluginLoader();

  it("should return plugins in order when there are no dependencies", () => {
    const plugins = [
      { dir: "/a", manifest: { name: "a", version: "1.0.0", description: "A", permissions: [] } as PluginManifest },
      { dir: "/b", manifest: { name: "b", version: "1.0.0", description: "B", permissions: [] } as PluginManifest },
    ];
    const sorted = loader.resolveDependencies(plugins);
    expect(sorted.map((p) => p.manifest.name)).toEqual(["a", "b"]);
  });

  it("should resolve simple dependencies (b depends on a)", () => {
    const plugins = [
      { dir: "/b", manifest: { name: "b", version: "1.0.0", description: "B", permissions: [], dependencies: ["a"] } as PluginManifest },
      { dir: "/a", manifest: { name: "a", version: "1.0.0", description: "A", permissions: [] } as PluginManifest },
    ];
    const sorted = loader.resolveDependencies(plugins);
    const names = sorted.map((p) => p.manifest.name);
    expect(names.indexOf("a")).toBeLessThan(names.indexOf("b"));
  });

  it("should throw on circular dependencies", () => {
    const plugins = [
      { dir: "/a", manifest: { name: "a", version: "1.0.0", description: "A", permissions: [], dependencies: ["b"] } as PluginManifest },
      { dir: "/b", manifest: { name: "b", version: "1.0.0", description: "B", permissions: [], dependencies: ["a"] } as PluginManifest },
    ];
    expect(() => loader.resolveDependencies(plugins)).toThrow("Circular plugin dependency");
  });

  it("should throw if a dependency is not found", () => {
    const plugins = [
      { dir: "/a", manifest: { name: "a", version: "1.0.0", description: "A", permissions: [], dependencies: ["missing"] } as PluginManifest },
    ];
    expect(() => loader.resolveDependencies(plugins)).toThrow('Plugin dependency "missing" not found');
  });

  it("should handle deep dependency chains (c -> b -> a)", () => {
    const plugins = [
      { dir: "/c", manifest: { name: "c", version: "1.0.0", description: "C", permissions: [], dependencies: ["b"] } as PluginManifest },
      { dir: "/a", manifest: { name: "a", version: "1.0.0", description: "A", permissions: [] } as PluginManifest },
      { dir: "/b", manifest: { name: "b", version: "1.0.0", description: "B", permissions: [], dependencies: ["a"] } as PluginManifest },
    ];
    const sorted = loader.resolveDependencies(plugins);
    const names = sorted.map((p) => p.manifest.name);
    expect(names).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// PluginLoader — Enable/Disable/Accessors
// ---------------------------------------------------------------------------

describe("PluginLoader — enable, disable, and accessors", () => {
  let loader: PluginLoader;

  beforeEach(() => {
    vi.clearAllMocks();
    loader = new PluginLoader({ pluginsDir: "/plugins" });
  });

  it("should return undefined for non-existent plugin", () => {
    expect(loader.getPlugin("nonexistent")).toBeUndefined();
  });

  it("should report isLoaded=false for unregistered plugin", () => {
    expect(loader.isLoaded("nonexistent")).toBe(false);
  });

  it("should return empty map from getAllPlugins initially", () => {
    const all = loader.getAllPlugins();
    expect(all.size).toBe(0);
  });

  it("should return empty array from getEnabledPlugins initially", () => {
    expect(loader.getEnabledPlugins()).toEqual([]);
  });

  it("should return false when enabling a non-existent plugin", async () => {
    const result = await loader.enablePlugin("nonexistent");
    expect(result).toBe(false);
  });

  it("should return false when disabling a non-existent plugin", async () => {
    const result = await loader.disablePlugin("nonexistent");
    expect(result).toBe(false);
  });

  it("should return false when unloading a non-existent plugin", async () => {
    const result = await loader.unloadPlugin("nonexistent");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PluginLoader — Event System
// ---------------------------------------------------------------------------

describe("PluginLoader — event system", () => {
  it("should register and unregister event listeners", () => {
    const loader = new PluginLoader();
    const listener = vi.fn();
    const unsubscribe = loader.onEvent(listener);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// PluginManager — Lifecycle
// ---------------------------------------------------------------------------

describe("PluginManager — construction and lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a manager with default options", () => {
    const manager = new PluginManager();
    expect(manager).toBeDefined();
  });

  it("should create a manager with custom options", () => {
    const manager = new PluginManager({ pluginsDir: "/custom", hotReload: true });
    expect(manager).toBeDefined();
  });

  it("should list plugins (initially empty)", () => {
    const manager = new PluginManager();
    const plugins = manager.listPlugins();
    expect(plugins).toEqual([]);
  });

  it("should return undefined for non-existent plugin via getPlugin", () => {
    const manager = new PluginManager();
    expect(manager.getPlugin("nonexistent")).toBeUndefined();
  });

  it("should return null health for unknown plugin", () => {
    const manager = new PluginManager();
    expect(manager.getHealth("nonexistent")).toBeNull();
  });

  it("should return empty array from getAllHealth initially", () => {
    const manager = new PluginManager();
    expect(manager.getAllHealth()).toEqual([]);
  });

  it("should return empty tools list initially", () => {
    const manager = new PluginManager();
    expect(manager.getAllTools()).toEqual([]);
  });

  it("should return empty routes list initially", () => {
    const manager = new PluginManager();
    expect(manager.getAllRoutes()).toEqual([]);
  });

  it("should enable and disable plugins (returns false for missing)", async () => {
    const manager = new PluginManager();
    expect(await manager.enablePlugin("nonexistent")).toBe(false);
    expect(await manager.disablePlugin("nonexistent")).toBe(false);
  });

  it("should create an Express router", () => {
    const manager = new PluginManager();
    const router = manager.getRouter();
    expect(router).toBeDefined();
  });

  it("should shutdown gracefully even with no plugins", async () => {
    const manager = new PluginManager();
    await expect(manager.shutdown()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PluginManager — Hook Routing
// ---------------------------------------------------------------------------

describe("PluginManager — hook routing", () => {
  let manager: PluginManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new PluginManager();
  });

  it("should pass message through when no plugins loaded", async () => {
    const message: PluginMessage = {
      id: "msg-1",
      channel: "telegram",
      userId: "user-1",
      text: "Hello",
      timestamp: Date.now(),
    };
    const result = await manager.runMessageHooks(message);
    expect(result).toEqual(message);
  });

  it("should pass response through when no plugins loaded", async () => {
    const response: PluginResponse = {
      id: "res-1",
      text: "Response text",
      timestamp: Date.now(),
    };
    const result = await manager.runResponseHooks(response);
    expect(result).toEqual(response);
  });

  it("should return null from tool call hooks when no plugins loaded", async () => {
    const result = await manager.runToolCallHooks("test-tool", { key: "value" });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PluginManager — Initialize with empty dir
// ---------------------------------------------------------------------------

describe("PluginManager — initialize", () => {
  it("should initialize with no plugins when dir is empty", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const manager = new PluginManager({ pluginsDir: "/empty" });
    const result = await manager.initialize();
    expect(result.loaded).toEqual([]);
    expect(result.failed).toEqual([]);
  });
});
