/**
 * AstraOS — LLM Providers, ProviderRegistry, ModelFallback & BudgetManager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock logger before any source imports
// ---------------------------------------------------------------------------
vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock fs for BudgetManager persistence
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { BedrockProvider } from "../llm/providers/BedrockProvider";
import { MistralProvider } from "../llm/providers/MistralProvider";
import { OpenRouterProvider } from "../llm/providers/OpenRouterProvider";
import { CohereProvider } from "../llm/providers/CohereProvider";
import { GroqProvider } from "../llm/providers/GroqProvider";
import { DeepSeekProvider } from "../llm/providers/DeepSeekProvider";
import { TogetherProvider } from "../llm/providers/TogetherProvider";
import { HuggingFaceProvider } from "../llm/providers/HuggingFaceProvider";
import { ProviderRegistry } from "../llm/ProviderRegistry";
import { ModelFallback, ModelFallbackError } from "../llm/ModelFallback";
import { BudgetManager } from "../llm/BudgetManager";
import type { LLMProvider, LLMMessage } from "../llm/LLMProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockMessages: LLMMessage[] = [{ role: "user", content: "Hello" }];

/** Standard OpenAI-compatible success response */
function openAIResponse(content = "Hi there", finishReason = "stop") {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      choices: [
        {
          message: { content, tool_calls: undefined },
          finish_reason: finishReason,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
  };
}

/** Cohere v2 success response */
function cohereResponse(content = "Hi there", finishReason = "COMPLETE") {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      message: {
        content: [{ type: "text", text: content }],
        tool_calls: undefined,
      },
      finish_reason: finishReason,
      usage: {
        tokens: { input_tokens: 10, output_tokens: 20 },
      },
    }),
  };
}

/** Bedrock Converse API success response */
function bedrockResponse(content = "Hi there", stopReason = "end_turn") {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      output: {
        message: {
          role: "assistant",
          content: [{ text: content }],
        },
      },
      stopReason,
      usage: { inputTokens: 10, outputTokens: 20 },
    }),
  };
}

/** Error response */
function errorResponse(status = 500, body = "Internal Server Error") {
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. Provider Tests — OpenAI-compatible providers
// ===========================================================================

/**
 * Helper to run the standard 4-test battery for OpenAI-compatible providers.
 */
function describeOpenAICompatibleProvider(
  name: string,
  ProviderClass: new (apiKey?: string, baseUrl?: string) => LLMProvider,
  expectedUrl: string,
  envKey: string,
  modelName: string,
) {
  describe(name, () => {
    it("constructor sets correct name", () => {
      const provider = new ProviderClass("test-key");
      expect(provider.name).toBe(name.toLowerCase().replace("provider", "").replace(" ", ""));
    });

    it("chat() makes correct API call", async () => {
      fetchMock.mockResolvedValueOnce(openAIResponse());
      const provider = new ProviderClass("test-key");

      await provider.chat({ model: modelName, messages: mockMessages, system: "Be helpful" });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain(expectedUrl);
      expect(opts.method).toBe("POST");
      expect(opts.headers["Authorization"]).toBe("Bearer test-key");
      expect(opts.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(opts.body);
      expect(body.model).toBe(modelName);
      expect(body.messages).toEqual(
        expect.arrayContaining([
          { role: "system", content: "Be helpful" },
          { role: "user", content: "Hello" },
        ]),
      );
      expect(body.max_tokens).toBe(4096);
    });

    it("chat() correctly parses response into LLMResponse format", async () => {
      fetchMock.mockResolvedValueOnce(openAIResponse("Test answer", "stop"));
      const provider = new ProviderClass("test-key");

      const result = await provider.chat({ model: modelName, messages: mockMessages });

      expect(result.text).toBe("Test answer");
      expect(result.toolCalls).toEqual([]);
      expect(result.stopReason).toBe("stop");
      expect(result.usage).toEqual({ input: 10, output: 20 });
    });

    it("throws on non-ok API response", async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(429, "Rate limited"));
      const provider = new ProviderClass("test-key");

      await expect(
        provider.chat({ model: modelName, messages: mockMessages }),
      ).rejects.toThrow("429");
    });

    it("throws when API key is not set", async () => {
      const provider = new ProviderClass("");
      await expect(
        provider.chat({ model: modelName, messages: mockMessages }),
      ).rejects.toThrow("not set");
    });
  });
}

