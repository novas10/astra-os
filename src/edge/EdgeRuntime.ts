/**
 * AstraOS — Edge Runtime
 * Lightweight runtime for edge/on-premise deployment with Ollama local models.
 * Offline-first: works without internet, syncs when connected.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { Router } from "express";
import { logger } from "../utils/logger";

// ─── Types ───

export interface EdgeConfig {
  mode: "standalone" | "sync" | "gateway";
  cloudUrl?: string;                // Central AstraOS cloud for sync
  syncInterval: number;             // Sync interval in ms
  offlineQueue: boolean;            // Queue requests when offline
  localModels: string[];            // Ollama model names
  maxMemoryMB: number;              // Memory limit
  features: EdgeFeature[];
}

export type EdgeFeature =
  | "chat" | "tools" | "memory" | "skills"
  | "voice" | "browser" | "workflows";

export interface SyncRecord {
  id: string;
  type: "conversation" | "memory" | "skill" | "config";
  action: "create" | "update" | "delete";
  data: unknown;
  timestamp: string;
  synced: boolean;
}

export interface EdgeStatus {
  mode: string;
  online: boolean;
  lastSync: string | null;
  pendingSyncs: number;
  localModels: string[];
  memoryUsage: { used: number; limit: number };
  features: string[];
  uptime: number;
}

// ─── Edge Runtime ───

export class EdgeRuntime {
  private config: EdgeConfig;
  private online: boolean = false;
  private lastSync: string | null = null;
  private syncQueue: SyncRecord[] = [];
  private syncTimer: NodeJS.Timeout | null = null;
  private startTime: number = Date.now();
  private dataDir: string;

  constructor(config?: Partial<EdgeConfig>) {
    this.config = {
      mode: "standalone",
      syncInterval: 300_000,       // 5 minutes
      offlineQueue: true,
      localModels: ["llama3.1", "all-minilm"],
      maxMemoryMB: 512,
      features: ["chat", "tools", "memory", "skills"],
      ...config,
    };

    this.dataDir = path.join(process.cwd(), ".edge");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    await this.loadSyncQueue();
    await this.checkConnectivity();
    await this.verifyLocalModels();

    if (this.config.mode === "sync" && this.config.cloudUrl) {
      this.startSyncLoop();
    }

    logger.info(`[Edge] Runtime initialized — mode=${this.config.mode}, models=${this.config.localModels.join(", ")}, online=${this.online}`);
  }

  // ─── Connectivity ───

  async checkConnectivity(): Promise<boolean> {
    if (!this.config.cloudUrl) {
      this.online = false;
      return false;
    }

    try {
      const res = await fetch(`${this.config.cloudUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      this.online = res.ok;
    } catch {
      this.online = false;
    }

    return this.online;
  }

  // ─── Local Models ───

  private async verifyLocalModels(): Promise<void> {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

    for (const model of this.config.localModels) {
      try {
        const res = await fetch(`${ollamaUrl}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model }),
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          logger.info(`[Edge] Model verified: ${model}`);
        } else {
          logger.warn(`[Edge] Model not found: ${model} — run 'ollama pull ${model}'`);
        }
      } catch {
        logger.warn(`[Edge] Ollama not reachable — local models unavailable`);
        break;
      }
    }
  }

  // ─── Offline Queue ───

  queueForSync(type: SyncRecord["type"], action: SyncRecord["action"], data: unknown): void {
    if (!this.config.offlineQueue) return;

    const record: SyncRecord = {
      id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      action,
      data,
      timestamp: new Date().toISOString(),
      synced: false,
    };

    this.syncQueue.push(record);
    this.saveSyncQueue();
  }

  // ─── Sync Loop ───

  private startSyncLoop(): void {
    this.syncTimer = setInterval(async () => {
      await this.sync();
    }, this.config.syncInterval);
  }

  async sync(): Promise<{ synced: number; failed: number }> {
    if (!this.config.cloudUrl) return { synced: 0, failed: 0 };

    const isOnline = await this.checkConnectivity();
    if (!isOnline) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;
    const pending = this.syncQueue.filter((r) => !r.synced);

    for (const record of pending) {
      try {
        const res = await fetch(`${this.config.cloudUrl}/api/edge/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(record),
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          record.synced = true;
          synced++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    // Cleanup synced records older than 24h
    const cutoff = Date.now() - 86400_000;
    this.syncQueue = this.syncQueue.filter(
      (r) => !r.synced || new Date(r.timestamp).getTime() > cutoff,
    );

    this.lastSync = new Date().toISOString();
    await this.saveSyncQueue();

    if (synced > 0) {
      logger.info(`[Edge] Synced ${synced} records to cloud (${failed} failed)`);
    }

    return { synced, failed };
  }

  // ─── Persistence ───

  private async loadSyncQueue(): Promise<void> {
    try {
      const data = await fs.readFile(path.join(this.dataDir, "sync-queue.json"), "utf-8");
      this.syncQueue = JSON.parse(data);
    } catch {
      this.syncQueue = [];
    }
  }

  private async saveSyncQueue(): Promise<void> {
    await fs.writeFile(
      path.join(this.dataDir, "sync-queue.json"),
      JSON.stringify(this.syncQueue, null, 2),
      "utf-8",
    );
  }

  // ─── Status ───

  getStatus(): EdgeStatus {
    const memUsage = process.memoryUsage();
    return {
      mode: this.config.mode,
      online: this.online,
      lastSync: this.lastSync,
      pendingSyncs: this.syncQueue.filter((r) => !r.synced).length,
      localModels: this.config.localModels,
      memoryUsage: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        limit: this.config.maxMemoryMB,
      },
      features: this.config.features,
      uptime: Math.round((Date.now() - this.startTime) / 1000),
    };
  }

  // ─── Feature Checks ───

  isFeatureEnabled(feature: EdgeFeature): boolean {
    return this.config.features.includes(feature);
  }

  getConfig(): EdgeConfig {
    return { ...this.config };
  }

  // ─── Cleanup ───

  destroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // ─── Express Router ───

  getRouter(): Router {
    const router = Router();

    router.get("/status", (_req, res) => {
      res.json(this.getStatus());
    });

    router.get("/config", (_req, res) => {
      res.json(this.getConfig());
    });

    router.post("/sync", async (_req, res) => {
      const result = await this.sync();
      res.json(result);
    });

    router.get("/connectivity", async (_req, res) => {
      const online = await this.checkConnectivity();
      res.json({ online, cloudUrl: this.config.cloudUrl || null });
    });

    router.get("/queue", (_req, res) => {
      res.json({
        total: this.syncQueue.length,
        pending: this.syncQueue.filter((r) => !r.synced).length,
        synced: this.syncQueue.filter((r) => r.synced).length,
      });
    });

    // Receive sync from other edge nodes
    router.post("/receive", (req, res) => {
      const record = req.body as SyncRecord;
      record.synced = true;
      this.syncQueue.push(record);
      res.json({ received: true });
    });

    return router;
  }
}
