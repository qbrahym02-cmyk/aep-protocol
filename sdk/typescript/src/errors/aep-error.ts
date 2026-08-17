/**
 * AEPError — Typed Error Class
 * Reference: spec/10-10 §33 Error Taxonomy
 * 
 * message.includes("timeout")
 * typed errors code + retryable + retry_after_ms
  */

// Full AEP error codes (expanded from spec/10-10 §33)
export type AEPErrorCode =
  // Client errors
  | "INVALID_REQUEST"
  | "INVALID_SCHEMA"
  | "UNAUTHENTICATED"
  | "UNAUTHORIZED"
  | "AUTHORITY_NOT_FOUND"
  | "AUTHORITY_REVOKED"
  | "AUTHORITY_EXPIRED"
  | "AUTHORITY_INSUFFICIENT"
  | "CAPABILITY_NOT_FOUND"
  | "CAPABILITY_NOT_ALLOWED"
  | "CAPABILITY_VERSION_UNSUPPORTED"
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_NOT_ALLOWED"
  | "RESOURCE_REQUIRED"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_REJECTED"
  | "APPROVAL_EXPIRED"
  | "BUDGET_EXCEEDED"
  | "DELEGATION_DENIED"
  | "SUBJECT_MISMATCH"
  | "TOKEN_EXPIRED"
  // Server/provider errors
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "CANCELLED"
  | "EXECUTION_CANCELLED"
  | "EXECUTION_EXPIRED"
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "CONCURRENCY_CONFLICT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "OUTPUT_SCHEMA_INVALID"
  | "SCHEMA_VALIDATION_FAILED"
  | "COMPENSATION_FAILED"
  | "CHECKPOINT_NOT_FOUND"
  | "INVALID_STATE_TRANSITION"
  | "INTERNAL_ERROR";

export type RecoveryAction =
  | "retry"
  | "fallback"
  | "reauthorize"
  | "ask_user"
  | "compensate"
  | "abort";

export class AEPError extends Error {
  public readonly code: AEPErrorCode;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;
  public readonly recovery?: RecoveryAction[];
  public readonly details?: Record<string, unknown>;
  public readonly traceId?: string;
  public readonly executionId?: string;

  constructor(params: {
    code: AEPErrorCode;
    message?: string;
    retryable?: boolean;
    retry_after_ms?: number;
    recovery?: RecoveryAction[];
    details?: Record<string, unknown>;
    trace_id?: string;
    execution_id?: string;
    cause?: Error;
  }) {
    super(params.message || params.code, { cause: params.cause });
    this.name = "AEPError";
    this.code = params.code;
    this.retryable = params.retryable ?? DEFAULT_RETRYABLE[params.code] ?? false;
    this.retryAfterMs = params.retry_after_ms;
    this.recovery = params.recovery;
    this.details = params.details;
    this.traceId = params.trace_id;
    this.executionId = params.execution_id;
  }

  toJSON(): {
    code: AEPErrorCode;
    message: string;
    retryable: boolean;
    retry_after_ms?: number;
    recovery?: RecoveryAction[];
    details?: Record<string, unknown>;
    trace_id?: string;
    execution_id?: string;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      retry_after_ms: this.retryAfterMs,
      recovery: this.recovery,
      details: this.details,
      trace_id: this.traceId,
      execution_id: this.executionId,
    };
  }

  is(code: AEPErrorCode): boolean {
    return this.code === code;
  }

  isClientError(): boolean {
    return CLIENT_ERROR_CODES.has(this.code);
  }

  isServerError(): boolean {
    return !this.isClientError();
  }
}

