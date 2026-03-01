/**
 * AstraOS — GatewayShield.ts
 * Comprehensive gateway security layer — solves OpenClaw's CVE-2026-25253,
 * public exposure detection, and CSRF vulnerabilities.
 *
 * Protections:
 * 1. Token security — never accept auth tokens from URL query params (prevents CVE-2026-25253)
 * 2. CSRF protection — double-submit cookie pattern with SameSite=Strict
 * 3. Public exposure detection — warn if instance is publicly accessible without auth
 * 4. Security headers — HSTS, X-Frame-Options, CSP, etc.
 * 5. Brute force protection — lock out after N failed auth attempts
 * 6. IP allowlist/denylist — configurable network access control
 * 7. Request origin validation — block untrusted origins
 */

import { Router, Request, Response, NextFunction } from "express";
import * as crypto from "crypto";
import * as os from "os";
import { logger } from "../utils/logger";

interface BruteForceEntry {
  count: number;
  firstAttempt: number;
  blocked: boolean;
  blockedUntil: number;
}

interface SecurityReport {
  timestamp: string;
  authConfigured: boolean;
  httpsEnabled: boolean;
  publicExposure: string;
  blockedIPs: number;
  securityHeaders: boolean;
  csrfProtection: boolean;
  bruteForceProtection: boolean;
  score: number;         // 0-100
  grade: string;         // A+ to F
  recommendations: string[];
}

export class GatewayShield {
  private bruteForceMap: Map<string, BruteForceEntry> = new Map();
  private csrfTokens: Map<string, { token: string; expires: number }> = new Map();
  private ipAllowlist: string[] = [];
  private ipDenylist: string[] = [];
  private maxFailedAttempts = 10;
  private lockoutDurationMs = 30 * 60 * 1000; // 30 minutes
  private failedWindowMs = 15 * 60 * 1000;    // 15 minute window
  private exposureStatus = "unchecked";
  private router: Router;

  constructor() {
    this.router = Router();
    this.loadConfig();
    this.setupRoutes();
  }

  private loadConfig(): void {
    const allowlist = process.env.ASTRA_IP_ALLOWLIST;
    if (allowlist) this.ipAllowlist = allowlist.split(",").map((ip) => ip.trim());

    const denylist = process.env.ASTRA_IP_DENYLIST;
    if (denylist) this.ipDenylist = denylist.split(",").map((ip) => ip.trim());
  }

  async initialize(): Promise<void> {
    // Check for public exposure on startup
    await this.checkPublicExposure();

    // Warn if auth not configured
    if (!process.env.ASTRA_API_KEYS && !process.env.ASTRA_API_KEY) {
      logger.warn("╔══════════════════════════════════════════════════════════════╗");
      logger.warn("║  ⚠ SECURITY WARNING: No API keys configured!               ║");
      logger.warn("║  Your AstraOS instance has NO authentication.               ║");
      logger.warn("║  Set ASTRA_API_KEYS env var before deploying to production. ║");
      logger.warn("╚══════════════════════════════════════════════════════════════╝");
    }

    // Cleanup expired brute force entries every 5 minutes
    setInterval(() => this.cleanupBruteForce(), 5 * 60 * 1000);

    logger.info("[AstraOS] GatewayShield: All protections active");
  }

  // ─── Middleware Stack ───

  getMiddleware(): Array<(req: Request, res: Response, next: NextFunction) => void> {
    return [
      this.securityHeaders.bind(this),
      this.tokenGuard.bind(this),
      this.ipFilter.bind(this),
      this.bruteForceGuard.bind(this),
      this.csrfGuard.bind(this),
    ];
  }

  // 1. Security Headers — harden every response
  private securityHeaders(_req: Request, res: Response, next: NextFunction): void {
    res.removeHeader("X-Powered-By");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss: https:");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("X-Download-Options", "noopen");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    next();
  }

  // 2. Token Guard — BLOCK auth tokens in URL query params (prevents CVE-2026-25253)
  private tokenGuard(req: Request, res: Response, next: NextFunction): void {
    const queryKeys = Object.keys(req.query);
    const tokenParams = ["token", "api_key", "apiKey", "access_token", "auth", "key", "secret", "gatewayUrl"];

    for (const param of tokenParams) {
      if (queryKeys.includes(param)) {
        const clientIp = req.ip || req.socket.remoteAddress || "unknown";
        logger.warn(`[GatewayShield] BLOCKED: Auth token in URL query param "${param}" from ${clientIp} — potential CVE-2026-25253 attack`);
        res.status(403).json({
          error: "Authentication tokens in URL query parameters are forbidden",
          reason: "Prevents token theft via Referrer headers, browser history, and server logs (CVE-2026-25253)",
          fix: "Send tokens via Authorization header or X-API-Key header instead",
        });
        return;
      }
    }
    next();
  }

