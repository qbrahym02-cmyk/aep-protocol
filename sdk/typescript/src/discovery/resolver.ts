/**
 * Capability Resolver — Semantic Intent → Best Capability
 * Reference: spec/profiles/discovery.md §Capability Resolution
 * 
 * Agent withcapability .
 * intentresolver candidates .
 * 
 * Pipeline:
 * Semantic Match → Authority Filter → Schema → Policy → Risk → Health → Cost → Latency → Rank
  */

import type {
  CapabilityContract,
  DiscoveryResultItem,
  Principal,
  RiskLevel,
} from "../core/types.js";
import type { CapabilityRegistry, RegisteredCapability } from "../core/registry.js";
import type { AuthorityEngine, Authority } from "../authority/engine.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { RiskEngine } from "../policy/risk.js";

// ============================================================================
// Types
// ============================================================================

export interface Intent {
  operation?: string;        // "create_issue"
  domain?: string;           // "project_management"
  description?: string;      // free text
  semantic_class?: string;   // direct match
}

export interface ResolutionConstraints {
  risk_max?: RiskLevel;
  latency_max_ms?: number;
  cost_max_usd?: number;
  environment?: "test" | "staging" | "production";
}

export interface ResolutionRequest {
  principal: Principal;
  intent: Intent;
  constraints?: ResolutionConstraints;
  authority?: Authority;             // required to filter by authority
  limit?: number;
}

export interface ResolvedCandidate {
  rank: number;
  capability_id: string;
  version: string;
  provider: string;
  health: "healthy" | "degraded" | "offline" | "unknown";
  risk_level: RiskLevel;
  estimated_cost_usd?: number;
  p95_ms?: number;
  score: number;
  factors: string[];
}

export interface RejectedCandidate {
  capability_id: string;
  reason_code: string;
}

export interface ResolutionResult {
  matches: ResolvedCandidate[];
  rejected: RejectedCandidate[];
  total_candidates: number;
}

// ============================================================================
// Default weights for scoring
// ============================================================================

const DEFAULT_WEIGHTS = {
  health: 0.30,
  latency: 0.25,
  cost: 0.20,
  risk: 0.15,
  semantic: 0.10,
};

const RISK_SCORE: Record<RiskLevel, number> = {
  low: 1.0,
  medium: 0.75,
  high: 0.40,
  critical: 0.10,
};

const HEALTH_SCORE: Record<string, number> = {
  healthy: 1.0,
  degraded: 0.5,
  offline: 0,
  unknown: 0.3,
};

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];

// ============================================================================
// Capability Resolver
// ============================================================================

export interface ResolverOptions {
  registry: CapabilityRegistry;
  authority?: AuthorityEngine;
  policy?: PolicyEngine;
  risk?: RiskEngine;
  weights?: Partial<typeof DEFAULT_WEIGHTS>;
}

export class CapabilityResolver {
  private opts: ResolverOptions;
  private weights: typeof DEFAULT_WEIGHTS;

  constructor(opts: ResolverOptions) {
    this.opts = opts;
    this.weights = { ...DEFAULT_WEIGHTS, ...opts.weights };
  }

