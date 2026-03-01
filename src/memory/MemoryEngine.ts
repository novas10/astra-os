/**
 * AstraOS — MemoryEngine.ts
 * Three-tier hybrid memory: JSONL episodic + SQLite FTS5 + Real Vector Embeddings + GraphRAG
 */

import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { createEmbeddingProvider, cosineSimilarity, type EmbeddingProvider } from "./EmbeddingProvider";
import type { KnowledgeGraph } from "./graph/KnowledgeGraph";

interface EpisodicEntry {
  type: string;
  [key: string]: unknown;
  timestamp: number;
}

interface LongTermEntry {
  content: string;
  tags: string[];
  importance: string;
  timestamp: number;
}

interface SearchOptions {
  mode: "semantic" | "keyword" | "hybrid";
  topK: number;
}

interface VectorRow {
  id: number;
  content: string;
  importance: string;
  embedding: Buffer;
}

// ─── IVF (Inverted File) Index for sub-linear vector search ───
// Clusters vectors into partitions; at query time searches only nearest clusters.

interface IVFCluster {
  centroid: number[];
  memberIds: number[];
}

class IVFIndex {
  private clusters: IVFCluster[] = [];
  private nClusters: number;
  private nProbe: number; // number of clusters to search at query time

  constructor(nClusters = 16, nProbe = 4) {
    this.nClusters = nClusters;
    this.nProbe = nProbe;
  }

  build(vectors: Array<{ id: number; vector: number[] }>): void {
    if (vectors.length === 0) return;
    const k = Math.min(this.nClusters, vectors.length);

    // K-means++ initialization
    const centroids: number[][] = [];
    centroids.push([...vectors[Math.floor(Math.random() * vectors.length)].vector]);

    for (let c = 1; c < k; c++) {
      const distances = vectors.map((v) => {
        const minDist = centroids.reduce((min, cent) => Math.min(min, this.euclidean(v.vector, cent)), Infinity);
        return minDist * minDist;
      });
      const totalDist = distances.reduce((a, b) => a + b, 0);
      let r = Math.random() * totalDist;
      let idx = 0;
      for (let i = 0; i < distances.length; i++) {
        r -= distances[i];
        if (r <= 0) { idx = i; break; }
      }
      centroids.push([...vectors[idx].vector]);
    }

    // K-means iterations (max 20)
    const assignments = new Array(vectors.length).fill(0);
    for (let iter = 0; iter < 20; iter++) {
      let changed = false;

      // Assign each vector to nearest centroid
      for (let i = 0; i < vectors.length; i++) {
        let bestCluster = 0;
        let bestDist = Infinity;
        for (let c = 0; c < centroids.length; c++) {
          const d = this.euclidean(vectors[i].vector, centroids[c]);
          if (d < bestDist) { bestDist = d; bestCluster = c; }
        }
        if (assignments[i] !== bestCluster) { changed = true; assignments[i] = bestCluster; }
      }

      if (!changed) break;

      // Recompute centroids
      const dims = vectors[0].vector.length;
      for (let c = 0; c < centroids.length; c++) {
        const members = vectors.filter((_, i) => assignments[i] === c);
        if (members.length === 0) continue;
        for (let d = 0; d < dims; d++) {
          centroids[c][d] = members.reduce((sum, v) => sum + v.vector[d], 0) / members.length;
        }
      }
    }

    // Build clusters
    this.clusters = centroids.map((centroid, c) => ({
      centroid,
      memberIds: vectors.filter((_, i) => assignments[i] === c).map((v) => v.id),
    }));
  }

  search(queryVector: number[]): Set<number> {
    if (this.clusters.length === 0) return new Set();

    // Find nearest clusters
    const clusterDists = this.clusters.map((c, idx) => ({
      idx,
      dist: this.euclidean(queryVector, c.centroid),
    })).sort((a, b) => a.dist - b.dist);

    // Return member IDs from top-nProbe clusters
    const candidateIds = new Set<number>();
    for (let i = 0; i < Math.min(this.nProbe, clusterDists.length); i++) {
      for (const id of this.clusters[clusterDists[i].idx].memberIds) {
        candidateIds.add(id);
      }
    }
    return candidateIds;
  }

