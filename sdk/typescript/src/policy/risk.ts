/**
 * Risk Engine
 * Reference: spec/003-capabilities.md §Riskspec/002-envelope.md §Dynamic Risk§Blast Radius
 * 
 * boolean. context:
 * principal
 * resource
 * environment (test/staging/production)
 * input
 * tenant
 * time
 * data classification
 * current incident state
  */

import type { CapabilityContract, RiskLevel } from "../core/types.js";

export interface RiskContext {
  input?: unknown;
  tenant_id?: string;
  environment?: "test" | "staging" | "production";
}

export interface RiskAssessmentResult {
  level: RiskLevel;
  score: number; // 0-100
  factors: string[];
}

const LEVEL_ORDER: Record<RiskLevel, number> = {
  low: 25,
  medium: 50,
  high: 75,
  critical: 100,
};

const ENV_BOOST: Record<string, number> = {
  test: -20,
  staging: 0,
  production: 25,
};

export class RiskEngine {
  /**
    * Risk :
    * - static risk capability contract
    * - environment boost
    * - input size / records count (if input "count" "size")
    * - principal trust level (if principal.id "research" = )
    */
  assess(
    capability: CapabilityContract,
    ctx: RiskContext = {}
  ): RiskAssessmentResult {
    const factors: string[] = [];
    let score = LEVEL_ORDER[capability.risk.level] || 0;
    factors.push(`static:${capability.risk.level}`);

    const env = ctx.environment || "production";
    const envBoost = ENV_BOOST[env] ?? 0;
    score += envBoost;
    if (envBoost > 0) factors.push(`env:${env}:boost`);
    else if (envBoost < 0) factors.push(`env:${env}:reduce`);

    // input-based risk
    if (ctx.input && typeof ctx.input === "object") {
      const input = ctx.input as Record<string, unknown>;
      if (typeof input.count === "number" && input.count > 1000) {
        score += 15;
        factors.push(`input:count=${input.count}`);
      }
      if (typeof input.amount === "number") {
        if (input.amount > 10000) {
          score += 40;
          factors.push(`input:amount=${input.amount}:critical`);
        } else if (input.amount > 1000) {
          score += 20;
          factors.push(`input:amount=${input.amount}:high`);
        } else if (input.amount > 100) {
          score += 5;
          factors.push(`input:amount=${input.amount}:medium`);
        }
      }
      if (typeof input.delete === "boolean" && input.delete) {
        score += 20;
        factors.push("input:delete=true");
      }
      if (typeof input.force === "boolean" && input.force) {
        score += 10;
        factors.push("input:force=true");
      }
    }

    // principal trust
    if (ctx.tenant_id && ctx.tenant_id.startsWith("untrusted")) {
      score += 15;
      factors.push("tenant:untrusted");
    }

    // clamp
    score = Math.max(0, Math.min(100, score));
    const level: RiskLevel =
      score >= 90 ? "critical" : score >= 70 ? "high" : score >= 40 ? "medium" : "low";

    return { level, score, factors };
  }
}

/**
 * Blast Radius estimation
 * Reference: spec/002-envelope.md §Blast Radius
  */
export interface BlastRadiusEstimate {
  resources: number;
  records: number;
  services: number;
  financial_exposure: number;
}

export function estimateBlastRadius(
  capability: CapabilityContract,
  input: unknown
): BlastRadiusEstimate {
  let records = 1;
  let financial_exposure = 0;
  if (input && typeof input === "object") {
    const inp = input as Record<string, unknown>;
    if (typeof inp.count === "number") records = inp.count;
    if (typeof inp.amount === "number") financial_exposure = inp.amount;
  }

  const servicesByBlastRadius: Record<string, number> = {
    single_record: 1,
    multi_record: 1,
    service: 1,
    tenant: 2,
    account: 4,
    global: 8,
  };

  return {
    resources: records,
    records,
    services: servicesByBlastRadius[capability.risk.blast_radius || "single_record"],
    financial_exposure,
  };
}
