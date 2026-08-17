/**
 * Reference Provider Suite — for testing the runtime.
 * Reference: AEP_10_10 §125 Reference Provider Suite
 * 
 * Providers: echo, sleep, fail, retry, stream, artifact, side_effect, non_idempotent, idempotent
  */

import type { CapabilityDefinition } from "../../server.js";
import { randomUUID } from "node:crypto";

// Track side effects for testing
const sideEffects = new Map<string, number>();

export const echo: CapabilityDefinition = {
  id: "ref.echo",
  version: "1.0.0",
  kind: "read",
  description: "Echo input back",
  input: { schema: { type: "object", properties: { message: { type: "string" } } } },
  output: { schema: { type: "object", properties: { echoed: { type: "string" } } } },
  execution: { sync: true, async: false, streaming: false, cancel: false, retry: true, idempotent: true, dry_run: false },
  risk: { level: "low", side_effect: false, reversible: true },
  authorization: { scopes: [] },
  execute: async ({ input }: { input: unknown }) => {
    const { message = "hello" } = (input as { message?: string }) || {};
    return { output: { echoed: message } };
  },
};

export const sleep: CapabilityDefinition = {
  id: "ref.sleep",
  version: "1.0.0",
  kind: "action",
  description: "Sleep for N milliseconds (for timeout/cancel testing)",
  input: { schema: { type: "object", required: ["ms"], properties: { ms: { type: "integer", minimum: 1 } } } },
  output: { schema: { type: "object", properties: { slept_ms: { type: "integer" } } } },
  execution: { sync: true, async: true, streaming: false, cancel: true, retry: false, idempotent: true, dry_run: false },
  risk: { level: "low", side_effect: false, reversible: true },
  authorization: { scopes: [] },
  execute: async ({ input, signal }: { input: unknown; signal?: any }) => {
    const { ms } = input as { ms: number };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ output: { slept_ms: ms } }), ms);
      if (signal?.onCancel) {
        signal.onCancel(() => {
          clearTimeout(timer);
          reject({ code: "EXECUTION_CANCELLED", message: "cancelled during sleep", retryable: false });
        });
      }
    });
  },
};

export const fail: CapabilityDefinition = {
  id: "ref.fail",
  version: "1.0.0",
  kind: "action",
  description: "Always fails with a specified error code",
  input: { schema: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } },
  output: { schema: { type: "object" } },
  execution: { sync: true, async: false, streaming: false, cancel: false, retry: false, idempotent: true, dry_run: false },
  risk: { level: "low", side_effect: false, reversible: true },
  authorization: { scopes: [] },
  execute: async ({ input }: { input: unknown }) => {
    const { code = "INTERNAL_ERROR", message = "intentional failure" } = (input as { code?: string; message?: string }) || {};
    throw { code, message, retryable: false };
  },
};

export const retryable: CapabilityDefinition = {
  id: "ref.retryable",
  version: "1.0.0",
  kind: "action",
  description: "Fails N times then succeeds (for retry testing)",
  input: { schema: { type: "object", properties: { fail_times: { type: "integer", default: 2 } } } },
  output: { schema: { type: "object", properties: { attempts: { type: "integer" } } } },
  execution: { sync: true, async: false, streaming: false, cancel: false, retry: true, idempotent: true, dry_run: false },
  risk: { level: "low", side_effect: false, reversible: true },
  authorization: { scopes: [] },
  execute: async ({ input }: { input: unknown }) => {
    const { fail_times = 2 } = (input as { fail_times?: number }) || {};
    const key = randomUUID();
    const current = (sideEffects.get(key) || 0) + 1;
    sideEffects.set(key, current);
    if (current <= fail_times) {
      throw { code: "PROVIDER_UNAVAILABLE", message: `attempt ${current} of ${fail_times}`, retryable: true };
    }
    return { output: { attempts: current } };
  },
};

