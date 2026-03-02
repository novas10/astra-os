/**
 * AstraOS — Marketplace Server (AstraHub)
 * Backend for the skills marketplace: browse, search, install, rate, review, publish.
 * Supports collections, trending, featured, categories, analytics, and OpenClaw migration.
 * The "npm for AI Agent Skills" — rivals ClawHub with better security and discoverability.
 */

import type { Request, Response } from "express";
import { Router } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { logger } from "../utils/logger";

export interface MarketplaceSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  authorId: string;
  category: string;
  tags: string[];
  downloads: number;
  rating: number;
  ratingCount: number;
  price: number; // 0 = free
  verified: boolean;
  createdAt: string;
  updatedAt: string;
  readme: string;
  files: Array<{ name: string; content: string }>;
}

export interface SkillReview {
  id: string;
  skillId: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

interface InstalledSkillRecord {
  skillId: string;
  name: string;
  version: string;
  installedAt: string;
  autoUpdate: boolean;
}

export class MarketplaceServer {
  private router: Router;
  private skills: Map<string, MarketplaceSkill> = new Map();
  private reviews: Map<string, SkillReview[]> = new Map();
  private installed: Map<string, InstalledSkillRecord> = new Map();
  private skillsDir: string;
  private registryFile: string;
  private remoteUrl: string;

  constructor(skillsDir?: string) {
    this.router = Router();
    this.skillsDir = skillsDir || path.join(process.cwd(), "skills");
    this.registryFile = path.join(this.skillsDir, ".registry.json");
    this.remoteUrl = process.env.ASTRA_HUB_URL || "https://hub.astra-os.dev/api/v1";
    this.setupRoutes();
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.skillsDir, { recursive: true });
    await this.loadRegistry();
    await this.syncLocalSkills();
    logger.info(`[Marketplace] Initialized with ${this.installed.size} installed skills`);
  }

  private async loadRegistry(): Promise<void> {
    try {
      const data = await fs.readFile(this.registryFile, "utf-8");
      const registry = JSON.parse(data) as { installed: InstalledSkillRecord[] };
      for (const rec of registry.installed) {
        this.installed.set(rec.skillId, rec);
      }
    } catch {
      // No registry yet
    }
  }

  private async saveRegistry(): Promise<void> {
    const registry = { installed: Array.from(this.installed.values()) };
    await fs.writeFile(this.registryFile, JSON.stringify(registry, null, 2), "utf-8");
  }

