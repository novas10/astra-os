/**
 * AstraOS — Data Residency
 * Region-specific data storage with real file-based routing, encryption at rest
 * (AES-256-GCM), data isolation, compliance controls, and data lifecycle management.
 */

import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { Router } from "express";
import { logger } from "../utils/logger";

// ─── Types ───

export interface DataRegion {
  id: string;
  name: string;
  location: string;
  storageEndpoint: string;
  available: boolean;
  compliance: string[];
}

export interface EncryptionKey {
  id: string;
  tenantId: string;
  algorithm: "aes-256-gcm" | "aes-256-cbc";
  key: Buffer;
  iv: Buffer;
  createdAt: string;
  rotatedAt?: string;
}

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: string;
  algorithm: string;
}

export interface TenantDataConfig {
  tenantId: string;
  regionId: string;
  encryptionEnabled: boolean;
  keyId: string;
  dataRetentionDays: number;
  allowedExportRegions: string[];
  piiMaskingEnabled: boolean;
}

interface StoredObject {
  id: string;
  tenantId: string;
  regionId: string;
  key: string;
  encrypted: boolean;
  size: number;
  createdAt: string;
  expiresAt?: string;
}

// ─── Available Regions ───

const REGIONS: DataRegion[] = [
  { id: "in-south", name: "India South (Mumbai)", location: "ap-south-1", storageEndpoint: "s3.ap-south-1.amazonaws.com", available: true, compliance: ["IT Act 2000", "DPDP 2023"] },
  { id: "in-central", name: "India Central (Hyderabad)", location: "ap-south-2", storageEndpoint: "s3.ap-south-2.amazonaws.com", available: true, compliance: ["IT Act 2000", "DPDP 2023"] },
  { id: "eu-west", name: "Europe (Frankfurt)", location: "eu-central-1", storageEndpoint: "s3.eu-central-1.amazonaws.com", available: true, compliance: ["GDPR", "SOC2"] },
  { id: "us-east", name: "US East (Virginia)", location: "us-east-1", storageEndpoint: "s3.us-east-1.amazonaws.com", available: true, compliance: ["SOC2", "HIPAA", "FedRAMP"] },
  { id: "us-west", name: "US West (Oregon)", location: "us-west-2", storageEndpoint: "s3.us-west-2.amazonaws.com", available: true, compliance: ["SOC2", "HIPAA"] },
  { id: "sg", name: "Singapore", location: "ap-southeast-1", storageEndpoint: "s3.ap-southeast-1.amazonaws.com", available: true, compliance: ["PDPA"] },
  { id: "local", name: "Local (On-Premise)", location: "local", storageEndpoint: "localhost", available: true, compliance: ["custom"] },
];

// ─── Data Residency Manager ───

export class DataResidencyManager {
  private keys: Map<string, EncryptionKey> = new Map();
  private tenantConfigs: Map<string, TenantDataConfig> = new Map();
  private objectIndex: Map<string, StoredObject> = new Map();
  private masterKey: Buffer;
  private keysDir: string;
  private dataRoot: string;

  constructor() {
    const masterKeyHex = process.env.MASTER_ENCRYPTION_KEY;
    this.masterKey = masterKeyHex
      ? Buffer.from(masterKeyHex, "hex")
      : crypto.randomBytes(32);

    this.keysDir = path.join(process.cwd(), ".keys");
    this.dataRoot = process.env.DATA_ROOT || path.join(process.cwd(), ".astra-data");

    if (!masterKeyHex) {
      logger.warn("[DataResidency] No MASTER_ENCRYPTION_KEY set — using random key (data won't survive restarts)");
    }
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.keysDir, { recursive: true });
    await fs.mkdir(this.dataRoot, { recursive: true });

    // Create region-specific storage directories
    for (const region of REGIONS.filter((r) => r.available)) {
      await fs.mkdir(path.join(this.dataRoot, region.id), { recursive: true });
    }

