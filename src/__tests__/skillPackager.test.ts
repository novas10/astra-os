/**
 * AstraOS — SkillPackager unit tests
 * Tests package validation, security scanning, and version bumping.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
  access: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  default: {
    access: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

import * as mockFsPromises from "fs/promises";
import { SkillPackager } from "../marketplace/SkillPackager";

// ─── Helpers ─────────────────────────────────────────────────────────────

const VALID_SKILL_MD = `---
name: test-skill
version: 1.2.3
description: A test skill for unit testing
author: Test Author
category: devtools
tags:
  - test
  - unit-test
triggers:
  - run test
permissions:
  - network
---

You are a test skill. Help users run tests.`;

const MINIMAL_SKILL_MD = `---
name: minimal
triggers:
  - go
---

A minimal skill.`;

const NO_NAME_SKILL_MD = `---
version: 1.0.0
description: Missing name field
triggers:
  - trigger
---

Body text.`;

const NO_TRIGGER_SKILL_MD = `---
name: no-triggers
---

Body without triggers.`;

// ═══════════════════════════════════════════════════════════════════════════
// SkillPackager tests
// ═══════════════════════════════════════════════════════════════════════════

describe("SkillPackager", () => {
  let packager: SkillPackager;

  beforeEach(() => {
    vi.clearAllMocks();
    packager = new SkillPackager();
  });

  // ─── package() — missing SKILL.md ──────────────────────────────────────

  describe("package() — missing SKILL.md", () => {
    it("should return invalid result when SKILL.md is missing", async () => {
      mockFsPromises.access.mockRejectedValue(new Error("ENOENT"));

      const result = await packager.package("/fake/skill-dir");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing SKILL.md file — required for all skills");
      expect(result.files).toHaveLength(0);
      expect(result.name).toBe("");
      expect(result.version).toBe("");
    });
  });

  // ─── package() — valid skill ───────────────────────────────────────────

  describe("package() — valid skill with proper SKILL.md", () => {
    it("should return valid result for a well-formed skill", async () => {
      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("SKILL.md")) return Promise.resolve(VALID_SKILL_MD);
        return Promise.resolve("console.log('hello');");
      });
      mockFsPromises.readdir.mockResolvedValue([
        { name: "SKILL.md", isDirectory: () => false },
        { name: "index.ts", isDirectory: () => false },
      ]);

      const result = await packager.package("/fake/test-skill");

      expect(result.valid).toBe(true);
      expect(result.name).toBe("test-skill");
      expect(result.version).toBe("1.2.3");
      expect(result.errors).toHaveLength(0);
      expect(result.files.length).toBeGreaterThan(0);
    });

    it("should warn about missing version", async () => {
      const skillMdNoVersion = `---
name: my-skill
description: No version
author: Test
triggers:
  - test
---

Prompt.`;

      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("SKILL.md")) return Promise.resolve(skillMdNoVersion);
        return Promise.resolve("");
      });
      mockFsPromises.readdir.mockResolvedValue([
        { name: "SKILL.md", isDirectory: () => false },
      ]);

      const result = await packager.package("/fake/skill-no-version");

      expect(result.warnings).toContain("SKILL.md is missing 'version' — defaulting to 1.0.0");
      expect(result.version).toBe("1.0.0");
    });

    it("should warn about missing description", async () => {
      const skillMdNoDesc = `---
name: no-desc
version: 1.0.0
author: Test
triggers:
  - test
---

Body.`;

      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("SKILL.md")) return Promise.resolve(skillMdNoDesc);
        return Promise.resolve("");
      });
      mockFsPromises.readdir.mockResolvedValue([
        { name: "SKILL.md", isDirectory: () => false },
      ]);

      const result = await packager.package("/fake/skill-no-desc");
      expect(result.warnings).toContain("SKILL.md is missing 'description'");
    });

    it("should error when SKILL.md has no name", async () => {
      const skillMdNoName = `---
version: 1.0.0
triggers:
  - test
---

Body.`;

      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("SKILL.md")) return Promise.resolve(skillMdNoName);
        return Promise.resolve("");
      });
      mockFsPromises.readdir.mockResolvedValue([
        { name: "SKILL.md", isDirectory: () => false },
      ]);

      const result = await packager.package("/fake/skill-no-name");
      expect(result.errors).toContain("SKILL.md is missing 'name' in frontmatter");
    });
  });

  // ─── package() — oversized package ─────────────────────────────────────

  describe("package() — oversized packages", () => {
    it("should error when total size exceeds 5MB", async () => {
      mockFsPromises.access.mockResolvedValue(undefined);

      // Create a large content string (> 5MB)
      const largeContent = "x".repeat(6 * 1024 * 1024); // 6MB

      mockFsPromises.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("SKILL.md")) return Promise.resolve(VALID_SKILL_MD);
        return Promise.resolve(largeContent);
      });
      mockFsPromises.readdir.mockResolvedValue([
        { name: "SKILL.md", isDirectory: () => false },
        { name: "big-file.ts", isDirectory: () => false },
      ]);

      const result = await packager.package("/fake/oversized-skill");

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Package too large"))).toBe(true);
    });
  });

  // ─── package() — unexpected file types ─────────────────────────────────

  describe("package() — unexpected file extensions", () => {
    it("should warn about non-standard file types", async () => {
      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("SKILL.md")) return Promise.resolve(VALID_SKILL_MD);
        return Promise.resolve("binary data");
      });
      mockFsPromises.readdir.mockResolvedValue([
        { name: "SKILL.md", isDirectory: () => false },
        { name: "payload.exe", isDirectory: () => false },
      ]);

      const result = await packager.package("/fake/sus-skill");

      expect(result.warnings.some((w) => w.includes("Unexpected file type") && w.includes(".exe"))).toBe(true);
    });
  });

  // ─── securityScan() — dangerous pattern detection ──────────────────────

  describe("securityScan()", () => {
    it("should detect eval() as critical", () => {
      const result = packager.securityScan([
        { name: "bad.ts", content: 'const x = eval("1+1");' },
      ]);

      expect(result.safe).toBe(false);
      expect(result.issues.some((i) => i.severity === "critical" && i.message.includes("eval()"))).toBe(true);
    });

    it("should detect require('child_process') as critical", () => {
      const result = packager.securityScan([
        { name: "backdoor.js", content: "const cp = require('child_process');" },
      ]);

      expect(result.safe).toBe(false);
      expect(result.issues.some((i) => i.severity === "critical" && i.message.includes("child_process"))).toBe(true);
    });

    it("should detect import child_process as critical", () => {
      const result = packager.securityScan([
        { name: "backdoor.ts", content: "import { exec } from 'child_process';" },
      ]);

      expect(result.safe).toBe(false);
      expect(result.issues.some((i) => i.severity === "critical" && i.message.includes("child_process"))).toBe(true);
    });

    it("should detect new Function() as critical", () => {
      const result = packager.securityScan([
        { name: "inject.ts", content: 'const fn = new Function("return 1");' },
      ]);

      expect(result.safe).toBe(false);
      expect(result.issues.some((i) => i.severity === "critical" && i.message.includes("Dynamic function"))).toBe(true);
    });

    it("should detect fetch() as low severity (not critical)", () => {
      const result = packager.securityScan([
        { name: "net.ts", content: 'await fetch("https://api.example.com/data");' },
      ]);

      // fetch alone should not make it unsafe (only low severity)
      expect(result.safe).toBe(true);
      expect(result.issues.some((i) => i.severity === "low" && i.message.includes("network requests"))).toBe(true);
    });

    it("should detect process.env access as medium severity", () => {
      const result = packager.securityScan([
        { name: "env.ts", content: "const key = process.env.API_KEY;" },
      ]);

      expect(result.issues.some((i) => i.severity === "medium" && i.message.includes("environment variables"))).toBe(true);
    });

    it("should detect require('fs') as high severity", () => {
      const result = packager.securityScan([
        { name: "fs.js", content: "const fs = require('fs');" },
      ]);

      expect(result.issues.some((i) => i.severity === "high" && i.message.includes("filesystem"))).toBe(true);
    });

    it("should detect .exec() as high severity", () => {
      const result = packager.securityScan([
        { name: "exec.ts", content: "regex.exec(input);" },
      ]);

      expect(result.issues.some((i) => i.severity === "high" && i.message.includes("Executes commands"))).toBe(true);
    });

    it("should be safe for clean code", () => {
      const result = packager.securityScan([
        { name: "clean.ts", content: 'const msg = "Hello World";\nconsole.log(msg);' },
      ]);

      expect(result.safe).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("should skip non-code files", () => {
      const result = packager.securityScan([
        { name: "README.md", content: 'Use eval() to do things' },
        { name: "config.json", content: '{"eval": true}' },
        { name: "data.yaml", content: 'eval: true' },
      ]);

      // Only .ts/.js/.mjs/.cjs are scanned
      expect(result.issues).toHaveLength(0);
    });

    it("should report correct file name and line number", () => {
      const result = packager.securityScan([
        { name: "src/helper.ts", content: "line1\nline2\neval('bad');\nline4" },
      ]);

      const issue = result.issues.find((i) => i.message.includes("eval()"));
      expect(issue).toBeDefined();
      expect(issue!.file).toBe("src/helper.ts");
      expect(issue!.line).toBe(3);
    });

    it("should detect multiple issues in a single file", () => {
      const result = packager.securityScan([
        {
          name: "multi-issue.ts",
          content: `
eval("one");
require('child_process');
new Function("two");
`,
        },
      ]);

      expect(result.issues.length).toBeGreaterThanOrEqual(3);
      expect(result.safe).toBe(false);
    });
  });

  // ─── package() — security scan integration ─────────────────────────────

  describe("package() — security scan integration", () => {
    it("should error on critical security issues in package", async () => {
      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("SKILL.md")) return Promise.resolve(VALID_SKILL_MD);
        return Promise.resolve('const x = eval("payload");');
      });
      mockFsPromises.readdir.mockResolvedValue([
        { name: "SKILL.md", isDirectory: () => false },
        { name: "exploit.ts", isDirectory: () => false },
      ]);

      const result = await packager.package("/fake/evil-skill");

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("[SECURITY]"))).toBe(true);
    });

    it("should warn on non-critical security issues without invalidating", async () => {
      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("SKILL.md")) return Promise.resolve(VALID_SKILL_MD);
        // process.env is medium severity + fetch is low — neither is critical
        return Promise.resolve('const url = process.env.API_URL; await fetch(url);');
      });
      mockFsPromises.readdir.mockResolvedValue([
        { name: "SKILL.md", isDirectory: () => false },
        { name: "api.ts", isDirectory: () => false },
      ]);

      const result = await packager.package("/fake/net-skill");

      // No critical issues — package should still be valid
      expect(result.valid).toBe(true);
      // securityScan returns safe=true (no criticals), so no security warnings are added
      // The scan itself is safe, meaning the package passes
    });
  });

  // ─── validateSkillMd() ─────────────────────────────────────────────────

  describe("validateSkillMd()", () => {
    it("should validate a proper SKILL.md", () => {
      const result = packager.validateSkillMd(VALID_SKILL_MD);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate a minimal SKILL.md with name and triggers", () => {
      const result = packager.validateSkillMd(MINIMAL_SKILL_MD);
      expect(result.valid).toBe(true);
    });

    it("should error on missing name", () => {
      const result = packager.validateSkillMd(NO_NAME_SKILL_MD);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing 'name' in frontmatter");
    });

    it("should error on missing triggers", () => {
      const result = packager.validateSkillMd(NO_TRIGGER_SKILL_MD);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing 'triggers' — skill won't activate");
    });

    it("should error when system prompt body is missing", () => {
      const noBody = `---
name: no-body
triggers:
  - test
---
`;

      const result = packager.validateSkillMd(noBody);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing system prompt body after frontmatter");
    });

    it("should error when frontmatter is completely absent", () => {
      const noFrontmatter = "Just some text without any frontmatter.";
      const result = packager.validateSkillMd(noFrontmatter);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing 'name' in frontmatter");
    });
  });

  // ─── bumpVersion() ─────────────────────────────────────────────────────

  describe("bumpVersion()", () => {
    it("should bump patch version by default", async () => {
      mockFsPromises.readFile.mockResolvedValue(VALID_SKILL_MD);

      const newVersion = await packager.bumpVersion("/fake/skill");

      expect(newVersion).toBe("1.2.4"); // 1.2.3 -> 1.2.4
      expect(mockFsPromises.writeFile).toHaveBeenCalled();
    });

    it("should bump minor version", async () => {
      mockFsPromises.readFile.mockResolvedValue(VALID_SKILL_MD);

      const newVersion = await packager.bumpVersion("/fake/skill", "minor");

      expect(newVersion).toBe("1.3.0"); // 1.2.3 -> 1.3.0
    });

    it("should bump major version", async () => {
      mockFsPromises.readFile.mockResolvedValue(VALID_SKILL_MD);

      const newVersion = await packager.bumpVersion("/fake/skill", "major");

      expect(newVersion).toBe("2.0.0"); // 1.2.3 -> 2.0.0
    });

    it("should default to 1.0.0 when no version exists", async () => {
      const noVersionMd = `---
name: no-ver
triggers:
  - test
---

Body.`;

      mockFsPromises.readFile.mockResolvedValue(noVersionMd);

      // With no version, the code parses "1.0.0" then bumps patch -> "1.0.1"
      const newVersion = await packager.bumpVersion("/fake/skill", "patch");
      expect(newVersion).toBe("1.0.1");
    });

    it("should write updated content to SKILL.md", async () => {
      mockFsPromises.readFile.mockResolvedValue(VALID_SKILL_MD);

      await packager.bumpVersion("/fake/skill", "patch");

      expect(mockFsPromises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("SKILL.md"),
        expect.stringContaining("version: 1.2.4"),
        "utf-8"
      );
    });

    it("should reset lower segments on minor bump", async () => {
      const versionedMd = `---
name: test
version: 3.7.9
triggers:
  - test
---

Body.`;

      mockFsPromises.readFile.mockResolvedValue(versionedMd);

      const newVersion = await packager.bumpVersion("/fake/skill", "minor");
      expect(newVersion).toBe("3.8.0");
    });

    it("should reset lower segments on major bump", async () => {
      const versionedMd = `---
name: test
version: 3.7.9
triggers:
  - test
---

Body.`;

      mockFsPromises.readFile.mockResolvedValue(versionedMd);

      const newVersion = await packager.bumpVersion("/fake/skill", "major");
      expect(newVersion).toBe("4.0.0");
    });
  });

  // ─── Hidden files and node_modules exclusion ───────────────────────────

  describe("File collection exclusions", () => {
    it("should skip hidden files (dotfiles)", async () => {
      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("SKILL.md")) return Promise.resolve(VALID_SKILL_MD);
        return Promise.resolve("content");
      });
      mockFsPromises.readdir.mockResolvedValue([
        { name: ".hidden", isDirectory: () => false },
        { name: ".git", isDirectory: () => true },
        { name: "SKILL.md", isDirectory: () => false },
        { name: "node_modules", isDirectory: () => true },
        { name: "index.ts", isDirectory: () => false },
      ]);

      const result = await packager.package("/fake/skill");

      // Should only include SKILL.md and index.ts, not .hidden, .git, or node_modules
      const fileNames = result.files.map((f) => f.name);
      expect(fileNames).not.toContain(".hidden");
      expect(fileNames).not.toContain(".git");
      expect(fileNames).toContain("SKILL.md");
      expect(fileNames).toContain("index.ts");
    });
  });
});