  get isBuilt(): boolean {
    return this.clusters.length > 0;
  }

  private euclidean(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }
}

export class MemoryEngine {
  private userId: string;
  private episodicPath: string;
  private memoryMdPath: string;
  private db: Database.Database;
  private embedder: EmbeddingProvider | null;
  private graph?: KnowledgeGraph;
  private ivfIndex: IVFIndex;
  private ivfDirty = true; // rebuild IVF on next search

  constructor(userId: string) {
    this.userId = userId;
    const baseDir = path.join(process.cwd(), ".astra-memory", userId);
    this.episodicPath = path.join(baseDir, "episodic.jsonl");
    this.memoryMdPath = path.join(baseDir, "MEMORY.md");

    fsSync.mkdirSync(baseDir, { recursive: true });
    this.db = new Database(path.join(baseDir, "fts5.db"));
    this.embedder = createEmbeddingProvider();
    this.ivfIndex = new IVFIndex(16, 4);
    this.initDB();
  }

  setGraphEngine(graph: KnowledgeGraph): void {
    this.graph = graph;
  }

  private initDB(): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content, tags, importance, timestamp UNINDEXED,
        tokenize='porter ascii'
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        tags TEXT,
        importance TEXT,
        timestamp INTEGER,
        embedding BLOB,
        dimensions INTEGER DEFAULT 0
      );
    `);
  }

  async appendEpisodic(entry: EpisodicEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.episodicPath), { recursive: true });
    const line = JSON.stringify({ ...entry, userId: this.userId }) + "\n";
    await fs.appendFile(this.episodicPath, line, "utf-8");
  }

  async readEpisodic(lastN?: number): Promise<EpisodicEntry[]> {
    try {
      const content = await fs.readFile(this.episodicPath, "utf-8");
      const entries = content.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as EpisodicEntry);
      return lastN ? entries.slice(-lastN) : entries;
    } catch {
      return [];
    }
  }

  async saveLongTerm(entry: LongTermEntry): Promise<void> {
    await this.appendToMemoryMd(entry);

    // FTS5 index
    const insertFts = this.db.prepare("INSERT INTO memory_fts(content, tags, importance, timestamp) VALUES (?, ?, ?, ?)");
    insertFts.run(entry.content, entry.tags.join(","), entry.importance, entry.timestamp);

    // Real vector embedding
    await this.storeEmbedding(entry);

    // GraphRAG entity extraction (async, non-blocking)
    if (this.graph) {
      this.graph.extractAndStore(entry.content).catch(() => {});
    }
  }

  async hybridSearch(query: string, options: SearchOptions): Promise<string> {
    const ftsResults: Array<{ content: string; score: number }> = [];
    const vectorResults: Array<{ content: string; score: number }> = [];
    const graphResults: Array<{ content: string; score: number }> = [];

    // FTS5 keyword search
    if (options.mode === "keyword" || options.mode === "hybrid") {
      try {
        const stmt = this.db.prepare(`SELECT content, importance, rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`);
        const rows = stmt.all(query, options.topK * 2) as Array<{ content: string; importance: string; rank: number }>;
        for (const row of rows) {
          ftsResults.push({ content: `[${row.importance.toUpperCase()}] ${row.content}`, score: -row.rank });
        }
      } catch { /* FTS5 query may fail on special chars */ }
    }

    // Real vector search
    if (options.mode === "semantic" || options.mode === "hybrid") {
      const vecRes = await this.vectorSearch(query, options.topK * 2);
      vectorResults.push(...vecRes);
    }

    // Graph search
    if (this.graph && options.mode === "hybrid") {
      try {
        const graphRes = await this.graph.search(query, options.topK);
        graphResults.push(...graphRes.map((r) => ({ content: `[GRAPH] ${r}`, score: 0.5 })));
      } catch { /* graph search is optional */ }
    }

    // Reciprocal Rank Fusion (RRF) to merge results from all sources
    const merged = this.reciprocalRankFusion([ftsResults, vectorResults, graphResults], options.topK);
    return merged.join("\n\n") || "";
  }

  private reciprocalRankFusion(
    resultSets: Array<Array<{ content: string; score: number }>>,
    topK: number,
    k = 60,
  ): string[] {
    const scores = new Map<string, number>();

    for (const results of resultSets) {
      const sorted = [...results].sort((a, b) => b.score - a.score);
      for (let rank = 0; rank < sorted.length; rank++) {
        const content = sorted[rank].content;
        const rrfScore = 1 / (k + rank + 1);
        scores.set(content, (scores.get(content) || 0) + rrfScore);
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([content]) => content);
  }

  private async appendToMemoryMd(entry: LongTermEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.memoryMdPath), { recursive: true });
    const timestamp = new Date(entry.timestamp).toISOString();
    const section = `\n## [${entry.importance.toUpperCase()}] ${timestamp}\n**Tags:** ${entry.tags.join(", ")}\n${entry.content}\n---`;
    await fs.appendFile(this.memoryMdPath, section, "utf-8");
  }

  private async storeEmbedding(entry: LongTermEntry): Promise<void> {
    if (!this.embedder) {
      const insert = this.db.prepare("INSERT INTO memory_vectors(content, tags, importance, timestamp, embedding, dimensions) VALUES (?, ?, ?, ?, ?, ?)");
      insert.run(entry.content, entry.tags.join(","), entry.importance, entry.timestamp, null, 0);
      return;
    }

    try {
      const { vector, dimensions } = await this.embedder.embed(entry.content);
      const buffer = Buffer.from(new Float32Array(vector).buffer);
      const insert = this.db.prepare("INSERT INTO memory_vectors(content, tags, importance, timestamp, embedding, dimensions) VALUES (?, ?, ?, ?, ?, ?)");
      insert.run(entry.content, entry.tags.join(","), entry.importance, entry.timestamp, buffer, dimensions);
      this.ivfDirty = true; // rebuild index on next search
    } catch {
      const insert = this.db.prepare("INSERT INTO memory_vectors(content, tags, importance, timestamp, embedding, dimensions) VALUES (?, ?, ?, ?, ?, ?)");
      insert.run(entry.content, entry.tags.join(","), entry.importance, entry.timestamp, null, 0);
    }
  }

  private async vectorSearch(query: string, topK: number): Promise<Array<{ content: string; score: number }>> {
    if (!this.embedder) return [];

    try {
      const { vector: queryVector } = await this.embedder.embed(query);

      const allRows = this.db.prepare("SELECT id, content, importance, embedding FROM memory_vectors WHERE embedding IS NOT NULL AND dimensions > 0").all() as VectorRow[];
      if (allRows.length === 0) return [];

      // Build IVF index if needed (only when >64 vectors, otherwise brute-force is faster)
      let searchRows = allRows;
      if (allRows.length > 64) {
        if (this.ivfDirty || !this.ivfIndex.isBuilt) {
          const vectors = allRows.map((row) => ({
            id: row.id,
            vector: Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)),
          }));
          this.ivfIndex.build(vectors);
          this.ivfDirty = false;
        }

        // Search only nearest clusters
        const candidateIds = this.ivfIndex.search(queryVector);
        searchRows = allRows.filter((row) => candidateIds.has(row.id));
      }

      const scored = searchRows.map((row) => {
        const storedVector = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
        const score = cosineSimilarity(queryVector, storedVector);
        return { content: `[VECTOR:${score.toFixed(3)}] ${row.content}`, score };
      });

      return scored.sort((a, b) => b.score - a.score).slice(0, topK);
    } catch {
      return [];
    }
  }

  async getMemoryStats(): Promise<{ episodicCount: number; longTermCount: number; vectorCount: number; embeddingProvider: string }> {
    const episodic = await this.readEpisodic();
    const longTermCount = (this.db.prepare("SELECT COUNT(*) as c FROM memory_fts").get() as { c: number }).c;
    const vectorCount = (this.db.prepare("SELECT COUNT(*) as c FROM memory_vectors WHERE embedding IS NOT NULL AND dimensions > 0").get() as { c: number }).c;
    return {
      episodicCount: episodic.length,
      longTermCount,
      vectorCount,
      embeddingProvider: this.embedder?.name || "none",
    };
  }
}