const DEFAULT_RETRYABLE: Record<AEPErrorCode, boolean> = {
  INVALID_REQUEST: false,
  INVALID_SCHEMA: false,
  UNAUTHENTICATED: false,
  UNAUTHORIZED: false,
  AUTHORITY_NOT_FOUND: false,
  AUTHORITY_REVOKED: false,
  AUTHORITY_EXPIRED: false,
  AUTHORITY_INSUFFICIENT: false,
  CAPABILITY_NOT_FOUND: false,
  CAPABILITY_NOT_ALLOWED: false,
  CAPABILITY_VERSION_UNSUPPORTED: false,
  RESOURCE_NOT_FOUND: false,
  RESOURCE_NOT_ALLOWED: false,
  RESOURCE_REQUIRED: false,
  POLICY_DENIED: false,
  APPROVAL_REQUIRED: false,
  APPROVAL_REJECTED: false,
  APPROVAL_EXPIRED: false,
  BUDGET_EXCEEDED: false,
  DELEGATION_DENIED: false,
  SUBJECT_MISMATCH: false,
  TOKEN_EXPIRED: false,
  RATE_LIMITED: true,
  TIMEOUT: true,
  CANCELLED: false,
  EXECUTION_CANCELLED: false,
  EXECUTION_EXPIRED: false,
  CONFLICT: true,
  IDEMPOTENCY_CONFLICT: false,
  CONCURRENCY_CONFLICT: true,
  PROVIDER_UNAVAILABLE: true,
  PROVIDER_ERROR: false,
  OUTPUT_SCHEMA_INVALID: false,
  SCHEMA_VALIDATION_FAILED: false,
  COMPENSATION_FAILED: false,
  CHECKPOINT_NOT_FOUND: false,
  INVALID_STATE_TRANSITION: false,
  INTERNAL_ERROR: true,
};

const CLIENT_ERROR_CODES = new Set<AEPErrorCode>([
  "INVALID_REQUEST", "INVALID_SCHEMA", "UNAUTHENTICATED", "UNAUTHORIZED",
  "AUTHORITY_NOT_FOUND", "AUTHORITY_REVOKED", "AUTHORITY_EXPIRED", "AUTHORITY_INSUFFICIENT",
  "CAPABILITY_NOT_FOUND", "CAPABILITY_NOT_ALLOWED", "CAPABILITY_VERSION_UNSUPPORTED",
  "RESOURCE_NOT_FOUND", "RESOURCE_NOT_ALLOWED", "RESOURCE_REQUIRED",
  "POLICY_DENIED", "APPROVAL_REQUIRED", "APPROVAL_REJECTED", "APPROVAL_EXPIRED",
  "BUDGET_EXCEEDED", "DELEGATION_DENIED", "SUBJECT_MISMATCH", "TOKEN_EXPIRED",
  "CANCELLED", "EXECUTION_CANCELLED", "EXECUTION_EXPIRED",
  "IDEMPOTENCY_CONFLICT", "OUTPUT_SCHEMA_INVALID", "SCHEMA_VALIDATION_FAILED",
  "INVALID_STATE_TRANSITION",
]);

// ============================================================================
// Factory helpers
// ============================================================================

export function invalidRequest(message: string, details?: Record<string, unknown>): AEPError {
  return new AEPError({ code: "INVALID_REQUEST", message, details });
}

export function unauthorized(reason: string): AEPError {
  return new AEPError({ code: "UNAUTHORIZED", message: reason });
}

export function timeout(message: string, retry_after_ms?: number): AEPError {
  return new AEPError({ code: "TIMEOUT", message, retry_after_ms });
}

export function rateLimited(retry_after_ms: number, details?: Record<string, unknown>): AEPError {
  return new AEPError({
    code: "RATE_LIMITED",
    message: "Rate limit exceeded",
    retry_after_ms,
    recovery: ["retry", "fallback"],
    details,
  });
}

export function budgetExceeded(used: number, max: number): AEPError {
  return new AEPError({
    code: "BUDGET_EXCEEDED",
    message: `Budget exceeded: used ${used}, max ${max}`,
    details: { used, max },
  });
}

export function policyDenied(reason_code: string, details?: Record<string, unknown>): AEPError {
  return new AEPError({
    code: "POLICY_DENIED",
    message: `Policy denied: ${reason_code}`,
    details: { reason_code, ...details },
  });
}

export function authorityInsufficient(reason: string): AEPError {
  return new AEPError({ code: "AUTHORITY_INSUFFICIENT", message: reason });
}

export function internalError(message: string, cause?: Error): AEPError {
  return new AEPError({ code: "INTERNAL_ERROR", message, cause, recovery: ["retry"] });
}

export function isAEPError(err: unknown): err is AEPError {
  return err instanceof AEPError || (typeof err === "object" && err !== null && "code" in err && "retryable" in err);
}

export function asAEPError(err: unknown): AEPError {
  if (err instanceof AEPError) return err;
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    if (m.includes("timeout") || m.includes("timed out")) return timeout(err.message);
    if (m.includes("rate limit")) return rateLimited(2500);
    if (m.includes("unauthorized") || m.includes("forbidden")) return unauthorized(err.message);
    return internalError(err.message, err);
  }
  return internalError(String(err));
}
