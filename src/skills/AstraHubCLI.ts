/**
 * AstraOS — AstraHubCLI.ts
 * Command-line interface for AstraHub — the npm for AI agent skills.
 * Commands: install, uninstall, search, publish, create, update, list, info, migrate.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger";
import { SkillsEngine } from "./SkillsEngine";
import { MarketplaceServer } from "../marketplace/MarketplaceServer";
import { SkillPackager } from "../marketplace/SkillPackager";
import { SkillMigrator } from "./SkillMigrator";

// ---------------------------------------------------------------------------
// ANSI colour helpers for terminal output
// ---------------------------------------------------------------------------

const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  cyan:    "\x1b[36m",
  white:   "\x1b[37m",
  bgRed:   "\x1b[41m",
  bgGreen: "\x1b[42m",
};

// ---------------------------------------------------------------------------
// Skill templates for scaffolding
// ---------------------------------------------------------------------------

interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  files: Array<{ name: string; content: string }>;
}

const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: "basic",
    name: "Basic Skill",
    description: "A minimal skill with triggers and a system prompt",
    files: [
      {
        name: "SKILL.md",
        content: `---
name: {{NAME}}
version: 1.0.0
description: "A new AstraOS skill"
author: {{AUTHOR}}
category: other
triggers:
  - "{{NAME}}"
tags:
  - "custom"
permissions: []
---

You are a helpful assistant with the {{NAME}} skill.
Respond to user queries related to your domain of expertise.
`,
      },
    ],
  },
  {
    id: "tool",
    name: "Tool Skill",
    description: "A skill that provides custom tools to the agent",
    files: [
      {
        name: "SKILL.md",
        content: `---
name: {{NAME}}
version: 1.0.0
description: "A tool-providing skill for AstraOS"
author: {{AUTHOR}}
category: devtools
triggers:
  - "{{NAME}}"
tags:
  - "tool"
  - "custom"
permissions:
  - "network"
tools:
  - name: "{{NAME}}_action"
    description: "Perform the main action of this skill"
    handler: "./handler.ts"
---

You are a skill that provides the {{NAME}}_action tool.
Use this tool when the user asks you to perform actions related to {{NAME}}.

## Tool Usage
- Call {{NAME}}_action with the required parameters
- Return the result in a clear, formatted response
`,
      },
      {
        name: "handler.ts",
        content: `/**
 * {{NAME}} — Tool Handler
 * Implement your skill's tool logic here.
 */

export interface ActionInput {
  query: string;
}

export interface ActionOutput {
  result: string;
  success: boolean;
}

