/**
 * AstraOS — MarketplaceServer unit tests
 * Tests search, categories, collections, stats, and skill installation logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger
vi.mock("../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  },
}));

import * as mockFsPromises from "fs/promises";
import { MarketplaceServer } from "../marketplace/MarketplaceServer";

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Creates a mock Express-like request object */
function mockReq(overrides: Record<string, any> = {}): any {
  return {
    query: {},
    params: {},
    body: {},
    headers: {},
    ...overrides,
  };
}

/** Creates a mock Express-like response object */
function mockRes(): any {
  const res: any = {
    _status: 200,
    _body: undefined as any,
    statusCode: 200,
    status(code: number) {
      res._status = code;
      res.statusCode = code;
      return res;
    },
    json(body: any) {
      res._body = body;
      return res;
    },
    send(body: any) {
      res._body = body;
      return res;
    },
  };
  return res;
}

// ═══════════════════════════════════════════════════════════════════════════
// MarketplaceServer tests
// ═══════════════════════════════════════════════════════════════════════════

describe("MarketplaceServer", () => {
  let marketplace: MarketplaceServer;

  beforeEach(() => {
    vi.clearAllMocks();
    // readFile fails (no registry)
    mockFsPromises.readFile.mockRejectedValue(new Error("ENOENT"));
    mockFsPromises.readdir.mockResolvedValue([]);

    marketplace = new MarketplaceServer("/fake/skills");
  });

  afterEach(() => {
    delete process.env.ASTRA_HUB_URL;
  });

  // ─── Initialize ────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("should create the skills directory on initialization", async () => {
      await marketplace.initialize();
      expect(mockFsPromises.mkdir).toHaveBeenCalledWith("/fake/skills", { recursive: true });
    });

    it("should load installed skills from local directories", async () => {
      mockFsPromises.readdir.mockResolvedValueOnce([
        { name: "my-skill", isDirectory: () => true },
        { name: ".registry.json", isDirectory: () => false },
      ]);
      // access succeeds for SKILL.md
      mockFsPromises.access.mockResolvedValue(undefined);

      await marketplace.initialize();

      const installed = marketplace.getInstalledSkills();
      expect(installed).toHaveLength(1);
      expect(installed[0].skillId).toBe("my-skill");
      expect(installed[0].name).toBe("my-skill");
    });
  });

  // ─── getStats ──────────────────────────────────────────────────────────

  describe("getStats()", () => {
    it("should return correct stat counts", async () => {
      mockFsPromises.readdir.mockResolvedValueOnce([
        { name: "skill-a", isDirectory: () => true },
        { name: "skill-b", isDirectory: () => true },
      ]);
      mockFsPromises.access.mockResolvedValue(undefined);

      await marketplace.initialize();

      const stats = marketplace.getStats();
      expect(stats.installed).toBe(2);
      expect(stats.categories).toBe(20);
      expect(stats.collections).toBe(6);
    });

    it("should return zero installed when no skills exist", async () => {
      mockFsPromises.readdir.mockResolvedValueOnce([]);
      await marketplace.initialize();

      const stats = marketplace.getStats();
      expect(stats.installed).toBe(0);
    });
  });

  // ─── Categories endpoint ───────────────────────────────────────────────

  describe("Categories endpoint", () => {
    it("should return 20 predefined categories via the router handler", async () => {
      await marketplace.initialize();

      const router = marketplace.getRouter();
      // Find the categories route handler
      const categoriesRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/categories" && layer.route?.methods?.get
      );

      expect(categoriesRoute).toBeDefined();

      // Call the handler directly
      const req = mockReq();
      const res = mockRes();
      const handler = categoriesRoute!.route.stack[0].handle;
      handler(req, res);

      expect(res._body).toBeInstanceOf(Array);
      expect(res._body.length).toBe(20);

      // Verify each category has required fields
      for (const cat of res._body) {
        expect(cat).toHaveProperty("id");
        expect(cat).toHaveProperty("name");
        expect(cat).toHaveProperty("icon");
        expect(cat).toHaveProperty("description");
      }

      // Verify specific categories exist
      const ids = res._body.map((c: any) => c.id);
      expect(ids).toContain("productivity");
      expect(ids).toContain("devtools");
      expect(ids).toContain("security");
      expect(ids).toContain("ai");
      expect(ids).toContain("finance");
      expect(ids).toContain("other");
    });
  });

  // ─── Collections endpoint ──────────────────────────────────────────────

  describe("Collections endpoint", () => {
    it("should return 6 curated collections via the router handler", async () => {
      await marketplace.initialize();

      const router = marketplace.getRouter();
      const collectionsRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/collections" && layer.route?.methods?.get
      );

      expect(collectionsRoute).toBeDefined();

      const req = mockReq();
      const res = mockRes();
      collectionsRoute!.route.stack[0].handle(req, res);

      expect(res._body).toBeInstanceOf(Array);
      expect(res._body.length).toBe(6);

      // Each collection should have id, name, description, skills array
      for (const col of res._body) {
        expect(col).toHaveProperty("id");
        expect(col).toHaveProperty("name");
        expect(col).toHaveProperty("description");
        expect(col.skills).toBeInstanceOf(Array);
        expect(col.skills.length).toBeGreaterThan(0);
      }

      // Verify specific collections
      const ids = res._body.map((c: any) => c.id);
      expect(ids).toContain("starter-pack");
      expect(ids).toContain("developer-essentials");
      expect(ids).toContain("data-toolkit");
      expect(ids).toContain("security-hardened");
      expect(ids).toContain("solopreneur");
    });

    it("starter-pack should contain expected skills", async () => {
      await marketplace.initialize();

      const router = marketplace.getRouter();
      const collectionsRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/collections" && layer.route?.methods?.get
      );

      const req = mockReq();
      const res = mockRes();
      collectionsRoute!.route.stack[0].handle(req, res);

      const starterPack = res._body.find((c: any) => c.id === "starter-pack");
      expect(starterPack).toBeDefined();
      expect(starterPack.skills).toContain("email-assistant");
      expect(starterPack.skills).toContain("calendar-manager");
      expect(starterPack.skills).toContain("web-scraper");
    });
  });

  // ─── Stats endpoint ────────────────────────────────────────────────────

  describe("Stats endpoint", () => {
    it("should return fallback stats when remote is unavailable", async () => {
      // Mock global fetch to fail
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      await marketplace.initialize();

      const router = marketplace.getRouter();
      const statsRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/stats" && layer.route?.methods?.get
      );

      expect(statsRoute).toBeDefined();

      const req = mockReq();
      const res = mockRes();
      await statsRoute!.route.stack[0].handle(req, res);

      expect(res._body).toHaveProperty("totalSkills");
      expect(res._body).toHaveProperty("localInstalled");
      expect(res._body).toHaveProperty("categories", 20);
      expect(res._body).toHaveProperty("collections", 6);

      globalThis.fetch = originalFetch;
    });
  });

  // ─── Search endpoint ───────────────────────────────────────────────────

  describe("Search endpoint", () => {
    it("should fall back to local search when remote fails", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      await marketplace.initialize();

      const router = marketplace.getRouter();
      const searchRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/search" && layer.route?.methods?.get
      );

      expect(searchRoute).toBeDefined();

      const req = mockReq({ query: { q: "test" } });
      const res = mockRes();
      await searchRoute!.route.stack[0].handle(req, res);

      expect(res._body).toHaveProperty("skills");
      expect(res._body).toHaveProperty("total");
      expect(res._body).toHaveProperty("hasMore", false);

      globalThis.fetch = originalFetch;
    });
  });

  // ─── Installed skills ──────────────────────────────────────────────────

  describe("Installed skills endpoint", () => {
    it("should return list of installed skills via router", async () => {
      mockFsPromises.readdir.mockResolvedValueOnce([
        { name: "skill-x", isDirectory: () => true },
      ]);
      mockFsPromises.access.mockResolvedValue(undefined);

      await marketplace.initialize();

      const router = marketplace.getRouter();
      const installedRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/installed" && layer.route?.methods?.get
      );

      expect(installedRoute).toBeDefined();

      const req = mockReq();
      const res = mockRes();
      installedRoute!.route.stack[0].handle(req, res);

      expect(res._body).toBeInstanceOf(Array);
      expect(res._body.length).toBe(1);
      expect(res._body[0].skillId).toBe("skill-x");
    });
  });

  // ─── Badge endpoint ────────────────────────────────────────────────────

  describe("Badge endpoint", () => {
    it("should return badge data for installed skill", async () => {
      mockFsPromises.readdir.mockResolvedValueOnce([
        { name: "my-skill", isDirectory: () => true },
      ]);
      mockFsPromises.access.mockResolvedValue(undefined);

      await marketplace.initialize();

      const router = marketplace.getRouter();
      const badgeRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/skills/:id/badge" && layer.route?.methods?.get
      );

      expect(badgeRoute).toBeDefined();

      const req = mockReq({ params: { id: "my-skill" } });
      const res = mockRes();
      badgeRoute!.route.stack[0].handle(req, res);

      expect(res._body).toHaveProperty("schemaVersion", 1);
      expect(res._body).toHaveProperty("label", "AstraHub");
      expect(res._body).toHaveProperty("namedLogo", "astra");
    });

    it("should return 'available' for non-installed skill", async () => {
      await marketplace.initialize();

      const router = marketplace.getRouter();
      const badgeRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/skills/:id/badge" && layer.route?.methods?.get
      );

      const req = mockReq({ params: { id: "unknown-skill" } });
      const res = mockRes();
      badgeRoute!.route.stack[0].handle(req, res);

      expect(res._body.message).toBe("available");
      expect(res._body.color).toBe("blue");
    });
  });

  // ─── Rating validation ─────────────────────────────────────────────────

  describe("Rating endpoint validation", () => {
    it("should reject rating outside 1-5 range", async () => {
      await marketplace.initialize();

      const router = marketplace.getRouter();
      const rateRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/skills/:id/rate" && layer.route?.methods?.post
      );

      expect(rateRoute).toBeDefined();

      const req = mockReq({
        params: { id: "skill-1" },
        body: { rating: 6, comment: "Great!" },
      });
      const res = mockRes();
      await rateRoute!.route.stack[0].handle(req, res);

      expect(res._status).toBe(400);
      expect(res._body.error).toContain("Rating must be 1-5");
    });

    it("should reject rating of 0", async () => {
      await marketplace.initialize();

      const router = marketplace.getRouter();
      const rateRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/skills/:id/rate" && layer.route?.methods?.post
      );

      const req = mockReq({
        params: { id: "skill-1" },
        body: { rating: 0 },
      });
      const res = mockRes();
      await rateRoute!.route.stack[0].handle(req, res);

      expect(res._status).toBe(400);
    });

    it("should accept valid rating and return success", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("No network"));

      await marketplace.initialize();

      const router = marketplace.getRouter();
      const rateRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/skills/:id/rate" && layer.route?.methods?.post
      );

      const req = mockReq({
        params: { id: "skill-1" },
        body: { rating: 4, comment: "Good skill", userId: "user1", userName: "Test User" },
      });
      const res = mockRes();
      await rateRoute!.route.stack[0].handle(req, res);

      expect(res._body.success).toBe(true);
      expect(res._body.review).toBeDefined();
      expect(res._body.review.rating).toBe(4);
      expect(res._body.review.skillId).toBe("skill-1");

      globalThis.fetch = originalFetch;
    });
  });

  // ─── Publish validation ────────────────────────────────────────────────

  describe("Publish endpoint validation", () => {
    it("should reject publish without name and files", async () => {
      await marketplace.initialize();

      const router = marketplace.getRouter();
      const publishRoute = router.stack.find(
        (layer: any) => layer.route?.path === "/publish" && layer.route?.methods?.post
      );

      expect(publishRoute).toBeDefined();

      const req = mockReq({ body: {} });
      const res = mockRes();
      await publishRoute!.route.stack[0].handle(req, res);

      expect(res._status).toBe(400);
      expect(res._body.error).toContain("name and files are required");
    });
  });

  // ─── installCollection ─────────────────────────────────────────────────

  describe("installCollection()", () => {
    it("should throw for unknown collection", async () => {
      await marketplace.initialize();

      await expect(marketplace.installCollection("nonexistent")).rejects.toThrow('Collection "nonexistent" not found');
    });
  });
});
