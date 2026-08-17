/**
 * Performance Benchmark — Measures execution overhead of the AEP pipeline.
 * 
 * Compares:
 *   1. Direct function call (baseline)
 *   2. AEP execution (full pipeline: auth → authority → policy → risk → execute → receipt → audit)
 * 
 * Metrics:
 *   - p50, p95, p99 latency
 *   - overhead percentage
 *   - throughput (ops/sec)
 */

import { AEPServer } from "../server.js";
import { BUILTIN_CAPABILITIES } from "../providers/builtin.js";

interface BenchmarkResult {
  name: string;
  iterations: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  mean_ms: number;
  ops_per_sec: number;
}

async function benchmark(
  name: string,
  fn: () => Promise<void>,
  iterations: number = 1000,
  warmup: number = 50
): Promise<BenchmarkResult> {
  // Warmup
  for (let i = 0; i < warmup; i++) await fn();

  // Measure
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(iterations * 0.5)];
  const p95 = times[Math.floor(iterations * 0.95)];
  const p99 = times[Math.floor(iterations * 0.99)];
  const mean = times.reduce((a, b) => a + b, 0) / iterations;
  const opsPerSec = Math.round(1000 / mean);

  return {
    name,
    iterations,
    p50_ms: Math.round(p50 * 100) / 100,
    p95_ms: Math.round(p95 * 100) / 100,
    p99_ms: Math.round(p99 * 100) / 100,
    mean_ms: Math.round(mean * 100) / 100,
    ops_per_sec: opsPerSec,
  };
}

export async function runBenchmark(): Promise<void> {
  console.log("AEP Performance Benchmark\n");
  console.log("=".repeat(60));

  // Setup
  const server = new AEPServer({ environment: "test" });
  for (const cap of BUILTIN_CAPABILITIES) server.capability(cap);

  const input = { a: 2, b: 3 };

  // 1. Baseline: direct function call
  const directFn = BUILTIN_CAPABILITIES[0].execute;
  const baseline = await benchmark(
    "Direct function call (baseline)",
    async () => {
      const ctx = {
        execution_id: "bench",
        request_id: "bench",
        principal: { type: "user" as const, id: "bench" },
        capability: {} as any,
        input,
        signal: { cancelled: false, onCancel: () => {} },
        emit: () => {},
      };
      await directFn(ctx as any);
    },
    5000
  );

  // 2. AEP full pipeline
  const aepResult = await benchmark(
    "AEP full pipeline (auth → authority → policy → risk → execute → receipt → audit)",
    async () => {
      await server.execute({
        aep: "0.1",
        id: `bench_${Math.random()}`,
        type: "execute",
        principal: { type: "user", id: "bench-user" },
        authorization: { bearer_token: "test-token:bench-user" },
        capability: { id: "math.add" },
        input,
        execution: { mode: "sync" },
      } as any);
    },
    1000
  );

  // 3. AEP with idempotency key
  const idemKey = `bench_idem_${Date.now()}`;
  const aepIdemFirst = await benchmark(
    "AEP with idempotency (first call)",
    async () => {
      await server.execute({
        aep: "0.1",
        id: `bench_idem_${Math.random()}`,
        type: "execute",
        principal: { type: "user", id: "bench-user" },
        authorization: { bearer_token: "test-token:bench-user" },
        capability: { id: "math.add" },
        input,
        execution: { mode: "sync", idempotency_key: `key_${Math.random()}` },
      } as any);
    },
    500
  );

  // Results
  console.log("\nResults:\n");
  console.log(
    "| Benchmark | Iterations | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Ops/sec |"
  );
  console.log("|-----------|------------|----------|----------|----------|-----------|---------|");

  for (const r of [baseline, aepResult, aepIdemFirst]) {
    console.log(
      `| ${r.name} | ${r.iterations} | ${r.p50_ms} | ${r.p95_ms} | ${r.p99_ms} | ${r.mean_ms} | ${r.ops_per_sec} |`
    );
  }

  // Overhead calculation
  const overhead = ((aepResult.mean_ms - baseline.mean_ms) / baseline.mean_ms) * 100;
  console.log(`\nAEP pipeline overhead: ${overhead.toFixed(1)}% (${(aepResult.mean_ms - baseline.mean_ms).toFixed(2)}ms per execution)`);
  console.log(`AEP throughput: ${aepResult.ops_per_sec} ops/sec`);
  console.log(`\nPerformance targets (spec/10-10 §80):`);
  console.log(`  Core validation p95 < 5ms: ${aepResult.p95_ms < 5 ? "PASS" : `FAIL (${aepResult.p95_ms}ms)`}`);
  console.log(`  Local execution overhead p95 < 10ms: ${aepResult.p95_ms < 10 ? "PASS" : `FAIL (${aepResult.p95_ms}ms)`}`);
}

// Run if called directly
if (require.main === module) {
  runBenchmark().catch(console.error);
}
