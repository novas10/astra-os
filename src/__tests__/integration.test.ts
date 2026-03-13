/**
 * AstraOS — Integration Tests
 * Tests API endpoints end-to-end using supertest (no live server needed).
 * Covers: Health, Skills, SDK, Workflows, Digest, Admin, Agents, Memory.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock logger before any imports
vi.mock("../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock heavy dependencies to keep tests fast
vi.mock("puppeteer", () => ({ default: { launch: vi.fn() } }));
vi.mock("sharp", () => ({ default: vi.fn() }));
vi.mock("better-sqlite3", () => {
  const mockDb = {
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
  };
  return { default: vi.fn(() => mockDb) };
});

import express from "express";
import { SkillSDK, createSDKRouter } from "../skills/SkillSDK";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// ─── SDK Router Integration Tests ─────────────────────────────────────────

describe("SDK API Router (/api/sdk)", () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use("/api/sdk", createSDKRouter());
  });

  it("GET /api/sdk/templates returns template list", async () => {
    const supertest = (await import("supertest")).default;
    const res = await supertest(app).get("/api/sdk/templates");
    expect(res.status).toBe(200);
    expect(res.body.templates).toBeInstanceOf(Array);
    expect(res.body.templates.length).toBe(23);
    expect(res.body.templates[0]).toHaveProperty("name");
    expect(res.body.templates[0]).toHaveProperty("description");
    expect(res.body.templates[0]).toHaveProperty("category");
  });

  it("POST /api/sdk/create creates a skill", async () => {
    const supertest = (await import("supertest")).default;
    const tmpDir = path.join(os.tmpdir(), `astra-int-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    const res = await supertest(app)
      .post("/api/sdk/create")
      .send({
        name: "integration-skill",
        author: "IntegrationTest",
        outputDir: tmpDir,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.directory).toContain("integration-skill");

    // Verify file was created
    const skillMd = await fs.readFile(path.join(res.body.directory, "SKILL.md"), "utf-8");
    expect(skillMd).toContain("name: integration-skill");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("POST /api/sdk/create returns 400 without name", async () => {
    const supertest = (await import("supertest")).default;
    const res = await supertest(app).post("/api/sdk/create").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("name");
  });

  it("POST /api/sdk/validate validates a skill", async () => {
    const supertest = (await import("supertest")).default;
    const sdk = new SkillSDK();
    const tmpDir = path.join(os.tmpdir(), `astra-val-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const skillSdk = new SkillSDK(tmpDir);
    const dir = await skillSdk.create("valid-int", {
      author: "Test",
      description: "Test skill",
      category: "productivity",
      triggers: ["test"],
    });

    const res = await supertest(app)
      .post("/api/sdk/validate")
      .send({ path: dir });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.errors).toHaveLength(0);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("POST /api/sdk/test tests trigger matching", async () => {
    const supertest = (await import("supertest")).default;
    const tmpDir = path.join(os.tmpdir(), `astra-trig-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const skillSdk = new SkillSDK(tmpDir);
    const dir = await skillSdk.create("trigger-test", {
      triggers: ["hello world", "greet"],
      author: "Test",
      category: "productivity",
    });

    const res = await supertest(app)
      .post("/api/sdk/test")
      .send({ path: dir, message: "hello world from test" });

    expect(res.status).toBe(200);
    expect(res.body.triggered).toBe(true);
    expect(res.body.matchedTriggers).toContain("hello world");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("POST /api/sdk/test batch mode", async () => {
    const supertest = (await import("supertest")).default;
    const tmpDir = path.join(os.tmpdir(), `astra-batch-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const skillSdk = new SkillSDK(tmpDir);
    const dir = await skillSdk.create("batch-int", {
      triggers: ["analyze"],
      author: "Test",
      category: "productivity",
    });

    const res = await supertest(app)
      .post("/api/sdk/test")
      .send({
        path: dir,
        messages: ["analyze this", "do something else", "analyze that"],
      });

    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(3);
    expect(res.body.summary.triggered).toBe(2);
    expect(res.body.summary.missed).toBe(1);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("POST /api/sdk/package packages a skill", async () => {
    const supertest = (await import("supertest")).default;
    const tmpDir = path.join(os.tmpdir(), `astra-pkg-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const skillSdk = new SkillSDK(tmpDir);
    const dir = await skillSdk.create("pkg-int", {
      author: "Test",
      description: "Package test",
      category: "productivity",
      triggers: ["package"],
    });

    const res = await supertest(app)
      .post("/api/sdk/package")
      .send({ path: dir });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("pkg-int");
    expect(res.body.hash).toHaveLength(64);
    expect(res.body.files).toContain("SKILL.md");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

// ─── SkillSDK Class Integration Tests ─────────────────────────────────────

describe("SkillSDK — Full Workflow Integration", () => {
  let sdk: SkillSDK;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `astra-workflow-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    sdk = new SkillSDK(tmpDir);
  });

  it("full lifecycle: create → validate → test → package", async () => {
    // 1. Create
    const dir = await sdk.create("lifecycle-skill", {
      template: "api-connector",
      author: "IntegrationDev",
      description: "Full lifecycle test skill",
      triggers: ["fetch data", "call api"],
      permissions: ["network"],
      category: "integration",
      tags: ["api", "test"],
    });

    // Verify files exist
    const files = await fs.readdir(dir);
    expect(files).toContain("SKILL.md");
    expect(files).toContain("handler.ts");
    expect(files).toContain("README.md");

    // 2. Validate
    const validation = await sdk.validate(dir);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(validation.manifest?.name).toBe("lifecycle-skill");
    expect(validation.manifest?.author).toBe("IntegrationDev");
    expect(validation.manifest?.category).toBe("integration");

    // 3. Test triggers
    const testHit = await sdk.test(dir, "please fetch data from the API");
    expect(testHit.triggered).toBe(true);
    expect(testHit.matchedTriggers).toContain("fetch data");
    expect(testHit.promptGenerated).toContain("API integration assistant");

    const testMiss = await sdk.test(dir, "tell me a joke");
    expect(testMiss.triggered).toBe(false);

    // 4. Batch test
    const batchResult = await sdk.testBatch(dir, [
      "fetch data now",
      "call api endpoint",
      "random question",
      "can you fetch data?",
    ]);
    expect(batchResult.summary.total).toBe(4);
    expect(batchResult.summary.triggered).toBe(3);

    // 5. Package
    const pkg = await sdk.package(dir);
    expect(pkg.name).toBe("lifecycle-skill");
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.files.length).toBeGreaterThanOrEqual(3);
    expect(pkg.hash).toHaveLength(64);

    // Verify package.json was written
    const pkgJson = JSON.parse(
      await fs.readFile(path.join(dir, "package.json"), "utf-8")
    );
    expect(pkgJson.name).toBe("lifecycle-skill");
    expect(pkgJson.author).toBe("IntegrationDev");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

// ─── OpenAPI Spec Validation ──────────────────────────────────────────────

describe("OpenAPI Spec", () => {
  it("openapi.yaml is valid YAML with all required sections", async () => {
    const yaml = await import("js-yaml");
    const specPath = path.join(process.cwd(), "src/docs/openapi.yaml");
    const content = await fs.readFile(specPath, "utf-8");
    const spec = yaml.load(content) as Record<string, unknown>;

    expect(spec).toHaveProperty("openapi");
    expect(spec).toHaveProperty("info");
    expect(spec).toHaveProperty("paths");
    expect(spec).toHaveProperty("components");
    expect(spec).toHaveProperty("tags");

    const paths = Object.keys(spec.paths as Record<string, unknown>);
    expect(paths.length).toBeGreaterThan(100);

    // Verify key endpoints exist
    expect(paths).toContain("/health");
    expect(paths).toContain("/api/chat");
    expect(paths).toContain("/api/skills");
    expect(paths).toContain("/api/agents");
    expect(paths).toContain("/api/sdk/templates");
    expect(paths).toContain("/api/sdk/create");
    expect(paths).toContain("/api/sdk/validate");
    expect(paths).toContain("/api/sdk/test");
    expect(paths).toContain("/api/sdk/package");
    expect(paths).toContain("/api/workflows");
    expect(paths).toContain("/api/digest");
    expect(paths).toContain("/api/memory/search");
    expect(paths).toContain("/api/admin/settings");
  });

  it("no duplicate operationIds", async () => {
    const yaml = await import("js-yaml");
    const specPath = path.join(process.cwd(), "src/docs/openapi.yaml");
    const content = await fs.readFile(specPath, "utf-8");
    const spec = yaml.load(content) as Record<string, Record<string, Record<string, string>>>;

    const operationIds: string[] = [];
    for (const pathDef of Object.values(spec.paths)) {
      for (const methodDef of Object.values(pathDef)) {
        if (methodDef?.operationId) {
          operationIds.push(methodDef.operationId);
        }
      }
    }

    const duplicates = operationIds.filter(
      (id, idx) => operationIds.indexOf(id) !== idx
    );
    expect(duplicates).toHaveLength(0);
  });
});
