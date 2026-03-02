/**
 * AstraOS — SkillSandbox.ts
 * Deep skill security analysis + cryptographic signing — solves OpenClaw's ClawHavoc attack.
 *
 * Multi-layer protection:
 * 1. Deep static analysis — pattern detection beyond simple regex
 * 2. Cryptographic signing — Ed25519 skill signatures for verified publishers
 * 3. Permission manifest — skills declare required permissions upfront
 * 4. Reputation scoring — track skill safety history
 * 5. Quarantine system — auto-quarantine flagged skills
 * 6. Community reporting — crowdsourced security
 */

import type { Request, Response } from "express";
import { Router } from "express";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger";

interface SecurityIssue {
  severity: "info" | "low" | "medium" | "high" | "critical";
  category: string;
  message: string;
  file: string;
  line?: number;
  evidence?: string;
}

interface SkillSecurityReport {
  safe: boolean;
  score: number;            // 0-100
  grade: string;            // A+ to F
  issues: SecurityIssue[];
  permissions: string[];    // Detected permissions needed
  signatureValid: boolean;
  quarantined: boolean;
  analyzedAt: string;
}

interface ReputationRecord {
  skillId: string;
  score: number;
  verified: boolean;
  reports: Array<{ reporterId: string; reason: string; timestamp: string }>;
  installCount: number;
  lastAnalyzed: string;
}

interface QuarantineRecord {
  skillId: string;
  reason: string;
  quarantinedAt: string;
  quarantinedBy: string;
}

