/**
 * AstraOS — Database Migration Framework
 * Tracks schema versions and applies migrations sequentially.
 * Each migration runs inside a transaction for atomicity.
 */

import type Database from "better-sqlite3";
import { logger } from "../utils/logger";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/**
 * All migrations in order. Append new migrations at the end — never modify existing ones.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          tenant_id TEXT NOT NULL DEFAULT 'default',
          api_key TEXT,
          created_at TEXT NOT NULL,
          last_login TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          UNIQUE(email)
        );

        CREATE TABLE IF NOT EXISTS tenants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          plan TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          settings TEXT NOT NULL DEFAULT '{}',
          usage TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS tenant_api_keys (
          api_key TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
        CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON tenant_api_keys(tenant_id);
      `);
    },
  },
  // ── Add future migrations below ──
  // {
  //   version: 2,
  //   name: "add_user_avatar",
  //   up: (db) => {
  //     db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");
  //   },
  // },
];

/**
 * Run all pending migrations. Safe to call on every startup.
 */
export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    (db.prepare("SELECT version FROM _migrations").all() as Array<{ version: number }>)
      .map((r) => r.version)
  );

  const pending = migrations.filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    logger.debug("[Migrations] Schema is up to date");
    return;
  }

  for (const migration of pending) {
    logger.info(`[Migrations] Applying v${migration.version}: ${migration.name}`);
    const txn = db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        new Date().toISOString()
      );
    });
    txn();
    logger.info(`[Migrations] v${migration.version} applied successfully`);
  }

  logger.info(`[Migrations] ${pending.length} migration(s) applied. Current version: ${pending[pending.length - 1].version}`);
}
