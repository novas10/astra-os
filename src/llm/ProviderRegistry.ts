/**
 * AstraOS — ProviderRegistry.ts
 * Central registry for LLM providers. Hot-swap between Anthropic, OpenAI, Gemini, Ollama,
 * Bedrock, Mistral, OpenRouter, Cohere, Groq, DeepSeek, Together, and Hugging Face.
 */

import type { LLMProvider, ProviderType } from "./LLMProvider";
import { AnthropicProvider } from "./AnthropicProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import { GeminiProvider } from "./GeminiProvider";
import { OllamaProvider } from "./OllamaProvider";
import { BedrockProvider } from "./providers/BedrockProvider";
import { MistralProvider } from "./providers/MistralProvider";
import { OpenRouterProvider } from "./providers/OpenRouterProvider";
import { CohereProvider } from "./providers/CohereProvider";
import { GroqProvider } from "./providers/GroqProvider";
import { DeepSeekProvider } from "./providers/DeepSeekProvider";
import { TogetherProvider } from "./providers/TogetherProvider";
import { HuggingFaceProvider } from "./providers/HuggingFaceProvider";

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
  // Bedrock (AWS-hosted models)
  "anthropic.claude-3-5-sonnet-20241022-v2:0": "bedrock",
  "anthropic.claude-3-haiku-20240307-v1:0": "bedrock",
  "amazon.titan-text-premier-v1:0": "bedrock",
  "meta.llama3-1-70b-instruct-v1:0": "bedrock",
  // Mistral
  "mistral-large-latest": "mistral",
  "mistral-medium": "mistral",
  "mistral-small": "mistral",
  "codestral": "mistral",
  "pixtral": "mistral",
  // Cohere
  "command-r-plus": "cohere",
  "command-r": "cohere",
  "command": "cohere",
  // Groq
  "llama-3.3-70b-versatile": "groq",
  "mixtral-8x7b-32768": "groq",
  "gemma2-9b-it": "groq",
  // DeepSeek
  "deepseek-chat": "deepseek",
  "deepseek-reasoner": "deepseek",
  // Together (common open-source models on Together)
  "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo": "together",
  "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo": "together",
  "mistralai/Mixtral-8x22B-Instruct-v0.1": "together",
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
      // Default heuristics based on model name patterns
      if (model.startsWith("claude")) return this.getProvider("anthropic");
      if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return this.getProvider("openai");
      if (model.startsWith("gemini")) return this.getProvider("gemini");
      if (model.startsWith("anthropic.") || model.startsWith("amazon.") || model.startsWith("meta.") || model.startsWith("cohere.")) return this.getProvider("bedrock");
      if (model.startsWith("mistral-") || model.startsWith("codestral") || model.startsWith("pixtral")) return this.getProvider("mistral");
      if (model.startsWith("command-r") || model.startsWith("command")) return this.getProvider("cohere");
      if (model.startsWith("llama-") || model.startsWith("mixtral-") || model.startsWith("gemma")) return this.getProvider("groq");
      if (model.startsWith("deepseek-")) return this.getProvider("deepseek");
      if (model.includes("/")) return this.getProvider("openrouter"); // Org/model format (OpenRouter or Together)
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

    // AWS Bedrock (requires access key + secret)
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.register("bedrock", new BedrockProvider());
    }
    if (process.env.MISTRAL_API_KEY) {
      this.register("mistral", new MistralProvider());
    }
    if (process.env.OPENROUTER_API_KEY) {
      this.register("openrouter", new OpenRouterProvider());
    }
    if (process.env.COHERE_API_KEY) {
      this.register("cohere", new CohereProvider());
    }
    if (process.env.GROQ_API_KEY) {
      this.register("groq", new GroqProvider());
    }
    if (process.env.DEEPSEEK_API_KEY) {
      this.register("deepseek", new DeepSeekProvider());
    }
    if (process.env.TOGETHER_API_KEY) {
      this.register("together", new TogetherProvider());
    }
    if (process.env.HUGGINGFACE_API_KEY) {
      this.register("huggingface", new HuggingFaceProvider());
    }
  }

  listProviders(): string[] {
    return [...this.providers.keys()];
  }

  listModels(): string[] {
    return Object.keys(MODEL_TO_PROVIDER);
  }
}
