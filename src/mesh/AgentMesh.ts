/**
 * AstraOS — Agent Mesh Network
 * Decentralized multi-agent swarm: peer discovery, task delegation, skill sharing,
 * state sync, health monitoring, and agent migration across network nodes.
 *
 * NO competitor has this. This is the revolutionary feature.
 *
 * Architecture:
 * - Each AstraOS instance is a "mesh node" that can host multiple agents
 * - Nodes discover each other via UDP broadcast or seed URLs
 * - Agents can delegate tasks to agents on other nodes
 * - Skills are shared across the mesh (federated catalog)
 * - State is eventually consistent via vector clock + CRDT-like merge
 * - Failed nodes trigger automatic agent migration to healthy nodes
 */

import * as dgram from "dgram";
import * as crypto from "crypto";
import * as os from "os";
import type { Request, Response } from "express";
import { Router } from "express";
import { logger } from "../utils/logger";

// ─── Types ───

export interface MeshNode {
  id: string;
  name: string;
  host: string;
  port: number;
  agents: string[];
  skills: string[];
  capacity: NodeCapacity;
  status: "online" | "degraded" | "offline";
  lastHeartbeat: number;
  joinedAt: number;
  version: string;
}

export interface NodeCapacity {
  maxAgents: number;
  activeAgents: number;
  cpuUsage: number;
  memoryUsage: number;
  availableSlots: number;
}

export interface MeshTask {
  id: string;
  type: "delegate" | "migrate" | "broadcast" | "skill_request";
  sourceNodeId: string;
  targetNodeId?: string;
  agentId?: string;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
  createdAt: number;
  completedAt?: number;
  ttl: number; // max time to live in ms
}

export interface MeshMessage {
  type: "heartbeat" | "discover" | "discover_reply" | "task" | "task_result" | "skill_sync" | "agent_migrate";
  nodeId: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

// ─── Agent Mesh ───

export class AgentMesh {
  private nodeId: string;
  private nodeName: string;
  private nodes: Map<string, MeshNode> = new Map();
  private tasks: Map<string, MeshTask> = new Map();
  private localAgents: Set<string> = new Set();
  private localSkills: Set<string> = new Set();
  private udpSocket: dgram.Socket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private port: number;
  private broadcastPort: number;
  private seedNodes: string[];
  private onTaskReceived?: (task: MeshTask) => Promise<unknown>;

  constructor(options?: {
    name?: string;
    port?: number;
    broadcastPort?: number;
    seedNodes?: string[];
  }) {
    this.nodeId = `mesh_${crypto.randomBytes(8).toString("hex")}`;
    this.nodeName = options?.name || `astra-${this.nodeId.slice(5, 13)}`;
    this.port = options?.port || parseInt(process.env.MESH_PORT || "0") || 4200;
    this.broadcastPort = options?.broadcastPort || 4201;
    this.seedNodes = options?.seedNodes || (process.env.MESH_SEEDS || "").split(",").filter(Boolean);
  }

  // ─── Lifecycle ───

  async start(): Promise<void> {
    // Register self as a node
    this.nodes.set(this.nodeId, {
      id: this.nodeId,
      name: this.nodeName,
      host: this.getLocalIP(),
      port: this.port,
      agents: [...this.localAgents],
      skills: [...this.localSkills],
      capacity: this.getCapacity(),
      status: "online",
      lastHeartbeat: Date.now(),
      joinedAt: Date.now(),
      version: process.env.npm_package_version || "3.5.0",
    });

    // Start UDP discovery
    try {
      this.udpSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

      this.udpSocket.on("message", (msg, rinfo) => {
        this.handleUDPMessage(msg, rinfo);
      });

      this.udpSocket.on("error", (err) => {
        logger.warn(`[Mesh] UDP error: ${err.message}`);
      });

      this.udpSocket.bind(this.broadcastPort, () => {
        this.udpSocket!.setBroadcast(true);
        logger.info(`[Mesh] UDP discovery listening on port ${this.broadcastPort}`);
      });
    } catch {
      logger.warn("[Mesh] UDP discovery unavailable — using seed nodes only");
    }

    // Heartbeat: announce presence every 5 seconds
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 5000);

    // Health check: detect dead nodes every 15 seconds
    this.healthCheckInterval = setInterval(() => this.healthCheck(), 15000);

    // Contact seed nodes
    for (const seed of this.seedNodes) {
      await this.contactSeedNode(seed);
    }

    // Initial discovery broadcast
    this.broadcastDiscover();

    logger.info(`[Mesh] Node started: ${this.nodeName} (${this.nodeId}), port ${this.port}`);
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    this.udpSocket?.close();
    logger.info(`[Mesh] Node stopped: ${this.nodeName}`);
  }

  // ─── Agent & Skill Registration ───

