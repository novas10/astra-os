/**
 * AstraOS — CanvasServer.ts
 * Agent-to-UI (A2UI) system. Agents generate interactive HTML interfaces.
 * Uses custom astra-* attributes for declarative interactivity.
 *
 * Usage:
 *   <button astra-action="complete" astra-param-id="123">Done</button>
 *   <input astra-bind="search" astra-submit="onSearch" />
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "../utils/logger";
import { v4 as uuid } from "uuid";

export interface CanvasState {
  sessionId: string;
  html: string;
  title: string;
  data: Record<string, unknown>;
  updatedAt: number;
}

export interface CanvasAction {
  sessionId: string;
  action: string;
  params: Record<string, string>;
  inputValues: Record<string, string>;
  timestamp: number;
}

type ActionHandler = (action: CanvasAction) => Promise<string | void>;

export class CanvasServer {
  private port: number;
  private canvases: Map<string, CanvasState> = new Map();
  private clients: Map<string, Set<WebSocket>> = new Map();
  private actionHandler?: ActionHandler;
  private server?: ReturnType<typeof createServer>;
  private wss?: WebSocketServer;

  constructor(port?: number) {
    this.port = port || parseInt(process.env.CANVAS_PORT || "18793");
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handleHTTP(req, res));
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on("connection", (ws, req) => {
      const sessionId = new URL(req.url || "/", `http://localhost`).searchParams.get("session") || "default";
      this.addClient(sessionId, ws);

      ws.on("message", (data) => this.handleAction(sessionId, data.toString()));
      ws.on("close", () => this.removeClient(sessionId, ws));
    });

    this.server.listen(this.port, () => {
      logger.info(`[AstraOS] Canvas/A2UI server: http://localhost:${this.port}`);
    });
  }

  private handleHTTP(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || "/", `http://localhost`);

    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(this.renderIndex());
      return;
    }

    const sessionMatch = url.pathname.match(/^\/canvas\/(.+)$/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      const canvas = this.canvases.get(sessionId);

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(this.renderCanvas(sessionId, canvas));
      return;
    }

    if (url.pathname === "/api/canvases" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(Array.from(this.canvases.entries()).map(([id, c]) => ({
        sessionId: id,
        title: c.title,
        updatedAt: c.updatedAt,
      }))));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  }

  // ─── Agent API: Create/Update Canvas ───

  setCanvas(sessionId: string, html: string, title?: string, data?: Record<string, unknown>): void {
    this.canvases.set(sessionId, {
      sessionId,
      html,
      title: title || "AstraOS Canvas",
      data: data || {},
      updatedAt: Date.now(),
    });

    // Push update to all connected clients for this session
    this.broadcast(sessionId, {
      type: "canvas_update",
      html,
      title: title || "AstraOS Canvas",
      data: data || {},
    });
  }

  updateData(sessionId: string, data: Record<string, unknown>): void {
    const canvas = this.canvases.get(sessionId);
    if (canvas) {
      canvas.data = { ...canvas.data, ...data };
      canvas.updatedAt = Date.now();
      this.broadcast(sessionId, { type: "data_update", data: canvas.data });
    }
  }

  onAction(handler: ActionHandler): void {
    this.actionHandler = handler;
  }

  private async handleAction(sessionId: string, raw: string): Promise<void> {
    try {
      const message = JSON.parse(raw);
      if (message.type !== "action") return;

      const action: CanvasAction = {
        sessionId,
        action: message.action,
        params: message.params || {},
        inputValues: message.inputValues || {},
        timestamp: Date.now(),
      };

      logger.info(`[AstraOS] Canvas action: ${action.action} (session: ${sessionId})`);

      if (this.actionHandler) {
        const response = await this.actionHandler(action);
        if (response) {
          this.broadcast(sessionId, { type: "action_response", response });
        }
      }
    } catch (err) {
      logger.error(`[AstraOS] Canvas action error: ${(err as Error).message}`);
    }
  }

  private addClient(sessionId: string, ws: WebSocket): void {
    if (!this.clients.has(sessionId)) this.clients.set(sessionId, new Set());
    this.clients.get(sessionId)!.add(ws);

    // Send current canvas state
    const canvas = this.canvases.get(sessionId);
    if (canvas) {
      ws.send(JSON.stringify({ type: "canvas_update", html: canvas.html, title: canvas.title, data: canvas.data }));
    }
  }

  private removeClient(sessionId: string, ws: WebSocket): void {
    this.clients.get(sessionId)?.delete(ws);
  }

  private broadcast(sessionId: string, message: Record<string, unknown>): void {
    const clients = this.clients.get(sessionId);
    if (!clients) return;

    const data = JSON.stringify(message);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  private sanitizeCanvasHtml(html: string): string {
    // Strip <script> tags and on* event handlers to prevent XSS
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  }

  private renderCanvas(sessionId: string, canvas?: CanvasState): string {
    const content = canvas?.html
      ? this.sanitizeCanvasHtml(canvas.html)
      : '<div style="padding:2rem;color:#888;">No canvas content yet. The agent will generate the UI.</div>';
    const title = this.escapeHtml(canvas?.title || "AstraOS Canvas");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:*;">
  <title>${title} — AstraOS Canvas</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e8e4e0; }
    #canvas-root { padding: 1.5rem; max-width: 1200px; margin: 0 auto; }
    .astra-header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1.5rem; background: #111118; border-bottom: 1px solid rgba(139,92,246,0.2); font-size: 0.8rem; }
    .astra-badge { background: linear-gradient(90deg, #8b5cf6, #3b82f6); padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.05em; }
    .astra-status { color: #4ade80; font-size: 0.7rem; }
    [astra-action] { cursor: pointer; transition: opacity 0.2s; }
    [astra-action]:hover { opacity: 0.8; }
  </style>
</head>
<body>
  <div class="astra-header">
    <span class="astra-badge">ASTRA CANVAS</span>
    <span class="astra-status">Connected</span>
  </div>
  <div id="canvas-root">${content}</div>
  <script>
    const sessionId = "${sessionId.replace(/[^a-zA-Z0-9_-]/g, "")}";
    const ws = new WebSocket("ws://" + location.host + "/?session=" + sessionId);

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "canvas_update") {
        document.getElementById("canvas-root").innerHTML = msg.html;
        if (msg.title) document.title = msg.title + " — AstraOS Canvas";
        bindActions();
      }
      if (msg.type === "data_update") {
        document.dispatchEvent(new CustomEvent("astra-data", { detail: msg.data }));
      }
    };

    function bindActions() {
      document.querySelectorAll("[astra-action]").forEach(el => {
        el.addEventListener("click", () => {
          const action = el.getAttribute("astra-action");
          const params = {};
          for (const attr of el.attributes) {
            if (attr.name.startsWith("astra-param-")) {
              params[attr.name.replace("astra-param-", "")] = attr.value;
            }
          }
          // Collect all astra-bind input values
          const inputValues = {};
          document.querySelectorAll("[astra-bind]").forEach(input => {
            inputValues[input.getAttribute("astra-bind")] = input.value;
          });
          ws.send(JSON.stringify({ type: "action", action, params, inputValues }));
        });
      });

      // Submit on Enter for astra-submit inputs
      document.querySelectorAll("[astra-submit]").forEach(el => {
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            const action = el.getAttribute("astra-submit");
            const inputValues = {};
            document.querySelectorAll("[astra-bind]").forEach(input => {
              inputValues[input.getAttribute("astra-bind")] = input.value;
            });
            ws.send(JSON.stringify({ type: "action", action, params: {}, inputValues }));
          }
        });
      });
    }

    bindActions();
  </script>
</body>
</html>`;
  }

  private renderIndex(): string {
    const canvasList = Array.from(this.canvases.entries())
      .map(([id, c]) => `<a href="/canvas/${id}" style="display:block;padding:1rem;margin:0.5rem 0;background:#141428;border-radius:8px;color:#e8e4e0;text-decoration:none;border:1px solid rgba(139,92,246,0.2);">${c.title} <span style="color:#888;font-size:0.8rem;">(${id})</span></a>`)
      .join("") || '<p style="color:#888;">No active canvases. Send a message to your agent to create one.</p>';

    return `<!DOCTYPE html><html><head><title>AstraOS Canvas Hub</title>
      <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#0a0a0f;color:#e8e4e0;padding:2rem;max-width:800px;margin:0 auto}h1{margin-bottom:1.5rem}</style>
      </head><body><h1>AstraOS Canvas Hub</h1>${canvasList}</body></html>`;
  }

  async destroy(): Promise<void> {
    this.wss?.close();
    this.server?.close();
  }
}