// MistralProvider
describeOpenAICompatibleProvider(
  "mistral",
  MistralProvider as unknown as new (apiKey?: string, baseUrl?: string) => LLMProvider,
  "/chat/completions",
  "MISTRAL_API_KEY",
  "mistral-large-latest",
);

// GroqProvider
describeOpenAICompatibleProvider(
  "groq",
  GroqProvider as unknown as new (apiKey?: string, baseUrl?: string) => LLMProvider,
  "/chat/completions",
  "GROQ_API_KEY",
  "llama-3.3-70b-versatile",
);

// DeepSeekProvider
describeOpenAICompatibleProvider(
  "deepseek",
  DeepSeekProvider as unknown as new (apiKey?: string, baseUrl?: string) => LLMProvider,
  "/chat/completions",
  "DEEPSEEK_API_KEY",
  "deepseek-chat",
);

// TogetherProvider
describeOpenAICompatibleProvider(
  "together",
  TogetherProvider as unknown as new (apiKey?: string, baseUrl?: string) => LLMProvider,
  "/chat/completions",
  "TOGETHER_API_KEY",
  "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo",
);

// HuggingFaceProvider
describe("huggingface", () => {
  it("constructor sets correct name", () => {
    const provider = new HuggingFaceProvider("test-key");
    expect(provider.name).toBe("huggingface");
  });

  it("chat() constructs correct model-specific URL", async () => {
    fetchMock.mockResolvedValueOnce(openAIResponse());
    const provider = new HuggingFaceProvider("test-key");
    const model = "meta-llama/Llama-3-8B";

    await provider.chat({ model, messages: mockMessages });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(`/models/${model}/v1/chat/completions`);
  });

  it("chat() correctly parses response into LLMResponse format", async () => {
    fetchMock.mockResolvedValueOnce(openAIResponse("HF response", "stop"));
    const provider = new HuggingFaceProvider("test-key");

    const result = await provider.chat({ model: "some-model", messages: mockMessages });

    expect(result.text).toBe("HF response");
    expect(result.stopReason).toBe("stop");
    expect(result.usage).toEqual({ input: 10, output: 20 });
  });

  it("throws on non-ok API response", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500, "Server error"));
    const provider = new HuggingFaceProvider("test-key");

    await expect(
      provider.chat({ model: "m", messages: mockMessages }),
    ).rejects.toThrow("500");
  });

  it("throws when API key is not set", async () => {
    const provider = new HuggingFaceProvider("");
    await expect(
      provider.chat({ model: "m", messages: mockMessages }),
    ).rejects.toThrow("HUGGINGFACE_API_KEY is not set");
  });
});

// OpenRouterProvider
describe("openrouter", () => {
  it("constructor sets correct name", () => {
    const provider = new OpenRouterProvider("test-key");
    expect(provider.name).toBe("openrouter");
  });

  it("chat() sends X-Title and HTTP-Referer headers", async () => {
    fetchMock.mockResolvedValueOnce(openAIResponse());
    const provider = new OpenRouterProvider("test-key");

    await provider.chat({ model: "gpt-4o", messages: mockMessages });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers["X-Title"]).toBe("AstraOS");
    expect(opts.headers["HTTP-Referer"]).toBe("https://github.com/astraos");
  });

  it("chat() correctly parses response", async () => {
    fetchMock.mockResolvedValueOnce(openAIResponse("OR result", "stop"));
    const provider = new OpenRouterProvider("test-key");

    const result = await provider.chat({ model: "gpt-4o", messages: mockMessages });
    expect(result.text).toBe("OR result");
    expect(result.usage).toEqual({ input: 10, output: 20 });
  });

  it("throws on non-ok API response", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, "Unauthorized"));
    const provider = new OpenRouterProvider("test-key");

    await expect(
      provider.chat({ model: "m", messages: mockMessages }),
    ).rejects.toThrow("401");
  });

  it("throws when API key is not set", async () => {
    const provider = new OpenRouterProvider("");
    await expect(
      provider.chat({ model: "m", messages: mockMessages }),
    ).rejects.toThrow("OPENROUTER_API_KEY is not set");
  });
});

