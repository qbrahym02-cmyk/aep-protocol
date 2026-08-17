/**
 * Policy Engine
 * Reference: spec/002-envelope.md §Policyspec/003-capabilities.md §Authorization
 * 
 * PolicyDocument (principal, capability, context) Returns decision.
 * 
 * Rule :
 * LLM proposes → AEP validates → Policy authorizes → Risk evaluates
 * → Approval → Executor executes → Audit records
  */

import type {
  CapabilityContract,
  PolicyDecision,
  PolicyDocument,
  PolicyEffect,
  PolicyRule,
  Principal,
} from "../core/types.js";

export interface PolicyEvaluationContext {
  input?: unknown;
  tenant_id?: string;
  environment?: "test" | "staging" | "production";
  resource?: string;
}

export class PolicyEngine {
  private policies: PolicyDocument[] = [];

  loadPolicy(doc: PolicyDocument): void {
    this.policies.push(doc);
  }

  clearPolicies(): void {
    this.policies = [];
  }

  /**
    * policy .
    * :
    * 1) policyrule 
    * 2) rule (deny allow when )
    * 3) default_decision rule
    */
  evaluate(
    principal: Principal,
    capability: CapabilityContract,
    ctx: PolicyEvaluationContext = {}
  ): PolicyDecision {
    const matched_rules: string[] = [];
    let decision: PolicyEffect | null = null;
    let reason_code: string | undefined;
    let constraints: Record<string, unknown> | undefined;

    for (const policy of this.policies) {
      for (const rule of policy.rules) {
        const ruleId = rule.id || `<rule:${policy.id || "default"}:${matched_rules.length}>`;
        if (this.matchesRule(rule, principal, capability, ctx)) {
          matched_rules.push(ruleId);
          // deny (Default)
          if (rule.effect === "deny") {
            decision = "deny";
            reason_code = rule.reason_code || "POLICY_RULE_DENY";
            return { decision, reason_code, matched_rules, constraints };
          }
          if (decision === null) {
            decision = rule.effect;
            reason_code = rule.reason_code;
            if (rule.effect === "constrain") constraints = rule.constraints;
            // first match wins (except deny which overrides)
          }
        }
      }
    }

    if (decision === null) {
      // if policy(no policy = no restrictions)
      // if policy without rule default_decision 
      if (this.policies.length === 0) {
        decision = "allow";
        reason_code = "NO_POLICY_LOADED";
      } else {
        decision = this.policies[0].default_decision as PolicyEffect;
        reason_code = decision === "deny" ? "DEFAULT_DENY" : "DEFAULT_ALLOW";
      }
    }

    return { decision, reason_code, matched_rules, constraints };
  }

  private matchesRule(
    rule: PolicyRule,
    principal: Principal,
    capability: CapabilityContract,
    ctx: PolicyEvaluationContext
  ): boolean {
    if (rule.principal_type && rule.principal_type !== principal.type) return false;
    if (rule.principal && !this.globMatch(rule.principal, principal.id)) return false;
    if (rule.capability && !this.globMatch(rule.capability, capability.id)) return false;
    if (rule.tenant_id && rule.tenant_id !== principal.tenant_id) return false;
    if (rule.environment && rule.environment !== ctx.environment) return false;
    if (rule.resource && rule.resource !== ctx.resource) return false;
    if (rule.max_risk_level) {
      const order = ["low", "medium", "high", "critical"];
      if (order.indexOf(capability.risk.level) > order.indexOf(rule.max_risk_level)) return false;
    }
    return true;
  }

  /**
    * Glob pattern match — Supports * ?
    */
  private globMatch(pattern: string, value: string): boolean {
    // glob regex
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp("^" + regexStr + "$").test(value);
  }

  /**
    * policy without — "X Y"
    */
  simulate(
    principal: Principal,
    capability: CapabilityContract,
    ctx: PolicyEvaluationContext = {}
  ): PolicyDecision {
    return this.evaluate(principal, capability, ctx);
  }
}
