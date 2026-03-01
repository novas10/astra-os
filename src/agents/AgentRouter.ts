/**
 * AstraOS — AgentRouter.ts
 * Multi-agent routing with independent agent instances and inter-agent messaging.
 * Each channel/group can route to a different agent with its own workspace, model, and behavior.
 */

import { EventEmitter } from "events";
import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger";

export interface AgentInstance {
  id: string;
  name: string;
  model: string;
  systemPrompt?: string;
  workspaceDir: string;
  channels: string[];       // Channel IDs this agent handles
  skills: string[];          // Skill names enabled for this agent
  metadata: Record<string, unknown>;
  createdAt: number;
  status: "active" | "paused" | "terminated";
}

export interface InterAgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  type: "request" | "response" | "broadcast";
  metadata?: Record<string, unknown>;
  timestamp: number;
  status: "pending" | "delivered" | "read";
}

export interface RoutingRule {
  pattern: string;         // Channel ID pattern (glob-like)
  agentId: string;
  priority: number;
}

export class AgentRouter extends EventEmitter {
  private agents: Map<string, AgentInstance> = new Map();
  private messageQueue: Map<string, InterAgentMessage[]> = new Map(); // agentId -> messages
  private routingRules: RoutingRule[] = [];
  private defaultAgentId?: string;

  constructor() {
    super();
  }

  // ─── Agent Lifecycle ───

  createAgent(config: Omit<AgentInstance, "id" | "createdAt" | "status">): string {
    const id = `agent_${uuid().slice(0, 8)}`;
    const agent: AgentInstance = {
      ...config,
      id,
      createdAt: Date.now(),
      status: "active",
    };

    this.agents.set(id, agent);
    this.messageQueue.set(id, []);

    if (!this.defaultAgentId) this.defaultAgentId = id;

    logger.info(`[AstraOS] Agent created: ${agent.name} (${id}) — model: ${agent.model}`);
    return id;
  }

  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  listAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  pauseAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.status = "paused";
    return true;
  }

  resumeAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.status = "active";
    return true;
  }

  terminateAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.status = "terminated";
    this.messageQueue.delete(agentId);
    if (this.defaultAgentId === agentId) {
      this.defaultAgentId = this.listAgents().find((a) => a.status === "active")?.id;
    }
    return true;
  }

  setDefaultAgent(agentId: string): void {
    if (!this.agents.has(agentId)) throw new Error(`Agent ${agentId} not found`);
    this.defaultAgentId = agentId;
  }

  // ─── Routing ───

  addRoutingRule(rule: Omit<RoutingRule, "priority">, priority?: number): void {
    this.routingRules.push({ ...rule, priority: priority ?? this.routingRules.length });
    this.routingRules.sort((a, b) => a.priority - b.priority);
  }

  removeRoutingRule(pattern: string): boolean {
    const idx = this.routingRules.findIndex((r) => r.pattern === pattern);
    if (idx === -1) return false;
    this.routingRules.splice(idx, 1);
    return true;
  }

  resolveAgent(channelId: string): AgentInstance | undefined {
    // Check routing rules first
    for (const rule of this.routingRules) {
      if (this.matchPattern(channelId, rule.pattern)) {
        const agent = this.agents.get(rule.agentId);
        if (agent && agent.status === "active") return agent;
      }
    }

    // Check agent channel assignments
    for (const agent of this.agents.values()) {
      if (agent.status !== "active") continue;
      for (const ch of agent.channels) {
        if (this.matchPattern(channelId, ch)) return agent;
      }
    }

    // Fall back to default
    return this.defaultAgentId ? this.agents.get(this.defaultAgentId) : undefined;
  }

  private matchPattern(value: string, pattern: string): boolean {
    if (pattern === "*") return true;
    if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
    if (pattern.startsWith("*")) return value.endsWith(pattern.slice(1));
    return value === pattern;
  }

  // ─── Inter-Agent Messaging ───

  sendMessage(fromAgentId: string, toAgentId: string, content: string, type: InterAgentMessage["type"] = "request"): string {
    const msg: InterAgentMessage = {
      id: `msg_${uuid().slice(0, 8)}`,
      fromAgentId,
      toAgentId,
      content,
      type,
      timestamp: Date.now(),
      status: "pending",
    };

    if (type === "broadcast") {
      // Send to all agents except sender
      for (const [agentId, queue] of this.messageQueue) {
        if (agentId !== fromAgentId) {
          queue.push({ ...msg, toAgentId: agentId });
        }
      }
    } else {
      const queue = this.messageQueue.get(toAgentId);
      if (!queue) throw new Error(`Agent ${toAgentId} not found`);
      queue.push(msg);
    }

    this.emit("message", msg);
    logger.info(`[AstraOS] Inter-agent message: ${fromAgentId} → ${toAgentId} (${type})`);
    return msg.id;
  }

  receiveMessages(agentId: string): InterAgentMessage[] {
    const queue = this.messageQueue.get(agentId);
    if (!queue) return [];

    const messages = [...queue];
    queue.length = 0; // Clear queue

    for (const msg of messages) {
      msg.status = "delivered";
    }

    return messages;
  }

  // ─── Spawn Sub-Agent ───

  spawnAgent(parentAgentId: string, task: string, model?: string): string {
    const parent = this.agents.get(parentAgentId);
    if (!parent) throw new Error(`Parent agent ${parentAgentId} not found`);

    const childId = this.createAgent({
      name: `${parent.name}-child-${Date.now()}`,
      model: model || parent.model,
      workspaceDir: parent.workspaceDir,
      channels: [],
      skills: parent.skills,
      metadata: { parentAgentId, task, spawned: true },
    });

    // Send the task to the child
    this.sendMessage(parentAgentId, childId, task, "request");

    logger.info(`[AstraOS] Sub-agent spawned: ${childId} by ${parentAgentId}`);
    return childId;
  }

  getAgentStats(): Record<string, unknown> {
    const active = this.listAgents().filter((a) => a.status === "active").length;
    const paused = this.listAgents().filter((a) => a.status === "paused").length;
    const totalMessages = Array.from(this.messageQueue.values()).reduce((sum, q) => sum + q.length, 0);

    return { totalAgents: this.agents.size, active, paused, pendingMessages: totalMessages, routingRules: this.routingRules.length };
  }
}
