/**
 * AstraOS — RBAC unit tests
 * Tests role permissions, JWT tokens, user management, and authorization middleware.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../utils/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock PersistenceDB to avoid SQLite in tests
vi.mock("../auth/PersistenceDB", () => ({
  getDB: vi.fn(() => ({})),
  loadAllUsers: vi.fn(() => []),
  upsertUser: vi.fn(),
  deleteUserRow: vi.fn(),
}));

import { RBACManager } from "../auth/RBAC";
import type { Request, Response, NextFunction } from "express";

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: "/api/test",
    method: "GET",
    headers: {},
    query: {},
    body: {},
    params: {},
    ip: "127.0.0.1",
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { _status: number; _body: unknown } {
  const res = {
    _status: 200,
    _body: undefined as unknown,
    status(code: number) { res._status = code; return res; },
    json(body: unknown) { res._body = body; return res; },
  } as unknown as Response & { _status: number; _body: unknown };
  return res;
}

describe("RBAC Manager", () => {
  let rbac: RBACManager;

  beforeEach(() => {
    // Clear env to get predictable behavior
    delete process.env.JWT_SECRET;
    delete process.env.JWT_TTL;
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_API_KEY;
    rbac = new RBACManager();
  });

  // ─── Permission Matrix ───

  describe("hasPermission()", () => {
    it("admin has wildcard access to everything", () => {
      expect(rbac.hasPermission("admin", "agents", "create")).toBe(true);
      expect(rbac.hasPermission("admin", "skills", "delete")).toBe(true);
      expect(rbac.hasPermission("admin", "anything", "execute")).toBe(true);
    });

    it("developer can CRUD agents and skills", () => {
      expect(rbac.hasPermission("developer", "agents", "create")).toBe(true);
      expect(rbac.hasPermission("developer", "agents", "delete")).toBe(true);
      expect(rbac.hasPermission("developer", "skills", "update")).toBe(true);
    });

    it("developer cannot delete sessions", () => {
      expect(rbac.hasPermission("developer", "sessions", "delete")).toBe(false);
    });

    it("operator can execute agents but not create", () => {
      expect(rbac.hasPermission("operator", "agents", "execute")).toBe(true);
      expect(rbac.hasPermission("operator", "agents", "create")).toBe(false);
    });

    it("operator can delete sessions", () => {
      expect(rbac.hasPermission("operator", "sessions", "delete")).toBe(true);
    });

    it("viewer has read-only access", () => {
      expect(rbac.hasPermission("viewer", "agents", "read")).toBe(true);
      expect(rbac.hasPermission("viewer", "agents", "create")).toBe(false);
      expect(rbac.hasPermission("viewer", "agents", "delete")).toBe(false);
      expect(rbac.hasPermission("viewer", "skills", "update")).toBe(false);
    });

    it("returns false for unknown role", () => {
      expect(rbac.hasPermission("unknown" as any, "agents", "read")).toBe(false);
    });
  });

  // ─── User Management ───

  describe("User CRUD", () => {
    it("creates a user with auto-generated id and API key", () => {
      const user = rbac.createUser({ email: "dev@test.com", name: "Dev", role: "developer" });
      expect(user.id).toMatch(/^usr_/);
      expect(user.apiKey).toMatch(/^ask_/);
      expect(user.email).toBe("dev@test.com");
      expect(user.role).toBe("developer");
      expect(user.tenantId).toBe("default");
      expect(user.active).toBe(true);
    });

    it("retrieves user by id", () => {
      const user = rbac.createUser({ email: "a@b.com", name: "A", role: "viewer" });
      expect(rbac.getUser(user.id)).toBeDefined();
      expect(rbac.getUser(user.id)!.email).toBe("a@b.com");
    });

    it("retrieves user by email", () => {
      rbac.createUser({ email: "find@me.com", name: "Find", role: "operator" });
      const found = rbac.getUserByEmail("find@me.com");
      expect(found).toBeDefined();
      expect(found!.role).toBe("operator");
    });

    it("retrieves user by API key", () => {
      const user = rbac.createUser({ email: "key@test.com", name: "Key", role: "developer" });
      const found = rbac.getUserByApiKey(user.apiKey!);
      expect(found).toBeDefined();
      expect(found!.id).toBe(user.id);
    });

    it("updates user role", () => {
      const user = rbac.createUser({ email: "up@test.com", name: "Up", role: "viewer" });
      const updated = rbac.updateUser(user.id, { role: "developer" });
      expect(updated!.role).toBe("developer");
    });

    it("deactivates user", () => {
      const user = rbac.createUser({ email: "off@test.com", name: "Off", role: "viewer" });
      rbac.updateUser(user.id, { active: false });
      expect(rbac.getUser(user.id)!.active).toBe(false);
    });

    it("deletes user and cleans up API key index", () => {
      const user = rbac.createUser({ email: "del@test.com", name: "Del", role: "viewer" });
      const apiKey = user.apiKey!;
      expect(rbac.deleteUser(user.id)).toBe(true);
      expect(rbac.getUser(user.id)).toBeUndefined();
      expect(rbac.getUserByApiKey(apiKey)).toBeUndefined();
    });

    it("deleteUser returns false for nonexistent user", () => {
      expect(rbac.deleteUser("usr_nonexistent")).toBe(false);
    });

    it("lists users filtered by tenant", () => {
      rbac.createUser({ email: "t1@test.com", name: "T1", role: "viewer", tenantId: "acme" });
      rbac.createUser({ email: "t2@test.com", name: "T2", role: "viewer", tenantId: "other" });
      const acmeUsers = rbac.listUsers("acme");
      expect(acmeUsers.length).toBe(1);
      expect(acmeUsers[0].email).toBe("t1@test.com");
    });
  });

  // ─── API Key Rotation ───

  describe("rotateApiKey()", () => {
    it("returns new key and invalidates old key", () => {
      const user = rbac.createUser({ email: "rot@test.com", name: "Rot", role: "developer" });
      const oldKey = user.apiKey!;
      const newKey = rbac.rotateApiKey(user.id);
      expect(newKey).toBeTruthy();
      expect(newKey).not.toBe(oldKey);
      expect(rbac.getUserByApiKey(oldKey)).toBeUndefined();
      expect(rbac.getUserByApiKey(newKey!)).toBeDefined();
    });

    it("returns null for nonexistent user", () => {
      expect(rbac.rotateApiKey("usr_ghost")).toBeNull();
    });
  });

  // ─── JWT Tokens ───

  describe("JWT", () => {
    it("generates and verifies a valid token", () => {
      const user = rbac.createUser({ email: "jwt@test.com", name: "JWT", role: "developer" });
      const token = rbac.generateToken(user);
      expect(token.split(".")).toHaveLength(3);

      const payload = rbac.verifyToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe(user.id);
      expect(payload!.email).toBe("jwt@test.com");
      expect(payload!.role).toBe("developer");
    });

    it("rejects tampered token", () => {
      const user = rbac.createUser({ email: "tam@test.com", name: "Tam", role: "viewer" });
      const token = rbac.generateToken(user);
      const tampered = token.slice(0, -5) + "XXXXX";
      expect(rbac.verifyToken(tampered)).toBeNull();
    });

    it("rejects malformed token", () => {
      expect(rbac.verifyToken("not.a.valid.token")).toBeNull();
      expect(rbac.verifyToken("")).toBeNull();
      expect(rbac.verifyToken("onlyonepart")).toBeNull();
    });
  });

  // ─── Middleware: authenticate ───

  describe("authenticate() middleware", () => {
    it("attaches user from Bearer token", () => {
      const user = rbac.createUser({ email: "auth@test.com", name: "Auth", role: "developer" });
      const token = rbac.generateToken(user);
      const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
      const res = mockRes();
      const next = vi.fn();

      rbac.authenticate()(req, res, next);
      expect(next).toHaveBeenCalled();
      expect((req as any).user).toBeDefined();
      expect((req as any).user.id).toBe(user.id);
    });

    it("attaches user from X-API-Key header", () => {
      const user = rbac.createUser({ email: "apikey@test.com", name: "Key", role: "operator" });
      const req = mockReq({ headers: { "x-api-key": user.apiKey! } });
      const res = mockRes();
      const next = vi.fn();

      rbac.authenticate()(req, res, next);
      expect(next).toHaveBeenCalled();
      expect((req as any).user.id).toBe(user.id);
    });

    it("returns 401 when no credentials on non-public path", () => {
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn();

      rbac.authenticate()(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(401);
    });

    it("sets user to null when no credentials on public path", () => {
      const req = mockReq({ path: "/health" });
      const res = mockRes();
      const next = vi.fn();

      rbac.authenticate()(req, res, next);
      expect(next).toHaveBeenCalled();
      expect((req as any).user).toBeNull();
    });
  });

  // ─── Middleware: requireRole ───

  describe("requireRole() middleware", () => {
    it("allows matching role", () => {
      const req = mockReq();
      (req as any).user = { role: "admin" };
      const res = mockRes();
      const next = vi.fn();

      rbac.requireRole("admin")(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("rejects insufficient role", () => {
      const req = mockReq();
      (req as any).user = { role: "viewer" };
      const res = mockRes();
      const next = vi.fn();

      rbac.requireRole("admin")(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
    });

    it("rejects unauthenticated (null user)", () => {
      const req = mockReq();
      (req as any).user = null;
      const res = mockRes();
      const next = vi.fn();

      rbac.requireRole("admin")(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(401);
    });
  });

  // ─── Middleware: requirePermission ───

  describe("requirePermission() middleware", () => {
    it("allows when permission exists", () => {
      const req = mockReq();
      (req as any).user = { role: "developer" };
      const res = mockRes();
      const next = vi.fn();

      rbac.requirePermission("agents", "create")(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("denies when permission missing", () => {
      const req = mockReq();
      (req as any).user = { role: "viewer" };
      const res = mockRes();
      const next = vi.fn();

      rbac.requirePermission("agents", "delete")(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
    });
  });

  // ─── Default Admin ───

  describe("Default admin seeding", () => {
    it("seeds admin user on startup", () => {
      const admin = rbac.getUser("usr_admin");
      expect(admin).toBeDefined();
      expect(admin!.role).toBe("admin");
      expect(admin!.email).toBe("admin@astra-os.dev");
    });
  });
});
