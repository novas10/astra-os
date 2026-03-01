/**
 * AstraOS — DockerSandbox.ts
 * Docker-based sandboxing for secure command execution.
 * Each session gets its own ephemeral container.
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { logger } from "../utils/logger";

const execAsync = promisify(exec);

export interface DockerSandboxConfig {
  image?: string;
  memoryLimit?: string;
  cpuLimit?: string;
  networkMode?: string;
  timeoutMs?: number;
  workspaceDir?: string;
}

export class DockerSandbox {
  private config: Required<DockerSandboxConfig>;
  private containers: Map<string, string> = new Map(); // sessionId -> containerId
  private dockerAvailable: boolean = false;

  constructor(config?: DockerSandboxConfig) {
    this.config = {
      image: config?.image || "node:22-slim",
      memoryLimit: config?.memoryLimit || "512m",
      cpuLimit: config?.cpuLimit || "1.0",
      networkMode: config?.networkMode || "none",
      timeoutMs: config?.timeoutMs || 30_000,
      workspaceDir: config?.workspaceDir || "./workspace",
    };
  }

  async initialize(): Promise<void> {
    try {
      await execAsync("docker --version");
      this.dockerAvailable = true;
      logger.info("[AstraOS] Docker sandbox: Docker available");
    } catch {
      this.dockerAvailable = false;
      logger.warn("[AstraOS] Docker sandbox: Docker not available, falling back to process sandbox");
    }
  }

  isAvailable(): boolean {
    return this.dockerAvailable;
  }

  async getOrCreateContainer(sessionId: string): Promise<string> {
    if (this.containers.has(sessionId)) {
      return this.containers.get(sessionId)!;
    }

    const containerName = `astra-sandbox-${sessionId.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 32)}`;

    try {
      // Check if container already exists
      const { stdout: existingId } = await execAsync(
        `docker ps -aqf "name=${containerName}"`
      );
      if (existingId.trim()) {
        // Start if stopped
        await execAsync(`docker start ${existingId.trim()}`).catch(() => {});
        this.containers.set(sessionId, existingId.trim());
        return existingId.trim();
      }

      // Create new container
      const { stdout: containerId } = await execAsync(
        `docker run -d --name ${containerName} ` +
          `--memory ${this.config.memoryLimit} ` +
          `--cpus ${this.config.cpuLimit} ` +
          `--network ${this.config.networkMode} ` +
          `--security-opt no-new-privileges ` +
          `--read-only ` +
          `--tmpfs /tmp:rw,size=100m ` +
          `--tmpfs /workspace:rw,size=200m ` +
          `-w /workspace ` +
          `${this.config.image} ` +
          `tail -f /dev/null`
      );

      const id = containerId.trim();
      this.containers.set(sessionId, id);
      logger.info(`[AstraOS] Docker container created: ${containerName} (${id.slice(0, 12)})`);
      return id;
    } catch (err) {
      throw new Error(`Failed to create Docker container: ${(err as Error).message}`);
    }
  }

  async execute(sessionId: string, command: string, timeoutMs?: number): Promise<string> {
    if (!this.dockerAvailable) {
      throw new Error("Docker not available");
    }

    const containerId = await this.getOrCreateContainer(sessionId);
    const timeout = timeoutMs || this.config.timeoutMs;

    try {
      const escapedCommand = command.replace(/'/g, "'\\''");
      const { stdout, stderr } = await execAsync(
        `docker exec ${containerId} sh -c '${escapedCommand}'`,
        { timeout, maxBuffer: 5 * 1024 * 1024 }
      );

      const output = [stdout, stderr].filter(Boolean).join("\n");
      return output.slice(0, 8000) || "(command produced no output)";
    } catch (error: unknown) {
      const err = error as Error & { killed?: boolean };
      if (err.killed) throw new Error(`Command timed out after ${timeout}ms`);
      throw new Error(`Docker execution failed: ${err.message}`);
    }
  }

  private sanitizePath(filePath: string): string {
    // Block null bytes (bypass technique)
    if (filePath.includes("\0")) {
      throw new Error("Path traversal blocked: null byte in path");
    }
    // Block dangerous bind sources that could escape container
    const dangerousPaths = ["/var/run/docker.sock", "/etc", "/proc", "/sys", "/dev"];
    for (const dp of dangerousPaths) {
      if (filePath.includes(dp)) {
        throw new Error(`Path traversal blocked: access to ${dp} is forbidden`);
      }
    }
    // Resolve against /workspace to catch all traversal tricks (....// etc.)
    const cleaned = filePath.replace(/^\/+/, "");
    const resolved = path.posix.resolve("/workspace", cleaned);
    if (!resolved.startsWith("/workspace/")) {
      throw new Error(`Path traversal blocked: ${filePath} resolves outside /workspace`);
    }
    return resolved;
  }

  async writeFile(sessionId: string, filePath: string, content: string): Promise<void> {
    if (!this.dockerAvailable) throw new Error("Docker not available");

    const containerId = await this.getOrCreateContainer(sessionId);
    const fullPath = this.sanitizePath(filePath);

    const escapedContent = Buffer.from(content).toString("base64");
    await execAsync(
      `docker exec ${containerId} sh -c 'mkdir -p $(dirname ${fullPath}) && echo "${escapedContent}" | base64 -d > ${fullPath}'`
    );
  }

  async readFile(sessionId: string, filePath: string): Promise<string> {
    if (!this.dockerAvailable) throw new Error("Docker not available");

    const containerId = await this.getOrCreateContainer(sessionId);
    const fullPath = this.sanitizePath(filePath);
    const { stdout } = await execAsync(
      `docker exec ${containerId} cat ${fullPath}`,
      { maxBuffer: 50 * 1024 }
    );
    return stdout;
  }

  async destroyContainer(sessionId: string): Promise<void> {
    const containerId = this.containers.get(sessionId);
    if (!containerId) return;

    try {
      await execAsync(`docker rm -f ${containerId}`);
      this.containers.delete(sessionId);
      logger.info(`[AstraOS] Docker container destroyed: ${containerId.slice(0, 12)}`);
    } catch {}
  }

  async destroyAll(): Promise<void> {
    for (const sessionId of this.containers.keys()) {
      await this.destroyContainer(sessionId);
    }
  }

  async listContainers(): Promise<Array<{ sessionId: string; containerId: string }>> {
    return Array.from(this.containers.entries()).map(([sessionId, containerId]) => ({
      sessionId,
      containerId,
    }));
  }
}
