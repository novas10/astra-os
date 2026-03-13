/**
 * AstraOS — SkillSDK.ts
 * Developer-facing SDK for creating, validating, testing, and packaging skills.
 * Usage: import { SkillSDK } from 'astra-os/dist/skills/SkillSDK';
 *
 * Quick start:
 *   const sdk = new SkillSDK();
 *   await sdk.create('my-weather-skill', { template: 'api-connector', author: 'You' });
 *   const result = sdk.validate('./skills/my-weather-skill');
 *   await sdk.test('./skills/my-weather-skill', 'what is the weather?');
 *   await sdk.package('./skills/my-weather-skill');
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { logger } from "../utils/logger";

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  triggers: string[];
  permissions: string[];
  tools?: SkillToolDef[];
  config?: Record<string, unknown>;
}

export interface SkillToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler?: string;
}

export interface CreateOptions {
  template?: string;
  author?: string;
  description?: string;
  version?: string;
  triggers?: string[];
  permissions?: string[];
  tags?: string[];
  category?: string;
  outputDir?: string;
}

export interface ValidateResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: SkillManifest;
  securityIssues: SecurityIssue[];
}

export interface SecurityIssue {
  severity: "critical" | "warning" | "info";
  rule: string;
  description: string;
  line?: number;
}

export interface TestResult {
  skillName: string;
  triggered: boolean;
  matchedTriggers: string[];
  promptGenerated: string;
  toolsAvailable: string[];
  permissionsRequired: string[];
  durationMs: number;
}

export interface PackageResult {
  name: string;
  version: string;
  files: string[];
  size: number;
  hash: string;
  outputPath: string;
  warnings: string[];
}

// ─── Security Rules ─────────────────────────────────────────────────────────

const SECURITY_RULES: Array<{
  name: string;
  pattern: RegExp;
  severity: SecurityIssue["severity"];
  description: string;
}> = [
  {
    name: "env-exfiltration",
    pattern: /process\.env\[|process\.env\./i,
    severity: "critical",
    description: "Direct environment variable access — use config fields instead",
  },
  {
    name: "eval-usage",
    pattern: /\beval\s*\(|new\s+Function\s*\(/i,
    severity: "critical",
    description: "Dynamic code execution detected (eval/Function constructor)",
  },
  {
    name: "child-process",
    pattern: /child_process|exec\(|execSync|spawn\(/i,
    severity: "warning",
    description: "Shell command execution — ensure this is necessary and sandboxed",
  },
  {
    name: "network-unrestricted",
    pattern: /fetch\s*\(\s*[`'"]https?:\/\/\$|fetch\s*\(\s*\w+\s*\+/i,
    severity: "warning",
    description: "Dynamic URL construction — validate destinations",
  },
  {
    name: "fs-write",
    pattern: /writeFileSync|writeFile|appendFile|fs\.write/i,
    severity: "info",
    description: "File write operation — ensure correct permissions declared",
  },
  {
    name: "base64-obfuscation",
    pattern: /atob\(|btoa\(|Buffer\.from\(.*base64/i,
    severity: "warning",
    description: "Base64 encoding detected — review for obfuscation",
  },
  {
    name: "credential-pattern",
    pattern: /password|secret|token|api[_-]?key/i,
    severity: "info",
    description: "Credential-related keyword — ensure secrets use CredentialVault",
  },
];

// ─── Required & Valid Fields ────────────────────────────────────────────────

const REQUIRED_FIELDS = ["name", "version", "description", "author", "category", "triggers"];
const VALID_CATEGORIES = [
  "productivity", "developer-tools", "finance", "content", "communication",
  "security", "analytics", "integration", "automation", "iot", "ai-ml",
  "data", "devops", "health", "education", "entertainment",
];
const VALID_PERMISSIONS = [
  "network", "network:outbound", "network:inbound",
  "file_read", "file_write", "filesystem",
  "shell_exec", "shell",
  "memory", "memory:read", "memory:write",
  "credentials:read", "credentials:write",
  "browser", "camera", "microphone",
  "env", "database", "schedule",
];
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

// ─── Skill SDK ──────────────────────────────────────────────────────────────

export class SkillSDK {
  private skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || path.join(process.cwd(), "skills");
  }

  // ── Create ──────────────────────────────────────────────────────────────

  async create(name: string, options: CreateOptions = {}): Promise<string> {
    const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    const outDir = options.outputDir || this.skillsDir;
    const skillDir = path.join(outDir, safeName);

    try {
      await fs.access(skillDir);
      throw new Error(`Skill directory already exists: ${skillDir}`);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }

    await fs.mkdir(skillDir, { recursive: true });

    const manifest: SkillManifest = {
      name: safeName,
      version: options.version || "1.0.0",
      description: options.description || `${safeName} skill for AstraOS`,
      author: options.author || "AstraOS Developer",
      category: options.category || "productivity",
      tags: options.tags || [safeName],
      triggers: options.triggers || [safeName.replace(/-/g, " ")],
      permissions: options.permissions || ["network"],
    };

    const systemPrompt = this.buildDefaultPrompt(manifest, options.template);
    const content = this.renderSkillMd(manifest, systemPrompt);

    const filePath = path.join(skillDir, "SKILL.md");
    await fs.writeFile(filePath, content, "utf-8");

    // Create handler.ts if template suggests tools
    if (options.template === "tool" || options.template === "api-connector") {
      const handlerContent = this.generateHandler(manifest);
      await fs.writeFile(path.join(skillDir, "handler.ts"), handlerContent, "utf-8");
    }

    // Create README.md for the skill
    const readme = this.generateSkillReadme(manifest);
    await fs.writeFile(path.join(skillDir, "README.md"), readme, "utf-8");

    logger.info(`Skill created: ${skillDir}`);
    return skillDir;
  }

  // ── Validate ────────────────────────────────────────────────────────────

  async validate(skillPath: string): Promise<ValidateResult> {
    const result: ValidateResult = {
      valid: true,
      errors: [],
      warnings: [],
      securityIssues: [],
    };

    // Resolve SKILL.md path
    let mdPath = skillPath;
    const stat = await fs.stat(skillPath).catch(() => null);
    if (stat?.isDirectory()) {
      mdPath = path.join(skillPath, "SKILL.md");
    }

    // Check file exists
    try {
      await fs.access(mdPath);
    } catch {
      result.valid = false;
      result.errors.push(`SKILL.md not found at: ${mdPath}`);
      return result;
    }

    const content = await fs.readFile(mdPath, "utf-8");

    // Parse frontmatter
    const parsed = this.parseFrontmatter(content);
    if (!parsed) {
      result.valid = false;
      result.errors.push("Invalid SKILL.md: missing or malformed YAML frontmatter (must start with ---)");
      return result;
    }

    const { frontmatter, body } = parsed;
    result.manifest = frontmatter as unknown as SkillManifest;

    // Required fields
    for (const field of REQUIRED_FIELDS) {
      if (!frontmatter[field]) {
        result.valid = false;
        result.errors.push(`Missing required field: ${field}`);
      }
    }

    // Version format
    const version = frontmatter.version as string | undefined;
    if (version && !SEMVER_REGEX.test(version)) {
      result.warnings.push(`Version "${version}" is not valid semver (expected X.Y.Z)`);
    }

    // Category validation
    const category = frontmatter.category as string | undefined;
    if (category && !VALID_CATEGORIES.includes(category)) {
      result.warnings.push(
        `Category "${category}" is not standard. Valid: ${VALID_CATEGORIES.join(", ")}`
      );
    }

    // Permissions validation
    if (Array.isArray(frontmatter.permissions)) {
      for (const perm of frontmatter.permissions) {
        if (!VALID_PERMISSIONS.includes(perm)) {
          result.warnings.push(`Unknown permission: "${perm}". Valid: ${VALID_PERMISSIONS.join(", ")}`);
        }
      }
    }

    // Triggers check
    if (Array.isArray(frontmatter.triggers)) {
      if (frontmatter.triggers.length === 0) {
        result.warnings.push("No triggers defined — skill will never activate automatically");
      }
      for (const trigger of frontmatter.triggers) {
        if (trigger.length < 2) {
          result.warnings.push(`Trigger "${trigger}" is too short — may cause false matches`);
        }
        if (trigger.length > 50) {
          result.warnings.push(`Trigger "${trigger}" is very long — shorter triggers match more reliably`);
        }
      }
    }

    // System prompt check
    if (!body || body.trim().length < 20) {
      result.warnings.push("System prompt is very short — provide detailed behavior guidelines for best results");
    }

    // Description length
    const description = frontmatter.description as string | undefined;
    if (description && description.length > 200) {
      result.warnings.push("Description exceeds 200 chars — consider shortening for marketplace display");
    }

    // Name format
    const nameStr = frontmatter.name as string | undefined;
    if (nameStr && !/^[a-z0-9][a-z0-9-]*$/.test(nameStr)) {
      result.errors.push("Name must be lowercase alphanumeric with hyphens (e.g., my-skill)");
      result.valid = false;
    }

    // Security scan
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const rule of SECURITY_RULES) {
        if (rule.pattern.test(lines[i])) {
          result.securityIssues.push({
            severity: rule.severity,
            rule: rule.name,
            description: rule.description,
            line: i + 1,
          });
          if (rule.severity === "critical") {
            result.valid = false;
            result.errors.push(`Security: ${rule.description} (line ${i + 1})`);
          }
        }
      }
    }

    // Check for extra files
    if (stat?.isDirectory()) {
      const files = await fs.readdir(skillPath);
      const allowedExtensions = [".md", ".ts", ".js", ".json", ".yaml", ".yml", ".txt", ".png", ".svg"];
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (ext && !allowedExtensions.includes(ext)) {
          result.warnings.push(`Unexpected file type: ${file} — may be excluded from packaging`);
        }
      }
    }

    return result;
  }

  // ── Test ─────────────────────────────────────────────────────────────────

  async test(skillPath: string, testMessage: string): Promise<TestResult> {
    const start = Date.now();

    const validateResult = await this.validate(skillPath);
    if (!validateResult.valid || !validateResult.manifest) {
      return {
        skillName: path.basename(skillPath),
        triggered: false,
        matchedTriggers: [],
        promptGenerated: "",
        toolsAvailable: [],
        permissionsRequired: [],
        durationMs: Date.now() - start,
      };
    }

    const manifest = validateResult.manifest;
    const lowerMsg = testMessage.toLowerCase();

    // Check trigger matching
    const matchedTriggers = (manifest.triggers || []).filter(
      (t) => lowerMsg.includes(t.toLowerCase())
    );

    const triggered = matchedTriggers.length > 0;

    // Build prompt if triggered
    let promptGenerated = "";
    if (triggered) {
      const mdPath = (await fs.stat(skillPath)).isDirectory()
        ? path.join(skillPath, "SKILL.md")
        : skillPath;
      const content = await fs.readFile(mdPath, "utf-8");
      const parsed = this.parseFrontmatter(content);
      if (parsed) {
        promptGenerated = `\n--- SKILL: ${manifest.name} (v${manifest.version}) ---\n${parsed.body}`;
      }
    }

    return {
      skillName: manifest.name,
      triggered,
      matchedTriggers,
      promptGenerated,
      toolsAvailable: (manifest.tools || []).map((t) => t.name),
      permissionsRequired: manifest.permissions || [],
      durationMs: Date.now() - start,
    };
  }

  // ── Batch Test ──────────────────────────────────────────────────────────

  async testBatch(
    skillPath: string,
    messages: string[]
  ): Promise<{ results: TestResult[]; summary: { total: number; triggered: number; missed: number } }> {
    const results: TestResult[] = [];
    for (const msg of messages) {
      results.push(await this.test(skillPath, msg));
    }
    const triggered = results.filter((r) => r.triggered).length;
    return {
      results,
      summary: {
        total: messages.length,
        triggered,
        missed: messages.length - triggered,
      },
    };
  }

  // ── Package ─────────────────────────────────────────────────────────────

  async package(skillPath: string): Promise<PackageResult> {
    const validation = await this.validate(skillPath);
    if (!validation.valid) {
      throw new Error(`Skill validation failed:\n${validation.errors.join("\n")}`);
    }

    const manifest = validation.manifest!;
    const stat = await fs.stat(skillPath);
    const dir = stat.isDirectory() ? skillPath : path.dirname(skillPath);

    // Collect files
    const files = await this.collectFiles(dir);
    const allowedExtensions = [".md", ".ts", ".js", ".json", ".yaml", ".yml", ".txt", ".png", ".svg"];

    const includedFiles: string[] = [];
    let totalSize = 0;
    const warnings: string[] = [];

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!allowedExtensions.includes(ext) && ext !== "") {
        warnings.push(`Skipped: ${file} (unsupported type)`);
        continue;
      }
      const fileStat = await fs.stat(path.join(dir, file));
      if (fileStat.size > 5 * 1024 * 1024) {
        warnings.push(`Skipped: ${file} (exceeds 5MB limit)`);
        continue;
      }
      includedFiles.push(file);
      totalSize += fileStat.size;
    }

    // Compute hash
    const hash = crypto.createHash("sha256");
    for (const file of includedFiles) {
      const content = await fs.readFile(path.join(dir, file));
      hash.update(content);
    }

    // Write package manifest
    const pkgManifest = {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      category: manifest.category,
      files: includedFiles,
      hash: hash.digest("hex"),
      packagedAt: new Date().toISOString(),
    };

    const outputPath = path.join(dir, "package.json");
    await fs.writeFile(outputPath, JSON.stringify(pkgManifest, null, 2), "utf-8");

    if (validation.securityIssues.length > 0) {
      warnings.push(
        `${validation.securityIssues.length} security finding(s) — review before publishing`
      );
    }

    return {
      name: manifest.name,
      version: manifest.version,
      files: includedFiles,
      size: totalSize,
      hash: pkgManifest.hash,
      outputPath,
      warnings,
    };
  }

  // ── List Templates ──────────────────────────────────────────────────────

  listTemplates(): Array<{ name: string; description: string; category: string }> {
    return [
      { name: "basic", description: "Minimal skill with triggers and system prompt", category: "general" },
      { name: "tool", description: "Skill with custom tool definitions and handler", category: "developer-tools" },
      { name: "api-connector", description: "REST API integration with auth support", category: "integration" },
      { name: "webhook-handler", description: "Incoming webhook processing", category: "integration" },
      { name: "database-query", description: "Natural language database interface", category: "data" },
      { name: "email-manager", description: "Gmail/Outlook email operations", category: "communication" },
      { name: "calendar-assistant", description: "Meeting scheduling & calendar management", category: "productivity" },
      { name: "task-tracker", description: "Jira/Trello/Linear integration", category: "productivity" },
      { name: "note-taker", description: "Markdown note storage with search", category: "productivity" },
      { name: "code-reviewer", description: "Multi-language code analysis", category: "developer-tools" },
      { name: "ci-cd-monitor", description: "Pipeline monitoring & alerts", category: "devops" },
      { name: "log-analyzer", description: "Log parsing & anomaly detection", category: "devops" },
      { name: "git-assistant", description: "Git operations & PR management", category: "developer-tools" },
      { name: "data-analyzer", description: "CSV/JSON transformation & analysis", category: "data" },
      { name: "web-scraper", description: "Site crawling with HTML parsing", category: "data" },
      { name: "report-generator", description: "PDF/HTML report creation", category: "content" },
      { name: "slack-bot", description: "Slack app building blocks", category: "communication" },
      { name: "notification-hub", description: "Multi-channel alert routing", category: "communication" },
      { name: "translation", description: "Multi-language text translation", category: "ai-ml" },
      { name: "summarizer", description: "Content condensation & summarization", category: "ai-ml" },
      { name: "smart-home", description: "IoT device control", category: "iot" },
      { name: "expense-tracker", description: "Financial tracking & categorization", category: "finance" },
      { name: "stock-watcher", description: "Market monitoring & alerts", category: "finance" },
    ];
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private renderSkillMd(manifest: SkillManifest, systemPrompt: string): string {
    const lines: string[] = ["---"];
    lines.push(`name: ${manifest.name}`);
    lines.push(`version: ${manifest.version}`);
    lines.push(`description: "${manifest.description}"`);
    lines.push(`author: ${manifest.author}`);
    lines.push(`category: ${manifest.category}`);

    lines.push("tags:");
    for (const tag of manifest.tags) lines.push(`  - ${tag}`);

    lines.push("triggers:");
    for (const t of manifest.triggers) lines.push(`  - "${t}"`);

    lines.push("permissions:");
    for (const p of manifest.permissions) lines.push(`  - ${p}`);

    if (manifest.tools && manifest.tools.length > 0) {
      lines.push("tools:");
      for (const tool of manifest.tools) {
        lines.push(`  - name: ${tool.name}`);
        lines.push(`    description: "${tool.description}"`);
        if (tool.handler) {
          lines.push(`    handler: ${tool.handler}`);
        }
      }
    }

    lines.push("---");
    lines.push("");
    lines.push(systemPrompt);

    return lines.join("\n");
  }

  private buildDefaultPrompt(manifest: SkillManifest, template?: string): string {
    const name = manifest.name.replace(/-/g, " ");

    if (template === "api-connector") {
      return [
        `You are an API integration assistant for ${name}.`,
        "",
        "## Capabilities",
        "- Make HTTP requests to configured API endpoints",
        "- Handle authentication (API key, Bearer token, OAuth)",
        "- Parse and format JSON/XML responses",
        "- Handle pagination and rate limiting",
        "",
        "## Guidelines",
        "- Always validate URLs before making requests",
        "- Never log or expose authentication credentials",
        "- Handle errors gracefully with clear messages",
        "- Respect rate limits and implement backoff",
      ].join("\n");
    }

    if (template === "tool") {
      return [
        `You are a specialized assistant for ${name}.`,
        "",
        "## Capabilities",
        "- Use the provided tools to accomplish tasks",
        "- Validate inputs before tool execution",
        "- Report results clearly",
        "",
        "## Guidelines",
        "- Always confirm destructive operations",
        "- Handle tool errors and retry when appropriate",
        "- Provide progress updates for long operations",
      ].join("\n");
    }

    return [
      `You are an expert assistant for ${name}.`,
      "",
      "## Capabilities",
      `- ${manifest.description}`,
      "",
      "## Guidelines",
      "- Provide clear, actionable responses",
      "- Ask for clarification when the request is ambiguous",
      "- Always prioritize safety and data privacy",
      "- Format output in a readable way (use markdown when helpful)",
    ].join("\n");
  }

  private generateHandler(manifest: SkillManifest): string {
    return [
      `/**`,
      ` * ${manifest.name} — Tool Handler`,
      ` * Implements custom tool logic for this skill.`,
      ` */`,
      ``,
      `export interface ToolContext {`,
      `  skillName: string;`,
      `  userId?: string;`,
      `  config: Record<string, unknown>;`,
      `}`,
      ``,
      `export async function handle(`,
      `  toolName: string,`,
      `  input: Record<string, unknown>,`,
      `  context: ToolContext`,
      `): Promise<{ result: unknown; error?: string }> {`,
      `  switch (toolName) {`,
      `    case "example_tool":`,
      `      return { result: { message: "Hello from ${manifest.name}!", input } };`,
      ``,
      `    default:`,
      `      return { result: null, error: \`Unknown tool: \${toolName}\` };`,
      `  }`,
      `}`,
      ``,
    ].join("\n");
  }

  private generateSkillReadme(manifest: SkillManifest): string {
    return [
      `# ${manifest.name}`,
      ``,
      `> ${manifest.description}`,
      ``,
      `**Category:** ${manifest.category}  `,
      `**Version:** ${manifest.version}  `,
      `**Author:** ${manifest.author}`,
      ``,
      `## Triggers`,
      ``,
      ...manifest.triggers.map((t) => `- "${t}"`),
      ``,
      `## Permissions`,
      ``,
      ...manifest.permissions.map((p) => `- \`${p}\``),
      ``,
      `## Usage`,
      ``,
      "```",
      `# Install via AstraHub`,
      `npx astra-hub install ${manifest.name}`,
      ``,
      `# Or copy to your skills directory`,
      `cp -r ${manifest.name}/ ./skills/`,
      "```",
      ``,
      `## Development`,
      ``,
      "```typescript",
      `import { SkillSDK } from 'astra-os/dist/skills/SkillSDK';`,
      ``,
      `const sdk = new SkillSDK();`,
      ``,
      `// Validate`,
      `const result = await sdk.validate('./skills/${manifest.name}');`,
      `console.log(result);`,
      ``,
      `// Test trigger matching`,
      `const test = await sdk.test('./skills/${manifest.name}', '${manifest.triggers[0] || "test"}');`,
      `console.log(test);`,
      "```",
      ``,
    ].join("\n");
  }

  private parseFrontmatter(
    content: string
  ): { frontmatter: Record<string, unknown>; body: string } | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return null;

    const yamlStr = match[1];
    const body = match[2];
    const frontmatter: Record<string, unknown> = {};

    let currentKey = "";
    let currentArray: string[] | null = null;

    for (const line of yamlStr.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      if (trimmed.startsWith("- ") && currentKey && currentArray !== null) {
        currentArray.push(trimmed.slice(2).replace(/^["']|["']$/g, ""));
        frontmatter[currentKey] = currentArray;
        continue;
      }

      if (currentArray !== null) {
        currentArray = null;
      }

      const kvMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
      if (kvMatch) {
        currentKey = kvMatch[1];
        const value = kvMatch[2].replace(/^["']|["']$/g, "").trim();
        if (value === "" || value === "[]") {
          currentArray = [];
          frontmatter[currentKey] = currentArray;
        } else {
          frontmatter[currentKey] = value;
        }
      }
    }

    return { frontmatter, body };
  }

  private async collectFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith(".")) {
        files.push(entry.name);
      }
    }
    return files;
  }
}

// ─── Express Router (mount at /api/sdk) ─────────────────────────────────────

export function createSDKRouter(): import("express").Router {
  type Req = import("express").Request;
  type Res = import("express").Response;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Router: ExpressRouter } = require("express");
  const router = ExpressRouter();
  const sdk = new SkillSDK();

  router.get("/templates", (_req: Req, res: Res) => {
    res.json({ templates: sdk.listTemplates() });
  });

  router.post("/create", async (req: Req, res: Res) => {
    try {
      const { name, ...options } = req.body;
      if (!name) return res.status(400).json({ error: "name is required" });
      const dir = await sdk.create(name, options);
      res.json({ success: true, directory: dir });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.post("/validate", async (req: Req, res: Res) => {
    try {
      const { path: skillPath } = req.body;
      if (!skillPath) return res.status(400).json({ error: "path is required" });
      const result = await sdk.validate(skillPath);
      res.json(result);
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post("/test", async (req: Req, res: Res) => {
    try {
      const { path: skillPath, message, messages } = req.body;
      if (!skillPath) return res.status(400).json({ error: "path is required" });
      if (messages && Array.isArray(messages)) {
        const result = await sdk.testBatch(skillPath, messages);
        return res.json(result);
      }
      if (!message) return res.status(400).json({ error: "message is required" });
      const result = await sdk.test(skillPath, message);
      res.json(result);
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post("/package", async (req: Req, res: Res) => {
    try {
      const { path: skillPath } = req.body;
      if (!skillPath) return res.status(400).json({ error: "path is required" });
      const result = await sdk.package(skillPath);
      res.json(result);
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  return router;
}
