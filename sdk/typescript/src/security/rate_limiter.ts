/**
 * Token Bucket Rate Limiter
 * Reference: AEP_CODE_FIRST_AUDIT.md P1-08P1-16
 * 
 * Production-grade rate limiting with:
 * - Token bucket algorithm (allows bursts)
 * - Per-key buckets (per principal, per tenant, per IP, per capability)
 * - Configurable refill rate and capacity
 * - Sliding window for tracking
 * 
 * Returns 429-style RATE_LIMITED error when exhausted.
  */

import { AEPError } from "../errors/aep-error.js";

// ============================================================================
// Token Bucket
// ============================================================================

export interface RateLimitConfig {
  /** Maximum tokens in bucket (burst capacity). */
  capacity: number;
  /** Tokens added per second (refill rate). */
  refill_per_second: number;
  /** Initial tokens (default = capacity). */
  initial_tokens?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining_tokens: number;
  retry_after_ms: number;
  bucket: string;
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(private capacity: number, private refillPerSecond: number, initial?: number) {
    this.tokens = initial ?? capacity;
    this.lastRefill = Date.now();
  }

  /**
    * Try to consume N tokens. Returns true if successful.
    */
  tryConsume(count: number = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /**
    * Get current token count (after refill).
    */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
    * Milliseconds until N tokens are available.
    */
  waitTimeMs(count: number = 1): number {
    this.refill();
    if (this.tokens >= count) return 0;
    const needed = count - this.tokens;
    return Math.ceil((needed / this.refillPerSecond) * 1000);
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    if (elapsedMs <= 0) return;
    const tokensToAdd = (elapsedMs / 1000) * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

// ============================================================================
// Rate Limiter (multi-bucket)
// ============================================================================

export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private configs: Map<string, RateLimitConfig> = new Map();
  private defaultConfig: RateLimitConfig;

  constructor(defaultConfig: RateLimitConfig) {
    this.defaultConfig = defaultConfig;
  }

  /**
    * Configure a specific bucket type.
    * Example: setConfig("principal", { capacity: 100, refill_per_second: 10 })
    */
  setConfig(bucketType: string, config: RateLimitConfig): void {
    this.configs.set(bucketType, config);
  }

  /**
    * Try to consume a token from a bucket.
    * Returns decision with retry_after_ms if denied.
    */
  consume(bucketKey: string, bucketType: string = "default", count: number = 1): RateLimitDecision {
    const fullKey = `${bucketType}:${bucketKey}`;
    let bucket = this.buckets.get(fullKey);
    if (!bucket) {
      const config = this.configs.get(bucketType) || this.defaultConfig;
      bucket = new TokenBucket(
        config.capacity,
        config.refill_per_second,
        config.initial_tokens
      );
      this.buckets.set(fullKey, bucket);
    }

    const allowed = bucket.tryConsume(count);
    const waitMs = allowed ? 0 : bucket.waitTimeMs(count);

    return {
      allowed,
      remaining_tokens: bucket.getTokens(),
      retry_after_ms: waitMs,
      bucket: fullKey,
    };
  }

  /**
    * Build a RATE_LIMITED AEPError from a decision.
    */
  static toAEPError(decision: RateLimitDecision): AEPError {
    return new AEPError({
      code: "RATE_LIMITED",
      message: `Rate limit exceeded on bucket '${decision.bucket}'. Retry after ${decision.retry_after_ms}ms.`,
      retryable: true,
      retry_after_ms: decision.retry_after_ms,
      recovery: ["retry"],
      details: {
        bucket: decision.bucket,
        remaining: decision.remaining_tokens,
      },
    });
  }

  /**
    * Garbage-collect empty buckets not used recently.
    * (In production, this should use LRU cache with TTL.)
    */
  gc(maxBuckets: number = 10000): number {
    if (this.buckets.size <= maxBuckets) return 0;
    // Simple strategy: clear half the buckets (LRU would be better)
    const keys = Array.from(this.buckets.keys());
    const toRemove = Math.floor(keys.length / 2);
    for (let i = 0; i < toRemove; i++) {
      this.buckets.delete(keys[i]);
    }
    return toRemove;
  }

  /**
    * Stats for monitoring.
    */
  stats(): { total_buckets: number; configs: number } {
    return {
      total_buckets: this.buckets.size,
      configs: this.configs.size + 1,
    };
  }
}

// ============================================================================
// Rate Limit Middleware (for HTTP gateway)
// ============================================================================

export interface RateLimitMiddlewareOptions {
  /** Bucket type: 'ip' | 'principal' | 'tenant' | 'capability' */
  bucketType: "ip" | "principal" | "tenant" | "capability";
  config: RateLimitConfig;
  /** Extract key from request (defaults based on bucketType). */
  keyExtractor?: (req: { ip?: string; principal?: { id: string; tenant_id?: string }; capability?: { id: string } }) => string;
}

export function createRateLimitMiddleware(opts: RateLimitMiddlewareOptions) {
  const limiter = new RateLimiter(opts.config);
  return {
    limiter,
    middleware: (req: any): { allowed: boolean; error?: any; decision?: RateLimitDecision } => {
      let key: string;
      if (opts.keyExtractor) {
        key = opts.keyExtractor(req);
      } else {
        switch (opts.bucketType) {
          case "ip":
            key = req.ip || "unknown";
            break;
          case "principal":
            key = req.principal?.id || "unauthenticated";
            break;
          case "tenant":
            key = req.principal?.tenant_id || "default";
            break;
          case "capability":
            key = req.capability?.id || "unknown";
            break;
          default:
            key = "default";
        }
      }
      const decision = limiter.consume(key, opts.bucketType);
      if (!decision.allowed) {
        return { allowed: false, error: RateLimiter.toAEPError(decision), decision };
      }
      return { allowed: true, decision };
    },
  };
}

// ============================================================================
// Sliding Window Rate Limiter (alternative algorithm)
// ============================================================================

export class SlidingWindowLimiter {
  private requests = new Map<string, number[]>();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  tryRequest(key: string): { allowed: boolean; retry_after_ms: number } {
    const now = Date.now();
    let reqs = this.requests.get(key) || [];
    // Remove old entries
    reqs = reqs.filter((t) => now - t < this.windowMs);
    if (reqs.length >= this.maxRequests) {
      const oldest = reqs[0];
      const retryAfter = this.windowMs - (now - oldest);
      return { allowed: false, retry_after_ms: Math.max(1, retryAfter) };
    }
    reqs.push(now);
    this.requests.set(key, reqs);
    return { allowed: true, retry_after_ms: 0 };
  }
}
