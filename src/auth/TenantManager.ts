/**
 * AstraOS — Tenant Manager
 * Multi-tenancy: tenant isolation, scoped API keys, usage tracking, quotas.
 */

import * as crypto from "crypto";
import { logger } from "../utils/logger";

export interface Tenant {
  id: string;
  name: string;
  plan: "free" | "pro" | "team" | "enterprise";
  ownerId: string;
  apiKeys: string[];
  createdAt: string;
  active: boolean;
  settings: TenantSettings;
  usage: TenantUsage;
}

export interface TenantSettings {
  maxAgents: number;
  maxMessagesPerDay: number;
  maxSkills: number;
  allowedChannels: string[];
  allowedProviders: string[];
  dataRegion: string;
  retentionDays: number;
}

export interface TenantUsage {
  messagesToday: number;
  messagesThisMonth: number;
  tokensThisMonth: number;
  activeAgents: number;
  installedSkills: number;
  storageBytes: number;
  lastResetDate: string;
}

const PLAN_LIMITS: Record<Tenant["plan"], TenantSettings> = {
  free: {
    maxAgents: 1,
    maxMessagesPerDay: 100,
    maxSkills: 5,
    allowedChannels: ["REST", "WebSocket"],
    allowedProviders: ["*"],
    dataRegion: "auto",
    retentionDays: 7,
  },
  pro: {
    maxAgents: 10,
    maxMessagesPerDay: 10_000,
    maxSkills: 50,
    allowedChannels: ["*"],
    allowedProviders: ["*"],
    dataRegion: "auto",
    retentionDays: 90,
  },
  team: {
    maxAgents: 50,
    maxMessagesPerDay: 100_000,
    maxSkills: 200,
    allowedChannels: ["*"],
    allowedProviders: ["*"],
    dataRegion: "auto",
    retentionDays: 365,
  },
  enterprise: {
    maxAgents: Infinity,
    maxMessagesPerDay: Infinity,
    maxSkills: Infinity,
    allowedChannels: ["*"],
    allowedProviders: ["*"],
    dataRegion: "custom",
    retentionDays: Infinity,
  },
};

export class TenantManager {
  private tenants: Map<string, Tenant> = new Map();
  private apiKeyIndex: Map<string, string> = new Map(); // apiKey -> tenantId

  constructor() {
    this.seedDefaultTenant();
  }

  private seedDefaultTenant(): void {
    const defaultTenant: Tenant = {
      id: "default",
      name: "Default Organization",
      plan: "enterprise",
      ownerId: "usr_admin",
      apiKeys: [],
      createdAt: new Date().toISOString(),
      active: true,
      settings: { ...PLAN_LIMITS.enterprise },
      usage: this.emptyUsage(),
    };

    this.tenants.set(defaultTenant.id, defaultTenant);
  }

  private emptyUsage(): TenantUsage {
    return {
      messagesToday: 0,
      messagesThisMonth: 0,
      tokensThisMonth: 0,
      activeAgents: 0,
      installedSkills: 0,
      storageBytes: 0,
      lastResetDate: new Date().toISOString().split("T")[0],
    };
  }

  // ─── Tenant CRUD ───

  createTenant(data: { name: string; plan: Tenant["plan"]; ownerId: string }): Tenant {
    const id = `ten_${crypto.randomBytes(8).toString("hex")}`;
    const apiKey = `tak_${crypto.randomBytes(24).toString("hex")}`;

    const tenant: Tenant = {
      id,
      name: data.name,
      plan: data.plan,
      ownerId: data.ownerId,
      apiKeys: [apiKey],
      createdAt: new Date().toISOString(),
      active: true,
      settings: { ...PLAN_LIMITS[data.plan] },
      usage: this.emptyUsage(),
    };

    this.tenants.set(id, tenant);
    this.apiKeyIndex.set(apiKey, id);

    logger.info(`[Tenant] Created: ${tenant.name} (${tenant.plan})`);
    return tenant;
  }

  getTenant(id: string): Tenant | undefined {
    return this.tenants.get(id);
  }

  getTenantByApiKey(apiKey: string): Tenant | undefined {
    const tenantId = this.apiKeyIndex.get(apiKey);
    return tenantId ? this.tenants.get(tenantId) : undefined;
  }

  updateTenant(id: string, updates: Partial<Pick<Tenant, "name" | "plan" | "active">>): Tenant | undefined {
    const tenant = this.tenants.get(id);
    if (!tenant) return undefined;

    if (updates.plan && updates.plan !== tenant.plan) {
      tenant.settings = { ...PLAN_LIMITS[updates.plan] };
    }

    Object.assign(tenant, updates);
    return tenant;
  }

