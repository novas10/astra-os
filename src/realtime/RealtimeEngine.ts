/**
 * AstraOS — RealtimeEngine.ts
 * Real-time multi-user collaboration engine.
 * Shared agent sessions, presence system, live broadcasts,
 * agent-to-agent communication, and collaborative workflows.
 */

import { EventEmitter } from "events";
import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger";

// ─── Types ───

export interface SessionConfig {
  /** Maximum users in this session */
  maxUsers: number;
  /** Agent(s) powering this session */
  agentIds: string[];
  /** Session name for display */
  name: string;
  /** Whether new users can join without invitation */
  isPublic: boolean;
  /** Session TTL in milliseconds (0 = no expiry) */
  ttlMs: number;
  /** Enable message history replay for late joiners */
  replayHistory: boolean;
  /** Maximum history messages to keep */
  maxHistorySize: number;
}

export interface RealtimeEvent {
  id: string;
  type:
    | "message"
    | "agent_response"
    | "agent_thinking"
    | "user_joined"
    | "user_left"
    | "workflow_update"
    | "presence_update"
    | "notification"
    | "error"
    | "system";
  sessionId: string;
  userId?: string;
  agentId?: string;
  payload: unknown;
  timestamp: number;
}

export interface PresenceInfo {
  userId: string;
  displayName: string;
  sessionId: string;
  agentId?: string;
  status: "active" | "idle" | "away";
  joinedAt: number;
  lastSeenAt: number;
  metadata?: Record<string, unknown>;
}

export interface SessionState {
  id: string;
  config: SessionConfig;
  createdAt: number;
  users: Map<string, UserConnection>;
  history: RealtimeEvent[];
  agentState: Map<string, unknown>;
  status: "active" | "paused" | "closed";
}

export interface UserConnection {
  userId: string;
  displayName: string;
  socket: WebSocketLike;
  joinedAt: number;
  lastSeenAt: number;
  status: "active" | "idle" | "away";
  metadata?: Record<string, unknown>;
}

