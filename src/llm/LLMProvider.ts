/**
 * AstraOS — LLMProvider.ts
 * Abstract multi-LLM provider interface. Supports Anthropic, OpenAI, Gemini, and Ollama.
 */

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMResponse {
  text: string;
  toolCalls: LLMToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop";
  usage: { input: number; output: number };
}

export interface LLMProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
}

export interface LLMProvider {
  name: string;
  chat(params: {
    model: string;
    system?: string;
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    maxTokens?: number;
    toolResults?: Array<{ tool_use_id: string; content: string }>;
  }): Promise<LLMResponse>;
}

export type ProviderType = "anthropic" | "openai" | "gemini" | "ollama" | "bedrock" | "mistral" | "openrouter" | "cohere" | "groq" | "deepseek" | "together" | "huggingface";
