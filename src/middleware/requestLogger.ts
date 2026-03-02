/**
 * AstraOS — Request Logger Middleware
 * Logs method, path, status code, and duration for every request.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export function createRequestLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    res.on("finish", () => {
      const duration = Date.now() - start;
      const status = res.statusCode;
      const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
      const msg = `${req.method} ${req.path} ${status} ${duration}ms`;

      if (level === "error") {
        logger.error(`[HTTP] ${msg}`);
      } else if (level === "warn") {
        logger.warn(`[HTTP] ${msg}`);
      } else {
        logger.info(`[HTTP] ${msg}`);
      }
    });

    next();
  };
}
