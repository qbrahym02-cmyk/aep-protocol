/**
 * Capability Registry
 * Reference: spec/003-capabilities.md
 * 
 * :
 * - capabilities
 * - Discovery progressive disclosure
 * - Discovery semantic class (equivalence)
 * - provider independence (capability providers)
  */

import type {
  CapabilityContract,
  CapabilityKind,
  CapabilityRef,
  DiscoveryQuery,
  DiscoveryResultItem,
  RiskLevel,
} from "./types.js";
import { satisfies } from "./semver.js";

export interface RegisteredCapability {
  contract: CapabilityContract;
  handler?: unknown; // CapabilityHandler — مرجع في الـcapability registration
  provider_id: string;
  health: "healthy" | "degraded" | "offline" | "unknown";
}

export class CapabilityRegistry {
  private byId = new Map<string, RegisteredCapability[]>();

  /**
    * capability. id Can providers.
    */
  register(contract: CapabilityContract, opts?: { provider_id?: string; handler?: unknown }): void {
    const provider_id = opts?.provider_id || contract.provider?.id || "default";
    const existing = this.byId.get(contract.id) || [];

    // Registration provider + version
    if (existing.some((c) => c.provider_id === provider_id && c.contract.version === contract.version)) {
      throw new Error(
        `Capability ${contract.id}@${contract.version} already registered for provider ${provider_id}`
      );
    }

    existing.push({
      contract,
      handler: opts?.handler,
      provider_id,
      health: "healthy",
    });
    this.byId.set(contract.id, existing);
  }

  unregister(id: string, opts?: { provider_id?: string; version?: string }): number {
    const existing = this.byId.get(id);
    if (!existing) return 0;
    const before = existing.length;
    const filtered = existing.filter(
      (c) =>
        !(opts?.provider_id ? c.provider_id === opts.provider_id : true) ||
        !(opts?.version ? c.contract.version === opts.version : true)
    );
    if (filtered.length === 0) this.byId.delete(id);
    else this.byId.set(id, filtered);
    return before - filtered.length;
  }

  /**
    * Discovery capability .
    */
  resolve(ref: CapabilityRef): RegisteredCapability | null {
    const list = this.byId.get(ref.id);
    if (!list || list.length === 0) return null;
    const wanted = ref.version || "*";
    // capability (healthy )
    const healthy = list.filter((c) => c.health === "healthy");
    const pool = healthy.length > 0 ? healthy : list;
    for (const c of pool) {
      if (satisfies(c.contract.version, wanted)) return c;
    }
    return null;
  }

  /**
    * capabilities .
    */
  list(): RegisteredCapability[] {
    const out: RegisteredCapability[] = [];
    for (const arr of this.byId.values()) out.push(...arr);
    return out;
  }

  /**
    * capabilities semantic_class.
    */
  findBySemanticClass(semanticClass: string): RegisteredCapability[] {
    return this.list().filter(
      (c) => c.contract.semantic_class === semanticClass
    );
  }

  /**
    * provider (health).
    */
  setHealth(id: string, provider_id: string, health: "healthy" | "degraded" | "offline" | "unknown"): void {
    const list = this.byId.get(id);
    if (!list) return;
    for (const c of list) {
      if (c.provider_id === provider_id) c.health = health;
    }
  }

  /**
    * Discovery with progressive disclosure.
    * level 1: name + summary
    * level 2: contract
    * level 3: full schema (level 2 contract)
    * level 4: examples (contract)
    */
  discover(query: DiscoveryQuery = {}): DiscoveryResultItem[] {
    const level = query.level ?? 1;
    const limit = query.limit ?? 50;
    let items: RegisteredCapability[] = this.list();

    if (query.id) items = items.filter((c) => c.contract.id === query.id);
    if (query.kind) items = items.filter((c) => c.contract.kind === query.kind);
    if (query.semantic_class)
      items = items.filter((c) => c.contract.semantic_class === query.semantic_class);

    if (query.intent?.constraints) {
      const c = query.intent.constraints;
      const order: RiskLevel[] = ["low", "medium", "high", "critical"];
      if (c.risk_max) {
        const maxIdx = order.indexOf(c.risk_max);
        items = items.filter(
          (cap) => order.indexOf(cap.contract.risk.level) <= maxIdx
        );
      }
      if (c.latency_max_ms !== undefined && c.latency_max_ms !== null) {
        items = items.filter(
          (cap) =>
            cap.contract.performance?.p95_ms === undefined ||
            cap.contract.performance.p95_ms <= (c.latency_max_ms as number)
        );
      }
      if (c.cost_max_usd !== undefined && c.cost_max_usd !== null) {
        items = items.filter(
          (cap) =>
            cap.contract.cost?.estimated === undefined ||
            cap.contract.cost.estimated <= (c.cost_max_usd as number)
        );
      }
    }

    // offline
    items = items.filter((c) => c.health !== "offline");

    return items.slice(0, limit).map((c) => {
      const base: DiscoveryResultItem = {
        id: c.contract.id,
        version: c.contract.version,
        kind: c.contract.kind,
        description: c.contract.description,
        semantic_class: c.contract.semantic_class,
        risk_level: c.contract.risk.level,
        cost_estimated: c.contract.cost?.estimated,
        p95_ms: c.contract.performance?.p95_ms,
        provider: c.provider_id,
        health: c.health,
      };
      if (level >= 2) base.contract = c.contract;
      return base;
    });
  }

  /**
    * registry.
    */
  stats(): { total: number; by_kind: Record<string, number>; by_health: Record<string, number> } {
    const items = this.list();
    const by_kind: Record<string, number> = {};
    const by_health: Record<string, number> = {};
    for (const c of items) {
      by_kind[c.contract.kind] = (by_kind[c.contract.kind] || 0) + 1;
      by_health[c.health] = (by_health[c.health] || 0) + 1;
    }
    return { total: items.length, by_kind, by_health };
  }
}
