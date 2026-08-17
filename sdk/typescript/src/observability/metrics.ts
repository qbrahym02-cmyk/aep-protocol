/**
 * Metrics & Monitoring — Prometheus-style metrics
 * Reference: spec/10-10 §64 MetricsAEP_CODE_FIRST_AUDIT.md §6
 * 
 * Minimum required metrics:
 * aep_execution_total
 * aep_execution_duration
 * aep_execution_failures
 * aep_retry_total
 * aep_policy_denials
 * aep_authorization_denials
 * aep_budget_exceeded
 * aep_provider_latency
 * aep_provider_errors
 * aep_idempotency_hits
  */

import { createHash } from "node:crypto";

// ============================================================================
// Counter
// ============================================================================

export class Counter {
  private value = 0;
  private labels = new Map<string, number>();

  constructor(public name: string, public help: string) {}

  inc(labels: Record<string, string> = {}, value: number = 1): void {
    this.value += value;
    const key = this.labelKey(labels);
    this.labels.set(key, (this.labels.get(key) || 0) + value);
  }

  get(): number {
    return this.value;
  }

  getLabels(labels: Record<string, string>): number {
    return this.labels.get(this.labelKey(labels)) || 0;
  }

  private labelKey(labels: Record<string, string>): string {
    const keys = Object.keys(labels).sort();
    return keys.map((k) => `${k}="${labels[k]}"`).join(",");
  }

  prometheus(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.labels.size === 0) {
      lines.push(`${this.name} ${this.value}`);
    } else {
      for (const [key, value] of this.labels) {
        lines.push(`${this.name}{${key}} ${value}`);
      }
    }
    return lines.join("\n");
  }
}

// ============================================================================
// Histogram (for durations)
// ============================================================================

export class Histogram {
  private buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
  private counts: number[];
  private sum = 0;
  private total = 0;
  private byLabels = new Map<string, { counts: number[]; sum: number; total: number }>();

  constructor(public name: string, public help: string, buckets?: number[]) {
    if (buckets) this.buckets = buckets;
    this.counts = new Array(this.buckets.length + 1).fill(0);
  }

  observe(value: number, labels: Record<string, string> = {}): void {
    this.sum += value;
    this.total++;
    let bucketIdx = this.buckets.findIndex((b) => value <= b);
    if (bucketIdx === -1) bucketIdx = this.buckets.length;
    this.counts[bucketIdx]++;

    if (Object.keys(labels).length > 0) {
      const key = this.labelKey(labels);
      let entry = this.byLabels.get(key);
      if (!entry) {
        entry = { counts: new Array(this.buckets.length + 1).fill(0), sum: 0, total: 0 };
        this.byLabels.set(key, entry);
      }
      entry.sum += value;
      entry.total++;
      entry.counts[bucketIdx]++;
    }
  }

  prometheus(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    let cumulative = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      cumulative += this.counts[i];
      lines.push(`${this.name}_bucket{le="${this.buckets[i]}"} ${cumulative}`);
    }
    cumulative += this.counts[this.buckets.length];
    lines.push(`${this.name}_bucket{le="+Inf"} ${cumulative}`);
    lines.push(`${this.name}_sum ${this.sum}`);
    lines.push(`${this.name}_count ${this.total}`);
    return lines.join("\n");
  }

  private labelKey(labels: Record<string, string>): string {
    const keys = Object.keys(labels).sort();
    return keys.map((k) => `${k}="${labels[k]}"`).join(",");
  }
}

// ============================================================================
// Gauge
// ============================================================================

export class Gauge {
  private value = 0;
  private byLabels = new Map<string, number>();

  constructor(public name: string, public help: string) {}

  set(value: number, labels: Record<string, string> = {}): void {
    if (Object.keys(labels).length === 0) {
      this.value = value;
    } else {
      this.byLabels.set(this.labelKey(labels), value);
    }
  }

  inc(value: number = 1, labels: Record<string, string> = {}): void {
    if (Object.keys(labels).length === 0) {
      this.value += value;
    } else {
      const key = this.labelKey(labels);
      this.byLabels.set(key, (this.byLabels.get(key) || 0) + value);
    }
  }

  dec(value: number = 1, labels: Record<string, string> = {}): void {
    this.inc(-value, labels);
  }

  prometheus(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    if (this.byLabels.size === 0) {
      lines.push(`${this.name} ${this.value}`);
    } else {
      for (const [key, value] of this.byLabels) {
        lines.push(`${this.name}{${key}} ${value}`);
      }
    }
    return lines.join("\n");
  }

  private labelKey(labels: Record<string, string>): string {
    const keys = Object.keys(labels).sort();
    return keys.map((k) => `${k}="${labels[k]}"`).join(",");
  }
}

