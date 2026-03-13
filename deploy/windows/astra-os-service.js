/**
 * AstraOS — Windows Service Wrapper
 * Uses the node-windows pattern to install/uninstall AstraOS as a Windows service.
 *
 * Usage:
 *   node astra-os-service.js install     Install as Windows service
 *   node astra-os-service.js uninstall   Remove the Windows service
 *   node astra-os-service.js start       Start the service
 *   node astra-os-service.js stop        Stop the service
 *   node astra-os-service.js restart     Restart the service
 *
 * Prerequisites:
 *   npm install node-windows
 */

"use strict";

const path = require("path");

// ─── Configuration ───

const SERVICE_NAME = "AstraOS";
const SERVICE_DESCRIPTION = "AstraOS — Autonomous AI Agent Operating System";
const ENTRY_POINT = path.resolve(__dirname, "../../dist/index.js");
const LOG_DIR = path.resolve(__dirname, "../../logs/service");

// ─── Service Setup ───

function createService() {
  let Service;
  try {
    Service = require("node-windows").Service;
  } catch (err) {
    console.error(
      "ERROR: node-windows is not installed.\n" +
      "Run: npm install node-windows\n"
    );
    process.exit(1);
  }

  const svc = new Service({
    name: SERVICE_NAME,
    description: SERVICE_DESCRIPTION,
    script: ENTRY_POINT,
    nodeOptions: ["--max-old-space-size=2048"],
    workingDirectory: path.resolve(__dirname, "../../"),

    // Auto-restart configuration
    wait: 5,          // Wait 5 seconds between restart attempts
    grow: 0.5,        // Grow restart interval by 50% each consecutive failure
    maxRestarts: 10,   // Max restart attempts before stopping

    // Environment variables
    env: [
      { name: "NODE_ENV", value: "production" },
      { name: "LOG_FORMAT", value: "json" },
      { name: "PORT", value: "3000" },
    ],

    // Log configuration
    logpath: LOG_DIR,
    maxLogFiles: 10,
    maxLogSize: 10, // MB

    // Allow service to interact with desktop (for debugging)
    allowServiceLogon: true,
  });

  return svc;
}

// ─── Commands ───

function install() {
  const svc = createService();

  svc.on("install", () => {
    console.log(`[AstraOS] Service "${SERVICE_NAME}" installed successfully.`);
    console.log("[AstraOS] Starting service...");
    svc.start();
  });

  svc.on("alreadyinstalled", () => {
    console.log(`[AstraOS] Service "${SERVICE_NAME}" is already installed.`);
  });

  svc.on("start", () => {
    console.log(`[AstraOS] Service "${SERVICE_NAME}" started.`);
  });

  svc.on("error", (err) => {
    console.error(`[AstraOS] Service error: ${err}`);
  });

  console.log(`[AstraOS] Installing service "${SERVICE_NAME}"...`);
  console.log(`[AstraOS] Entry point: ${ENTRY_POINT}`);
  console.log(`[AstraOS] Log directory: ${LOG_DIR}`);
  svc.install();
}

function uninstall() {
  const svc = createService();

  svc.on("uninstall", () => {
    console.log(`[AstraOS] Service "${SERVICE_NAME}" uninstalled successfully.`);
  });

  svc.on("error", (err) => {
    console.error(`[AstraOS] Uninstall error: ${err}`);
  });

  console.log(`[AstraOS] Uninstalling service "${SERVICE_NAME}"...`);
  svc.uninstall();
}

function start() {
  const svc = createService();

  svc.on("start", () => {
    console.log(`[AstraOS] Service "${SERVICE_NAME}" started.`);
  });

  svc.on("error", (err) => {
    console.error(`[AstraOS] Start error: ${err}`);
  });

  svc.start();
}

function stop() {
  const svc = createService();

  svc.on("stop", () => {
    console.log(`[AstraOS] Service "${SERVICE_NAME}" stopped.`);
  });

  svc.on("error", (err) => {
    console.error(`[AstraOS] Stop error: ${err}`);
  });

  svc.stop();
}

function restart() {
  const svc = createService();

  svc.on("stop", () => {
    console.log("[AstraOS] Service stopped. Restarting...");
    svc.start();
  });

  svc.on("start", () => {
    console.log(`[AstraOS] Service "${SERVICE_NAME}" restarted.`);
  });

  svc.on("error", (err) => {
    console.error(`[AstraOS] Restart error: ${err}`);
  });

  svc.stop();
}

function showUsage() {
  console.log(`
AstraOS Windows Service Manager

Usage:
  node astra-os-service.js <command>

Commands:
  install     Install AstraOS as a Windows service
  uninstall   Remove the AstraOS Windows service
  start       Start the service
  stop        Stop the service
  restart     Restart the service

Service Details:
  Name:        ${SERVICE_NAME}
  Entry Point: ${ENTRY_POINT}
  Log Dir:     ${LOG_DIR}

Recovery Options (configured automatically):
  - Auto-restart on failure (up to 10 times)
  - Restart delay: 5 seconds (grows by 50% per consecutive failure)
  - Event log integration via node-windows

Prerequisites:
  npm install node-windows
`);
}

// ─── Main ───

const command = process.argv[2];

switch (command) {
  case "install":
    install();
    break;
  case "uninstall":
    uninstall();
    break;
  case "start":
    start();
    break;
  case "stop":
    stop();
    break;
  case "restart":
    restart();
    break;
  default:
    showUsage();
    break;
}
