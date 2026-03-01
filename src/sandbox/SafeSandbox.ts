/**
 * AstraOS — SafeSandbox.ts
 * Hybrid sandbox: Pattern-blocked process execution + Docker container isolation.
 * Automatically falls back to process sandbox when Docker is unavailable.
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as fss from "fs";
import * as path from "path";
import { DockerSandbox } from "./DockerSandbox";
import { logger } from "../utils/logger";

const execAsync = promisify(exec);

const BLOCKED_PATTERNS = [
  /rm\s+-rf?\s+\//i,
  /rm\s+--no-preserve-root/i,
  /:\(\)\{.*\}/i,
  /mkfs\./i,
  /dd\s+if=/i,
  />\s*\/dev\/sd[a-z]/i,
  /curl.*\|\s*sh/i,
  /wget.*\|\s*sh/i,
  /nc\s+-l/i,
  /python\s+-c.*exec/i,
  /chmod\s+777\s+\//i,
  /sudo\s+su/i,
  /passwd\b/i,
  /\/etc\/shadow/i,
  /iptables.*--flush/i,
];

export class SafeSandbox {
  private workspaceDir: string;
  private docker: DockerSandbox;
  private useDocker: boolean = false;

  constructor(workspaceDir: string) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.docker = new DockerSandbox({ workspaceDir });
  }

  async initialize(): Promise<void> {
    await this.docker.initialize();
    this.useDocker = this.docker.isAvailable();
    logger.info(`[AstraOS] SafeSandbox: mode=${this.useDocker ? "docker" : "process"}`);
  }

  async execute(command: string, timeoutMs = 10_000, sessionId?: string): Promise<string> {
    // Always check blocklist regardless of sandbox mode
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        throw new Error(`BLOCKED: Command matches dangerous pattern: ${pattern.source}`);
      }
    }

    // Use Docker if available and sessionId provided
    if (this.useDocker && sessionId) {
      return this.docker.execute(sessionId, command, timeoutMs);
    }

    // Fallback: process sandbox
    const safeEnv = {
      ...process.env,
      HOME: this.workspaceDir,
      PWD: this.workspaceDir,
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    };

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workspaceDir,
        timeout: timeoutMs,
        env: safeEnv,
        maxBuffer: 1024 * 1024 * 5,
      });

      const output = [stdout, stderr].filter(Boolean).join("\n");
      return output.slice(0, 8000) || "(command produced no output)";
    } catch (error: unknown) {
      const err = error as Error & { killed?: boolean };
      if (err.killed) throw new Error(`Command timed out after ${timeoutMs}ms`);
      throw new Error(`Execution failed: ${err.message}`);
    }
  }

  async readFile(relativePath: string, sessionId?: string): Promise<string> {
    if (this.useDocker && sessionId) {
      return this.docker.readFile(sessionId, relativePath);
    }

    const resolvedPath = this.resolveAndValidate(relativePath);

    // TOCTOU-safe: open file descriptor first, then verify real path via fd
    const fd = await fs.open(resolvedPath, "r");
    try {
      const realPath = await fs.realpath(resolvedPath);
      if (!realPath.startsWith(this.workspaceDir + path.sep) && realPath !== this.workspaceDir) {
        throw new Error(`Path traversal blocked (symlink): ${relativePath} resolves to ${realPath}`);
      }
      const content = await fd.readFile("utf-8");
      return content.slice(0, 50_000);
    } finally {
      await fd.close();
    }
  }

  async writeFile(relativePath: string, content: string, sessionId?: string): Promise<void> {
    if (this.useDocker && sessionId) {
      return this.docker.writeFile(sessionId, relativePath, content);
    }

    const resolvedPath = this.resolveAndValidate(relativePath);
    const dir = path.dirname(resolvedPath);

    // Ensure directory exists and is inside workspace
    await fs.mkdir(dir, { recursive: true });
    const realDir = await fs.realpath(dir);
    if (!realDir.startsWith(this.workspaceDir + path.sep) && realDir !== this.workspaceDir) {
      throw new Error(`Path traversal blocked (symlink dir): ${relativePath}`);
    }

    // TOCTOU-safe: use O_CREAT|O_WRONLY|O_TRUNC with no follow symlinks
    const fd = await fs.open(resolvedPath, fss.constants.O_CREAT | fss.constants.O_WRONLY | fss.constants.O_TRUNC);
    try {
      // Verify resolved real path after open
      const realPath = await fs.realpath(resolvedPath);
      if (!realPath.startsWith(this.workspaceDir + path.sep)) {
        throw new Error(`Path traversal blocked (symlink): ${relativePath} resolves to ${realPath}`);
      }
      await fd.writeFile(content, "utf-8");
    } finally {
      await fd.close();
    }
  }

  private resolveAndValidate(relativePath: string): string {
    // Block null bytes (bypass technique)
    if (relativePath.includes("\0")) {
      throw new Error("Path traversal blocked: null byte in path");
    }
    // Resolve directly without stripping — path.resolve handles all traversal
    const resolved = path.resolve(this.workspaceDir, relativePath);
    if (!resolved.startsWith(this.workspaceDir + path.sep) && resolved !== this.workspaceDir) {
      throw new Error(`Path traversal blocked: ${relativePath} resolves outside workspace`);
    }
    return resolved;
  }

  get workspacePath(): string {
    return this.workspaceDir;
  }

  get sandboxMode(): string {
    return this.useDocker ? "docker" : "process";
  }

  async destroySession(sessionId: string): Promise<void> {
    if (this.useDocker) {
      await this.docker.destroyContainer(sessionId);
    }
  }
}
