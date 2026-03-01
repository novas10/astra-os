/**
 * AstraOS — OllamaProvider.ts
 * Ollama local LLM provider (Llama, Mistral, CodeLlama, Phi, etc.)
 */

import { LLMProvider, LLMResponse, LLMMessage, LLMToolDefinition } from "./LLMProvider";

export class OllamaProvider implements LLMProvider {
  name = "ollama";
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  }

  async chat(params: {
    model: string;
    system?: string;
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const messages: Array<{ role: string; content: string }> = [];

    if (params.system) {
      messages.push({ role: "system", content: params.system });
    }

    for (const m of params.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    const body: Record<string, unknown> = {
      model: params.model || "llama3.1",
      messages,
      stream: false,
      options: {
        num_predict: params.maxTokens ?? 4096,
      },
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

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json() as {
      message: {
        content: string;
        tool_calls?: Array<{
          function: { name: string; arguments: Record<string, unknown> };
        }>;
      };
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const toolCalls = (data.message.tool_calls || []).map((tc, i) => ({
      id: `ollama_${Date.now()}_${i}`,
      name: tc.function.name,
      input: tc.function.arguments,
    }));

    let stopReason: LLMResponse["stopReason"] = "end_turn";
    if (toolCalls.length > 0) stopReason = "tool_use";
    else if (data.done_reason === "length") stopReason = "max_tokens";

    return {
      text: data.message.content || "",
      toolCalls,
      stopReason,
      usage: {
        input: data.prompt_eval_count ?? 0,
        output: data.eval_count ?? 0,
      },
    };
  }
}
