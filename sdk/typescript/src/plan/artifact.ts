/**
 * Plan — Intentional execution plan artifact.
 * Reference: AEP_10_10 §43 Plan§44 Proof§107-109
 * 
 * Intent → Plan → Proof → Execute
 * 
 * Plan is a reviewed, digested artifact before execution.
 * Proof binds authority + policy + risk + budget + approval to a plan digest.
 * Execute only accepts a valid Proof.
  */

import { canonicalize, fingerprint, sha256 } from "../core/canonical.js";
import type { Budget, Principal, RiskLevel } from "../core/types.js";

// ============================================================================
// Plan
// ============================================================================

export interface PlanNode {
  id: string;
  capability: string;
  version?: string;
  input?: unknown;
  depends_on?: string[];
}

export interface Plan {
  id: string;
  version: string;
  intent_digest: string;
  nodes: PlanNode[];
  authority_id?: string;
  policy_digest?: string;
  risk_level?: RiskLevel;
  budget?: Budget;
  created_at: string;
  expires_at?: string;
  digest: string;  // SHA-256 of canonical plan (excluding digest itself)
}

export function buildPlan(input: Omit<Plan, "digest">): Plan {
  const { digest: _, ...rest } = input as any;
  const digest = fingerprint(rest);
  return { ...input, digest } as Plan;
}

export function verifyPlanDigest(plan: Plan): boolean {
  const { digest: _, ...rest } = plan as any;
  return fingerprint(rest) === plan.digest;
}

// ============================================================================
// Proof
// ============================================================================

export interface Proof {
  plan_id: string;
  plan_digest: string;
  authority_id?: string;
  authority_verified: boolean;
  policy_decision: string;
  policy_digest?: string;
  risk_level: RiskLevel;
  budget_reserved: boolean;
  approval_obtained: boolean;
  approval_id?: string;
  created_at: string;
  expires_at: string;
  digest: string;
}

export function buildProof(input: Omit<Proof, "digest">): Proof {
  const { digest: _, ...rest } = input as any;
  const digest = fingerprint(rest);
  return { ...input, digest } as Proof;
}

export function verifyProofDigest(proof: Proof): boolean {
  const { digest: _, ...rest } = proof as any;
  return fingerprint(rest) === proof.digest;
}

/**
 * Verify that a Proof is valid for execution.
 * All conditions MUST be true.
  */
export function verifyProofForExecution(proof: Proof): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (!verifyProofDigest(proof)) {
    reasons.push("proof digest mismatch (tampered)");
  }
  if (!proof.authority_verified) {
    reasons.push("authority not verified");
  }
  if (proof.policy_decision === "deny") {
    reasons.push("policy denied");
  }
  if (!proof.budget_reserved) {
    reasons.push("budget not reserved");
  }
  if (!proof.approval_obtained) {
    reasons.push("approval not obtained");
  }
  if (new Date(proof.expires_at) < new Date()) {
    reasons.push("proof expired");
  }

  return { valid: reasons.length === 0, reasons };
}
