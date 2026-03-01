/**
 * AstraOS — Knowledge Graph
 * SQLite-backed graph for entities, relationships, and community detection.
 * Implements the core of Microsoft's GraphRAG pattern.
 */

import Database from "better-sqlite3";
import * as path from "path";
import { logger } from "../../utils/logger";

export interface Entity {
  id: number;
  name: string;
  type: string;
  description: string;
  properties: Record<string, unknown>;
  mentionCount: number;
}

export interface Relationship {
  id: number;
  sourceId: number;
  targetId: number;
  type: string;
  description: string;
  weight: number;
}

export interface ExtractedData {
  entities: Array<{ name: string; type: string; description: string }>;
  relationships: Array<{ source: string; target: string; type: string; description: string }>;
}

// LLM extraction function type — injected by AgentLoop
export type EntityExtractorFn = (text: string) => Promise<ExtractedData>;

export class KnowledgeGraph {
  private db: Database.Database;
  private extractFn?: EntityExtractorFn;

  constructor(userId: string) {
    const baseDir = path.join(process.cwd(), ".astra-memory", userId);
    this.db = new Database(path.join(baseDir, "graph.db"));
    this.initDB();
  }

  setExtractor(fn: EntityExtractorFn): void {
    this.extractFn = fn;
  }

  private initDB(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        type TEXT NOT NULL,
        description TEXT DEFAULT '',
        properties TEXT DEFAULT '{}',
        mention_count INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES entities(id),
        target_id INTEGER NOT NULL REFERENCES entities(id),
        type TEXT NOT NULL,
        description TEXT DEFAULT '',
        weight REAL DEFAULT 1.0,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        UNIQUE(source_id, target_id, type)
      );