export const sideEffect: CapabilityDefinition = {
  id: "ref.side_effect",
  version: "1.0.0",
  kind: "action",
  description: "Records a side effect (for idempotency/budget testing)",
  input: { schema: { type: "object", required: ["key"], properties: { key: { type: "string" }, value: { type: "string" } } } },
  output: { schema: { type: "object", properties: { key: { type: "string" }, count: { type: "integer" } } } },
  execution: { sync: true, async: true, streaming: false, cancel: true, retry: true, idempotent: true, dry_run: true },
  risk: { level: "medium", side_effect: true, reversible: true, blast_radius: "single_record" },
  authorization: { scopes: ["ref.side_effect.write"] },
  execute: async ({ input, dry_run }: { input: unknown; dry_run?: boolean }) => {
    const { key, value = "default" } = (input as { key: string; value?: string }) || {};
    if (dry_run) {
      return { output: { key, would_change: true, estimated_cost: 0.001 } };
    }
    const count = (sideEffects.get(key) || 0) + 1;
    sideEffects.set(key, count);
    return { output: { key, count }, cost_usd: 0.001 };
  },
};

export const nonIdempotent: CapabilityDefinition = {
  id: "ref.non_idempotent",
  version: "1.0.0",
  kind: "action",
  description: "Non-idempotent side effect (retry should be blocked without idempotency key)",
  input: { schema: { type: "object", required: ["key"], properties: { key: { type: "string" } } } },
  output: { schema: { type: "object", properties: { key: { type: "string" }, count: { type: "integer" } } } },
  execution: { sync: true, async: false, streaming: false, cancel: false, retry: false, idempotent: false, dry_run: false },
  risk: { level: "high", side_effect: true, reversible: false, blast_radius: "single_record" },
  authorization: { scopes: ["ref.non_idempotent.write"] },
  execute: async ({ input }: { input: unknown }) => {
    const { key } = input as { key: string };
    const count = (sideEffects.get(key) || 0) + 1;
    sideEffects.set(key, count);
    return { output: { key, count }, cost_usd: 0.01 };
  },
};

export const stream: CapabilityDefinition = {
  id: "ref.stream",
  version: "1.0.0",
  kind: "stream",
  description: "Stream N events (for streaming testing)",
  input: { schema: { type: "object", properties: { count: { type: "integer", default: 5 } } } },
  output: { schema: { type: "object", properties: { events: { type: "array" } } } },
  execution: { sync: false, async: true, streaming: true, cancel: true, retry: false, idempotent: true, dry_run: false },
  risk: { level: "low", side_effect: false, reversible: true },
  authorization: { scopes: [] },
  execute: async ({ input, emit }: any) => {
    const { count = 5 } = input as { count?: number };
    for (let i = 0; i < count; i++) {
      if (emit) emit("progress", { index: i, total: count });
      await new Promise((r) => setTimeout(r, 10));
    }
    return { output: { events: count } };
  },
};

export const artifact: CapabilityDefinition = {
  id: "ref.artifact",
  version: "1.0.0",
  kind: "artifact",
  description: "Creates an artifact (for artifact testing)",
  input: { schema: { type: "object", properties: { size: { type: "integer", default: 1024 } } } },
  output: { schema: { type: "object", properties: { artifact_id: { type: "string" }, size: { type: "integer" } } } },
  execution: { sync: true, async: true, streaming: false, cancel: false, retry: true, idempotent: true, dry_run: false },
  risk: { level: "low", side_effect: true, reversible: true },
  authorization: { scopes: ["ref.artifact.write"] },
  execute: async ({ input }: any) => {
    const { size = 1024 } = input || {};
    const data = Buffer.alloc(size, 0x41); // 'A'
    return { output: { artifact_id: `art_${randomUUID().slice(0, 8)}`, size }, artifacts: [`art_${randomUUID().slice(0, 8)}`] };
  },
};

// ============================================================================
// Export all reference providers
// ============================================================================

export const REFERENCE_PROVIDERS: CapabilityDefinition[] = [
  echo,
  sleep,
  fail,
  retryable,
  sideEffect,
  nonIdempotent,
  stream,
  artifact,
];

/**
 * Reset side effect counters (for test isolation).
  */
export function resetSideEffects(): void {
  sideEffects.clear();
}

/**
 * Get side effect count for a key.
  */
export function getSideEffectCount(key: string): number {
  return sideEffects.get(key) || 0;
}
