/**
 * AstraOS — Role-Based Access Control (RBAC)
 * Roles, permissions, JWT tokens, and authorization middleware.
 */

import { Request, Response, NextFunction, Router } from "express";
import * as crypto from "crypto";
import { logger } from "../utils/logger";
import { getDB, loadAllUsers, upsertUser, deleteUserRow, type UserRow } from "./PersistenceDB";

// ─── Roles & Permissions ───

export type Role = "admin" | "developer" | "operator" | "viewer";

export interface Permission {
  resource: string;
  actions: Array<"create" | "read" | "update" | "delete" | "execute">;
}

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    { resource: "*", actions: ["create", "read", "update", "delete", "execute"] },
  ],
  developer: [
    { resource: "agents", actions: ["create", "read", "update", "delete", "execute"] },
    { resource: "skills", actions: ["create", "read", "update", "delete"] },
    { resource: "workflows", actions: ["create", "read", "update", "delete", "execute"] },
    { resource: "memory", actions: ["read"] },
    { resource: "marketplace", actions: ["read", "create"] },
    { resource: "chat", actions: ["create", "read"] },
    { resource: "traces", actions: ["read"] },
    { resource: "metrics", actions: ["read"] },
  ],
  operator: [
    { resource: "agents", actions: ["read", "execute"] },
    { resource: "skills", actions: ["read"] },
    { resource: "workflows", actions: ["read", "execute"] },
    { resource: "memory", actions: ["read"] },
    { resource: "chat", actions: ["create", "read"] },
    { resource: "traces", actions: ["read"] },
    { resource: "metrics", actions: ["read"] },
    { resource: "sessions", actions: ["read", "delete"] },
  ],
  viewer: [
    { resource: "agents", actions: ["read"] },
    { resource: "skills", actions: ["read"] },
    { resource: "workflows", actions: ["read"] },
    { resource: "chat", actions: ["read"] },
    { resource: "metrics", actions: ["read"] },
  ],
};

// ─── User & Token Types ───

export interface AstraUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
  apiKey?: string;
  createdAt: string;
  lastLogin?: string;
  active: boolean;
}

interface TokenPayload {
  sub: string;       // user ID
  email: string;
  role: Role;
  tenantId: string;
  iat: number;
  exp: number;
}

// ─── RBAC Manager ───

export class RBACManager {
  private users: Map<string, AstraUser> = new Map();
  private apiKeyIndex: Map<string, string> = new Map(); // apiKey -> userId
  private jwtSecret: string;
  private tokenTTL: number; // seconds

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
    this.tokenTTL = parseInt(process.env.JWT_TTL || "86400"); // 24 hours

    if (!process.env.JWT_SECRET) {
      logger.warn("[RBAC] No JWT_SECRET set — using random secret (tokens won't survive restarts)");
    }

