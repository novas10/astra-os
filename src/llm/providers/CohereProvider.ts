/**
 * AstraOS — CohereProvider.ts
 * Cohere LLM provider (command-r-plus, command-r, command)
 * Uses Cohere v2 Chat API with its own message/tool format.
 */

import type { LLMProvider, LLMResponse, LLMMessage, LLMToolDefinition } from "../LLMProvider";

export class CohereProvider implements LLMProvider {
  name = "cohere";
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.COHERE_API_KEY || "";
    this.baseUrl = baseUrl || "https://api.cohere.com/v2";
  }

  async chat(params: {
    model: string;
    system?: string;
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    maxTokens?: number;
    toolResults?: Array<{ tool_use_id: string; content: string }>;
  }): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error("CohereProvider: COHERE_API_KEY is not set");
    }

    const messages: Array<{ role: string; content: string }> = [];

    // Cohere v2 uses system role in messages array
    if (params.system) {
      messages.push({ role: "system", content: params.system });
    }

    for (const m of params.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 4096,
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    const response = await fetch(`${this.baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`CohereProvider API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      message?: {
        content?: Array<{ type: string; text: string }>;
        tool_calls?: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>;
      };
      finish_reason?: string;
      usage?: {
        billed_units?: { input_tokens: number; output_tokens: number };
        tokens?: { input_tokens: number; output_tokens: number };
      };
    };

    // Cohere v2 returns message.content as an array of content blocks
    let text = "";
    if (data.message?.content) {
      text = data.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    }

    const toolCalls = (data.message?.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    let stopReason: LLMResponse["stopReason"] = "end_turn";
    const finishReason = data.finish_reason;
    if (finishReason === "TOOL_CALL" || finishReason === "tool_calls") stopReason = "tool_use";
    else if (finishReason === "MAX_TOKENS" || finishReason === "length") stopReason = "max_tokens";
    else if (finishReason === "COMPLETE" || finishReason === "stop") stopReason = "stop";

    const usage = data.usage?.tokens || data.usage?.billed_units;

    return {
      text,
      toolCalls,
      stopReason,
      usage: {
        input: usage?.input_tokens ?? 0,
        output: usage?.output_tokens ?? 0,
      },
    };
  }
}
