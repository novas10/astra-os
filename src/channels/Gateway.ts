/**
 * AstraOS v3.5 — Gateway.ts
 * The central nervous system. 14+ channel adapters, all in one gateway.
 * WhatsApp + Telegram + Discord + Slack + Teams + Signal + Matrix + Google Chat +
 * iMessage + Zalo + WebChat + Phone + REST + WebSocket
 *
 * Security: GatewayShield (CVE-2026-25253 prevention, CSRF, brute force, exposure detection)
 * Skills: 55+ bundled skills, SkillGenerator (23 templates), SkillMigrator (OpenClaw compat)
 * Enterprise: SSO, RBAC, Audit, Billing, Data Residency, Edge Runtime, Credential Vault
 */

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { AgentLoop } from "../core/AgentLoop";
import { AgentRouter } from "../agents/AgentRouter";
import { SkillsEngine } from "../skills/SkillsEngine";
import { VoiceEngine } from "../voice/VoiceEngine";
import { CanvasServer } from "../canvas/CanvasServer";
import { BrowserEngine } from "../tools/BrowserEngine";
import { HeartbeatEngine } from "../heartbeat/HeartbeatEngine";
import { ProviderRegistry } from "../llm/ProviderRegistry";
import { SlackAdapter } from "./SlackAdapter";
import { TeamsAdapter } from "./TeamsAdapter";
import { SignalAdapter } from "./SignalAdapter";
import { MatrixAdapter } from "./MatrixAdapter";
import { GoogleChatAdapter } from "./GoogleChatAdapter";
import { iMessageAdapter } from "./iMessageAdapter";
import { ZaloAdapter } from "./ZaloAdapter";
import { WebChatAdapter } from "./WebChatAdapter";
import { PhoneAdapter } from "./PhoneAdapter";
import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger";
import { createAuthMiddleware } from "../middleware/auth";
import { createRateLimiter } from "../middleware/rateLimiter";
import { A2AServer } from "../a2a/A2AServer";
import { generateAgentCard } from "../a2a/AgentCard";
import { AstraTracer } from "../telemetry/Tracer";
import { MarketplaceServer } from "../marketplace/MarketplaceServer";
import { RBACManager } from "../auth/RBAC";
import { TenantManager } from "../auth/TenantManager";
import { BillingEngine } from "../enterprise/BillingEngine";
import { AuditLog } from "../enterprise/AuditLog";
import { SSOManager } from "../enterprise/SSO";
import { DataResidencyManager } from "../enterprise/DataResidency";
import { EdgeRuntime } from "../edge/EdgeRuntime";
import { GatewayShield } from "../security/GatewayShield";
import { CredentialVault } from "../security/CredentialVault";
import { SkillSandbox } from "../security/SkillSandbox";
import { SkillGenerator } from "../skills/SkillGenerator";
import { SkillMigrator } from "../skills/SkillMigrator";

export class Gateway {
  private port: number;
  private app = express();
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;

  // Shared subsystems
  private agentRouter: AgentRouter;
  private skills: SkillsEngine;
  private voice: VoiceEngine;
  private canvas: CanvasServer;
  private browser: BrowserEngine;
  private providers: ProviderRegistry;
  private marketplace: MarketplaceServer;
  private rbac: RBACManager;
  private tenants: TenantManager;
  private billing: BillingEngine;
  private auditLog: AuditLog;
  private sso: SSOManager;
  private dataResidency: DataResidencyManager;
  private edgeRuntime: EdgeRuntime;
  private gatewayShield: GatewayShield;
  private credentialVault: CredentialVault;
  private skillSandbox: SkillSandbox;
  private skillGenerator: SkillGenerator;
  private skillMigrator: SkillMigrator;

  // Channel adapters
  private slackAdapter: SlackAdapter;
  private teamsAdapter: TeamsAdapter;
  private signalAdapter: SignalAdapter;
  private matrixAdapter: MatrixAdapter;
  private googleChatAdapter: GoogleChatAdapter;
  private imessageAdapter: iMessageAdapter;
  private zaloAdapter: ZaloAdapter;
  private webChatAdapter: WebChatAdapter;
  private phoneAdapter: PhoneAdapter;

  // Agent instances per session
  private agents: Map<string, AgentLoop> = new Map();

  // Session TTL tracking
  private sessionLastUsed: Map<string, number> = new Map();
  private readonly SESSION_TTL = 30 * 60_000; // 30 minutes
  private readonly MAX_SESSIONS = 1000;