    this.loadFromDB();
    this.seedDefaultAdmin();
  }

  /** Load persisted users from SQLite into in-memory cache. */
  private loadFromDB(): void {
    try {
      const db = getDB();
      const rows = loadAllUsers(db);
      for (const row of rows) {
        const user: AstraUser = {
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role as Role,
          tenantId: row.tenant_id,
          apiKey: row.api_key || undefined,
          createdAt: row.created_at,
          lastLogin: row.last_login || undefined,
          active: row.active === 1,
        };
        this.users.set(user.id, user);
        if (user.apiKey) this.apiKeyIndex.set(user.apiKey, user.id);
      }
      if (rows.length > 0) logger.info(`[RBAC] Loaded ${rows.length} users from database`);
    } catch {
      logger.warn("[RBAC] Could not load from database, starting with empty state");
    }
  }

  /** Persist a user to SQLite. */
  private persistUser(user: AstraUser): void {
    try {
      const db = getDB();
      upsertUser(db, {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenant_id: user.tenantId,
        api_key: user.apiKey || null,
        created_at: user.createdAt,
        last_login: user.lastLogin || null,
        active: user.active ? 1 : 0,
      });
    } catch {
      // Persistence failure is non-fatal — data still in memory
    }
  }

  private seedDefaultAdmin(): void {
    const adminEmail = process.env.ADMIN_EMAIL || "admin@astra-os.dev";
    const adminKey = process.env.ADMIN_API_KEY;

    // Only seed if admin doesn't already exist (from DB load)
    if (this.users.has("usr_admin")) return;

    const admin: AstraUser = {
      id: "usr_admin",
      email: adminEmail,
      name: "Admin",
      role: "admin",
      tenantId: "default",
      apiKey: adminKey,
      createdAt: new Date().toISOString(),
      active: true,
    };

    this.users.set(admin.id, admin);
    if (adminKey) this.apiKeyIndex.set(adminKey, admin.id);
    this.persistUser(admin);
  }

  // ─── User Management ───

  createUser(data: { email: string; name: string; role: Role; tenantId?: string }): AstraUser {
    const id = `usr_${crypto.randomBytes(8).toString("hex")}`;
    const apiKey = `ask_${crypto.randomBytes(24).toString("hex")}`;

    const user: AstraUser = {
      id,
      email: data.email,
      name: data.name,
      role: data.role,
      tenantId: data.tenantId || "default",
      apiKey,
      createdAt: new Date().toISOString(),
      active: true,
    };

    this.users.set(id, user);
    this.apiKeyIndex.set(apiKey, id);
    this.persistUser(user);
    logger.info(`[RBAC] User created: ${user.email} (${user.role})`);
    return user;
  }

  getUser(id: string): AstraUser | undefined {
    return this.users.get(id);
  }

  getUserByEmail(email: string): AstraUser | undefined {
    return Array.from(this.users.values()).find((u) => u.email === email);
  }

  getUserByApiKey(apiKey: string): AstraUser | undefined {
    const userId = this.apiKeyIndex.get(apiKey);
    return userId ? this.users.get(userId) : undefined;
  }

  updateUser(id: string, updates: Partial<Pick<AstraUser, "name" | "role" | "active">>): AstraUser | undefined {
    const user = this.users.get(id);
    if (!user) return undefined;
    Object.assign(user, updates);
    this.persistUser(user);
    return user;
  }

  deleteUser(id: string): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    if (user.apiKey) this.apiKeyIndex.delete(user.apiKey);
    this.users.delete(id);
    try { deleteUserRow(getDB(), id); } catch { /* non-fatal */ }
    return true;
  }

  listUsers(tenantId?: string): AstraUser[] {
    const all = Array.from(this.users.values());
    return tenantId ? all.filter((u) => u.tenantId === tenantId) : all;
  }

  rotateApiKey(userId: string): string | null {
    const user = this.users.get(userId);
    if (!user) return null;

    if (user.apiKey) this.apiKeyIndex.delete(user.apiKey);
    const newKey = `ask_${crypto.randomBytes(24).toString("hex")}`;
    user.apiKey = newKey;
    this.apiKeyIndex.set(newKey, userId);
    this.persistUser(user);
    return newKey;
  }

  // ─── JWT Tokens (simplified, no external deps) ───

  generateToken(user: AstraUser): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      iat: now,
      exp: now + this.tokenTTL,
    };

    const header = this.base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = this.base64url(JSON.stringify(payload));
    const signature = this.sign(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  verifyToken(token: string): TokenPayload | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;

      const expectedSig = this.sign(`${parts[0]}.${parts[1]}`);
      if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(parts[2]))) {
        return null;
      }

      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as TokenPayload;
      if (payload.exp < Math.floor(Date.now() / 1000)) return null;

      return payload;
    } catch {
      return null;
    }
  }

  private base64url(str: string): string {
    return Buffer.from(str).toString("base64url");
  }

  private sign(data: string): string {
    return crypto.createHmac("sha256", this.jwtSecret).update(data).digest("base64url");
  }

  // ─── Authorization Check ───

  hasPermission(role: Role, resource: string, action: Permission["actions"][number]): boolean {
    const perms = ROLE_PERMISSIONS[role];
    if (!perms) return false;

    return perms.some((p) => {
      const resourceMatch = p.resource === "*" || p.resource === resource;
      const actionMatch = p.actions.includes(action);
      return resourceMatch && actionMatch;
    });
  }

  // ─── Express Middleware ───

  /**
   * Middleware that resolves user from JWT or API key and attaches to req.
   */
  authenticate() {
    return (req: Request, res: Response, next: NextFunction): void => {
      // Try Bearer token
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const payload = this.verifyToken(token);
        if (payload) {
          const user = this.users.get(payload.sub);
          if (user && user.active) {
            (req as any).user = user;
            user.lastLogin = new Date().toISOString();
            return next();
          }
        }
      }

      // Try API key
      const apiKey = req.headers["x-api-key"] as string;
      if (apiKey) {
        const user = this.getUserByApiKey(apiKey);
        if (user && user.active) {
          (req as any).user = user;
          user.lastLogin = new Date().toISOString();
          return next();
        }
      }

      // Allow anonymous access only for explicitly public paths
      const publicPaths = ["/health", "/webhook/", "/.well-known/", "/docs", "/api/auth/login", "/api/sso/", "/api/chat"];
      const isPublic = publicPaths.some((p) => req.path === p || req.path.startsWith(p));
      if (isPublic) {
        (req as any).user = null;
        return next();
      }

      res.status(401).json({ error: "Authentication required" });
    };
  }

  /**
   * Middleware that requires a minimum role for the route.
   */
  requireRole(...roles: Role[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const user = (req as any).user as AstraUser | null;
      if (!user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      if (!roles.includes(user.role)) {
        res.status(403).json({ error: `Insufficient permissions. Required: ${roles.join(" or ")}` });
        return;
      }
      next();
    };
  }

  /**
   * Middleware that checks specific resource permission.
   */
  requirePermission(resource: string, action: Permission["actions"][number]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const user = (req as any).user as AstraUser | null;
      if (!user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      if (!this.hasPermission(user.role, resource, action)) {
        res.status(403).json({ error: `No ${action} permission on ${resource}` });
        return;
      }
      next();
    };
  }

  // ─── Auth Routes ───

  getRouter(): Router {
    const router = Router();

    // Login (get JWT from API key)
    router.post("/login", (req: Request, res: Response) => {
      const { apiKey, email } = req.body;

      let user: AstraUser | undefined;
      if (apiKey) {
        user = this.getUserByApiKey(apiKey);
      } else if (email) {
        user = this.getUserByEmail(email);
      }

      if (!user || !user.active) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = this.generateToken(user);
      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId },
        expiresIn: this.tokenTTL,
      });
    });

    // Get current user
    router.get("/me", (req: Request, res: Response) => {
      const user = (req as any).user as AstraUser | null;
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      res.json({ id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId });
    });

    // List users (admin only)
    router.get("/users", (req: Request, res: Response) => {
      const user = (req as any).user as AstraUser | null;
      if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin only" });
      const users = this.listUsers(user.tenantId).map((u) => ({
        id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, createdAt: u.createdAt,
      }));
      res.json(users);
    });

    // Create user (admin only)
    router.post("/users", (req: Request, res: Response) => {
      const reqUser = (req as any).user as AstraUser | null;
      if (!reqUser || reqUser.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const { email, name, role } = req.body;
      if (!email || !name || !role) return res.status(400).json({ error: "email, name, role required" });

      const newUser = this.createUser({ email, name, role, tenantId: reqUser.tenantId });
      res.json({
        id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role,
        apiKey: newUser.apiKey, tenantId: newUser.tenantId,
      });
    });

    // Update user role (admin only)
    router.patch("/users/:id", (req: Request, res: Response) => {
      const reqUser = (req as any).user as AstraUser | null;
      if (!reqUser || reqUser.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const updated = this.updateUser(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "User not found" });
      res.json({ id: updated.id, email: updated.email, name: updated.name, role: updated.role, active: updated.active });
    });

    // Delete user (admin only)
    router.delete("/users/:id", (req: Request, res: Response) => {
      const reqUser = (req as any).user as AstraUser | null;
      if (!reqUser || reqUser.role !== "admin") return res.status(403).json({ error: "Admin only" });

      if (req.params.id === reqUser.id) return res.status(400).json({ error: "Cannot delete yourself" });
      const ok = this.deleteUser(req.params.id);
      res.json({ success: ok });
    });

    // Rotate API key
    router.post("/users/:id/rotate-key", (req: Request, res: Response) => {
      const reqUser = (req as any).user as AstraUser | null;
      if (!reqUser) return res.status(401).json({ error: "Not authenticated" });
      if (reqUser.role !== "admin" && reqUser.id !== req.params.id) {
        return res.status(403).json({ error: "Can only rotate your own key" });
      }

      const newKey = this.rotateApiKey(req.params.id);
      if (!newKey) return res.status(404).json({ error: "User not found" });
      res.json({ apiKey: newKey });
    });

    return router;
  }
}
