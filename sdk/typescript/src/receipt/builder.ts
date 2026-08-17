/**
 * Execution Receipt — Verifiable Proof of Execution
 * Reference: spec/10-10 §29 Execution Receipt§69 Proof Object§70 Receipt = Proof of Execution
 * 
 * execution () MUST Receipt.
 * 
 * Contains digests :
 * - request_digest
 * - capability_digest
 * - authority_id
 * - policy_digest
 * - risk_decision
 * - provider
 * - result_digest
 * 
 * Can Verification Retry side effects.
  */

import { createHash } from "node:crypto";
import { canonicalize } from "../core/canonical.js";
import type { ExecutionRecord } from "../core/types.js";

// ============================================================================
// Receipt
// ============================================================================

export interface ExecutionReceipt {
  execution_id: string;
  request_id: string;

  // — digests —
  request_digest: string;        // sha256 of canonical request
  capability_digest: string;     // sha256 of canonical capability contract
  authority_id?: string;
  policy_digest?: string;       // sha256 of canonical policy decision
  risk_decision?: { level: string; score?: number };
  provider_id?: string;

  // — result —
  result_digest?: string;       // sha256 of canonical result
  status: ExecutionRecord["state"];

  // — timing —
  started_at: string;
  completed_at?: string;
  duration_ms?: number;

  // — attempts (for retry) —
  attempts?: Array<{
    attempt: number;
    provider?: string;
    started_at: string;
    completed_at?: string;
    success: boolean;
    error_code?: string;
  }>;

  // — audit —
  audit_entry_seq?: number;
  audit_entry_hash?: string;

  // — signatures (optional) —
  signature?: {
    algorithm: "ed25519" | "ecdsa" | "hmac-sha256";
    key_id: string;
    value: string;
  };
}

// ============================================================================
// Builder
// ============================================================================

export interface ReceiptInput {
  execution_id: string;
  request_id: string;
  request: unknown;
  capability: unknown;
  authority_id?: string;
  policy_decision?: unknown;
  risk_decision?: { level: string; score?: number };
  provider_id?: string;
  result?: unknown;
  status: ExecutionRecord["state"];
  started_at: string;
  completed_at?: string;
}

export function buildReceipt(input: ReceiptInput): ExecutionReceipt {
  const receipt: ExecutionReceipt = {
    execution_id: input.execution_id,
    request_id: input.request_id,
    request_digest: digest(input.request),
    capability_digest: digest(input.capability),
    authority_id: input.authority_id,
    policy_digest: input.policy_decision ? digest(input.policy_decision) : undefined,
    risk_decision: input.risk_decision,
    provider_id: input.provider_id,
    result_digest: input.result !== undefined ? digest(input.result) : undefined,
    status: input.status,
    started_at: input.started_at,
    completed_at: input.completed_at,
  };

  if (input.completed_at) {
    receipt.duration_ms = new Date(input.completed_at).getTime() - new Date(input.started_at).getTime();
  }

  return receipt;
}

// ============================================================================
// Verification
// ============================================================================

/**
 * Verify receipt:
 * 1. digests 
 * 2. status 
 * 3. (optional) signature 
  */
export function verifyReceipt(
  receipt: ExecutionReceipt,
  inputs: {
    request?: unknown;
    capability?: unknown;
    result?: unknown;
    policy_decision?: unknown;
  }
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (inputs.request !== undefined) {
    const computed = digest(inputs.request);
    if (computed !== receipt.request_digest) {
      reasons.push("request_digest mismatch");
    }
  }
  if (inputs.capability !== undefined) {
    const computed = digest(inputs.capability);
    if (computed !== receipt.capability_digest) {
      reasons.push("capability_digest mismatch");
    }
  }
  if (inputs.result !== undefined && receipt.result_digest) {
    const computed = digest(inputs.result);
    if (computed !== receipt.result_digest) {
      reasons.push("result_digest mismatch");
    }
  }
  if (inputs.policy_decision !== undefined && receipt.policy_digest) {
    const computed = digest(inputs.policy_decision);
    if (computed !== receipt.policy_digest) {
      reasons.push("policy_digest mismatch");
    }
  }

  return { valid: reasons.length === 0, reasons };
}

// ============================================================================
// Helpers
// ============================================================================

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}
