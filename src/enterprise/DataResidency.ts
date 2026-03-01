/**
 * AstraOS — Data Residency
 * Region-specific data storage, encryption at rest, data isolation, and compliance controls.
 */

import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger";

// ─── Types ───

export interface DataRegion {
  id: string;
  name: string;
  location: string;
  storageEndpoint: string;
  available: boolean;
  compliance: string[];       // e.g., ["GDPR", "SOC2", "HIPAA"]
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
  ciphertext: string;          // base64
  iv: string;                  // base64
  authTag: string;             // base64 (GCM only)
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
  private masterKey: Buffer;
  private keysDir: string;

  constructor() {
    // Master key from environment (in production, use KMS)
    const masterKeyHex = process.env.MASTER_ENCRYPTION_KEY;
    this.masterKey = masterKeyHex
      ? Buffer.from(masterKeyHex, "hex")
      : crypto.randomBytes(32);

    this.keysDir = path.join(process.cwd(), ".keys");

    if (!masterKeyHex) {
      logger.warn("[DataResidency] No MASTER_ENCRYPTION_KEY set — using random key (data won't survive restarts)");
    }
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.keysDir, { recursive: true });
    logger.info(`[DataResidency] Initialized — ${REGIONS.filter((r) => r.available).length} regions available`);
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

    // Generate encryption key if enabled
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
    if (!config?.encryptionEnabled) {
      throw new Error("Encryption not enabled for this tenant");
    }

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
    // Email masking
    text = text.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      (email) => {
        const [local, domain] = email.split("@");
        return `${local[0]}***@${domain}`;
      },
    );

    // Phone number masking (Indian + international)
    text = text.replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "***-***-****");

    // Aadhaar masking (12 digits)
    text = text.replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "XXXX XXXX ****");

    // PAN masking (Indian)
    text = text.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "XXXXX****X");

    return text;
  }

  // ─── Data Export Compliance Check ───

  canExportData(tenantId: string, targetRegion: string): { allowed: boolean; reason?: string } {
    const config = this.tenantConfigs.get(tenantId);
    if (!config) return { allowed: true }; // No restrictions if not configured

    if (config.allowedExportRegions.includes("*")) return { allowed: true };
    if (config.allowedExportRegions.includes(targetRegion)) return { allowed: true };

    return {
      allowed: false,
      reason: `Data export to region "${targetRegion}" is not allowed. Permitted regions: ${config.allowedExportRegions.join(", ")}`,
    };
  }

  // ─── Express Router ───

  getRouter(): import("express").Router {
    const { Router } = require("express") as typeof import("express");
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

    return router;
  }
}