// CohereProvider
describe("cohere", () => {
  it("constructor sets correct name", () => {
    const provider = new CohereProvider("test-key");
    expect(provider.name).toBe("cohere");
  });

  it("chat() calls Cohere v2 /chat endpoint", async () => {
    fetchMock.mockResolvedValueOnce(cohereResponse());
    const provider = new CohereProvider("test-key");

    await provider.chat({ model: "command-r-plus", messages: mockMessages });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/v2/chat");
    expect(url).not.toContain("completions");
  });

  it("chat() parses Cohere v2 content blocks", async () => {
    fetchMock.mockResolvedValueOnce(cohereResponse("Cohere says hi", "COMPLETE"));
    const provider = new CohereProvider("test-key");

    const result = await provider.chat({ model: "command-r-plus", messages: mockMessages });

    expect(result.text).toBe("Cohere says hi");
    expect(result.stopReason).toBe("stop");
    expect(result.usage).toEqual({ input: 10, output: 20 });
  });

  it("maps TOOL_CALL finish_reason to tool_use stopReason", async () => {
    fetchMock.mockResolvedValueOnce(
      cohereResponse("", "TOOL_CALL"),
    );
    const provider = new CohereProvider("test-key");

    const result = await provider.chat({ model: "command-r", messages: mockMessages });
    expect(result.stopReason).toBe("tool_use");
  });

  it("throws on non-ok API response", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(403, "Forbidden"));
    const provider = new CohereProvider("test-key");

    await expect(
      provider.chat({ model: "command", messages: mockMessages }),
    ).rejects.toThrow("403");
  });

  it("throws when API key is not set", async () => {
    const provider = new CohereProvider("");
    await expect(
      provider.chat({ model: "command", messages: mockMessages }),
    ).rejects.toThrow("COHERE_API_KEY is not set");
  });
});

// BedrockProvider
describe("bedrock", () => {
  const bedrockOpts = {
    accessKeyId: "AKID",
    secretAccessKey: "SECRET",
    region: "us-east-1",
  };

  it("constructor sets correct name", () => {
    const provider = new BedrockProvider(bedrockOpts);
    expect(provider.name).toBe("bedrock");
  });

  it("chat() calls Bedrock Converse API with correct URL", async () => {
    fetchMock.mockResolvedValueOnce(bedrockResponse());
    const provider = new BedrockProvider(bedrockOpts);
    const model = "anthropic.claude-3-5-sonnet-20241022-v2:0";

    await provider.chat({ model, messages: mockMessages });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("bedrock-runtime.us-east-1.amazonaws.com");
    expect(url).toContain("/converse");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Authorization"]).toContain("AWS4-HMAC-SHA256");
  });

  it("chat() parses Bedrock Converse response", async () => {
    fetchMock.mockResolvedValueOnce(bedrockResponse("Bedrock says hi", "end_turn"));
    const provider = new BedrockProvider(bedrockOpts);

    const result = await provider.chat({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      messages: mockMessages,
    });

    expect(result.text).toBe("Bedrock says hi");
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage).toEqual({ input: 10, output: 20 });
  });

  it("throws on non-ok API response", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(400, "BadRequest"));
    const provider = new BedrockProvider(bedrockOpts);

    await expect(
      provider.chat({ model: "m", messages: mockMessages }),
    ).rejects.toThrow("400");
  });

  it("throws when AWS credentials are missing", async () => {
    const provider = new BedrockProvider({ accessKeyId: "", secretAccessKey: "" });

    await expect(
      provider.chat({ model: "m", messages: mockMessages }),
    ).rejects.toThrow("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set");
  });
});

