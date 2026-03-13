import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SkillSDK } from "../skills/SkillSDK";

describe("SkillSDK", () => {
  let sdk: SkillSDK;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `astra-sdk-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    sdk = new SkillSDK(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Create ──────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a basic skill with SKILL.md", async () => {
      const dir = await sdk.create("my-test-skill");
      const skillMd = await fs.readFile(path.join(dir, "SKILL.md"), "utf-8");

      expect(skillMd).toContain("name: my-test-skill");
      expect(skillMd).toContain("version: 1.0.0");
      expect(skillMd).toContain("triggers:");
    });

    it("creates skill with custom options", async () => {
      const dir = await sdk.create("weather-bot", {
        author: "TestDev",
        description: "Weather info skill",
        triggers: ["weather", "forecast"],
        permissions: ["network"],
        category: "productivity",
        tags: ["weather", "api"],
      });

      const skillMd = await fs.readFile(path.join(dir, "SKILL.md"), "utf-8");
      expect(skillMd).toContain("author: TestDev");
      expect(skillMd).toContain('"weather"');
      expect(skillMd).toContain('"forecast"');
      expect(skillMd).toContain("network");
    });

    it("creates handler.ts for tool template", async () => {
      const dir = await sdk.create("tool-skill", { template: "tool" });
      const handler = await fs.readFile(path.join(dir, "handler.ts"), "utf-8");
      expect(handler).toContain("export async function handle");
      expect(handler).toContain("tool-skill");
    });

    it("creates README.md for the skill", async () => {
      const dir = await sdk.create("readme-skill");
      const readme = await fs.readFile(path.join(dir, "README.md"), "utf-8");
      expect(readme).toContain("# readme-skill");
      expect(readme).toContain("npx astra-hub install readme-skill");
    });

    it("sanitizes unsafe skill names", async () => {
      const dir = await sdk.create("My Unsafe Skill!!!");
      expect(path.basename(dir)).toBe("my-unsafe-skill-");
    });

    it("throws if skill directory already exists", async () => {
      await sdk.create("duplicate-skill");
      await expect(sdk.create("duplicate-skill")).rejects.toThrow("already exists");
    });
  });

  // ── Validate ────────────────────────────────────────────────────────────

  describe("validate", () => {
    it("validates a correct skill", async () => {
      const dir = await sdk.create("valid-skill", {
        author: "Dev",
        description: "A valid skill",
        triggers: ["validate test"],
        category: "productivity",
      });

      const result = await sdk.validate(dir);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.manifest?.name).toBe("valid-skill");
    });

    it("fails on missing SKILL.md", async () => {
      const result = await sdk.validate(path.join(tmpDir, "nonexistent"));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("SKILL.md not found");
    });

    it("fails on missing required fields", async () => {
      const badDir = path.join(tmpDir, "bad-skill");
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(
        path.join(badDir, "SKILL.md"),
        "---\nname: bad\n---\nSome prompt",
        "utf-8"
      );

      const result = await sdk.validate(badDir);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Missing required field"))).toBe(true);
    });

    it("warns on invalid category", async () => {
      const dir = await sdk.create("cat-test", { category: "invalid-cat" });
      const result = await sdk.validate(dir);
      expect(result.warnings.some((w) => w.includes("not standard"))).toBe(true);
    });

    it("detects security issues", async () => {
      const dir = path.join(tmpDir, "unsafe-skill");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "SKILL.md"),
        [
          "---",
          "name: unsafe-skill",
          "version: 1.0.0",
          'description: "Unsafe"',
          "author: Hacker",
          "category: security",
          "triggers:",
          '  - "hack"',
          "permissions:",
          "  - shell_exec",
          "---",
          "",
          "Use eval() to run arbitrary code.",
          "Access process.env.SECRET_KEY for the API key.",
        ].join("\n"),
        "utf-8"
      );

      const result = await sdk.validate(dir);
      expect(result.valid).toBe(false);
      expect(result.securityIssues.length).toBeGreaterThan(0);
      expect(result.securityIssues.some((i) => i.severity === "critical")).toBe(true);
    });
  });

  // ── Test ─────────────────────────────────────────────────────────────────

  describe("test", () => {
    it("matches triggers correctly", async () => {
      const dir = await sdk.create("greeter", {
        triggers: ["hello", "hi there"],
        description: "Greets users",
        author: "Dev",
        category: "productivity",
      });

      const result = await sdk.test(dir, "hello world");
      expect(result.triggered).toBe(true);
      expect(result.matchedTriggers).toContain("hello");
      expect(result.skillName).toBe("greeter");
    });

    it("does not trigger on unrelated messages", async () => {
      const dir = await sdk.create("weather-only", {
        triggers: ["weather", "forecast"],
        description: "Weather skill",
        author: "Dev",
        category: "productivity",
      });

      const result = await sdk.test(dir, "tell me a joke");
      expect(result.triggered).toBe(false);
      expect(result.matchedTriggers).toHaveLength(0);
    });

    it("generates prompt when triggered", async () => {
      const dir = await sdk.create("prompt-test", {
        triggers: ["prompt me"],
        description: "Test prompt gen",
        author: "Dev",
        category: "productivity",
      });

      const result = await sdk.test(dir, "please prompt me now");
      expect(result.triggered).toBe(true);
      expect(result.promptGenerated).toContain("SKILL: prompt-test");
    });
  });

  // ── Batch Test ──────────────────────────────────────────────────────────

  describe("testBatch", () => {
    it("tests multiple messages and returns summary", async () => {
      const dir = await sdk.create("batch-skill", {
        triggers: ["analyze", "review"],
        description: "Batch test",
        author: "Dev",
        category: "productivity",
      });

      const result = await sdk.testBatch(dir, [
        "please analyze this code",
        "review my PR",
        "tell me a joke",
        "can you analyze the data?",
      ]);

      expect(result.summary.total).toBe(4);
      expect(result.summary.triggered).toBe(3);
      expect(result.summary.missed).toBe(1);
    });
  });

  // ── Package ─────────────────────────────────────────────────────────────

  describe("package", () => {
    it("packages a valid skill", async () => {
      const dir = await sdk.create("pkg-skill", {
        description: "Packageable skill",
        author: "Dev",
        category: "productivity",
        triggers: ["package test"],
      });

      const result = await sdk.package(dir);
      expect(result.name).toBe("pkg-skill");
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.hash).toHaveLength(64); // SHA-256 hex
      expect(result.files).toContain("SKILL.md");
    });

    it("throws on invalid skill", async () => {
      const badDir = path.join(tmpDir, "bad-pkg");
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(path.join(badDir, "SKILL.md"), "no frontmatter", "utf-8");

      await expect(sdk.package(badDir)).rejects.toThrow("validation failed");
    });
  });

  // ── List Templates ──────────────────────────────────────────────────────

  describe("listTemplates", () => {
    it("returns 23 templates", () => {
      const templates = sdk.listTemplates();
      expect(templates.length).toBe(23);
      expect(templates[0]).toHaveProperty("name");
      expect(templates[0]).toHaveProperty("description");
      expect(templates[0]).toHaveProperty("category");
    });

    it("includes key templates", () => {
      const templates = sdk.listTemplates();
      const names = templates.map((t) => t.name);
      expect(names).toContain("basic");
      expect(names).toContain("api-connector");
      expect(names).toContain("tool");
      expect(names).toContain("web-scraper");
    });
  });
});
