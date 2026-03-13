#!/usr/bin/env node
/**
 * AstraOS — Interactive Onboarding Wizard
 * Run with: npx astra-os  OR  npm run onboard
 * Sets up everything in one guided flow — better than OpenClaw's onboard.
 */

import * as readline from "readline";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

// ─── Colors ───
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
};

const ok = (msg: string) => console.log(`  ${C.green}[OK]${C.reset} ${msg}`);
const info = (msg: string) => console.log(`  ${C.cyan}[>>]${C.reset} ${msg}`);
const warn = (msg: string) => console.log(`  ${C.yellow}[!!]${C.reset} ${msg}`);
const fail = (msg: string) => console.log(`  ${C.red}[XX]${C.reset} ${msg}`);

const step = (n: number, total: number, title: string) => {
  console.log(`\n${C.bgBlue}${C.white}${C.bold} STEP ${n}/${total} ${C.reset} ${C.bold}${title}${C.reset}`);
  console.log(`  ${"─".repeat(50)}`);
};

// ─── Readline Helper ───
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultVal?: string): Promise<string> {
  const prompt = defaultVal ? `  ${question} ${C.dim}(${defaultVal})${C.reset}: ` : `  ${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim() || defaultVal || ""));
  });
}

function askChoice(question: string, choices: string[]): Promise<number> {
  console.log(`  ${question}`);
  choices.forEach((c, i) => console.log(`    ${C.cyan}${i + 1}${C.reset}) ${c}`));
  return new Promise((resolve) => {
    rl.question(`  ${C.dim}Choose [1-${choices.length}]${C.reset}: `, (answer) => {
      const n = parseInt(answer.trim()) || 1;
      resolve(Math.max(1, Math.min(n, choices.length)));
    });
  });
}

// ─── Shell helper ───
function run(cmd: string, silent = false): string {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      stdio: silent ? "pipe" : "inherit",
      cwd: process.cwd(),
    }).trim();
  } catch {
    return "";
  }
}

function runSilent(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

// ─── Main ───
async function main() {
  const TOTAL = 10;
  const projectRoot = findProjectRoot();

  console.log(`
${C.cyan}${C.bold}
     ___           __             ____  _____
    /   |   _____ / /_ _____ __ / __ \\/ ___/
   / /| |  / ___// __// ___// // / / /\\__ \\
  / ___ | (__  )/ /_ / /  / // /_/ /___/ /
 /_/  |_|/____/ \\__//_/  /_/ \\____//____/
