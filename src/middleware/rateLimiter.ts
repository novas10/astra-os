/**
 * AstraOS — Rate Limiter
 * In-memory sliding window rate limiter. No external dependencies.
 */

import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  timestamps: number[];
}

export interface RateLimitConfig {
  windowMs: number;       // Time window in milliseconds
  maxRequests: number;    // Max requests per window
  skipPaths: string[];    // Paths to skip rate limiting
  keyExtractor?: (req: Request) => string;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,      // 1 minute
  maxRequests: 60,        // 60 requests per minute
  skipPaths: ["/health", "/webhook/"],
};

export function createRateLimiter(config?: Partial<RateLimitConfig>) {
  const opts: RateLimitConfig = { ...DEFAULT_CONFIG, ...config };
  const store = new Map<string, RateLimitEntry>();

  // Cleanup stale entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < opts.windowMs);
      if (entry.timestamps.length === 0) store.delete(key);
    }
  }, 300_000);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (opts.skipPaths.some((p) => req.path.startsWith(p))) {
      return next();
    }

    const key = opts.keyExtractor
      ? opts.keyExtractor(req)
      : req.ip || req.headers["x-forwarded-for"]?.toString() || "unknown";

    const now = Date.now();
    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // Remove expired timestamps
    entry.timestamps = entry.timestamps.filter((t) => now - t < opts.windowMs);

    if (entry.timestamps.length >= opts.maxRequests) {
      const retryAfter = Math.ceil((entry.timestamps[0] + opts.windowMs - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      res.set("X-RateLimit-Limit", String(opts.maxRequests));
      res.set("X-RateLimit-Remaining", "0");
      res.status(429).json({
        error: "Too many requests. Please try again later.",
        retryAfterSeconds: retryAfter,
      });
      return;
    }

    entry.timestamps.push(now);

    // Set rate limit headers
    res.set("X-RateLimit-Limit", String(opts.maxRequests));
    res.set("X-RateLimit-Remaining", String(opts.maxRequests - entry.timestamps.length));

    next();
  };
}