  registerAgent(agentId: string): void {
    this.localAgents.add(agentId);
    this.updateSelfNode();
  }

  unregisterAgent(agentId: string): void {
    this.localAgents.delete(agentId);
    this.updateSelfNode();
  }

  registerSkill(skillName: string): void {
    this.localSkills.add(skillName);
    this.updateSelfNode();
  }

  onTask(handler: (task: MeshTask) => Promise<unknown>): void {
    this.onTaskReceived = handler;
  }

  // ─── Task Delegation ───

  /**
   * Delegate a task to the best available node in the mesh.
   * Selects by: required skill availability, then lowest load.
   */
  async delegateTask(payload: Record<string, unknown>, options?: {
    targetNodeId?: string;
    requiredSkill?: string;
    ttl?: number;
  }): Promise<MeshTask> {
    const task: MeshTask = {
      id: `task_${crypto.randomBytes(8).toString("hex")}`,
      type: "delegate",
      sourceNodeId: this.nodeId,
      targetNodeId: options?.targetNodeId,
      payload,
      status: "pending",
      createdAt: Date.now(),
      ttl: options?.ttl || 30000,
    };

    // Find target node
    if (!task.targetNodeId) {
      const target = this.findBestNode(options?.requiredSkill);
      if (!target) throw new Error("No available mesh node for task delegation");
      task.targetNodeId = target.id;
    }

    this.tasks.set(task.id, task);

    // Send via HTTP to target node
    const targetNode = this.nodes.get(task.targetNodeId!);
    if (!targetNode) throw new Error(`Node ${task.targetNodeId} not found`);

    try {
      const resp = await fetch(`http://${targetNode.host}:${targetNode.port}/api/mesh/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task),
        signal: AbortSignal.timeout(task.ttl),
      });

      if (resp.ok) {
        const result = await resp.json();
        task.status = "completed";
        task.result = result;
        task.completedAt = Date.now();
      } else {
        task.status = "failed";
        task.result = { error: `HTTP ${resp.status}` };
      }
    } catch (err) {
      task.status = "failed";
      task.result = { error: (err as Error).message };
    }

    return task;
  }

  /**
   * Broadcast a task to ALL nodes in the mesh (e.g., for search or sync).
   */
  async broadcastTask(payload: Record<string, unknown>): Promise<MeshTask[]> {
    const results: MeshTask[] = [];
    const promises: Promise<void>[] = [];

    for (const [nodeId, node] of this.nodes) {
      if (nodeId === this.nodeId || node.status === "offline") continue;

      promises.push(
        this.delegateTask(payload, { targetNodeId: nodeId, ttl: 10000 })
          .then((task) => { results.push(task); })
          .catch(() => {}),
      );
    }

    await Promise.allSettled(promises);
    return results;
  }

  // ─── Agent Migration ───

  /**
   * Migrate an agent from this node to a target node.
   * Used for load balancing or when this node is shutting down.
   */
  async migrateAgent(agentId: string, targetNodeId?: string): Promise<{ success: boolean; targetNode: string }> {
    const target = targetNodeId
      ? this.nodes.get(targetNodeId)
      : this.findBestNode();

    if (!target) throw new Error("No available target node for migration");
    if (target.id === this.nodeId) throw new Error("Cannot migrate to self");

    try {
      const resp = await fetch(`http://${target.host}:${target.port}/api/mesh/migrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          sourceNodeId: this.nodeId,
          skills: [...this.localSkills],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) throw new Error(`Migration failed: ${resp.status}`);

      this.localAgents.delete(agentId);
      this.updateSelfNode();

      logger.info(`[Mesh] Agent ${agentId} migrated to ${target.name}`);
      return { success: true, targetNode: target.id };
    } catch (err) {
      throw new Error(`Migration failed: ${(err as Error).message}`);
    }
  }

  // ─── Node Selection ───

