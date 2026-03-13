/**
 * AstraOS — ModelFallback.ts
 * Intelligent model fallback system with provider health tracking, circuit breaker,
 * cost-aware routing, latency percentiles, and automatic provider demotion/promotion.
 */

import { logger } from "../utils/logger";
import type {
  LLMProvider,
  LLMResponse,
  LLMMessage,
  LLMToolDefinition,
  ProviderType,
} from "./LLMProvider";
import { ProviderRegistry } from "./ProviderRegistry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatParams {
  model: string;
  system?: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  maxTokens?: number;
  toolResults?: Array<{ tool_use_id: string; content: string }>;
  /** Override the fallback chain for this request. */
  fallbackModels?: string[];
  /** Maximum time in ms to wait for any single provider. Default 30000. */
  timeoutMs?: number;
  /** If true, prefer the cheapest provider that meets quality threshold. */
  costOptimize?: boolean;
}

export interface FallbackResult extends LLMResponse {
  /** The model that actually served the request. */
  actualModel: string;
  /** Provider type that served the request. */
  actualProvider: ProviderType | string;
  /** Number of providers attempted before success. */
  attempts: number;
  /** Total wall-clock time across all attempts. */
  totalLatencyMs: number;
  /** Per-attempt details. */
  attemptLog: AttemptRecord[];
}

export interface AttemptRecord {
  model: string;
  provider: string;
  success: boolean;
  latencyMs: number;
  error?: string;
  statusCode?: number;
}

// ---------------------------------------------------------------------------
// Provider Health Tracking
// ---------------------------------------------------------------------------

interface ProviderHealthState {
  provider: string;
  model: string;
  /** Rolling window of last N request outcomes. */
  history: Array<{ success: boolean; latencyMs: number; timestamp: number; error?: string }>;
  /** Circuit breaker state. */
  circuitState: "closed" | "open" | "half-open";
  circuitOpenedAt?: number;
  consecutiveFailures: number;
  /** Cumulative cost tracking in USD. */
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
}

const HEALTH_WINDOW_SIZE = 100;
const CIRCUIT_BREAK_FAILURES = 5;
const CIRCUIT_HALF_OPEN_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Default Fallback Chains
// ---------------------------------------------------------------------------

const DEFAULT_FALLBACK_CHAINS: Record<string, string[]> = {
  // Anthropic models
  "claude-opus-4-20250514": ["claude-sonnet-4-20250514", "gpt-4o", "gemini-2.5-pro-preview-06-05"],
  "claude-sonnet-4-20250514": ["claude-opus-4-20250514", "gpt-4o", "gemini-2.5-pro-preview-06-05"],
  "claude-haiku-4-5-20251001": ["claude-sonnet-4-20250514", "gpt-4o-mini", "gemini-2.5-flash-preview-05-20"],
  // OpenAI models
  "gpt-4o": ["claude-sonnet-4-20250514", "gemini-2.5-pro-preview-06-05", "gpt-4-turbo"],
  "gpt-4o-mini": ["claude-haiku-4-5-20251001", "gemini-2.5-flash-preview-05-20", "gpt-4o"],
  "o3": ["o4-mini", "claude-opus-4-20250514", "gemini-2.5-pro-preview-06-05"],
  "o4-mini": ["o3-mini", "gpt-4o", "claude-sonnet-4-20250514"],
  // Gemini models
  "gemini-2.5-pro-preview-06-05": ["claude-sonnet-4-20250514", "gpt-4o"],
  "gemini-2.5-flash-preview-05-20": ["gpt-4o-mini", "claude-haiku-4-5-20251001"],
  "gemini-2.0-flash": ["gemini-2.5-flash-preview-05-20", "gpt-4o-mini"],
};