export async function handler(input: ActionInput): Promise<ActionOutput> {
  // TODO: implement your tool logic
  return {
    result: \`Processed: \${input.query}\`,
    success: true,
  };
}
`,
      },
    ],
  },
  {
    id: "api",
    name: "API Integration",
    description: "A skill that integrates with an external API",
    files: [
      {
        name: "SKILL.md",
        content: `---
name: {{NAME}}
version: 1.0.0
description: "API integration skill for AstraOS"
author: {{AUTHOR}}
category: automation
triggers:
  - "{{NAME}}"
tags:
  - "api"
  - "integration"
permissions:
  - "network"
  - "environment"
tools:
  - name: "{{NAME}}_fetch"
    description: "Fetch data from the {{NAME}} API"
    handler: "./api-client.ts"
config:
  apiBaseUrl: "https://api.example.com/v1"
---

You are a skill that integrates with the {{NAME}} API.
When the user needs data from {{NAME}}, use the {{NAME}}_fetch tool.

## Configuration
This skill requires an API key set via environment variable:
\`{{NAME_UPPER}}_API_KEY\`
`,
      },
      {
        name: "api-client.ts",
        content: `/**
 * {{NAME}} — API Client
 */

const API_BASE = process.env.{{NAME_UPPER}}_API_URL || "https://api.example.com/v1";
const API_KEY = process.env.{{NAME_UPPER}}_API_KEY || "";

export interface FetchInput {
  endpoint: string;
  params?: Record<string, string>;
}

export async function handler(input: FetchInput): Promise<unknown> {
  const url = new URL(input.endpoint, API_BASE);
  if (input.params) {
    for (const [key, value] of Object.entries(input.params)) {
      url.searchParams.set(key, value);
    }
  }

  const resp = await fetch(url.toString(), {
    headers: {
      "Authorization": \`Bearer \${API_KEY}\`,
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    throw new Error(\`API request failed: \${resp.status} \${resp.statusText}\`);
  }

  return resp.json();
}
`,
      },
    ],
  },
  {
    id: "automation",
    name: "Automation Workflow",
    description: "A skill that automates a multi-step workflow",
    files: [
      {
        name: "SKILL.md",
        content: `---
name: {{NAME}}
version: 1.0.0
description: "Automation workflow skill for AstraOS"
author: {{AUTHOR}}
category: automation
triggers:
  - "{{NAME}}"
  - "automate"
tags:
  - "automation"
  - "workflow"
permissions:
  - "network"
  - "filesystem"
---

You are an automation skill that executes the {{NAME}} workflow.

## Workflow Steps
1. Gather input from the user
2. Validate the parameters
3. Execute the automated steps
4. Report results

Always confirm with the user before executing destructive operations.
`,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// AstraHubCLI class
// ---------------------------------------------------------------------------

export class AstraHubCLI {
  private skillsEngine: SkillsEngine;
  private marketplace: MarketplaceServer;
  private packager: SkillPackager;
  private migrator: SkillMigrator;
  private skillsDir: string;
  private hubUrl: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || path.join(process.cwd(), "skills");
    this.hubUrl = process.env.ASTRA_HUB_URL || "https://hub.astra-os.dev/api/v1";
    this.skillsEngine = new SkillsEngine(this.skillsDir);
    this.marketplace = new MarketplaceServer(this.skillsDir);
    this.packager = new SkillPackager();
    this.migrator = new SkillMigrator(this.skillsDir);
  }

  /**
   * Parse and execute a CLI command from the given arguments.
   */
  async run(args: string[]): Promise<void> {
    const command = args[0]?.toLowerCase();

    if (!command || command === "help" || command === "--help" || command === "-h") {
      this.printHelp();
      return;
    }

    try {
      switch (command) {
        case "install":
          await this.cmdInstall(args.slice(1));
          break;
        case "uninstall":
        case "remove":
          await this.cmdUninstall(args.slice(1));
          break;
        case "search":
          await this.cmdSearch(args.slice(1));
          break;
        case "publish":
          await this.cmdPublish(args.slice(1));
          break;
        case "create":
        case "init":
          await this.cmdCreate(args.slice(1));
          break;
        case "update":
        case "upgrade":
          await this.cmdUpdate(args.slice(1));
          break;
        case "list":
        case "ls":
          await this.cmdList(args.slice(1));
          break;
        case "info":
        case "show":
          await this.cmdInfo(args.slice(1));
          break;
        case "migrate":
          await this.cmdMigrate(args.slice(1));
          break;
        case "verify":
        case "audit":
          await this.cmdVerify(args.slice(1));
          break;
        case "templates":
          this.cmdTemplates();
          break;
        case "version":
        case "--version":
        case "-v":
          this.printVersion();
          break;
        default:
          this.printError(`Unknown command: "${command}"`);
          this.println(`Run ${C.cyan}astrahub help${C.reset} to see available commands.`);
          process.exitCode = 1;
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.printError(message);
      logger.error(`[AstraHubCLI] Command "${command}" failed: ${message}`);
      process.exitCode = 1;
    }
  }

  // -----------------------------------------------------------------------
  // Command: install
  // -----------------------------------------------------------------------

  private async cmdInstall(args: string[]): Promise<void> {
    if (args.length === 0) {
      this.printError("Missing skill name.");
      this.println(`Usage: ${C.cyan}astrahub install <skill-name> [--version x.y.z]${C.reset}`);
      return;
    }

    const skillName = args[0];
    const versionFlag = this.getFlag(args, "--version");

    this.printProgress(`Installing ${C.bold}${skillName}${C.reset}${versionFlag ? ` v${versionFlag}` : ""}...`);

    try {
      const result = await this.marketplace.install(skillName, versionFlag || undefined);

      this.printSuccess(`Installed ${C.bold}${result.name}${C.reset} v${result.version}`);
      this.println("");
      this.println(`  ${C.dim}Skill directory:${C.reset} ${path.join(this.skillsDir, result.name)}`);
      this.println(`  ${C.dim}To use:${C.reset} mention a trigger keyword in your message`);
      this.println("");
    } catch (err) {
      const message = (err as Error).message;
      this.printError(`Failed to install "${skillName}": ${message}`);

      // Provide helpful suggestions
      if (message.includes("not found")) {
        this.println(`\n  ${C.yellow}Suggestions:${C.reset}`);
        this.println(`  - Check the skill name spelling`);
        this.println(`  - Run ${C.cyan}astrahub search ${skillName}${C.reset} to find similar skills`);
        this.println(`  - Import from ClawHub: ${C.cyan}astrahub migrate ${skillName} --from clawhub${C.reset}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Command: uninstall
  // -----------------------------------------------------------------------

  private async cmdUninstall(args: string[]): Promise<void> {
    if (args.length === 0) {
      this.printError("Missing skill name.");
      this.println(`Usage: ${C.cyan}astrahub uninstall <skill-name>${C.reset}`);
      return;
    }

    const skillName = args[0];
    this.printProgress(`Uninstalling ${C.bold}${skillName}${C.reset}...`);

    try {
      await this.marketplace.uninstall(skillName);
      this.printSuccess(`Uninstalled ${C.bold}${skillName}${C.reset}`);
    } catch (err) {
      this.printError(`Failed to uninstall "${skillName}": ${(err as Error).message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Command: search
  // -----------------------------------------------------------------------

  private async cmdSearch(args: string[]): Promise<void> {
    if (args.length === 0) {
      this.printError("Missing search query.");
      this.println(`Usage: ${C.cyan}astrahub search <query> [--category <cat>] [--sort popular|recent|rating]${C.reset}`);
      return;
    }

    // Collect query (skip flags)
    const queryParts: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith("--")) {
        i++; // skip flag value
        continue;
      }
      queryParts.push(args[i]);
    }
    const query = queryParts.join(" ");

    const category = this.getFlag(args, "--category");
    const sort = this.getFlag(args, "--sort") || "popular";

    this.printProgress(`Searching AstraHub for "${query}"...`);

    try {
      const params = new URLSearchParams({ q: query, sort });
      if (category) params.set("category", category);

      const resp = await fetch(`${this.hubUrl}/search?${params}`);
      if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);

      const data = (await resp.json()) as {
        skills: Array<{ name: string; description: string; author: string; downloads: number; rating: number; category: string; version: string }>;
        total: number;
      };

      if (!data.skills || data.skills.length === 0) {
        this.println(`\n  ${C.yellow}No skills found matching "${query}".${C.reset}`);
        this.println(`  Try a broader search or check ${C.cyan}astrahub list --available${C.reset}`);
        return;
      }

      this.println(`\n  ${C.bold}Found ${data.total || data.skills.length} skill(s):${C.reset}\n`);

      // Table header
      const nameWidth = 25;
      const descWidth = 40;
      const authorWidth = 15;
      const dlWidth = 10;

      this.println(
        `  ${C.bold}${this.pad("NAME", nameWidth)}  ${this.pad("DESCRIPTION", descWidth)}  ${this.pad("AUTHOR", authorWidth)}  ${this.pad("DOWNLOADS", dlWidth)}${C.reset}`
      );
      this.println(`  ${C.dim}${"─".repeat(nameWidth + descWidth + authorWidth + dlWidth + 6)}${C.reset}`);

      for (const skill of data.skills) {
        const name = this.truncate(skill.name, nameWidth);
        const desc = this.truncate(skill.description || "", descWidth);
        const author = this.truncate(skill.author || "", authorWidth);
        const downloads = this.formatNumber(skill.downloads || 0);

        this.println(
          `  ${C.cyan}${this.pad(name, nameWidth)}${C.reset}  ${this.pad(desc, descWidth)}  ${C.dim}${this.pad(author, authorWidth)}${C.reset}  ${this.pad(downloads, dlWidth)}`
        );
      }

      this.println("");
      this.println(`  ${C.dim}Install with: ${C.cyan}astrahub install <skill-name>${C.reset}`);
    } catch (err) {
      // Fallback to local engine search
      logger.warn(`[AstraHubCLI] Remote search failed, falling back to local: ${(err as Error).message}`);
      const localResults = await this.skillsEngine.searchMarketplace(query);

      if (localResults.length === 0) {
        this.println(`\n  ${C.yellow}No skills found matching "${query}" (searched locally).${C.reset}`);
        return;
      }

      this.println(`\n  ${C.bold}Found ${localResults.length} local result(s):${C.reset}\n`);
      for (const skill of localResults) {
        this.println(`  ${C.cyan}${skill.name}${C.reset} — ${skill.description} ${C.dim}by ${skill.author}${C.reset}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Command: publish
  // -----------------------------------------------------------------------

  private async cmdPublish(args: string[]): Promise<void> {
    const dir = this.getFlag(args, "--dir") || process.cwd();

    this.printProgress(`Packaging skill from ${dir}...`);

    // Step 1: Package and validate
    const packageResult = await this.packager.package(dir);

    if (packageResult.warnings.length > 0) {
      this.println(`\n  ${C.yellow}Warnings:${C.reset}`);
      for (const w of packageResult.warnings) {
        this.println(`  ${C.yellow}!${C.reset} ${w}`);
      }
    }

    if (!packageResult.valid) {
      this.printError("Package validation failed:");
      for (const e of packageResult.errors) {
        this.println(`  ${C.red}x${C.reset} ${e}`);
      }
      this.println(`\n  Fix the errors above and try again.`);
      return;
    }

    // Step 2: Security scan
    this.printProgress("Running security scan...");

    const scanFiles = packageResult.files.map((f) => ({ name: f.name, content: f.content }));
    const securityResult = this.packager.securityScan(scanFiles);

    if (!securityResult.safe) {
      this.printError("Security scan found critical issues — publish blocked:");
      for (const issue of securityResult.issues.filter((i) => i.severity === "critical")) {
        this.println(`  ${C.red}CRITICAL${C.reset} ${issue.message} in ${issue.file}${issue.line ? `:${issue.line}` : ""}`);
      }
      return;
    }

    if (securityResult.issues.length > 0) {
      this.println(`\n  ${C.yellow}Security notes:${C.reset}`);
      for (const issue of securityResult.issues) {
        const severityColor = issue.severity === "high" ? C.red : issue.severity === "medium" ? C.yellow : C.dim;
        this.println(`  ${severityColor}[${issue.severity.toUpperCase()}]${C.reset} ${issue.message} in ${issue.file}`);
      }
    }

    // Step 3: Publish
    this.printProgress(`Publishing ${C.bold}${packageResult.name}${C.reset} v${packageResult.version} to AstraHub...`);

    try {
      const resp = await fetch(`${this.hubUrl}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: packageResult.name,
          version: packageResult.version,
          files: packageResult.files.map((f) => ({ name: f.name, content: f.content })),
        }),
      });

      if (!resp.ok) {
        throw new Error(`Publish failed: ${resp.status} ${resp.statusText}`);
      }

      const result = (await resp.json()) as { success: boolean; id: string };

      this.printSuccess(`Published ${C.bold}${packageResult.name}${C.reset} v${packageResult.version}`);
      this.println("");
      this.println(`  ${C.dim}Package ID:${C.reset}   ${result.id}`);
      this.println(`  ${C.dim}Total size:${C.reset}   ${(packageResult.totalSize / 1024).toFixed(1)} KB`);
      this.println(`  ${C.dim}Files:${C.reset}        ${packageResult.files.length}`);
      this.println("");
      this.println(`  ${C.dim}Install with:${C.reset} ${C.cyan}astrahub install ${packageResult.name}${C.reset}`);
    } catch (err) {
      this.printError(`Publish failed: ${(err as Error).message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Command: create
  // -----------------------------------------------------------------------

  private async cmdCreate(args: string[]): Promise<void> {
    if (args.length < 2) {
      this.printError("Missing template and/or skill name.");
      this.println(`Usage: ${C.cyan}astrahub create <template> <name> [--author name]${C.reset}`);
      this.println(`\n  Available templates:`);
      for (const t of SKILL_TEMPLATES) {
        this.println(`  ${C.cyan}${t.id}${C.reset}  — ${t.description}`);
      }
      return;
    }

    const templateId = args[0];
    const skillName = args[1];
    const author = this.getFlag(args, "--author") || process.env.USER || "developer";

    const template = SKILL_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
      this.printError(`Unknown template: "${templateId}"`);
      this.println(`\n  Available templates:`);
      for (const t of SKILL_TEMPLATES) {
        this.println(`  ${C.cyan}${t.id}${C.reset}  — ${t.description}`);
      }
      return;
    }

    const skillDir = path.join(this.skillsDir, skillName);

    // Check if directory already exists
    try {
      await fs.access(skillDir);
      this.printError(`Directory already exists: ${skillDir}`);
      this.println(`  Choose a different name or delete the existing directory.`);
      return;
    } catch {
      // Expected — directory should not exist
    }

    this.printProgress(`Creating skill "${skillName}" from template "${template.name}"...`);

    await fs.mkdir(skillDir, { recursive: true });

    const nameUpper = skillName.toUpperCase().replace(/[^A-Z0-9]/g, "_");

    for (const file of template.files) {
      const content = file.content
        .replace(/\{\{NAME\}\}/g, skillName)
        .replace(/\{\{AUTHOR\}\}/g, author)
        .replace(/\{\{NAME_UPPER\}\}/g, nameUpper);

      await fs.writeFile(path.join(skillDir, file.name), content, "utf-8");
    }

    this.printSuccess(`Created skill ${C.bold}${skillName}${C.reset}`);
    this.println("");
    this.println(`  ${C.dim}Location:${C.reset}  ${skillDir}`);
    this.println(`  ${C.dim}Template:${C.reset}  ${template.name}`);
    this.println(`  ${C.dim}Files:${C.reset}     ${template.files.map((f) => f.name).join(", ")}`);
    this.println("");
    this.println(`  ${C.dim}Next steps:${C.reset}`);
    this.println(`  1. Edit ${C.cyan}SKILL.md${C.reset} — customise the system prompt and triggers`);
    if (template.files.some((f) => f.name.endsWith(".ts"))) {
      this.println(`  2. Implement your tool handler in ${C.cyan}handler.ts${C.reset} or ${C.cyan}api-client.ts${C.reset}`);
    }
    this.println(`  ${template.files.some((f) => f.name.endsWith(".ts")) ? "3" : "2"}. Test locally, then publish: ${C.cyan}astrahub publish --dir ${skillDir}${C.reset}`);
  }

  // -----------------------------------------------------------------------
  // Command: update
  // -----------------------------------------------------------------------

  private async cmdUpdate(args: string[]): Promise<void> {
    const updateAll = args.includes("--all");
    const skillName = !updateAll && args.length > 0 ? args[0] : null;

    if (!updateAll && !skillName) {
      this.printError("Specify a skill name or use --all.");
      this.println(`Usage: ${C.cyan}astrahub update <skill-name>${C.reset}`);
      this.println(`       ${C.cyan}astrahub update --all${C.reset}`);
      return;
    }

    if (updateAll) {
      const installed = this.marketplace.getInstalledSkills();
      if (installed.length === 0) {
        this.println(`  ${C.yellow}No skills installed.${C.reset}`);
        return;
      }

      this.printProgress(`Updating ${installed.length} skill(s)...`);
      let updated = 0;
      let failed = 0;

      for (const record of installed) {
        try {
          const result = await this.marketplace.update(record.skillId);
          this.println(`  ${C.green}+${C.reset} ${record.name} -> v${result.version}`);
          updated++;
        } catch {
          this.println(`  ${C.red}x${C.reset} ${record.name} — update failed`);
          failed++;
        }
      }

      this.println("");
      this.printSuccess(`Updated ${updated} skill(s)${failed > 0 ? `, ${failed} failed` : ""}`);
    } else {
      this.printProgress(`Updating ${C.bold}${skillName}${C.reset}...`);
      const result = await this.marketplace.update(skillName!);
      this.printSuccess(`Updated ${C.bold}${skillName}${C.reset} to v${result.version}`);
    }
  }

  // -----------------------------------------------------------------------
  // Command: list
  // -----------------------------------------------------------------------

  private async cmdList(args: string[]): Promise<void> {
    const showInstalled = args.includes("--installed") || (!args.includes("--available"));
    const showAvailable = args.includes("--available");

    if (showInstalled && !showAvailable) {
      const installed = this.marketplace.getInstalledSkills();

      if (installed.length === 0) {
        this.println(`\n  ${C.yellow}No skills installed.${C.reset}`);
        this.println(`  Run ${C.cyan}astrahub search <query>${C.reset} to find skills to install.`);
        return;
      }

      this.println(`\n  ${C.bold}Installed Skills (${installed.length}):${C.reset}\n`);

      const nameWidth = 25;
      const versionWidth = 10;
      const dateWidth = 22;

      this.println(
        `  ${C.bold}${this.pad("NAME", nameWidth)}  ${this.pad("VERSION", versionWidth)}  ${this.pad("INSTALLED", dateWidth)}${C.reset}`
      );
      this.println(`  ${C.dim}${"─".repeat(nameWidth + versionWidth + dateWidth + 4)}${C.reset}`);

      for (const record of installed) {
        const installedDate = new Date(record.installedAt).toLocaleDateString();
        this.println(
          `  ${C.cyan}${this.pad(record.name, nameWidth)}${C.reset}  ${this.pad(record.version, versionWidth)}  ${C.dim}${this.pad(installedDate, dateWidth)}${C.reset}`
        );
      }
      this.println("");
    }

    if (showAvailable) {
      this.printProgress("Fetching available skills from AstraHub...");

      try {
        const resp = await fetch(`${this.hubUrl}/search?q=&sort=downloads&limit=30`);
        if (!resp.ok) throw new Error(`${resp.status}`);

        const data = (await resp.json()) as {
          skills: Array<{ name: string; description: string; downloads: number; category: string }>;
        };

        if (!data.skills || data.skills.length === 0) {
          this.println(`\n  ${C.yellow}No skills available on AstraHub.${C.reset}`);
          return;
        }

        this.println(`\n  ${C.bold}Available on AstraHub:${C.reset}\n`);

        for (const skill of data.skills) {
          this.println(
            `  ${C.cyan}${skill.name}${C.reset} ${C.dim}[${skill.category || "other"}]${C.reset} — ${skill.description || "No description"} ${C.dim}(${this.formatNumber(skill.downloads || 0)} downloads)${C.reset}`
          );
        }
        this.println("");
      } catch (err) {
        this.printError(`Failed to fetch available skills: ${(err as Error).message}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Command: info
  // -----------------------------------------------------------------------

  private async cmdInfo(args: string[]): Promise<void> {
    if (args.length === 0) {
      this.printError("Missing skill name.");
      this.println(`Usage: ${C.cyan}astrahub info <skill-name>${C.reset}`);
      return;
    }

    const skillName = args[0];
    this.printProgress(`Fetching info for "${skillName}"...`);

    try {
      const resp = await fetch(`${this.hubUrl}/skills/${encodeURIComponent(skillName)}`);
      if (!resp.ok) throw new Error(`Skill "${skillName}" not found (${resp.status})`);

      const skill = (await resp.json()) as {
        name: string;
        version: string;
        description: string;
        author: string;
        category: string;
        tags: string[];
        downloads: number;
        rating: number;
        ratingCount: number;
        verified: boolean;
        createdAt: string;
        updatedAt: string;
        readme: string;
      };

      this.println("");
      this.println(`  ${C.bold}${skill.name}${C.reset} ${skill.verified ? `${C.green}[verified]${C.reset}` : ""}`);
      this.println(`  ${C.dim}${skill.description || "No description"}${C.reset}`);
      this.println("");
      this.println(`  ${C.dim}Version:${C.reset}     ${skill.version}`);
      this.println(`  ${C.dim}Author:${C.reset}      ${skill.author}`);
      this.println(`  ${C.dim}Category:${C.reset}    ${skill.category || "other"}`);
      this.println(`  ${C.dim}Tags:${C.reset}        ${(skill.tags || []).join(", ") || "none"}`);
      this.println(`  ${C.dim}Downloads:${C.reset}   ${this.formatNumber(skill.downloads || 0)}`);
      this.println(`  ${C.dim}Rating:${C.reset}      ${this.renderStars(skill.rating || 0)} (${skill.ratingCount || 0} reviews)`);
      this.println(`  ${C.dim}Published:${C.reset}   ${skill.createdAt ? new Date(skill.createdAt).toLocaleDateString() : "unknown"}`);
      this.println(`  ${C.dim}Updated:${C.reset}     ${skill.updatedAt ? new Date(skill.updatedAt).toLocaleDateString() : "unknown"}`);
      this.println("");
      this.println(`  ${C.dim}Install:${C.reset}     ${C.cyan}astrahub install ${skill.name}${C.reset}`);
      this.println("");
    } catch {
      // Try local lookup
      const localSkill = this.skillsEngine.getSkill(skillName);
      if (localSkill) {
        this.println("");
        this.println(`  ${C.bold}${localSkill.name}${C.reset} ${C.yellow}[local]${C.reset}`);
        this.println(`  ${C.dim}${localSkill.description || "No description"}${C.reset}`);
        this.println("");
        this.println(`  ${C.dim}Version:${C.reset}     ${localSkill.version}`);
        this.println(`  ${C.dim}Author:${C.reset}      ${localSkill.author}`);
        this.println(`  ${C.dim}Triggers:${C.reset}    ${localSkill.triggers.join(", ") || "none"}`);
        this.println(`  ${C.dim}Tools:${C.reset}       ${(localSkill.tools || []).length}`);
        this.println(`  ${C.dim}Enabled:${C.reset}     ${localSkill.enabled ? `${C.green}yes${C.reset}` : `${C.red}no${C.reset}`}`);
        this.println(`  ${C.dim}File:${C.reset}        ${localSkill.filePath}`);
        this.println("");
      } else {
        this.printError(`Skill "${skillName}" not found on AstraHub or locally.`);
        this.println(`  Run ${C.cyan}astrahub search ${skillName}${C.reset} to search for similar skills.`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Command: migrate
  // -----------------------------------------------------------------------

  private async cmdMigrate(args: string[]): Promise<void> {
    const isBulk = args.includes("--bulk");

    if (isBulk) {
      // Bulk import from a file
      const fileArg = this.getFlag(args, "--bulk");
      if (!fileArg) {
        this.printError("Missing file path for --bulk.");
        this.println(`Usage: ${C.cyan}astrahub migrate --bulk <file.txt>${C.reset}`);
        this.println(`  File should contain one slug per line.`);
        return;
      }

      this.printProgress(`Reading bulk import list from ${fileArg}...`);

      let fileContent: string;
      try {
        fileContent = await fs.readFile(fileArg, "utf-8");
      } catch {
        this.printError(`Cannot read file: ${fileArg}`);
        return;
      }

      const slugs = fileContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));

      if (slugs.length === 0) {
        this.printError("No slugs found in the file.");
        return;
      }

      this.printProgress(`Importing ${slugs.length} skill(s) from ClawHub...`);
      this.println("");

      const result = await this.migrator.importBulk(slugs);

      for (const r of result.results) {
        if (r.success) {
          this.println(`  ${C.green}+${C.reset} ${r.slug} -> ${C.bold}${r.skill!.name}${C.reset} v${r.skill!.version}`);
        } else {
          this.println(`  ${C.red}x${C.reset} ${r.slug} — ${r.error}`);
        }
      }

      const succeeded = result.results.filter((r) => r.success).length;
      const failed = result.results.filter((r) => !r.success).length;
      this.println("");
      this.printSuccess(`Imported ${succeeded}/${slugs.length}${failed > 0 ? ` (${failed} failed)` : ""}`);
      return;
    }

    // Single skill migration
    if (args.length === 0) {
      this.printError("Missing skill slug.");
      this.println(`Usage: ${C.cyan}astrahub migrate <slug> [--from clawhub]${C.reset}`);
      this.println(`       ${C.cyan}astrahub migrate --bulk <file.txt>${C.reset}`);
      return;
    }

    const slug = args[0];
    const from = this.getFlag(args, "--from") || "clawhub";

    this.printProgress(`Migrating "${slug}" from ${from}...`);

    if (from === "clawhub" || from === "openclaw") {
      const skill = await this.migrator.importFromClawHub(slug);
      this.printSuccess(`Migrated ${C.bold}${skill.name}${C.reset} v${skill.version} from ${from}`);
      this.println("");
      this.println(`  ${C.dim}Category:${C.reset}     ${skill.category}`);
      this.println(`  ${C.dim}Triggers:${C.reset}     ${skill.triggers.join(", ") || "none"}`);
      this.println(`  ${C.dim}Permissions:${C.reset}  ${skill.permissions.join(", ") || "none"}`);
      this.println(`  ${C.dim}Tools:${C.reset}        ${skill.tools.length}`);
      this.println(`  ${C.dim}Location:${C.reset}     ${path.join(this.skillsDir, slug)}`);
      this.println("");
    } else {
      this.printError(`Unknown source: "${from}". Supported: clawhub, openclaw`);
    }
  }

  // -----------------------------------------------------------------------
  // Command: verify
  // -----------------------------------------------------------------------

  private async cmdVerify(args: string[]): Promise<void> {
    const skillDir = args[0] || process.cwd();

    this.printProgress(`Security scanning ${skillDir}...`);

    // Run the packager's security scan
    const packageResult = await this.packager.package(skillDir);

    if (packageResult.errors.length === 0 && packageResult.warnings.length === 0) {
      this.printSuccess("No security issues found.");
      this.println(`\n  ${C.dim}Scanned ${packageResult.files.length} file(s), ${(packageResult.totalSize / 1024).toFixed(1)} KB total.${C.reset}`);
      return;
    }

    // Also run the migrator's deeper scan
    const compatReport = await this.migrator.getCompatibilityReport(skillDir);

    this.println(`\n  ${C.bold}Security & Compatibility Report${C.reset}`);
    this.println(`  ${C.dim}${"─".repeat(50)}${C.reset}`);
    this.println(`  ${C.dim}Compatibility Score:${C.reset} ${this.renderScore(compatReport.score)}`);
    this.println("");

    if (packageResult.errors.length > 0) {
      this.println(`  ${C.red}${C.bold}Errors (${packageResult.errors.length}):${C.reset}`);
      for (const e of packageResult.errors) {
        this.println(`  ${C.red}x${C.reset} ${e}`);
      }
      this.println("");
    }

    if (packageResult.warnings.length > 0) {
      this.println(`  ${C.yellow}${C.bold}Warnings (${packageResult.warnings.length}):${C.reset}`);
      for (const w of packageResult.warnings) {
        this.println(`  ${C.yellow}!${C.reset} ${w}`);
      }
      this.println("");
    }

    if (compatReport.suggestions.length > 0) {
      this.println(`  ${C.cyan}Suggestions:${C.reset}`);
      for (const s of compatReport.suggestions) {
        this.println(`  ${C.cyan}*${C.reset} ${s}`);
      }
      this.println("");
    }
  }

  // -----------------------------------------------------------------------
  // Command: templates
  // -----------------------------------------------------------------------

  private cmdTemplates(): void {
    this.println(`\n  ${C.bold}Available Skill Templates:${C.reset}\n`);

    const idWidth = 15;
    const nameWidth = 22;

    this.println(
      `  ${C.bold}${this.pad("ID", idWidth)}  ${this.pad("NAME", nameWidth)}  DESCRIPTION${C.reset}`
    );
    this.println(`  ${C.dim}${"─".repeat(70)}${C.reset}`);

    for (const t of SKILL_TEMPLATES) {
      this.println(
        `  ${C.cyan}${this.pad(t.id, idWidth)}${C.reset}  ${this.pad(t.name, nameWidth)}  ${t.description}`
      );
    }

    this.println("");
    this.println(`  ${C.dim}Create a skill:${C.reset} ${C.cyan}astrahub create <template-id> <skill-name>${C.reset}`);
    this.println("");
  }

  // -----------------------------------------------------------------------
  // Help and version
  // -----------------------------------------------------------------------

  private printHelp(): void {
    this.println("");
    this.println(`  ${C.bold}${C.cyan}AstraHub CLI${C.reset} — the npm for AI agent skills`);
    this.println(`  ${C.dim}Part of AstraOS${C.reset}`);
    this.println("");
    this.println(`  ${C.bold}Usage:${C.reset} astrahub <command> [options]`);
    this.println("");
    this.println(`  ${C.bold}Commands:${C.reset}`);
    this.println("");
    this.println(`    ${C.cyan}install${C.reset} <skill-name> [--version x.y.z]     Install a skill from AstraHub`);
    this.println(`    ${C.cyan}uninstall${C.reset} <skill-name>                     Remove an installed skill`);
    this.println(`    ${C.cyan}search${C.reset} <query> [--category cat] [--sort]    Search for skills`);
    this.println(`    ${C.cyan}publish${C.reset} [--dir ./path]                      Publish a skill to AstraHub`);
    this.println(`    ${C.cyan}create${C.reset} <template> <name> [--author name]    Scaffold a new skill`);
    this.println(`    ${C.cyan}update${C.reset} [skill-name | --all]                 Update installed skill(s)`);
    this.println(`    ${C.cyan}list${C.reset} [--installed | --available]             List skills`);
    this.println(`    ${C.cyan}info${C.reset} <skill-name>                           Show skill details`);
    this.println(`    ${C.cyan}migrate${C.reset} <slug> [--from clawhub]             Import from ClawHub`);
    this.println(`    ${C.cyan}migrate${C.reset} --bulk <file.txt>                   Bulk import from file`);
    this.println(`    ${C.cyan}verify${C.reset} <skill-dir>                          Security scan a skill`);
    this.println(`    ${C.cyan}templates${C.reset}                                   List skill templates`);
    this.println(`    ${C.cyan}help${C.reset}                                        Show this help`);
    this.println(`    ${C.cyan}version${C.reset}                                     Show version`);
    this.println("");
    this.println(`  ${C.bold}Sort options:${C.reset} popular, recent, rating`);
    this.println(`  ${C.bold}Categories:${C.reset}   productivity, data, communication, devtools, ai,`);
    this.println(`                automation, security, finance, marketing, writing, other`);
    this.println("");
    this.println(`  ${C.bold}Examples:${C.reset}`);
    this.println(`    ${C.dim}$${C.reset} astrahub search "code review" --sort popular`);
    this.println(`    ${C.dim}$${C.reset} astrahub install code-reviewer`);
    this.println(`    ${C.dim}$${C.reset} astrahub create tool my-custom-skill --author "Jane Doe"`);
    this.println(`    ${C.dim}$${C.reset} astrahub migrate web-scraper --from clawhub`);
    this.println(`    ${C.dim}$${C.reset} astrahub publish --dir ./skills/my-skill`);
    this.println("");
  }

  private printVersion(): void {
    this.println(`${C.bold}AstraHub CLI${C.reset} v3.0.0 (AstraOS)`);
  }

  // -----------------------------------------------------------------------
  // Output helpers
  // -----------------------------------------------------------------------

  private println(msg: string): void {
    console.log(msg);
  }

  private printProgress(msg: string): void {
    console.log(`\n  ${C.blue}...${C.reset} ${msg}`);
  }

  private printSuccess(msg: string): void {
    console.log(`  ${C.green}OK${C.reset} ${msg}`);
  }

  private printError(msg: string): void {
    console.error(`\n  ${C.red}ERROR${C.reset} ${msg}`);
  }

  /**
   * Pad a string to a fixed width, truncating if needed.
   */
  private pad(str: string, width: number): string {
    if (str.length > width) return str.substring(0, width - 1) + "\u2026";
    return str + " ".repeat(width - str.length);
  }

  /**
   * Truncate a string with ellipsis.
   */
  private truncate(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.substring(0, max - 1) + "\u2026";
  }

  /**
   * Format a number with K/M suffixes.
   */
  private formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  /**
   * Render a star rating (0-5).
   */
  private renderStars(rating: number): string {
    const full = Math.floor(rating);
    const half = rating - full >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return `${C.yellow}${"*".repeat(full)}${half ? "~" : ""}${"o".repeat(empty)}${C.reset} ${rating.toFixed(1)}`;
  }

  /**
   * Render a compatibility score with colour.
   */
  private renderScore(score: number): string {
    if (score >= 80) return `${C.green}${score}/100${C.reset}`;
    if (score >= 50) return `${C.yellow}${score}/100${C.reset}`;
    return `${C.red}${score}/100${C.reset}`;
  }

  /**
   * Extract a --flag value from arguments.
   * Returns the value after the flag, or null if the flag is not present.
   */
  private getFlag(args: string[], flag: string): string | null {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return null;
    return args[idx + 1];
  }
}

// ---------------------------------------------------------------------------
// CLI entry point — run when invoked directly
// ---------------------------------------------------------------------------

if (require.main === module) {
  const cli = new AstraHubCLI();
  const args = process.argv.slice(2);
  cli.run(args).catch((err) => {
    console.error(`\n  \x1b[31mFATAL\x1b[0m ${err.message || err}`);
    process.exit(1);
  });
}
