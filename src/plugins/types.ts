/**
 * AstraOS — Plugin System Type Definitions
 * All interfaces and types used by the Plugin SDK, Loader, and Manager.
 */

// ---------------------------------------------------------------------------
// Plugin Context — injected into plugins at load time
// ---------------------------------------------------------------------------

export interface PluginLogger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface PluginMemoryAccess {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface PluginVaultAccess {
  get(name: string): Promise<string>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface PluginConfigAccess {
  get<T = unknown>(key: string, defaultValue?: T): T;
  getAll(): Record<string, unknown>;
}

export interface PluginContext {
  pluginName: string;
  pluginVersion: string;
  logger: PluginLogger;
  config: PluginConfigAccess;
  memory: PluginMemoryAccess;
  vault: PluginVaultAccess;
  /** Base data directory for the plugin (persistent storage). */
  dataDir: string;
  /** AstraOS version the host is running. */
  hostVersion: string;
}

// ---------------------------------------------------------------------------
// Plugin Messages / Responses — hook payloads
// ---------------------------------------------------------------------------

export interface PluginMessage {
  id: string;
  channel: string;
  userId: string;
  tenantId?: string;
  text: string;
  attachments?: Array<{ type: string; url: string; name?: string }>;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface PluginResponse {
  id: string;
  text: string;
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
  usage?: { input: number; output: number };
  model?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Plugin Routes — custom HTTP endpoints
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface PluginRouteRequest {
  method: HttpMethod;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

export interface PluginRouteResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface PluginRoute {
  method: HttpMethod;
  path: string;
  description?: string;
  handler(req: PluginRouteRequest): Promise<PluginRouteResponse>;
}

// ---------------------------------------------------------------------------
// Plugin Tools — custom tool definitions
// ---------------------------------------------------------------------------

export interface PluginTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(input: Record<string, unknown>, context: PluginContext): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Plugin Cron Jobs — scheduled tasks
// ---------------------------------------------------------------------------

export interface PluginCronJob {
  name: string;
  schedule: string; // cron expression (e.g., "0 9 * * *")
  description?: string;
  handler(context: PluginContext): Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin Manifest — plugin.json schema
// ---------------------------------------------------------------------------

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  /** Entry file relative to plugin directory. Defaults to "index.ts" or "plugin.ts". */
  main?: string;
  /** Minimum AstraOS version required. */
  minHostVersion?: string;
  /** Permissions the plugin requires. */
  permissions: PluginPermission[];
  /** Other plugins this plugin depends on (by name). */
  dependencies?: string[];
  /** Priority for hook execution (lower = earlier). Default 100. */
  priority?: number;
  /** Plugin configuration schema (JSON Schema). */
  configSchema?: Record<string, unknown>;
  /** Default configuration values. */
  defaultConfig?: Record<string, unknown>;
}

export type PluginPermission =
  | "network"
  | "network:outbound"
  | "network:inbound"
  | "filesystem:read"
  | "filesystem:write"
  | "memory:read"
  | "memory:write"
  | "credentials:read"
  | "credentials:write"
  | "shell"
  | "cron"
  | "routes"
  | "tools"
  | "hooks:message"
  | "hooks:response"
  | "hooks:tool";

// ---------------------------------------------------------------------------
// Core Plugin Interface — what extension authors implement
// ---------------------------------------------------------------------------

export interface AstraPlugin {
  name: string;
  version: string;
  description: string;
  author?: string;

  // Lifecycle
  onLoad?(context: PluginContext): Promise<void>;
  onUnload?(): Promise<void>;

  // Hooks
  onMessage?(message: PluginMessage): Promise<PluginMessage | null>;
  onResponse?(response: PluginResponse): Promise<PluginResponse | null>;
  onToolCall?(toolName: string, input: Record<string, unknown>): Promise<Record<string, unknown> | null>;

  // Custom routes
  routes?: PluginRoute[];

  // Custom tools
  tools?: PluginTool[];

  // Scheduled tasks
  cron?: PluginCronJob[];
}

// ---------------------------------------------------------------------------
// Plugin State — internal tracking
// ---------------------------------------------------------------------------

export type PluginStatus = "loaded" | "enabled" | "disabled" | "error" | "unloaded";

export interface PluginEntry {
  manifest: PluginManifest;
  instance: AstraPlugin;
  status: PluginStatus;
  directory: string;
  loadedAt: number;
  lastError?: string;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type PluginEventType =
  | "plugin:loaded"
  | "plugin:enabled"
  | "plugin:disabled"
  | "plugin:unloaded"
  | "plugin:error"
  | "plugin:installed";

export interface PluginEvent {
  type: PluginEventType;
  pluginName: string;
  timestamp: number;
  detail?: string;
}