      CREATE TABLE IF NOT EXISTS communities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id INTEGER NOT NULL REFERENCES entities(id),
        community_id INTEGER NOT NULL,
        level INTEGER DEFAULT 0,
        UNIQUE(entity_id, level)
      );

      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);
      CREATE INDEX IF NOT EXISTS idx_communities_id ON communities(community_id);
    `);
  }

  async extractAndStore(text: string): Promise<void> {
    if (!this.extractFn) return;

    try {
      const extracted = await this.extractFn(text);

      // Upsert entities
      const entityIds = new Map<string, number>();
      for (const entity of extracted.entities) {
        const id = this.upsertEntity(entity.name, entity.type, entity.description);
        entityIds.set(entity.name.toLowerCase(), id);
      }

      // Upsert relationships
      for (const rel of extracted.relationships) {
        const sourceId = entityIds.get(rel.source.toLowerCase());
        const targetId = entityIds.get(rel.target.toLowerCase());
        if (sourceId && targetId) {
          this.upsertRelationship(sourceId, targetId, rel.type, rel.description);
        }
      }
    } catch (err) {
      logger.warn(`[GraphRAG] Entity extraction failed: ${(err as Error).message}`);
    }
  }

  private upsertEntity(name: string, type: string, description: string): number {
    const existing = this.db.prepare("SELECT id, mention_count FROM entities WHERE name = ?").get(name) as { id: number; mention_count: number } | undefined;

    if (existing) {
      this.db.prepare("UPDATE entities SET mention_count = ?, description = CASE WHEN length(?) > length(description) THEN ? ELSE description END, updated_at = strftime('%s','now') WHERE id = ?")
        .run(existing.mention_count + 1, description, description, existing.id);
      return existing.id;
    }

    const result = this.db.prepare("INSERT INTO entities(name, type, description) VALUES (?, ?, ?)").run(name, type, description);
    return Number(result.lastInsertRowid);
  }

  private upsertRelationship(sourceId: number, targetId: number, type: string, description: string): void {
    const existing = this.db.prepare("SELECT id, weight FROM relationships WHERE source_id = ? AND target_id = ? AND type = ?").get(sourceId, targetId, type) as { id: number; weight: number } | undefined;

    if (existing) {
      this.db.prepare("UPDATE relationships SET weight = ?, description = ? WHERE id = ?")
        .run(existing.weight + 1, description, existing.id);
    } else {
      this.db.prepare("INSERT INTO relationships(source_id, target_id, type, description) VALUES (?, ?, ?, ?)")
        .run(sourceId, targetId, type, description);
    }
  }

  async search(query: string, topK: number): Promise<string[]> {
    const results: string[] = [];
    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

    // Find matching entities by name
    for (const word of queryWords) {
      const entities = this.db.prepare("SELECT id, name, type, description, mention_count FROM entities WHERE name LIKE ? ORDER BY mention_count DESC LIMIT ?")
        .all(`%${word}%`, topK) as Entity[];

      for (const entity of entities) {
        // Get entity's relationships
        const rels = this.db.prepare(`
          SELECT r.type, r.description, r.weight, e.name as target_name
          FROM relationships r
          JOIN entities e ON r.target_id = e.id
          WHERE r.source_id = ?
          UNION ALL
          SELECT r.type, r.description, r.weight, e.name as target_name
          FROM relationships r
          JOIN entities e ON r.source_id = e.id
          WHERE r.target_id = ?
          ORDER BY weight DESC
          LIMIT 5
        `).all(entity.id, entity.id) as Array<{ type: string; description: string; weight: number; target_name: string }>;

        let summary = `${entity.name} (${entity.type}): ${entity.description}`;
        if (rels.length > 0) {
          summary += " | Relations: " + rels.map((r) => `${r.type} → ${r.target_name}`).join(", ");
        }
        results.push(summary);
      }
    }

    return [...new Set(results)].slice(0, topK);
  }

  // Louvain-inspired community detection (simplified)
  detectCommunities(): Map<number, number[]> {
    const entities = this.db.prepare("SELECT id FROM entities").all() as Array<{ id: number }>;
    const relationships = this.db.prepare("SELECT source_id, target_id, weight FROM relationships").all() as Array<{ source_id: number; target_id: number; weight: number }>;

    // Build adjacency list
    const adj = new Map<number, Map<number, number>>();
    for (const entity of entities) adj.set(entity.id, new Map());
    for (const rel of relationships) {
      adj.get(rel.source_id)?.set(rel.target_id, rel.weight);
      adj.get(rel.target_id)?.set(rel.source_id, rel.weight);
    }

    // Assign initial communities (each node is its own community)
    const community = new Map<number, number>();
    for (const entity of entities) community.set(entity.id, entity.id);

    // Iterative community merge based on neighbor majority
    for (let iter = 0; iter < 10; iter++) {
      let changed = false;
      for (const entity of entities) {
        const neighbors = adj.get(entity.id) || new Map();
        const commVotes = new Map<number, number>();
        for (const [neighborId, weight] of neighbors) {
          const nComm = community.get(neighborId) || neighborId;
          commVotes.set(nComm, (commVotes.get(nComm) || 0) + weight);
        }
        if (commVotes.size > 0) {
          const bestComm = [...commVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];
          if (bestComm !== community.get(entity.id)) {
            community.set(entity.id, bestComm);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }

    // Group entities by community
    const communities = new Map<number, number[]>();
    for (const [entityId, commId] of community) {
      if (!communities.has(commId)) communities.set(commId, []);
      communities.get(commId)!.push(entityId);
    }

    // Persist to database
    this.db.prepare("DELETE FROM communities").run();
    const insertComm = this.db.prepare("INSERT OR REPLACE INTO communities(entity_id, community_id, level) VALUES (?, ?, 0)");
    for (const [commId, entityIds] of communities) {
      for (const entityId of entityIds) {
        insertComm.run(entityId, commId);
      }
    }

    return communities;
  }

  getStats(): { entities: number; relationships: number; communities: number } {
    const entities = (this.db.prepare("SELECT COUNT(*) as c FROM entities").get() as { c: number }).c;
    const relationships = (this.db.prepare("SELECT COUNT(*) as c FROM relationships").get() as { c: number }).c;
    const communities = (this.db.prepare("SELECT COUNT(DISTINCT community_id) as c FROM communities").get() as { c: number }).c;
    return { entities, relationships, communities };
  }
}
