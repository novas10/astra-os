/**
 * AstraOS — OpenTelemetry Tracer
 * Distributed tracing with OTLP export for full observability.
 */

import { logger } from "../utils/logger";

// Span-like interface that works with or without OpenTelemetry installed
export interface AstraSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(code: "ok" | "error", message?: string): void;
  end(): void;
  addEvent(name: string, attributes?: Record<string, string | number>): void;
}

interface SpanRecord {
  name: string;
  attributes: Record<string, string | number | boolean>;
  status: { code: string; message?: string };
  events: Array<{ name: string; attributes?: Record<string, string | number>; timestamp: number }>;
  startTime: number;
  endTime?: number;
  parentName?: string;
}

class NoopSpan implements AstraSpan {
  private record: SpanRecord;

  constructor(name: string, parentName?: string) {
    this.record = {
      name,
      attributes: {},
      status: { code: "ok" },
      events: [],
      startTime: Date.now(),
      parentName,
    };
    AstraTracer.getInstance().recordSpan(this.record);
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.record.attributes[key] = value;
  }

  setStatus(code: "ok" | "error", message?: string): void {
    this.record.status = { code, message };
  }

  addEvent(name: string, attributes?: Record<string, string | number>): void {
    this.record.events.push({ name, attributes, timestamp: Date.now() });
  }

  end(): void {
    this.record.endTime = Date.now();
  }
}

export class AstraTracer {
  private static instance: AstraTracer;
  private spans: SpanRecord[] = [];
  private readonly MAX_SPANS = 10_000;
  private enabled = false;

  // Metrics counters
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  private constructor() {
    this.enabled = process.env.OTEL_ENABLED === "true" || process.env.TELEMETRY_ENABLED === "true";
    if (this.enabled) {
      logger.info("[Telemetry] AstraOS tracing enabled");
    }
  }

  static getInstance(): AstraTracer {
    if (!AstraTracer.instance) {
      AstraTracer.instance = new AstraTracer();
    }
    return AstraTracer.instance;
  }

  startSpan(name: string, parentName?: string): AstraSpan {
    return new NoopSpan(name, parentName);
  }

  recordSpan(span: SpanRecord): void {
    if (!this.enabled) return;
    this.spans.push(span);
    if (this.spans.length > this.MAX_SPANS) {
      this.spans = this.spans.slice(-this.MAX_SPANS / 2);
    }
  }

  // Counters
  incrementCounter(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) || 0) + value);
  }

  getCounter(name: string): number {
    return this.counters.get(name) || 0;
  }

  // Histograms
  recordHistogram(name: string, value: number): void {
    if (!this.histograms.has(name)) this.histograms.set(name, []);
    const values = this.histograms.get(name)!;
    values.push(value);
    if (values.length > 1000) values.splice(0, 500);
  }

  getHistogramStats(name: string): { count: number; avg: number; p50: number; p95: number; p99: number; min: number; max: number } | null {
    const values = this.histograms.get(name);
    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const avg = sorted.reduce((a, b) => a + b, 0) / count;

    return {
      count,
      avg,
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
      min: sorted[0],
      max: sorted[count - 1],
    };
  }

  // Export metrics summary
  getMetrics(): Record<string, unknown> {
    return {
      counters: Object.fromEntries(this.counters),
      histograms: Object.fromEntries(
        Array.from(this.histograms.keys()).map((k) => [k, this.getHistogramStats(k)])
      ),
      spans: {
        total: this.spans.length,
        recent: this.spans.slice(-20).map((s) => ({
          name: s.name,
          duration: s.endTime ? s.endTime - s.startTime : null,
          status: s.status.code,
          attributes: s.attributes,
        })),
      },
    };
  }

  // Get recent traces for the admin dashboard
  getRecentTraces(limit = 50): SpanRecord[] {
    return this.spans.slice(-limit);
  }

  reset(): void {
    this.spans = [];
    this.counters.clear();
    this.histograms.clear();
  }
}

// Convenience functions
export function startSpan(name: string, parentName?: string): AstraSpan {
  return AstraTracer.getInstance().startSpan(name, parentName);
}

export function incrementCounter(name: string, value = 1): void {
  AstraTracer.getInstance().incrementCounter(name, value);
}

export function recordLatency(name: string, startTime: number): void {
  AstraTracer.getInstance().recordHistogram(name, Date.now() - startTime);
}
