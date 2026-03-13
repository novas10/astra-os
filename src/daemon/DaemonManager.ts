/**
 * AstraOS — DaemonManager.ts
 * Cross-platform daemon/service management.
 * Auto-detects OS and uses systemd (Linux), launchd (macOS), or node-windows (Windows).
 * Install, uninstall, start, stop, restart, and status — one API for all platforms.
 */

import { execSync, exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "../utils/logger";

// ─── Types ───

export interface DaemonStatus {
  installed: boolean;
  running: boolean;
  pid?: number;
  uptime?: number;        // seconds
  memory?: number;         // bytes
  cpu?: number;            // percentage
  restartCount?: number;
  lastStarted?: string;
  lastStopped?: string;
  platform: "linux" | "darwin" | "win32";
  serviceManager: "systemd" | "launchd" | "windows-service" | "unknown";
  error?: string;
}

export interface DaemonConfig {
  /** Service name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Path to the Node.js entry point */
  entryPoint: string;
  /** Path to the environment file */
  envFile?: string;
  /** User to run the service as (Linux/macOS) */
  user?: string;
  /** Group to run the service as (Linux) */
  group?: string;
  /** Working directory */
  workingDir: string;
  /** Path to Node.js binary */
  nodePath?: string;
  /** Auto-restart on failure */
  autoRestart: boolean;
  /** Restart delay in seconds */
  restartDelaySec: number;
  /** Log directory */
  logDir: string;
}

// ─── Default Config ───

const DEFAULT_CONFIG: DaemonConfig = {
  name: "astra-os",
  description: "AstraOS — Autonomous AI Agent Operating System",
  entryPoint: path.resolve(__dirname, "../../dist/index.js"),
  workingDir: path.resolve(__dirname, "../../"),
  user: "astra",
  group: "astra",
  autoRestart: true,
  restartDelaySec: 5,
  logDir: "/var/log/astra-os",
};

// ─── Manager ───

export class DaemonManager {
  private config: DaemonConfig;
  private platform: NodeJS.Platform;

  constructor(config?: Partial<DaemonConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.platform = os.platform();
  }

  // ─── Public API ───

  async install(): Promise<void> {
    logger.info(`[Daemon] Installing service on ${this.platform}...`);

    switch (this.platform) {
      case "linux":
        await this.installSystemd();
        break;
      case "darwin":
        await this.installLaunchd();
        break;
      case "win32":
        await this.installWindows();
        break;
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }

    logger.info(`[Daemon] Service "${this.config.name}" installed successfully`);
  }

  async uninstall(): Promise<void> {
    logger.info(`[Daemon] Uninstalling service on ${this.platform}...`);

    // Stop first if running
    try {
      await this.stop();
    } catch { /* may not be running */ }

    switch (this.platform) {
      case "linux":
        await this.uninstallSystemd();
        break;
      case "darwin":
        await this.uninstallLaunchd();
        break;
      case "win32":
        await this.uninstallWindows();
        break;
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }

    logger.info(`[Daemon] Service "${this.config.name}" uninstalled`);
  }

  async start(): Promise<void> {
    logger.info(`[Daemon] Starting service...`);

    switch (this.platform) {
      case "linux":
        this.execCommand(`sudo systemctl start ${this.config.name}`);
        break;
      case "darwin":
        this.execCommand(`launchctl load ${this.launchdPlistPath()}`);
        break;
      case "win32":
        this.execCommand(`net start "${this.config.name}"`);
        break;
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }

    logger.info(`[Daemon] Service started`);
  }

  async stop(): Promise<void> {
    logger.info(`[Daemon] Stopping service...`);

    switch (this.platform) {
      case "linux":
        this.execCommand(`sudo systemctl stop ${this.config.name}`);
        break;
      case "darwin":
        this.execCommand(`launchctl unload ${this.launchdPlistPath()}`);
        break;
      case "win32":
        this.execCommand(`net stop "${this.config.name}"`);
        break;
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }

    logger.info(`[Daemon] Service stopped`);
  }

  async restart(): Promise<void> {
    logger.info(`[Daemon] Restarting service...`);

    switch (this.platform) {
      case "linux":
        this.execCommand(`sudo systemctl restart ${this.config.name}`);
        break;
      case "darwin":
        await this.stop();
        await this.start();
        break;
      case "win32":
        this.execCommand(`net stop "${this.config.name}" && net start "${this.config.name}"`);
        break;
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }

    logger.info(`[Daemon] Service restarted`);
  }

  async status(): Promise<DaemonStatus> {
    const base: DaemonStatus = {
      installed: false,
      running: false,
      platform: this.platform as DaemonStatus["platform"],
      serviceManager: this.getServiceManager(),
    };

    try {
      switch (this.platform) {
        case "linux":
          return this.statusSystemd(base);
        case "darwin":
          return this.statusLaunchd(base);
        case "win32":
          return this.statusWindows(base);
        default:
          return { ...base, error: `Unsupported platform: ${this.platform}` };
      }
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ─── systemd (Linux) ───

  private async installSystemd(): Promise<void> {
    const nodePath = this.config.nodePath ?? this.detectNodePath();
    const servicePath = `/etc/systemd/system/${this.config.name}.service`;

    const envLine = this.config.envFile
      ? `EnvironmentFile=${this.config.envFile}`
      : `# No environment file configured`;

    const unit = [
      `[Unit]`,
      `Description=${this.config.description}`,
      `Documentation=https://github.com/astra-os/astra-os`,
      `After=network.target`,
      `Wants=network-online.target`,
      ``,
      `[Service]`,
      `Type=simple`,
      `User=${this.config.user}`,
      `Group=${this.config.group}`,
      `WorkingDirectory=${this.config.workingDir}`,
      `ExecStart=${nodePath} ${this.config.entryPoint}`,
      `Restart=${this.config.autoRestart ? "on-failure" : "no"}`,
      `RestartSec=${this.config.restartDelaySec}`,
      `StartLimitBurst=5`,
      `StartLimitIntervalSec=60`,
      envLine,
      ``,
      `# Logging`,
      `StandardOutput=journal`,
      `StandardError=journal`,
      `SyslogIdentifier=${this.config.name}`,
      ``,
      `# Security hardening`,
      `NoNewPrivileges=true`,
      `ProtectSystem=strict`,
      `ProtectHome=true`,
      `PrivateTmp=true`,
      `ReadWritePaths=${this.config.workingDir} ${this.config.logDir}`,
      ``,
      `# Resource limits`,
      `LimitNOFILE=65536`,
      `MemoryMax=2G`,
      ``,
      `[Install]`,
      `WantedBy=multi-user.target`,
    ].join("\n");

    // Ensure log directory exists
    this.execCommand(`sudo mkdir -p ${this.config.logDir}`);
    if (this.config.user) {
      this.execCommand(`sudo chown ${this.config.user}:${this.config.group ?? this.config.user} ${this.config.logDir}`);
    }

    // Write service file
    const tmpPath = path.join(os.tmpdir(), `${this.config.name}.service`);
    fs.writeFileSync(tmpPath, unit);
    this.execCommand(`sudo cp ${tmpPath} ${servicePath}`);
    fs.unlinkSync(tmpPath);

    // Reload and enable
    this.execCommand(`sudo systemctl daemon-reload`);
    this.execCommand(`sudo systemctl enable ${this.config.name}`);
  }

  private async uninstallSystemd(): Promise<void> {
    this.execCommand(`sudo systemctl disable ${this.config.name}`);
    const servicePath = `/etc/systemd/system/${this.config.name}.service`;
    if (fs.existsSync(servicePath)) {
      this.execCommand(`sudo rm ${servicePath}`);
    }
    this.execCommand(`sudo systemctl daemon-reload`);
  }

  private statusSystemd(base: DaemonStatus): DaemonStatus {
    const servicePath = `/etc/systemd/system/${this.config.name}.service`;
    base.installed = fs.existsSync(servicePath);

    if (!base.installed) return base;

    try {
      const output = execSync(
        `systemctl show ${this.config.name} --property=ActiveState,MainPID,ExecMainStartTimestamp,NRestarts`,
        { encoding: "utf8", timeout: 5000 },
      );

      const props = Object.fromEntries(
        output.split("\n").filter(Boolean).map((l) => {
          const eq = l.indexOf("=");
          return [l.slice(0, eq), l.slice(eq + 1)];
        }),
      );

      base.running = props.ActiveState === "active";
      base.pid = parseInt(props.MainPID ?? "0", 10) || undefined;
      base.restartCount = parseInt(props.NRestarts ?? "0", 10);
      if (props.ExecMainStartTimestamp) {
        base.lastStarted = props.ExecMainStartTimestamp;
      }
    } catch {
      // systemctl not available or service not found
    }

    return base;
  }

  // ─── launchd (macOS) ───

  private launchdPlistPath(): string {
    return path.join(os.homedir(), "Library", "LaunchAgents", `com.${this.config.name}.agent.plist`);
  }

  private async installLaunchd(): Promise<void> {
    const nodePath = this.config.nodePath ?? this.detectNodePath();
    const plistPath = this.launchdPlistPath();

    // Ensure directories exist
    const launchAgentsDir = path.dirname(plistPath);
    if (!fs.existsSync(launchAgentsDir)) {
      fs.mkdirSync(launchAgentsDir, { recursive: true });
    }
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }

    const envEntries = this.config.envFile && fs.existsSync(this.config.envFile)
      ? this.parseEnvFile(this.config.envFile)
      : {};

    const envDictXml = Object.entries(envEntries)
      .map(([k, v]) => `      <key>${this.xmlEscape(k)}</key>\n      <string>${this.xmlEscape(v)}</string>`)
      .join("\n");

    const plist = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
      `<plist version="1.0">`,
      `<dict>`,
      `  <key>Label</key>`,
      `  <string>com.${this.config.name}.agent</string>`,
      ``,
      `  <key>ProgramArguments</key>`,
      `  <array>`,
      `    <string>${nodePath}</string>`,
      `    <string>${this.config.entryPoint}</string>`,
      `  </array>`,
      ``,
      `  <key>WorkingDirectory</key>`,
      `  <string>${this.config.workingDir}</string>`,
      ``,
      `  <key>RunAtLoad</key>`,
      `  <true/>`,
      ``,
      `  <key>KeepAlive</key>`,
      `  <${this.config.autoRestart ? "true" : "false"}/>`,
      ``,
      `  <key>StandardOutPath</key>`,
      `  <string>${this.config.logDir}/astra-os.stdout.log</string>`,
      ``,
      `  <key>StandardErrorPath</key>`,
      `  <string>${this.config.logDir}/astra-os.stderr.log</string>`,
      ``,
      ...(envDictXml ? [
        `  <key>EnvironmentVariables</key>`,
        `  <dict>`,
        envDictXml,
        `  </dict>`,
      ] : []),
      ``,
      `  <key>ThrottleInterval</key>`,
      `  <integer>${this.config.restartDelaySec}</integer>`,
      ``,
      `  <key>ProcessType</key>`,
      `  <string>Standard</string>`,
      `</dict>`,
      `</plist>`,
    ].join("\n");

    fs.writeFileSync(plistPath, plist);
    logger.info(`[Daemon] launchd plist written to ${plistPath}`);
  }

  private async uninstallLaunchd(): Promise<void> {
    const plistPath = this.launchdPlistPath();
    try {
      this.execCommand(`launchctl unload ${plistPath}`);
    } catch { /* may not be loaded */ }
    if (fs.existsSync(plistPath)) {
      fs.unlinkSync(plistPath);
    }
  }

  private statusLaunchd(base: DaemonStatus): DaemonStatus {
    const plistPath = this.launchdPlistPath();
    base.installed = fs.existsSync(plistPath);

    if (!base.installed) return base;

    try {
      const output = execSync(`launchctl list | grep ${this.config.name}`, {
        encoding: "utf8",
        timeout: 5000,
      });
      const parts = output.trim().split(/\s+/);
      const pid = parseInt(parts[0], 10);
      base.running = !isNaN(pid) && pid > 0;
      base.pid = base.running ? pid : undefined;
    } catch {
      base.running = false;
    }

    return base;
  }

  // ─── Windows Service ───

  private windowsServiceScript(): string {
    return path.resolve(this.config.workingDir, "deploy", "windows", "astra-os-service.js");
  }

  private async installWindows(): Promise<void> {
    // The actual Windows service wrapper (deploy/windows/astra-os-service.js)
    // uses node-windows. We invoke it with the "install" command.
    const scriptPath = this.windowsServiceScript();
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Windows service script not found at ${scriptPath}. Run from the project root.`);
    }

    const nodePath = this.config.nodePath ?? this.detectNodePath();
    this.execCommand(`"${nodePath}" "${scriptPath}" install`);
  }

  private async uninstallWindows(): Promise<void> {
    const scriptPath = this.windowsServiceScript();
    const nodePath = this.config.nodePath ?? this.detectNodePath();
    this.execCommand(`"${nodePath}" "${scriptPath}" uninstall`);
  }

  private statusWindows(base: DaemonStatus): DaemonStatus {
    try {
      const output = execSync(`sc query "${this.config.name}"`, {
        encoding: "utf8",
        timeout: 5000,
      });
      base.installed = true;
      base.running = output.includes("RUNNING");

      // Get PID
      const pidOutput = execSync(
        `wmic service where "Name='${this.config.name}'" get ProcessId /format:value`,
        { encoding: "utf8", timeout: 5000 },
      );
      const pidMatch = pidOutput.match(/ProcessId=(\d+)/);
      if (pidMatch) {
        const pid = parseInt(pidMatch[1], 10);
        if (pid > 0) base.pid = pid;
      }
    } catch {
      base.installed = false;
      base.running = false;
    }

    return base;
  }

  // ─── Helpers ───

  private getServiceManager(): DaemonStatus["serviceManager"] {
    switch (this.platform) {
      case "linux": return "systemd";
      case "darwin": return "launchd";
      case "win32": return "windows-service";
      default: return "unknown";
    }
  }

  private detectNodePath(): string {
    return process.execPath;
  }

  private execCommand(cmd: string): string {
    try {
      return execSync(cmd, { encoding: "utf8", timeout: 30_000 }).trim();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[Daemon] Command failed: ${cmd} — ${message}`);
      throw new Error(`Daemon command failed: ${message}`);
    }
  }

  private parseEnvFile(filePath: string): Record<string, string> {
    const result: Record<string, string> = {};
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
    return result;
  }

  private xmlEscape(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