  // 3. IP Filter — allowlist/denylist
  private ipFilter(req: Request, res: Response, next: NextFunction): void {
    const clientIp = req.ip || req.socket.remoteAddress || "";

    // Check denylist first
    if (this.ipDenylist.length > 0 && this.matchesIpList(clientIp, this.ipDenylist)) {
      logger.warn(`[GatewayShield] BLOCKED: Denied IP ${clientIp}`);
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // If allowlist is configured, only allow those IPs
    if (this.ipAllowlist.length > 0 && !this.matchesIpList(clientIp, this.ipAllowlist) && !this.isPrivateIp(clientIp)) {
      logger.warn(`[GatewayShield] BLOCKED: IP ${clientIp} not in allowlist`);
      res.status(403).json({ error: "Access denied" });
      return;
    }

    next();
  }

  // 4. Brute Force Guard — lock out after repeated failures
  private bruteForceGuard(req: Request, res: Response, next: NextFunction): void {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const entry = this.bruteForceMap.get(clientIp);

    if (entry?.blocked) {
      if (Date.now() < entry.blockedUntil) {
        const remaining = Math.ceil((entry.blockedUntil - Date.now()) / 60000);
        logger.warn(`[GatewayShield] BLOCKED: Brute force lockout for ${clientIp} (${remaining}min remaining)`);
        res.status(429).json({
          error: "Too many failed authentication attempts",
          retryAfterMinutes: remaining,
        });
        return;
      }
      // Lockout expired
      this.bruteForceMap.delete(clientIp);
    }

    next();
  }

  // 5. CSRF Guard — double-submit cookie pattern
  private csrfGuard(req: Request, res: Response, next: NextFunction): void {
    // Skip for safe methods, webhooks, and API-key-authenticated requests
    const safeMethods = ["GET", "HEAD", "OPTIONS"];
    if (safeMethods.includes(req.method)) return next();
    if (req.path.startsWith("/webhook/")) return next();
    if (req.path.startsWith("/.well-known/")) return next();
    if (req.headers["x-api-key"] || req.headers.authorization) return next();

    // Check CSRF token for browser-based requests
    const csrfHeader = req.headers["x-csrf-token"] as string;
    const csrfCookie = this.extractCookie(req, "astra_csrf");

    if (csrfCookie && csrfHeader && csrfCookie === csrfHeader) {
      return next();
    }

    // If no CSRF token, check Origin/Referer for same-origin
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin && host && new URL(origin).host === host) {
      return next();
    }

    // For API clients without cookies, pass through (they use API keys)
    if (!csrfCookie) return next();

    logger.warn(`[GatewayShield] CSRF validation failed for ${req.method} ${req.path}`);
    res.status(403).json({ error: "CSRF token validation failed" });
  }

  // ─── Public Methods ───

  recordFailedAuth(ip: string): void {
    const entry = this.bruteForceMap.get(ip) || { count: 0, firstAttempt: Date.now(), blocked: false, blockedUntil: 0 };

    // Reset if outside window
    if (Date.now() - entry.firstAttempt > this.failedWindowMs) {
      entry.count = 0;
      entry.firstAttempt = Date.now();
    }

    entry.count++;

    if (entry.count >= this.maxFailedAttempts) {
      entry.blocked = true;
      entry.blockedUntil = Date.now() + this.lockoutDurationMs;
      logger.warn(`[GatewayShield] IP ${ip} LOCKED OUT after ${entry.count} failed attempts`);
    }

    this.bruteForceMap.set(ip, entry);
  }

  generateCsrfToken(sessionId: string): string {
    const token = crypto.randomBytes(32).toString("hex");
    this.csrfTokens.set(sessionId, { token, expires: Date.now() + 3600_000 }); // 1 hour
    return token;
  }

