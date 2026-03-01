/**
 * AstraOS — Skill Packager
 * Package, validate, version, and security-scan skills for marketplace publishing.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger";

export interface PackageResult {
  valid: boolean;
  name: string;
  version: string;
  files: Array<{ name: string; content: string; size: number }>;
  totalSize: number;
  warnings: string[];
  errors: string[];
}

interface SecurityScanResult {
  safe: boolean;
  issues: Array<{ severity: "low" | "medium" | "high" | "critical"; message: string; file: string; line?: number }>;
}

const MAX_PACKAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXTENSIONS = [".md", ".ts", ".js", ".json", ".yaml", ".yml", ".txt", ".css", ".html"];
const DANGEROUS_PATTERNS = [
  { pattern: /process\.env/g, severity: "medium" as const, message: "Accesses environment variables" },
  { pattern: /eval\s*\(/g, severity: "critical" as const, message: "Uses eval() — potential code injection" },
  { pattern: /require\s*\(\s*['"`]child_process/g, severity: "critical" as const, message: "Uses child_process — potential RCE" },
  { pattern: /require\s*\(\s*['"`]fs/g, severity: "high" as const, message: "Uses filesystem access" },
  { pattern: /fetch\s*\(/g, severity: "low" as const, message: "Makes network requests" },
  { pattern: /new\s+Function\s*\(/g, severity: "critical" as const, message: "Dynamic function creation" },
  { pattern: /\.exec\s*\(/g, severity: "high" as const, message: "Executes commands" },
  { pattern: /import\s+.*from\s+['"`]child_process/g, severity: "critical" as const, message: "Imports child_process" },
];

export class SkillPackager {
  /**
   * Package a skill directory for marketplace publishing.
   */
  async package(skillDir: string): Promise<PackageResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Check SKILL.md exists
    const skillMdPath = path.join(skillDir, "SKILL.md");
    try {
      await fs.access(skillMdPath);
    } catch {
      errors.push("Missing SKILL.md file — required for all skills");
      return { valid: false, name: "", version: "", files: [], totalSize: 0, warnings, errors };
    }

    // Parse metadata
    const skillMd = await fs.readFile(skillMdPath, "utf-8");
    const meta = this.parseMetadata(skillMd);
    if (!meta.name) errors.push("SKILL.md is missing 'name' in frontmatter");
    if (!meta.version) warnings.push("SKILL.md is missing 'version' — defaulting to 1.0.0");
    if (!meta.description) warnings.push("SKILL.md is missing 'description'");
    if (!meta.author) warnings.push("SKILL.md is missing 'author'");

    // Collect files
    const files: Array<{ name: string; content: string; size: number }> = [];
    let totalSize = 0;
    await this.collectFiles(skillDir, skillDir, files);

    for (const file of files) {
      totalSize += file.size;
      const ext = path.extname(file.name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        warnings.push(`Unexpected file type: ${file.name} (${ext})`);
      }
    }

    if (totalSize > MAX_PACKAGE_SIZE) {
      errors.push(`Package too large: ${(totalSize / 1024 / 1024).toFixed(2)}MB (max 5MB)`);
    }

    // Security scan
    const securityResult = this.securityScan(files);
    if (!securityResult.safe) {
      for (const issue of securityResult.issues) {
        if (issue.severity === "critical") {
          errors.push(`[SECURITY] ${issue.message} in ${issue.file}`);
        } else {
          warnings.push(`[SECURITY:${issue.severity}] ${issue.message} in ${issue.file}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      name: (Array.isArray(meta.name) ? meta.name[0] : meta.name) || path.basename(skillDir),
      version: (Array.isArray(meta.version) ? meta.version[0] : meta.version) || "1.0.0",
      files,
      totalSize,
      warnings,
      errors,
    };
  }

  /**
   * Validate a SKILL.md string without a full package.
   */
  validateSkillMd(content: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const meta = this.parseMetadata(content);
    if (!meta.name) errors.push("Missing 'name' in frontmatter");
    if (!meta.triggers || meta.triggers.length === 0) errors.push("Missing 'triggers' — skill won't activate");

    const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    if (!frontmatterMatch || !frontmatterMatch[1].trim()) {
      errors.push("Missing system prompt body after frontmatter");
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Bump the version of a skill (semver: major | minor | patch).
   */
  async bumpVersion(skillDir: string, type: "major" | "minor" | "patch" = "patch"): Promise<string> {
    const skillMdPath = path.join(skillDir, "SKILL.md");
    let content = await fs.readFile(skillMdPath, "utf-8");
    const meta = this.parseMetadata(content);

    const versionStr = Array.isArray(meta.version) ? meta.version[0] : (meta.version || "1.0.0");
    const parts = versionStr.split(".").map(Number);
    if (type === "major") { parts[0]++; parts[1] = 0; parts[2] = 0; }
    else if (type === "minor") { parts[1]++; parts[2] = 0; }
    else { parts[2]++; }

    const newVersion = parts.join(".");
    content = content.replace(/version:\s*.+/, `version: ${newVersion}`);
    await fs.writeFile(skillMdPath, content, "utf-8");

    logger.info(`[SkillPackager] Bumped ${meta.name} version to ${newVersion}`);
    return newVersion;
  }

  /**
   * Security scan skill files for dangerous patterns.
   */
  securityScan(files: Array<{ name: string; content: string }>): SecurityScanResult {
    const issues: SecurityScanResult["issues"] = [];

    for (const file of files) {
      const ext = path.extname(file.name).toLowerCase();
      if (![".ts", ".js", ".mjs", ".cjs"].includes(ext)) continue;

      for (const { pattern, severity, message } of DANGEROUS_PATTERNS) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = regex.exec(file.content)) !== null) {
          const line = file.content.substring(0, match.index).split("\n").length;
          issues.push({ severity, message, file: file.name, line });
        }
      }
    }

    const hasCritical = issues.some((i) => i.severity === "critical");
    return { safe: !hasCritical, issues };
  }

  private async collectFiles(
    dir: string,
    rootDir: string,
    files: Array<{ name: string; content: string; size: number }>,
  ): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

      if (entry.name.startsWith(".")) continue; // skip hidden files
      if (entry.name === "node_modules") continue;

      if (entry.isDirectory()) {
        await this.collectFiles(fullPath, rootDir, files);
      } else {
        const content = await fs.readFile(fullPath, "utf-8");
        files.push({ name: relativePath, content, size: Buffer.byteLength(content) });
      }
    }
  }

  private parseMetadata(content: string): Record<string, string | string[]> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const result: Record<string, string | string[]> = {};
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

      const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
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

    if (currentArray && currentKey) result[currentKey] = currentArray;
    return result;
  }
}
