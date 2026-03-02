/**
 * AstraOS — ProviderRegistry.ts
 * Central registry for LLM providers. Hot-swap between Anthropic, OpenAI, Gemini, and Ollama.
 */

import type { LLMProvider, ProviderType } from "./LLMProvider";
import { AnthropicProvider } from "./AnthropicProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import { GeminiProvider } from "./GeminiProvider";
import { OllamaProvider } from "./OllamaProvider";

const MODEL_TO_PROVIDER: Record<string, ProviderType> = {
  // Anthropic
  "claude-opus-4-20250514": "anthropic",
  "claude-sonnet-4-20250514": "anthropic",
  "claude-haiku-4-5-20251001": "anthropic",
  // OpenAI
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
  "gpt-4-turbo": "openai",
  "o1": "openai",
  "o3": "openai",
  "o3-mini": "openai",
  "o4-mini": "openai",
  // Gemini
  "gemini-2.5-pro-preview-06-05": "gemini",
  "gemini-2.5-flash-preview-05-20": "gemini",
  "gemini-2.0-flash": "gemini",
  // Ollama (common local models)
  "llama3.1": "ollama",
  "llama3.2": "ollama",
  "mistral": "ollama",
  "codellama": "ollama",
  "phi3": "ollama",
  "qwen2.5": "ollama",
  "deepseek-r1": "ollama",
};

export class ProviderRegistry {
  private providers: Map<ProviderType, LLMProvider> = new Map();
  private static instance: ProviderRegistry;

  private constructor() {}

  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  register(type: ProviderType, provider: LLMProvider): void {
    this.providers.set(type, provider);
  }

  getProvider(type: ProviderType): LLMProvider {
    const provider = this.providers.get(type);
    if (!provider) throw new Error(`LLM provider "${type}" not registered. Available: ${[...this.providers.keys()].join(", ")}`);
    return provider;
  }

  getProviderForModel(model: string): LLMProvider {
    const type = MODEL_TO_PROVIDER[model];
    if (!type) {
      // Default heuristics
      if (model.startsWith("claude")) return this.getProvider("anthropic");
      if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return this.getProvider("openai");
      if (model.startsWith("gemini")) return this.getProvider("gemini");
      return this.getProvider("ollama"); // Assume local model
    }
    return this.getProvider(type);
  }

  initializeDefaults(): void {
    if (process.env.ANTHROPIC_API_KEY) {
      this.register("anthropic", new AnthropicProvider());
    }
    if (process.env.OPENAI_API_KEY) {
      this.register("openai", new OpenAIProvider());
    }
    if (process.env.GEMINI_API_KEY) {
      this.register("gemini", new GeminiProvider());
    }
    // Ollama is always available (local, no key needed)
    this.register("ollama", new OllamaProvider());
  }

  listProviders(): string[] {
    return [...this.providers.keys()];
  }

  listModels(): string[] {
    return Object.keys(MODEL_TO_PROVIDER);
  }
}
