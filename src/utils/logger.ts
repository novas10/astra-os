/**
 * AstraOS — Logger
 * Structured logging with levels, JSON mode, and correlation IDs.
 */

import * as fs from "fs";
import * as path from "path";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
const jsonMode = process.env.LOG_FORMAT === "json";

const logDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logStream = fs.createWriteStream(path.join(logDir, "astra.log"), { flags: "a" });

// Async-local correlation ID (optional, set by middleware)
let currentCorrelationId: string | undefined;

export function setCorrelationId(id: string | undefined): void {
  currentCorrelationId = id;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function write(level: LogLevel, msg: string, ...args: unknown[]): void {
  if (!shouldLog(level)) return;

  const timestamp = new Date().toISOString();
  const extra = args.length > 0 ? " " + args.map(String).join(" ") : "";

  if (jsonMode) {
    const entry = JSON.stringify({
      timestamp,
      level,
      message: msg + extra,
      ...(currentCorrelationId ? { correlationId: currentCorrelationId } : {}),
    });
    logStream.write(entry + "\n");
    console.log(entry);
  } else {
    const prefix = currentCorrelationId ? ` [${currentCorrelationId}]` : "";
    const line = `[${timestamp}] [${level.toUpperCase()}]${prefix} ${msg}${extra}`;
    logStream.write(line + "\n");
    console.log(line);
  }
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => write("debug", msg, ...args),
  info: (msg: string, ...args: unknown[]) => write("info", msg, ...args),
  warn: (msg: string, ...args: unknown[]) => write("warn", msg, ...args),
  error: (msg: string, ...args: unknown[]) => write("error", msg, ...args),
};