  resolve(request: ResolutionRequest): ResolutionResult {
    const { principal, intent, constraints = {}, authority, limit = 5 } = request;
    const factors: string[] = [];

    // ---------------------------------------------------------------
    // Step 1: Semantic Match
    // ---------------------------------------------------------------
    let candidates: RegisteredCapability[] = this.opts.registry.list();
    factors.push("semantic:initial-pool");

    if (intent.semantic_class) {
      candidates = candidates.filter(
        (c) => c.contract.semantic_class === intent.semantic_class
      );
      factors.push(`semantic:semantic_class=${intent.semantic_class}`);
    }

    if (intent.operation) {
      const op_intent = intent.operation.toLowerCase();
      // match against semantic_class with flexible operation name matching
      candidates = candidates.filter((c) => {
        const sc = c.contract.semantic_class;
        if (!sc) return false;
        // multiple ways to derive operation from semantic_class:
        // "issue.creation" → ["creation_issue", "issue_creation", "create_issue"]
        const parts = sc.split(".");
        if (parts.length < 2) return sc.includes(op_intent);
        const [domain, action] = parts;
        // try verb forms: create / creation, list / list, delete / deletion
        const verbMap: Record<string, string[]> = {
          creation: ["create", "creation"],
          deletion: ["delete", "deletion", "remove"],
          update: ["update", "modify"],
          read: ["read", "get"],
          list: ["list", "search"],
          charge: ["charge", "pay"],
        };
        const verbs = verbMap[action.toLowerCase()] || [action.toLowerCase()];
        // build candidate operations
        const candidateOps = [
          `${action}_${domain}`,  // creation_issue
          `${domain}_${action}`,  // issue_creation
          ...verbs.map((v) => `${v}_${domain}`),  // create_issue, remove_issue, etc.
        ];
        return candidateOps.some((op) => op === op_intent) ||
          sc.includes(op_intent) ||
          // also check operation appears in capability id
          c.contract.id.includes(op_intent.replace("_", "."));
      });
      factors.push(`semantic:operation=${op_intent}`);
    }

    if (intent.domain) {
      const domain = intent.domain;
      // match against capability id prefix (e.g. domain "github" → github.*)
      candidates = candidates.filter((c) =>
        c.contract.id.startsWith(domain + ".") ||
        c.contract.id.includes(domain)
      );
      factors.push(`semantic:domain=${domain}`);
    }

    // if description present, simple keyword match against description
    if (intent.description) {
      const kw = intent.description.toLowerCase();
      candidates = candidates.filter((c) =>
        c.contract.description.toLowerCase().includes(kw.split(" ")[0])
      );
      factors.push("semantic:description-keyword");
    }

    const rejected: RejectedCandidate[] = [];

    // ---------------------------------------------------------------
    // Step 2: Authority Filter
    // ---------------------------------------------------------------
    if (authority) {
      const before = candidates.length;
      candidates = candidates.filter((c) =>
        this.opts.authority!.canExercise(authority, c.contract.id, undefined).allowed
      );
      const removed = before - candidates.length;
      if (removed > 0) factors.push(`authority:filtered-${removed}`);
    }

    // ---------------------------------------------------------------
    // Step 3: Risk Filter
    // ---------------------------------------------------------------
    if (constraints.risk_max) {
      const maxIdx = RISK_ORDER.indexOf(constraints.risk_max);
      const before = candidates.length;
      candidates = candidates.filter((c) =>
        RISK_ORDER.indexOf(c.contract.risk.level) <= maxIdx
      );
      const removed = before - candidates.length;
      if (removed > 0) factors.push(`risk:filtered-${removed}`);
      for (const removed of candidates.slice(0, 0)) {
        rejected.push({ capability_id: removed.contract.id, reason_code: "RISK_TOO_HIGH" });
      }
    }

    // ---------------------------------------------------------------
    // Step 4: Cost Filter
    // ---------------------------------------------------------------
    if (constraints.cost_max_usd !== undefined) {
      const before = candidates.length;
      candidates = candidates.filter((c) => {
        const cost = c.contract.cost?.estimated;
        return cost === undefined || cost <= constraints.cost_max_usd!;
      });
      const removed = before - candidates.length;
      if (removed > 0) factors.push(`cost:filtered-${removed}`);
    }

    // ---------------------------------------------------------------
    // Step 5: Latency Filter
    // ---------------------------------------------------------------
    if (constraints.latency_max_ms !== undefined) {
      const before = candidates.length;
      candidates = candidates.filter((c) => {
        const p95 = c.contract.performance?.p95_ms;
        return p95 === undefined || p95 <= constraints.latency_max_ms!;
      });
      const removed = before - candidates.length;
      if (removed > 0) factors.push(`latency:filtered-${removed}`);
    }

    // ---------------------------------------------------------------
    // Step 6: Policy Filter
    // ---------------------------------------------------------------
    if (this.opts.policy) {
      const before = candidates.length;
      candidates = candidates.filter((c) => {
        const decision = this.opts.policy!.evaluate(
          principal,
          c.contract,
          { environment: constraints.environment }
        );
        if (decision.decision === "deny") {
          rejected.push({ capability_id: c.contract.id, reason_code: "POLICY_DENIED" });
          return false;
        }
        return true;
      });
      const removed = before - candidates.length;
      if (removed > 0) factors.push(`policy:filtered-${removed}`);
    }

    // ---------------------------------------------------------------
    // Step 7: Provider Health Filter (remove offline, down-rank degraded)
    // ---------------------------------------------------------------
    const beforeHealth = candidates.length;
    candidates = candidates.filter((c) => c.health !== "offline");
    const removedOffline = beforeHealth - candidates.length;
    if (removedOffline > 0) factors.push(`health:offline-${removedOffline}`);

    // ---------------------------------------------------------------
    // Step 8: Score & Rank
    // ---------------------------------------------------------------
    const scored = candidates.map((c) => {
      const healthScore = HEALTH_SCORE[c.health] || 0;
      const latencyScore = c.contract.performance?.p95_ms !== undefined
        ? Math.max(0, 1 - c.contract.performance.p95_ms / 10000)  // 0-10s
        : 0.5;
      const costScore = c.contract.cost?.estimated !== undefined
        ? Math.max(0, 1 - c.contract.cost.estimated)
        : 0.5;
      const riskScore = RISK_SCORE[c.contract.risk.level] || 0;
      const semanticScore = c.contract.semantic_class === intent.semantic_class ? 1.0 : 0.5;

      const score =
        this.weights.health * healthScore +
        this.weights.latency * latencyScore +
        this.weights.cost * costScore +
        this.weights.risk * riskScore +
        this.weights.semantic * semanticScore;

      return {
        candidate: c,
        score,
        factors: [
          `health=${c.health}`,
          `risk=${c.contract.risk.level}`,
          c.contract.cost?.estimated !== undefined ? `cost=$${c.contract.cost.estimated}` : "cost=unknown",
          c.contract.performance?.p95_ms !== undefined ? `p95=${c.contract.performance.p95_ms}ms` : "p95=unknown",
        ],
      };
    });

    scored.sort((a, b) => b.score - a.score);

    const matches: ResolvedCandidate[] = scored.slice(0, limit).map((s, idx) => ({
      rank: idx + 1,
      capability_id: s.candidate.contract.id,
      version: s.candidate.contract.version,
      provider: s.candidate.provider_id,
      health: s.candidate.health,
      risk_level: s.candidate.contract.risk.level,
      estimated_cost_usd: s.candidate.contract.cost?.estimated,
      p95_ms: s.candidate.contract.performance?.p95_ms,
      score: Math.round(s.score * 100) / 100,
      factors: s.factors,
    }));

    return {
      matches,
      rejected,
      total_candidates: candidates.length,
    };
  }
}
