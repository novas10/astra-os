/**
 * AstraOS — HuggingFaceProvider.ts
 * Hugging Face Inference API LLM provider.
 * OpenAI-compatible chat completions endpoint per model.
 */

import type { LLMProvider, LLMResponse, LLMMessage, LLMToolDefinition } from "../LLMProvider";

export class HuggingFaceProvider implements LLMProvider {
  name = "huggingface";
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.HUGGINGFACE_API_KEY || "";
    this.baseUrl = baseUrl || "https://api-inference.huggingface.co/models";
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
      throw new Error("HuggingFaceProvider: HUGGINGFACE_API_KEY is not set");
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

    // HuggingFace Inference API: /models/{model}/v1/chat/completions
    const url = `${this.baseUrl}/${params.model}/v1/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HuggingFaceProvider API error (${response.status}): ${errorText}`);
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
      throw new Error("HuggingFaceProvider: No choices returned in response");
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
