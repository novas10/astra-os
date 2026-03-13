/**
 * AstraOS — TogetherProvider.ts
 * Together AI LLM provider — hosts open-source models.
 * OpenAI-compatible API.
 */

import type { LLMProvider, LLMResponse, LLMMessage, LLMToolDefinition } from "../LLMProvider";

export class TogetherProvider implements LLMProvider {
  name = "together";
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.TOGETHER_API_KEY || "";
    this.baseUrl = baseUrl || "https://api.together.xyz/v1";
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
      throw new Error("TogetherProvider: TOGETHER_API_KEY is not set");
    }

    const messages: Array<{ role: string; content: string }> = [];

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

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TogetherProvider API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    if (!data.choices || data.choices.length === 0) {
      throw new Error("TogetherProvider: No choices returned in response");
    }

    const choice = data.choices[0];
    const toolCalls = (choice.message.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    let stopReason: LLMResponse["stopReason"] = "end_turn";
    if (choice.finish_reason === "tool_calls") stopReason = "tool_use";
    else if (choice.finish_reason === "length") stopReason = "max_tokens";
    else if (choice.finish_reason === "stop") stopReason = "stop";

    return {
      text: choice.message.content || "",
      toolCalls,
      stopReason,
      usage: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}
