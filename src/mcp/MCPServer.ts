/**
 * AstraOS — MCP Server
 * Exposes AstraOS tools as MCP-compliant tools that other agents can discover and call.
 * Supports both stdio and HTTP+SSE transports.
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { logger } from "../utils/logger";

export interface MCPToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface MCPResourceHandler {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  handler: () => Promise<{ contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> }>;
}

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class MCPServer {
  private tools: Map<string, MCPToolHandler> = new Map();
  private resources: Map<string, MCPResourceHandler> = new Map();
  private httpServer?: ReturnType<typeof createServer>;
  private initialized = false;

  registerTool(tool: MCPToolHandler): void {
    this.tools.set(tool.name, tool);
  }

  registerResource(resource: MCPResourceHandler): void {
    this.resources.set(resource.uri, resource);
  }

  // Start stdio transport (for use as a subprocess)
  startStdio(): void {
    let buffer = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (data: string) => {
      buffer += data;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const request: JSONRPCRequest = JSON.parse(line);
            this.handleRequest(request).then((response) => {
              if (response) {
                process.stdout.write(JSON.stringify(response) + "\n");
              }
            });
          } catch (err) {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32700, message: "Parse error" },
            }) + "\n");
          }
        }
      }
    });

    logger.info("[MCP Server] Started in stdio mode");
  }

  // Start HTTP transport for remote MCP connections
  startHTTP(port: number): void {
    this.httpServer = createServer(async (req, res) => {
      if (req.method === "POST") {
        const body = await this.readBody(req);
        try {
          const request: JSONRPCRequest = JSON.parse(body);
          const response = await this.handleRequest(request);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } }));
        }
      } else if (req.method === "GET" && req.url === "/mcp.json") {
        // Serve MCP manifest
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.getManifest()));
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    this.httpServer.listen(port, () => {
      logger.info(`[MCP Server] HTTP transport listening on port ${port}`);
    });
  }

  private async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse | null> {
    const { method, params, id } = request;

    switch (method) {
      case "initialize":
        this.initialized = true;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: { listChanged: true },
              resources: { subscribe: false, listChanged: true },
            },
            serverInfo: { name: "AstraOS", version: "2.1.0" },
          },
        };

      case "notifications/initialized":
        return null; // Notifications don't get responses

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: Array.from(this.tools.values()).map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        };

      case "tools/call": {
        const toolName = (params as { name: string })?.name;
        const toolArgs = (params as { arguments?: Record<string, unknown> })?.arguments || {};
        const tool = this.tools.get(toolName);

        if (!tool) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: `Tool not found: ${toolName}` } };
        }

        try {
          const result = await tool.handler(toolArgs);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
            },
          };
        } catch (err) {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
              isError: true,
            },
          };
        }
      }

      case "resources/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            resources: Array.from(this.resources.values()).map((r) => ({
              uri: r.uri,
              name: r.name,
              description: r.description,
              mimeType: r.mimeType,
            })),
          },
        };

      case "resources/read": {
        const uri = (params as { uri: string })?.uri;
        const resource = this.resources.get(uri);

        if (!resource) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: `Resource not found: ${uri}` } };
        }

        try {
          const result = await resource.handler();
          return { jsonrpc: "2.0", id, result };
        } catch (err) {
          return { jsonrpc: "2.0", id, error: { code: -32603, message: (err as Error).message } };
        }
      }

      case "ping":
        return { jsonrpc: "2.0", id, result: {} };

      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  }

  getManifest(): Record<string, unknown> {
    return {
      name: "AstraOS",
      version: "2.1.0",
      description: "AstraOS AI Agent OS — 17+ built-in tools",
      protocolVersion: "2024-11-05",
      tools: Array.from(this.tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
      })),
      resources: Array.from(this.resources.values()).map((r) => ({
        uri: r.uri,
        name: r.name,
      })),
    };
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
    });
  }

  async destroy(): Promise<void> {
    this.httpServer?.close();
  }
}
