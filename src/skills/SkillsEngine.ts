/**
 * AstraOS — SkillsEngine.ts
 * Modular plugin/skills system. Skills are folders with SKILL.md files.
 * Supports marketplace (AstraHub) for community-built skills.
 * Config-first agent setup: SOUL.md (personality), AGENTS.md (capabilities).
 * Compatible with OpenClaw SKILL.md format for easy migration.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger";

export interface Skill {
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  triggers: string[];     // Keywords/patterns that activate this skill
  systemPrompt: string;   // Injected into agent context when skill is active
  tools?: SkillTool[];    // Additional tools this skill provides
  permissions: string[];  // Required permissions: network, filesystem, shell, env
  config?: Record<string, unknown>;
  filePath: string;
  enabled: boolean;
  source: "bundled" | "installed" | "workspace"; // Precedence: workspace > installed > bundled
}

export interface SkillTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: string; // JS module path or inline function reference
}

export interface AgentPersonality {
  name: string;
  voice: string;           // e.g. "professional", "friendly", "concise"
  traits: string[];
  systemPrompt: string;
  constraints: string[];
  examples: string[];
}

export interface AgentConfig {
  name: string;
  description: string;
  skills: string[];        // Skills this agent can use
  channels: string[];      // Channels this agent listens on
  model?: string;          // Preferred LLM model
  personality?: AgentPersonality;
  maxConcurrent?: number;
}

interface SkillFrontmatter {
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  triggers: string[];
  permissions: string[];
  tools?: SkillTool[];
  config?: Record<string, unknown>;
}

export class SkillsEngine {
  private skills: Map<string, Skill> = new Map();
  private agents: Map<string, AgentConfig> = new Map();
  private personality: AgentPersonality | null = null;
  private skillsDir: string;
  private workspaceDir: string;
  private marketplaceUrl: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || path.join(process.cwd(), "skills");
    this.workspaceDir = process.cwd();
    this.marketplaceUrl = process.env.ASTRA_HUB_URL || "https://hub.astra-os.dev/api/v1";
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.skillsDir, { recursive: true });
    await this.loadSkills();
    await this.loadSoulConfig();
    await this.loadAgentsConfig();
    logger.info(`[AstraOS] SkillsEngine: ${this.skills.size} skills loaded, ${this.agents.size} agents configured`);
    if (this.personality) {
      logger.info(`[AstraOS] SkillsEngine: Personality loaded — "${this.personality.name}" (${this.personality.voice})`);
    }
  }

  // ─── Config-First: SOUL.md (Personality) ───

  private async loadSoulConfig(): Promise<void> {
    const soulPath = path.join(this.workspaceDir, "SOUL.md");
    try {
      const content = await fs.readFile(soulPath, "utf-8");
      const frontmatter = this.parseYamlSimple(content.match(/^---\n([\s\S]*?)\n---/)?.[1] || "");
      const body = content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

      this.personality = {
        name: (frontmatter.name as string) || "Astra",
        voice: (frontmatter.voice as string) || "professional",
        traits: (frontmatter.traits as string[]) || [],
        systemPrompt: body,
        constraints: (frontmatter.constraints as string[]) || [],
        examples: (frontmatter.examples as string[]) || [],
      };
    } catch {
      // No SOUL.md — use defaults
    }
  }

  // ─── Config-First: AGENTS.md (Multi-Agent Config) ───

  private async loadAgentsConfig(): Promise<void> {
    const agentsPath = path.join(this.workspaceDir, "AGENTS.md");
    try {
      const content = await fs.readFile(agentsPath, "utf-8");
      // Parse multiple agent blocks separated by ## headers
      const agentBlocks = content.split(/^## /m).filter(Boolean);

      for (const block of agentBlocks) {
        const lines = block.split("\n");
        const name = lines[0]?.trim();
        if (!name) continue;

        const frontmatterMatch = lines.slice(1).join("\n").match(/```yaml\n([\s\S]*?)```/);
        if (frontmatterMatch) {
          const config = this.parseYamlSimple(frontmatterMatch[1]);
          this.agents.set(name, {
            name,
            description: (config.description as string) || "",
            skills: (config.skills as string[]) || [],
            channels: (config.channels as string[]) || [],
            model: (config.model as string) || undefined,
            maxConcurrent: config.maxConcurrent ? parseInt(config.maxConcurrent as string) : undefined,
          });
        }
      }
    } catch {
      // No AGENTS.md — single agent mode
    }
  }

  getPersonality(): AgentPersonality | null {
    return this.personality;
  }

  getPersonalityPrompt(): string {
    if (!this.personality) return "";
    const parts = [`You are ${this.personality.name}.`];
    if (this.personality.voice) parts.push(`Your communication style is: ${this.personality.voice}.`);
    if (this.personality.traits.length > 0) parts.push(`Key traits: ${this.personality.traits.join(", ")}.`);
    if (this.personality.constraints.length > 0) parts.push(`Constraints: ${this.personality.constraints.join("; ")}.`);
    if (this.personality.systemPrompt) parts.push(this.personality.systemPrompt);
    return parts.join("\n");
  }

  getAgentConfig(name: string): AgentConfig | undefined {
    return this.agents.get(name);
  }

  listAgentConfigs(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  getSkillsForAgent(agentName: string): Skill[] {
    const config = this.agents.get(agentName);
    if (!config) return this.listSkills();
    return config.skills.map((s) => this.skills.get(s)).filter(Boolean) as Skill[];
  }

  // ─── Skill Loading (with source tracking) ───

  private async loadSkills(): Promise<void> {
    // Load bundled skills first (lowest priority)
    await this.loadSkillsFromDir(this.skillsDir, "bundled");

    // Load workspace skills (highest priority — override bundled)
    const workspaceSkills = path.join(this.workspaceDir, ".astra-skills");
    await this.loadSkillsFromDir(workspaceSkills, "workspace");
  }

  private async loadSkillsFromDir(dir: string, source: Skill["source"]): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillFile = path.join(dir, entry.name, "SKILL.md");
        try {
          const content = await fs.readFile(skillFile, "utf-8");
          const skill = this.parseSkillMd(content, skillFile, source);
          if (skill) {
            this.skills.set(skill.name, skill);
          }
        } catch {
          // Skip invalid skills
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  private parseSkillMd(content: string, filePath: string, source: Skill["source"] = "bundled"): Skill | null {
    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) return null;

    const frontmatter = this.parseYamlSimple(frontmatterMatch[1]);
    const systemPrompt = frontmatterMatch[2].trim();

    // Support both AstraOS and OpenClaw field names
    const name = (frontmatter.name as string) || (frontmatter.slug as string);
    if (!name) return null;

    return {
      name,
      version: (frontmatter.version as string) || "1.0.0",
      description: (frontmatter.description as string) || (frontmatter.instruction as string) || "",
      author: (frontmatter.author as string) || "unknown",
      category: (frontmatter.category as string) || "other",
      tags: (frontmatter.tags as string[]) || [],
      triggers: (frontmatter.triggers as string[]) || (frontmatter.trigger as string[]) || [],
      systemPrompt,
      tools: (frontmatter.tools as SkillTool[]) || [],
      permissions: (frontmatter.permissions as string[]) || [],
      config: (frontmatter.config as Record<string, unknown>) || {},
      filePath,
      enabled: true,
      source,
    };
  }

  private parseYamlSimple(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let currentKey = "";
    let currentArray: string[] | null = null;

    for (const line of yaml.split("\n")) {
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

      const match = trimmed.match(/^(\w+):\s*(.*)$/);
      if (match) {
        currentKey = match[1];
        const value = match[2].trim();
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

  // Find skills relevant to the current message
  matchSkills(message: string): Skill[] {
    const lower = message.toLowerCase();
    return Array.from(this.skills.values()).filter(
      (skill) =>
        skill.enabled &&
        skill.triggers.some((trigger) => lower.includes(trigger.toLowerCase()))
    );
  }

  // Build combined system prompt from matched skills
  buildSkillPrompt(message: string): string {
    const matched = this.matchSkills(message);
    if (matched.length === 0) return "";

    return matched
      .map((s) => `\n--- SKILL: ${s.name} (v${s.version}) ---\n${s.systemPrompt}`)
      .join("\n");
  }

  // Get tool definitions from matched skills
  getSkillTools(message: string): SkillTool[] {
    const matched = this.matchSkills(message);
    return matched.flatMap((s) => s.tools || []);
  }

  // Install a skill from the marketplace
  async installSkill(skillName: string): Promise<boolean> {
    try {
      const resp = await fetch(`${this.marketplaceUrl}/skills/${skillName}`);
      if (!resp.ok) throw new Error(`Skill "${skillName}" not found on AstraHub`);

      const data = (await resp.json()) as { files: Array<{ name: string; content: string }> };
      const skillDir = path.join(this.skillsDir, skillName);
      await fs.mkdir(skillDir, { recursive: true });

      for (const file of data.files) {
        await fs.writeFile(path.join(skillDir, file.name), file.content, "utf-8");
      }

      await this.loadSkillsFromDir(this.skillsDir, "installed");
      logger.info(`[AstraOS] Skill installed from AstraHub: ${skillName}`);
      return true;
    } catch (err) {
      logger.error(`[AstraOS] Failed to install skill: ${(err as Error).message}`);
      return false;
    }
  }

  // Uninstall a skill
  async uninstallSkill(skillName: string): Promise<boolean> {
    const skill = this.skills.get(skillName);
    if (!skill) return false;

    const skillDir = path.dirname(skill.filePath);
    await fs.rm(skillDir, { recursive: true, force: true });
    this.skills.delete(skillName);
    logger.info(`[AstraOS] Skill uninstalled: ${skillName}`);
    return true;
  }

  // Enable/disable a skill
  toggleSkill(skillName: string, enabled: boolean): boolean {
    const skill = this.skills.get(skillName);
    if (!skill) return false;
    skill.enabled = enabled;
    return true;
  }

  listSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  listByCategory(category: string): Skill[] {
    return Array.from(this.skills.values()).filter((s) => s.category === category);
  }

  listBySource(source: Skill["source"]): Skill[] {
    return Array.from(this.skills.values()).filter((s) => s.source === source);
  }

  searchLocal(query: string): Skill[] {
    const lower = query.toLowerCase();
    return Array.from(this.skills.values()).filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.tags.some((t) => t.toLowerCase().includes(lower))
    );
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getStats(): { total: number; enabled: number; bundled: number; installed: number; workspace: number; categories: string[] } {
    const all = Array.from(this.skills.values());
    const categories = [...new Set(all.map((s) => s.category))];
    return {
      total: all.length,
      enabled: all.filter((s) => s.enabled).length,
      bundled: all.filter((s) => s.source === "bundled").length,
      installed: all.filter((s) => s.source === "installed").length,
      workspace: all.filter((s) => s.source === "workspace").length,
      categories,
    };
  }

  // Search marketplace for skills
  async searchMarketplace(query: string): Promise<Array<{ name: string; description: string; author: string; downloads: number }>> {
    try {
      const resp = await fetch(`${this.marketplaceUrl}/search?q=${encodeURIComponent(query)}`);
      return (await resp.json()) as Array<{ name: string; description: string; author: string; downloads: number }>;
    } catch {
      return [];
    }
  }

  // Bulk install skills (for collections)
  async installBulk(skillNames: string[]): Promise<{ installed: string[]; failed: string[] }> {
    const installed: string[] = [];
    const failed: string[] = [];
    for (const name of skillNames) {
      const ok = await this.installSkill(name);
      (ok ? installed : failed).push(name);
    }
    return { installed, failed };
  }
}
