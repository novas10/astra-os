/**
 * AstraOS — Logger
 * Structured logging with levels, JSON mode, correlation IDs, and log rotation.
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

// ─── Log Rotation Config ───
const MAX_LOG_SIZE = parseInt(process.env.LOG_MAX_SIZE || "10485760", 10); // 10MB default
const MAX_LOG_FILES = parseInt(process.env.LOG_MAX_FILES || "5", 10);

const logDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logFilePath = path.join(logDir, "astra.log");
let logStream = fs.createWriteStream(logFilePath, { flags: "a" });
let currentLogSize = fs.existsSync(logFilePath) ? fs.statSync(logFilePath).size : 0;

function rotateLog(): void {
  logStream.end();

  // Shift existing rotated files: astra.4.log → astra.5.log, etc.
  for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
    const from = path.join(logDir, `astra.${i}.log`);
    const to = path.join(logDir, `astra.${i + 1}.log`);
    if (fs.existsSync(from)) {
      if (i + 1 >= MAX_LOG_FILES && fs.existsSync(to)) fs.unlinkSync(to);
      fs.renameSync(from, to);
    }
  }

  // Current → astra.1.log
  if (fs.existsSync(logFilePath)) {
    fs.renameSync(logFilePath, path.join(logDir, "astra.1.log"));
  }

  // Open fresh log file
  logStream = fs.createWriteStream(logFilePath, { flags: "a" });
  currentLogSize = 0;
}

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
  let line: string;

  if (jsonMode) {
    line = JSON.stringify({
      timestamp,
      level,
      message: msg + extra,
      ...(currentCorrelationId ? { correlationId: currentCorrelationId } : {}),
    });
  } else {
    const prefix = currentCorrelationId ? ` [${currentCorrelationId}]` : "";
    line = `[${timestamp}] [${level.toUpperCase()}]${prefix} ${msg}${extra}`;
  }

  const bytes = Buffer.byteLength(line, "utf8") + 1; // +1 for newline
  if (currentLogSize + bytes > MAX_LOG_SIZE) {
    rotateLog();
  }

  logStream.write(line + "\n");
  currentLogSize += bytes;
  console.log(line);
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => write("debug", msg, ...args),
  info: (msg: string, ...args: unknown[]) => write("info", msg, ...args),
  warn: (msg: string, ...args: unknown[]) => write("warn", msg, ...args),
  error: (msg: string, ...args: unknown[]) => write("error", msg, ...args),
};
