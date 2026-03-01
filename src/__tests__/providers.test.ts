/**
 * AstraOS — LLM ProviderRegistry unit tests
 * Tests provider registration, model routing, and fallback behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../utils/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock all LLM providers to avoid API calls
vi.mock("../llm/AnthropicProvider", () => ({
  AnthropicProvider: vi.fn().mockImplementation(() => ({
    name: "anthropic",
    generate: vi.fn().mockResolvedValue({ text: "Anthropic response", usage: { input: 10, output: 20 } }),
  })),
}));

vi.mock("../llm/OpenAIProvider", () => ({
  OpenAIProvider: vi.fn().mockImplementation(() => ({
    name: "openai",
    generate: vi.fn().mockResolvedValue({ text: "OpenAI response", usage: { input: 10, output: 20 } }),
  })),
}));

vi.mock("../llm/GeminiProvider", () => ({
  GeminiProvider: vi.fn().mockImplementation(() => ({
    name: "gemini",
    generate: vi.fn().mockResolvedValue({ text: "Gemini response", usage: { input: 10, output: 20 } }),
  })),
}));

vi.mock("../llm/OllamaProvider", () => ({
  OllamaProvider: vi.fn().mockImplementation(() => ({
    name: "ollama",
    generate: vi.fn().mockResolvedValue({ text: "Ollama response", usage: { input: 10, output: 20 } }),
  })),
}));

// ProviderRegistry is a singleton — we need to reset it between tests
// Import the module to access the class
const { ProviderRegistry } = await import("../llm/ProviderRegistry");

describe("ProviderRegistry", () => {
  let registry: InstanceType<typeof ProviderRegistry>;

  beforeEach(() => {
    // Access the singleton and clear its providers
    registry = ProviderRegistry.getInstance();
    // Clear internal state by re-initializing
    (registry as any).providers = new Map();
  });

  // ─── Registration ───

  describe("register() / getProvider()", () => {
    it("registers and retrieves a provider", () => {
      const mockProvider = { name: "test", generate: vi.fn() };
      registry.register("anthropic", mockProvider as any);
      expect(registry.getProvider("anthropic")).toBe(mockProvider);
    });

    it("throws for unregistered provider", () => {
      expect(() => registry.getProvider("gemini")).toThrow(/not registered/);
    });

    it("overwrites existing provider", () => {
      const p1 = { name: "v1", generate: vi.fn() };
      const p2 = { name: "v2", generate: vi.fn() };
      registry.register("anthropic", p1 as any);
      registry.register("anthropic", p2 as any);
      expect(registry.getProvider("anthropic")).toBe(p2);
    });
  });

  // ─── Model Routing ───

  describe("getProviderForModel()", () => {
    beforeEach(() => {
      // Register all providers
      process.env.ANTHROPIC_API_KEY = "test-key";
      process.env.OPENAI_API_KEY = "test-key";
      process.env.GEMINI_API_KEY = "test-key";
      registry.initializeDefaults();
    });

    it("routes claude models to anthropic", () => {
      const provider = registry.getProviderForModel("claude-sonnet-4-20250514");
      expect(provider.name).toBe("anthropic");
    });

    it("routes gpt models to openai", () => {
      const provider = registry.getProviderForModel("gpt-4o");
      expect(provider.name).toBe("openai");
    });

    it("routes gemini models to gemini", () => {
      const provider = registry.getProviderForModel("gemini-2.5-pro-preview-06-05");
      expect(provider.name).toBe("gemini");
    });

    it("routes ollama models to ollama", () => {
      const provider = registry.getProviderForModel("llama3.1");
      expect(provider.name).toBe("ollama");
    });

    it("falls back to heuristic for unknown claude model", () => {
      const provider = registry.getProviderForModel("claude-future-model");
      expect(provider.name).toBe("anthropic");
    });

    it("falls back to heuristic for unknown gpt model", () => {
      const provider = registry.getProviderForModel("gpt-5-turbo");
      expect(provider.name).toBe("openai");
    });

    it("falls back to ollama for unknown model", () => {
      const provider = registry.getProviderForModel("some-custom-local-model");
      expect(provider.name).toBe("ollama");
    });
  });

  // ─── initializeDefaults ───

  describe("initializeDefaults()", () => {
    it("registers only providers with API keys set", () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      (registry as any).providers = new Map();

      registry.initializeDefaults();
      const providers = registry.listProviders();
      // Only ollama (always available)
      expect(providers).toContain("ollama");
      expect(providers).not.toContain("anthropic");
      expect(providers).not.toContain("openai");
      expect(providers).not.toContain("gemini");
    });

    it("registers all providers when all keys set", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.GEMINI_API_KEY = "gem-test";
      (registry as any).providers = new Map();

      registry.initializeDefaults();
      const providers = registry.listProviders();
      expect(providers).toContain("anthropic");
      expect(providers).toContain("openai");
      expect(providers).toContain("gemini");
      expect(providers).toContain("ollama");
    });
  });

  // ─── List ───

  describe("listProviders() / listModels()", () => {
    it("lists registered providers", () => {
      registry.register("anthropic", { name: "anthropic" } as any);
      registry.register("openai", { name: "openai" } as any);
      expect(registry.listProviders()).toContain("anthropic");
      expect(registry.listProviders()).toContain("openai");
    });

    it("lists known models", () => {
      const models = registry.listModels();
      expect(models).toContain("claude-sonnet-4-20250514");
      expect(models).toContain("gpt-4o");
      expect(models).toContain("gemini-2.0-flash");
      expect(models).toContain("llama3.1");
    });
  });
});
