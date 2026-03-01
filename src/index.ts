/**
 * AstraOS v3.0 — Entry Point
 * The autonomous AI agent operating system.
 * Subsystems: MCP, A2A, Telemetry, GraphRAG, Workflows, SSO, Audit, Billing, Edge
 */

import { Gateway } from "./channels/Gateway";
import { MCPRegistry } from "./mcp/MCPRegistry";
import { AstraTracer } from "./telemetry/Tracer";
import { logger } from "./utils/logger";

async function main() {
  const PORT = parseInt(process.env.PORT ?? "3000", 10);

  logger.info("[AstraOS] Starting AstraOS v3.0...");

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
  const gateway = new Gateway(PORT);
  await gateway.start();

  logger.info("[AstraOS] All systems online — v3.0 ready.");
}

main().catch((err) => {
  console.error("[AstraOS] Fatal startup error:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[AstraOS] Unhandled rejection:", reason);
});

process.on("SIGTERM", () => {
  logger.info("[AstraOS] Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("[AstraOS] Interrupted, shutting down...");
  process.exit(0);
});