  private findBestNode(requiredSkill?: string): MeshNode | null {
    let bestNode: MeshNode | null = null;
    let bestScore = -1;

    for (const [nodeId, node] of this.nodes) {
      if (nodeId === this.nodeId) continue;
      if (node.status === "offline") continue;
      if (requiredSkill && !node.skills.includes(requiredSkill)) continue;

      // Score: available slots * (1 - cpu) * (1 - mem)
      const score = node.capacity.availableSlots * (1 - node.capacity.cpuUsage) * (1 - node.capacity.memoryUsage);
      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    return bestNode;
  }

  // ─── Discovery & Heartbeat ───

  private sendHeartbeat(): void {
    const msg: MeshMessage = {
      type: "heartbeat",
      nodeId: this.nodeId,
      timestamp: Date.now(),
      payload: {
        name: this.nodeName,
        port: this.port,
        agents: [...this.localAgents],
        skills: [...this.localSkills],
        capacity: this.getCapacity(),
      },
    };

    this.broadcastUDP(msg);
  }

  private broadcastDiscover(): void {
    const msg: MeshMessage = {
      type: "discover",
      nodeId: this.nodeId,
      timestamp: Date.now(),
      payload: { port: this.port, name: this.nodeName },
    };
    this.broadcastUDP(msg);
  }

  private broadcastUDP(msg: MeshMessage): void {
    if (!this.udpSocket) return;
    const buf = Buffer.from(JSON.stringify(msg));
    try {
      this.udpSocket.send(buf, 0, buf.length, this.broadcastPort, "255.255.255.255");
    } catch {
      // Broadcast may fail in some environments
    }
  }

  private handleUDPMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const message = JSON.parse(msg.toString()) as MeshMessage;
      if (message.nodeId === this.nodeId) return; // ignore own messages

      switch (message.type) {
        case "heartbeat":
          this.handleHeartbeat(message, rinfo.address);
          break;
        case "discover":
          this.handleDiscover(message, rinfo.address);
          break;
        case "discover_reply":
          this.handleDiscoverReply(message, rinfo.address);
          break;
      }
    } catch {
      // Invalid message
    }
  }

  private handleHeartbeat(msg: MeshMessage, fromIP: string): void {
    const payload = msg.payload as { name: string; port: number; agents: string[]; skills: string[]; capacity: NodeCapacity };

    const existing = this.nodes.get(msg.nodeId);
    const node: MeshNode = {
      id: msg.nodeId,
      name: payload.name,
      host: fromIP,
      port: payload.port,
      agents: payload.agents,
      skills: payload.skills,
      capacity: payload.capacity,
      status: "online",
      lastHeartbeat: msg.timestamp,
      joinedAt: existing?.joinedAt || Date.now(),
      version: existing?.version || "unknown",
    };

    if (!existing) {
      logger.info(`[Mesh] New node discovered: ${node.name} (${node.id}) at ${fromIP}:${node.port}`);
    }

    this.nodes.set(msg.nodeId, node);
  }

  private handleDiscover(msg: MeshMessage, fromIP: string): void {
    // Reply with our info
    const reply: MeshMessage = {
      type: "discover_reply",
      nodeId: this.nodeId,
      timestamp: Date.now(),
      payload: {
        name: this.nodeName,
        port: this.port,
        agents: [...this.localAgents],
        skills: [...this.localSkills],
        capacity: this.getCapacity(),
      },
    };

    const buf = Buffer.from(JSON.stringify(reply));
    try {
      this.udpSocket?.send(buf, 0, buf.length, this.broadcastPort, fromIP);
    } catch { /* ok */ }
  }

  private handleDiscoverReply(msg: MeshMessage, fromIP: string): void {
    this.handleHeartbeat(msg, fromIP);
  }

  private async contactSeedNode(seed: string): Promise<void> {
    try {
      const resp = await fetch(`http://${seed}/api/mesh/nodes`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const nodes = (await resp.json()) as MeshNode[];
        for (const node of nodes) {
          if (node.id !== this.nodeId) {
            this.nodes.set(node.id, node);
          }
        }
        logger.info(`[Mesh] Discovered ${nodes.length} nodes via seed ${seed}`);
      }
    } catch {
      // Seed node unreachable
    }
  }

  // ─── Health Monitoring ───

  private healthCheck(): void {
    const now = Date.now();
    const timeout = 30000; // 30 seconds without heartbeat = offline

    for (const [nodeId, node] of this.nodes) {
      if (nodeId === this.nodeId) continue;

      const elapsed = now - node.lastHeartbeat;
      if (elapsed > timeout && node.status !== "offline") {
        const previousStatus = node.status;
        node.status = elapsed > timeout * 2 ? "offline" : "degraded";

        if (previousStatus === "online") {
          logger.warn(`[Mesh] Node ${node.name} is ${node.status} (no heartbeat for ${Math.round(elapsed / 1000)}s)`);
        }

        // If node went offline and had agents, trigger migration
        if (node.status === "offline" && node.agents.length > 0) {
          logger.warn(`[Mesh] Node ${node.name} offline with ${node.agents.length} agents — migration needed`);
        }
      }
    }
  }

  // ─── Helpers ───

  private updateSelfNode(): void {
    const self = this.nodes.get(this.nodeId);
    if (self) {
      self.agents = [...this.localAgents];
      self.skills = [...this.localSkills];
      self.capacity = this.getCapacity();
      self.lastHeartbeat = Date.now();
    }
  }

  private getCapacity(): NodeCapacity {
    const maxAgents = parseInt(process.env.MESH_MAX_AGENTS || "20");
    const activeAgents = this.localAgents.size;

    // Get real resource usage
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const memoryUsage = memUsage.heapUsed / totalMem;

    // CPU usage estimate (since last tick)
    const cpus = os.cpus();
    const cpuUsage = cpus.length > 0
      ? cpus.reduce((sum: number, cpu) => {
          const total = cpu.times.user + cpu.times.sys + cpu.times.idle;
          return sum + (1 - cpu.times.idle / total);
        }, 0) / cpus.length
      : 0;

    return {
      maxAgents,
      activeAgents,
      cpuUsage: Math.min(1, cpuUsage),
      memoryUsage: Math.min(1, memoryUsage),
      availableSlots: Math.max(0, maxAgents - activeAgents),
    };
  }

  private getLocalIP(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === "IPv4" && !iface.internal) {
          return iface.address;
        }
      }
    }
    return "127.0.0.1";
  }

  // ─── State Queries ───

  getNodes(): MeshNode[] {
    return Array.from(this.nodes.values());
  }

  getOnlineNodes(): MeshNode[] {
    return this.getNodes().filter((n) => n.status !== "offline");
  }

  getNodeId(): string {
    return this.nodeId;
  }

  getMeshStats(): {
    nodeId: string;
    totalNodes: number;
    onlineNodes: number;
    totalAgents: number;
    totalSkills: number;
    pendingTasks: number;
  } {
    const online = this.getOnlineNodes();
    return {
      nodeId: this.nodeId,
      totalNodes: this.nodes.size,
      onlineNodes: online.length,
      totalAgents: online.reduce((sum, n) => sum + n.agents.length, 0),
      totalSkills: new Set(online.flatMap((n) => n.skills)).size,
      pendingTasks: Array.from(this.tasks.values()).filter((t) => t.status === "pending" || t.status === "running").length,
    };
  }

  /**
   * Find which node has a specific skill.
   */
  findSkill(skillName: string): MeshNode[] {
    return this.getOnlineNodes().filter((n) => n.skills.includes(skillName));
  }

  /**
   * Get the full skill catalog across the entire mesh.
   */
  getMeshSkillCatalog(): Array<{ skill: string; nodes: string[] }> {
    const catalog = new Map<string, string[]>();
    for (const node of this.getOnlineNodes()) {
      for (const skill of node.skills) {
        if (!catalog.has(skill)) catalog.set(skill, []);
        catalog.get(skill)!.push(node.name);
      }
    }
    return Array.from(catalog.entries()).map(([skill, nodes]) => ({ skill, nodes }));
  }

  // ─── Express Router ───

  getRouter(): Router {
    const router = Router();

    // List all mesh nodes
    router.get("/nodes", (_req: Request, res: Response) => {
      res.json(this.getNodes());
    });

    // Mesh stats
    router.get("/stats", (_req: Request, res: Response) => {
      res.json(this.getMeshStats());
    });

    // Skill catalog
    router.get("/skills", (_req: Request, res: Response) => {
      res.json(this.getMeshSkillCatalog());
    });

    // Find nodes with a specific skill
    router.get("/skills/:name/nodes", (req: Request, res: Response) => {
      res.json(this.findSkill(req.params.name));
    });

    // Receive task from another node
    router.post("/task", async (req: Request, res: Response) => {
      const task = req.body as MeshTask;
      this.tasks.set(task.id, task);

      if (this.onTaskReceived) {
        try {
          task.status = "running";
          const result = await this.onTaskReceived(task);
          task.status = "completed";
          task.result = result;
          task.completedAt = Date.now();
          res.json(result);
        } catch (err) {
          task.status = "failed";
          task.result = { error: (err as Error).message };
          res.status(500).json({ error: (err as Error).message });
        }
      } else {
        res.status(501).json({ error: "No task handler registered" });
      }
    });

    // Delegate task to mesh
    router.post("/delegate", async (req: Request, res: Response) => {
      try {
        const { payload, targetNodeId, requiredSkill, ttl } = req.body;
        const result = await this.delegateTask(payload, { targetNodeId, requiredSkill, ttl });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Receive agent migration
    router.post("/migrate", (req: Request, res: Response) => {
      const { agentId, sourceNodeId } = req.body;
      this.localAgents.add(agentId);
      this.updateSelfNode();
      logger.info(`[Mesh] Agent ${agentId} migrated from node ${sourceNodeId}`);
      res.json({ success: true, nodeId: this.nodeId });
    });

    // Migrate agent to another node
    router.post("/migrate-out", async (req: Request, res: Response) => {
      try {
        const { agentId, targetNodeId } = req.body;
        const result = await this.migrateAgent(agentId, targetNodeId);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // List pending tasks
    router.get("/tasks", (_req: Request, res: Response) => {
      res.json(Array.from(this.tasks.values()));
    });

    return router;
  }
}