// ============================================================================
// Metrics Registry
// ============================================================================

export class MetricsRegistry {
  counters = new Map<string, Counter>();
  histograms = new Map<string, Histogram>();
  gauges = new Map<string, Gauge>();

  counter(name: string, help: string): Counter {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter(name, help);
      this.counters.set(name, c);
    }
    return c;
  }

  histogram(name: string, help: string, buckets?: number[]): Histogram {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(name, help, buckets);
      this.histograms.set(name, h);
    }
    return h;
  }

  gauge(name: string, help: string): Gauge {
    let g = this.gauges.get(name);
    if (!g) {
      g = new Gauge(name, help);
      this.gauges.set(name, g);
    }
    return g;
  }

  prometheus(): string {
    const parts: string[] = [];
    for (const c of this.counters.values()) parts.push(c.prometheus());
    for (const h of this.histograms.values()) parts.push(h.prometheus());
    for (const g of this.gauges.values()) parts.push(g.prometheus());
    return parts.join("\n\n");
  }

  /**
    * Reset all metrics (for testing).
    */
  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }
}

// ============================================================================
// Default AEP Metrics
// ============================================================================

export class AepMetrics {
  constructor(public registry: MetricsRegistry = new MetricsRegistry()) {
    this.init();
  }

  // Counters
  execution_total!: Counter;
  execution_failures!: Counter;
  retry_total!: Counter;
  policy_denials!: Counter;
  authorization_denials!: Counter;
  budget_exceeded!: Counter;
  provider_errors!: Counter;
  idempotency_hits!: Counter;
  authentication_failures!: Counter;
  rate_limited!: Counter;
  timeout_total!: Counter;
  cancellation_total!: Counter;
  approval_requested!: Counter;
  approval_granted!: Counter;
  approval_rejected!: Counter;

  // Histograms
  execution_duration!: Histogram;
  provider_latency!: Histogram;
  request_size_bytes!: Histogram;
  response_size_bytes!: Histogram;

  // Gauges
  active_executions!: Gauge;
  pending_approvals!: Gauge;
  rate_limit_buckets!: Gauge;

  private init(): void {
    this.execution_total = this.registry.counter("aep_execution_total", "Total executions started");
    this.execution_failures = this.registry.counter("aep_execution_failures", "Total executions failed");
    this.retry_total = this.registry.counter("aep_retry_total", "Total retry attempts");
    this.policy_denials = this.registry.counter("aep_policy_denials", "Policy denials");
    this.authorization_denials = this.registry.counter("aep_authorization_denials", "Authorization denials");
    this.budget_exceeded = this.registry.counter("aep_budget_exceeded", "Budget exceeded");
    this.provider_errors = this.registry.counter("aep_provider_errors", "Provider errors");
    this.idempotency_hits = this.registry.counter("aep_idempotency_hits", "Idempotency cache hits");
    this.authentication_failures = this.registry.counter("aep_authentication_failures", "Authentication failures");
    this.rate_limited = this.registry.counter("aep_rate_limited", "Requests rate limited");
    this.timeout_total = this.registry.counter("aep_timeout_total", "Execution timeouts");
    this.cancellation_total = this.registry.counter("aep_cancellation_total", "Cancellations");
    this.approval_requested = this.registry.counter("aep_approval_requested", "Approvals requested");
    this.approval_granted = this.registry.counter("aep_approval_granted", "Approvals granted");
    this.approval_rejected = this.registry.counter("aep_approval_rejected", "Approvals rejected");

    this.execution_duration = this.registry.histogram(
      "aep_execution_duration_seconds",
      "Execution duration in seconds",
      [0.001, 0.01, 0.1, 0.5, 1, 5, 10, 30, 60, 300]
    );
    this.provider_latency = this.registry.histogram(
      "aep_provider_latency_seconds",
      "Provider latency in seconds",
      [0.001, 0.01, 0.1, 0.5, 1, 5, 10, 30]
    );
    this.request_size_bytes = this.registry.histogram(
      "aep_request_size_bytes",
      "Request body size",
      [100, 1000, 10000, 100000, 1000000]
    );
    this.response_size_bytes = this.registry.histogram(
      "aep_response_size_bytes",
      "Response body size",
      [100, 1000, 10000, 100000, 1000000]
    );

    this.active_executions = this.registry.gauge("aep_active_executions", "Currently active executions");
    this.pending_approvals = this.registry.gauge("aep_pending_approvals", "Pending approval requests");
    this.rate_limit_buckets = this.registry.gauge("aep_rate_limit_buckets", "Active rate limit buckets");
  }

  /**
    * Snapshot for /metrics endpoint.
    */
  snapshot(): string {
    return this.registry.prometheus();
  }
}
