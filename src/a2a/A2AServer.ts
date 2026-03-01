/**
 * AstraOS — A2A Server
 * Implements Google's Agent-to-Agent protocol for inter-agent communication.
 * Handles task lifecycle: send, get, cancel with SSE streaming support.
 */

import { v4 as uuid } from "uuid";
import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";

export type TaskState = "submitted" | "working" | "input-required" | "completed" | "failed" | "canceled";

export interface A2ATask {
  id: string;
  state: TaskState;
  message: { role: "user" | "agent"; parts: Array<{ type: "text"; text: string } | { type: "file"; file: { name: string; mimeType: string; bytes: string } }> };
  artifacts: Array<{ name: string; parts: Array<{ type: "text"; text: string }> }>;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type TaskHandler = (task: A2ATask) => Promise<A2ATask>;

export class A2AServer {
  private tasks: Map<string, A2ATask> = new Map();
  private taskHandler?: TaskHandler;
  private sseClients: Map<string, Response[]> = new Map();

  onTask(handler: TaskHandler): void {
    this.taskHandler = handler;
  }

  getRouter(): Router {
    const router = Router();

    // Send a task
    router.post("/tasks/send", async (req: Request, res: Response) => {
      try {
        const { id, message, metadata } = req.body;
        const taskId = id || uuid();

        const task: A2ATask = {
          id: taskId,
          state: "submitted",
          message,
          artifacts: [],
          metadata,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        this.tasks.set(taskId, task);
        logger.info(`[A2A] Task received: ${taskId}`);

        // Process task asynchronously
        if (this.taskHandler) {
          task.state = "working";
          this.notifySSE(taskId, task);

          try {
            const result = await this.taskHandler(task);
            result.state = "completed";
            result.updatedAt = Date.now();
            this.tasks.set(taskId, result);
            this.notifySSE(taskId, result);
            res.json(result);
          } catch (err) {
            task.state = "failed";
            task.artifacts = [{ name: "error", parts: [{ type: "text", text: (err as Error).message }] }];
            task.updatedAt = Date.now();
            this.tasks.set(taskId, task);
            this.notifySSE(taskId, task);
            res.json(task);
          }
        } else {
          res.json(task);
        }
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    // Send with SSE streaming
    router.post("/tasks/sendSubscribe", async (req: Request, res: Response) => {
      const { id, message, metadata } = req.body;
      const taskId = id || uuid();

      const task: A2ATask = {
        id: taskId,
        state: "submitted",
        message,
        artifacts: [],
        metadata,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.tasks.set(taskId, task);

      // Set up SSE
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Send initial state
      res.write(`data: ${JSON.stringify({ type: "task-status", task })}\n\n`);

      // Register SSE client
      if (!this.sseClients.has(taskId)) this.sseClients.set(taskId, []);
      this.sseClients.get(taskId)!.push(res);

      req.on("close", () => {
        const clients = this.sseClients.get(taskId);
        if (clients) {
          const idx = clients.indexOf(res);
          if (idx >= 0) clients.splice(idx, 1);
        }
      });

      // Process task
      if (this.taskHandler) {
        task.state = "working";
        this.notifySSE(taskId, task);

        try {
          const result = await this.taskHandler(task);
          result.state = "completed";
          result.updatedAt = Date.now();
          this.tasks.set(taskId, result);
          this.notifySSE(taskId, result);
        } catch (err) {
          task.state = "failed";
          task.artifacts = [{ name: "error", parts: [{ type: "text", text: (err as Error).message }] }];
          task.updatedAt = Date.now();
          this.notifySSE(taskId, task);
        }
      }
    });

    // Get task status
    router.post("/tasks/get", (req: Request, res: Response) => {
      const { id } = req.body;
      const task = this.tasks.get(id);
      if (!task) {
        res.status(404).json({ error: `Task not found: ${id}` });
        return;
      }
      res.json(task);
    });

    // Cancel task
    router.post("/tasks/cancel", (req: Request, res: Response) => {
      const { id } = req.body;
      const task = this.tasks.get(id);
      if (!task) {
        res.status(404).json({ error: `Task not found: ${id}` });
        return;
      }
      task.state = "canceled";
      task.updatedAt = Date.now();
      this.notifySSE(id, task);
      res.json(task);
    });

    return router;
  }

  private notifySSE(taskId: string, task: A2ATask): void {
    const clients = this.sseClients.get(taskId);
    if (!clients) return;

    const data = JSON.stringify({ type: "task-status", task });
    for (const client of clients) {
      try {
        client.write(`data: ${data}\n\n`);
        if (task.state === "completed" || task.state === "failed" || task.state === "canceled") {
          client.end();
        }
      } catch { /* SSE write failure */ }
    }

    if (task.state === "completed" || task.state === "failed" || task.state === "canceled") {
      this.sseClients.delete(taskId);
    }
  }

  getTask(id: string): A2ATask | undefined {
    return this.tasks.get(id);
  }

  listTasks(): A2ATask[] {
    return Array.from(this.tasks.values());
  }
}
