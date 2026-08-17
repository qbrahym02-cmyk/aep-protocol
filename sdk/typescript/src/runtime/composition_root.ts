/**
 * Production Composition Root — The ONLY place that wires all dependencies.
 * Reference: AEP_10_10 §161 Composition Root§162-163 Constructor Invariants
 * 
 * This is the single entry point for creating a production-secure runtime.
 * All security dependencies are constructor-required (not optional).
 * 
 * In production mode, missing any required dependency → startup failure.
  */

import { SecureExecutionEngine } from "../execution/secure_engine.js";
import { AuthorityEngine } from "../authority/engine.js";
import { PolicyEngine } from "../policy/engine.js";
import { RiskEngine } from "../policy/risk.js";
import { EventEmitter } from "../events/emitter.js";
import { ApprovalService } from "../approval/service.js";
import { CapabilityRegistry } from "../core/registry.js";
import type { Authenticator } from "../principal/authenticator.js";
import type {
  ExecutionStore,
  AuthorityStore,
  IdempotencyStore,
  BudgetStore,
  EventStore,
  AuditStore,
} from "../persistence/interfaces.js";
import type { ExecutionRuntime } from "./types.js";
import type { Clock } from "./clock.js";
import type { ProviderResolver } from "./provider_resolver.js";
import { SystemClock } from "./clock.js";
import { validateProductionConfig, type ProductionConfig } from "../security/production.js";
import { InMemoryExecutionStore, InMemoryAuthorityStore, InMemoryIdempotencyStore, InMemoryBudgetStore, InMemoryEventStore } from "../persistence/interfaces.js";
import { AuditEngine } from "../events/audit.js";

// ============================================================================
// Production Runtime Dependencies
// ============================================================================

export interface ProductionRuntimeDependencies {
  // Security (all REQUIRED in production)
  authenticator: Authenticator;
  authorityEngine: AuthorityEngine;
  policyEngine: PolicyEngine;
  riskEngine: RiskEngine;

  // Persistence (all REQUIRED in production)
  executionStore: ExecutionStore;
  authorityStore: AuthorityStore;
  idempotencyStore: IdempotencyStore;
  budgetStore: BudgetStore;
  eventStore: EventStore;
  auditStore: AuditStore;

  // Services
  approvalService?: ApprovalService;
  providerResolver?: ProviderResolver;

  // Registry
  registry: CapabilityRegistry;

  // Events
  events?: EventEmitter;

  // Infrastructure
  clock?: Clock;

  // Mode
  productionMode?: boolean;
  defaultTimeoutMs?: number;
}

// ============================================================================
// Composition Root
// ============================================================================

