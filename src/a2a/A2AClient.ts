/**
 * AstraOS — A2A Client
 * Discovers remote agents via Agent Cards and sends tasks via the A2A protocol.
 */

import { logger } from "../utils/logger";
import type { AgentCard } from "./AgentCard";
import type { A2ATask } from "./A2AServer";

export class A2AClient {
  private knownAgents: Map<string, AgentCard> = new Map();

  async discoverAgent(baseUrl: string): Promise<AgentCard | null> {
    try {
      const res = await fetch(`${baseUrl}/.well-known/agent.json`);
      if (!res.ok) return null;

      const card = (await res.json()) as AgentCard;
      this.knownAgents.set(card.name, card);
      logger.info(`[A2A Client] Discovered agent: ${card.name} at ${baseUrl}`);
      return card;
    } catch (err) {
      logger.warn(`[A2A Client] Failed to discover agent at ${baseUrl}: ${(err as Error).message}`);
      return null;
    }
  }

  async sendTask(agentUrl: string, message: string, metadata?: Record<string, unknown>): Promise<A2ATask> {
    const res = await fetch(`${agentUrl}/a2a/tasks/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          role: "user",
          parts: [{ type: "text", text: message }],
        },
        metadata,
      }),
    });

    if (!res.ok) {
      throw new Error(`A2A task failed: ${res.status} ${res.statusText}`);
    }

    return (await res.json()) as A2ATask;
  }

  async sendTaskStreaming(
    agentUrl: string,
    message: string,
    onUpdate: (task: A2ATask) => void,
    metadata?: Record<string, unknown>,
  ): Promise<A2ATask> {
    const res = await fetch(`${agentUrl}/a2a/tasks/sendSubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          role: "user",
          parts: [{ type: "text", text: message }],
        },
        metadata,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`A2A streaming failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let lastTask: A2ATask | null = null;
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.task) {
              lastTask = event.task;
              onUpdate(event.task);
            }
          } catch { /* malformed SSE event */ }
        }
      }
    }

    if (!lastTask) throw new Error("No task response received");
    return lastTask;
  }

  async getTask(agentUrl: string, taskId: string): Promise<A2ATask> {
    const res = await fetch(`${agentUrl}/a2a/tasks/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId }),
    });

    return (await res.json()) as A2ATask;
  }

  async cancelTask(agentUrl: string, taskId: string): Promise<A2ATask> {
    const res = await fetch(`${agentUrl}/a2a/tasks/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId }),
    });

    return (await res.json()) as A2ATask;
  }

  getKnownAgents(): AgentCard[] {
    return Array.from(this.knownAgents.values());
  }
}