  constructor(port?: number) {
    this.port = port || parseInt(process.env.PORT || "3000");
    this.app.use(express.json({ limit: "10mb" }));

    // Initialize GatewayShield FIRST so middleware can be applied
    this.gatewayShield = new GatewayShield();
    // GatewayShield security middleware (MUST be first — prevents CVE-2026-25253)
    for (const mw of this.gatewayShield.getMiddleware()) {
      this.app.use(mw);
    }
    this.app.use(createRateLimiter());
    this.app.use(createAuthMiddleware());
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    // Initialize shared subsystems
    this.agentRouter = new AgentRouter();
    this.skills = new SkillsEngine();
    this.voice = new VoiceEngine();
    this.canvas = new CanvasServer();
    this.browser = new BrowserEngine();
    this.providers = ProviderRegistry.getInstance();
    this.marketplace = new MarketplaceServer();
    this.rbac = new RBACManager();
    this.tenants = new TenantManager();
    this.billing = new BillingEngine();
    this.auditLog = new AuditLog();
    this.sso = new SSOManager();
    this.dataResidency = new DataResidencyManager();
    this.edgeRuntime = new EdgeRuntime();
    // gatewayShield already initialized above (before middleware)
    this.credentialVault = new CredentialVault();
    this.skillSandbox = new SkillSandbox();
    this.skillGenerator = new SkillGenerator();
    this.skillMigrator = new SkillMigrator();

    // Initialize channel adapters
    this.slackAdapter = new SlackAdapter();
    this.teamsAdapter = new TeamsAdapter();
    this.signalAdapter = new SignalAdapter();
    this.matrixAdapter = new MatrixAdapter();
    this.googleChatAdapter = new GoogleChatAdapter();
    this.imessageAdapter = new iMessageAdapter();
    this.zaloAdapter = new ZaloAdapter();
    this.webChatAdapter = new WebChatAdapter();
    this.phoneAdapter = new PhoneAdapter();
  }

  private getOrCreateAgent(sessionId: string, channelId: string, userId: string): AgentLoop {
    this.sessionLastUsed.set(sessionId, Date.now());

    if (this.agents.has(sessionId)) return this.agents.get(sessionId)!;

    // Evict oldest sessions if at capacity
    if (this.agents.size >= this.MAX_SESSIONS) {
      this.evictStaleSessions();
    }

    // Check if a specific agent is assigned via routing
    const routedAgent = this.agentRouter.resolveAgent(channelId);
    const model = routedAgent?.model || process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514";

    const agent = new AgentLoop(
      { channelId, userId, model, agentId: routedAgent?.id },
      { skills: this.skills, voice: this.voice, canvas: this.canvas, agentRouter: this.agentRouter, browser: this.browser }
    );

    this.agents.set(sessionId, agent);
    return agent;
  }

  private evictStaleSessions(): void {
    const now = Date.now();
    // First pass: remove expired sessions
    for (const [sid, lastUsed] of this.sessionLastUsed) {
      if (now - lastUsed > this.SESSION_TTL) {
        this.agents.delete(sid);
        this.sessionLastUsed.delete(sid);
      }
    }
    // If still over capacity, evict oldest
    if (this.agents.size >= this.MAX_SESSIONS) {
      const sorted = [...this.sessionLastUsed.entries()].sort((a, b) => a[1] - b[1]);
      const toEvict = sorted.slice(0, Math.ceil(this.MAX_SESSIONS * 0.2));
      for (const [sid] of toEvict) {
        this.agents.delete(sid);
        this.sessionLastUsed.delete(sid);
      }
      logger.info(`[Gateway] Evicted ${toEvict.length} stale sessions`);
    }
  }