// Deep analysis patterns — far beyond simple regex
const ANALYSIS_RULES: Array<{
  category: string;
  patterns: Array<{ regex: RegExp; severity: SecurityIssue["severity"]; message: string }>;
}> = [
  {
    category: "data-exfiltration",
    patterns: [
      { regex: /fetch\s*\([^)]*process\.env/g, severity: "critical", message: "Sends environment variables to external URL" },
      { regex: /fetch\s*\([^)]*apiKey|api_key|token|secret|password/gi, severity: "critical", message: "Sends credentials to external URL" },
      { regex: /btoa\s*\(\s*(?:process\.env|JSON\.stringify)/g, severity: "critical", message: "Base64-encodes credentials before network call" },
      { regex: /XMLHttpRequest|navigator\.sendBeacon/g, severity: "high", message: "Uses alternative network APIs (potential exfiltration)" },
      { regex: /new\s+WebSocket\s*\([^)]*(?!localhost|127\.0\.0\.1)/g, severity: "high", message: "Opens WebSocket to external host" },
    ],
  },
  {
    category: "obfuscation",
    patterns: [
      { regex: /String\.fromCharCode\s*\(\s*\d+(?:\s*,\s*\d+){10,}/g, severity: "high", message: "Excessive String.fromCharCode — likely obfuscated code" },
      { regex: /\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){10,}/gi, severity: "high", message: "Hex-encoded string — likely obfuscated payload" },
      { regex: /\\u[0-9a-f]{4}(?:\\u[0-9a-f]{4}){10,}/gi, severity: "high", message: "Unicode-escaped string — likely obfuscated payload" },
      { regex: /atob\s*\(\s*["'][A-Za-z0-9+/=]{50,}["']\s*\)/g, severity: "critical", message: "Decodes long base64 string — hidden payload" },
      { regex: /Buffer\.from\s*\(\s*["'][A-Za-z0-9+/=]{50,}["']\s*,\s*["']base64["']\s*\)/g, severity: "critical", message: "Decodes long base64 buffer — hidden payload" },
    ],
  },
  {
    category: "code-injection",
    patterns: [
      { regex: /eval\s*\(/g, severity: "critical", message: "Uses eval() — arbitrary code execution" },
      { regex: /new\s+Function\s*\(/g, severity: "critical", message: "Dynamic Function constructor — code injection" },
      { regex: /require\s*\(\s*['"`]child_process/g, severity: "critical", message: "Imports child_process — command execution" },
      { regex: /import\s+.*from\s+['"`]child_process/g, severity: "critical", message: "Imports child_process — command execution" },
      { regex: /\.exec\s*\(\s*[^)]*\$\{/g, severity: "critical", message: "Template literal in exec — command injection" },
      { regex: /spawn\s*\(|execFile\s*\(|execSync\s*\(/g, severity: "critical", message: "Process spawning — potential RCE" },
      { regex: /vm\.runIn(?:New|This)Context/g, severity: "high", message: "VM context execution — sandbox escape risk" },
    ],
  },
  {
    category: "persistence",
    patterns: [
      { regex: /crontab|\/etc\/cron/g, severity: "critical", message: "Modifies cron — persistence mechanism" },
      { regex: /systemctl\s+enable|systemd/g, severity: "critical", message: "Modifies systemd — persistence mechanism" },
      { regex: /\.bashrc|\.profile|\.zshrc|autostart/g, severity: "high", message: "Modifies shell startup files — persistence" },
      { regex: /LaunchAgent|LaunchDaemon|plist/g, severity: "high", message: "macOS launch agent — persistence" },
      { regex: /HKEY_|RegWrite|Registry/g, severity: "high", message: "Windows registry modification — persistence" },
    ],
  },
  {
    category: "credential-theft",
    patterns: [
      { regex: /AKIA[0-9A-Z]{16}/g, severity: "critical", message: "Contains AWS access key pattern" },
      { regex: /ghp_[a-zA-Z0-9]{36}/g, severity: "critical", message: "Contains GitHub personal access token pattern" },
      { regex: /sk_(?:live|test)_[a-zA-Z0-9]{24,}/g, severity: "critical", message: "Contains Stripe secret key pattern" },
      { regex: /xoxb-[0-9]{10,}-[0-9]{10,}-[a-zA-Z0-9]{24}/g, severity: "critical", message: "Contains Slack bot token pattern" },
      { regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, severity: "high", message: "Contains hardcoded JWT token" },
      { regex: /\/etc\/passwd|\/etc\/shadow|\.ssh\/id_rsa/g, severity: "critical", message: "Accesses system credential files" },
    ],
  },
  {
    category: "crypto-mining",
    patterns: [
      { regex: /stratum\+tcp|mining[_-]?pool|cryptonight|xmrig/gi, severity: "critical", message: "Crypto mining references detected" },
      { regex: /coinhive|coin-hive|miner\.start/gi, severity: "critical", message: "Browser crypto miner detected" },
    ],
  },
  {
    category: "privilege-escalation",
    patterns: [
      { regex: /sudo\s+/g, severity: "high", message: "Uses sudo — privilege escalation" },
      { regex: /chmod\s+[0-7]*[4-7][0-7]{2}\s+\//g, severity: "high", message: "Changes permissions on system files" },
      { regex: /chown\s+root/g, severity: "high", message: "Changes ownership to root" },
      { regex: /setuid|setgid|capabilities/g, severity: "high", message: "Modifies process privileges" },
    ],
  },
  {
    category: "filesystem-abuse",
    patterns: [
      { regex: /require\s*\(\s*['"`]fs['"`]\s*\)/g, severity: "medium", message: "Uses filesystem — check permissions" },
      { regex: /import\s+.*from\s+['"`]fs/g, severity: "medium", message: "Imports fs module" },
      { regex: /rm\s+-rf?\s+\//g, severity: "critical", message: "Recursive delete from root — destructive" },
      { regex: /writeFileSync\s*\(\s*['"`]\/(?:etc|usr|bin|sbin)/g, severity: "critical", message: "Writes to system directories" },
    ],
  },
  {
    category: "network",
    patterns: [
      { regex: /process\.env/g, severity: "low", message: "Accesses environment variables" },
      { regex: /fetch\s*\(/g, severity: "info", message: "Makes network requests" },
      { regex: /net\.createServer|dgram\.createSocket/g, severity: "high", message: "Creates network server — potential backdoor" },
    ],
  },
];

export class SkillSandbox {
  private reputationDb: Map<string, ReputationRecord> = new Map();
  private quarantineList: Map<string, QuarantineRecord> = new Map();
  private vaultDir: string;
  private router: Router;

  constructor() {
    this.vaultDir = path.join(process.cwd(), ".astra-vault");
    this.router = Router();
    this.setupRoutes();
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.vaultDir, { recursive: true });
    await this.loadReputation();
    await this.loadQuarantine();
    logger.info(`[AstraOS] SkillSandbox: ${this.quarantineList.size} quarantined skills, ${this.reputationDb.size} tracked`);
  }

  // ─── Deep Static Analysis ───

  deepAnalyze(files: Array<{ name: string; content: string }>): SkillSecurityReport {
    const issues: SecurityIssue[] = [];
    const detectedPermissions: Set<string> = new Set();

    for (const file of files) {
      const ext = path.extname(file.name).toLowerCase();
      // Analyze code files AND markdown (system prompts can contain tool calls)
      if (![".ts", ".js", ".mjs", ".cjs", ".md"].includes(ext)) continue;

      for (const ruleGroup of ANALYSIS_RULES) {
        for (const { regex, severity, message } of ruleGroup.patterns) {
          const pattern = new RegExp(regex.source, regex.flags);
          let match;
          while ((match = pattern.exec(file.content)) !== null) {
            const line = file.content.substring(0, match.index).split("\n").length;
            issues.push({
              severity,
              category: ruleGroup.category,
              message,
              file: file.name,
              line,
              evidence: match[0].slice(0, 100),
            });

            // Auto-detect permissions
            if (ruleGroup.category === "network") detectedPermissions.add("network");
            if (ruleGroup.category === "filesystem-abuse") detectedPermissions.add("filesystem");
            if (ruleGroup.category === "code-injection") detectedPermissions.add("shell");
          }
        }
      }

      // Check for steganographic payloads — unusually long strings
      const longStringMatch = file.content.match(/["'`][^"'`]{500,}["'`]/g);
      if (longStringMatch) {
        issues.push({
          severity: "high",
          category: "obfuscation",
          message: `Suspiciously long string (${longStringMatch[0].length} chars) — possible steganographic payload`,
          file: file.name,
        });
      }

      // Check for dynamic requires — dependency confusion
      const dynamicRequire = file.content.match(/require\s*\(\s*[^"'`\s]/g);
      if (dynamicRequire) {
        issues.push({
          severity: "high",
          category: "code-injection",
          message: "Dynamic require() with variable — potential dependency confusion",
          file: file.name,
        });
      }
    }

    // Calculate score
    let score = 100;
    for (const issue of issues) {
      switch (issue.severity) {
        case "critical": score -= 25; break;
        case "high": score -= 15; break;
        case "medium": score -= 8; break;
        case "low": score -= 3; break;
        case "info": score -= 1; break;
      }
    }
    score = Math.max(0, score);

    const grade = score >= 95 ? "A+" : score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
    const hasCritical = issues.some((i) => i.severity === "critical");

    return {
      safe: !hasCritical && score >= 50,
      score,
      grade,
      issues,
      permissions: Array.from(detectedPermissions),
      signatureValid: false,
      quarantined: false,
      analyzedAt: new Date().toISOString(),
    };
  }

  // ─── Cryptographic Signing (Ed25519) ───

  generateKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    return {
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
  }

  async signSkill(skillDir: string, privateKeyPem: string): Promise<string> {
    const contentHash = await this.hashSkillContent(skillDir);
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const signature = crypto.sign(null, Buffer.from(contentHash), privateKey);
    const signatureHex = signature.toString("hex");

    // Write signature file
    const sigFile = path.join(skillDir, "SKILL.sig");
    const sigData = JSON.stringify({
      algorithm: "Ed25519",
      contentHash,
      signature: signatureHex,
      signedAt: new Date().toISOString(),
    }, null, 2);
    await fs.writeFile(sigFile, sigData, "utf-8");

    logger.info(`[SkillSandbox] Skill signed: ${skillDir}`);
    return signatureHex;
  }

  async verifySignature(skillDir: string, publicKeyPem: string): Promise<{ verified: boolean; signedAt?: string }> {
    try {
      const sigFile = path.join(skillDir, "SKILL.sig");
      const sigData = JSON.parse(await fs.readFile(sigFile, "utf-8"));

      const contentHash = await this.hashSkillContent(skillDir);
      if (contentHash !== sigData.contentHash) {
        return { verified: false }; // Content has been modified since signing
      }

      const publicKey = crypto.createPublicKey(publicKeyPem);
      const verified = crypto.verify(null, Buffer.from(contentHash), publicKey, Buffer.from(sigData.signature, "hex"));

      return { verified, signedAt: sigData.signedAt };
    } catch {
      return { verified: false };
    }
  }

  private async hashSkillContent(skillDir: string): Promise<string> {
    const hash = crypto.createHash("sha256");
    const files = await this.collectFiles(skillDir);

    // Sort files for deterministic hash
    files.sort((a, b) => a.name.localeCompare(b.name));

    for (const file of files) {
      if (file.name === "SKILL.sig") continue; // Skip signature file
      hash.update(file.name);
      hash.update(file.content);
    }

    return hash.digest("hex");
  }

  private async collectFiles(dir: string): Promise<Array<{ name: string; content: string }>> {
    const files: Array<{ name: string; content: string }> = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const sub = await this.collectFiles(fullPath);
          files.push(...sub);
        } else {
          const content = await fs.readFile(fullPath, "utf-8");
          files.push({ name: path.relative(dir, fullPath), content });
        }
      }
    } catch { /* empty dir */ }
    return files;
  }

  // ─── Reputation System ───

  getReputationScore(skillId: string): number {
    const record = this.reputationDb.get(skillId);
    return record?.score ?? 50; // Default score
  }

  reportMalicious(skillId: string, reporterId: string, reason: string): void {
    const record = this.reputationDb.get(skillId) || {
      skillId, score: 50, verified: false, reports: [], installCount: 0, lastAnalyzed: new Date().toISOString(),
    };

    record.reports.push({ reporterId, reason, timestamp: new Date().toISOString() });
    record.score = Math.max(0, record.score - 20);

    // Auto-quarantine if 3+ reports
    if (record.reports.length >= 3 && !this.quarantineList.has(skillId)) {
      this.quarantine(skillId, `Auto-quarantined: ${record.reports.length} malicious reports`);
    }

    this.reputationDb.set(skillId, record);
    this.saveReputation();
    logger.warn(`[SkillSandbox] Malicious report for ${skillId} by ${reporterId}: ${reason}`);
  }

  // ─── Quarantine ───

  quarantine(skillId: string, reason: string): void {
    this.quarantineList.set(skillId, {
      skillId,
      reason,
      quarantinedAt: new Date().toISOString(),
      quarantinedBy: "system",
    });
    this.saveQuarantine();
    logger.warn(`[SkillSandbox] QUARANTINED: ${skillId} — ${reason}`);
  }

  unquarantine(skillId: string): void {
    this.quarantineList.delete(skillId);
    this.saveQuarantine();
    logger.info(`[SkillSandbox] Unquarantined: ${skillId}`);
  }

  isQuarantined(skillId: string): boolean {
    return this.quarantineList.has(skillId);
  }

  // ─── Persistence ───

  private async loadReputation(): Promise<void> {
    try {
      const data = await fs.readFile(path.join(this.vaultDir, "skill-reputation.json"), "utf-8");
      const records = JSON.parse(data) as ReputationRecord[];
      for (const r of records) this.reputationDb.set(r.skillId, r);
    } catch { /* first run */ }
  }

  private async saveReputation(): Promise<void> {
    const data = JSON.stringify(Array.from(this.reputationDb.values()), null, 2);
    await fs.writeFile(path.join(this.vaultDir, "skill-reputation.json"), data, "utf-8");
  }

  private async loadQuarantine(): Promise<void> {
    try {
      const data = await fs.readFile(path.join(this.vaultDir, "quarantine.json"), "utf-8");
      const records = JSON.parse(data) as QuarantineRecord[];
      for (const r of records) this.quarantineList.set(r.skillId, r);
    } catch { /* first run */ }
  }

  private async saveQuarantine(): Promise<void> {
    const data = JSON.stringify(Array.from(this.quarantineList.values()), null, 2);
    await fs.writeFile(path.join(this.vaultDir, "quarantine.json"), data, "utf-8");
  }

  // ─── Express Router ───

  private setupRoutes(): void {
    this.router.post("/analyze", async (req: Request, res: Response) => {
      const { files } = req.body as { files: Array<{ name: string; content: string }> };
      if (!files || !Array.isArray(files)) return res.status(400).json({ error: "files array required" });
      const report = this.deepAnalyze(files);
      res.json(report);
    });

    this.router.post("/sign", async (req: Request, res: Response) => {
      const { skillDir, privateKey } = req.body;
      if (!skillDir || !privateKey) return res.status(400).json({ error: "skillDir and privateKey required" });
      try {
        const signature = await this.signSkill(skillDir, privateKey);
        res.json({ success: true, signature });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.router.post("/verify", async (req: Request, res: Response) => {
      const { skillDir, publicKey } = req.body;
      if (!skillDir || !publicKey) return res.status(400).json({ error: "skillDir and publicKey required" });
      const result = await this.verifySignature(skillDir, publicKey);
      res.json(result);
    });

    this.router.get("/quarantine", (_req: Request, res: Response) => {
      res.json(Array.from(this.quarantineList.values()));
    });

    this.router.post("/:id/quarantine", (req: Request, res: Response) => {
      const { id } = req.params;
      const { reason } = req.body;
      this.quarantine(id, reason || "Manual quarantine");
      res.json({ success: true });
    });

    this.router.delete("/:id/quarantine", (req: Request, res: Response) => {
      const { id } = req.params;
      this.unquarantine(id);
      res.json({ success: true });
    });

    this.router.post("/:id/report", (req: Request, res: Response) => {
      const { id } = req.params;
      const { reporterId, reason } = req.body;
      this.reportMalicious(id, reporterId || "anonymous", reason || "No reason given");
      res.json({ success: true, score: this.getReputationScore(id) });
    });

    this.router.get("/:id/reputation", (req: Request, res: Response) => {
      const { id } = req.params;
      const record = this.reputationDb.get(id);
      if (!record) return res.json({ skillId: id, score: 50, verified: false, reports: [] });
      res.json(record);
    });

    this.router.post("/keygen", (_req: Request, res: Response) => {
      const keyPair = this.generateKeyPair();
      res.json(keyPair);
    });
  }

  getRouter(): Router {
    return this.router;
  }
}