// ---------------------------------------------------------------------------
// Per-model pricing (USD per 1K tokens)
// ---------------------------------------------------------------------------

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-opus-4-20250514": { input: 0.015, output: 0.075 },
  "claude-sonnet-4-20250514": { input: 0.003, output: 0.015 },
  "claude-haiku-4-5-20251001": { input: 0.001, output: 0.005 },
  // OpenAI
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4-turbo": { input: 0.01, output: 0.03 },
  "o1": { input: 0.015, output: 0.06 },
  "o3": { input: 0.01, output: 0.04 },
  "o3-mini": { input: 0.0011, output: 0.0044 },
  "o4-mini": { input: 0.0011, output: 0.0044 },
  // Gemini
  "gemini-2.5-pro-preview-06-05": { input: 0.00125, output: 0.01 },
  "gemini-2.5-flash-preview-05-20": { input: 0.00015, output: 0.0006 },
  "gemini-2.0-flash": { input: 0.0001, output: 0.0004 },
  // Ollama (local — effectively free)
  "llama3.1": { input: 0, output: 0 },
  "llama3.2": { input: 0, output: 0 },
  "mistral": { input: 0, output: 0 },
  "codellama": { input: 0, output: 0 },
  "phi3": { input: 0, output: 0 },
  "qwen2.5": { input: 0, output: 0 },
  "deepseek-r1": { input: 0, output: 0 },
};

// ---------------------------------------------------------------------------
// ModelFallback
// ---------------------------------------------------------------------------

export class ModelFallback {
  private registry: ProviderRegistry;
  private healthMap: Map<string, ProviderHealthState> = new Map();
  private customChains: Map<string, string[]> = new Map();