  async start(): Promise<void> {
    // Initialize LLM providers
    this.providers.initializeDefaults();
    logger.info(`[AstraOS] LLM Providers: ${this.providers.listProviders().join(", ")}`);

    // Initialize subsystems
    await this.skills.initialize();
    await this.voice.initialize();
    await this.canvas.start();
    await this.marketplace.initialize();

    // Initialize security modules (MUST come before everything else)
    await this.gatewayShield.initialize();
    await this.credentialVault.initialize();
    await this.skillSandbox.initialize();

    // Initialize enterprise modules
    await this.auditLog.initialize();
    await this.dataResidency.initialize();
    await this.edgeRuntime.initialize();

    // Create default agent
    this.agentRouter.createAgent({
      name: "AstraOS Default",
      model: process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514",
      workspaceDir: "./workspace",
      channels: ["*"],
      skills: [],
      metadata: {},
    });

    // Initialize optional channel adapters
    await this.initializeAdapters();

    // ─── REST API ───
    this.app.post("/api/chat", async (req, res) => {
      const { message, sessionId, channel = "api", userId = "anonymous", model } = req.body;
      if (!message) return res.status(400).json({ error: "message is required" });

      const sid = sessionId || uuid();
      try {
        const agent = this.getOrCreateAgent(sid, channel, userId);
        const result = await agent.run(message);
        res.json({ response: result.response, sessionId: sid, iterations: result.iterations, toolsUsed: result.toolsUsed, healed: result.healed });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ─── Telegram Webhook ───
    this.app.post("/webhook/telegram", async (req, res) => {
      res.sendStatus(200);
      const message = req.body?.message;
      if (!message?.text) return;

      const chatId = String(message.chat.id);
      const sessionId = `tg_${chatId}`;
      const agent = this.getOrCreateAgent(sessionId, "telegram", message.from?.username || chatId);
      const result = await agent.run(message.text);

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: result.response, parse_mode: "Markdown" }),
      });
    });

    // ─── WhatsApp Business API ───
    this.app.get("/webhook/whatsapp", (req, res) => {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    });