  private async syncLocalSkills(): Promise<void> {
    try {
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillFile = path.join(this.skillsDir, entry.name, "SKILL.md");
        try {
          await fs.access(skillFile);
          if (!this.installed.has(entry.name)) {
            this.installed.set(entry.name, {
              skillId: entry.name,
              name: entry.name,
              version: "local",
              installedAt: new Date().toISOString(),
              autoUpdate: false,
            });
          }
        } catch {
          // Not a valid skill folder
        }
      }
    } catch {
      // Skills dir may not exist yet
    }
  }

  private setupRoutes(): void {
    // Search marketplace
    this.router.get("/search", async (req: Request, res: Response) => {
      const query = (req.query.q as string) || "";
      const category = req.query.category as string;
      const sort = (req.query.sort as string) || "downloads";
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      try {
        const results = await this.searchRemote(query, category, sort, page, limit);
        res.json(results);
      } catch {
        // Fall back to local cache
        const local = this.searchLocal(query, category);
        res.json({ skills: local, total: local.length, page: 1, hasMore: false });
      }
    });

    // Get skill details
    this.router.get("/skills/:id", async (req: Request, res: Response) => {
      const { id } = req.params;
      try {
        const skill = await this.getSkillDetails(id);
        if (!skill) return res.status(404).json({ error: "Skill not found" });
        res.json(skill);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Install a skill
    this.router.post("/skills/:id/install", async (req: Request, res: Response) => {
      const { id } = req.params;
      const { version } = req.body || {};
      try {
        const result = await this.install(id, version);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Uninstall a skill
    this.router.delete("/skills/:id", async (req: Request, res: Response) => {
      const { id } = req.params;
      try {
        await this.uninstall(id);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Update a skill
    this.router.post("/skills/:id/update", async (req: Request, res: Response) => {
      const { id } = req.params;
      try {
        const result = await this.update(id);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // List installed skills
    this.router.get("/installed", (_req: Request, res: Response) => {
      res.json(Array.from(this.installed.values()));
    });

    // Rate a skill
    this.router.post("/skills/:id/rate", async (req: Request, res: Response) => {
      const { id } = req.params;
      const { rating, comment, userId, userName } = req.body;
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Rating must be 1-5" });
      }

      const review: SkillReview = {
        id: `rev_${Date.now()}`,
        skillId: id,
        userId: userId || "anonymous",
        userName: userName || "Anonymous",
        rating,
        comment: comment || "",
        createdAt: new Date().toISOString(),
      };

      const existing = this.reviews.get(id) || [];
      existing.push(review);
      this.reviews.set(id, existing);

      // Submit to remote
      try {
        await fetch(`${this.remoteUrl}/skills/${id}/reviews`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(review),
        });
      } catch {
        // Store locally if remote is unavailable
      }

      res.json({ success: true, review });
    });

    // Get reviews for a skill
    this.router.get("/skills/:id/reviews", async (req: Request, res: Response) => {
      const { id } = req.params;
      try {
        const resp = await fetch(`${this.remoteUrl}/skills/${id}/reviews`);
        const reviews = await resp.json();
        res.json(reviews);
      } catch {
        res.json(this.reviews.get(id) || []);
      }
    });

    // Publish a skill
    this.router.post("/publish", async (req: Request, res: Response) => {
      const { name, description, category, tags, files, price } = req.body;
      if (!name || !files || !Array.isArray(files)) {
        return res.status(400).json({ error: "name and files are required" });
      }

      try {
        const result = await this.publish({ name, description, category, tags, files, price });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Categories — 20 categories covering every use case
    this.router.get("/categories", (_req: Request, res: Response) => {
      res.json([
        { id: "productivity", name: "Productivity", icon: "zap", count: 0, description: "Email, calendar, tasks, notes, meetings" },
        { id: "devtools", name: "Developer Tools", icon: "code", count: 0, description: "Git, CI/CD, code review, Docker, API testing" },
        { id: "data", name: "Data & Analytics", icon: "bar-chart", count: 0, description: "CSV, JSON, SQL, web scraping, visualization" },
        { id: "communication", name: "Communication", icon: "message-circle", count: 0, description: "Slack, Discord, WhatsApp, SMS, notifications" },
        { id: "ai", name: "AI & ML", icon: "brain", count: 0, description: "Vision, NLP, translation, summarization" },
        { id: "devops", name: "DevOps & Infra", icon: "server", count: 0, description: "Server monitoring, SSL, DNS, cloud costs" },
        { id: "finance", name: "Finance", icon: "dollar-sign", count: 0, description: "Expenses, stocks, invoices, currency" },
        { id: "smart-home", name: "Smart Home & IoT", icon: "home", count: 0, description: "Home Assistant, sensors, energy tracking" },
        { id: "security", name: "Security", icon: "shield", count: 0, description: "Passwords, vulnerability scanning, IP checks" },
        { id: "content", name: "Content & Social", icon: "edit", count: 0, description: "Blog writing, social media, YouTube, RSS" },
        { id: "automation", name: "Automation", icon: "repeat", count: 0, description: "Workflows, cron jobs, file conversion" },
        { id: "marketing", name: "Marketing", icon: "megaphone", count: 0, description: "SEO, analytics, campaigns, lead gen" },
        { id: "education", name: "Education", icon: "book", count: 0, description: "Tutoring, quiz generation, research" },
        { id: "health", name: "Health & Fitness", icon: "heart", count: 0, description: "Workout tracking, nutrition, meditation" },
        { id: "legal", name: "Legal & Compliance", icon: "file-text", count: 0, description: "Contract review, GDPR, policy generation" },
        { id: "hr", name: "HR & Recruiting", icon: "users", count: 0, description: "Resume screening, onboarding, surveys" },
        { id: "design", name: "Design", icon: "figma", count: 0, description: "Color palettes, image generation, UI critique" },
        { id: "gaming", name: "Gaming", icon: "gamepad", count: 0, description: "Game NPCs, strategy guides, stat tracking" },
        { id: "travel", name: "Travel", icon: "map", count: 0, description: "Trip planning, flight tracking, translation" },
        { id: "other", name: "Other", icon: "package", count: 0, description: "Everything else" },
      ]);
    });

    // ─── Collections — curated lists of skills ───
    this.router.get("/collections", (_req: Request, res: Response) => {
      res.json([
        {
          id: "starter-pack",
          name: "Starter Pack",
          description: "Essential skills every AstraOS user needs",
          skills: ["email-assistant", "calendar-manager", "task-manager", "note-taker", "web-scraper"],
          icon: "rocket",
        },
        {
          id: "developer-essentials",
          name: "Developer Essentials",
          description: "Must-have skills for software developers",
          skills: ["code-reviewer", "git-assistant", "ci-monitor", "docker-manager", "api-tester", "sql-assistant"],
          icon: "terminal",
        },
        {
          id: "data-toolkit",
          name: "Data Toolkit",
          description: "Everything you need for data analysis",
          skills: ["csv-analyzer", "json-transformer", "data-visualizer", "report-generator", "log-analyzer"],
          icon: "database",
        },
        {
          id: "communication-suite",
          name: "Communication Suite",
          description: "Stay connected across all platforms",
          skills: ["slack-manager", "discord-bot", "whatsapp-business", "notification-hub", "sms-sender"],
          icon: "radio",
        },
        {
          id: "security-hardened",
          name: "Security Hardened",
          description: "Keep your systems secure",
          skills: ["password-generator", "security-scanner", "ssl-checker", "ip-reputation", "port-scanner"],
          icon: "lock",
        },
        {
          id: "solopreneur",
          name: "Solopreneur Bundle",
          description: "Run your one-person business with AI",
          skills: ["invoice-generator", "expense-tracker", "social-poster", "blog-writer", "email-assistant", "calendar-manager"],
          icon: "briefcase",
        },
      ]);
    });

    // ─── Trending — most installed skills in last 7 days ───
    this.router.get("/trending", async (req: Request, res: Response) => {
      const period = (req.query.period as string) || "week";
      try {
        const resp = await fetch(`${this.remoteUrl}/trending?period=${period}`);
        res.json(await resp.json());
      } catch {
        // Return local popularity based on installed skills
        const trending = Array.from(this.installed.values())
          .sort((a, b) => new Date(b.installedAt).getTime() - new Date(a.installedAt).getTime())
          .slice(0, 20);
        res.json({ period, skills: trending });
      }
    });

    // ─── Featured — editorially curated by AstraOS team ───
    this.router.get("/featured", async (_req: Request, res: Response) => {
      try {
        const resp = await fetch(`${this.remoteUrl}/featured`);
        res.json(await resp.json());
      } catch {
        res.json({ featured: [], updatedAt: new Date().toISOString() });
      }
    });

    // ─── Statistics ───
    this.router.get("/stats", async (_req: Request, res: Response) => {
      const localSkillCount = this.installed.size;
      try {
        const resp = await fetch(`${this.remoteUrl}/stats`);
        const remote = (await resp.json()) as Record<string, unknown>;
        res.json({ ...remote, localInstalled: localSkillCount });
      } catch {
        res.json({
          totalSkills: localSkillCount,
          totalDownloads: 0,
          totalPublishers: 0,
          localInstalled: localSkillCount,
          categories: 20,
          collections: 6,
        });
      }
    });

    // ─── Bulk install — install multiple skills at once ───
    this.router.post("/bulk-install", async (req: Request, res: Response) => {
      const { skills } = req.body as { skills: string[] };
      if (!skills || !Array.isArray(skills)) {
        return res.status(400).json({ error: "skills array required" });
      }

      const results: Array<{ skill: string; success: boolean; error?: string }> = [];
      for (const skillId of skills) {
        try {
          await this.install(skillId);
          results.push({ skill: skillId, success: true });
        } catch (err) {
          results.push({ skill: skillId, success: false, error: (err as Error).message });
        }
      }

      res.json({ total: skills.length, installed: results.filter((r) => r.success).length, results });
    });

    // ─── Skill dependency resolution ───
    this.router.get("/skills/:id/dependencies", async (req: Request, res: Response) => {
      const { id } = req.params;
      try {
        const resp = await fetch(`${this.remoteUrl}/skills/${id}/dependencies`);
        res.json(await resp.json());
      } catch {
        res.json({ dependencies: [], devDependencies: [] });
      }
    });

    // ─── Generate install badge/shield ───
    this.router.get("/skills/:id/badge", (req: Request, res: Response) => {
      const { id } = req.params;
      const record = this.installed.get(id);
      const badge = {
        schemaVersion: 1,
        label: "AstraHub",
        message: record ? `v${record.version}` : "available",
        color: record ? "brightgreen" : "blue",
        namedLogo: "astra",
      };
      res.json(badge);
    });
  }

  private async searchRemote(
    query: string,
    category?: string,
    sort = "downloads",
    page = 1,
    limit = 20,
  ): Promise<{ skills: MarketplaceSkill[]; total: number; page: number; hasMore: boolean }> {
    const params = new URLSearchParams({ q: query, sort, page: String(page), limit: String(limit) });
    if (category) params.set("category", category);

    const resp = await fetch(`${this.remoteUrl}/search?${params}`);
    if (!resp.ok) throw new Error(`Marketplace search failed: ${resp.status}`);
    return (await resp.json()) as { skills: MarketplaceSkill[]; total: number; page: number; hasMore: boolean };
  }

  private searchLocal(query: string, category?: string): MarketplaceSkill[] {
    const lower = query.toLowerCase();
    return Array.from(this.skills.values()).filter((s) => {
      const matchesQuery = !query || s.name.toLowerCase().includes(lower) || s.description.toLowerCase().includes(lower);
      const matchesCategory = !category || s.category === category;
      return matchesQuery && matchesCategory;
    });
  }

  private async getSkillDetails(id: string): Promise<MarketplaceSkill | null> {
    // 1. Check local catalog first
    const local = this.skills.get(id);
    if (local) return local;

    // 2. Check if installed locally — read SKILL.md for details
    const localSkill = await this.readLocalSkill(id);
    if (localSkill) return localSkill;

    // 3. Try remote hub
    try {
      const resp = await fetch(`${this.remoteUrl}/skills/${id}`);
      if (!resp.ok) return null;
      return (await resp.json()) as MarketplaceSkill;
    } catch {
      return null;
    }
  }

  /**
   * Read a locally installed skill's SKILL.md and construct a MarketplaceSkill from it.
   */
  private async readLocalSkill(skillId: string): Promise<MarketplaceSkill | null> {
    const skillDir = path.join(this.skillsDir, skillId);
    try {
      const skillMd = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf-8");
      const nameMatch = skillMd.match(/^#\s+(.+)/m);
      const descMatch = skillMd.match(/^>\s*(.+)/m);
      const versionMatch = skillMd.match(/version:\s*(\S+)/i);
      const categoryMatch = skillMd.match(/category:\s*(\S+)/i);

      // Read all files in the skill directory
      const files: Array<{ name: string; content: string }> = [];
      const entries = await fs.readdir(skillDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const content = await fs.readFile(path.join(skillDir, entry.name), "utf-8");
          files.push({ name: entry.name, content });
        }
      }

      return {
        id: skillId,
        name: nameMatch?.[1] || skillId,
        version: versionMatch?.[1] || "local",
        description: descMatch?.[1] || "",
        author: "local",
        authorId: "local",
        category: categoryMatch?.[1] || "other",
        tags: [],
        downloads: 0,
        rating: 0,
        ratingCount: 0,
        price: 0,
        verified: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        readme: skillMd,
        files,
      };
    } catch {
      return null;
    }
  }

  async install(skillId: string, version?: string): Promise<{ success: boolean; name: string; version: string }> {
    // 1. Try to install from local catalog first
    const localCatalog = this.skills.get(skillId);
    if (localCatalog) {
      return this.installFromData(localCatalog);
    }

    // 2. Check if it's a local directory path (for offline installs)
    try {
      const stat = await fs.stat(skillId);
      if (stat.isDirectory()) {
        return this.installFromDirectory(skillId);
      }
    } catch {
      // Not a local path
    }

    // 3. Try remote hub
    try {
      const url = version
        ? `${this.remoteUrl}/skills/${skillId}/versions/${version}`
        : `${this.remoteUrl}/skills/${skillId}`;

      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Remote not available");

      const data = (await resp.json()) as MarketplaceSkill;
      return this.installFromData(data);
    } catch {
      throw new Error(`Skill "${skillId}" not found locally or on AstraHub. Use a local path or check your connection.`);
    }
  }

  private async installFromData(data: MarketplaceSkill): Promise<{ success: boolean; name: string; version: string }> {
    const skillDir = path.join(this.skillsDir, data.name);
    await fs.mkdir(skillDir, { recursive: true });

    for (const file of data.files) {
      const filePath = path.join(skillDir, file.name);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content, "utf-8");
    }

    // Add to local catalog
    this.skills.set(data.id || data.name, data);

    this.installed.set(data.id || data.name, {
      skillId: data.id || data.name,
      name: data.name,
      version: data.version,
      installedAt: new Date().toISOString(),
      autoUpdate: true,
    });

    await this.saveRegistry();
    logger.info(`[Marketplace] Installed: ${data.name} v${data.version}`);
    return { success: true, name: data.name, version: data.version };
  }

  /**
   * Install from a local directory (offline install).
   */
  private async installFromDirectory(dirPath: string): Promise<{ success: boolean; name: string; version: string }> {
    const skillMdPath = path.join(dirPath, "SKILL.md");
    try {
      await fs.access(skillMdPath);
    } catch {
      throw new Error(`No SKILL.md found in "${dirPath}" — not a valid skill directory`);
    }

    const name = path.basename(dirPath);
    const targetDir = path.join(this.skillsDir, name);
    await fs.mkdir(targetDir, { recursive: true });

    // Copy all files from source to target
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const src = path.join(dirPath, entry.name);
        const dst = path.join(targetDir, entry.name);
        await fs.copyFile(src, dst);
      }
    }

    this.installed.set(name, {
      skillId: name,
      name,
      version: "local",
      installedAt: new Date().toISOString(),
      autoUpdate: false,
    });

    await this.saveRegistry();
    logger.info(`[Marketplace] Installed from local: ${name}`);
    return { success: true, name, version: "local" };
  }

  async uninstall(skillId: string): Promise<void> {
    const record = this.installed.get(skillId);
    if (!record) throw new Error(`Skill "${skillId}" is not installed`);

    const skillDir = path.join(this.skillsDir, record.name);
    await fs.rm(skillDir, { recursive: true, force: true });
    this.installed.delete(skillId);
    await this.saveRegistry();
    logger.info(`[Marketplace] Uninstalled: ${record.name}`);
  }

  async update(skillId: string): Promise<{ success: boolean; version: string }> {
    const record = this.installed.get(skillId);
    if (!record) throw new Error(`Skill "${skillId}" is not installed`);

    const result = await this.install(skillId);
    return { success: true, version: result.version };
  }

  private async publish(data: {
    name: string;
    description?: string;
    category?: string;
    tags?: string[];
    files: Array<{ name: string; content: string }>;
    price?: number;
  }): Promise<{ success: boolean; id: string }> {
    const id = `skill_${crypto.randomBytes(8).toString("hex")}`;

    // Always save to local catalog
    const skill: MarketplaceSkill = {
      id,
      name: data.name,
      version: "1.0.0",
      description: data.description || "",
      author: "local",
      authorId: "local",
      category: data.category || "other",
      tags: data.tags || [],
      downloads: 0,
      rating: 0,
      ratingCount: 0,
      price: data.price || 0,
      verified: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      readme: "",
      files: data.files,
    };

    this.skills.set(id, skill);

    // Write to local skills directory
    const skillDir = path.join(this.skillsDir, data.name);
    await fs.mkdir(skillDir, { recursive: true });
    for (const file of data.files) {
      const filePath = path.join(skillDir, file.name);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content, "utf-8");
    }

    // Write manifest for sharing
    const manifest = { id, name: data.name, version: "1.0.0", description: data.description, category: data.category, tags: data.tags, files: data.files.map((f) => f.name) };
    await fs.writeFile(path.join(skillDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

    // Try to publish to remote hub (non-blocking)
    try {
      const resp = await fetch(`${this.remoteUrl}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (resp.ok) {
        const remote = (await resp.json()) as { id: string };
        logger.info(`[Marketplace] Published to AstraHub: ${data.name} (${remote.id})`);
      }
    } catch {
      logger.info(`[Marketplace] Published locally: ${data.name} (remote hub unavailable)`);
    }

    return { success: true, id };
  }

  getRouter(): Router {
    return this.router;
  }

  getInstalledSkills(): InstalledSkillRecord[] {
    return Array.from(this.installed.values());
  }

  getStats(): { installed: number; categories: number; collections: number } {
    return {
      installed: this.installed.size,
      categories: 20,
      collections: 6,
    };
  }

  async installCollection(collectionId: string): Promise<{ installed: number; failed: number }> {
    const collections: Record<string, string[]> = {
      "starter-pack": ["email-assistant", "calendar-manager", "task-manager", "note-taker", "web-scraper"],
      "developer-essentials": ["code-reviewer", "git-assistant", "ci-monitor", "docker-manager", "api-tester", "sql-assistant"],
      "data-toolkit": ["csv-analyzer", "json-transformer", "data-visualizer", "report-generator", "log-analyzer"],
      "communication-suite": ["slack-manager", "discord-bot", "whatsapp-business", "notification-hub", "sms-sender"],
      "security-hardened": ["password-generator", "security-scanner", "ssl-checker", "ip-reputation", "port-scanner"],
      "solopreneur": ["invoice-generator", "expense-tracker", "social-poster", "blog-writer", "email-assistant", "calendar-manager"],
    };

    const skills = collections[collectionId];
    if (!skills) throw new Error(`Collection "${collectionId}" not found`);

    let installed = 0;
    let failed = 0;
    for (const skill of skills) {
      try {
        await this.install(skill);
        installed++;
      } catch {
        failed++;
      }
    }

    return { installed, failed };
  }
}