// ===========================================================================
// 2. ProviderRegistry Tests
// ===========================================================================

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    // Create a fresh instance via the singleton resetting trick:
    // access private constructor by clearing the static instance
    (ProviderRegistry as any).instance = undefined;
    registry = ProviderRegistry.getInstance();
  });

  it("getInstance() returns singleton", () => {
    const r2 = ProviderRegistry.getInstance();
    expect(r2).toBe(registry);
  });

  it("register() and getProvider() work", () => {
    const fakeProvider: LLMProvider = {
      name: "fake",
      chat: vi.fn(),
    };
    registry.register("mistral", fakeProvider);
    expect(registry.getProvider("mistral")).toBe(fakeProvider);
  });

  it("getProvider() throws on unregistered provider", () => {
    expect(() => registry.getProvider("deepseek")).toThrow('not registered');
  });

  it("getProviderForModel() maps known models to correct provider", () => {
    const mistralProv: LLMProvider = { name: "mistral", chat: vi.fn() };
    const cohereProv: LLMProvider = { name: "cohere", chat: vi.fn() };
    registry.register("mistral", mistralProv);
    registry.register("cohere", cohereProv);

    expect(registry.getProviderForModel("mistral-large-latest")).toBe(mistralProv);
    expect(registry.getProviderForModel("command-r-plus")).toBe(cohereProv);
  });

  it("getProviderForModel() heuristic: claude -> anthropic", () => {
    const anthropic: LLMProvider = { name: "anthropic", chat: vi.fn() };
    registry.register("anthropic", anthropic);

    expect(registry.getProviderForModel("claude-unknown-model")).toBe(anthropic);
  });

  it("getProviderForModel() heuristic: gpt -> openai", () => {
    const openai: LLMProvider = { name: "openai", chat: vi.fn() };
    registry.register("openai", openai);

    expect(registry.getProviderForModel("gpt-5-turbo")).toBe(openai);
  });

  it("getProviderForModel() heuristic: gemini -> gemini", () => {
    const gemini: LLMProvider = { name: "gemini", chat: vi.fn() };
    registry.register("gemini", gemini);

    expect(registry.getProviderForModel("gemini-3.0-ultra")).toBe(gemini);
  });

  it("getProviderForModel() heuristic: org/model format -> openrouter", () => {
    const openrouter: LLMProvider = { name: "openrouter", chat: vi.fn() };
    registry.register("openrouter", openrouter);

    expect(registry.getProviderForModel("some-org/some-model")).toBe(openrouter);
  });

  it("getProviderForModel() heuristic: deepseek- prefix -> deepseek", () => {
    const ds: LLMProvider = { name: "deepseek", chat: vi.fn() };
    registry.register("deepseek", ds);

    expect(registry.getProviderForModel("deepseek-v3")).toBe(ds);
  });

  it("getProviderForModel() heuristic: unknown model -> ollama", () => {
    const ollama: LLMProvider = { name: "ollama", chat: vi.fn() };
    registry.register("ollama", ollama);

    expect(registry.getProviderForModel("some-random-local-model")).toBe(ollama);
  });

  it("listProviders() returns registered provider names", () => {
    const p1: LLMProvider = { name: "a", chat: vi.fn() };
    const p2: LLMProvider = { name: "b", chat: vi.fn() };
    registry.register("groq", p1);
    registry.register("together", p2);

    const list = registry.listProviders();
    expect(list).toContain("groq");
    expect(list).toContain("together");
  });

  it("listModels() returns known model identifiers", () => {
    const models = registry.listModels();
    expect(models).toContain("gpt-4o");
    expect(models).toContain("mistral-large-latest");
    expect(models).toContain("deepseek-chat");
  });
});

// ===========================================================================
// 3. ModelFallback Tests
// ===========================================================================

