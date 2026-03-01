/**
 * AstraOS — CORS Middleware
 * Origin-validated CORS with preflight support.
 */

import { Request, Response, NextFunction } from "express";

export function createCorsMiddleware() {
  const raw = process.env.ASTRA_CORS_ORIGINS || "http://localhost:5173";
  const allowedOrigins = raw.split(",").map((s) => s.trim()).filter(Boolean);

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes("*"))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Max-Age", "86400");
    }

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  };
}
