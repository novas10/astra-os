/**
 * AstraOS — BudgetManager.ts
 * Token budget management: per-user, per-tenant, per-session usage tracking,
 * daily/monthly limits, cost calculation, budget alerts, and usage analytics.
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";
import { MODEL_PRICING } from "./ModelFallback";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetLimit {
  /** Maximum tokens allowed in the period. 0 = unlimited. */
  maxTokens: number;
  /** Maximum cost in USD allowed in the period. 0 = unlimited. */
  maxCostUsd: number;
  /** Period for the limit. */
  period: "daily" | "monthly";
}

export interface UsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: number;
  sessionId?: string;
}

export interface BudgetAccount {
  id: string;
  type: "user" | "tenant" | "session";
  limits: BudgetLimit[];
  usage: UsageRecord[];
  /** Alert thresholds that have already been fired (avoid duplicate alerts). */
  firedAlerts: Set<string>;
  createdAt: number;
}

export interface BudgetAlert {
  accountId: string;
  accountType: "user" | "tenant" | "session";
  threshold: number; // 0.8, 0.9, 1.0
  period: "daily" | "monthly";
  resource: "tokens" | "cost";
  currentValue: number;
  limitValue: number;
  timestamp: number;
}

export interface UsageSummary {
  accountId: string;
  period: "daily" | "monthly" | "all-time";
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
  byModel: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      requests: number;
    }
  >;
  periodStart: number;
  periodEnd: number;
}

export type BudgetAlertCallback = (alert: BudgetAlert) => void;

// ---------------------------------------------------------------------------
// Alert Thresholds
// ---------------------------------------------------------------------------

const ALERT_THRESHOLDS = [0.8, 0.9, 1.0];

// ---------------------------------------------------------------------------
// BudgetManager
// ---------------------------------------------------------------------------

export class BudgetManager {
  private accounts: Map<string, BudgetAccount> = new Map();
  private alertCallbacks: BudgetAlertCallback[] = [];
  private persistDir: string;

  constructor(persistDir?: string) {
    this.persistDir = persistDir ?? path.join(process.cwd(), ".astra-data", "budgets");
  }

