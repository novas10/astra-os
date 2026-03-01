/**
 * AstraOS — MemoryEngine unit tests
 * Tests episodic JSONL, long-term FTS5, vector storage, and hybrid search.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// Mock logger
vi.mock("../utils/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock embedding provider to avoid external API calls
vi.mock("../memory/EmbeddingProvider", () => ({
  createEmbeddingProvider: vi.fn(() => null), // no embedder = skip vector search
  cosineSimilarity: vi.fn((a: number[], b: number[]) => {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }),
}));

import { MemoryEngine } from "../memory/MemoryEngine";

let tempDir: string;
let memory: MemoryEngine;

beforeEach(async () => {
  tempDir = path.join(os.tmpdir(), `astra-mem-test-${Date.now()}`);
  // Pre-create the full directory structure that MemoryEngine expects
  // (its constructor calls fs.mkdir async but opens SQLite sync)
  await fs.mkdir(path.join(tempDir, ".astra-memory", "test-user"), { recursive: true });
  const originalCwd = process.cwd;
  process.cwd = () => tempDir;
  memory = new MemoryEngine("test-user");
  process.cwd = originalCwd;
});

afterEach(async () => {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch { /* cleanup best-effort */ }
});

describe("MemoryEngine", () => {
  // ─── Episodic Memory ───

  describe("Episodic (JSONL)", () => {
    it("appends and reads episodic entries", async () => {
      await memory.appendEpisodic({ type: "tool_call", tool: "read_file", timestamp: 1000 });
      await memory.appendEpisodic({ type: "tool_call", tool: "write_file", timestamp: 2000 });

      const entries = await memory.readEpisodic();
      expect(entries).toHaveLength(2);
      expect(entries[0].tool).toBe("read_file");
      expect(entries[1].tool).toBe("write_file");
    });

    it("reads last N entries", async () => {
      for (let i = 0; i < 10; i++) {
        await memory.appendEpisodic({ type: "msg", i, timestamp: i * 1000 });
      }
      const last3 = await memory.readEpisodic(3);
      expect(last3).toHaveLength(3);
      expect(last3[0].i).toBe(7);
    });

    it("returns empty array when no episodic file", async () => {
      const entries = await memory.readEpisodic();
      expect(entries).toEqual([]);
    });
  });

  // ─── Long-Term FTS5 ───

  describe("Long-Term (FTS5 + Vector)", () => {
    it("saves and searches long-term entries via FTS5", async () => {
      await memory.saveLongTerm({
        content: "React components should use hooks for state management",
        tags: ["react", "hooks", "frontend"],
        importance: "high",
        timestamp: Date.now(),
      });

      await memory.saveLongTerm({
        content: "Docker containers need proper health checks",
        tags: ["docker", "devops"],
        importance: "medium",
        timestamp: Date.now(),
      });

      const result = await memory.hybridSearch("react hooks", { mode: "keyword", topK: 5 });
      expect(result).toContain("React components");
    });

    it("FTS5 returns empty for unmatched query", async () => {
      await memory.saveLongTerm({
        content: "Python Flask web framework basics",
        tags: ["python"],
        importance: "low",
        timestamp: Date.now(),
      });

      const result = await memory.hybridSearch("kubernetes deployment", { mode: "keyword", topK: 5 });
      expect(result).toBe("");
    });

    it("stores multiple entries and retrieves ranked results", async () => {
      const entries = [
        { content: "JavaScript async await patterns", tags: ["js"], importance: "high", timestamp: 1000 },
        { content: "TypeScript generic types advanced usage", tags: ["ts"], importance: "medium", timestamp: 2000 },
        { content: "JavaScript promise chaining best practices", tags: ["js"], importance: "high", timestamp: 3000 },
      ];

      for (const entry of entries) {
        await memory.saveLongTerm(entry);
      }

      const result = await memory.hybridSearch("JavaScript", { mode: "keyword", topK: 5 });
      expect(result).toContain("JavaScript");
    });
  });

  // ─── Memory Stats ───

  describe("getMemoryStats()", () => {
    it("returns correct counts", async () => {
      await memory.appendEpisodic({ type: "test", timestamp: 1000 });
      await memory.appendEpisodic({ type: "test", timestamp: 2000 });

      await memory.saveLongTerm({
        content: "Test memory entry",
        tags: ["test"],
        importance: "low",
        timestamp: Date.now(),
      });

      const stats = await memory.getMemoryStats();
      expect(stats.episodicCount).toBe(2);
      expect(stats.longTermCount).toBe(1);
      expect(stats.embeddingProvider).toBe("none");
    });
  });

  // ─── Hybrid Search ───

  describe("hybridSearch()", () => {
    it("handles hybrid mode without embedder gracefully", async () => {
      await memory.saveLongTerm({
        content: "Git branching strategies for teams",
        tags: ["git"],
        importance: "medium",
        timestamp: Date.now(),
      });

      // Hybrid mode with no embedder should still return FTS5 results
      const result = await memory.hybridSearch("Git branching", { mode: "hybrid", topK: 5 });
      expect(result).toContain("Git branching");
    });
  });
});
