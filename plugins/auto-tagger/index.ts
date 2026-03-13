/**
 * AstraOS Plugin Example — Auto-Tagger
 * ======================================
 * Automatically analyzes incoming messages and attaches semantic tags
 * using simple keyword matching (no LLM call required).
 *
 * Demonstrates:
 *   - Mutating messages in an onMessage hook (adding metadata)
 *   - Registering a standalone tool ("tag_message")
 *   - Using helper functions shared between hooks and tools
 *   - Storing the context reference for use across hooks
 *
 * Install:
 *   Copy this folder into `plugins/auto-tagger/` and restart AstraOS.
 */

import { definePlugin } from "../../src/plugins/PluginSDK";
import type {
  PluginContext,
  PluginMessage,
  PluginTool,
} from "../../src/plugins/PluginSDK";

// ---------------------------------------------------------------------------
// Tag detection rules
// ---------------------------------------------------------------------------

/** A single tagging rule: if any keyword matches, the tag is applied. */
interface TagRule {
  tag: string;
  /** Keywords to match (case-insensitive). */
  keywords: string[];
  /** Optional regex patterns for more precise matching. */
  patterns?: RegExp[];
}

/**
 * The rule set. Add or remove rules to customize tagging behavior.
 * Rules are evaluated in order; a message can receive multiple tags.
 */
const TAG_RULES: TagRule[] = [
  {
    tag: "question",
    keywords: ["?", "how to", "what is", "why does", "can you", "is there", "could you"],
    patterns: [/\b(how|what|why|when|where|who|which)\b.*\?/i],
  },
  {
    tag: "code",
    keywords: ["```", "function", "const ", "let ", "var ", "import ", "class ", "def ", "return "],
    patterns: [/`[^`]+`/, /\b(npm|yarn|pip|cargo|go run)\b/i],
  },
  {
    tag: "urgent",
    keywords: ["urgent", "asap", "critical", "emergency", "immediately", "blocker"],
    patterns: [/\b(p0|sev-?0|sev-?1)\b/i, /!!+/],
  },
  {
    tag: "bug",
    keywords: ["bug", "error", "exception", "crash", "broken", "not working", "fails"],
    patterns: [/\b(stack\s?trace|segfault|null\s?pointer)\b/i],
  },
  {
    tag: "feature-request",
    keywords: ["feature request", "it would be nice", "can we add", "please add", "wish list"],
    patterns: [/\b(feature|enhancement|improvement)\b/i],
  },
  {
    tag: "greeting",
    keywords: ["hello", "hi ", "hey ", "good morning", "good evening", "howdy"],
    patterns: [/^(hi|hey|hello|yo)\b/i],
  },
  {
    tag: "thanks",
    keywords: ["thank you", "thanks", "appreciate", "grateful"],
  },
  {
    tag: "link",
    keywords: [],
    patterns: [/https?:\/\/\S+/i],
  },
];

// ---------------------------------------------------------------------------
// Core tagging function — shared between the hook and the tool
// ---------------------------------------------------------------------------

/**
 * Analyzes text and returns an array of matched tags.
 * Uses keyword inclusion checks and optional regex patterns.
 */
function detectTags(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const rule of TAG_RULES) {
    let hit = false;

    // Check keywords (case-insensitive substring match)
    for (const kw of rule.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        hit = true;
        break;
      }
    }

    // Check regex patterns if keywords didn't match
    if (!hit && rule.patterns) {
      for (const re of rule.patterns) {
        if (re.test(text)) {
          hit = true;
          break;
        }
      }
    }

    if (hit) {
      matched.push(rule.tag);
    }
  }

  return matched;
}

// ---------------------------------------------------------------------------
// Tool: "tag_message" — manually tag any text
// ---------------------------------------------------------------------------

const tagMessageTool: PluginTool = {
  name: "tag_message",
  description:
    "Analyzes the provided text and returns an array of detected semantic tags " +
    "(e.g., question, code, urgent, bug, greeting).",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The text to analyze for tags.",
      },
    },
    required: ["text"],
  },

  async handler(
    input: Record<string, unknown>,
    ctx: PluginContext
  ): Promise<unknown> {
    const text = input.text as string;

    if (!text || typeof text !== "string") {
      return { error: "Missing required `text` parameter." };
    }

    const tags = detectTags(text);
    ctx.logger.info(`tag_message: detected ${tags.length} tag(s) for input`);

    return {
      text: text.length > 120 ? text.slice(0, 120) + "..." : text,
      tags,
      tagCount: tags.length,
    };
  },
};

// ---------------------------------------------------------------------------
// Plugin state — we capture the context during onLoad for use in hooks
// ---------------------------------------------------------------------------

let pluginCtx: PluginContext | null = null;

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export default definePlugin({
  name: "auto-tagger",
  version: "1.0.0",
  description:
    "Automatically tags incoming messages with semantic labels (question, code, urgent, etc.) using keyword matching.",
  author: "AstraOS Team",

  // --- Tools ------------------------------------------------------------------
  tools: [tagMessageTool],

  // --- Lifecycle --------------------------------------------------------------

  async onLoad(ctx: PluginContext): Promise<void> {
    // Store context so hooks can use the logger and memory APIs
    pluginCtx = ctx;
    ctx.logger.info("Auto-Tagger plugin loaded");
    ctx.logger.info(`Loaded ${TAG_RULES.length} tagging rules`);
  },

  async onUnload(): Promise<void> {
    pluginCtx = null;
  },

  // --- Message Hook -----------------------------------------------------------

  /**
   * Intercepts every incoming message, runs tag detection, and attaches
   * the results as `metadata.autoTags` on the message object.
   *
   * The mutated message is returned so downstream plugins and the LLM
   * can see the tags.
   */
  async onMessage(message: PluginMessage): Promise<PluginMessage | null> {
    const tags = detectTags(message.text);

    if (tags.length > 0) {
      // Attach tags to the message metadata so other plugins can read them
      message.metadata = {
        ...message.metadata,
        autoTags: tags,
      };

      if (pluginCtx) {
        pluginCtx.logger.info(
          `Tagged message ${message.id}: [${tags.join(", ")}]`
        );

        // Persist a running count of each tag for analytics
        for (const tag of tags) {
          const key = `tagCount:${tag}`;
          const current = ((await pluginCtx.memory.get(key)) as number) || 0;
          await pluginCtx.memory.set(key, current + 1);
        }
      }
    }

    // Always return the message (never block it)
    return message;
  },
});
