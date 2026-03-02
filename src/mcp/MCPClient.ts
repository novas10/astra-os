/**
 * AstraOS — MCP Client
 * Connects to external MCP servers to discover and invoke their tools.
 * Supports both stdio and SSE transports.
 */

import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { logger } from "../utils/logger";

export interface MCPServerConfig {
  name: string;
  transport: "stdio" | "sse";
  command?: string;     // For stdio transport
  args?: string[];      // For stdio transport
  url?: string;         // For SSE transport
  env?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverName: string;
}

interface JSONRPCMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export class MCPClient extends EventEmitter {
  private servers: Map<string, MCPServerConfig> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private tools: Map<string, MCPTool> = new Map();
  private resources: Map<string, MCPResource> = new Map();
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  private buffers: Map<string, string> = new Map();

  async addServer(config: MCPServerConfig): Promise<void> {
    this.servers.set(config.name, config);

    if (config.transport === "stdio" && config.command) {
      await this.connectStdio(config);
    } else if (config.transport === "sse" && config.url) {
      await this.connectSSE(config);
    }
  }

  private async connectStdio(config: MCPServerConfig): Promise<void> {
    const proc = spawn(config.command!, config.args || [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...config.env },
    });

    this.processes.set(config.name, proc);
    this.buffers.set(config.name, "");

    proc.stdout!.on("data", (data: Buffer) => {
      let buffer = (this.buffers.get(config.name) || "") + data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      this.buffers.set(config.name, buffer);

      for (const line of lines) {
        if (line.trim()) {
          try {
            const msg: JSONRPCMessage = JSON.parse(line);
            this.handleMessage(config.name, msg);
          } catch { /* malformed JSON-RPC message */ }
        }
      }
    });

    proc.stderr!.on("data", (data: Buffer) => {
      logger.warn(`[MCP:${config.name}] stderr: ${data.toString().trim()}`);
    });

    proc.on("close", (code) => {
      logger.info(`[MCP:${config.name}] Process exited with code ${code}`);
      this.processes.delete(config.name);
      // Reconnect after 5 seconds
      setTimeout(() => this.connectStdio(config).catch(() => {}), 5000);
    });

    // Initialize the MCP session
    await this.sendRequest(config.name, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {}, resources: {} },
      clientInfo: { name: "AstraOS", version: "2.1.0" },
    });

    // Send initialized notification
    this.sendNotification(config.name, "notifications/initialized", {});

    // Discover tools
    await this.discoverTools(config.name);
    await this.discoverResources(config.name);

    logger.info(`[MCP:${config.name}] Connected via stdio. Tools: ${this.getServerTools(config.name).length}`);
  }

  private async connectSSE(config: MCPServerConfig): Promise<void> {
    try {
      // For SSE, we use HTTP endpoints
      const baseUrl = config.url!;

      // Discover tools via HTTP
      const toolsRes = await fetch(`${baseUrl}/tools/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.requestId, method: "tools/list", params: {} }),
      });
      const toolsData = await toolsRes.json() as JSONRPCMessage;
      if (toolsData.result) {
        const tools = (toolsData.result as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }).tools || [];
        for (const tool of tools) {
          const mcpTool: MCPTool = { ...tool, serverName: config.name };
          this.tools.set(`${config.name}:${tool.name}`, mcpTool);
        }
      }

      logger.info(`[MCP:${config.name}] Connected via SSE. Tools: ${this.getServerTools(config.name).length}`);
    } catch (err) {
      logger.error(`[MCP:${config.name}] SSE connection failed: ${(err as Error).message}`);
    }
  }

  private handleMessage(serverName: string, msg: JSONRPCMessage): void {
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);

      if (msg.error) {
        pending.reject(new Error(`MCP error: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private sendRequest(serverName: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.requestId;
    const msg: JSONRPCMessage = { jsonrpc: "2.0", id, method, params };
    const proc = this.processes.get(serverName);

    return new Promise((resolve, reject) => {
      if (!proc?.stdin?.writable) {
        return reject(new Error(`MCP server ${serverName} not connected`));
      }

      this.pendingRequests.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify(msg) + "\n");

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  private sendNotification(serverName: string, method: string, params: Record<string, unknown>): void {
    const msg: JSONRPCMessage = { jsonrpc: "2.0", method, params };
    const proc = this.processes.get(serverName);
    if (proc?.stdin?.writable) {
      proc.stdin.write(JSON.stringify(msg) + "\n");
    }
  }

  private async discoverTools(serverName: string): Promise<void> {
    const result = await this.sendRequest(serverName, "tools/list", {}) as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> };
    if (result?.tools) {
      for (const tool of result.tools) {
        const mcpTool: MCPTool = { ...tool, serverName };
        this.tools.set(`${serverName}:${tool.name}`, mcpTool);
      }
    }
  }

  private async discoverResources(serverName: string): Promise<void> {
    try {
      const result = await this.sendRequest(serverName, "resources/list", {}) as { resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }> };
      if (result?.resources) {
        for (const resource of result.resources) {
          this.resources.set(`${serverName}:${resource.uri}`, { ...resource, serverName });
        }
      }
    } catch {
      // Resources are optional
    }
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const config = this.servers.get(serverName);
    if (!config) throw new Error(`MCP server not found: ${serverName}`);

    if (config.transport === "stdio") {
      return this.sendRequest(serverName, "tools/call", { name: toolName, arguments: args });
    } else {
      // SSE/HTTP transport
      const res = await fetch(`${config.url}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.requestId, method: "tools/call", params: { name: toolName, arguments: args } }),
      });
      const data = await res.json() as JSONRPCMessage;
      if (data.error) throw new Error(`MCP tool error: ${data.error.message}`);
      return data.result;
    }
  }

  async readResource(serverName: string, uri: string): Promise<unknown> {
    return this.sendRequest(serverName, "resources/read", { uri });
  }

  getAllTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  getServerTools(serverName: string): MCPTool[] {
    return this.getAllTools().filter((t) => t.serverName === serverName);
  }

  getAllResources(): MCPResource[] {
    return Array.from(this.resources.values());
  }

  async removeServer(name: string): Promise<void> {
    const proc = this.processes.get(name);
    if (proc) {
      proc.kill();
      this.processes.delete(name);
    }
    // Remove tools for this server
    for (const [key, tool] of this.tools) {
      if (tool.serverName === name) this.tools.delete(key);
    }
    for (const [key, resource] of this.resources) {
      if (resource.serverName === name) this.resources.delete(key);
    }
    this.servers.delete(name);
  }

  async destroy(): Promise<void> {
    for (const name of this.servers.keys()) {
      await this.removeServer(name);
    }
  }
}
