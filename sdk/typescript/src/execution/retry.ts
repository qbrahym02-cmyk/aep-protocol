/**
 * Retry Policy
 * Reference: spec/10-10 §18 Retry§19 Retry Safety
 * 
 * Strategies:
 * - fixed
 * - exponential
 * - decorrelated_jitter (recommended by AWS)
 * 
 * Safety rules:
 * - retry side-effect idempotent without idempotency_key
 * - retry errors retryable
 * - max_attempts 
 * - 
  */

import type { AEPError } from "../core/types.js";

export interface RetryPolicy {
  enabled: boolean;
  max_attempts: number;                  // total attempts (1 = no retry)
  backoff: "fixed" | "exponential" | "decorrelated_jitter";
  initial_delay_ms: number;
  max_delay_ms: number;
  retryable_errors: string[];            // AEPError.code values (as strings for flexibility)
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  enabled: false,
  max_attempts: 1,
  backoff: "exponential",
  initial_delay_ms: 500,
  max_delay_ms: 30_000,
  retryable_errors: ["TIMEOUT", "RATE_LIMITED", "PROVIDER_UNAVAILABLE"],
};

export interface RetryAttempt {
  attempt: number;
  delay_ms: number;
  error?: AEPError;
  reason?: string;
}

/**
 * delay .
 * attempt: 1 = first retry (after first failure)
  */
export function computeDelay(policy: RetryPolicy, attempt: number, previousDelay?: number): number {
  switch (policy.backoff) {
    case "fixed":
      return Math.min(policy.max_delay_ms, policy.initial_delay_ms);

    case "exponential": {
      const delay = policy.initial_delay_ms * Math.pow(2, attempt - 1);
      return Math.min(policy.max_delay_ms, delay);
    }

    case "decorrelated_jitter": {
      // AWS recommended: delay = min(cap, rand * 3 * prev)
      const prev = previousDelay ?? policy.initial_delay_ms;
      const jitter = Math.random() * 3 * prev;
      return Math.min(policy.max_delay_ms, Math.max(policy.initial_delay_ms, jitter));
    }

    default:
      return policy.initial_delay_ms;
  }
}

/**
 * error Retry 
  */
export function isRetryable(policy: RetryPolicy, error: AEPError): boolean {
  if (!error.retryable) return false;
  return policy.retryable_errors.includes(error.code as string);
}

/**
 * Must retry
  */
export function shouldRetry(
  policy: RetryPolicy,
  attempt: number,
  error: AEPError,
  options?: { idempotent?: boolean; hasIdempotencyKey?: boolean }
): boolean {
  if (!policy.enabled) return false;
  if (attempt >= policy.max_attempts) return false;
  if (!isRetryable(policy, error)) return false;

  // safety: side-effect idempotent without key = retry
  if (!options?.idempotent && !options?.hasIdempotencyKey) {
    // if Error side effectretry
    const code = error.code as string;
    if (code === "PROVIDER_ERROR" || code === "INTERNAL_ERROR") {
      return false;
    }
  }

  return true;
}

/**
 * Execute function with retry.
 * sideEffectSafety: 'safe' = idempotent, 'unsafe' = no retry on uncertain errors
  */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  options?: { idempotent?: boolean; hasIdempotencyKey?: boolean; onAttempt?: (a: RetryAttempt) => void }
): Promise<T> {
  const attempts: RetryAttempt[] = [];
  let attempt = 1;
  let lastError: AEPError | undefined;

  while (true) {
    try {
      const result = await fn(attempt);
      return result;
    } catch (err) {
      const aepErr: AEPError = err && typeof err === "object" && "code" in err
        ? err as AEPError
        : { code: "INTERNAL_ERROR", message: (err as Error)?.message || String(err), retryable: false };

      lastError = aepErr;
      const attemptRecord: RetryAttempt = {
        attempt,
        delay_ms: 0,
        error: aepErr,
      };

      if (!shouldRetry(policy, attempt, aepErr, options)) {
        attempts.push(attemptRecord);
        if (options?.onAttempt) options.onAttempt(attemptRecord);
        throw err;
      }

      const delay = computeDelay(policy, attempt, attempts.length > 0 ? attempts[attempts.length - 1].delay_ms : undefined);
      attemptRecord.delay_ms = delay;
      attempts.push(attemptRecord);
      if (options?.onAttempt) options.onAttempt(attemptRecord);

      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}
