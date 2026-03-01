/**
 * AstraOS — AgentLoop.ts
 * Core ReAct (Reason + Act) cycle with self-healing, multi-LLM, skills, browser, voice, and canvas.
 */

import { MemoryEngine } from "../memory/MemoryEngine";
import { SafeSandbox } from "../sandbox/SafeSandbox";
import { SemanticSnapshot } from "../tools/SemanticSnapshot";
import { BrowserEngine } from "../tools/BrowserEngine";
import { HeartbeatEngine } from "../heartbeat/HeartbeatEngine";
import { SkillsEngine } from "../skills/SkillsEngine";
import { VoiceEngine } from "../voice/VoiceEngine";
import { CanvasServer } from "../canvas/CanvasServer";
import { AgentRouter } from "../agents/AgentRouter";
import { ProviderRegistry } from "../llm/ProviderRegistry";
import { LLMToolDefinition, LLMMessage } from "../llm/LLMProvider";
import { logger } from "../utils/logger";
import * as fs from "fs/promises";
import * as path from "path";

export interface AgentConfig {
  model?: string;
  maxIterations?: number;
  maxTokens?: number;
  compactAfterTokens?: number;
  workspaceDir?: string;
  channelId: string;
  userId: string;
  agentId?: string;
}

export interface LoopResult {
  response: string;
  iterations: number;
  toolsUsed: string[];
  tokenUsage: { input: number; output: number };
  healed: boolean;
  audioBuffer?: Buffer;
}

