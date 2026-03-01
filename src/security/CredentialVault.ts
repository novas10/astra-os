/**
 * AstraOS — CredentialVault.ts
 * Encrypted credential storage — solves OpenClaw's plaintext credential vulnerability.
 * All API keys, tokens, and secrets are encrypted at rest using AES-256-GCM.
 * Never stores credentials in plaintext. Supports key rotation, access audit, and auto-expiry.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CredentialMetadata {
  owner?: string;
  scope?: string;
  expiresAt?: string; // ISO-8601
  [key: string]: unknown;
}

interface EncryptedEntry {
  name: string;
  encryptedValue: string; // hex-encoded ciphertext
  iv: string;             // hex-encoded IV
  salt: string;           // hex-encoded salt
  authTag: string;        // hex-encoded GCM auth tag
  metadata: CredentialMetadata;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

interface AuditRecord {
  timestamp: string;
  action: "store" | "retrieve" | "delete" | "rotate" | "export" | "import";
  credential: string;
  requesterId: string | null;
  success: boolean;
  detail?: string;
}

interface VaultData {
  version: number;
  entries: Record<string, EncryptedEntry>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;          // 128-bit IV for GCM
const SALT_LENGTH = 32;        // 256-bit salt
const KEY_LENGTH = 32;         // 256-bit key
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = "sha512";
const VAULT_DIR_NAME = ".astra-vault";
const VAULT_FILE_NAME = "credentials.enc";
const AUDIT_FILE_NAME = "access-log.jsonl";

// ---------------------------------------------------------------------------
// CredentialVault
// ---------------------------------------------------------------------------

export class CredentialVault {
  private vaultDir: string;
  private vaultPath: string;
  private auditPath: string;
  private masterKey: string;
  private vault: VaultData;
  private initialized: boolean;

  constructor(baseDir?: string) {
    const root = baseDir ?? process.cwd();
    this.vaultDir = path.join(root, VAULT_DIR_NAME);
    this.vaultPath = path.join(this.vaultDir, VAULT_FILE_NAME);
    this.auditPath = path.join(this.vaultDir, AUDIT_FILE_NAME);
    this.vault = { version: 1, entries: {} };
    this.initialized = false;

    // Master key: prefer env var, otherwise auto-generate and warn loudly.
    const envKey = process.env.MASTER_ENCRYPTION_KEY;
    if (envKey && envKey.length > 0) {
      this.masterKey = envKey;
    } else {
      this.masterKey = crypto.randomBytes(32).toString("hex");
      logger.warn(
        "CredentialVault: MASTER_ENCRYPTION_KEY not set — auto-generated an ephemeral key. " +
          "Credentials will NOT survive restarts. Set MASTER_ENCRYPTION_KEY in production."
      );
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Create vault directory and load any existing vault from disk. */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!fs.existsSync(this.vaultDir)) {
        fs.mkdirSync(this.vaultDir, { recursive: true });
        logger.info(`CredentialVault: Created vault directory at ${this.vaultDir}`);
      }

      if (fs.existsSync(this.vaultPath)) {
        const raw = fs.readFileSync(this.vaultPath, "utf-8");
        const parsed = JSON.parse(raw) as VaultData;
        if (parsed && typeof parsed.version === "number" && parsed.entries) {
          this.vault = parsed;
          const count = Object.keys(this.vault.entries).length;
          logger.info(`CredentialVault: Loaded vault with ${count} credential(s)`);
        } else {
          logger.warn("CredentialVault: Vault file is malformed — starting fresh");
        }
      } else {
        logger.info("CredentialVault: No existing vault found — starting fresh");
      }

      this.initialized = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`CredentialVault: Failed to initialize — ${message}`);
      throw new Error(`Vault initialization failed: ${message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Encryption helpers
  // -----------------------------------------------------------------------

  private deriveKey(salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(
      this.masterKey,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      PBKDF2_DIGEST
    );
  }

  private encrypt(plaintext: string): { ciphertext: string; iv: string; salt: string; authTag: string } {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = this.deriveKey(salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: encrypted,
      iv: iv.toString("hex"),
      salt: salt.toString("hex"),
      authTag: authTag.toString("hex"),
    };
  }

  private decrypt(ciphertext: string, ivHex: string, saltHex: string, authTagHex: string): string {
    const salt = Buffer.from(saltHex, "hex");
    const key = this.deriveKey(salt);
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  // -----------------------------------------------------------------------
  // Persistence helpers
  // -----------------------------------------------------------------------

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("CredentialVault: Not initialized — call initialize() first");
    }
  }

  private save(): void {
    fs.writeFileSync(this.vaultPath, JSON.stringify(this.vault, null, 2), "utf-8");
  }

  private appendAudit(record: AuditRecord): void {
    try {
      fs.appendFileSync(this.auditPath, JSON.stringify(record) + "\n", "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`CredentialVault: Failed to write audit log — ${message}`);
    }
  }

  private createAuditRecord(
    action: AuditRecord["action"],
    credential: string,
    requesterId: string | null,
    success: boolean,
    detail?: string
  ): AuditRecord {
    return {
      timestamp: new Date().toISOString(),
      action,
      credential,
      requesterId: requesterId ?? null,
      success,
      detail,
    };
  }

  // -----------------------------------------------------------------------
  // Core methods
  // -----------------------------------------------------------------------

  /**
   * Encrypt and store a credential.
   * Metadata can include owner, scope, expiresAt, and arbitrary key/values.
   */
  async store(
    name: string,
    value: string,
    metadata?: CredentialMetadata,
    requesterId?: string
  ): Promise<void> {
    this.ensureInitialized();

    if (!name || typeof name !== "string") {
      throw new Error("Credential name must be a non-empty string");
    }
    if (!value || typeof value !== "string") {
      throw new Error("Credential value must be a non-empty string");
    }

    try {
      const { ciphertext, iv, salt, authTag } = this.encrypt(value);
      const now = new Date().toISOString();
      const expiresAt = metadata?.expiresAt ?? null;

      const entry: EncryptedEntry = {
        name,
        encryptedValue: ciphertext,
        iv,
        salt,
        authTag,
        metadata: metadata ?? {},
        createdAt: now,
        updatedAt: now,
        expiresAt,
      };

      this.vault.entries[name] = entry;
      this.save();

      this.appendAudit(this.createAuditRecord("store", name, requesterId ?? null, true));
      logger.info(`CredentialVault: Stored credential "${name}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.appendAudit(this.createAuditRecord("store", name, requesterId ?? null, false, message));
      logger.error(`CredentialVault: Failed to store "${name}" — ${message}`);
      throw new Error(`Failed to store credential "${name}": ${message}`);
    }
  }

  /**
   * Decrypt and return a credential value.
   * Logs access. Throws if credential has expired or does not exist.
   */
  async retrieve(name: string, requesterId?: string): Promise<string> {
    this.ensureInitialized();

    const entry = this.vault.entries[name];
    if (!entry) {
      this.appendAudit(
        this.createAuditRecord("retrieve", name, requesterId ?? null, false, "Not found")
      );
      throw new Error(`Credential "${name}" not found`);
    }

    // Check expiry
    if (entry.expiresAt) {
      const expiry = new Date(entry.expiresAt);
      if (expiry.getTime() <= Date.now()) {
        this.appendAudit(
          this.createAuditRecord(
            "retrieve",
            name,
            requesterId ?? null,
            false,
            `Credential expired at ${entry.expiresAt}`
          )
        );
        throw new Error(
          `Credential "${name}" expired at ${entry.expiresAt}. ` +
            "Rotate or delete it before use."
        );
      }
    }

    try {
      const value = this.decrypt(
        entry.encryptedValue,
        entry.iv,
        entry.salt,
        entry.authTag
      );

      this.appendAudit(this.createAuditRecord("retrieve", name, requesterId ?? null, true));
      logger.info(`CredentialVault: Retrieved credential "${name}" by ${requesterId ?? "unknown"}`);
      return value;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.appendAudit(
        this.createAuditRecord("retrieve", name, requesterId ?? null, false, message)
      );
      logger.error(`CredentialVault: Failed to decrypt "${name}" — ${message}`);
      throw new Error(`Failed to retrieve credential "${name}": ${message}`);
    }
  }

  /** Remove a credential from the vault. */
  async delete(name: string, requesterId?: string): Promise<void> {
    this.ensureInitialized();

    if (!this.vault.entries[name]) {
      this.appendAudit(
        this.createAuditRecord("delete", name, requesterId ?? null, false, "Not found")
      );
      throw new Error(`Credential "${name}" not found`);
    }

    delete this.vault.entries[name];
    this.save();

    this.appendAudit(this.createAuditRecord("delete", name, requesterId ?? null, true));
    logger.info(`CredentialVault: Deleted credential "${name}"`);
  }

  /** Update a credential's value. Preserves metadata. Logs the rotation event. */
  async rotate(name: string, newValue: string, requesterId?: string): Promise<void> {
    this.ensureInitialized();

    const entry = this.vault.entries[name];
    if (!entry) {
      this.appendAudit(
        this.createAuditRecord("rotate", name, requesterId ?? null, false, "Not found")
      );
      throw new Error(`Credential "${name}" not found — cannot rotate`);
    }

    if (!newValue || typeof newValue !== "string") {
      throw new Error("New credential value must be a non-empty string");
    }

    try {
      const { ciphertext, iv, salt, authTag } = this.encrypt(newValue);

      entry.encryptedValue = ciphertext;
      entry.iv = iv;
      entry.salt = salt;
      entry.authTag = authTag;
      entry.updatedAt = new Date().toISOString();

      this.save();

      this.appendAudit(this.createAuditRecord("rotate", name, requesterId ?? null, true));
      logger.info(`CredentialVault: Rotated credential "${name}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.appendAudit(
        this.createAuditRecord("rotate", name, requesterId ?? null, false, message)
      );
      logger.error(`CredentialVault: Failed to rotate "${name}" — ${message}`);
      throw new Error(`Failed to rotate credential "${name}": ${message}`);
    }
  }

  /**
   * List credential names and metadata — never values.
   * Returns an array of safe-to-display summaries.
   */
  async list(): Promise<
    Array<{
      name: string;
      metadata: CredentialMetadata;
      createdAt: string;
      updatedAt: string;
      expiresAt: string | null;
      expired: boolean;
    }>
  > {
    this.ensureInitialized();

    return Object.values(this.vault.entries).map((entry) => {
      const expired = entry.expiresAt
        ? new Date(entry.expiresAt).getTime() <= Date.now()
        : false;

      return {
        name: entry.name,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        expiresAt: entry.expiresAt,
        expired,
      };
    });
  }

  /**
   * Return access audit log entries.
   * If a credential name is given, filter to that credential only.
   */
  async audit(name?: string): Promise<AuditRecord[]> {
    this.ensureInitialized();

    if (!fs.existsSync(this.auditPath)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(this.auditPath, "utf-8");
      const lines = raw.split("\n").filter((line) => line.trim().length > 0);

      const records: AuditRecord[] = lines.map((line) => {
        try {
          return JSON.parse(line) as AuditRecord;
        } catch {
          return null;
        }
      }).filter((r): r is AuditRecord => r !== null);

      if (name) {
        return records.filter((r) => r.credential === name);
      }

      return records;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`CredentialVault: Failed to read audit log — ${message}`);
      return [];
    }
  }

  /**
   * Export all credentials in their encrypted form (suitable for backup).
   * The export payload can be re-imported only with the same master key.
   */
  async exportEncrypted(requesterId?: string): Promise<string> {
    this.ensureInitialized();

    const exportPayload = {
      version: this.vault.version,
      exportedAt: new Date().toISOString(),
      entries: this.vault.entries,
    };

    // Encrypt the entire payload with a fresh envelope for transport
    const serialized = JSON.stringify(exportPayload);
    const { ciphertext, iv, salt, authTag } = this.encrypt(serialized);

    const envelope = JSON.stringify({
      format: "astra-vault-export-v1",
      ciphertext,
      iv,
      salt,
      authTag,
    });

    this.appendAudit(
      this.createAuditRecord("export", "*", requesterId ?? null, true, `${Object.keys(this.vault.entries).length} credential(s)`)
    );
    logger.info("CredentialVault: Exported encrypted vault backup");

    return envelope;
  }

  /**
   * Import an encrypted backup. Merges into the current vault.
   * Requires the correct master key used during export.
   */
  async importEncrypted(data: string, masterKey: string, requesterId?: string): Promise<number> {
    this.ensureInitialized();

    // Temporarily use the provided master key for decryption
    const originalKey = this.masterKey;

    try {
      const envelope = JSON.parse(data);
      if (envelope.format !== "astra-vault-export-v1") {
        throw new Error("Invalid export format — expected astra-vault-export-v1");
      }

      this.masterKey = masterKey;
      const decryptedPayload = this.decrypt(
        envelope.ciphertext,
        envelope.iv,
        envelope.salt,
        envelope.authTag
      );
      this.masterKey = originalKey;

      const importedData = JSON.parse(decryptedPayload) as {
        version: number;
        entries: Record<string, EncryptedEntry>;
      };

      // Re-encrypt each entry under the current master key
      let importedCount = 0;
      for (const [name, entry] of Object.entries(importedData.entries)) {
        // Decrypt with the import key
        this.masterKey = masterKey;
        const plaintext = this.decrypt(
          entry.encryptedValue,
          entry.iv,
          entry.salt,
          entry.authTag
        );
        this.masterKey = originalKey;

        // Re-encrypt with our current master key
        const { ciphertext, iv, salt, authTag } = this.encrypt(plaintext);

        this.vault.entries[name] = {
          ...entry,
          encryptedValue: ciphertext,
          iv,
          salt,
          authTag,
          updatedAt: new Date().toISOString(),
        };
        importedCount++;
      }

      this.save();

      this.appendAudit(
        this.createAuditRecord("import", "*", requesterId ?? null, true, `${importedCount} credential(s)`)
      );
      logger.info(`CredentialVault: Imported ${importedCount} credential(s) from encrypted backup`);

      return importedCount;
    } catch (err) {
      // Always restore the original master key
      this.masterKey = originalKey;

      const message = err instanceof Error ? err.message : String(err);
      this.appendAudit(
        this.createAuditRecord("import", "*", requesterId ?? null, false, message)
      );
      logger.error(`CredentialVault: Import failed — ${message}`);
      throw new Error(`Vault import failed: ${message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Express Router
  // -----------------------------------------------------------------------

  /** Returns an Express router exposing the vault via REST endpoints. */
  getRouter(): Router {
    const router = Router();

    // GET / — list credentials (names + metadata only, never values)
    router.get("/", async (_req: Request, res: Response) => {
      try {
        const credentials = await this.list();
        res.json({ success: true, credentials });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`CredentialVault API [GET /]: ${message}`);
        res.status(500).json({ success: false, error: message });
      }
    });

    // GET /audit — access audit log (placed before /:name to avoid collision)
    router.get("/audit", async (req: Request, res: Response) => {
      try {
        const name = typeof req.query.name === "string" ? req.query.name : undefined;
        const records = await this.audit(name);
        res.json({ success: true, records });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`CredentialVault API [GET /audit]: ${message}`);
        res.status(500).json({ success: false, error: message });
      }
    });

    // POST / — store new credential
    router.post("/", async (req: Request, res: Response) => {
      try {
        const { name, value, metadata } = req.body ?? {};
        if (!name || !value) {
          res.status(400).json({
            success: false,
            error: "Missing required fields: name, value",
          });
          return;
        }

        const requesterId = (req.headers["x-requester-id"] as string) ?? null;
        await this.store(name, value, metadata, requesterId ?? undefined);
        res.status(201).json({ success: true, message: `Credential "${name}" stored` });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`CredentialVault API [POST /]: ${message}`);
        res.status(500).json({ success: false, error: message });
      }
    });

    // POST /export — export encrypted backup
    router.post("/export", async (req: Request, res: Response) => {
      try {
        const requesterId = (req.headers["x-requester-id"] as string) ?? null;
        const exported = await this.exportEncrypted(requesterId ?? undefined);
        res.json({ success: true, data: exported });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`CredentialVault API [POST /export]: ${message}`);
        res.status(500).json({ success: false, error: message });
      }
    });

    // POST /import — import encrypted backup
    router.post("/import", async (req: Request, res: Response) => {
      try {
        const { data, masterKey } = req.body ?? {};
        if (!data || !masterKey) {
          res.status(400).json({
            success: false,
            error: "Missing required fields: data, masterKey",
          });
          return;
        }

        const requesterId = (req.headers["x-requester-id"] as string) ?? null;
        const count = await this.importEncrypted(data, masterKey, requesterId ?? undefined);
        res.json({ success: true, message: `Imported ${count} credential(s)` });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`CredentialVault API [POST /import]: ${message}`);
        res.status(500).json({ success: false, error: message });
      }
    });

    // GET /:name — retrieve decrypted credential
    router.get("/:name", async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        const requesterId = (req.headers["x-requester-id"] as string) ?? null;
        const value = await this.retrieve(name, requesterId ?? undefined);
        res.json({ success: true, name, value });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes("not found") ? 404 : message.includes("expired") ? 410 : 500;
        logger.error(`CredentialVault API [GET /${req.params.name}]: ${message}`);
        res.status(status).json({ success: false, error: message });
      }
    });

    // DELETE /:name — delete credential
    router.delete("/:name", async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        const requesterId = (req.headers["x-requester-id"] as string) ?? null;
        await this.delete(name, requesterId ?? undefined);
        res.json({ success: true, message: `Credential "${name}" deleted` });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes("not found") ? 404 : 500;
        logger.error(`CredentialVault API [DELETE /${req.params.name}]: ${message}`);
        res.status(status).json({ success: false, error: message });
      }
    });

    // POST /:name/rotate — rotate credential
    router.post("/:name/rotate", async (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        const { newValue } = req.body ?? {};
        if (!newValue) {
          res.status(400).json({
            success: false,
            error: "Missing required field: newValue",
          });
          return;
        }

        const requesterId = (req.headers["x-requester-id"] as string) ?? null;
        await this.rotate(name, newValue, requesterId ?? undefined);
        res.json({ success: true, message: `Credential "${name}" rotated` });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes("not found") ? 404 : 500;
        logger.error(`CredentialVault API [POST /${req.params.name}/rotate]: ${message}`);
        res.status(status).json({ success: false, error: message });
      }
    });

    return router;
  }
}

// ---------------------------------------------------------------------------
// Singleton & default export
// ---------------------------------------------------------------------------

/** Default singleton vault instance. */
export const credentialVault = new CredentialVault();

export default CredentialVault;
