/**
 * AstraOS v4.0 — Entry Point
 * The autonomous AI agent operating system.
 * Subsystems: MCP, A2A, Telemetry, GraphRAG, Workflows, SSO, Audit, Billing, Edge
 */

import { Gateway } from "./channels/Gateway";
import { MCPRegistry } from "./mcp/MCPRegistry";
import { AstraTracer } from "./telemetry/Tracer";
import { logger } from "./utils/logger";

let gateway: Gateway | null = null;
let shuttingDown = false;

async function main() {
  const PORT = parseInt(process.env.PORT ?? "3000", 10);

  logger.info("[AstraOS] Starting AstraOS v4.0...");

  // Initialize telemetry
  AstraTracer.getInstance();
  logger.info("[AstraOS] Telemetry initialized (OpenTelemetry)");

  // Initialize MCP registry (loads mcp-servers.json)
  const mcpRegistry = new MCPRegistry();
  await mcpRegistry.initialize();
  logger.info("[AstraOS] MCP registry initialized");

  // Start the MCP server on a separate port if configured
  const mcpPort = parseInt(process.env.MCP_SERVER_PORT || "0");
  if (mcpPort > 0) {
    mcpRegistry.startServer(mcpPort);
    logger.info(`[AstraOS] MCP server listening on port ${mcpPort}`);
  }

  // Start the main gateway (initializes all subsystems including enterprise modules)
  gateway = new Gateway(PORT);
  await gateway.start();

  logger.info("[AstraOS] All systems online — v4.0 ready.");
}

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`[AstraOS] Received ${signal} — shutting down gracefully...`);

  try {
    if (gateway) await gateway.shutdown();
  } catch (err) {
    logger.error(`[AstraOS] Error during shutdown: ${err instanceof Error ? err.message : err}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[AstraOS] Fatal startup error:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[AstraOS] Unhandled rejection:", reason);
});

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
