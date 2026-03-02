/**
 * AstraOS — GeminiProvider.ts
 * Google Gemini LLM provider (Gemini 2.5 Pro, Flash, etc.)
 */

import type { LLMProvider, LLMResponse, LLMMessage, LLMToolDefinition } from "./LLMProvider";

export class GeminiProvider implements LLMProvider {
  name = "gemini";
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || "";
  }

  async chat(params: {
    model: string;
    system?: string;
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const contents = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: params.maxTokens ?? 8192,
      },
    };

    if (params.system) {
      body.systemInstruction = { parts: [{ text: params.system }] };
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = [{
        functionDeclarations: params.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      }];
    }

    const model = params.model || "gemini-2.5-pro-preview-06-05";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json() as {
      candidates: Array<{
        content: { parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> };
        finishReason: string;
      }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    const text = parts.filter((p) => p.text).map((p) => p.text).join("");
    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        id: `gemini_${Date.now()}_${i}`,
        name: p.functionCall!.name,
        input: p.functionCall!.args,
      }));

    let stopReason: LLMResponse["stopReason"] = "end_turn";
    if (toolCalls.length > 0) stopReason = "tool_use";
    else if (candidate?.finishReason === "MAX_TOKENS") stopReason = "max_tokens";

    return {
      text,
      toolCalls,
      stopReason,
      usage: {
        input: data.usageMetadata?.promptTokenCount ?? 0,
        output: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