const ASTRA_TOOLS: LLMToolDefinition[] = [
  {
    name: "execute_command",
    description: "Execute a shell command in the safe sandbox (Docker-isolated or process-sandboxed)",
    input_schema: { type: "object", properties: { command: { type: "string" }, timeout_ms: { type: "number" } }, required: ["command"] },
  },
  {
    name: "read_file",
    description: "Read file contents from /workspace directory",
    input_schema: { type: "object", properties: { filepath: { type: "string" } }, required: ["filepath"] },
  },
  {
    name: "write_file",
    description: "Write content to a file in /workspace",
    input_schema: { type: "object", properties: { filepath: { type: "string" }, content: { type: "string" } }, required: ["filepath", "content"] },
  },
  {
    name: "semantic_snapshot",
    description: "Parse a webpage Accessibility Tree into condensed text. 10x cheaper than screenshots.",
    input_schema: { type: "object", properties: { url: { type: "string" }, focus_selector: { type: "string" } }, required: ["url"] },
  },
  {
    name: "browser_action",
    description: "Control Chrome via DevTools Protocol: navigate, click, type, screenshot, extract, fill_form",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["navigate", "click", "type", "screenshot", "evaluate", "waitFor", "scroll", "select", "extract", "fill_form"] },
        url: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" },
        script: { type: "string" },
        options: { type: "object" },
      },
      required: ["action"],
    },
  },
  {
    name: "memory_search",
    description: "Hybrid vector + FTS5 search across agent memory",
    input_schema: { type: "object", properties: { query: { type: "string" }, mode: { type: "string", enum: ["semantic", "keyword", "hybrid"] }, top_k: { type: "number" } }, required: ["query"] },
  },
  {
    name: "memory_save",
    description: "Save important information to long-term memory",
    input_schema: { type: "object", properties: { content: { type: "string" }, tags: { type: "array", items: { type: "string" } }, importance: { type: "string", enum: ["low", "medium", "high", "critical"] } }, required: ["content"] },
  },
  {
    name: "schedule_task",
    description: "Schedule a future proactive task via cron or relative time",
    input_schema: { type: "object", properties: { task: { type: "string" }, cron: { type: "string" }, run_in_ms: { type: "number" }, notify_channel: { type: "string" } }, required: ["task"] },
  },
  {
    name: "http_request",
    description: "Make an HTTP request to an external API",
    input_schema: { type: "object", properties: { url: { type: "string" }, method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"] }, headers: { type: "object" }, body: { type: "object" } }, required: ["url", "method"] },
  },
  {
    name: "canvas_render",
    description: "Render an interactive HTML UI on the Canvas/A2UI server. Use astra-action attributes for interactivity.",
    input_schema: { type: "object", properties: { html: { type: "string" }, title: { type: "string" }, data: { type: "object" } }, required: ["html"] },
  },
  {
    name: "voice_speak",
    description: "Convert text to speech using ElevenLabs TTS",
    input_schema: { type: "object", properties: { text: { type: "string" }, voice_id: { type: "string" } }, required: ["text"] },
  },
  {
    name: "agent_spawn",
    description: "Spawn a sub-agent to handle a delegated task independently",
    input_schema: { type: "object", properties: { task: { type: "string" }, model: { type: "string" } }, required: ["task"] },
  },
  {
    name: "agent_message",
    description: "Send a message to another agent instance",
    input_schema: { type: "object", properties: { agent_id: { type: "string" }, message: { type: "string" } }, required: ["agent_id", "message"] },
  },
  {
    name: "skill_install",
    description: "Install a skill from the AstraHub marketplace",
    input_schema: { type: "object", properties: { skill_name: { type: "string" } }, required: ["skill_name"] },
  },
  {
    name: "skill_list",
    description: "List all installed skills and their status",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_self_logs",
    description: "Read agent logs for self-diagnosis during self-healing",
    input_schema: { type: "object", properties: { lines: { type: "number" }, filter: { type: "string" } } },
  },
  {
    name: "patch_tool",
    description: "Self-healing: Save a proposed fix for a failing tool",
    input_schema: { type: "object", properties: { tool_name: { type: "string" }, issue_description: { type: "string" }, proposed_fix: { type: "string" } }, required: ["tool_name", "issue_description", "proposed_fix"] },
  },
];

export class AgentLoop {
  private providers: ProviderRegistry;
  private memory: MemoryEngine;
  private sandbox: SafeSandbox;
  private snapshot: SemanticSnapshot;
  private browser: BrowserEngine;
  private heartbeat: HeartbeatEngine;
  private skills: SkillsEngine;
  private voice: VoiceEngine;
  private canvas: CanvasServer;
  private agentRouter: AgentRouter;
  private config: Required<AgentConfig>;
  private conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  private totalTokensUsed = { input: 0, output: 0 };

  constructor(
    config: AgentConfig,
    deps?: {
      skills?: SkillsEngine;
      voice?: VoiceEngine;
      canvas?: CanvasServer;
      agentRouter?: AgentRouter;
      browser?: BrowserEngine;
    }
  ) {
    this.providers = ProviderRegistry.getInstance();
    this.memory = new MemoryEngine(config.userId);
    this.sandbox = new SafeSandbox(config.workspaceDir ?? "./workspace");
    this.snapshot = new SemanticSnapshot();
    this.browser = deps?.browser || new BrowserEngine();
    this.heartbeat = HeartbeatEngine.getInstance();
    this.skills = deps?.skills || new SkillsEngine();
    this.voice = deps?.voice || new VoiceEngine();
    this.canvas = deps?.canvas || new CanvasServer();
    this.agentRouter = deps?.agentRouter || new AgentRouter();
    this.config = {
      model: "claude-sonnet-4-20250514",
      maxIterations: 25,
      maxTokens: 8192,
      compactAfterTokens: 150_000,
      workspaceDir: "./workspace",
      agentId: "",
      ...config,
    };
  }

  async run(userMessage: string): Promise<LoopResult> {
    const startTime = Date.now();
    let iterations = 0;
    const toolsUsed: string[] = [];
    let healed = false;

    await this.memory.appendEpisodic({
      type: "user_message",
      content: userMessage,
      channelId: this.config.channelId,
      userId: this.config.userId,
      timestamp: startTime,
    });

    const relevantMemory = await this.memory.hybridSearch(userMessage, { mode: "hybrid", topK: 5 });
    const skillPrompt = this.skills.buildSkillPrompt(userMessage);
    const systemPrompt = this.buildSystemPrompt(relevantMemory, skillPrompt);

    this.conversationHistory.push({ role: "user", content: userMessage });

    if (this.totalTokensUsed.input > this.config.compactAfterTokens) {
      await this.compactContext();
    }

    // Merge core tools with skill-provided tools
    const allTools = [...ASTRA_TOOLS];
    const skillTools = this.skills.getSkillTools(userMessage);
    for (const st of skillTools) {
      allTools.push({ name: st.name, description: st.description, input_schema: st.input_schema });
    }

    // ─── ReAct Loop ───
    while (iterations < this.config.maxIterations) {
      iterations++;
      logger.info(`[AstraOS] Iteration ${iterations}/${this.config.maxIterations}`);

      try {
        const provider = this.providers.getProviderForModel(this.config.model);
        const messages: LLMMessage[] = this.conversationHistory.map((m) => ({ role: m.role, content: m.content }));

        const response = await provider.chat({
          model: this.config.model,
          system: systemPrompt,
          messages,
          tools: allTools,
          maxTokens: this.config.maxTokens,
        });

        this.totalTokensUsed.input += response.usage.input;
        this.totalTokensUsed.output += response.usage.output;

        if (response.stopReason === "tool_use" && response.toolCalls.length > 0) {
          const toolResults: Array<{ tool_use_id: string; content: string }> = [];

          for (const toolCall of response.toolCalls) {
            toolsUsed.push(toolCall.name);
            logger.info(`[AstraOS] Tool: ${toolCall.name}`);

            let output: string;
            let didHeal = false;

            try {
              output = await this.executeTool(toolCall.name, toolCall.input);
            } catch (toolError) {
              logger.error(`[AstraOS] Tool ${toolCall.name} failed: ${toolError}`);
              output = await this.selfHeal(toolCall.name, toolError as Error);
              didHeal = true;
              healed = true;
            }

            await this.memory.appendEpisodic({
              type: "tool_call",
              toolName: toolCall.name,
              input: toolCall.input,
              output: didHeal ? `[HEALED] ${output}` : output,
              timestamp: Date.now(),
            });

            toolResults.push({
              tool_use_id: toolCall.id,
              content: didHeal ? `[SELF-HEALED] ${output}` : output,
            });
          }

          this.conversationHistory.push({ role: "assistant", content: response.text || JSON.stringify(response.toolCalls) });
          this.conversationHistory.push({ role: "user", content: JSON.stringify(toolResults) });
          continue;
        }

        if (response.stopReason === "end_turn" || response.stopReason === "stop") {
          this.conversationHistory.push({ role: "assistant", content: response.text });
          await this.summarizeOnExit(userMessage, response.text, toolsUsed);
          await this.memory.appendEpisodic({ type: "assistant_response", content: response.text, timestamp: Date.now() });

          return { response: response.text, iterations, toolsUsed, tokenUsage: this.totalTokensUsed, healed };
        }

        if (response.stopReason === "max_tokens") {
          this.conversationHistory.push({ role: "assistant", content: response.text });
          this.conversationHistory.push({ role: "user", content: "Continue." });
          continue;
        }
      } catch (error) {
        logger.error(`[AstraOS] Loop error: ${error}`);
        break;
      }
    }

    return {
      response: "Iteration limit reached. Please simplify the request.",
      iterations,
      toolsUsed,
      tokenUsage: this.totalTokensUsed,
      healed,
    };
  }

  private async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const sessionId = `${this.config.userId}_${this.config.channelId}`;

    switch (name) {
      case "execute_command":
        return this.sandbox.execute(input.command as string, (input.timeout_ms as number) ?? 10_000, sessionId);
      case "read_file":
        return this.sandbox.readFile(input.filepath as string, sessionId);
      case "write_file":
        await this.sandbox.writeFile(input.filepath as string, input.content as string, sessionId);
        return `File written: ${input.filepath}`;
      case "semantic_snapshot":
        return this.snapshot.capture(input.url as string, input.focus_selector as string | undefined);
      case "browser_action": {
        const result = await this.browser.execute(sessionId, {
          action: input.action as any,
          url: input.url as string,
          selector: input.selector as string,
          text: input.text as string,
          script: input.script as string,
          options: input.options as Record<string, unknown>,
        });
        return result.success ? (result.data || "Action completed") : `Error: ${result.error}`;
      }
      case "memory_search": {
        const results = await this.memory.hybridSearch(input.query as string, {
          mode: (input.mode as "semantic" | "keyword" | "hybrid") ?? "hybrid",
          topK: (input.top_k as number) ?? 5,
        });
        return JSON.stringify(results, null, 2);
      }
      case "memory_save":
        await this.memory.saveLongTerm({
          content: input.content as string,
          tags: (input.tags as string[]) ?? [],
          importance: (input.importance as string) ?? "medium",
          timestamp: Date.now(),
        });
        return "Memory saved.";
      case "schedule_task": {
        const jobId = await this.heartbeat.schedule({
          task: input.task as string,
          cron: input.cron as string | undefined,
          runInMs: input.run_in_ms as number | undefined,
          notifyChannel: (input.notify_channel as string) ?? this.config.channelId,
          agentConfig: this.config,
        });
        return `Scheduled. Job ID: ${jobId}`;
      }
      case "http_request":
        return this.httpRequest(input.url as string, input.method as string, input.headers as Record<string, string>, input.body);
      case "canvas_render":
        this.canvas.setCanvas(sessionId, input.html as string, input.title as string, input.data as Record<string, unknown>);
        return `Canvas rendered. View at http://localhost:${process.env.CANVAS_PORT || 18793}/canvas/${sessionId}`;
      case "voice_speak": {
        const audio = await this.voice.textToSpeech({ text: input.text as string, voiceId: input.voice_id as string });
        return `Speech generated: ${audio.length} bytes`;
      }
      case "agent_spawn": {
        const childId = this.agentRouter.spawnAgent(this.config.agentId || "default", input.task as string, input.model as string);
        return `Sub-agent spawned: ${childId}`;
      }
      case "agent_message": {
        const msgId = this.agentRouter.sendMessage(this.config.agentId || "default", input.agent_id as string, input.message as string);
        return `Message sent (${msgId}) to agent ${input.agent_id}`;
      }
      case "skill_install": {
        const ok = await this.skills.installSkill(input.skill_name as string);
        return ok ? `Skill "${input.skill_name}" installed.` : `Failed to install "${input.skill_name}".`;
      }
      case "skill_list":
        return JSON.stringify(this.skills.listSkills().map((s) => ({ name: s.name, version: s.version, enabled: s.enabled, triggers: s.triggers })), null, 2);
      case "read_self_logs":
        return this.readLogs((input.lines as number) ?? 50, input.filter as string | undefined);
      case "patch_tool":
        return this.applyPatch(input.tool_name as string, input.issue_description as string, input.proposed_fix as string);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async selfHeal(toolName: string, error: Error): Promise<string> {
    logger.warn(`[AstraOS] Self-healing: ${toolName}`);
    const recentLogs = await this.readLogs(20, toolName);
    const healingPrompt = `Tool "${toolName}" failed: ${error.message}\nRecent logs:\n${recentLogs}\n\nDiagnose: 1) Root cause 2) Immediate workaround 3) Fix suggestion. Be concise.`;

    const provider = this.providers.getProviderForModel(this.config.model);
    const resp = await provider.chat({
      model: this.config.model,
      maxTokens: 1024,
      messages: [{ role: "user", content: healingPrompt }],
    });

    await this.memory.appendEpisodic({ type: "self_heal", toolName, error: error.message, diagnosis: resp.text, timestamp: Date.now() });
    return `Diagnosis:\n${resp.text}\nOriginal error: ${error.message}`;
  }

  private async summarizeOnExit(userMsg: string, response: string, toolsUsed: string[]): Promise<void> {
    if (toolsUsed.length === 0) return;
    try {
      // Use the cheapest available model for summarization
      let summaryModel = "claude-haiku-4-5-20251001";
      let provider;
      try {
        provider = this.providers.getProviderForModel(summaryModel);
      } catch {
        provider = this.providers.getProviderForModel(this.config.model);
        summaryModel = this.config.model;
      }

      const resp = await provider.chat({
        model: summaryModel,
        maxTokens: 512,
        messages: [{
          role: "user",
          content: `Summarize into 3-5 bullet FACTS to remember:\nUser: ${userMsg.slice(0, 400)}\nAgent: ${response.slice(0, 800)}\nTools: ${toolsUsed.join(", ")}`,
        }],
      });

      await this.memory.saveLongTerm({ content: resp.text, tags: ["session_summary", ...toolsUsed], importance: "medium", timestamp: Date.now() });
    } catch {}
  }

  private async compactContext(): Promise<void> {
    if (this.conversationHistory.length < 4) return;
    const toCompact = this.conversationHistory.slice(0, -4);

    let summaryModel = "claude-haiku-4-5-20251001";
    let provider;
    try {
      provider = this.providers.getProviderForModel(summaryModel);
    } catch {
      provider = this.providers.getProviderForModel(this.config.model);
      summaryModel = this.config.model;
    }

    const resp = await provider.chat({
      model: summaryModel,
      maxTokens: 1024,
      messages: [{ role: "user", content: `Compact this conversation history:\n${toCompact.map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join("\n")}` }],
    });

    this.conversationHistory = [
      { role: "user", content: `[COMPACTED]\n${resp.text}` },
      { role: "assistant", content: "Context understood from compacted history." },
      ...this.conversationHistory.slice(-4),
    ];
    this.totalTokensUsed = { input: 0, output: 0 };
  }

  private buildSystemPrompt(relevantMemory: string, skillPrompt: string): string {
    return `You are AstraOS — a self-healing autonomous AI agent OS. Built in India.
Multi-LLM | Multi-Agent | 10+ Channels | Plugin Skills | Docker Sandbox | Browser CDP | Voice | Canvas/A2UI

Reason step-by-step. Use tools precisely. Self-heal on failure.

MEMORY:\n${relevantMemory || "None."}
${skillPrompt ? `\nACTIVE SKILLS:${skillPrompt}` : ""}

RULES:
- Think -> Act -> Observe cycle (ReAct)
- On tool failure: read_self_logs -> diagnose -> patch_tool
- Save key facts with memory_save
- Use semantic_snapshot for quick web reads, browser_action for full control
- Use canvas_render to show interactive UIs to the user
- Use voice_speak for audio responses when appropriate
- Use agent_spawn to delegate complex sub-tasks
- Files restricted to /workspace
- Channel: ${this.config.channelId}
- Model: ${this.config.model}`;
  }

  private async httpRequest(url: string, method: string, headers?: Record<string, string>, body?: unknown): Promise<string> {
    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return `Status: ${resp.status}\n${(await resp.text()).slice(0, 4000)}`;
  }

  private async readLogs(lines: number, filter?: string): Promise<string> {
    try {
      const logFile = path.join(this.config.workspaceDir, "../logs/astra.log");
      const content = await fs.readFile(logFile, "utf-8");
      let logLines = content.split("\n").slice(-lines);
      if (filter) logLines = logLines.filter((l) => l.toLowerCase().includes(filter.toLowerCase()));
      return logLines.join("\n");
    } catch { return "No logs found."; }
  }

  private async applyPatch(toolName: string, issue: string, fix: string): Promise<string> {
    const patchDir = path.join(this.config.workspaceDir, "patches");
    await fs.mkdir(patchDir, { recursive: true });
    const patchFile = path.join(patchDir, `${toolName}-${Date.now()}.md`);
    await fs.writeFile(patchFile, `# Patch: ${toolName}\n## Issue\n${issue}\n## Fix\n${fix}\n## Timestamp\n${new Date().toISOString()}`);
    return `Patch saved: ${patchFile}`;
  }
}
