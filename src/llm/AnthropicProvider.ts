/**
 * AstraOS — AnthropicProvider.ts
 * Claude (Anthropic) LLM provider
 */

import Anthropic from "@anthropic-ai/sdk";
import { LLMProvider, LLMResponse, LLMMessage, LLMToolDefinition } from "./LLMProvider";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  }

  async chat(params: {
    model: string;
    system?: string;
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    maxTokens?: number;
    toolResults?: Array<{ tool_use_id: string; content: string }>;
  }): Promise<LLMResponse> {
    const anthropicMessages: Anthropic.MessageParam[] = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const anthropicTools: Anthropic.Tool[] | undefined = params.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 8192,
      system: params.system,
      messages: anthropicMessages,
      tools: anthropicTools,
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const toolBlocks = response.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];

    return {
      text: textBlocks.map((b) => (b as Anthropic.TextBlock).text).join(""),
      toolCalls: toolBlocks.map((t) => ({ id: t.id, name: t.name, input: t.input as Record<string, unknown> })),
      stopReason: response.stop_reason === "tool_use" ? "tool_use" : response.stop_reason === "max_tokens" ? "max_tokens" : "end_turn",
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    };
  }
}
