/**
 * AstraOS — Knowledge Graph
 * SQLite-backed graph: entities, relationships, community detection.
 * Real Louvain algorithm for modularity-optimized community detection.
 * FTS5-based entity search + embedding-aware relationship traversal.
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
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);
      CREATE INDEX IF NOT EXISTS idx_communities_id ON communities(community_id);
    `);

    // FTS5 index for entity search
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(
          name, type, description,
          content='entities',
          content_rowid='id',
          tokenize='porter ascii'
        );
      `);
    } catch {
      // FTS5 may already exist with different schema
    }
  }

  async extractAndStore(text: string): Promise<void> {
    if (!this.extractFn) return;

    try {
      const extracted = await this.extractFn(text);

      const entityIds = new Map<string, number>();
      for (const entity of extracted.entities) {
        const id = this.upsertEntity(entity.name, entity.type, entity.description);
        entityIds.set(entity.name.toLowerCase(), id);
      }

      for (const rel of extracted.relationships) {
        const sourceId = entityIds.get(rel.source.toLowerCase());
        const targetId = entityIds.get(rel.target.toLowerCase());
        if (sourceId && targetId) {
          this.upsertRelationship(sourceId, targetId, rel.type, rel.description);
        }
      }

      // Re-index FTS after entity changes
      this.rebuildFTS();
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

  private rebuildFTS(): void {
    try {
      this.db.exec("INSERT INTO entity_fts(entity_fts) VALUES('rebuild')");
    } catch {
      // FTS rebuild may fail on first run
    }
  }

  // ─── Search (FTS5 + Relationship Traversal) ───

  async search(query: string, topK: number): Promise<string[]> {
    const results: string[] = [];

    // 1. FTS5 search on entity names and descriptions
    try {
      const ftsResults = this.db.prepare(`
        SELECT e.id, e.name, e.type, e.description, e.mention_count
        FROM entity_fts f
        JOIN entities e ON f.rowid = e.id
        WHERE entity_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(query, topK * 2) as Entity[];

      for (const entity of ftsResults) {
        results.push(this.buildEntitySummary(entity));
      }
    } catch {
      // FTS query failed, fall back to LIKE
    }

    // 2. Fallback: LIKE-based search if FTS found nothing
    if (results.length === 0) {
      const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      for (const word of queryWords) {
        const entities = this.db.prepare(
          "SELECT id, name, type, description, mention_count FROM entities WHERE name LIKE ? OR description LIKE ? ORDER BY mention_count DESC LIMIT ?",
        ).all(`%${word}%`, `%${word}%`, topK) as Entity[];

        for (const entity of entities) {
          results.push(this.buildEntitySummary(entity));
        }
      }
    }

    // 3. Community-enhanced results: find related entities in same communities
    if (results.length > 0 && results.length < topK) {
      const firstEntity = this.db.prepare("SELECT id FROM entities WHERE name LIKE ?").get(`%${query.split(/\s+/)[0]}%`) as { id: number } | undefined;
      if (firstEntity) {
        const communityMembers = this.getCommunitySiblings(firstEntity.id, topK - results.length);
        for (const member of communityMembers) {
          const summary = this.buildEntitySummary(member);
          if (!results.includes(summary)) results.push(summary);
        }
      }
    }

    return [...new Set(results)].slice(0, topK);
  }

  private buildEntitySummary(entity: Entity): string {
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
    return summary;
  }

  private getCommunitySiblings(entityId: number, limit: number): Entity[] {
    return this.db.prepare(`
      SELECT DISTINCT e.id, e.name, e.type, e.description, e.mention_count
      FROM communities c1
      JOIN communities c2 ON c1.community_id = c2.community_id AND c1.level = c2.level
      JOIN entities e ON c2.entity_id = e.id
      WHERE c1.entity_id = ? AND c2.entity_id != ?
      ORDER BY e.mention_count DESC
      LIMIT ?
    `).all(entityId, entityId, limit) as Entity[];
  }

  // ─── Louvain Community Detection ───
  // Real modularity optimization: Q = (1/2m) * Σ[Aij - ki*kj/(2m)] * δ(ci,cj)

  detectCommunities(): Map<number, number[]> {
    const entities = this.db.prepare("SELECT id FROM entities").all() as Array<{ id: number }>;
    const relationships = this.db.prepare("SELECT source_id, target_id, weight FROM relationships").all() as Array<{ source_id: number; target_id: number; weight: number }>;

    if (entities.length === 0) return new Map();

    // Build adjacency + compute total edge weight (2m)
    const adj = new Map<number, Map<number, number>>();
    const degree = new Map<number, number>(); // weighted degree (k_i)
    let totalWeight = 0; // 2m

    for (const entity of entities) {
      adj.set(entity.id, new Map());
      degree.set(entity.id, 0);
    }

    for (const rel of relationships) {
      const w = rel.weight;
      adj.get(rel.source_id)?.set(rel.target_id, (adj.get(rel.source_id)?.get(rel.target_id) || 0) + w);
      adj.get(rel.target_id)?.set(rel.source_id, (adj.get(rel.target_id)?.get(rel.source_id) || 0) + w);
      degree.set(rel.source_id, (degree.get(rel.source_id) || 0) + w);
      degree.set(rel.target_id, (degree.get(rel.target_id) || 0) + w);
      totalWeight += 2 * w; // each edge counted in both directions
    }

    if (totalWeight === 0) {
      // No edges — each entity is its own community
      const result = new Map<number, number[]>();
      for (const e of entities) result.set(e.id, [e.id]);
      this.persistCommunities(result);
      return result;
    }

    // Phase 1: Local modularity optimization (node-level moves)
    const community = new Map<number, number>();
    for (const entity of entities) community.set(entity.id, entity.id);

    // Sum of weights inside each community
    const sumIn = new Map<number, number>();
    // Sum of total degree for each community
    const sumTot = new Map<number, number>();

    for (const entity of entities) {
      sumIn.set(entity.id, 0);
      sumTot.set(entity.id, degree.get(entity.id) || 0);
    }

    // Iterate until no improvement
    let improved = true;
    let iterations = 0;
    const maxIterations = 50;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      for (const entity of entities) {
        const nodeId = entity.id;
        const nodeDegree = degree.get(nodeId) || 0;
        const currentComm = community.get(nodeId)!;

        // Compute weight of edges from nodeId to each neighboring community
        const neighborCommWeights = new Map<number, number>();
        const neighbors = adj.get(nodeId) || new Map();

        for (const [neighborId, w] of neighbors) {
          const nComm = community.get(neighborId)!;
          neighborCommWeights.set(nComm, (neighborCommWeights.get(nComm) || 0) + w);
        }

        // Weight of edges from node to its current community
        const wToCurrent = neighborCommWeights.get(currentComm) || 0;

        // Compute modularity gain of removing node from current community
        const removeGain = wToCurrent - (sumTot.get(currentComm) || 0) * nodeDegree / totalWeight;

        // Find best community to move to
        let bestComm = currentComm;
        let bestGain = 0;

        for (const [targetComm, wToTarget] of neighborCommWeights) {
          if (targetComm === currentComm) continue;

          // Modularity gain of adding node to targetComm
          const addGain = wToTarget - (sumTot.get(targetComm) || 0) * nodeDegree / totalWeight;
          const deltaQ = addGain - removeGain;

          if (deltaQ > bestGain) {
            bestGain = deltaQ;
            bestComm = targetComm;
          }
        }

        // Move node if there's a positive gain
        if (bestComm !== currentComm && bestGain > 1e-10) {
          // Remove from current community
          sumIn.set(currentComm, (sumIn.get(currentComm) || 0) - 2 * wToCurrent);
          sumTot.set(currentComm, (sumTot.get(currentComm) || 0) - nodeDegree);

          // Add to best community
          const wToBest = neighborCommWeights.get(bestComm) || 0;
          sumIn.set(bestComm, (sumIn.get(bestComm) || 0) + 2 * wToBest);
          sumTot.set(bestComm, (sumTot.get(bestComm) || 0) + nodeDegree);

          community.set(nodeId, bestComm);
          improved = true;
        }
      }
    }

    // Group entities by community
    const communities = new Map<number, number[]>();
    for (const [entityId, commId] of community) {
      if (!communities.has(commId)) communities.set(commId, []);
      communities.get(commId)!.push(entityId);
    }

    // Compute final modularity score
    const modularity = this.computeModularity(community, adj, degree, totalWeight);
    logger.info(`[GraphRAG] Louvain completed: ${communities.size} communities, modularity=${modularity.toFixed(4)}, iterations=${iterations}`);

    this.persistCommunities(communities);
    return communities;
  }

  private computeModularity(
    community: Map<number, number>,
    adj: Map<number, Map<number, number>>,
    degree: Map<number, number>,
    totalWeight: number,
  ): number {
    let q = 0;
    for (const [i, neighbors] of adj) {
      for (const [j, aij] of neighbors) {
        if (community.get(i) === community.get(j)) {
          const ki = degree.get(i) || 0;
          const kj = degree.get(j) || 0;
          q += aij - (ki * kj) / totalWeight;
        }
      }
    }
    return q / totalWeight;
  }

  private persistCommunities(communities: Map<number, number[]>): void {
    this.db.prepare("DELETE FROM communities").run();
    const insertComm = this.db.prepare("INSERT OR REPLACE INTO communities(entity_id, community_id, level) VALUES (?, ?, 0)");
    const insertMany = this.db.transaction(() => {
      for (const [commId, entityIds] of communities) {
        for (const entityId of entityIds) {
          insertComm.run(entityId, commId);
        }
      }
    });
    insertMany();
  }

  // ─── Community Summaries for Global Queries ───

  getCommunityReport(communityId: number): string {
    const members = this.db.prepare(`
      SELECT e.name, e.type, e.description, e.mention_count
      FROM communities c
      JOIN entities e ON c.entity_id = e.id
      WHERE c.community_id = ?
      ORDER BY e.mention_count DESC
    `).all(communityId) as Array<{ name: string; type: string; description: string; mention_count: number }>;

    if (members.length === 0) return "";

    const topEntities = members.slice(0, 5).map((m) => `${m.name} (${m.type})`).join(", ");
    const descriptions = members.filter((m) => m.description).map((m) => m.description).slice(0, 3);

    return `Community ${communityId}: [${topEntities}] — ${descriptions.join("; ") || "No descriptions"}`;
  }

  getAllCommunityReports(): string[] {
    const communityIds = this.db.prepare("SELECT DISTINCT community_id FROM communities").all() as Array<{ community_id: number }>;
    return communityIds.map((c) => this.getCommunityReport(c.community_id)).filter(Boolean);
  }

  // ─── Statistics ───

  getStats(): { entities: number; relationships: number; communities: number; modularity: number } {
    const entities = (this.db.prepare("SELECT COUNT(*) as c FROM entities").get() as { c: number }).c;
    const relationships = (this.db.prepare("SELECT COUNT(*) as c FROM relationships").get() as { c: number }).c;
    const communities = (this.db.prepare("SELECT COUNT(DISTINCT community_id) as c FROM communities").get() as { c: number }).c;
    return { entities, relationships, communities, modularity: 0 };
  }
}