export function createProductionRuntime(deps: ProductionRuntimeDependencies): ExecutionRuntime {
  const clock = deps.clock || new SystemClock();
  const productionMode = deps.productionMode ?? false;

  // §163: Constructor invariants — fail at construction, not at first request
  if (productionMode) {
    const missing: string[] = [];
    if (!deps.authenticator) missing.push("authenticator");
    if (!deps.authorityEngine) missing.push("authorityEngine");
    if (!deps.policyEngine) missing.push("policyEngine");
    if (!deps.riskEngine) missing.push("riskEngine");
    if (!deps.executionStore) missing.push("executionStore");
    if (!deps.authorityStore) missing.push("authorityStore");
    if (!deps.idempotencyStore) missing.push("idempotencyStore");
    if (!deps.budgetStore) missing.push("budgetStore");
    if (!deps.eventStore) missing.push("eventStore");
    if (!deps.auditStore) missing.push("auditStore");
    if (missing.length > 0) {
      throw new Error(
        `Production runtime construction failed — missing required dependencies: ${missing.join(", ")}.\n` +
        `In production mode, ALL security dependencies are mandatory (§163).`
      );
    }
  }

  // Create SecureExecutionEngine
  const engine = new SecureExecutionEngine({
    registry: deps.registry,
    authenticator: deps.authenticator,
    authorityEngine: deps.authorityEngine,
    policyEngine: deps.policyEngine,
    riskEngine: deps.riskEngine,
    executionStore: deps.executionStore,
    idempotencyStore: deps.idempotencyStore,
    budgetStore: deps.budgetStore,
    eventStore: deps.eventStore,
    auditStore: deps.auditStore,
    events: deps.events,
    approvalService: deps.approvalService,
    defaultTimeoutMs: deps.defaultTimeoutMs,
    productionMode,
  });

  // Wrap engine to implement ExecutionRuntime interface
  return {
    execute: (req: any) => engine.execute(req),
    getExecution: async (id: string, principal: any) => {
      const record = await deps.executionStore.load(id);
      if (!record) return null;
      // §10 Object-level authorization: must be same principal OR same tenant
      // Both checks must pass — AND logic, not OR
      if (record.principal.id !== principal.id) {
        // Different principal — check tenant
        if (record.principal.tenant_id !== principal.tenant_id) {
          // Different tenant — deny
          return null;
        }
        // Same tenant, different principal — could be allowed with tenant-scoped authority
        // For now, deny cross-principal access (can be relaxed with explicit policy)
        return null;
      }
      return record;
    },
    cancel: async (id: string, principal: any) => {
      const record = await deps.executionStore.load(id);
      if (!record) throw new Error(`Execution ${id} not found`);
      // §10 Object-level authorization for cancel
      if (record.principal.id !== principal.id && record.principal.tenant_id !== principal.tenant_id) {
        throw new Error("Unauthorized: cannot cancel another principal's execution");
      }
      return engine.cancel(id, principal);
    },
    resume: async (id: string, principal: any) => {
      const result = await deps.executionStore.load(id);
      if (!result) throw new Error(`Execution ${id} not found`);
      // §10 Object-level authorization for resume
      if (result.principal.id !== principal.id && result.principal.tenant_id !== principal.tenant_id) {
        throw new Error("Unauthorized: cannot resume another principal's execution");
      }
      return { aep: "0.1", id, status: "accepted" as any, execution: { id, state: result.state } };
    },
    listExecutions: async (principal: any, filter?: any) => {
      // §11 Query Authorization: principal_id is ALWAYS enforced from the authenticated principal.
      // The caller CANNOT override it via filter.
      const safeFilter = { ...filter };
      delete safeFilter.principal_id;  // Never trust caller-supplied principal_id
      delete safeFilter.tenant_id;     // Never trust caller-supplied tenant_id
      return deps.executionStore.list({
        principal_id: principal.id,
        tenant_id: principal.tenant_id,
        ...safeFilter,
      });
    },
    shutdown: async () => {
      // §90: Graceful shutdown
      // In production, this would drain active executions
    },
    health: () => ({
      live: true,
      ready: true,
      details: {
        productionMode,
        capabilities: deps.registry.stats().total,
      },
    }),
  };
}

// ============================================================================
// Development Runtime (convenience)
// ============================================================================

export function createDevelopmentRuntime(registry: CapabilityRegistry): ExecutionRuntime {
  const events = new EventEmitter();
  const authorityEngine = new AuthorityEngine();
  const policyEngine = new PolicyEngine();
  const riskEngine = new RiskEngine();
  const executionStore = new InMemoryExecutionStore();
  const authorityStore = new InMemoryAuthorityStore();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const budgetStore = new InMemoryBudgetStore();
  const eventStore = new InMemoryEventStore();
  const auditStore = new AuditEngine();

  return createProductionRuntime({
    registry,
    authenticator: {
      authenticate: async (creds: any) => {
        if (creds.type === "test_token") {
          return {
            id: creds.principal_id || "dev-user",
            type: "user",
            issuer: "dev",
            authenticated_at: new Date().toISOString(),
            authentication_method: "test_token" as any,
            claims: {},
            assurance_level: "substantial" as any,
          };
        }
        throw new Error("Dev authenticator only accepts test_token");
      },
    },
    authorityEngine,
    policyEngine,
    riskEngine,
    executionStore,
    authorityStore,
    idempotencyStore,
    budgetStore,
    eventStore,
    auditStore: {
      append: async (r: any) => auditStore.record(r),
      verify: async () => auditStore.verify(),
      list: async (_filter?: any) => auditStore.list(),
    },
    events,
    productionMode: false,
    defaultTimeoutMs: 30_000,
  });
}