  constructor(registry?: ProviderRegistry) {
    this.registry = registry ?? ProviderRegistry.getInstance();
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /**
   * Set a custom fallback chain for a model.
   */
  setFallbackChain(model: string, fallbacks: string[]): void {
    this.customChains.set(model, fallbacks);
  }

  /**
   * Get the fallback chain for a model.
   */
  getFallbackChain(model: string): string[] {
    return this.customChains.get(model) ?? DEFAULT_FALLBACK_CHAINS[model] ?? [];
  }

  // -----------------------------------------------------------------------
  // Core: chatWithFallback
  // -----------------------------------------------------------------------

  /**
   * Attempt a chat completion with automatic fallback across providers.
   * Tries primary model first, then falls back through the chain.
   */
  async chatWithFallback(params: ChatParams): Promise<FallbackResult> {
    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const attemptLog: AttemptRecord[] = [];
    const startTotal = Date.now();

    // Build the ordered list of models to try
    let modelsToTry = [params.model];
    const fallbacks = params.fallbackModels ?? this.getFallbackChain(params.model);
    modelsToTry = modelsToTry.concat(fallbacks);

    // Cost optimization: sort fallbacks by cost (cheapest first) if requested
    if (params.costOptimize) {
      const primary = modelsToTry[0];
      const rest = modelsToTry.slice(1).sort((a, b) => {
        const costA = this.estimateCostPer1kTokens(a);
        const costB = this.estimateCostPer1kTokens(b);
        return costA - costB;
      });
      modelsToTry = [primary, ...rest];
    }

    // Filter out models whose circuit breaker is open
    const available = modelsToTry.filter((model) => {
      const health = this.getHealthState(model);
      if (health.circuitState === "open") {
        // Check if we should transition to half-open
        if (
          health.circuitOpenedAt &&
          Date.now() - health.circuitOpenedAt > CIRCUIT_HALF_OPEN_MS
        ) {
          health.circuitState = "half-open";
          logger.info(`[ModelFallback] Circuit half-open for "${model}" — allowing probe`);
          return true;
        }
        logger.debug(`[ModelFallback] Skipping "${model}" — circuit open`);
        return false;
      }
      return true;
    });

    if (available.length === 0) {
      // All circuits open — force-try the primary
      available.push(params.model);
      logger.warn("[ModelFallback] All provider circuits open — forcing primary model");
    }

    for (const model of available) {
      let provider: LLMProvider;
      try {
        provider = this.registry.getProviderForModel(model);
      } catch {
        logger.warn(`[ModelFallback] No provider registered for model "${model}" — skipping`);
        continue;
      }

      const attemptStart = Date.now();
      try {
        const response = await this.callWithTimeout(
          provider,
          { ...params, model },
          timeoutMs
        );

        const latencyMs = Date.now() - attemptStart;
        attemptLog.push({
          model,
          provider: provider.name,
          success: true,
          latencyMs,
        });

        // Record health
        this.recordSuccess(model, provider.name, latencyMs);

        // Track cost
        this.trackCost(model, response.usage);

        return {
          ...response,
          actualModel: model,
          actualProvider: provider.name,
          attempts: attemptLog.length,
          totalLatencyMs: Date.now() - startTotal,
          attemptLog,
        };
      } catch (err) {
        const latencyMs = Date.now() - attemptStart;
        const errMsg = err instanceof Error ? err.message : String(err);
        const statusCode = this.extractStatusCode(err);

        attemptLog.push({
          model,
          provider: provider!.name,
          success: false,
          latencyMs,
          error: errMsg,
          statusCode,
        });

        this.recordFailure(model, provider!.name, errMsg);

        // Log the failure
        if (statusCode === 429) {
          logger.warn(`[ModelFallback] Rate limited on "${model}" (${provider!.name}) — trying next`);
        } else {
          logger.warn(`[ModelFallback] Failed on "${model}" (${provider!.name}): ${errMsg}`);
        }
      }
    }

    // All models exhausted
    const totalLatencyMs = Date.now() - startTotal;
    const errorSummary = attemptLog
      .map((a) => `${a.model}(${a.provider}): ${a.error}`)
      .join("; ");

    throw new ModelFallbackError(
      `All ${attemptLog.length} provider(s) failed: ${errorSummary}`,
      attemptLog,
      totalLatencyMs
    );
  }

  // -----------------------------------------------------------------------
  // Timeout wrapper
  // -----------------------------------------------------------------------

  private callWithTimeout(
    provider: LLMProvider,
    params: ChatParams,
    timeoutMs: number
  ): Promise<LLMResponse> {
    return new Promise<LLMResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Provider "${provider.name}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      provider
        .chat({
          model: params.model,
          system: params.system,
          messages: params.messages,
          tools: params.tools,
          maxTokens: params.maxTokens,
          toolResults: params.toolResults,
        })
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // -----------------------------------------------------------------------
  // Health Tracking
  // -----------------------------------------------------------------------

  private getHealthState(model: string): ProviderHealthState {
    if (!this.healthMap.has(model)) {
      let providerName = "unknown";
      try {
        providerName = this.registry.getProviderForModel(model).name;
      } catch { /* ignore */ }

      this.healthMap.set(model, {
        provider: providerName,
        model,
        history: [],
        circuitState: "closed",
        consecutiveFailures: 0,
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalRequests: 0,
      });
    }
    return this.healthMap.get(model)!;
  }

  private recordSuccess(model: string, _provider: string, latencyMs: number): void {
    const state = this.getHealthState(model);
    state.history.push({ success: true, latencyMs, timestamp: Date.now() });
    if (state.history.length > HEALTH_WINDOW_SIZE) state.history.shift();

    state.consecutiveFailures = 0;
    state.totalRequests++;

    // Close circuit on success
    if (state.circuitState !== "closed") {
      state.circuitState = "closed";
      state.circuitOpenedAt = undefined;
      logger.info(`[ModelFallback] Circuit closed for "${model}"`);
    }
  }

  private recordFailure(model: string, _provider: string, error: string): void {
    const state = this.getHealthState(model);
    state.history.push({ success: false, latencyMs: 0, timestamp: Date.now(), error });
    if (state.history.length > HEALTH_WINDOW_SIZE) state.history.shift();

    state.consecutiveFailures++;
    state.totalRequests++;

    // Circuit breaker
    if (state.consecutiveFailures >= CIRCUIT_BREAK_FAILURES) {
      if (state.circuitState !== "open") {
        state.circuitState = "open";
        state.circuitOpenedAt = Date.now();
        logger.warn(
          `[ModelFallback] Circuit OPEN for "${model}" after ${CIRCUIT_BREAK_FAILURES} consecutive failures`
        );
      }
    }
  }

  private trackCost(model: string, usage: { input: number; output: number }): void {
    const state = this.getHealthState(model);
    state.totalInputTokens += usage.input;
    state.totalOutputTokens += usage.output;

    const pricing = MODEL_PRICING[model];
    if (pricing) {
      state.totalCostUsd +=
        (usage.input / 1000) * pricing.input + (usage.output / 1000) * pricing.output;
    }
  }

  // -----------------------------------------------------------------------
  // Analytics
  // -----------------------------------------------------------------------

  /**
   * Get health statistics for a specific model.
   */
  getModelHealth(model: string): {
    model: string;
    provider: string;
    successRate: number;
    totalRequests: number;
    latency: { p50: number; p95: number; p99: number; avg: number };
    circuitState: string;
    consecutiveFailures: number;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  } {
    const state = this.getHealthState(model);
    const successes = state.history.filter((h) => h.success);
    const latencies = successes.map((h) => h.latencyMs).sort((a, b) => a - b);

    return {
      model: state.model,
      provider: state.provider,
      successRate: state.history.length > 0 ? successes.length / state.history.length : 1,
      totalRequests: state.totalRequests,
      latency: {
        p50: this.percentile(latencies, 50),
        p95: this.percentile(latencies, 95),
        p99: this.percentile(latencies, 99),
        avg: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      },
      circuitState: state.circuitState,
      consecutiveFailures: state.consecutiveFailures,
      totalCostUsd: state.totalCostUsd,
      totalInputTokens: state.totalInputTokens,
      totalOutputTokens: state.totalOutputTokens,
    };
  }

  /**
   * Get health for all tracked models.
   */
  getAllModelHealth(): ReturnType<ModelFallback["getModelHealth"]>[] {
    return [...this.healthMap.keys()].map((model) => this.getModelHealth(model));
  }

  /**
   * Reset health tracking for a model (useful after provider recovery).
   */
  resetHealth(model: string): void {
    this.healthMap.delete(model);
    logger.info(`[ModelFallback] Reset health tracking for "${model}"`);
  }

  /**
   * Reset all health tracking.
   */
  resetAllHealth(): void {
    this.healthMap.clear();
    logger.info("[ModelFallback] Reset all health tracking");
  }

  // -----------------------------------------------------------------------
  // Cost Helpers
  // -----------------------------------------------------------------------

  /**
   * Estimate cost per 1K tokens (average of input + output) for a model.
   */
  estimateCostPer1kTokens(model: string): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) return Infinity; // Unknown model — treat as expensive
    return (pricing.input + pricing.output) / 2;
  }

  /**
   * Calculate the exact cost for a given usage.
   */
  static calculateCost(
    model: string,
    usage: { input: number; output: number }
  ): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) return 0;
    return (usage.input / 1000) * pricing.input + (usage.output / 1000) * pricing.output;
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  private extractStatusCode(err: unknown): number | undefined {
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      if (typeof e.status === "number") return e.status;
      if (typeof e.statusCode === "number") return e.statusCode;
      // Check nested response
      if (e.response && typeof e.response === "object") {
        const r = e.response as Record<string, unknown>;
        if (typeof r.status === "number") return r.status;
      }
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Custom Error
// ---------------------------------------------------------------------------

export class ModelFallbackError extends Error {
  public readonly attemptLog: AttemptRecord[];
  public readonly totalLatencyMs: number;

  constructor(message: string, attemptLog: AttemptRecord[], totalLatencyMs: number) {
    super(message);
    this.name = "ModelFallbackError";
    this.attemptLog = attemptLog;
    this.totalLatencyMs = totalLatencyMs;
  }
}