  deleteTenant(id: string): boolean {
    if (id === "default") return false;
    const tenant = this.tenants.get(id);
    if (!tenant) return false;

    for (const key of tenant.apiKeys) {
      this.apiKeyIndex.delete(key);
    }
    this.tenants.delete(id);
    return true;
  }

  listTenants(): Tenant[] {
    return Array.from(this.tenants.values());
  }

  // ─── API Key Management ───

  addApiKey(tenantId: string): string | null {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;

    const key = `tak_${crypto.randomBytes(24).toString("hex")}`;
    tenant.apiKeys.push(key);
    this.apiKeyIndex.set(key, tenantId);
    return key;
  }

  revokeApiKey(tenantId: string, apiKey: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    const idx = tenant.apiKeys.indexOf(apiKey);
    if (idx === -1) return false;

    tenant.apiKeys.splice(idx, 1);
    this.apiKeyIndex.delete(apiKey);
    return true;
  }

  // ─── Usage Tracking & Quotas ───

  trackMessage(tenantId: string, tokens: number = 0): { allowed: boolean; reason?: string } {
    const tenant = this.tenants.get(tenantId);
    if (!tenant || !tenant.active) {
      return { allowed: false, reason: "Tenant not found or inactive" };
    }

    // Reset daily counter if date changed
    const today = new Date().toISOString().split("T")[0];
    if (tenant.usage.lastResetDate !== today) {
      tenant.usage.messagesToday = 0;
      tenant.usage.lastResetDate = today;
    }

    // Check daily limit
    if (tenant.usage.messagesToday >= tenant.settings.maxMessagesPerDay) {
      return { allowed: false, reason: `Daily message limit reached (${tenant.settings.maxMessagesPerDay})` };
    }

    tenant.usage.messagesToday++;
    tenant.usage.messagesThisMonth++;
    tenant.usage.tokensThisMonth += tokens;
    return { allowed: true };
  }

  checkAgentLimit(tenantId: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    return tenant.usage.activeAgents < tenant.settings.maxAgents;
  }

  checkChannelAllowed(tenantId: string, channel: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    return tenant.settings.allowedChannels.includes("*") || tenant.settings.allowedChannels.includes(channel);
  }

  updateAgentCount(tenantId: string, count: number): void {
    const tenant = this.tenants.get(tenantId);
    if (tenant) tenant.usage.activeAgents = count;
  }

  getUsage(tenantId: string): TenantUsage | null {
    return this.tenants.get(tenantId)?.usage || null;
  }

  // ─── Express Router ───

  getRouter(): import("express").Router {
    const { Router } = require("express") as typeof import("express");
    const router = Router();

    router.get("/", (_req, res) => {
      res.json(this.listTenants().map((t) => ({
        id: t.id, name: t.name, plan: t.plan, active: t.active, createdAt: t.createdAt,
        usage: t.usage, settings: t.settings,
      })));
    });

    router.post("/", (req, res) => {
      const { name, plan, ownerId } = req.body;
      if (!name || !plan) return res.status(400).json({ error: "name and plan required" });
      const tenant = this.createTenant({ name, plan, ownerId: ownerId || "usr_admin" });
      res.json(tenant);
    });

    router.get("/:id", (req, res) => {
      const tenant = this.getTenant(req.params.id);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      res.json(tenant);
    });

    router.patch("/:id", (req, res) => {
      const tenant = this.updateTenant(req.params.id, req.body);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      res.json(tenant);
    });

    router.delete("/:id", (req, res) => {
      if (req.params.id === "default") return res.status(400).json({ error: "Cannot delete default tenant" });
      const ok = this.deleteTenant(req.params.id);
      res.json({ success: ok });
    });

    router.get("/:id/usage", (req, res) => {
      const usage = this.getUsage(req.params.id);
      if (!usage) return res.status(404).json({ error: "Tenant not found" });
      res.json(usage);
    });

    router.post("/:id/api-keys", (req, res) => {
      const key = this.addApiKey(req.params.id);
      if (!key) return res.status(404).json({ error: "Tenant not found" });
      res.json({ apiKey: key });
    });

    router.delete("/:id/api-keys/:key", (req, res) => {
      const ok = this.revokeApiKey(req.params.id, req.params.key);
      res.json({ success: ok });
    });

    return router;
  }
}