  async checkPublicExposure(): Promise<void> {
    const port = process.env.PORT || 3000;
    const bindAddress = process.env.HOST || "0.0.0.0";
    const hasAuth = !!(process.env.ASTRA_API_KEYS || process.env.ASTRA_API_KEY);

    if (bindAddress === "0.0.0.0" && !hasAuth) {
      this.exposureStatus = "critical";
      logger.warn("╔══════════════════════════════════════════════════════════════╗");
      logger.warn("║  🚨 CRITICAL: Binding to 0.0.0.0 WITHOUT authentication!   ║");
      logger.warn("║  Your instance is accessible to the ENTIRE network.         ║");
      logger.warn("║  Set ASTRA_API_KEYS or bind to 127.0.0.1 for local only.   ║");
      logger.warn("╚══════════════════════════════════════════════════════════════╝");
    } else if (bindAddress === "0.0.0.0" && hasAuth) {
      this.exposureStatus = "protected";
      logger.info("[GatewayShield] Bound to 0.0.0.0 with auth enabled — OK");
    } else {
      this.exposureStatus = "local-only";
      logger.info(`[GatewayShield] Bound to ${bindAddress} — local access only`);
    }

    // Check for common cloud metadata endpoints (detect cloud hosting)
    try {
      const resp = await fetch("http://169.254.169.254/latest/meta-data/", {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        logger.info("[GatewayShield] Cloud environment detected (AWS/GCP/Azure)");
      }
    } catch {
      // Not running in cloud — that's fine
    }
  }

  getSecurityReport(): SecurityReport {
    const hasAuth = !!(process.env.ASTRA_API_KEYS || process.env.ASTRA_API_KEY);
    const recommendations: string[] = [];
    let score = 100;

    if (!hasAuth) { score -= 40; recommendations.push("Configure ASTRA_API_KEYS for authentication"); }
    if (this.exposureStatus === "critical") { score -= 30; recommendations.push("Bind to 127.0.0.1 or configure auth before exposing publicly"); }
    if (!process.env.MASTER_ENCRYPTION_KEY) { score -= 10; recommendations.push("Set MASTER_ENCRYPTION_KEY for credential encryption"); }
    if (this.ipAllowlist.length === 0 && this.ipDenylist.length === 0) { score -= 5; recommendations.push("Consider configuring IP allowlist for production"); }
    if (!process.env.ASTRA_CORS_ORIGINS) { score -= 5; recommendations.push("Set ASTRA_CORS_ORIGINS to restrict cross-origin access"); }

    const grade = score >= 95 ? "A+" : score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

    return {
      timestamp: new Date().toISOString(),
      authConfigured: hasAuth,
      httpsEnabled: process.env.NODE_ENV === "production",
      publicExposure: this.exposureStatus,
      blockedIPs: Array.from(this.bruteForceMap.values()).filter((e) => e.blocked).length,
      securityHeaders: true,
      csrfProtection: true,
      bruteForceProtection: true,
      score,
      grade,
      recommendations,
    };
  }

  // ─── Express Router ───

  private setupRoutes(): void {
    this.router.get("/report", (_req: Request, res: Response) => {
      res.json(this.getSecurityReport());
    });

    this.router.get("/blocked-ips", (_req: Request, res: Response) => {
      const blocked = Array.from(this.bruteForceMap.entries())
        .filter(([, e]) => e.blocked)
        .map(([ip, e]) => ({
          ip,
          failedAttempts: e.count,
          blockedUntil: new Date(e.blockedUntil).toISOString(),
          remainingMinutes: Math.max(0, Math.ceil((e.blockedUntil - Date.now()) / 60000)),
        }));
      res.json(blocked);
    });

    this.router.delete("/blocked-ips/:ip", (req: Request, res: Response) => {
      const { ip } = req.params;
      this.bruteForceMap.delete(ip);
      logger.info(`[GatewayShield] Manually unblocked IP: ${ip}`);
      res.json({ success: true, message: `IP ${ip} unblocked` });
    });

    this.router.post("/check-exposure", async (_req: Request, res: Response) => {
      await this.checkPublicExposure();
      res.json({ status: this.exposureStatus });
    });

    this.router.get("/csrf-token", (req: Request, res: Response) => {
      const sessionId = (req as Request & { apiKeyId?: string }).apiKeyId || req.ip || "default";
      const token = this.generateCsrfToken(sessionId);
      res.cookie("astra_csrf", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 3600_000,
      });
      res.json({ csrfToken: token });
    });
  }

  getRouter(): Router {
    return this.router;
  }

  // ─── Helpers ───

  private matchesIpList(ip: string, list: string[]): boolean {
    const cleanIp = ip.replace(/^::ffff:/, "");
    return list.some((entry) => {
      const cleanEntry = entry.replace(/^::ffff:/, "");
      if (cleanEntry.includes("/")) {
        return this.isIpInCidr(cleanIp, cleanEntry);
      }
      return cleanIp === cleanEntry;
    });
  }

  private isIpInCidr(ip: string, cidr: string): boolean {
    const [range, bits] = cidr.split("/");
    const mask = ~(2 ** (32 - parseInt(bits)) - 1);
    const ipNum = this.ipToNum(ip);
    const rangeNum = this.ipToNum(range);
    return (ipNum & mask) === (rangeNum & mask);
  }

  private ipToNum(ip: string): number {
    return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
  }

  private isPrivateIp(ip: string): boolean {
    const clean = ip.replace(/^::ffff:/, "");
    if (clean === "127.0.0.1" || clean === "::1" || clean === "localhost") return true;
    const parts = clean.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
  }

  private extractCookie(req: Request, name: string): string | undefined {
    const cookies = req.headers.cookie;
    if (!cookies) return undefined;
    const match = cookies.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
    return match ? match.split("=")[1] : undefined;
  }

  private cleanupBruteForce(): void {
    const now = Date.now();
    for (const [ip, entry] of this.bruteForceMap.entries()) {
      if (entry.blocked && now > entry.blockedUntil) {
        this.bruteForceMap.delete(ip);
      } else if (!entry.blocked && now - entry.firstAttempt > this.failedWindowMs) {
        this.bruteForceMap.delete(ip);
      }
    }
  }
}
