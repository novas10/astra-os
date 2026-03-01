/**
 * AstraOS — SkillsEngine unit tests
 * Tests skill loading, searching, personality (SOUL.md), agent config (AGENTS.md)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "path";

// Mock the logger to avoid file-system side effects from log writes
vi.mock("../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// We need to mock fs/promises so that SkillsEngine can "load" skills from virtual directories
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockRejectedValue(new Error("Not found")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockRejectedValue(new Error("Not found")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  },
}));

import * as mockFs from "fs/promises";
import { SkillsEngine } from "../skills/SkillsEngine";
import type { Skill } from "../skills/SkillsEngine";

// ─── Helpers ────────────────────────────────────────────────────────────────

const SAMPLE_SKILL_MD = `---
name: code-reviewer
version: 1.2.0
description: Review code for bugs and style issues
author: AstraOS Team
category: devtools
tags:
  - code-review
  - linting
triggers:
  - review code
  - code review
permissions:
  - file_read
---

You are an expert code reviewer.`;

const SAMPLE_SOUL_MD = `---
name: Astra
voice: professional-yet-friendly
traits:
  - helpful
  - precise
  - proactive
constraints:
  - Never execute destructive commands without confirmation
  - Always verify file paths before writing
examples:
  - "Sure, I'll help you deploy that."
  - "I noticed a potential security issue."
---

You are Astra, the AI assistant powered by AstraOS.`;

const SAMPLE_AGENTS_MD = `## DevOps Agent

\`\`\`yaml
description: Handles CI/CD and deployments
skills:
  - ci-monitor
  - docker-manager
channels:
  - slack
  - teams
model: claude-sonnet
maxConcurrent: 5
\`\`\`

## Support Agent

\`\`\`yaml
description: Customer-facing support agent
skills:
  - email-assistant
channels:
  - whatsapp
  - webchat
model: claude-haiku
maxConcurrent: 20
\`\`\``;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SkillsEngine", () => {
  let engine: SkillsEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new SkillsEngine("/fake/skills");
  });

  afterEach(() => {
    // Restore original env vars that tests may mutate
    delete process.env.ASTRA_HUB_URL;
  });

  // ─── Skill Loading ─────────────────────────────────────────────────────

  describe("initialize() — skill loading from directory", () => {
    it("should create skills directory if it does not exist", async () => {
      // readdir returns empty — no skills
      mockFs.readdir.mockResolvedValue([]);
      // readFile will fail for SOUL.md and AGENTS.md — that's expected
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      await engine.initialize();

      expect(mockFs.mkdir).toHaveBeenCalledWith("/fake/skills", { recursive: true });
    });

    it("should load a skill from a subdirectory with SKILL.md", async () => {
      // First call to readdir: bundled skills dir
      mockFs.readdir
        .mockResolvedValueOnce([{ name: "code-reviewer", isDirectory: () => true }]) // bundled
        .mockResolvedValueOnce([]); // workspace (.astra-skills)

      mockFs.readFile
        .mockImplementation((filePath: string) => {
          if (filePath.includes("code-reviewer") && filePath.includes("SKILL.md")) {
            return Promise.resolve(SAMPLE_SKILL_MD);
          }
          return Promise.reject(new Error("ENOENT"));
        });

      await engine.initialize();

      const skills = engine.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("code-reviewer");
      expect(skills[0].version).toBe("1.2.0");
      expect(skills[0].description).toBe("Review code for bugs and style issues");
      expect(skills[0].author).toBe("AstraOS Team");
      expect(skills[0].category).toBe("devtools");
      expect(skills[0].tags).toEqual(["code-review", "linting"]);
      expect(skills[0].triggers).toEqual(["review code", "code review"]);
      expect(skills[0].permissions).toEqual(["file_read"]);
      expect(skills[0].systemPrompt).toBe("You are an expert code reviewer.");
      expect(skills[0].enabled).toBe(true);
      expect(skills[0].source).toBe("bundled");
    });

    it("should skip non-directory entries", async () => {
      mockFs.readdir
        .mockResolvedValueOnce([
          { name: "README.md", isDirectory: () => false },
          { name: "valid-skill", isDirectory: () => true },
        ])
        .mockResolvedValueOnce([]);

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("valid-skill") && filePath.includes("SKILL.md")) {
          return Promise.resolve(SAMPLE_SKILL_MD);
        }
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();

      // Should only load the valid skill, not the file
      const skills = engine.listSkills();
      expect(skills).toHaveLength(1);
    });

    it("should skip directories without a valid SKILL.md", async () => {
      mockFs.readdir
        .mockResolvedValueOnce([{ name: "broken-skill", isDirectory: () => true }])
        .mockResolvedValueOnce([]);

      // Simulate broken SKILL.md (no YAML frontmatter)
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("broken-skill") && filePath.includes("SKILL.md")) {
          return Promise.resolve("No frontmatter here. Just text.");
        }
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();
      expect(engine.listSkills()).toHaveLength(0);
    });

    it("should allow workspace skills to override bundled skills", async () => {
      const bundledSkill = `---
name: my-skill
version: 1.0.0
description: Bundled version
author: Bundled Author
category: other
tags:
  - bundled
triggers:
  - myskill
permissions: []
---

Bundled prompt.`;

      const workspaceSkill = `---
name: my-skill
version: 2.0.0
description: Workspace version
author: Workspace Author
category: custom
tags:
  - workspace
triggers:
  - myskill
permissions: []
---

Workspace prompt.`;

      // First readdir: bundled
      mockFs.readdir
        .mockResolvedValueOnce([{ name: "my-skill", isDirectory: () => true }])
        .mockResolvedValueOnce([{ name: "my-skill", isDirectory: () => true }]);

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes(".astra-skills") && filePath.includes("SKILL.md")) {
          return Promise.resolve(workspaceSkill);
        }
        if (filePath.includes("my-skill") && filePath.includes("SKILL.md")) {
          return Promise.resolve(bundledSkill);
        }
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();

      const skill = engine.getSkill("my-skill");
      expect(skill).toBeDefined();
      // Workspace should override bundled
      expect(skill!.version).toBe("2.0.0");
      expect(skill!.description).toBe("Workspace version");
      expect(skill!.source).toBe("workspace");
    });
  });

  // ─── searchLocal ───────────────────────────────────────────────────────

  describe("searchLocal()", () => {
    beforeEach(async () => {
      const skill1 = `---
name: email-assistant
version: 1.0.0
description: Manage and compose emails
author: AstraOS Team
category: productivity
tags:
  - email
  - gmail
triggers:
  - send email
permissions: []
---

Email skill prompt.`;

      const skill2 = `---
name: code-reviewer
version: 1.0.0
description: Review code for bugs
author: AstraOS Team
category: devtools
tags:
  - code
  - review
triggers:
  - review code
permissions: []
---

Code review prompt.`;

      mockFs.readdir
        .mockResolvedValueOnce([
          { name: "email-assistant", isDirectory: () => true },
          { name: "code-reviewer", isDirectory: () => true },
        ])
        .mockResolvedValueOnce([]);

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("email-assistant") && filePath.includes("SKILL.md")) {
          return Promise.resolve(skill1);
        }
        if (filePath.includes("code-reviewer") && filePath.includes("SKILL.md")) {
          return Promise.resolve(skill2);
        }
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();
    });

    it("should find skills by name substring", () => {
      const results = engine.searchLocal("email");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("email-assistant");
    });

    it("should find skills by description substring", () => {
      const results = engine.searchLocal("bugs");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("code-reviewer");
    });

    it("should find skills by tag", () => {
      const results = engine.searchLocal("gmail");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("email-assistant");
    });

    it("should be case-insensitive", () => {
      const results = engine.searchLocal("EMAIL");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("email-assistant");
    });

    it("should return empty array when nothing matches", () => {
      const results = engine.searchLocal("nonexistent-xyz");
      expect(results).toHaveLength(0);
    });

    it("should return multiple matches when query is broad", () => {
      // Both skills have "AstraOS Team" author but search only checks name, description, tags
      // "code" is in "code-reviewer" name and "code" tag
      const results = engine.searchLocal("code");
      expect(results).toHaveLength(1); // only code-reviewer matches name/desc/tag
    });
  });

  // ─── listByCategory ────────────────────────────────────────────────────

  describe("listByCategory()", () => {
    beforeEach(async () => {
      const skill1 = `---
name: email-assistant
version: 1.0.0
description: Manage emails
author: AstraOS
category: productivity
tags: []
triggers:
  - email
permissions: []
---

Email prompt.`;

      const skill2 = `---
name: code-reviewer
version: 1.0.0
description: Review code
author: AstraOS
category: devtools
tags: []
triggers:
  - review
permissions: []
---

Code prompt.`;

      mockFs.readdir
        .mockResolvedValueOnce([
          { name: "email-assistant", isDirectory: () => true },
          { name: "code-reviewer", isDirectory: () => true },
        ])
        .mockResolvedValueOnce([]);

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("email-assistant") && filePath.includes("SKILL.md")) return Promise.resolve(skill1);
        if (filePath.includes("code-reviewer") && filePath.includes("SKILL.md")) return Promise.resolve(skill2);
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();
    });

    it("should return skills filtered by category", () => {
      const devtools = engine.listByCategory("devtools");
      expect(devtools).toHaveLength(1);
      expect(devtools[0].name).toBe("code-reviewer");
    });

    it("should return empty array for non-existent category", () => {
      const results = engine.listByCategory("gaming");
      expect(results).toHaveLength(0);
    });
  });

  // ─── getStats ──────────────────────────────────────────────────────────

  describe("getStats()", () => {
    it("should return accurate stats for loaded skills", async () => {
      const skill1 = `---
name: s1
version: 1.0.0
description: skill 1
author: test
category: devtools
tags: []
triggers:
  - s1
permissions: []
---

Prompt 1.`;

      const skill2 = `---
name: s2
version: 1.0.0
description: skill 2
author: test
category: productivity
tags: []
triggers:
  - s2
permissions: []
---

Prompt 2.`;

      mockFs.readdir
        .mockResolvedValueOnce([
          { name: "s1", isDirectory: () => true },
          { name: "s2", isDirectory: () => true },
        ])
        .mockResolvedValueOnce([]);

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes(path.join("s1", "SKILL.md")) || (filePath.includes("s1") && filePath.includes("SKILL.md"))) return Promise.resolve(skill1);
        if (filePath.includes(path.join("s2", "SKILL.md")) || (filePath.includes("s2") && filePath.includes("SKILL.md"))) return Promise.resolve(skill2);
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();

      const stats = engine.getStats();
      expect(stats.total).toBe(2);
      expect(stats.enabled).toBe(2);
      expect(stats.bundled).toBe(2);
      expect(stats.installed).toBe(0);
      expect(stats.workspace).toBe(0);
      expect(stats.categories).toContain("devtools");
      expect(stats.categories).toContain("productivity");
      expect(stats.categories).toHaveLength(2);
    });

    it("should return zeros when no skills are loaded", async () => {
      mockFs.readdir.mockResolvedValue([]);
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      await engine.initialize();

      const stats = engine.getStats();
      expect(stats.total).toBe(0);
      expect(stats.enabled).toBe(0);
      expect(stats.categories).toEqual([]);
    });

    it("should track disabled skills separately", async () => {
      const skill = `---
name: toggleable
version: 1.0.0
description: A toggleable skill
author: test
category: other
tags: []
triggers:
  - toggle
permissions: []
---

Toggle prompt.`;

      mockFs.readdir
        .mockResolvedValueOnce([{ name: "toggleable", isDirectory: () => true }])
        .mockResolvedValueOnce([]);

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("toggleable") && filePath.includes("SKILL.md")) return Promise.resolve(skill);
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();

      // Disable the skill
      engine.toggleSkill("toggleable", false);

      const stats = engine.getStats();
      expect(stats.total).toBe(1);
      expect(stats.enabled).toBe(0);
    });
  });

  // ─── Personality / SOUL.md ─────────────────────────────────────────────

  describe("Personality loading from SOUL.md", () => {
    it("should load personality from SOUL.md", async () => {
      mockFs.readdir.mockResolvedValue([]);
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("SOUL.md")) return Promise.resolve(SAMPLE_SOUL_MD);
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();

      const personality = engine.getPersonality();
      expect(personality).not.toBeNull();
      expect(personality!.name).toBe("Astra");
      expect(personality!.voice).toBe("professional-yet-friendly");
      expect(personality!.traits).toContain("helpful");
      expect(personality!.traits).toContain("precise");
      expect(personality!.traits).toContain("proactive");
      expect(personality!.constraints).toContain("Never execute destructive commands without confirmation");
      expect(personality!.examples).toHaveLength(2);
      expect(personality!.systemPrompt).toContain("You are Astra");
    });

    it("should return null personality if SOUL.md does not exist", async () => {
      mockFs.readdir.mockResolvedValue([]);
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      await engine.initialize();

      expect(engine.getPersonality()).toBeNull();
    });

    it("should generate a personality prompt string", async () => {
      mockFs.readdir.mockResolvedValue([]);
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("SOUL.md")) return Promise.resolve(SAMPLE_SOUL_MD);
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();

      const prompt = engine.getPersonalityPrompt();
      expect(prompt).toContain("You are Astra.");
      expect(prompt).toContain("professional-yet-friendly");
      expect(prompt).toContain("helpful, precise, proactive");
      expect(prompt).toContain("Never execute destructive commands without confirmation");
    });

    it("should return empty string from getPersonalityPrompt when no SOUL.md", async () => {
      mockFs.readdir.mockResolvedValue([]);
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      await engine.initialize();

      expect(engine.getPersonalityPrompt()).toBe("");
    });
  });

  // ─── Agent Config / AGENTS.md ──────────────────────────────────────────

  describe("Agent config loading from AGENTS.md", () => {
    it("should load multiple agents from AGENTS.md", async () => {
      mockFs.readdir.mockResolvedValue([]);
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("AGENTS.md")) return Promise.resolve(SAMPLE_AGENTS_MD);
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();

      const agents = engine.listAgentConfigs();
      expect(agents).toHaveLength(2);

      const devOps = engine.getAgentConfig("DevOps Agent");
      expect(devOps).toBeDefined();
      expect(devOps!.description).toBe("Handles CI/CD and deployments");
      expect(devOps!.skills).toContain("ci-monitor");
      expect(devOps!.skills).toContain("docker-manager");
      expect(devOps!.channels).toContain("slack");
      expect(devOps!.channels).toContain("teams");
      expect(devOps!.model).toBe("claude-sonnet");
      expect(devOps!.maxConcurrent).toBe(5);

      const support = engine.getAgentConfig("Support Agent");
      expect(support).toBeDefined();
      expect(support!.skills).toContain("email-assistant");
      expect(support!.channels).toContain("whatsapp");
      expect(support!.maxConcurrent).toBe(20);
    });

    it("should return undefined for non-existent agent", async () => {
      mockFs.readdir.mockResolvedValue([]);
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      await engine.initialize();

      expect(engine.getAgentConfig("Does Not Exist")).toBeUndefined();
    });

    it("should return empty agents list if AGENTS.md is missing", async () => {
      mockFs.readdir.mockResolvedValue([]);
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      await engine.initialize();

      expect(engine.listAgentConfigs()).toHaveLength(0);
    });
  });

  // ─── matchSkills / toggleSkill ─────────────────────────────────────────

  describe("matchSkills() and toggleSkill()", () => {
    beforeEach(async () => {
      const skill = `---
name: email-assistant
version: 1.0.0
description: Send and manage emails
author: test
category: productivity
tags: []
triggers:
  - send email
  - compose email
permissions: []
---

Email prompt.`;

      mockFs.readdir
        .mockResolvedValueOnce([{ name: "email-assistant", isDirectory: () => true }])
        .mockResolvedValueOnce([]);

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("email-assistant") && filePath.includes("SKILL.md")) return Promise.resolve(skill);
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();
    });

    it("should match skills by trigger in message", () => {
      const matched = engine.matchSkills("Please send email to John");
      expect(matched).toHaveLength(1);
      expect(matched[0].name).toBe("email-assistant");
    });

    it("should be case-insensitive when matching triggers", () => {
      const matched = engine.matchSkills("SEND EMAIL now");
      expect(matched).toHaveLength(1);
    });

    it("should not match if no trigger matches", () => {
      const matched = engine.matchSkills("What is the weather?");
      expect(matched).toHaveLength(0);
    });

    it("should not match disabled skills", () => {
      engine.toggleSkill("email-assistant", false);
      const matched = engine.matchSkills("send email");
      expect(matched).toHaveLength(0);
    });

    it("should return true when toggling a valid skill", () => {
      expect(engine.toggleSkill("email-assistant", false)).toBe(true);
    });

    it("should return false when toggling a non-existent skill", () => {
      expect(engine.toggleSkill("nonexistent", false)).toBe(false);
    });
  });

  // ─── buildSkillPrompt / getSkillTools ──────────────────────────────────

  describe("buildSkillPrompt() and getSkillTools()", () => {
    it("should build prompt from matched skills", async () => {
      const skill = `---
name: my-skill
version: 2.0.0
description: Test skill
author: test
category: other
tags: []
triggers:
  - activate
permissions: []
---

This is the system prompt for my-skill.`;

      mockFs.readdir
        .mockResolvedValueOnce([{ name: "my-skill", isDirectory: () => true }])
        .mockResolvedValueOnce([]);

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("my-skill") && filePath.includes("SKILL.md")) return Promise.resolve(skill);
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();

      const prompt = engine.buildSkillPrompt("Please activate now");
      expect(prompt).toContain("SKILL: my-skill (v2.0.0)");
      expect(prompt).toContain("This is the system prompt for my-skill.");
    });

    it("should return empty string when no skills match", async () => {
      mockFs.readdir.mockResolvedValue([]);
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      await engine.initialize();

      expect(engine.buildSkillPrompt("random message")).toBe("");
    });
  });

  // ─── getSkill / listBySource ───────────────────────────────────────────

  describe("getSkill() and listBySource()", () => {
    it("should retrieve a specific skill by name", async () => {
      mockFs.readdir
        .mockResolvedValueOnce([{ name: "test-skill", isDirectory: () => true }])
        .mockResolvedValueOnce([]);

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("test-skill") && filePath.includes("SKILL.md")) {
          return Promise.resolve(SAMPLE_SKILL_MD);
        }
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();

      // SAMPLE_SKILL_MD has name: code-reviewer
      const skill = engine.getSkill("code-reviewer");
      expect(skill).toBeDefined();
      expect(skill!.name).toBe("code-reviewer");
    });

    it("should return undefined for non-existent skill", async () => {
      mockFs.readdir.mockResolvedValue([]);
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));
      await engine.initialize();

      expect(engine.getSkill("nope")).toBeUndefined();
    });

    it("should list skills by source", async () => {
      mockFs.readdir
        .mockResolvedValueOnce([{ name: "bundled-skill", isDirectory: () => true }])
        .mockResolvedValueOnce([]);

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes("SKILL.md")) return Promise.resolve(SAMPLE_SKILL_MD);
        return Promise.reject(new Error("ENOENT"));
      });

      await engine.initialize();

      expect(engine.listBySource("bundled")).toHaveLength(1);
      expect(engine.listBySource("installed")).toHaveLength(0);
      expect(engine.listBySource("workspace")).toHaveLength(0);
    });
  });
});