/** Minimal WebSocket interface so we don't depend on a specific WS library */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  addEventListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface CollaborativeWorkflow {
  id: string;
  sessionId: string;
  name: string;
  steps: WorkflowStep[];
  contributors: Map<string, string[]>; // userId -> stepIds they contributed to
  status: "pending" | "in_progress" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowStep {
  id: string;
  description: string;
  assignedTo?: string; // userId
  status: "pending" | "in_progress" | "completed" | "skipped";
  result?: string;
  completedBy?: string;
  completedAt?: number;
}

// ─── Constants ───

const WS_OPEN = 1;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_INTERVAL_MS = 30_000;

// ─── Engine ───

export class RealtimeEngine extends EventEmitter {
  private sessions: Map<string, SessionState> = new Map();
  private userSessions: Map<string, Set<string>> = new Map(); // userId -> sessionIds
  private workflows: Map<string, CollaborativeWorkflow> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.startHeartbeat();
  }

  // ─── Session Management ───

  startSession(sessionId: string, config: SessionConfig): void {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session "${sessionId}" already exists`);
    }

    const session: SessionState = {
      id: sessionId,
      config,
      createdAt: Date.now(),
      users: new Map(),
      history: [],
      agentState: new Map(),
      status: "active",
    };

    this.sessions.set(sessionId, session);

    // Set up TTL
    if (config.ttlMs > 0) {
      setTimeout(() => this.closeSession(sessionId, "Session expired"), config.ttlMs);
    }

    logger.info(`[Realtime] Session started: ${sessionId} — "${config.name}"`);
    this.emit("session:created", { sessionId, config });
  }

  joinSession(sessionId: string, userId: string, ws: WebSocketLike, displayName?: string): void {
    const session = this.getSessionOrThrow(sessionId);

    if (session.status !== "active") {
      throw new Error(`Session "${sessionId}" is ${session.status}`);
    }

    if (session.users.size >= session.config.maxUsers) {
      throw new Error(`Session "${sessionId}" is full (max ${session.config.maxUsers})`);
    }

    const connection: UserConnection = {
      userId,
      displayName: displayName ?? userId,
      socket: ws,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
      status: "active",
    };

    session.users.set(userId, connection);

    // Track user's sessions
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId)!.add(sessionId);

    // Replay history for late joiners
    if (session.config.replayHistory && session.history.length > 0) {
      for (const event of session.history) {
        this.sendToUser(ws, event);
      }
    }

    // Broadcast join event
    const joinEvent = this.createEvent("user_joined", sessionId, { userId, displayName: connection.displayName });
    joinEvent.userId = userId;
    this.broadcast(sessionId, joinEvent, userId); // Don't send to the joining user

    // Set up disconnect handler
    if (ws.on) {
      ws.on("close", () => this.leaveSession(sessionId, userId));
      ws.on("message", (data: unknown) => this.handleMessage(sessionId, userId, data));
    } else if (ws.addEventListener) {
      ws.addEventListener("close", () => this.leaveSession(sessionId, userId));
      ws.addEventListener("message", (data: unknown) => this.handleMessage(sessionId, userId, data));
    }

    logger.info(`[Realtime] User "${userId}" joined session "${sessionId}"`);
    this.emit("session:user_joined", { sessionId, userId });
  }

  leaveSession(sessionId: string, userId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.users.delete(userId);
    this.userSessions.get(userId)?.delete(sessionId);

    const leaveEvent = this.createEvent("user_left", sessionId, { userId });
    leaveEvent.userId = userId;
    this.broadcast(sessionId, leaveEvent);

    logger.info(`[Realtime] User "${userId}" left session "${sessionId}"`);
    this.emit("session:user_left", { sessionId, userId });

    // Auto-close empty sessions
    if (session.users.size === 0) {
      this.closeSession(sessionId, "All users left");
    }
  }

  closeSession(sessionId: string, reason?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "closed";

    const closeEvent = this.createEvent("system", sessionId, { action: "session_closed", reason });
    this.broadcast(sessionId, closeEvent);

    // Disconnect all users
    for (const [userId, conn] of session.users) {
      try {
        conn.socket.close(1000, reason ?? "Session closed");
      } catch { /* socket may already be closed */ }
      this.userSessions.get(userId)?.delete(sessionId);
    }

    session.users.clear();
    this.sessions.delete(sessionId);

    logger.info(`[Realtime] Session closed: ${sessionId} — ${reason ?? "no reason"}`);
    this.emit("session:closed", { sessionId, reason });
  }

  // ─── Broadcasting ───

  broadcast(sessionId: string, event: RealtimeEvent, excludeUserId?: string): void {
    const session = this.getSessionOrThrow(sessionId);

    // Add to history
    if (session.config.replayHistory) {
      session.history.push(event);
      if (session.history.length > session.config.maxHistorySize) {
        session.history.shift();
      }
    }

    const payload = JSON.stringify(event);
    for (const [userId, conn] of session.users) {
      if (userId === excludeUserId) continue;
      if (conn.socket.readyState === WS_OPEN) {
        try {
          conn.socket.send(payload);
        } catch (err) {
          logger.warn(`[Realtime] Failed to send to user "${userId}": ${err}`);
        }
      }
    }

    this.emit("broadcast", event);
  }

  /** Send an agent response to all users in a session */
  broadcastAgentResponse(sessionId: string, agentId: string, content: string): void {
    const event = this.createEvent("agent_response", sessionId, { content });
    event.agentId = agentId;
    this.broadcast(sessionId, event);
  }

  /** Send a "thinking" indicator while agent is processing */
  broadcastAgentThinking(sessionId: string, agentId: string, isThinking: boolean): void {
    const event = this.createEvent("agent_thinking", sessionId, { isThinking });
    event.agentId = agentId;
    this.broadcast(sessionId, event);
  }

  /** Send a notification to all connected users across all sessions */
  broadcastGlobal(event: Omit<RealtimeEvent, "id" | "timestamp">): void {
    const fullEvent: RealtimeEvent = {
      ...event,
      id: `evt_${uuid().slice(0, 8)}`,
      timestamp: Date.now(),
    };

    const payload = JSON.stringify(fullEvent);
    for (const session of this.sessions.values()) {
      if (session.status !== "active") continue;
      for (const conn of session.users.values()) {
        if (conn.socket.readyState === WS_OPEN) {
          try {
            conn.socket.send(payload);
          } catch { /* ignore */ }
        }
      }
    }
  }

  // ─── Presence ───

  getPresence(): PresenceInfo[] {
    const presenceList: PresenceInfo[] = [];

    for (const session of this.sessions.values()) {
      if (session.status !== "active") continue;
      for (const conn of session.users.values()) {
        presenceList.push({
          userId: conn.userId,
          displayName: conn.displayName,
          sessionId: session.id,
          agentId: session.config.agentIds[0],
          status: conn.status,
          joinedAt: conn.joinedAt,
          lastSeenAt: conn.lastSeenAt,
          metadata: conn.metadata,
        });
      }
    }

    return presenceList;
  }

  getSessionPresence(sessionId: string): PresenceInfo[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    return Array.from(session.users.values()).map((conn) => ({
      userId: conn.userId,
      displayName: conn.displayName,
      sessionId,
      agentId: session.config.agentIds[0],
      status: conn.status,
      joinedAt: conn.joinedAt,
      lastSeenAt: conn.lastSeenAt,
      metadata: conn.metadata,
    }));
  }

  updatePresence(sessionId: string, userId: string, status: PresenceInfo["status"]): void {
    const session = this.sessions.get(sessionId);
    const conn = session?.users.get(userId);
    if (!conn) return;

    conn.status = status;
    conn.lastSeenAt = Date.now();

    const event = this.createEvent("presence_update", sessionId, { userId, status });
    event.userId = userId;
    this.broadcast(sessionId, event, userId);
  }

  // ─── Collaborative Workflows ───

  createWorkflow(sessionId: string, name: string, steps: Omit<WorkflowStep, "id" | "status">[]): string {
    this.getSessionOrThrow(sessionId);

    const workflowId = `wf_${uuid().slice(0, 8)}`;
    const workflow: CollaborativeWorkflow = {
      id: workflowId,
      sessionId,
      name,
      steps: steps.map((s) => ({
        ...s,
        id: `ws_${uuid().slice(0, 6)}`,
        status: "pending" as const,
      })),
      contributors: new Map(),
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.workflows.set(workflowId, workflow);

    const event = this.createEvent("workflow_update", sessionId, {
      workflowId,
      action: "created",
      name,
      steps: workflow.steps,
    });
    this.broadcast(sessionId, event);

    logger.info(`[Realtime] Workflow created: ${workflowId} in session ${sessionId}`);
    return workflowId;
  }

  claimWorkflowStep(workflowId: string, stepId: string, userId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;

    const step = workflow.steps.find((s) => s.id === stepId);
    if (!step || step.status !== "pending") return false;

    step.assignedTo = userId;
    step.status = "in_progress";
    workflow.status = "in_progress";
    workflow.updatedAt = Date.now();

    // Track contribution
    if (!workflow.contributors.has(userId)) {
      workflow.contributors.set(userId, []);
    }
    workflow.contributors.get(userId)!.push(stepId);

    const event = this.createEvent("workflow_update", workflow.sessionId, {
      workflowId,
      action: "step_claimed",
      stepId,
      userId,
    });
    this.broadcast(workflow.sessionId, event);

    return true;
  }

  completeWorkflowStep(workflowId: string, stepId: string, userId: string, result: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;

    const step = workflow.steps.find((s) => s.id === stepId);
    if (!step || step.assignedTo !== userId) return false;

    step.status = "completed";
    step.result = result;
    step.completedBy = userId;
    step.completedAt = Date.now();
    workflow.updatedAt = Date.now();

    // Check if all steps are done
    const allDone = workflow.steps.every((s) => s.status === "completed" || s.status === "skipped");
    if (allDone) {
      workflow.status = "completed";
    }

    const event = this.createEvent("workflow_update", workflow.sessionId, {
      workflowId,
      action: allDone ? "completed" : "step_completed",
      stepId,
      userId,
      result,
    });
    this.broadcast(workflow.sessionId, event);

    return true;
  }

  getWorkflow(workflowId: string): CollaborativeWorkflow | undefined {
    return this.workflows.get(workflowId);
  }

  // ─── Agent-to-Agent Communication ───

  sendAgentMessage(fromAgentId: string, toSessionId: string, content: string): void {
    const event = this.createEvent("message", toSessionId, {
      content,
      fromAgent: fromAgentId,
      isAgentToAgent: true,
    });
    event.agentId = fromAgentId;
    this.broadcast(toSessionId, event);
  }

  // ─── Session Queries ───

  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): Array<{ id: string; name: string; userCount: number; status: string }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      name: s.config.name,
      userCount: s.users.size,
      status: s.status,
    }));
  }

  getUserSessions(userId: string): string[] {
    return Array.from(this.userSessions.get(userId) ?? []);
  }

  getStats(): Record<string, unknown> {
    const totalUsers = new Set<string>();
    for (const session of this.sessions.values()) {
      for (const userId of session.users.keys()) {
        totalUsers.add(userId);
      }
    }

    return {
      activeSessions: this.sessions.size,
      totalConnectedUsers: totalUsers.size,
      activeWorkflows: Array.from(this.workflows.values()).filter((w) => w.status === "in_progress").length,
    };
  }

  // ─── Internal ───

  private handleMessage(sessionId: string, userId: string, rawData: unknown): void {
    const session = this.sessions.get(sessionId);
    const conn = session?.users.get(userId);
    if (!session || !conn) return;

    conn.lastSeenAt = Date.now();
    conn.status = "active";

    try {
      const data = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
      const event = this.createEvent("message", sessionId, data);
      event.userId = userId;
      this.broadcast(sessionId, event, userId);
      this.emit("message", { sessionId, userId, data });
    } catch (err) {
      logger.warn(`[Realtime] Failed to parse message from "${userId}": ${err}`);
    }
  }

  private sendToUser(ws: WebSocketLike, event: RealtimeEvent): void {
    if (ws.readyState === WS_OPEN) {
      try {
        ws.send(JSON.stringify(event));
      } catch { /* ignore */ }
    }
  }

  private createEvent(type: RealtimeEvent["type"], sessionId: string, payload: unknown): RealtimeEvent {
    return {
      id: `evt_${uuid().slice(0, 8)}`,
      type,
      sessionId,
      payload,
      timestamp: Date.now(),
    };
  }

  private getSessionOrThrow(sessionId: string): SessionState {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    return session;
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const session of this.sessions.values()) {
        if (session.status !== "active") continue;
        for (const conn of session.users.values()) {
          if (now - conn.lastSeenAt > IDLE_TIMEOUT_MS && conn.status === "active") {
            conn.status = "idle";
            const event = this.createEvent("presence_update", session.id, {
              userId: conn.userId,
              status: "idle",
            });
            this.broadcast(session.id, event);
          }
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Don't prevent process exit
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  /** Graceful shutdown */
  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId, "Engine shutting down");
    }

    this.removeAllListeners();
    logger.info("[Realtime] Engine destroyed");
  }
}
