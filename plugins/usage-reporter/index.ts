/**
 * AstraOS Plugin Example — Usage Reporter
 * =========================================
 * Tracks message counts, token usage, and session statistics. Provides
 * a "usage_report" tool and logs a daily summary via cron.
 *
 * Demonstrates:
 *   - Using plugin memory for persistent counters
 *   - Combining onMessage + onResponse hooks to track both sides
 *   - Registering a tool that reads from plugin memory
 *   - Scheduling a daily summary cron job
 *   - Capturing context in onLoad for use across all hooks
 *
 * Install:
 *   Copy this folder into `plugins/usage-reporter/` and restart AstraOS.
 */

import { definePlugin } from "../../src/plugins/PluginSDK";
import type {
  PluginContext,
  PluginMessage,
  PluginResponse,
  PluginTool,
  PluginCronJob,
} from "../../src/plugins/PluginSDK";

// ---------------------------------------------------------------------------
// Types for usage tracking
// ---------------------------------------------------------------------------

/** Shape of the usage data stored in plugin memory. */
interface UsageData {
  /** Total messages received since the plugin was first loaded. */
  totalMessages: number;
  /** Total responses observed. */
  totalResponses: number;
  /** Accumulated input tokens (from response.usage). */
  totalInputTokens: number;
  /** Accumulated output tokens (from response.usage). */
  totalOutputTokens: number;
  /** Messages received today (resets each daily summary). */
  todayMessages: number;
  /** Responses today. */
  todayResponses: number;
  /** Input tokens today. */
  todayInputTokens: number;
  /** Output tokens today. */
  todayOutputTokens: number;
  /** ISO timestamp of when tracking began. */
  trackingSince: string;
  /** ISO date string of the current tracking day (YYYY-MM-DD). */
  currentDay: string;
  /** Per-channel message counts. */
  channelCounts: Record<string, number>;
  /** Per-user message counts. */
  userCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns today's date as YYYY-MM-DD. */
function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns a fresh UsageData object with all counters at zero. */
function emptyUsageData(): UsageData {
  return {
    totalMessages: 0,
    totalResponses: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    todayMessages: 0,
    todayResponses: 0,
    todayInputTokens: 0,
    todayOutputTokens: 0,
    trackingSince: new Date().toISOString(),
    currentDay: todayString(),
    channelCounts: {},
    userCounts: {},
  };
}

const USAGE_KEY = "usageData";

// ---------------------------------------------------------------------------
// Plugin state — captured during onLoad
// ---------------------------------------------------------------------------

let ctx: PluginContext | null = null;

/**
 * Loads usage data from plugin memory, initializing if not present.
 * Automatically rolls over daily counters when the date changes.
 */
async function loadUsage(): Promise<UsageData> {
  if (!ctx) return emptyUsageData();

  let data = (await ctx.memory.get(USAGE_KEY)) as UsageData | null;

  if (!data) {
    data = emptyUsageData();
    await ctx.memory.set(USAGE_KEY, data);
    return data;
  }

  // Roll over daily counters if the date has changed
  const today = todayString();
  if (data.currentDay !== today) {
    data.todayMessages = 0;
    data.todayResponses = 0;
    data.todayInputTokens = 0;
    data.todayOutputTokens = 0;
    data.currentDay = today;
    await ctx.memory.set(USAGE_KEY, data);
  }

  return data;
}

/** Persists the current usage data back to plugin memory. */
async function saveUsage(data: UsageData): Promise<void> {
  if (!ctx) return;
  await ctx.memory.set(USAGE_KEY, data);
}

// ---------------------------------------------------------------------------
// Tool: "usage_report" — returns a snapshot of usage statistics
// ---------------------------------------------------------------------------

const usageReportTool: PluginTool = {
  name: "usage_report",
  description:
    "Returns current usage statistics including message counts, token usage, " +
    "and per-channel / per-user breakdowns.",
  inputSchema: {
    type: "object",
    properties: {
      section: {
        type: "string",
        description:
          'Optional section to return: "summary", "channels", "users", or "all" (default).',
        enum: ["summary", "channels", "users", "all"],
      },
    },
    required: [],
  },

  async handler(
    input: Record<string, unknown>,
    _ctx: PluginContext
  ): Promise<unknown> {
    const data = await loadUsage();
    const section = (input.section as string) || "all";

    const summary = {
      trackingSince: data.trackingSince,
      currentDay: data.currentDay,
      total: {
        messages: data.totalMessages,
        responses: data.totalResponses,
        inputTokens: data.totalInputTokens,
        outputTokens: data.totalOutputTokens,
        totalTokens: data.totalInputTokens + data.totalOutputTokens,
      },
      today: {
        messages: data.todayMessages,
        responses: data.todayResponses,
        inputTokens: data.todayInputTokens,
        outputTokens: data.todayOutputTokens,
        totalTokens: data.todayInputTokens + data.todayOutputTokens,
      },
    };

    switch (section) {
      case "summary":
        return summary;
      case "channels":
        return { channels: data.channelCounts };
      case "users":
        return { users: data.userCounts };
      case "all":
      default:
        return {
          ...summary,
          channels: data.channelCounts,
          users: data.userCounts,
        };
    }
  },
};

// ---------------------------------------------------------------------------
// Cron: daily-summary — logs a usage summary every 24 hours
// ---------------------------------------------------------------------------

const dailySummaryCron: PluginCronJob = {
  name: "daily-usage-summary",
  // Runs every day at midnight
  schedule: "0 0 * * *",
  description: "Logs a summary of the day's usage statistics and resets daily counters.",

  async handler(cronCtx: PluginContext): Promise<void> {
    const data = await loadUsage();

    cronCtx.logger.info("=== Daily Usage Summary ===");
    cronCtx.logger.info(`Date:            ${data.currentDay}`);
    cronCtx.logger.info(`Messages today:  ${data.todayMessages}`);
    cronCtx.logger.info(`Responses today: ${data.todayResponses}`);
    cronCtx.logger.info(
      `Tokens today:    ${data.todayInputTokens} in / ${data.todayOutputTokens} out`
    );
    cronCtx.logger.info(
      `All-time totals: ${data.totalMessages} messages, ` +
        `${data.totalInputTokens + data.totalOutputTokens} tokens`
    );
    cronCtx.logger.info("===========================");

    // Reset daily counters for the new day
    data.todayMessages = 0;
    data.todayResponses = 0;
    data.todayInputTokens = 0;
    data.todayOutputTokens = 0;
    data.currentDay = todayString();
    await saveUsage(data);
  },
};

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export default definePlugin({
  name: "usage-reporter",
  version: "1.0.0",
  description:
    "Tracks message counts, token usage, and per-channel/user statistics. " +
    "Provides a usage_report tool and logs daily summaries.",
  author: "AstraOS Team",

  // --- Tools ------------------------------------------------------------------
  tools: [usageReportTool],

  // --- Cron Jobs --------------------------------------------------------------
  cron: [dailySummaryCron],

  // --- Lifecycle --------------------------------------------------------------

  async onLoad(loadCtx: PluginContext): Promise<void> {
    ctx = loadCtx;
    ctx.logger.info("Usage Reporter plugin loaded");

    // Ensure usage data structure exists in memory
    const data = await loadUsage();
    ctx.logger.info(`Tracking since ${data.trackingSince}`);
    ctx.logger.info(
      `All-time: ${data.totalMessages} messages, ` +
        `${data.totalInputTokens + data.totalOutputTokens} tokens`
    );
  },

  async onUnload(): Promise<void> {
    ctx = null;
  },

  // --- Message Hook -----------------------------------------------------------

  /**
   * Counts every incoming message and updates per-channel / per-user stats.
   */
  async onMessage(message: PluginMessage): Promise<PluginMessage | null> {
    const data = await loadUsage();

    // Increment counters
    data.totalMessages += 1;
    data.todayMessages += 1;

    // Per-channel tracking
    data.channelCounts[message.channel] =
      (data.channelCounts[message.channel] || 0) + 1;

    // Per-user tracking
    data.userCounts[message.userId] =
      (data.userCounts[message.userId] || 0) + 1;

    await saveUsage(data);

    // Pass the message through unchanged
    return message;
  },

  // --- Response Hook ----------------------------------------------------------

  /**
   * Counts every outgoing response and accumulates token usage when available.
   */
  async onResponse(response: PluginResponse): Promise<PluginResponse | null> {
    const data = await loadUsage();

    data.totalResponses += 1;
    data.todayResponses += 1;

    // Accumulate token usage if the response includes it
    if (response.usage) {
      data.totalInputTokens += response.usage.input || 0;
      data.totalOutputTokens += response.usage.output || 0;
      data.todayInputTokens += response.usage.input || 0;
      data.todayOutputTokens += response.usage.output || 0;
    }

    await saveUsage(data);

    // Pass the response through unchanged
    return response;
  },
});