  // -----------------------------------------------------------------------
  // Initialization / Persistence
  // -----------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.persistDir)) {
      fs.mkdirSync(this.persistDir, { recursive: true });
    }

    // Load persisted accounts
    try {
      const files = fs.readdirSync(this.persistDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const raw = fs.readFileSync(path.join(this.persistDir, file), "utf-8");
        const data = JSON.parse(raw) as {
          id: string;
          type: string;
          limits: BudgetLimit[];
          usage: UsageRecord[];
          firedAlerts: string[];
          createdAt: number;
        };
        this.accounts.set(data.id, {
          ...data,
          type: data.type as BudgetAccount["type"],
          firedAlerts: new Set(data.firedAlerts ?? []),
        });
      }
      logger.info(`[BudgetManager] Loaded ${files.length} budget account(s)`);
    } catch (err) {
      logger.warn(`[BudgetManager] Could not load persisted budgets: ${err}`);
    }
  }

  private persist(account: BudgetAccount): void {
    try {
      const filePath = path.join(this.persistDir, `${account.id}.json`);
      const data = {
        ...account,
        firedAlerts: [...account.firedAlerts],
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      logger.error(`[BudgetManager] Failed to persist account "${account.id}": ${err}`);
    }
  }

  // -----------------------------------------------------------------------
  // Account Management
  // -----------------------------------------------------------------------

  /**
   * Create or update a budget account with the given limits.
   */
  setLimits(
    id: string,
    type: BudgetAccount["type"],
    limits: BudgetLimit[]
  ): void {
    let account = this.accounts.get(id);
    if (!account) {
      account = {
        id,
        type,
        limits,
        usage: [],
        firedAlerts: new Set(),
        createdAt: Date.now(),
      };
      this.accounts.set(id, account);
    } else {
      account.limits = limits;
    }
    this.persist(account);
    logger.info(`[BudgetManager] Set limits for ${type} "${id}": ${JSON.stringify(limits)}`);
  }

  /**
   * Get an account. Creates a no-limit account if it doesn't exist.
   */
  getAccount(id: string, type: BudgetAccount["type"] = "user"): BudgetAccount {
    if (!this.accounts.has(id)) {
      const account: BudgetAccount = {
        id,
        type,
        limits: [],
        usage: [],
        firedAlerts: new Set(),
        createdAt: Date.now(),
      };
      this.accounts.set(id, account);
    }
    return this.accounts.get(id)!;
  }

  // -----------------------------------------------------------------------
  // Usage Recording
  // -----------------------------------------------------------------------

  /**
   * Record token usage for an account. Calculates cost automatically.
   * Returns { allowed: true } if within limits, or { allowed: false, reason } if over budget.
   */
  recordUsage(
    accountId: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    sessionId?: string
  ): { allowed: boolean; reason?: string; costUsd: number } {
    const account = this.getAccount(accountId);
    const costUsd = BudgetManager.calculateCost(model, inputTokens, outputTokens);

    // Check limits BEFORE recording
    const budgetCheck = this.checkBudget(account, inputTokens + outputTokens, costUsd);
    if (!budgetCheck.allowed) {
      return { allowed: false, reason: budgetCheck.reason, costUsd };
    }

    const record: UsageRecord = {
      model,
      inputTokens,
      outputTokens,
      costUsd,
      timestamp: Date.now(),
      sessionId,
    };

    account.usage.push(record);

    // Prune old records (keep last 90 days)
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    account.usage = account.usage.filter((u) => u.timestamp > cutoff);

    // Check alert thresholds
    this.checkAlerts(account);

    // Persist periodically (every 10 records to avoid excessive I/O)
    if (account.usage.length % 10 === 0) {
      this.persist(account);
    }

    return { allowed: true, costUsd };
  }

  /**
   * Pre-flight check: will the given usage exceed any budget?
   */
  canSpend(
    accountId: string,
    estimatedTokens: number,
    estimatedCostUsd: number
  ): { allowed: boolean; reason?: string } {
    const account = this.accounts.get(accountId);
    if (!account) return { allowed: true };
    return this.checkBudget(account, estimatedTokens, estimatedCostUsd);
  }

  private checkBudget(
    account: BudgetAccount,
    additionalTokens: number,
    additionalCostUsd: number
  ): { allowed: boolean; reason?: string } {
    for (const limit of account.limits) {
      const periodUsage = this.getUsageInPeriod(account, limit.period);

      if (limit.maxTokens > 0) {
        const currentTokens = periodUsage.totalTokens + additionalTokens;
        if (currentTokens > limit.maxTokens) {
          return {
            allowed: false,
            reason:
              `${limit.period} token limit exceeded: ${currentTokens}/${limit.maxTokens} tokens`,
          };
        }
      }

      if (limit.maxCostUsd > 0) {
        const currentCost = periodUsage.totalCostUsd + additionalCostUsd;
        if (currentCost > limit.maxCostUsd) {
          return {
            allowed: false,
            reason:
              `${limit.period} cost limit exceeded: $${currentCost.toFixed(4)}/$${limit.maxCostUsd.toFixed(2)}`,
          };
        }
      }
    }

    return { allowed: true };
  }

  // -----------------------------------------------------------------------
  // Alert System
  // -----------------------------------------------------------------------

  onAlert(callback: BudgetAlertCallback): () => void {
    this.alertCallbacks.push(callback);
    return () => {
      this.alertCallbacks = this.alertCallbacks.filter((cb) => cb !== callback);
    };
  }

  private checkAlerts(account: BudgetAccount): void {
    for (const limit of account.limits) {
      const periodUsage = this.getUsageInPeriod(account, limit.period);

      for (const threshold of ALERT_THRESHOLDS) {
        // Token threshold
        if (limit.maxTokens > 0) {
          const ratio = periodUsage.totalTokens / limit.maxTokens;
          const alertKey = `${limit.period}:tokens:${threshold}:${this.getPeriodKey(limit.period)}`;

          if (ratio >= threshold && !account.firedAlerts.has(alertKey)) {
            account.firedAlerts.add(alertKey);
            this.fireAlert({
              accountId: account.id,
              accountType: account.type,
              threshold,
              period: limit.period,
              resource: "tokens",
              currentValue: periodUsage.totalTokens,
              limitValue: limit.maxTokens,
              timestamp: Date.now(),
            });
          }
        }

        // Cost threshold
        if (limit.maxCostUsd > 0) {
          const ratio = periodUsage.totalCostUsd / limit.maxCostUsd;
          const alertKey = `${limit.period}:cost:${threshold}:${this.getPeriodKey(limit.period)}`;

          if (ratio >= threshold && !account.firedAlerts.has(alertKey)) {
            account.firedAlerts.add(alertKey);
            this.fireAlert({
              accountId: account.id,
              accountType: account.type,
              threshold,
              period: limit.period,
              resource: "cost",
              currentValue: periodUsage.totalCostUsd,
              limitValue: limit.maxCostUsd,
              timestamp: Date.now(),
            });
          }
        }
      }
    }
  }

  private fireAlert(alert: BudgetAlert): void {
    const pct = Math.round(alert.threshold * 100);
    const valueStr =
      alert.resource === "cost"
        ? `$${alert.currentValue.toFixed(4)}/$${alert.limitValue.toFixed(2)}`
        : `${alert.currentValue}/${alert.limitValue}`;

    logger.warn(
      `[BudgetManager] ALERT: ${alert.accountType} "${alert.accountId}" reached ${pct}% of ` +
        `${alert.period} ${alert.resource} limit (${valueStr})`
    );

    for (const cb of this.alertCallbacks) {
      try {
        cb(alert);
      } catch (err) {
        logger.error(`[BudgetManager] Alert callback error: ${err}`);
      }
    }
  }

  private getPeriodKey(period: "daily" | "monthly"): string {
    const now = new Date();
    if (period === "daily") {
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  // -----------------------------------------------------------------------
  // Usage Analytics
  // -----------------------------------------------------------------------

  /**
   * Get a usage summary for an account over a specific period.
   */
  getUsageSummary(
    accountId: string,
    period: "daily" | "monthly" | "all-time" = "monthly"
  ): UsageSummary {
    const account = this.getAccount(accountId);
    const periodInfo = this.getUsageInPeriod(account, period === "all-time" ? undefined : period);

    return {
      accountId,
      period,
      ...periodInfo,
    };
  }

  private getUsageInPeriod(
    account: BudgetAccount,
    period?: "daily" | "monthly"
  ): {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    requestCount: number;
    byModel: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
    periodStart: number;
    periodEnd: number;
  } {
    const now = new Date();
    let periodStart: number;
    const periodEnd = now.getTime();

    if (period === "daily") {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      periodStart = dayStart.getTime();
    } else if (period === "monthly") {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodStart = monthStart.getTime();
    } else {
      periodStart = 0; // all-time
    }

    const records = account.usage.filter(
      (u) => u.timestamp >= periodStart && u.timestamp <= periodEnd
    );

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;
    const byModel: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }> = {};

    for (const r of records) {
      totalInputTokens += r.inputTokens;
      totalOutputTokens += r.outputTokens;
      totalCostUsd += r.costUsd;

      if (!byModel[r.model]) {
        byModel[r.model] = { inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 };
      }
      byModel[r.model].inputTokens += r.inputTokens;
      byModel[r.model].outputTokens += r.outputTokens;
      byModel[r.model].costUsd += r.costUsd;
      byModel[r.model].requests++;
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCostUsd,
      requestCount: records.length,
      byModel,
      periodStart,
      periodEnd,
    };
  }

  /**
   * Export usage analytics for all accounts in a structured format.
   */
  exportAnalytics(): Array<{
    accountId: string;
    type: string;
    daily: UsageSummary;
    monthly: UsageSummary;
    allTime: UsageSummary;
    limits: BudgetLimit[];
  }> {
    const results: Array<{
      accountId: string;
      type: string;
      daily: UsageSummary;
      monthly: UsageSummary;
      allTime: UsageSummary;
      limits: BudgetLimit[];
    }> = [];

    for (const account of this.accounts.values()) {
      results.push({
        accountId: account.id,
        type: account.type,
        daily: this.getUsageSummary(account.id, "daily"),
        monthly: this.getUsageSummary(account.id, "monthly"),
        allTime: this.getUsageSummary(account.id, "all-time"),
        limits: account.limits,
      });
    }

    return results;
  }

  /**
   * Get leaderboard: top spenders by cost.
   */
  getTopSpenders(
    period: "daily" | "monthly" = "monthly",
    limit: number = 10
  ): Array<{ accountId: string; type: string; totalCostUsd: number; totalTokens: number }> {
    const entries: Array<{
      accountId: string;
      type: string;
      totalCostUsd: number;
      totalTokens: number;
    }> = [];

    for (const account of this.accounts.values()) {
      const usage = this.getUsageInPeriod(account, period);
      entries.push({
        accountId: account.id,
        type: account.type,
        totalCostUsd: usage.totalCostUsd,
        totalTokens: usage.totalTokens,
      });
    }

    return entries.sort((a, b) => b.totalCostUsd - a.totalCostUsd).slice(0, limit);
  }

  // -----------------------------------------------------------------------
  // Cost Calculation (Static)
  // -----------------------------------------------------------------------

  /**
   * Calculate cost for a model/usage pair.
   */
  static calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) return 0;
    return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
  }

  /**
   * Get pricing info for all known models.
   */
  static getAllPricing(): Record<string, { input: number; output: number }> {
    return { ...MODEL_PRICING };
  }

  /**
   * Estimate cost for a prompt before sending.
   * Rough token count: ~4 chars per token.
   */
  static estimateCost(model: string, promptChars: number, maxOutputTokens: number): number {
    const estimatedInputTokens = Math.ceil(promptChars / 4);
    return BudgetManager.calculateCost(model, estimatedInputTokens, maxOutputTokens);
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Reset fired alerts for the current period (call at midnight / month boundary).
   */
  resetPeriodAlerts(period: "daily" | "monthly"): void {
    const periodKey = this.getPeriodKey(period);
    for (const account of this.accounts.values()) {
      const toRemove: string[] = [];
      for (const alertKey of account.firedAlerts) {
        if (alertKey.startsWith(`${period}:`) && !alertKey.endsWith(periodKey)) {
          toRemove.push(alertKey);
        }
      }
      for (const key of toRemove) {
        account.firedAlerts.delete(key);
      }
    }
    logger.info(`[BudgetManager] Reset ${period} alerts for new period`);
  }

  /**
   * Persist all accounts to disk.
   */
  async flush(): Promise<void> {
    for (const account of this.accounts.values()) {
      this.persist(account);
    }
    logger.info(`[BudgetManager] Flushed ${this.accounts.size} account(s) to disk`);
  }
}