describe("ModelFallback", () => {
  let registry: ProviderRegistry;
  let fallback: ModelFallback;
  let primaryProvider: LLMProvider;
  let secondaryProvider: LLMProvider;

  beforeEach(() => {
    (ProviderRegistry as any).instance = undefined;
    registry = ProviderRegistry.getInstance();

    primaryProvider = {
      name: "anthropic",
      chat: vi.fn(),
    };
    secondaryProvider = {
      name: "openai",
      chat: vi.fn(),
    };

    registry.register("anthropic", primaryProvider);
    registry.register("openai", secondaryProvider);

    fallback = new ModelFallback(registry);
    fallback.resetAllHealth();
  });

  it("chatWithFallback() tries primary model first and returns on success", async () => {
    (primaryProvider.chat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: "Primary response",
      toolCalls: [],
      stopReason: "stop",
      usage: { input: 5, output: 10 },
    });

    const result = await fallback.chatWithFallback({
      model: "claude-sonnet-4-20250514",
      messages: mockMessages,
      fallbackModels: ["gpt-4o"],
    });

    expect(result.text).toBe("Primary response");
    expect(result.actualModel).toBe("claude-sonnet-4-20250514");
    expect(result.actualProvider).toBe("anthropic");
    expect(result.attempts).toBe(1);
    expect(primaryProvider.chat).toHaveBeenCalledOnce();
    expect(secondaryProvider.chat).not.toHaveBeenCalled();
  });

  it("chatWithFallback() falls back to secondary on primary failure", async () => {
    (primaryProvider.chat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Primary down"),
    );
    (secondaryProvider.chat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: "Secondary response",
      toolCalls: [],
      stopReason: "stop",
      usage: { input: 5, output: 10 },
    });

    const result = await fallback.chatWithFallback({
      model: "claude-sonnet-4-20250514",
      messages: mockMessages,
      fallbackModels: ["gpt-4o"],
    });

    expect(result.text).toBe("Secondary response");
    expect(result.actualModel).toBe("gpt-4o");
    expect(result.actualProvider).toBe("openai");
    expect(result.attempts).toBe(2);
    expect(result.attemptLog).toHaveLength(2);
    expect(result.attemptLog[0].success).toBe(false);
    expect(result.attemptLog[1].success).toBe(true);
  });

  it("throws ModelFallbackError when all providers fail", async () => {
    (primaryProvider.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
    (secondaryProvider.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));

    await expect(
      fallback.chatWithFallback({
        model: "claude-sonnet-4-20250514",
        messages: mockMessages,
        fallbackModels: ["gpt-4o"],
      }),
    ).rejects.toThrow(ModelFallbackError);
  });

  it("circuit breaker opens after 5 consecutive failures", async () => {
    (primaryProvider.chat as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("always fails"),
    );
    (secondaryProvider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "ok",
      toolCalls: [],
      stopReason: "stop",
      usage: { input: 1, output: 1 },
    });

    // Trigger 5 failures on the primary model
    for (let i = 0; i < 5; i++) {
      await fallback.chatWithFallback({
        model: "claude-sonnet-4-20250514",
        messages: mockMessages,
        fallbackModels: ["gpt-4o"],
      });
    }

    // After 5 failures, circuit should be open
    const health = fallback.getModelHealth("claude-sonnet-4-20250514");
    expect(health.circuitState).toBe("open");
    expect(health.consecutiveFailures).toBe(5);
  });

  it("getModelHealth() tracks success rate and latency", async () => {
    (primaryProvider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "ok",
      toolCalls: [],
      stopReason: "stop",
      usage: { input: 1, output: 1 },
    });

    await fallback.chatWithFallback({
      model: "claude-sonnet-4-20250514",
      messages: mockMessages,
      fallbackModels: [],
    });

    const health = fallback.getModelHealth("claude-sonnet-4-20250514");
    expect(health.successRate).toBe(1);
    expect(health.totalRequests).toBe(1);
    expect(health.circuitState).toBe("closed");
    expect(health.consecutiveFailures).toBe(0);
  });

  it("setFallbackChain() and getFallbackChain() work", () => {
    fallback.setFallbackChain("my-model", ["fallback-a", "fallback-b"]);
    expect(fallback.getFallbackChain("my-model")).toEqual(["fallback-a", "fallback-b"]);
  });

  it("getFallbackChain() returns defaults for known models", () => {
    const chain = fallback.getFallbackChain("gpt-4o");
    expect(chain.length).toBeGreaterThan(0);
    expect(chain).toContain("claude-sonnet-4-20250514");
  });

  it("getFallbackChain() returns empty array for unknown models", () => {
    expect(fallback.getFallbackChain("totally-unknown")).toEqual([]);
  });

  it("resetHealth() clears health state for a model", async () => {
    (primaryProvider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "ok",
      toolCalls: [],
      stopReason: "stop",
      usage: { input: 1, output: 1 },
    });

    await fallback.chatWithFallback({
      model: "claude-sonnet-4-20250514",
      messages: mockMessages,
      fallbackModels: [],
    });

    fallback.resetHealth("claude-sonnet-4-20250514");
    const health = fallback.getModelHealth("claude-sonnet-4-20250514");
    expect(health.totalRequests).toBe(0);
  });

  it("estimateCostPer1kTokens() returns Infinity for unknown models", () => {
    expect(fallback.estimateCostPer1kTokens("nonexistent-model")).toBe(Infinity);
  });

  it("estimateCostPer1kTokens() returns average of input+output for known models", () => {
    // gpt-4o: input=0.0025, output=0.01 => avg=0.00625
    const cost = fallback.estimateCostPer1kTokens("gpt-4o");
    expect(cost).toBeCloseTo(0.00625);
  });

  it("calculateCost() static method works", () => {
    const cost = ModelFallback.calculateCost("gpt-4o", { input: 1000, output: 1000 });
    // 1000/1000 * 0.0025 + 1000/1000 * 0.01 = 0.0125
    expect(cost).toBeCloseTo(0.0125);
  });
});

