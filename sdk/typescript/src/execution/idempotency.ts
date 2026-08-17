/**
 * Idempotency Cache
 * Reference: spec/004-execution.md §Idempotency
 * 
 * :
 * idempotency_key → (execution_id, state, result, expires_at)
 * 
 * Retry Request idempotency_key :
 * - Returns execution_id
 * - side effect
 * - Returns (output if "running" if )
  */

import type { AEPError, ExecutionState } from "../core/types.js";
// (already imported above)

export interface IdempotencyEntry {
  execution_id: string;
  state: ExecutionState;
  output?: unknown;
  artifacts?: string[];
  error?: AEPError;
  expires_at: number; // epoch ms
}

export class IdempotencyCache {
  private map = new Map<string, IdempotencyEntry>();

  /**
    * key . Returns Value .
    * if ttlMs = 0entry Ends .
    */
  upsert(
    key: string,
    factory: () => IdempotencyEntry,
    ttlMs = 24 * 60 * 60 * 1000 // 24h default
  ): IdempotencyEntry {
    const existing = this.get(key);
    if (existing) return existing;

    const entry = factory();
    entry.expires_at = Date.now() + ttlMs;
    if (entry.expires_at <= Date.now()) {
      // ttl = 0 → entry 
      return entry;
    }
    this.map.set(key, entry);
    return entry;
  }

  get(key: string): IdempotencyEntry | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expires_at <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry;
  }

  /**
    * entry (e.g. after Execution).
    */
  update(key: string, patch: Partial<IdempotencyEntry>): void {
    const entry = this.map.get(key);
    if (!entry) return;
    Object.assign(entry, patch);
  }

  /**
    * .
    */
  gc(): number {
    let removed = 0;
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.expires_at < now) {
        this.map.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
    * : tests.
    */
  size(): number {
    let count = 0;
    const now = Date.now();
    for (const entry of this.map.values()) {
      if (entry.expires_at >= now) count++;
    }
    return count;
  }
}
