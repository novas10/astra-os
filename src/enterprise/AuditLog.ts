/**
 * AstraOS — Enterprise Audit Log
 * Immutable audit trail for compliance (SOC2, GDPR, HIPAA).
 * Every significant action is logged with who, what, when, where, and result.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { Router } from "express";
import { logger } from "../utils/logger";

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: {
    userId: string;
    email?: string;
    role?: string;
    ip?: string;
    userAgent?: string;
  };
  action: AuditAction;
  resource: {
    type: string;       // agent, skill, session, user, tenant, workflow, memory, config
    id: string;
    name?: string;
  };
  details: Record<string, unknown>;
  result: "success" | "failure" | "denied";
  tenantId: string;
  correlationId?: string;
  hash: string;          // SHA-256 chain hash for tamper detection
}

export type AuditAction =
  | "user.login" | "user.logout" | "user.create" | "user.delete" | "user.update"
  | "agent.create" | "agent.delete" | "agent.start" | "agent.stop" | "agent.run"
  | "skill.install" | "skill.uninstall" | "skill.enable" | "skill.disable"
  | "session.create" | "session.delete"
  | "tenant.create" | "tenant.update" | "tenant.delete"
  | "workflow.create" | "workflow.run" | "workflow.cancel"
  | "memory.search" | "memory.delete"
  | "config.update" | "config.export"
  | "billing.subscribe" | "billing.cancel" | "billing.change_plan"
  | "auth.key_rotate" | "auth.permission_change"
  | "data.export" | "data.delete" | "data.access";

export interface AuditQueryOptions {
  tenantId?: string;
  userId?: string;
  action?: AuditAction;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export class AuditLog {
  private entries: AuditEntry[] = [];
  private logDir: string;
  private lastHash: string = "0000000000000000000000000000000000000000000000000000000000000000";
  private maxInMemory: number = 10_000;
  private retentionDays: number;

  constructor(logDir?: string) {
    this.logDir = logDir || path.join(process.cwd(), "audit");
    this.retentionDays = parseInt(process.env.AUDIT_RETENTION_DAYS || "365");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
    await this.loadRecentEntries();
    logger.info(`[AuditLog] Initialized — ${this.entries.length} entries loaded, retention: ${this.retentionDays} days`);
  }

  // ─── Core Logging ───

  async log(
    action: AuditAction,
    actor: AuditEntry["actor"],
    resource: AuditEntry["resource"],
    details: Record<string, unknown> = {},
    result: AuditEntry["result"] = "success",
    tenantId = "default",
    correlationId?: string,
  ): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: `aud_${crypto.randomBytes(12).toString("hex")}`,
      timestamp: new Date().toISOString(),
      actor,
      action,
      resource,
      details: this.sanitizeDetails(details),
      result,
      tenantId,
      correlationId,
      hash: "",
    };

    // Chain hash for tamper detection
    const hashInput = `${this.lastHash}|${entry.id}|${entry.timestamp}|${entry.action}|${entry.actor.userId}|${entry.resource.type}:${entry.resource.id}`;
    entry.hash = crypto.createHash("sha256").update(hashInput).digest("hex");
    this.lastHash = entry.hash;

    // Store in memory
    this.entries.push(entry);
    if (this.entries.length > this.maxInMemory) {
      this.entries = this.entries.slice(-this.maxInMemory);
    }

    // Append to file
    await this.appendToFile(entry);

    return entry;
  }

  // ─── Query ───

  query(options: AuditQueryOptions = {}): AuditEntry[] {
    let results = [...this.entries];

    if (options.tenantId) results = results.filter((e) => e.tenantId === options.tenantId);
    if (options.userId) results = results.filter((e) => e.actor.userId === options.userId);
    if (options.action) results = results.filter((e) => e.action === options.action);
    if (options.resourceType) results = results.filter((e) => e.resource.type === options.resourceType);
    if (options.startDate) results = results.filter((e) => e.timestamp >= options.startDate!);
    if (options.endDate) results = results.filter((e) => e.timestamp <= options.endDate!);

    // Sort newest first
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const offset = options.offset || 0;
    const limit = options.limit || 100;
    return results.slice(offset, offset + limit);
  }

  // ─── Integrity Verification ───

  verifyIntegrity(): { valid: boolean; brokenAt?: number; total: number } {
    let prevHash = "0000000000000000000000000000000000000000000000000000000000000000";

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const expectedInput = `${prevHash}|${entry.id}|${entry.timestamp}|${entry.action}|${entry.actor.userId}|${entry.resource.type}:${entry.resource.id}`;
      const expectedHash = crypto.createHash("sha256").update(expectedInput).digest("hex");

      if (entry.hash !== expectedHash) {
        return { valid: false, brokenAt: i, total: this.entries.length };
      }
      prevHash = entry.hash;
    }

    return { valid: true, total: this.entries.length };
  }

  // ─── GDPR: Data Export & Deletion ───

  exportUserData(userId: string): AuditEntry[] {
    return this.entries.filter((e) => e.actor.userId === userId);
  }

  async deleteUserData(userId: string): Promise<number> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.actor.userId !== userId);
    const deleted = before - this.entries.length;

    // Log the deletion itself
    await this.log(
      "data.delete",
      { userId: "system", role: "system" },
      { type: "user_data", id: userId },
      { deletedEntries: deleted, reason: "GDPR right to erasure" },
    );

    return deleted;
  }

  // ─── Statistics ───

  getStats(tenantId?: string): {
    total: number;
    byAction: Record<string, number>;
    byResult: Record<string, number>;
    byResourceType: Record<string, number>;
    recentActivity: AuditEntry[];
  } {
    const filtered = tenantId ? this.entries.filter((e) => e.tenantId === tenantId) : this.entries;

    const byAction: Record<string, number> = {};
    const byResult: Record<string, number> = {};
    const byResourceType: Record<string, number> = {};

    for (const entry of filtered) {
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;
      byResult[entry.result] = (byResult[entry.result] || 0) + 1;
      byResourceType[entry.resource.type] = (byResourceType[entry.resource.type] || 0) + 1;
    }

    return {
      total: filtered.length,
      byAction,
      byResult,
      byResourceType,
      recentActivity: filtered.slice(-20).reverse(),
    };
  }

  // ─── Internal ───

  private sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...details };
    // Never log sensitive values
    const sensitive = ["password", "secret", "token", "apiKey", "api_key", "authorization"];
    for (const key of Object.keys(sanitized)) {
      if (sensitive.some((s) => key.toLowerCase().includes(s))) {
        sanitized[key] = "[REDACTED]";
      }
    }
    return sanitized;
  }

  private async appendToFile(entry: AuditEntry): Promise<void> {
    const date = entry.timestamp.split("T")[0];
    const filePath = path.join(this.logDir, `audit-${date}.jsonl`);
    await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
  }

  private async loadRecentEntries(): Promise<void> {
    try {
      const files = await fs.readdir(this.logDir);
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort().slice(-7); // Last 7 days

      for (const file of jsonlFiles) {
        const content = await fs.readFile(path.join(this.logDir, file), "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            this.entries.push(JSON.parse(line));
          } catch {
            // Skip invalid lines
          }
        }
      }

      if (this.entries.length > 0) {
        this.lastHash = this.entries[this.entries.length - 1].hash;
      }
    } catch {
      // No audit files yet
    }
  }

  // ─── Express Router ───

  getRouter(): Router {
    const router = Router();

    router.get("/", (req, res) => {
      const options: AuditQueryOptions = {
        tenantId: req.query.tenantId as string,
        userId: req.query.userId as string,
        action: req.query.action as AuditAction,
        resourceType: req.query.resourceType as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        limit: parseInt(req.query.limit as string) || 100,
        offset: parseInt(req.query.offset as string) || 0,
      };
      res.json(this.query(options));
    });

    router.get("/stats", (req, res) => {
      res.json(this.getStats(req.query.tenantId as string));
    });

    router.get("/verify", (_req, res) => {
      res.json(this.verifyIntegrity());
    });

    router.get("/export/:userId", (req, res) => {
      res.json(this.exportUserData(req.params.userId));
    });

    router.delete("/gdpr/:userId", async (req, res) => {
      const deleted = await this.deleteUserData(req.params.userId);
      res.json({ deleted, userId: req.params.userId });
    });

    return router;
  }
}
