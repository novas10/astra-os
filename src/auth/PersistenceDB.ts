/**
 * AstraOS — Persistence Layer
 * SQLite-backed persistence for RBAC users and Tenants.
 * Replaces in-memory Maps with durable storage that survives restarts.
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { logger } from "../utils/logger";
import { runMigrations } from "./migrations";

const DB_PATH = process.env.ASTRA_DB_PATH || path.join(process.cwd(), ".astra-data", "astra.db");

let _db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (!_db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL"); // better concurrent read performance
    _db.pragma("foreign_keys = ON");
    runMigrations(_db);
    logger.info(`[Persistence] SQLite database opened: ${DB_PATH}`);
  }
  return _db;
}

// ─── User Persistence Helpers ───

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string;
  api_key: string | null;
  created_at: string;
  last_login: string | null;
  active: number;
}

export function loadAllUsers(db: Database.Database): UserRow[] {
  return db.prepare("SELECT * FROM users").all() as UserRow[];
}

export function upsertUser(db: Database.Database, user: UserRow): void {
  db.prepare(`
    INSERT INTO users (id, email, name, role, tenant_id, api_key, created_at, last_login, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      role = excluded.role,
      tenant_id = excluded.tenant_id,
      api_key = excluded.api_key,
      last_login = excluded.last_login,
      active = excluded.active
  `).run(user.id, user.email, user.name, user.role, user.tenant_id, user.api_key, user.created_at, user.last_login, user.active);
}

export function deleteUserRow(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

// ─── Tenant Persistence Helpers ───

export interface TenantRow {
  id: string;
  name: string;
  plan: string;
  owner_id: string;
  created_at: string;
  active: number;
  settings: string;
  usage: string;
}

export function loadAllTenants(db: Database.Database): TenantRow[] {
  return db.prepare("SELECT * FROM tenants").all() as TenantRow[];
}

export function upsertTenant(db: Database.Database, tenant: TenantRow): void {
  db.prepare(`
    INSERT INTO tenants (id, name, plan, owner_id, created_at, active, settings, usage)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      plan = excluded.plan,
      owner_id = excluded.owner_id,
      active = excluded.active,
      settings = excluded.settings,
      usage = excluded.usage
  `).run(tenant.id, tenant.name, tenant.plan, tenant.owner_id, tenant.created_at, tenant.active, tenant.settings, tenant.usage);
}

export function deleteTenantRow(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM tenants WHERE id = ?").run(id);
}

export function loadTenantApiKeys(db: Database.Database): Array<{ api_key: string; tenant_id: string }> {
  return db.prepare("SELECT * FROM tenant_api_keys").all() as Array<{ api_key: string; tenant_id: string }>;
}

export function insertTenantApiKey(db: Database.Database, apiKey: string, tenantId: string): void {
  db.prepare("INSERT OR REPLACE INTO tenant_api_keys (api_key, tenant_id) VALUES (?, ?)").run(apiKey, tenantId);
}

export function deleteTenantApiKey(db: Database.Database, apiKey: string): void {
  db.prepare("DELETE FROM tenant_api_keys WHERE api_key = ?").run(apiKey);
}