${C.reset}
${C.dim}  The AI Agent Operating System — Built in India${C.reset}
${C.dim}  v4.2 | github.com/AstraOS-India/astra-os${C.reset}
`);

  // ─── Step 1: Environment Check ───
  step(1, TOTAL, "Environment Check");

  const platform = os.platform();
  const platformName = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux";
  ok(`Operating System: ${platformName} (${os.arch()})`);

  const nodeVersion = runSilent("node --version");
  if (!nodeVersion) {
    fail("Node.js not found! Install from https://nodejs.org");
    process.exit(1);
  }
  const major = parseInt(nodeVersion.replace("v", "").split(".")[0]);
  if (major < 18) {
    fail(`Node.js ${nodeVersion} is too old. AstraOS requires Node >= 18.`);
    process.exit(1);
  }
  ok(`Node.js: ${nodeVersion}`);

  const gitVersion = runSilent("git --version");
  if (gitVersion) ok(`Git: ${gitVersion.replace("git version ", "")}`);
  else warn("Git not found — not required but recommended");

  const npmVersion = runSilent("npm --version");
  if (npmVersion) ok(`npm: v${npmVersion}`);

  if (!projectRoot) {
    fail("Could not find AstraOS project root (package.json with name 'astra-os')");
    fail("Make sure you run this from inside the astra-os directory.");
    process.exit(1);
  }
  ok(`Project root: ${projectRoot}`);

  // ─── Step 2: LLM Provider ───
  step(2, TOTAL, "LLM Provider Setup");

  const providerChoice = await askChoice("Which AI provider will you use?", [
    `${C.bold}Anthropic Claude${C.reset} ${C.dim}(recommended — claude-sonnet-4, claude-opus-4)${C.reset}`,
    `OpenAI ${C.dim}(gpt-4o, o1, o3)${C.reset}`,
    `Google Gemini ${C.dim}(gemini-2.5-pro)${C.reset}`,
    `Ollama Local ${C.dim}(llama3.1, mistral — no API key needed)${C.reset}`,
  ]);

  const providerMap: Record<number, { env: string; name: string; prefix: string }> = {
    1: { env: "ANTHROPIC_API_KEY", name: "Anthropic", prefix: "sk-ant-" },
    2: { env: "OPENAI_API_KEY", name: "OpenAI", prefix: "sk-" },
    3: { env: "GEMINI_API_KEY", name: "Google Gemini", prefix: "" },
    4: { env: "OLLAMA_BASE_URL", name: "Ollama", prefix: "http" },
  };

  const provider = providerMap[providerChoice];
  let apiKey = "";

  if (providerChoice === 4) {
    apiKey = await ask("Ollama URL", "http://localhost:11434");
  } else {
    apiKey = await ask(`${provider.name} API key`);
    if (!apiKey) {
      warn("No API key provided. You can add it later in .env");
    } else if (provider.prefix && !apiKey.startsWith(provider.prefix)) {
      warn(`Key doesn't start with '${provider.prefix}' — double-check it's correct`);
    } else {
      ok(`${provider.name} API key set`);
    }
  }

  // ─── Step 3: Instance Configuration ───
  step(3, TOTAL, "Instance Configuration");

  const instanceName = await ask("Instance name", "AstraOS");
  const userName = await ask("Your name (for Daily Digest greeting)", "Boss");
  const city = await ask("Your city (for weather in Daily Digest)", "Coimbatore");
  ok(`Instance: ${instanceName} | User: ${userName} | City: ${city}`);

  // ─── Step 4: Channel Setup ───
  step(4, TOTAL, "Channel Setup (optional)");

  info("AstraOS supports 21+ channels: Telegram, WhatsApp, Discord, Slack, Teams, IRC, LINE, etc.");
  const setupTelegram = await ask("Set up Telegram bot? (y/N)", "N");
  let telegramToken = "";
  if (setupTelegram.toLowerCase() === "y") {
    telegramToken = await ask("Telegram Bot Token (from @BotFather)");
    if (telegramToken) ok("Telegram bot token set");
  } else {
    info("Skipped — you can add channel tokens in .env anytime");
  }

  // ─── Step 5: Security Keys ───
  step(5, TOTAL, "Security Keys (auto-generated)");

  const jwtSecret = crypto.randomBytes(32).toString("hex");
  const masterKey = crypto.randomBytes(32).toString("hex");
  ok("JWT_SECRET generated (64-char hex)");
  ok("MASTER_ENCRYPTION_KEY generated (64-char hex, AES-256-GCM)");

  // ─── Step 6: Write .env ───
  step(6, TOTAL, "Write Configuration");

  const envPath = path.join(projectRoot, ".env");
  const envExamplePath = path.join(projectRoot, ".env.example");

  if (fs.existsSync(envPath)) {
    const overwrite = await ask(".env already exists. Overwrite? (y/N)", "N");
    if (overwrite.toLowerCase() !== "y") {
      info("Keeping existing .env — updating only missing values");
    }
  }

  let envContent = "";
  if (fs.existsSync(envExamplePath)) {
    envContent = fs.readFileSync(envExamplePath, "utf-8");
  } else {
    envContent = "# AstraOS Configuration\n";
  }

  // Build env vars
  const envVars: Record<string, string> = {
    NODE_ENV: "production",
    PORT: "3000",
    JWT_SECRET: jwtSecret,
    MASTER_ENCRYPTION_KEY: masterKey,
    ASTRA_INSTANCE_NAME: instanceName,
    DIGEST_USER_NAME: userName,
    DIGEST_CITY: city,
  };

  if (apiKey) envVars[provider.env] = apiKey;
  if (telegramToken) envVars.TELEGRAM_BOT_TOKEN = telegramToken;

  // Replace in template or append
  for (const [key, value] of Object.entries(envVars)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync(envPath, envContent.trim() + "\n", "utf-8");
  ok(`.env written to ${envPath}`);

  // ─── Step 7: Install Dependencies ───
  step(7, TOTAL, "Install Dependencies");

  info("Installing backend dependencies...");
  try {
    execSync("npm install --legacy-peer-deps", { cwd: projectRoot, stdio: "inherit" });
    ok("Backend dependencies installed");
  } catch {
    warn("Backend npm install had warnings — this is usually fine");
  }

  const dashboardDir = path.join(projectRoot, "packages", "dashboard");
  if (fs.existsSync(dashboardDir)) {
    info("Installing dashboard dependencies...");
    try {
      execSync("npm install --legacy-peer-deps", { cwd: dashboardDir, stdio: "inherit" });
      ok("Dashboard dependencies installed");
    } catch {
      warn("Dashboard npm install had warnings");
    }
  }

  // ─── Step 8: Build ───
  step(8, TOTAL, "Build AstraOS");

  info("Compiling TypeScript backend...");
  try {
    execSync("npm run build", { cwd: projectRoot, stdio: "inherit" });
    ok("Backend built successfully");
  } catch {
    fail("Backend build failed — check TypeScript errors above");
    process.exit(1);
  }

  if (fs.existsSync(dashboardDir)) {
    info("Building React dashboard...");
    try {
      execSync("npm run build", { cwd: dashboardDir, stdio: "inherit" });
      // Copy dashboard build to public/ for production serving
      const dashDist = path.join(dashboardDir, "dist");
      const publicDir = path.join(projectRoot, "public");
      if (fs.existsSync(dashDist)) {
        fs.cpSync(dashDist, publicDir, { recursive: true });
        ok("Dashboard built and copied to public/");
      }
    } catch {
      warn("Dashboard build failed — backend still works without it");
    }
  }

  // ─── Step 9: Health Check ───
  step(9, TOTAL, "Verify Installation");

  info("Starting AstraOS for health check...");
  const { spawn } = await import("child_process");
  const server = spawn("node", ["dist/index.js"], {
    cwd: projectRoot,
    stdio: "pipe",
    env: { ...process.env, PORT: "3000" },
  });

  let healthy = false;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const resp = await fetch("http://localhost:3000/health");
      if (resp.ok) {
        const data = await resp.json() as Record<string, unknown>;
        ok(`AstraOS is running! Status: ${data.status}`);
        healthy = true;
        break;
      }
    } catch {
      info(`Waiting for server... (${i + 1}/10)`);
    }
  }

  server.kill();

  if (!healthy) {
    warn("Health check timed out — server may need more time to start");
    warn("Try running 'npm start' manually to debug");
  }

  // ─── Step 10: Done! ───
  step(10, TOTAL, "Setup Complete!");

  console.log(`