    this.app.post("/webhook/whatsapp", async (req, res) => {
      res.sendStatus(200);
      const messageData = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!messageData || messageData.type !== "text") return;

      const from = messageData.from;
      const sessionId = `wa_${from}`;
      const agent = this.getOrCreateAgent(sessionId, "whatsapp", from);
      const result = await agent.run(messageData.text.body);

      await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: from, type: "text", text: { body: result.response } }),
      });
    });

    // ─── Discord Interactions ───
    this.app.post("/webhook/discord", async (req, res) => {
      const { type, data, member } = req.body;
      if (type === 1) return res.json({ type: 1 });

      if (type === 2) {
        const message = data?.options?.find((o: { name: string }) => o.name === "message")?.value;
        const userId = member?.user?.id;
        const sessionId = `dc_${userId}`;

        res.json({ type: 5 });

        const agent = this.getOrCreateAgent(sessionId, "discord", userId);
        const result = await agent.run(message);

        await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${req.body.token}/messages/@original`, {
          method: "PATCH",
          headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content: result.response.slice(0, 2000) }),
        });
      }
    });

    // ─── Slack Webhook ───
    this.app.post("/webhook/slack", async (req, res) => {
      const result = await this.slackAdapter.handleWebhook(req.body);
      res.json(result);
    });

    // ─── Microsoft Teams Webhook ───
    this.app.post("/webhook/teams", async (req, res) => {
      const result = await this.teamsAdapter.handleWebhook(req.body);
      res.json(result);
    });

    // ─── Google Chat Webhook ───
    this.app.post("/webhook/google-chat", async (req, res) => {
      const result = await this.googleChatAdapter.handleWebhook(req.body);
      res.json(result);
    });

    // ─── Heartbeat Webhook ───
    this.app.post("/webhook/heartbeat/:taskId", async (req, res) => {
      res.sendStatus(200);
      logger.info(`[Gateway] Heartbeat webhook fired for task: ${req.params.taskId}`);
    });

    // ─── Voice Endpoint ───
    this.app.post("/api/voice/tts", async (req, res) => {
      const { text, voice_id } = req.body;
      if (!text) return res.status(400).json({ error: "text is required" });
      try {
        const audio = await this.voice.textToSpeech({ text, voiceId: voice_id });
        res.set("Content-Type", "audio/mpeg");
        res.send(audio);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.app.post("/api/voice/stt", async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          const audio = Buffer.concat(chunks);
          const result = await this.voice.speechToText(audio);
          res.json(result);
        });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ─── Skills API ───
    this.app.get("/api/skills", (_, res) => {
      res.json(this.skills.listSkills().map((s) => ({ name: s.name, version: s.version, description: s.description, enabled: s.enabled })));
    });

    this.app.post("/api/skills/install", async (req, res) => {
      const { name } = req.body;
      const ok = await this.skills.installSkill(name);
      res.json({ success: ok });
    });

    // ─── Agent Management API ───
    this.app.get("/api/agents", (_, res) => {
      res.json(this.agentRouter.listAgents());
    });

    this.app.get("/api/agents/stats", (_, res) => {
      res.json(this.agentRouter.getAgentStats());
    });

    // ─── WebSocket — Real-time ───
    this.wss.on("connection", (ws) => {
      const sessionId = uuid();
      logger.info(`[WebSocket] Client connected: ${sessionId}`);

      ws.on("message", async (data) => {
        const parsed = JSON.parse(data.toString());
        const { message, userId = "ws_user", model } = parsed;

        ws.send(JSON.stringify({ type: "thinking", sessionId }));

        const agent = this.getOrCreateAgent(sessionId, "websocket", userId);
        const result = await agent.run(message);
        ws.send(JSON.stringify({ type: "response", content: result.response, sessionId, iterations: result.iterations, toolsUsed: result.toolsUsed }));
      });

      ws.on("close", () => logger.info(`[WebSocket] Disconnected: ${sessionId}`));
    });

    // ─── A2A Protocol ───
    const a2aServer = new A2AServer();
    a2aServer.onTask(async (task) => {
      const textPart = task.message.parts.find((p) => p.type === "text");
      if (!textPart || textPart.type !== "text") return task;

      const sessionId = `a2a_${task.id}`;
      const agent = this.getOrCreateAgent(sessionId, "a2a", "a2a-client");
      const result = await agent.run(textPart.text);
      task.artifacts = [{ name: "response", parts: [{ type: "text", text: result.response }] }];
      return task;
    });
    this.app.use("/a2a", a2aServer.getRouter());

    // Agent Card (A2A discovery)
    this.app.get("/.well-known/agent.json", (_, res) => {
      const baseUrl = process.env.ASTRA_BASE_URL || `http://localhost:${this.port}`;
      const card = generateAgentCard({
        baseUrl,
        skills: this.skills.listSkills().map((s) => s.name),
        tools: ["execute_command", "read_file", "write_file", "browser_action", "memory_search", "voice_speak", "canvas_render", "computer_use"],
        providers: this.providers.listProviders(),
        channels: this.getActiveChannels(),
      });
      res.json(card);
    });

    // ─── SSE Streaming Chat ───
    this.app.post("/api/chat/stream", async (req, res) => {
      const { message, sessionId, channel = "api", userId = "anonymous" } = req.body;
      if (!message) return res.status(400).json({ error: "message is required" });

      const sid = sessionId || uuid();
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      res.write(`data: ${JSON.stringify({ type: "session", sessionId: sid })}\n\n`);

      try {
        const agent = this.getOrCreateAgent(sid, channel, userId);
        const result = await agent.run(message);
        res.write(`data: ${JSON.stringify({ type: "response", content: result.response, iterations: result.iterations, toolsUsed: result.toolsUsed, healed: result.healed })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: "error", error: (err as Error).message })}\n\n`);
      }
      res.end();
    });

    // ─── Telemetry / Metrics ───
    this.app.get("/api/metrics", (_, res) => {
      res.json(AstraTracer.getInstance().getMetrics());
    });

    this.app.get("/api/traces", (req, res) => {
      const limit = parseInt(req.query?.limit as string) || 50;
      res.json(AstraTracer.getInstance().getRecentTraces(limit));
    });

    // ─── RBAC / Auth ───
    this.app.use(this.rbac.authenticate());
    this.app.use("/api/auth", this.rbac.getRouter());

    // ─── Tenants ───
    this.app.use("/api/admin/tenants", this.rbac.requireRole("admin"), this.tenants.getRouter());

    // ─── Marketplace ───
    this.app.use("/api/marketplace", this.marketplace.getRouter());

    // ─── Billing ───
    this.app.use("/api/billing", this.billing.getRouter());

    // ─── Enterprise: Audit Log ───
    this.app.use("/api/admin/audit", this.rbac.requireRole("admin"), this.auditLog.getRouter());

    // ─── Enterprise: SSO ───
    this.app.use("/api/sso", this.sso.getRouter());

    // ─── Enterprise: Data Residency ───
    this.app.use("/api/admin/data-residency", this.rbac.requireRole("admin"), this.dataResidency.getRouter());

    // ─── Edge Runtime ───
    this.app.use("/api/edge", this.edgeRuntime.getRouter());

    // ─── Security (GatewayShield) ───
    this.app.use("/api/security", this.rbac.requireRole("admin"), this.gatewayShield.getRouter());

    // ─── Credential Vault ───
    this.app.use("/api/admin/credentials", this.rbac.requireRole("admin"), this.credentialVault.getRouter());

    // ─── Skill Security (SkillSandbox) ───
    this.app.use("/api/security/skills", this.skillSandbox.getRouter());

    // ─── Skill Generator ───
    this.app.use("/api/skills", this.skillGenerator.getRouter());

    // ─── Skill Migrator (OpenClaw/ClawHub import) ───
    this.app.use("/api/skills/import", this.skillMigrator.getRouter());

    // ─── Zalo Webhook ───
    this.app.post("/webhook/zalo", async (req, res) => {
      try {
        const result = await this.zaloAdapter.handleWebhook(req.body);
        res.json({ success: true, response: result });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ─── Phone/Telnyx Webhook ───
    this.app.post("/webhook/phone", async (req, res) => {
      res.sendStatus(200);
      try {
        await this.phoneAdapter.handleWebhook(req.body);
      } catch (err) {
        logger.error(`[PhoneAdapter] Webhook error: ${(err as Error).message}`);
      }
    });

    // ─── WebChat Embed Code ───
    this.app.get("/api/webchat/embed", (req, res) => {
      const host = req.headers.host || `localhost:${this.port}`;
      res.json({ embedCode: this.webChatAdapter.getEmbedCode(host) });
    });

    // ─── Admin API ───
    this.app.get("/api/admin/stats", (_, res) => {
      const tracer = AstraTracer.getInstance();
      res.json({
        agents: this.agentRouter.listAgents().length,
        activeSessions: this.agents.size,
        skills: this.skills.listSkills().length,
        channels: this.getActiveChannels(),
        providers: this.providers.listProviders(),
        protocols: ["mcp", "a2a"],
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        metrics: tracer.getMetrics(),
      });
    });

    this.app.get("/api/admin/sessions", (_, res) => {
      const sessions = Array.from(this.sessionLastUsed.entries()).map(([sid, lastUsed]) => ({
        sessionId: sid,
        lastUsed: new Date(lastUsed).toISOString(),
        ageMinutes: Math.round((Date.now() - lastUsed) / 60_000),
      }));
      res.json({ total: sessions.length, sessions });
    });

    this.app.delete("/api/admin/sessions/:id", (req, res) => {
      const { id } = req.params;
      this.agents.delete(id);
      this.sessionLastUsed.delete(id);
      res.json({ success: true });
    });

    this.app.get("/api/admin/conversations", (_, res) => {
      const conversations = Array.from(this.agents.entries()).map(([sid]) => {
        const lastUsed = this.sessionLastUsed.get(sid);
        return {
          sessionId: sid,
          channel: sid.split("_")[0] || "api",
          lastUsed: lastUsed ? new Date(lastUsed).toISOString() : null,
        };
      });
      res.json(conversations);
    });

    // ─── Health Check ───
    this.app.get("/health", (_, res) => {
      res.json({
        status: "operational",
        service: "AstraOS",
        version: "3.5.0",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        providers: this.providers.listProviders(),
        skills: this.skills.listSkills().length,
        agents: this.agentRouter.listAgents().length,
        channels: this.getActiveChannels(),
        protocols: ["mcp", "a2a"],
        features: [
          "rbac", "multi-tenancy", "marketplace", "graphrag", "computer-use",
          "workflows", "billing", "audit-log", "sso", "data-residency", "edge-runtime",
          "gateway-shield", "credential-vault", "skill-sandbox", "skill-generator",
          "skill-migrator", "webchat", "phone", "zalo", "config-first",
        ],
        sandboxMode: "hybrid (docker + process)",
        security: this.gatewayShield.getSecurityReport(),
        skillsEcosystem: this.skills.getStats(),
        activeSessions: this.agents.size,
        tenants: this.tenants.listTenants().length,
        enterprise: {
          sso: true,
          auditLog: true,
          dataResidency: this.dataResidency.getRegions().length + " regions",
          billing: true,
        },
        edge: this.edgeRuntime.getStatus(),
      });
    });

    // ─── Start Server ───
    this.server.listen(this.port, () => {
      console.log(`
  ╔══════════════════════════════════════════════════════════════╗
  ║            AstraOS v3.5 — AI Agent OS                       ║
  ║            Built in India for the World                     ║
  ╠══════════════════════════════════════════════════════════════╣
  ║  REST API     : http://localhost:${this.port}/api/chat                  ║
  ║  SSE Stream   : http://localhost:${this.port}/api/chat/stream           ║
  ║  WebSocket    : ws://localhost:${this.port}                             ║
  ║  WebChat      : ws://localhost:18790                            ║
  ║  Canvas/A2UI  : http://localhost:${process.env.CANVAS_PORT || 18793}                   ║
  ║  A2A Agent    : http://localhost:${this.port}/.well-known/agent.json    ║
  ║  Health       : http://localhost:${this.port}/health                    ║
  ║  Dashboard    : http://localhost:5173                            ║
  ╠══════════════════════════════════════════════════════════════╣
  ║  Channels   : ${this.getActiveChannels().join(", ").padEnd(44)}║
  ║  Providers  : ${this.providers.listProviders().join(", ").padEnd(44)}║
  ║  Protocols  : MCP, A2A, OpenTelemetry                       ║
  ║  Skills     : ${String(this.skills.listSkills().length + " bundled (55+)").padEnd(44)}║
  ║  Security   : GatewayShield ${String(this.gatewayShield.getSecurityReport().grade).padEnd(33)}║
  ║  Enterprise : SSO, Audit, DataResidency, Billing, Vault    ║
  ║  Edge       : ${String(this.edgeRuntime.getStatus().mode).padEnd(44)}║
  ╚══════════════════════════════════════════════════════════════╝
`);
    });
  }

  private async initializeAdapters(): Promise<void> {
    const adapters = [
      { adapter: this.slackAdapter, name: "Slack", envKey: "SLACK_BOT_TOKEN" },
      { adapter: this.teamsAdapter, name: "Teams", envKey: "TEAMS_APP_ID" },
      { adapter: this.signalAdapter, name: "Signal", envKey: "SIGNAL_PHONE_NUMBER" },
      { adapter: this.matrixAdapter, name: "Matrix", envKey: "MATRIX_ACCESS_TOKEN" },
      { adapter: this.googleChatAdapter, name: "Google Chat", envKey: "GOOGLE_CHAT_SERVICE_ACCOUNT" },
      { adapter: this.imessageAdapter, name: "iMessage", envKey: "BLUEBUBBLES_PASSWORD" },
      { adapter: this.zaloAdapter, name: "Zalo", envKey: "ZALO_OA_ACCESS_TOKEN" },
      { adapter: this.phoneAdapter, name: "Phone", envKey: "TELNYX_API_KEY" },
    ];

    // WebChat always initializes (serves its own WebSocket)
    try {
      await this.webChatAdapter.initialize();
      this.webChatAdapter.onMessage(async (msg) => {
        const sessionId = `webchat_${msg.userId}`;
        const agent = this.getOrCreateAgent(sessionId, msg.channelType, msg.userId);
        const result = await agent.run(msg.text);
        return result.response;
      });
      logger.info("[AstraOS] Channel active: WebChat");
    } catch (err) {
      logger.warn(`[AstraOS] WebChat failed: ${(err as Error).message}`);
    }

    for (const { adapter, name, envKey } of adapters) {
      if (process.env[envKey]) {
        try {
          await adapter.initialize();
          adapter.onMessage(async (msg) => {
            const sessionId = `${msg.channelType}_${msg.userId}`;
            const agent = this.getOrCreateAgent(sessionId, msg.channelType, msg.userId);
            const result = await agent.run(msg.text);
            return result.response;
          });
          logger.info(`[AstraOS] Channel active: ${name}`);
        } catch (err) {
          logger.warn(`[AstraOS] Channel ${name} failed to initialize: ${(err as Error).message}`);
        }
      }
    }
  }

  private getActiveChannels(): string[] {
    const channels = ["REST", "WebSocket", "WebChat"];
    if (process.env.TELEGRAM_BOT_TOKEN) channels.push("Telegram");
    if (process.env.WHATSAPP_VERIFY_TOKEN) channels.push("WhatsApp");
    if (process.env.DISCORD_APP_ID) channels.push("Discord");
    if (process.env.SLACK_BOT_TOKEN) channels.push("Slack");
    if (process.env.TEAMS_APP_ID) channels.push("Teams");
    if (process.env.SIGNAL_PHONE_NUMBER) channels.push("Signal");
    if (process.env.MATRIX_ACCESS_TOKEN) channels.push("Matrix");
    if (process.env.GOOGLE_CHAT_SERVICE_ACCOUNT) channels.push("Google Chat");
    if (process.env.BLUEBUBBLES_PASSWORD) channels.push("iMessage");
    if (process.env.ZALO_OA_ACCESS_TOKEN) channels.push("Zalo");
    if (process.env.TELNYX_API_KEY) channels.push("Phone");
    return channels;
  }
}
