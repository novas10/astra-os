/**
 * AstraOS — MCP Registry
 * Central registry that manages MCP server connections and makes their tools
 * available to the AgentLoop.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { MCPServerConfig, MCPTool } from "./MCPClient";
import { MCPClient } from "./MCPClient";
import type { MCPToolHandler } from "./MCPServer";
import { MCPServer } from "./MCPServer";
import { logger } from "../utils/logger";

export class MCPRegistry {
  private client: MCPClient;
  private server: MCPServer;
  private configPath: string;

  constructor(configPath?: string) {
    this.client = new MCPClient();
    this.server = new MCPServer();
    this.configPath = configPath || path.join(process.cwd(), "mcp-servers.json");
  }

  async initialize(): Promise<void> {
    // Load MCP server configs from file
    try {
      const configData = await fs.readFile(this.configPath, "utf-8");
      const config = JSON.parse(configData) as { servers: MCPServerConfig[] };

      for (const serverConfig of config.servers || []) {
        try {
          await this.client.addServer(serverConfig);
          logger.info(`[MCP Registry] Connected to server: ${serverConfig.name}`);
        } catch (err) {
          logger.warn(`[MCP Registry] Failed to connect to ${serverConfig.name}: ${(err as Error).message}`);
        }
      }
    } catch {
      logger.info("[MCP Registry] No mcp-servers.json found, skipping external MCP servers");
    }
  }

  // Register an AstraOS tool as an MCP-exposed tool
  registerAstraTool(tool: MCPToolHandler): void {
    this.server.registerTool(tool);
  }

  // Get all tools from connected MCP servers (for injection into AgentLoop)
  getExternalTools(): MCPTool[] {
    return this.client.getAllTools();
  }

  // Convert MCP tools to the LLM tool format used by AgentLoop
  getExternalToolDefinitions(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
    return this.client.getAllTools().map((tool) => ({
      name: `mcp_${tool.serverName}_${tool.name}`,
      description: `[MCP:${tool.serverName}] ${tool.description}`,
      input_schema: tool.inputSchema,
    }));
  }

  // Call an MCP tool by its prefixed name (mcp_serverName_toolName)
  async callExternalTool(prefixedName: string, args: Record<string, unknown>): Promise<unknown> {
    const match = prefixedName.match(/^mcp_(.+?)_(.+)$/);
    if (!match) throw new Error(`Invalid MCP tool name format: ${prefixedName}`);

    const [, serverName, toolName] = match;
    return this.client.callTool(serverName, toolName, args);
  }

  // Check if a tool name is an MCP tool
  isMCPTool(toolName: string): boolean {
    return toolName.startsWith("mcp_");
  }

  // Start the MCP server (expose AstraOS tools to other agents)
  startServer(port?: number): void {
    if (port) {
      this.server.startHTTP(port);
    }
  }

  getServerManifest(): Record<string, unknown> {
    return this.server.getManifest();
  }

  getClient(): MCPClient {
    return this.client;
  }

  getServer(): MCPServer {
    return this.server;
  }

  async destroy(): Promise<void> {
    await this.client.destroy();
    await this.server.destroy();
  }
}
