/**
 * AstraOS — Middleware unit tests
 * Tests CORS, request logger, error handler, and input validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../utils/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createCorsMiddleware } from "../middleware/cors";
import { createRequestLogger } from "../middleware/requestLogger";
import { sanitizeError, globalErrorHandler } from "../middleware/errorHandler";
import type { Request, Response, NextFunction } from "express";

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: "/api/test",
    method: "GET",
    headers: {},
    query: {},
    body: {},
    ip: "127.0.0.1",
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { _status: number; _body: unknown; _headers: Record<string, string> } {
  const res = {
    _status: 200,
    _body: undefined as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) { res._status = code; return res; },
    json(body: unknown) { res._body = body; return res; },
    sendStatus(code: number) { res._status = code; return res; },
    setHeader(name: string, val: string) { res._headers[name] = val; },
    set(name: string, val: string) { res._headers[name] = val; },
    on: vi.fn(),
    statusCode: 200,
    writeHead: vi.fn(),
  } as unknown as Response & { _status: number; _body: unknown; _headers: Record<string, string> };
  return res;
}

// ─── CORS ───

describe("CORS Middleware", () => {
  beforeEach(() => {
    process.env.ASTRA_CORS_ORIGINS = "http://localhost:5173,https://app.astra-os.dev";
  });

  it("sets CORS headers for allowed origin", () => {
    const cors = createCorsMiddleware();
    const req = mockReq({ headers: { origin: "http://localhost:5173" } });
    const res = mockRes();
    const next = vi.fn();

    cors(req, res, next);
    expect(res._headers["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
    expect(res._headers["Access-Control-Allow-Methods"]).toContain("GET");
    expect(res._headers["Access-Control-Allow-Headers"]).toContain("Authorization");
    expect(next).toHaveBeenCalled();
  });

  it("does not set CORS headers for disallowed origin", () => {
    const cors = createCorsMiddleware();
    const req = mockReq({ headers: { origin: "https://evil.com" } });
    const res = mockRes();
    const next = vi.fn();

    cors(req, res, next);
    expect(res._headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("handles OPTIONS preflight with 204", () => {
    const cors = createCorsMiddleware();
    const req = mockReq({ method: "OPTIONS", headers: { origin: "http://localhost:5173" } });
    const res = mockRes();
    const next = vi.fn();

    cors(req, res, next);
    expect(res._status).toBe(204);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows wildcard origin", () => {
    process.env.ASTRA_CORS_ORIGINS = "*";
    const cors = createCorsMiddleware();
    const req = mockReq({ headers: { origin: "https://anything.com" } });
    const res = mockRes();
    const next = vi.fn();

    cors(req, res, next);
    expect(res._headers["Access-Control-Allow-Origin"]).toBe("https://anything.com");
  });

  it("handles missing origin header", () => {
    const cors = createCorsMiddleware();
    const req = mockReq({ headers: {} });
    const res = mockRes();
    const next = vi.fn();

    cors(req, res, next);
    expect(res._headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

// ─── Error Handler ───

describe("Error Handler", () => {
  describe("sanitizeError()", () => {
    it("returns error message in development", () => {
      process.env.NODE_ENV = "development";
      const { status, body } = sanitizeError(new Error("Something broke"));
      expect(status).toBe(500);
      expect(body.error).toBe("Something broke");
      expect(body.stack).toBeDefined();
    });

    it("hides error details in production", () => {
      process.env.NODE_ENV = "production";
      const { status, body } = sanitizeError(new Error("SQL injection detected"));
      expect(status).toBe(500);
      expect(body.error).toBe("Internal server error");
      expect(body.stack).toBeUndefined();
    });

    it("preserves client errors (4xx) in production", () => {
      process.env.NODE_ENV = "production";
      const err = Object.assign(new Error("Not found"), { status: 404 });
      const { status, body } = sanitizeError(err);
      expect(status).toBe(404);
      expect(body.error).toBe("Not found");
    });

    it("handles non-Error objects", () => {
      process.env.NODE_ENV = "development";
      const { body } = sanitizeError("string error");
      expect(body.error).toBe("string error");
    });
  });

  describe("globalErrorHandler()", () => {
    it("sends sanitized JSON response", () => {
      process.env.NODE_ENV = "development";
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn();

      globalErrorHandler(new Error("test error"), req, res, next);
      expect(res._status).toBe(500);
      expect((res._body as any).error).toBe("test error");
    });
  });
});

// ─── Request Logger ───

describe("Request Logger", () => {
  it("calls next() immediately", () => {
    const mw = createRequestLogger();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("registers finish listener", () => {
    const mw = createRequestLogger();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);
    expect(res.on).toHaveBeenCalledWith("finish", expect.any(Function));
  });
});