// ===========================================================================
// 4. BudgetManager Tests
// ===========================================================================

describe("BudgetManager", () => {
  let bm: BudgetManager;

  beforeEach(() => {
    bm = new BudgetManager("/tmp/test-budgets");
  });

  it("getAccount() creates a new account if not exists", () => {
    const account = bm.getAccount("user-1", "user");
    expect(account.id).toBe("user-1");
    expect(account.type).toBe("user");
    expect(account.limits).toEqual([]);
    expect(account.usage).toEqual([]);
  });

  it("getAccount() returns existing account on repeated calls", () => {
    const a1 = bm.getAccount("user-1");
    const a2 = bm.getAccount("user-1");
    expect(a1).toBe(a2);
  });

  it("setLimits() creates account with limits", () => {
    bm.setLimits("user-2", "user", [
      { maxTokens: 100000, maxCostUsd: 10, period: "daily" },
    ]);
    const account = bm.getAccount("user-2");
    expect(account.limits).toHaveLength(1);
    expect(account.limits[0].maxTokens).toBe(100000);
    expect(account.limits[0].maxCostUsd).toBe(10);
  });

  it("setLimits() updates limits on existing account", () => {
    bm.setLimits("user-3", "user", [{ maxTokens: 1000, maxCostUsd: 1, period: "daily" }]);
    bm.setLimits("user-3", "user", [{ maxTokens: 2000, maxCostUsd: 2, period: "monthly" }]);

    const account = bm.getAccount("user-3");
    expect(account.limits).toHaveLength(1);
    expect(account.limits[0].maxTokens).toBe(2000);
    expect(account.limits[0].period).toBe("monthly");
  });

  it("recordUsage() tracks token usage and cost", () => {
    bm.getAccount("user-4", "user");
    const result = bm.recordUsage("user-4", "gpt-4o", 500, 200);

    expect(result.allowed).toBe(true);
    expect(result.costUsd).toBeGreaterThanOrEqual(0);

    const account = bm.getAccount("user-4");
    expect(account.usage).toHaveLength(1);
    expect(account.usage[0].model).toBe("gpt-4o");
    expect(account.usage[0].inputTokens).toBe(500);
    expect(account.usage[0].outputTokens).toBe(200);
  });

  it("recordUsage() returns allowed=false when token budget exhausted", () => {
    bm.setLimits("user-5", "user", [
      { maxTokens: 100, maxCostUsd: 0, period: "daily" },
    ]);

    // First usage within budget
    const r1 = bm.recordUsage("user-5", "gpt-4o", 40, 40);
    expect(r1.allowed).toBe(true);

    // Second usage exceeds budget (already 80 used, adding 50 = 130 > 100)
    const r2 = bm.recordUsage("user-5", "gpt-4o", 25, 25);
    expect(r2.allowed).toBe(false);
    expect(r2.reason).toContain("token limit exceeded");
  });

  it("recordUsage() returns allowed=false when cost budget exhausted", () => {
    bm.setLimits("user-6", "user", [
      { maxTokens: 0, maxCostUsd: 0.001, period: "daily" },
    ]);

    // gpt-4o: input=$0.0025/1K, output=$0.01/1K
    // 1000 input + 1000 output = $0.0025 + $0.01 = $0.0125 > $0.001
    const result = bm.recordUsage("user-6", "gpt-4o", 1000, 1000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("cost limit exceeded");
  });

  it("budget alerts fire at thresholds", () => {
    const alertCallback = vi.fn();
    bm.onAlert(alertCallback);

    bm.setLimits("user-7", "user", [
      { maxTokens: 100, maxCostUsd: 0, period: "daily" },
    ]);

    // Push usage to 80% (80/100 tokens)
    bm.recordUsage("user-7", "llama3.1", 40, 40); // free model, 80 tokens total

    expect(alertCallback).toHaveBeenCalled();
    const alert = alertCallback.mock.calls[0][0];
    expect(alert.accountId).toBe("user-7");
    expect(alert.threshold).toBe(0.8);
    expect(alert.resource).toBe("tokens");
  });

  it("budget alerts do not fire duplicate for same threshold", () => {
    const alertCallback = vi.fn();
    bm.onAlert(alertCallback);

    bm.setLimits("user-8", "user", [
      { maxTokens: 100, maxCostUsd: 0, period: "daily" },
    ]);

    bm.recordUsage("user-8", "llama3.1", 40, 42); // 82 tokens => 80% threshold
    const callCount = alertCallback.mock.calls.length;

    // Record more usage (still between 80% and 90%)
    bm.recordUsage("user-8", "llama3.1", 3, 3); // 88 tokens, still 80% threshold only
    // Should not have fired again at 80%
    expect(alertCallback.mock.calls.length).toBe(callCount);
  });

  it("onAlert() returns unsubscribe function", () => {
    const cb = vi.fn();
    const unsub = bm.onAlert(cb);
    unsub();

    bm.setLimits("user-9", "user", [
      { maxTokens: 10, maxCostUsd: 0, period: "daily" },
    ]);
    bm.recordUsage("user-9", "llama3.1", 5, 5); // 100% => should trigger, but cb unsubscribed

    expect(cb).not.toHaveBeenCalled();
  });

  it("canSpend() pre-flight check works", () => {
    bm.setLimits("user-10", "user", [
      { maxTokens: 100, maxCostUsd: 0, period: "daily" },
    ]);

    const r1 = bm.canSpend("user-10", 50, 0);
    expect(r1.allowed).toBe(true);

    const r2 = bm.canSpend("user-10", 200, 0);
    expect(r2.allowed).toBe(false);
  });

  it("canSpend() returns allowed for unknown accounts", () => {
    const r = bm.canSpend("nonexistent", 999999, 999);
    expect(r.allowed).toBe(true);
  });

  it("getUsageSummary() aggregates usage correctly", () => {
    bm.getAccount("user-11", "user");
    bm.recordUsage("user-11", "gpt-4o", 100, 50);
    bm.recordUsage("user-11", "gpt-4o", 200, 100);

    const summary = bm.getUsageSummary("user-11", "all-time");
    expect(summary.totalInputTokens).toBe(300);
    expect(summary.totalOutputTokens).toBe(150);
    expect(summary.totalTokens).toBe(450);
    expect(summary.requestCount).toBe(2);
    expect(summary.byModel["gpt-4o"]).toBeDefined();
    expect(summary.byModel["gpt-4o"].requests).toBe(2);
  });

  it("calculateCost() static method returns correct cost", () => {
    // gpt-4o: input=$0.0025/1K, output=$0.01/1K
    const cost = BudgetManager.calculateCost("gpt-4o", 2000, 1000);
    // 2000/1000*0.0025 + 1000/1000*0.01 = 0.005 + 0.01 = 0.015
    expect(cost).toBeCloseTo(0.015);
  });

  it("calculateCost() returns 0 for unknown models", () => {
    expect(BudgetManager.calculateCost("unknown-model", 1000, 1000)).toBe(0);
  });

  it("estimateCost() estimates based on character count", () => {
    // 400 chars => ~100 input tokens
    // gpt-4o: 100/1000*0.0025 + 500/1000*0.01 = 0.00025 + 0.005 = 0.00525
    const cost = BudgetManager.estimateCost("gpt-4o", 400, 500);
    expect(cost).toBeCloseTo(0.00525);
  });

  it("getAllPricing() returns pricing for known models", () => {
    const pricing = BudgetManager.getAllPricing();
    expect(pricing["gpt-4o"]).toBeDefined();
    expect(pricing["gpt-4o"].input).toBe(0.0025);
    expect(pricing["gpt-4o"].output).toBe(0.01);
  });

  it("exportAnalytics() returns analytics for all accounts", () => {
    bm.setLimits("export-1", "user", [{ maxTokens: 10000, maxCostUsd: 1, period: "daily" }]);
    bm.recordUsage("export-1", "gpt-4o", 100, 50);

    const analytics = bm.exportAnalytics();
    expect(analytics.length).toBeGreaterThanOrEqual(1);
    const entry = analytics.find((a) => a.accountId === "export-1");
    expect(entry).toBeDefined();
    expect(entry!.daily).toBeDefined();
    expect(entry!.monthly).toBeDefined();
    expect(entry!.allTime).toBeDefined();
  });
});
