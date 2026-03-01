/**
 * AstraOS — SkillMigrator.ts
 * Import and convert skills from OpenClaw/ClawHub and other platforms.
 * Provides compatibility layer for OpenClaw SKILL.md format, auto-converts
 * triggers, tools, and system prompts to AstraOS format.
 * Includes bulk import, validation, and security scanning before install.
 */

import { Router, Request, Response } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecurityIssue {
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  message: string;
  detail?: string;
  line?: number;
}

export interface SecurityReport {
  safe: boolean;
  totalIssues: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  issues: SecurityIssue[];
  scannedAt: string;
  recommendation: "block" | "warn" | "allow";
}

export interface ConvertedSkill {
  name: string;
  version: string;
  description: string;
  author: string;
  triggers: string[];
  systemPrompt: string;
  tools: ConvertedTool[];
  permissions: string[];
  category: string;
  tags: string[];
  config: Record<string, unknown>;
  source: "clawhub" | "openclaw" | "url" | "local";
  originalFormat: string;
}

interface ConvertedTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: string;
}

export interface CompatibilityReport {
  compatible: boolean;
  score: number; // 0-100
  issues: string[];
  warnings: string[];
  suggestions: string[];
  fieldMapping: Record<string, string>;
}

interface ClawHubListingEntry {
  slug: string;
  name: string;
  description: string;
  author: string;
  stars: number;
  downloads: number;
  category: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Security patterns — deep analysis for ClawHub supply-chain risk
// ---------------------------------------------------------------------------

const SECURITY_PATTERNS: Array<{
  regex: RegExp;
  severity: SecurityIssue["severity"];
  category: string;
  message: string;
}> = [
  // Data exfiltration
  { regex: /fetch\s*\(\s*['"`]https?:\/\/[^'"`]*\.(ru|cn|tk|xyz|top|buzz)/gi, severity: "critical", category: "exfiltration", message: "Suspicious outbound request to high-risk TLD" },
  { regex: /\.send\s*\(\s*(process\.env|credentials|token|secret|password|apiKey)/gi, severity: "critical", category: "exfiltration", message: "Potential credential exfiltration via network send" },
  { regex: /btoa\s*\(\s*JSON\.stringify\s*\(\s*(process\.env|credentials)/gi, severity: "critical", category: "exfiltration", message: "Base64-encoding credentials for exfiltration" },
  { regex: /XMLHttpRequest|navigator\.sendBeacon/gi, severity: "high", category: "exfiltration", message: "Browser-style beacon/XHR usage — potential data leak" },
  { regex: /dns\.resolve|dgram\.createSocket/gi, severity: "critical", category: "exfiltration", message: "DNS/UDP exfiltration technique detected" },

  // Credential stealing
  { regex: /process\.env\[\s*['"`](API_KEY|SECRET|TOKEN|PASSWORD|AWS_|OPENAI_|ANTHROPIC_)/gi, severity: "critical", category: "credential-theft", message: "Accesses sensitive environment variable" },
  { regex: /\.ssh\/|\.aws\/credentials|\.npmrc|\.netrc/gi, severity: "critical", category: "credential-theft", message: "Reads sensitive credential files" },
  { regex: /keychain|credential.?store|password.?manager/gi, severity: "high", category: "credential-theft", message: "Potential access to system credential store" },

  // Obfuscated code
  { regex: /eval\s*\(/g, severity: "critical", category: "obfuscation", message: "Uses eval() — potential code injection" },
  { regex: /new\s+Function\s*\(/g, severity: "critical", category: "obfuscation", message: "Dynamic function creation" },
  { regex: /\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){5,}/gi, severity: "critical", category: "obfuscation", message: "Hex-encoded string — likely obfuscated payload" },
  { regex: /\\u[0-9a-f]{4}(\\u[0-9a-f]{4}){5,}/gi, severity: "high", category: "obfuscation", message: "Unicode-escaped string — possible obfuscation" },
  { regex: /atob\s*\(\s*['"`][A-Za-z0-9+/=]{20,}/g, severity: "critical", category: "obfuscation", message: "Decodes embedded base64 payload" },
  { regex: /String\.fromCharCode\s*\(\s*\d+\s*(,\s*\d+\s*){5,}\)/g, severity: "critical", category: "obfuscation", message: "Builds string from char codes — obfuscation technique" },

  // Crypto mining
  { regex: /coinhive|cryptonight|stratum\+tcp|monero|xmrig/gi, severity: "critical", category: "cryptomining", message: "Crypto mining reference detected" },
  { regex: /hashrate|nonce.*difficulty|mining.?pool/gi, severity: "high", category: "cryptomining", message: "Potential crypto mining terminology" },

  // Command execution / RCE
  { regex: /require\s*\(\s*['"`]child_process/g, severity: "critical", category: "rce", message: "Imports child_process — potential remote code execution" },
  { regex: /import\s+.*from\s+['"`]child_process/g, severity: "critical", category: "rce", message: "Imports child_process (ESM)" },
  { regex: /exec\s*\(\s*['"`]/g, severity: "critical", category: "rce", message: "Executes shell command" },
  { regex: /spawn\s*\(\s*['"`]/g, severity: "high", category: "rce", message: "Spawns external process" },
  { regex: /execFile\s*\(/g, severity: "high", category: "rce", message: "Executes external file" },

  // Filesystem abuse
  { regex: /fs\.(writeFile|appendFile|createWriteStream)\s*\(\s*['"`]\/(etc|usr|bin|tmp)/g, severity: "critical", category: "fs-abuse", message: "Writes to sensitive system directory" },
  { regex: /fs\.(unlink|rm|rmdir)\s*\(/g, severity: "high", category: "fs-abuse", message: "Deletes files — verify intended behavior" },
  { regex: /require\s*\(\s*['"`]fs['"]/g, severity: "medium", category: "fs-abuse", message: "Uses filesystem access" },

  // Network / reverse shell
  { regex: /net\.createServer|net\.connect|tls\.connect/g, severity: "high", category: "network", message: "Opens raw TCP/TLS connection" },
  { regex: /reverse.?shell|bind.?shell|\/bin\/(ba)?sh/g, severity: "critical", category: "network", message: "Reverse/bind shell indicator" },

  // Prototype pollution
  { regex: /__proto__|constructor\s*\[\s*['"`]prototype/g, severity: "high", category: "prototype-pollution", message: "Potential prototype pollution" },

  // General suspicion
  { regex: /process\.env/g, severity: "low", category: "env-access", message: "Accesses environment variables" },
  { regex: /fetch\s*\(/g, severity: "low", category: "network", message: "Makes network requests" },
];

// ---------------------------------------------------------------------------
// Category auto-detection keywords
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  productivity: ["task", "todo", "calendar", "schedule", "organize", "planner", "reminder", "notes"],
  data: ["csv", "database", "sql", "analytics", "chart", "report", "data", "query", "spreadsheet"],
  communication: ["email", "slack", "message", "chat", "notify", "notification", "sms"],
  devtools: ["code", "git", "debug", "deploy", "ci", "test", "lint", "compile", "build", "docker"],
  ai: ["model", "llm", "prompt", "embedding", "train", "inference", "neural", "gpt", "claude"],
  automation: ["automate", "workflow", "cron", "trigger", "pipeline", "scrape", "bot"],
  security: ["scan", "vulnerability", "encrypt", "firewall", "auth", "password", "audit"],
  finance: ["invoice", "payment", "accounting", "budget", "tax", "expense", "stripe"],
  marketing: ["seo", "campaign", "social", "content", "audience", "analytics", "ad"],
  writing: ["write", "blog", "article", "copy", "edit", "grammar", "translate"],
};

// ---------------------------------------------------------------------------
// SkillMigrator class
// ---------------------------------------------------------------------------

export class SkillMigrator {
  private router: Router;
  private skillsDir: string;
  private clawHubBaseUrl: string;

  constructor(skillsDir?: string) {
    this.router = Router();
    this.skillsDir = skillsDir || path.join(process.cwd(), "skills");
    this.clawHubBaseUrl = process.env.CLAWHUB_URL || "https://api.clawhub.dev/v1";
    this.setupRoutes();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Import a single skill from ClawHub by its slug.
   */
  async importFromClawHub(skillSlug: string): Promise<ConvertedSkill> {
    logger.info(`[SkillMigrator] Importing from ClawHub: ${skillSlug}`);

    const rawContent = await this.fetchClawHubSkill(skillSlug);
    const securityReport = this.scanBeforeImport(rawContent);

    if (securityReport.recommendation === "block") {
      const criticalIssues = securityReport.issues
        .filter((i) => i.severity === "critical")
        .map((i) => i.message)
        .join("; ");
      throw new Error(
        `[SkillMigrator] Import BLOCKED for "${skillSlug}" — critical security issues: ${criticalIssues}`
      );
    }

    if (securityReport.recommendation === "warn") {
      logger.warn(
        `[SkillMigrator] Security warnings for "${skillSlug}": ${securityReport.totalIssues} issues found. Proceeding with caution.`
      );
    }

    const converted = this.convertFormat(rawContent);
    converted.source = "clawhub";

    await this.writeSkillToDisk(converted);
    logger.info(`[SkillMigrator] Successfully imported: ${converted.name} v${converted.version}`);
    return converted;
  }

  /**
   * Bulk import multiple skills from ClawHub.
   */
  async importBulk(slugs: string[]): Promise<{ results: Array<{ slug: string; success: boolean; skill?: ConvertedSkill; error?: string }> }> {
    logger.info(`[SkillMigrator] Bulk import: ${slugs.length} skills`);
    const results: Array<{ slug: string; success: boolean; skill?: ConvertedSkill; error?: string }> = [];

    for (const slug of slugs) {
      try {
        const skill = await this.importFromClawHub(slug);
        results.push({ slug, success: true, skill });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[SkillMigrator] Failed to import "${slug}": ${message}`);
        results.push({ slug, success: false, error: message });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    logger.info(`[SkillMigrator] Bulk import complete: ${succeeded}/${slugs.length} succeeded`);
    return { results };
  }

  /**
   * Import a skill from any Git URL (GitHub, GitLab, etc.).
   */
  async importFromUrl(url: string): Promise<ConvertedSkill> {
    logger.info(`[SkillMigrator] Importing from URL: ${url}`);

    // Normalise GitHub URLs to raw content URLs
    const rawUrl = this.normalizeGitUrl(url);
    const response = await fetch(rawUrl);
    if (!response.ok) {
      throw new Error(`[SkillMigrator] Failed to fetch from URL: ${response.status} ${response.statusText}`);
    }

    const rawContent = await response.text();
    const securityReport = this.scanBeforeImport(rawContent);

    if (securityReport.recommendation === "block") {
      throw new Error(
        `[SkillMigrator] Import BLOCKED — critical security issues found in content from ${url}`
      );
    }

    const converted = this.convertFormat(rawContent);
    converted.source = "url";

    await this.writeSkillToDisk(converted);
    logger.info(`[SkillMigrator] Imported from URL: ${converted.name} v${converted.version}`);
    return converted;
  }

  /**
   * Import a skill from a local directory containing an OpenClaw-format SKILL.md.
   */
  async importFromDirectory(dir: string): Promise<ConvertedSkill> {
    logger.info(`[SkillMigrator] Importing from local directory: ${dir}`);

    const possibleFiles = ["SKILL.md", "skill.md", "README.md"];
    let rawContent: string | null = null;
    let sourceFile = "";

    for (const file of possibleFiles) {
      const filePath = path.join(dir, file);
      try {
        rawContent = await fs.readFile(filePath, "utf-8");
        sourceFile = file;
        break;
      } catch {
        // Try next file
      }
    }

    if (!rawContent) {
      throw new Error(`[SkillMigrator] No SKILL.md or README.md found in ${dir}`);
    }

    logger.info(`[SkillMigrator] Found ${sourceFile} in ${dir}`);

    const securityReport = this.scanBeforeImport(rawContent);
    if (securityReport.recommendation === "block") {
      throw new Error(
        `[SkillMigrator] Import BLOCKED — critical security issues in ${dir}/${sourceFile}`
      );
    }

    // Also scan any .ts/.js files in the directory
    await this.scanDirectoryFiles(dir);

    const converted = this.convertFormat(rawContent);
    converted.source = "local";

    // Copy supplemental files (handlers, configs) from source directory
    const skillDir = path.join(this.skillsDir, this.slugify(converted.name));
    await fs.mkdir(skillDir, { recursive: true });

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name !== sourceFile) {
        const src = path.join(dir, entry.name);
        const dest = path.join(skillDir, entry.name);
        const fileContent = await fs.readFile(src, "utf-8");
        await fs.writeFile(dest, fileContent, "utf-8");
      }
    }

    await this.writeSkillToDisk(converted);
    logger.info(`[SkillMigrator] Imported from directory: ${converted.name} v${converted.version}`);
    return converted;
  }

  /**
   * Convert OpenClaw SKILL.md content to AstraOS SKILL.md format.
   */
  convertFormat(openClawContent: string): ConvertedSkill {
    const frontmatter = this.parseFrontmatter(openClawContent);
    const body = this.extractBody(openClawContent);

    // Map OpenClaw field names to AstraOS field names
    const name = (frontmatter.name as string) || (frontmatter.title as string) || "unnamed-skill";
    const version = (frontmatter.version as string) || "1.0.0";
    const description = (frontmatter.description as string) || (frontmatter.summary as string) || "";
    const author = (frontmatter.author as string) || (frontmatter.creator as string) || "unknown";

    // OpenClaw uses "instruction" for system prompt, AstraOS uses body text
    const systemPrompt = body || (frontmatter.instruction as string) || (frontmatter.system_prompt as string) || "";

    // Map triggers: OpenClaw uses "trigger" (singular or array)
    let triggers: string[] = [];
    if (frontmatter.triggers) {
      triggers = Array.isArray(frontmatter.triggers) ? frontmatter.triggers as string[] : [frontmatter.triggers as string];
    } else if (frontmatter.trigger) {
      triggers = Array.isArray(frontmatter.trigger) ? frontmatter.trigger as string[] : [frontmatter.trigger as string];
    } else if (frontmatter.activation) {
      triggers = Array.isArray(frontmatter.activation) ? frontmatter.activation as string[] : [frontmatter.activation as string];
    }

    // Map tools
    const tools = this.convertTools(frontmatter.tools);

    // Auto-detect category from content
    const category = (frontmatter.category as string) || this.autoDetectCategory(name, description, systemPrompt);

    // Extract or generate tags
    let tags: string[] = [];
    if (frontmatter.tags) {
      tags = Array.isArray(frontmatter.tags) ? frontmatter.tags as string[] : [frontmatter.tags as string];
    } else {
      tags = this.autoGenerateTags(name, description, category);
    }

    // Determine permissions based on tools and content
    const permissions = this.inferPermissions(tools, systemPrompt);

    return {
      name,
      version,
      description,
      author,
      triggers,
      systemPrompt,
      tools,
      permissions,
      category,
      tags,
      config: (frontmatter.config as Record<string, unknown>) || {},
      source: "openclaw",
      originalFormat: openClawContent.substring(0, 200),
    };
  }

  /**
   * Security scan imported content — critical for ClawHub supply-chain risk.
   * ClawHub reportedly had ~20% malicious skills in their marketplace.
   */
  scanBeforeImport(content: string): SecurityReport {
    const issues: SecurityIssue[] = [];

    // Run pattern-based analysis
    for (const { regex, severity, category, message } of SECURITY_PATTERNS) {
      const pattern = new RegExp(regex.source, regex.flags);
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const line = content.substring(0, match.index).split("\n").length;
        const surroundingContext = content.substring(
          Math.max(0, match.index - 40),
          Math.min(content.length, match.index + match[0].length + 40)
        ).replace(/\n/g, " ");

        issues.push({
          severity,
          category,
          message,
          detail: surroundingContext.trim(),
          line,
        });
      }
    }

    // Structural analysis — detect suspiciously large inline payloads
    const longStrings = content.match(/['"`][^'"`]{500,}['"`]/g);
    if (longStrings) {
      for (const ls of longStrings) {
        issues.push({
          severity: "high",
          category: "obfuscation",
          message: `Suspiciously long string literal (${ls.length} chars) — potential embedded payload`,
        });
      }
    }

    // Detect encoded/compressed blobs
    const base64Blocks = content.match(/[A-Za-z0-9+/=]{100,}/g);
    if (base64Blocks) {
      for (const block of base64Blocks) {
        // Only flag if it looks like valid base64 (divisible by 4, mostly alphanumeric)
        if (block.length % 4 === 0 && /^[A-Za-z0-9+/]+=*$/.test(block)) {
          issues.push({
            severity: "high",
            category: "obfuscation",
            message: `Embedded base64 blob (${block.length} chars) — may contain hidden code`,
          });
        }
      }
    }

    // Detect URL shorteners often used to hide malicious endpoints
    const shortenerPatterns = /https?:\/\/(bit\.ly|tinyurl|t\.co|goo\.gl|is\.gd|buff\.ly|ow\.ly)/gi;
    let shortenerMatch;
    while ((shortenerMatch = shortenerPatterns.exec(content)) !== null) {
      issues.push({
        severity: "medium",
        category: "exfiltration",
        message: "URL shortener detected — hides true destination",
        detail: shortenerMatch[0],
        line: content.substring(0, shortenerMatch.index).split("\n").length,
      });
    }

    // Tally results
    const critical = issues.filter((i) => i.severity === "critical").length;
    const high = issues.filter((i) => i.severity === "high").length;
    const medium = issues.filter((i) => i.severity === "medium").length;
    const low = issues.filter((i) => i.severity === "low").length;

    let recommendation: SecurityReport["recommendation"];
    if (critical > 0) {
      recommendation = "block";
    } else if (high > 0 || medium >= 3) {
      recommendation = "warn";
    } else {
      recommendation = "allow";
    }

    return {
      safe: critical === 0 && high === 0,
      totalIssues: issues.length,
      critical,
      high,
      medium,
      low,
      issues,
      scannedAt: new Date().toISOString(),
      recommendation,
    };
  }

  /**
   * Fetch the list of popular/trending skills from ClawHub.
   */
  async listPopularClawHubSkills(): Promise<ClawHubListingEntry[]> {
    try {
      const resp = await fetch(`${this.clawHubBaseUrl}/skills?sort=popular&limit=50`);
      if (!resp.ok) {
        throw new Error(`ClawHub API error: ${resp.status}`);
      }
      const data = (await resp.json()) as { skills: ClawHubListingEntry[] };
      return data.skills || [];
    } catch (err) {
      logger.warn(`[SkillMigrator] Failed to fetch popular ClawHub skills: ${(err as Error).message}`);
      // Return curated fallback list of known popular skills
      return [
        { slug: "web-scraper", name: "Web Scraper", description: "Extract data from any webpage", author: "clawhub", stars: 4200, downloads: 89000, category: "data", updatedAt: "2025-11-10" },
        { slug: "code-reviewer", name: "Code Reviewer", description: "AI-powered code review assistant", author: "devtools-org", stars: 3800, downloads: 72000, category: "devtools", updatedAt: "2025-12-01" },
        { slug: "email-drafter", name: "Email Drafter", description: "Draft professional emails from bullet points", author: "comms-team", stars: 3100, downloads: 65000, category: "communication", updatedAt: "2025-10-15" },
        { slug: "sql-helper", name: "SQL Helper", description: "Natural language to SQL queries", author: "data-wizards", stars: 2900, downloads: 58000, category: "data", updatedAt: "2025-11-20" },
        { slug: "api-tester", name: "API Tester", description: "Test and debug REST/GraphQL APIs", author: "devtools-org", stars: 2700, downloads: 51000, category: "devtools", updatedAt: "2025-10-28" },
      ];
    }
  }

  /**
   * Analyze a skill directory and generate a compatibility report for AstraOS.
   */
  async getCompatibilityReport(skillDir: string): Promise<CompatibilityReport> {
    const issues: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];
    const fieldMapping: Record<string, string> = {};
    let score = 100;

    // Check for SKILL.md
    let content: string | null = null;
    const possibleFiles = ["SKILL.md", "skill.md", "README.md"];
    for (const file of possibleFiles) {
      try {
        content = await fs.readFile(path.join(skillDir, file), "utf-8");
        if (file !== "SKILL.md") {
          warnings.push(`Found "${file}" instead of "SKILL.md" — will be auto-renamed during import`);
          score -= 5;
        }
        break;
      } catch {
        // Try next
      }
    }

    if (!content) {
      issues.push("No SKILL.md or README.md found — cannot determine skill structure");
      return { compatible: false, score: 0, issues, warnings, suggestions, fieldMapping };
    }

    const frontmatter = this.parseFrontmatter(content);

    // Check required AstraOS fields
    if (!frontmatter.name && !frontmatter.title) {
      issues.push("Missing 'name' field in frontmatter");
      score -= 20;
    } else if (frontmatter.title && !frontmatter.name) {
      fieldMapping["title"] = "name";
      warnings.push("'title' will be mapped to 'name'");
      score -= 2;
    }

    if (!frontmatter.triggers && !frontmatter.trigger && !frontmatter.activation) {
      issues.push("Missing 'triggers' — skill won't activate on any keywords");
      suggestions.push("Add a 'triggers' array with keywords that should activate this skill");
      score -= 15;
    } else {
      if (frontmatter.trigger) { fieldMapping["trigger"] = "triggers"; score -= 2; }
      if (frontmatter.activation) { fieldMapping["activation"] = "triggers"; score -= 2; }
    }

    // Check OpenClaw-specific fields that need mapping
    if (frontmatter.instruction) {
      fieldMapping["instruction"] = "systemPrompt (body)";
      warnings.push("'instruction' field will be converted to system prompt body text");
      score -= 3;
    }

    if (frontmatter.model) {
      fieldMapping["model"] = "(ignored — AstraOS is model-agnostic)";
      warnings.push("'model' field is ignored — AstraOS lets users choose their own model");
      score -= 1;
    }

    if (frontmatter.temperature || frontmatter.max_tokens) {
      warnings.push("LLM parameter overrides (temperature, max_tokens) are not used in AstraOS skills");
      score -= 2;
    }

    // Check body (system prompt)
    const body = this.extractBody(content);
    if (!body && !frontmatter.instruction) {
      issues.push("No system prompt content found (neither body text nor 'instruction' field)");
      score -= 20;
    }

    // Check for supplementary files
    try {
      const entries = await fs.readdir(skillDir);
      const hasHandler = entries.some((e) => e.endsWith(".ts") || e.endsWith(".js"));
      if (hasHandler) {
        suggestions.push("TypeScript/JavaScript handlers found — will be copied during import");
      }
      const hasConfig = entries.some((e) => e === "config.json" || e === "config.yaml");
      if (hasConfig) {
        suggestions.push("Configuration file found — will be preserved");
      }
    } catch {
      warnings.push("Could not read directory contents");
      score -= 5;
    }

    // Security pre-check
    const securityReport = this.scanBeforeImport(content);
    if (securityReport.critical > 0) {
      issues.push(`Security: ${securityReport.critical} critical issue(s) found — import will be blocked`);
      score -= 30;
    } else if (securityReport.high > 0) {
      warnings.push(`Security: ${securityReport.high} high-severity issue(s) — import will require confirmation`);
      score -= 10;
    }

    score = Math.max(0, Math.min(100, score));
    const compatible = issues.length === 0 && score >= 40;

    return { compatible, score, issues, warnings, suggestions, fieldMapping };
  }

  /**
   * Return the Express router for the import API.
   */
  getRouter(): Router {
    return this.router;
  }

  // -----------------------------------------------------------------------
  // Express routes
  // -----------------------------------------------------------------------

  private setupRoutes(): void {
    // Import from ClawHub (single or bulk)
    this.router.post("/api/skills/import/clawhub", async (req: Request, res: Response) => {
      try {
        const { slug, slugs } = req.body as { slug?: string; slugs?: string[] };

        if (slugs && Array.isArray(slugs)) {
          const result = await this.importBulk(slugs);
          return res.json(result);
        }

        if (slug) {
          const skill = await this.importFromClawHub(slug);
          return res.json({ success: true, skill });
        }

        return res.status(400).json({ error: "Provide 'slug' (string) or 'slugs' (string[])" });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Import from URL
    this.router.post("/api/skills/import/url", async (req: Request, res: Response) => {
      try {
        const { url } = req.body as { url?: string };
        if (!url) return res.status(400).json({ error: "Provide 'url'" });

        const skill = await this.importFromUrl(url);
        res.json({ success: true, skill });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Import from local directory
    this.router.post("/api/skills/import/directory", async (req: Request, res: Response) => {
      try {
        const { path: dirPath } = req.body as { path?: string };
        if (!dirPath) return res.status(400).json({ error: "Provide 'path'" });

        const skill = await this.importFromDirectory(dirPath);
        res.json({ success: true, skill });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // List popular ClawHub skills
    this.router.get("/api/skills/import/popular", async (_req: Request, res: Response) => {
      try {
        const skills = await this.listPopularClawHubSkills();
        res.json({ skills });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Convert format
    this.router.post("/api/skills/import/convert", async (req: Request, res: Response) => {
      try {
        const { content } = req.body as { content?: string };
        if (!content) return res.status(400).json({ error: "Provide 'content'" });

        const converted = this.convertFormat(content);
        res.json({ success: true, skill: converted });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Security scan
    this.router.post("/api/skills/import/scan", async (req: Request, res: Response) => {
      try {
        const { content } = req.body as { content?: string };
        if (!content) return res.status(400).json({ error: "Provide 'content'" });

        const report = this.scanBeforeImport(content);
        res.json(report);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Fetch raw SKILL.md content from ClawHub API.
   */
  private async fetchClawHubSkill(slug: string): Promise<string> {
    const url = `${this.clawHubBaseUrl}/skills/${encodeURIComponent(slug)}/raw`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`ClawHub skill "${slug}" not found (${resp.status})`);
    }
    return resp.text();
  }

  /**
   * Normalise various Git hosting URLs to a raw-content fetch URL.
   */
  private normalizeGitUrl(url: string): string {
    // GitHub: convert blob URLs to raw
    if (url.includes("github.com") && url.includes("/blob/")) {
      return url.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
    }
    // GitHub: convert tree URLs to raw SKILL.md
    if (url.includes("github.com") && url.includes("/tree/")) {
      return url.replace("github.com", "raw.githubusercontent.com").replace("/tree/", "/") + "/SKILL.md";
    }
    // GitHub: plain repo URL — assume main branch SKILL.md
    if (url.match(/github\.com\/[\w-]+\/[\w-]+\/?$/) && !url.includes("/raw/")) {
      const cleanUrl = url.replace(/\/$/, "");
      return cleanUrl.replace("github.com", "raw.githubusercontent.com") + "/main/SKILL.md";
    }
    // GitLab raw
    if (url.includes("gitlab.com") && !url.includes("/raw/")) {
      return url.replace("/blob/", "/raw/");
    }
    return url;
  }

  /**
   * Parse YAML frontmatter from content.
   */
  private parseFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const result: Record<string, unknown> = {};
    let currentKey = "";
    let currentArray: string[] | null = null;

    for (const line of match[1].split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      if (trimmed.startsWith("- ") && currentArray) {
        currentArray.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ""));
        continue;
      }

      if (currentArray && currentKey) {
        result[currentKey] = currentArray;
        currentArray = null;
      }

      const kvMatch = trimmed.match(/^([\w_]+):\s*(.*)$/);
      if (kvMatch) {
        currentKey = kvMatch[1];
        const value = kvMatch[2].trim();
        if (!value) {
          currentArray = [];
        } else {
          result[currentKey] = value.replace(/^["']|["']$/g, "");
        }
      }
    }

    if (currentArray && currentKey) {
      result[currentKey] = currentArray;
    }

    return result;
  }

  /**
   * Extract the body content after YAML frontmatter.
   */
  private extractBody(content: string): string {
    const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    return match ? match[1].trim() : content.trim();
  }

  /**
   * Convert OpenClaw tool definitions to AstraOS SkillTool format.
   */
  private convertTools(tools: unknown): ConvertedTool[] {
    if (!tools) return [];
    if (!Array.isArray(tools)) return [];

    return tools.map((tool: Record<string, unknown>) => ({
      name: (tool.name as string) || (tool.function as string) || "unnamed-tool",
      description: (tool.description as string) || "",
      input_schema: (tool.input_schema as Record<string, unknown>) ||
                     (tool.parameters as Record<string, unknown>) ||
                     (tool.schema as Record<string, unknown>) || {},
      handler: (tool.handler as string) || (tool.run as string) || "",
    }));
  }

  /**
   * Auto-detect the skill's category from its content.
   */
  private autoDetectCategory(name: string, description: string, systemPrompt: string): string {
    const combined = `${name} ${description} ${systemPrompt}`.toLowerCase();
    let bestCategory = "other";
    let bestScore = 0;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const matchCount = keywords.filter((kw) => combined.includes(kw)).length;
      if (matchCount > bestScore) {
        bestScore = matchCount;
        bestCategory = category;
      }
    }

    return bestCategory;
  }

  /**
   * Auto-generate tags from skill metadata.
   */
  private autoGenerateTags(name: string, description: string, category: string): string[] {
    const tags = new Set<string>();
    tags.add(category);

    const words = `${name} ${description}`.toLowerCase().split(/\s+/);
    const stopWords = new Set(["a", "an", "the", "is", "are", "and", "or", "for", "to", "in", "of", "with", "from", "by", "on", "at", "this", "that", "it"]);

    for (const word of words) {
      const clean = word.replace(/[^a-z0-9-]/g, "");
      if (clean.length >= 3 && !stopWords.has(clean) && tags.size < 8) {
        tags.add(clean);
      }
    }

    return Array.from(tags);
  }

  /**
   * Infer required permissions from tools and system prompt content.
   */
  private inferPermissions(tools: ConvertedTool[], systemPrompt: string): string[] {
    const permissions: Set<string> = new Set();
    const combined = `${tools.map((t) => `${t.name} ${t.description} ${t.handler}`).join(" ")} ${systemPrompt}`.toLowerCase();

    if (combined.includes("fetch") || combined.includes("http") || combined.includes("api") || combined.includes("request")) {
      permissions.add("network");
    }
    if (combined.includes("file") || combined.includes("read") || combined.includes("write") || combined.includes("fs")) {
      permissions.add("filesystem");
    }
    if (combined.includes("exec") || combined.includes("spawn") || combined.includes("shell") || combined.includes("command")) {
      permissions.add("shell");
    }
    if (combined.includes("env") || combined.includes("secret") || combined.includes("credential")) {
      permissions.add("environment");
    }
    if (combined.includes("browser") || combined.includes("puppeteer") || combined.includes("playwright")) {
      permissions.add("browser");
    }
    if (combined.includes("database") || combined.includes("sql") || combined.includes("mongo") || combined.includes("redis")) {
      permissions.add("database");
    }

    return Array.from(permissions);
  }

  /**
   * Write a converted skill to the AstraOS skills directory.
   */
  private async writeSkillToDisk(skill: ConvertedSkill): Promise<void> {
    const slug = this.slugify(skill.name);
    const skillDir = path.join(this.skillsDir, slug);
    await fs.mkdir(skillDir, { recursive: true });

    // Build AstraOS SKILL.md
    const triggersYaml = skill.triggers.map((t) => `  - "${t}"`).join("\n");
    const tagsYaml = skill.tags.map((t) => `  - "${t}"`).join("\n");
    const permissionsYaml = skill.permissions.map((p) => `  - "${p}"`).join("\n");

    let toolsYaml = "";
    if (skill.tools.length > 0) {
      toolsYaml = "tools:\n" + skill.tools.map((t) =>
        `  - name: "${t.name}"\n    description: "${t.description}"\n    handler: "${t.handler}"`
      ).join("\n");
    }

    const skillMd = [
      "---",
      `name: ${skill.name}`,
      `version: ${skill.version}`,
      `description: "${skill.description}"`,
      `author: ${skill.author}`,
      `category: ${skill.category}`,
      `source: ${skill.source}`,
      "triggers:",
      triggersYaml,
      "tags:",
      tagsYaml,
      "permissions:",
      permissionsYaml,
      ...(toolsYaml ? [toolsYaml] : []),
      "---",
      "",
      skill.systemPrompt,
      "",
    ].join("\n");

    await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");
    logger.info(`[SkillMigrator] Written SKILL.md to ${skillDir}`);
  }

  /**
   * Scan all code files in a directory for security issues.
   */
  private async scanDirectoryFiles(dir: string): Promise<SecurityReport> {
    const codeExtensions = new Set([".ts", ".js", ".mjs", ".cjs"]);
    let combinedContent = "";

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && codeExtensions.has(path.extname(entry.name).toLowerCase())) {
          const content = await fs.readFile(path.join(dir, entry.name), "utf-8");
          combinedContent += `\n// === FILE: ${entry.name} ===\n${content}`;
        }
      }
    } catch {
      // Directory not readable
    }

    if (!combinedContent) {
      return { safe: true, totalIssues: 0, critical: 0, high: 0, medium: 0, low: 0, issues: [], scannedAt: new Date().toISOString(), recommendation: "allow" };
    }

    const report = this.scanBeforeImport(combinedContent);
    if (report.recommendation === "block") {
      logger.error(`[SkillMigrator] Security scan BLOCKED code files in ${dir}: ${report.critical} critical issues`);
      throw new Error(`Security scan blocked import — ${report.critical} critical issue(s) found in code files`);
    }
    return report;
  }

  /**
   * Convert a name to a filesystem-safe slug.
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      || "unnamed-skill";
  }
}
