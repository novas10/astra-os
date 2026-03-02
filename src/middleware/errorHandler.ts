/**
 * AstraOS — Global Error Handler
 * Catches unhandled errors, sanitizes responses in production.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Sanitize an error for safe client response.
 * In production: generic message only. In dev: include error message.
 */
export function sanitizeError(err: unknown): { status: number; body: Record<string, unknown> } {
  const message = err instanceof Error ? err.message : String(err);
  const status =
    (err as { status?: number }).status ||
    (err as { statusCode?: number }).statusCode ||
    500;

  if (isProduction()) {
    return {
      status,
      body: { error: status < 500 ? message : "Internal server error" },
    };
  }

  return {
    status,
    body: {
      error: message,
      ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
    },
  };
}

/**
 * Express global error handler — MUST be registered last (after all routes).
 */
export function globalErrorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  logger.error(`[Gateway] Unhandled error: ${err.message}`);
  const { status, body } = sanitizeError(err);
  res.status(status).json(body);
}