    logger.info(`[DataResidency] Initialized — ${REGIONS.filter((r) => r.available).length} regions, data root: ${this.dataRoot}`);
  }

  // ─── Region Management ───

  getRegions(): DataRegion[] {
    return REGIONS;
  }

  getRegion(id: string): DataRegion | undefined {
    return REGIONS.find((r) => r.id === id);
  }

  getRegionsForCompliance(standard: string): DataRegion[] {
    return REGIONS.filter((r) => r.compliance.includes(standard));
  }

  // ─── Tenant Data Configuration ───

  configureTenant(config: TenantDataConfig): TenantDataConfig {
    const region = this.getRegion(config.regionId);
    if (!region || !region.available) {
      throw new Error(`Region "${config.regionId}" is not available`);
    }

    if (config.encryptionEnabled && !this.keys.has(config.keyId)) {
      this.generateKey(config.tenantId);
      const keys = Array.from(this.keys.values()).filter((k) => k.tenantId === config.tenantId);
      if (keys.length > 0) config.keyId = keys[keys.length - 1].id;
    }

    this.tenantConfigs.set(config.tenantId, config);
    logger.info(`[DataResidency] Tenant ${config.tenantId} configured: region=${config.regionId}, encrypted=${config.encryptionEnabled}`);
    return config;
  }

  getTenantConfig(tenantId: string): TenantDataConfig | undefined {
    return this.tenantConfigs.get(tenantId);
  }

  // ─── Region-Routed Data Storage ───
  // Writes data to the correct region directory, with optional encryption.

  async storeData(tenantId: string, objectKey: string, data: string): Promise<StoredObject> {
    const config = this.tenantConfigs.get(tenantId);
    const regionId = config?.regionId || "local";
    const region = this.getRegion(regionId);
    if (!region) throw new Error(`Region "${regionId}" not found`);

    // Resolve storage path: dataRoot/region/tenant/key
    const tenantDir = path.join(this.dataRoot, regionId, tenantId);
    await fs.mkdir(tenantDir, { recursive: true });
    const filePath = path.join(tenantDir, this.sanitizeKey(objectKey));

    let dataToWrite = data;
    let encrypted = false;

    // Apply PII masking if enabled
    if (config?.piiMaskingEnabled) {
      dataToWrite = this.maskPII(dataToWrite);
    }

    // Encrypt if enabled
    if (config?.encryptionEnabled) {
      const encResult = this.encrypt(dataToWrite, tenantId);
      dataToWrite = JSON.stringify(encResult);
      encrypted = true;
    }

    await fs.writeFile(filePath, dataToWrite, "utf-8");

    const obj: StoredObject = {
      id: `obj_${crypto.randomBytes(8).toString("hex")}`,
      tenantId,
      regionId,
      key: objectKey,
      encrypted,
      size: Buffer.byteLength(dataToWrite),
      createdAt: new Date().toISOString(),
      expiresAt: config?.dataRetentionDays
        ? new Date(Date.now() + config.dataRetentionDays * 86400_000).toISOString()
        : undefined,
    };

    this.objectIndex.set(`${tenantId}:${objectKey}`, obj);
    logger.info(`[DataResidency] Stored ${objectKey} → region=${regionId}, encrypted=${encrypted}, size=${obj.size}`);
    return obj;
  }

  async retrieveData(tenantId: string, objectKey: string): Promise<string> {
    const config = this.tenantConfigs.get(tenantId);
    const regionId = config?.regionId || "local";

    const filePath = path.join(this.dataRoot, regionId, tenantId, this.sanitizeKey(objectKey));

    let data: string;
    try {
      data = await fs.readFile(filePath, "utf-8");
    } catch {
      throw new Error(`Object "${objectKey}" not found in region "${regionId}"`);
    }

    // Decrypt if encrypted
    if (config?.encryptionEnabled) {
      try {
        const encrypted = JSON.parse(data) as EncryptedData;
        data = this.decrypt(encrypted);
      } catch {
        // Data may not be encrypted (pre-encryption data)
      }
    }

    return data;
  }

  async deleteData(tenantId: string, objectKey: string): Promise<boolean> {
    const config = this.tenantConfigs.get(tenantId);
    const regionId = config?.regionId || "local";
    const filePath = path.join(this.dataRoot, regionId, tenantId, this.sanitizeKey(objectKey));

    try {
      await fs.unlink(filePath);
      this.objectIndex.delete(`${tenantId}:${objectKey}`);
      return true;
    } catch {
      return false;
    }
  }

  async listData(tenantId: string): Promise<StoredObject[]> {
    return Array.from(this.objectIndex.values()).filter((o) => o.tenantId === tenantId);
  }

  /**
   * Migrate data between regions — re-stores all tenant data in the new region.
   */
  async migrateData(tenantId: string, targetRegionId: string): Promise<{ migrated: number; errors: number }> {
    const config = this.tenantConfigs.get(tenantId);
    const sourceRegionId = config?.regionId || "local";

    if (sourceRegionId === targetRegionId) return { migrated: 0, errors: 0 };

    const exportCheck = this.canExportData(tenantId, targetRegionId);
    if (!exportCheck.allowed) throw new Error(exportCheck.reason || "Export not allowed");

    const sourceDir = path.join(this.dataRoot, sourceRegionId, tenantId);
    const targetDir = path.join(this.dataRoot, targetRegionId, tenantId);
    await fs.mkdir(targetDir, { recursive: true });

    let migrated = 0;
    let errors = 0;

    try {
      const files = await fs.readdir(sourceDir);
      for (const file of files) {
        try {
          const data = await fs.readFile(path.join(sourceDir, file), "utf-8");
          await fs.writeFile(path.join(targetDir, file), data, "utf-8");
          await fs.unlink(path.join(sourceDir, file));
          migrated++;
        } catch {
          errors++;
        }
      }
    } catch {
      // Source dir may not exist
    }

    // Update tenant config to new region
    if (config) {
      config.regionId = targetRegionId;
      this.tenantConfigs.set(tenantId, config);
    }

    logger.info(`[DataResidency] Migrated tenant ${tenantId}: ${sourceRegionId} → ${targetRegionId}, ${migrated} files, ${errors} errors`);
    return { migrated, errors };
  }

  /**
   * Enforce data retention — delete expired objects.
   */
  async enforceRetention(): Promise<number> {
    const now = Date.now();
    let deleted = 0;

    for (const [, obj] of this.objectIndex) {
      if (obj.expiresAt && new Date(obj.expiresAt).getTime() < now) {
        const ok = await this.deleteData(obj.tenantId, obj.key);
        if (ok) deleted++;
      }
    }

    if (deleted > 0) logger.info(`[DataResidency] Retention cleanup: deleted ${deleted} expired objects`);
    return deleted;
  }

  /**
   * Get storage statistics for a region.
   */
  async getRegionStats(regionId: string): Promise<{ objects: number; totalBytes: number; tenants: string[] }> {
    const objects = Array.from(this.objectIndex.values()).filter((o) => o.regionId === regionId);
    const totalBytes = objects.reduce((sum, o) => sum + o.size, 0);
    const tenants = [...new Set(objects.map((o) => o.tenantId))];
    return { objects: objects.length, totalBytes, tenants };
  }

  private sanitizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  // ─── Encryption ───

  generateKey(tenantId: string): EncryptionKey {
    const id = `key_${crypto.randomBytes(8).toString("hex")}`;
    const key: EncryptionKey = {
      id,
      tenantId,
      algorithm: "aes-256-gcm",
      key: crypto.randomBytes(32),
      iv: crypto.randomBytes(16),
      createdAt: new Date().toISOString(),
    };

    this.keys.set(id, key);
    logger.info(`[DataResidency] Encryption key generated: ${id} for tenant ${tenantId}`);
    return key;
  }

  rotateKey(tenantId: string): EncryptionKey {
    const existingKeys = Array.from(this.keys.values()).filter((k) => k.tenantId === tenantId);
    for (const key of existingKeys) {
      key.rotatedAt = new Date().toISOString();
    }
    const newKey = this.generateKey(tenantId);
    logger.info(`[DataResidency] Key rotated for tenant ${tenantId}: new key ${newKey.id}`);
    return newKey;
  }

  encrypt(data: string, tenantId: string): EncryptedData {
    const config = this.tenantConfigs.get(tenantId);
    if (!config?.encryptionEnabled) throw new Error("Encryption not enabled for this tenant");

    const key = this.keys.get(config.keyId);
    if (!key) throw new Error("Encryption key not found");

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key.key, iv);

    let ciphertext = cipher.update(data, "utf-8", "base64");
    ciphertext += cipher.final("base64");
    const authTag = cipher.getAuthTag();

    return {
      ciphertext,
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      keyId: key.id,
      algorithm: "aes-256-gcm",
    };
  }

  decrypt(encrypted: EncryptedData): string {
    const key = this.keys.get(encrypted.keyId);
    if (!key) throw new Error("Decryption key not found");

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key.key,
      Buffer.from(encrypted.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));

    let plaintext = decipher.update(encrypted.ciphertext, "base64", "utf-8");
    plaintext += decipher.final("utf-8");
    return plaintext;
  }

  // ─── PII Masking ───

  maskPII(text: string): string {
    text = text.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      (email) => {
        const [local, domain] = email.split("@");
        return `${local[0]}***@${domain}`;
      },
    );
    text = text.replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "***-***-****");
    text = text.replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "XXXX XXXX ****");
    text = text.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "XXXXX****X");
    return text;
  }

  // ─── Data Export Compliance Check ───

  canExportData(tenantId: string, targetRegion: string): { allowed: boolean; reason?: string } {
    const config = this.tenantConfigs.get(tenantId);
    if (!config) return { allowed: true };
    if (config.allowedExportRegions.includes("*")) return { allowed: true };
    if (config.allowedExportRegions.includes(targetRegion)) return { allowed: true };
    return {
      allowed: false,
      reason: `Data export to region "${targetRegion}" is not allowed. Permitted regions: ${config.allowedExportRegions.join(", ")}`,
    };
  }

  // ─── Express Router ───

  getRouter(): Router {
    const router = Router();

    router.get("/regions", (_req, res) => {
      res.json(this.getRegions());
    });

    router.get("/regions/:standard", (req, res) => {
      res.json(this.getRegionsForCompliance(req.params.standard));
    });

    router.get("/config/:tenantId", (req, res) => {
      const config = this.getTenantConfig(req.params.tenantId);
      if (!config) return res.status(404).json({ error: "No config found" });
      res.json(config);
    });

    router.post("/config", (req, res) => {
      try {
        const config = this.configureTenant(req.body);
        res.json(config);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    router.post("/keys/:tenantId/rotate", (req, res) => {
      try {
        const key = this.rotateKey(req.params.tenantId);
        res.json({ keyId: key.id, createdAt: key.createdAt });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    router.post("/encrypt", (req, res) => {
      try {
        const { data, tenantId } = req.body;
        const result = this.encrypt(data, tenantId);
        res.json(result);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    router.post("/check-export", (req, res) => {
      const { tenantId, targetRegion } = req.body;
      res.json(this.canExportData(tenantId, targetRegion));
    });

    // ─── Region-Routed Data Storage API ───

    router.post("/store", async (req, res) => {
      try {
        const { tenantId, key, data } = req.body;
        if (!tenantId || !key || !data) return res.status(400).json({ error: "tenantId, key, data required" });
        const obj = await this.storeData(tenantId, key, data);
        res.json(obj);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    router.get("/retrieve/:tenantId/:key", async (req, res) => {
      try {
        const data = await this.retrieveData(req.params.tenantId, req.params.key);
        res.json({ data });
      } catch (err) {
        res.status(404).json({ error: (err as Error).message });
      }
    });

    router.delete("/data/:tenantId/:key", async (req, res) => {
      const ok = await this.deleteData(req.params.tenantId, req.params.key);
      res.json({ success: ok });
    });

    router.get("/data/:tenantId", async (req, res) => {
      const objects = await this.listData(req.params.tenantId);
      res.json(objects);
    });

    router.post("/migrate", async (req, res) => {
      try {
        const { tenantId, targetRegionId } = req.body;
        const result = await this.migrateData(tenantId, targetRegionId);
        res.json(result);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    router.get("/stats/:regionId", async (req, res) => {
      const stats = await this.getRegionStats(req.params.regionId);
      res.json(stats);
    });

    return router;
  }
}
