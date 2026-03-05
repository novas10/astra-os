/**
 * AstraOS — Auth Middleware
 * Bearer token + API key authentication for all API routes.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export interface AuthConfig {
  apiKeys: Set<string>;
  publicPaths: string[];
}

const DEFAULT_PUBLIC_PATHS = ["/health", "/webhook/", "/.well-known/"];

export function createAuthMiddleware(config?: Partial<AuthConfig>) {
  const apiKeys = config?.apiKeys ?? loadApiKeysFromEnv();
  const publicPaths = config?.publicPaths ?? DEFAULT_PUBLIC_PATHS;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip auth for public paths
    if (publicPaths.some((p) => req.path.startsWith(p))) {
      return next();
    }

    // Skip auth if no keys configured (development mode)
    if (apiKeys.size === 0) {
      return next();
    }

    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "Authentication required. Provide Authorization: Bearer <token> or X-API-Key header." });
      return;
    }

    if (!apiKeys.has(token)) {
      logger.warn(`[Auth] Invalid API key attempt from ${req.ip}`);
      res.status(403).json({ error: "Invalid API key." });
      return;
    }

    // Attach API key identity to request
    (req as Request & { apiKeyId?: string }).apiKeyId = token.slice(0, 8) + "...";
    next();
  };
}

function extractToken(req: Request): string | null {
  // Check Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  // Check X-API-Key header
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string") {
    return apiKey.trim();
  }

  return null;
}

function loadApiKeysFromEnv(): Set<string> {
  const keys = new Set<string>();
  const envKey = process.env.ASTRA_API_KEYS;
  if (envKey) {
    envKey.split(",").map((k) => k.trim()).filter(Boolean).forEach((k) => keys.add(k));
  }
  // Also support single key
  const singleKey = process.env.ASTRA_API_KEY;
  if (singleKey) keys.add(singleKey.trim());
  return keys;
}
