/**
 * AstraOS Plugin Example — Hello World
 * =====================================
 * The simplest possible AstraOS plugin. Great starting point for learning
 * how the plugin system works.
 *
 * Demonstrates:
 *   - Registering a custom tool ("hello")
 *   - Using the onMessage hook to observe incoming messages
 *   - Scheduling a recurring cron job (heartbeat every 5 minutes)
 *   - Lifecycle hooks (onLoad / onUnload)
 *
 * Install:
 *   Copy this folder into `plugins/hello-world/` and restart AstraOS.
 */

import { definePlugin } from "../../src/plugins/PluginSDK";
import type {
  PluginContext,
  PluginMessage,
  PluginTool,
  PluginCronJob,
} from "../../src/plugins/PluginSDK";

// ---------------------------------------------------------------------------
// Tool: "hello" — returns a friendly greeting with the current timestamp
// ---------------------------------------------------------------------------

const helloTool: PluginTool = {
  name: "hello",
  description: "Returns a greeting message with the current server time.",
  // JSON-Schema for the tool's input parameters.
  // Even if a tool takes no required input, always provide a schema.
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Optional name to greet. Defaults to 'World'.",
      },
    },
    required: [],
  },

  /**
   * Tool handler — called whenever a user or the LLM invokes this tool.
   * @param input  Validated input matching `inputSchema`.
   * @param ctx    The plugin context (logger, memory, config, etc.).
   */
  async handler(
    input: Record<string, unknown>,
    ctx: PluginContext
  ): Promise<unknown> {
    const name = (input.name as string) || "World";
    const now = new Date().toISOString();

    ctx.logger.info(`hello tool invoked for "${name}"`);

    return {
      greeting: `Hello, ${name}!`,
      time: now,
      plugin: ctx.pluginName,
      hostVersion: ctx.hostVersion,
    };
  },
};

// ---------------------------------------------------------------------------
// Cron: heartbeat — logs a pulse every 5 minutes
// ---------------------------------------------------------------------------

const heartbeatCron: PluginCronJob = {
  name: "heartbeat",
  // Standard cron expression: "every 5 minutes"
  schedule: "*/5 * * * *",
  description: "Logs a heartbeat message every 5 minutes to confirm the plugin is alive.",

  async handler(ctx: PluginContext): Promise<void> {
    const uptime = process.uptime().toFixed(0);
    ctx.logger.info(`Heartbeat — plugin is alive (host uptime: ${uptime}s)`);
  },
};

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export default definePlugin({
  name: "hello-world",
  version: "1.0.0",
  description: "A minimal starter plugin that greets users and logs heartbeats.",
  author: "AstraOS Team",

  // --- Tools ------------------------------------------------------------------
  tools: [helloTool],

  // --- Cron Jobs --------------------------------------------------------------
  cron: [heartbeatCron],

  // --- Lifecycle Hooks --------------------------------------------------------

  /**
   * Called once when the plugin is loaded by AstraOS.
   * Use this to initialize resources, validate config, or set up state.
   */
  async onLoad(ctx: PluginContext): Promise<void> {
    ctx.logger.info("Hello World plugin loaded successfully!");
    ctx.logger.info(`Data directory: ${ctx.dataDir}`);
    ctx.logger.info(`Running on AstraOS ${ctx.hostVersion}`);

    // Example: persist a load timestamp in the plugin's key-value memory
    await ctx.memory.set("lastLoadedAt", new Date().toISOString());
  },

  /**
   * Called when the plugin is about to be unloaded (e.g., during shutdown).
   * Clean up timers, connections, or other resources here.
   */
  async onUnload(): Promise<void> {
    // Nothing to clean up in this simple plugin
  },

  // --- Message Hook -----------------------------------------------------------

  /**
   * Called for every incoming message before it reaches the LLM.
   * Return the (possibly modified) message, or `null` to block it.
   *
   * This example simply logs the message and passes it through unchanged.
   */
  async onMessage(message: PluginMessage): Promise<PluginMessage | null> {
    // Log a compact summary of the incoming message
    const preview =
      message.text.length > 80
        ? message.text.slice(0, 80) + "..."
        : message.text;

    // NOTE: We don't have direct access to `ctx` inside hooks that aren't
    // lifecycle methods. In a real plugin you'd capture the context in a
    // closure during onLoad. For this example we use console as a fallback.
    console.log(
      `[hello-world] onMessage | channel=${message.channel} ` +
        `user=${message.userId} text="${preview}"`
    );

    // Return the message unmodified so it continues down the pipeline
    return message;
  },
});
