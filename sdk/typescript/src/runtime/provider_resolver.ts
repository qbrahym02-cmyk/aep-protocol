/**
 * ProviderResolver — Deterministic, explainable provider selection.
 * Reference: AEP_10_10 §60 Provider Resolver§61 Provider Mesh
 * 
 * Selection criteria (ordered):
 * 1. authorization (does authority allow this provider?)
 * 2. policy (does policy allow?)
 * 3. compatibility (schema + semantic match)
 * 4. health (is provider available?)
 * 5. latency (p95)
 * 6. cost
 * 7. region / data residency
 * 8. quality
 * 
 * The decision MUST be:
 * - deterministic (same inputs → same output)
 * - explainable (returned with reasons)
 * - auditable (recorded)
  */

import type { CapabilityContract } from "../core/types.js";

export interface ProviderCandidate {
  provider_id: string;
  capability_id: string;
  version: string;
  health: "healthy" | "degraded" | "unavailable" | "quarantined";
  p95_ms?: number;
  cost_estimated?: number;
  region?: string;
  quality_score?: number;
}

export interface ResolutionContext {
  tenant_id?: string;
  environment?: string;
  required_region?: string;
  max_cost_usd?: number;
  max_latency_ms?: number;
  authority_allowed_providers?: string[];
  policy_allowed_providers?: string[];
}

export interface ProviderSelection {
  selected: ProviderCandidate | null;
  alternatives: ProviderCandidate[];
  selection_reason: {
    scores: Array<{ provider_id: string; score: number; factors: Record<string, number> }>;
    excluded: Array<{ provider_id: string; reason: string }>;
  };
}

export interface ProviderResolver {
  resolve(
    capability: CapabilityContract,
    context: ResolutionContext
  ): Promise<ProviderSelection>;
}

// ============================================================================
// Default implementation
// ============================================================================

export class DefaultProviderResolver implements ProviderResolver {
  private candidates = new Map<string, ProviderCandidate[]>();

  register(capabilityId: string, candidate: ProviderCandidate): void {
    const list = this.candidates.get(capabilityId) || [];
    list.push(candidate);
    this.candidates.set(capabilityId, list);
  }

  async resolve(
    capability: CapabilityContract,
    context: ResolutionContext
  ): Promise<ProviderSelection> {
    const all = this.candidates.get(capability.id) || [];
    const excluded: Array<{ provider_id: string; reason: string }> = [];

    // 1) Filter by health
    let candidates = all.filter((c) => {
      if (c.health === "unavailable" || c.health === "quarantined") {
        excluded.push({ provider_id: c.provider_id, reason: `health=${c.health}` });
        return false;
      }
      return true;
    });

    // 2) Filter by authority
    if (context.authority_allowed_providers && context.authority_allowed_providers.length > 0) {
      candidates = candidates.filter((c) => {
        const allowed = context.authority_allowed_providers!.includes(c.provider_id) ||
          context.authority_allowed_providers!.includes("*");
        if (!allowed) {
          excluded.push({ provider_id: c.provider_id, reason: "authority not allowed" });
        }
        return allowed;
      });
    }

    // 3) Filter by policy
    if (context.policy_allowed_providers && context.policy_allowed_providers.length > 0) {
      candidates = candidates.filter((c) => {
        const allowed = context.policy_allowed_providers!.includes(c.provider_id);
        if (!allowed) {
          excluded.push({ provider_id: c.provider_id, reason: "policy not allowed" });
        }
        return allowed;
      });
    }

    // 4) Filter by region
    if (context.required_region) {
      candidates = candidates.filter((c) => {
        const ok = !c.region || c.region === context.required_region;
        if (!ok) {
          excluded.push({ provider_id: c.provider_id, reason: `region mismatch: ${c.region} != ${context.required_region}` });
        }
        return ok;
      });
    }

    // 5) Filter by cost
    if (context.max_cost_usd !== undefined) {
      candidates = candidates.filter((c) => {
        const ok = c.cost_estimated === undefined || c.cost_estimated <= context.max_cost_usd!;
        if (!ok) {
          excluded.push({ provider_id: c.provider_id, reason: `cost too high: ${c.cost_estimated}` });
        }
        return ok;
      });
    }

    // 6) Filter by latency
    if (context.max_latency_ms !== undefined) {
      candidates = candidates.filter((c) => {
        const ok = c.p95_ms === undefined || c.p95_ms <= context.max_latency_ms!;
        if (!ok) {
          excluded.push({ provider_id: c.provider_id, reason: `latency too high: ${c.p95_ms}ms` });
        }
        return ok;
      });
    }

    // 7) Score remaining
    const scores = candidates.map((c) => {
      const healthScore = c.health === "healthy" ? 1.0 : c.health === "degraded" ? 0.5 : 0;
      const latencyScore = c.p95_ms !== undefined ? Math.max(0, 1 - c.p95_ms / 10000) : 0.5;
      const costScore = c.cost_estimated !== undefined ? Math.max(0, 1 - c.cost_estimated) : 0.5;
      const qualityScore = c.quality_score ?? 0.5;

      const score = 0.3 * healthScore + 0.25 * latencyScore + 0.2 * costScore + 0.25 * qualityScore;

      return {
        provider_id: c.provider_id,
        score,
        factors: { health: healthScore, latency: latencyScore, cost: costScore, quality: qualityScore },
      };
    });

    scores.sort((a, b) => b.score - a.score);

    const selected = candidates.length > 0 ? candidates[scores[0] ? candidates.indexOf(candidates.find((c) => c.provider_id === scores[0].provider_id)!) : 0] : null;
    const alternatives = candidates.slice(1);

    return {
      selected: selected || null,
      alternatives,
      selection_reason: { scores, excluded },
    };
  }
}