${C.green}${C.bold}
  ========================================
      AstraOS is ready!
  ========================================${C.reset}

  ${C.cyan}Start AstraOS:${C.reset}
    ${C.bold}npm start${C.reset}

  ${C.cyan}Then open:${C.reset}
    Dashboard : ${C.bold}http://localhost:3000${C.reset}
    API Docs  : ${C.bold}http://localhost:3000/docs${C.reset}
    Health    : ${C.bold}http://localhost:3000/health${C.reset}
${telegramToken ? `
  ${C.cyan}Telegram:${C.reset}
    Send /start to your bot to begin chatting
` : ""}
  ${C.cyan}Cloud Deploy:${C.reset}
    Railway : ${C.dim}railway init && railway up${C.reset}
    Render  : ${C.dim}Push to GitHub, connect on render.com${C.reset}
    Docker  : ${C.dim}docker compose up -d${C.reset}

  ${C.dim}Config: .env | Skills: skills/ | Docs: README.md${C.reset}
`);

  // Try to open browser
  try {
    const openCmd = platform === "win32" ? "start" : platform === "darwin" ? "open" : "xdg-open";
    if (!healthy) {
      info("Start AstraOS with 'npm start' and visit http://localhost:3000");
    }
  } catch {
    // Browser open is best-effort
  }
}

// ─── Find project root ───
function findProjectRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.name === "astra-os") return dir;
      } catch {
        // ignore
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ─── Run ───
main()
  .catch((err) => {
    fail(`Setup failed: ${err.message}`);
    process.exit(1);
  })
  .finally(() => rl.close());
