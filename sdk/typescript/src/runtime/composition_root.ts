/**
 * Production Composition Root — The ONLY place that wires all dependencies.
 * Reference: AEP_10_10 §161 Composition Root, §162-163 Constructor Invariants
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
import type { Authenticator, VerifiedPrincipal, Credentials } from "../principal/authenticator.js";
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
import { InMemoryExecutionStore, InMemoryAuthorityStore, InMemoryIdempotencyStore, InMemoryBudgetStore, InMemoryEventStore } from "../persistence/interfaces.js";
import { AuditEngine } from "../events/audit.js";
import type { AEPRequest, AEPResponse, ExecutionRecord, ExecutionState } from "../core/types.js";

// ============================================================================
// Production Runtime Dependencies
// ============================================================================

export interface ProductionRuntimeDependencies {
  authenticator: Authenticator;
  authorityEngine: AuthorityEngine;
  policyEngine: PolicyEngine;
  riskEngine: RiskEngine;
  executionStore: ExecutionStore;
  authorityStore: AuthorityStore;
  idempotencyStore: IdempotencyStore;
  budgetStore: BudgetStore;
  eventStore: EventStore;
  auditStore: AuditStore;
  approvalService?: ApprovalService;
  providerResolver?: ProviderResolver;
  registry: CapabilityRegistry;
  events?: EventEmitter;
  clock?: Clock;
  productionMode?: boolean;
  defaultTimeoutMs?: number;
}

// ============================================================================
// Sanitized Authenticator Wrapper
// ============================================================================

/**
 * Wraps an Authenticator to ensure error messages are sanitized
 * before being sent to the client. Internal errors (stack traces,
 * database connection strings, etc.) are replaced with generic messages.
 */
class SanitizingAuthenticator implements Authenticator {
  constructor(private inner: Authenticator) {}

  async authenticate(credentials: Credentials): Promise<VerifiedPrincipal> {
    try {
      return await this.inner.authenticate(credentials);
    } catch (err) {
      // Sanitize: never leak internal error details to the client
      const message = (err instanceof Error) ? err.message : String(err);
      // Check for common internal leakage patterns
      if (message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") ||
          message.includes("password") || message.includes("secret") ||
          message.includes("key") || message.includes("token") ||
          message.includes("connection")) {
        throw new Error("Authentication failed");
      }
      throw new Error("Authentication failed");
    }
  }
}

// ============================================================================
// Graceful Shutdown Manager
// ============================================================================

class GracefulShutdownManager {
  private activeExecutions = new Set<string>();
  private isShuttingDown = false;

  trackExecution(id: string): void {
    this.activeExecutions.add(id);
  }

  untrackExecution(id: string): void {
    this.activeExecutions.delete(id);
  }

  beginShutdown(): void {
    this.isShuttingDown = true;
  }

  isShuttingDown_(): boolean {
    return this.isShuttingDown;
  }

  async drain(timeoutMs: number = 30_000): Promise<{ drained: number; remaining: number }> {
    this.beginShutdown();
    const start = Date.now();
    while (this.activeExecutions.size > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return {
      drained: this.activeExecutions.size === 0 ? 1 : 0,
      remaining: this.activeExecutions.size,
    };
  }

  get activeCount(): number {
    return this.activeExecutions.size;
  }
}

// ============================================================================
// Composition Root
// ============================================================================

export function createProductionRuntime(deps: ProductionRuntimeDependencies): ExecutionRuntime {
  const clock = deps.clock || new SystemClock();
  const productionMode = deps.productionMode ?? false;

  // §163: Constructor invariants
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

    // FIX 5: Hard-gate test_token in production
    const authMethod = (deps.authenticator as unknown as { _isDevAuthenticator?: boolean })._isDevAuthenticator;
    if (authMethod === true) {
      throw new Error(
        "PRODUCTION MODE VIOLATION: A development authenticator (TestAuthenticator or dev authenticator) " +
        "was detected in production mode. This is forbidden. " +
        "Configure a real Authenticator (OIDC, mTLS, or custom)."
      );
    }
  }

  // FIX 4: Wrap authenticator to sanitize error messages
  const sanitizedAuthenticator = new SanitizingAuthenticator(deps.authenticator);

  // Create SecureExecutionEngine with ProviderResolver wired in (FIX 2)
  const engine = new SecureExecutionEngine({
    registry: deps.registry,
    authenticator: sanitizedAuthenticator,
    authorityEngine: deps.authorityEngine,
    authorityStore: deps.authorityStore,  // FIX 3: Wire AuthorityStore into pipeline
    policyEngine: deps.policyEngine,
    riskEngine: deps.riskEngine,
    executionStore: deps.executionStore,
    idempotencyStore: deps.idempotencyStore,
    budgetStore: deps.budgetStore,
    eventStore: deps.eventStore,
    auditStore: deps.auditStore,
    events: deps.events,
    approvalService: deps.approvalService,
    providerResolver: deps.providerResolver,  // FIX 2: Wire ProviderResolver
    defaultTimeoutMs: deps.defaultTimeoutMs,
    productionMode,
  });

  const shutdownManager = new GracefulShutdownManager();

  // FIX 1: Properly typed — no `any`
  return {
    execute: async (request: AEPRequest): Promise<AEPResponse> => {
      if (shutdownManager.isShuttingDown_()) {
        return {
          aep: "0.1",
          id: request.id,
          status: "error",
          error: {
            code: "INTERNAL_ERROR",
            message: "Server is shutting down",
            retryable: false,
          },
        };
      }
      // Track execution for graceful drain
      const execId = `track_${request.id}`;
      shutdownManager.trackExecution(execId);
      try {
        const result = await engine.execute(request);
        return result;
      } finally {
        shutdownManager.untrackExecution(execId);
      }
    },

    getExecution: async (id: string, principal: VerifiedPrincipal): Promise<ExecutionRecord | null> => {
      const record = await deps.executionStore.load(id);
      if (!record) return null;
      // §10: Strict object-level authorization
      if (record.principal.id !== principal.id) {
        return null;
      }
      return record;
    },

    cancel: async (id: string, principal: VerifiedPrincipal): Promise<{ state: string }> => {
      const record = await deps.executionStore.load(id);
      if (!record) throw new Error("Execution not found");
      if (record.principal.id !== principal.id) {
        throw new Error("Unauthorized");
      }
      return engine.cancel(id, {
        type: principal.type,
        id: principal.id,
        tenant_id: principal.tenant_id,
      });
    },

    resume: async (id: string, principal: VerifiedPrincipal): Promise<AEPResponse> => {
      const record = await deps.executionStore.load(id);
      if (!record) throw new Error("Execution not found");
      if (record.principal.id !== principal.id) {
        throw new Error("Unauthorized");
      }
      // FIX 12: resume() re-executes if the execution is in a resumable state
      if (record.state === "paused") {
        // Re-execute by calling engine with the original request
        // The engine will pick up from the durable state
        return engine.execute({
          aep: "0.1",
          id: `resume_${id}`,
          type: "execute",
          principal: record.principal,
          capability: record.capability,
          input: record.input,
          execution: { mode: "sync" },
        });
      }
      // For non-paused states, just return the current state
      return {
        aep: "0.1",
        id,
        status: "accepted",
        execution: { id, state: record.state as ExecutionState },
      };
    },

    listExecutions: async (principal: VerifiedPrincipal, filter?: { state?: string; limit?: number }): Promise<ExecutionRecord[]> => {
      const safeFilter: { principal_id?: string; tenant_id?: string; state?: string; limit?: number } = {};
      if (filter?.state) safeFilter.state = filter.state;
      if (filter?.limit) safeFilter.limit = filter.limit;
      // principal_id and tenant_id are ALWAYS from the authenticated principal
      safeFilter.principal_id = principal.id;
      safeFilter.tenant_id = principal.tenant_id;
      return deps.executionStore.list(safeFilter as Parameters<ExecutionStore["list"]>[0]);
    },

    shutdown: async (): Promise<void> => {
      const result = await shutdownManager.drain(30_000);
      if (result.remaining > 0) {
        console.warn(`Shutdown: ${result.remaining} executions still active after drain timeout`);
      }
    },

    health: (): { live: boolean; ready: boolean; details: Record<string, unknown> } => ({
      live: true,
      ready: !shutdownManager.isShuttingDown_(),
      details: {
        productionMode,
        capabilities: deps.registry.stats().total,
        activeExecutions: shutdownManager.activeCount,
        shuttingDown: shutdownManager.isShuttingDown_(),
      },
    }),
  };
}

// ============================================================================
// Development Runtime (separate module to prevent production misuse)
// ============================================================================

const DEV_AUTHENTICATOR_MARKER = "_isDevAuthenticator";

/**
 * FIX 8: Development runtime is clearly separated.
 * It creates a dev authenticator with a marker that production mode detects and rejects.
 */
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

  // FIX 5: Dev authenticator with marker
  const devAuthenticator: Authenticator & { _isDevAuthenticator: true } = {
    _isDevAuthenticator: true,
    authenticate: async (creds: Credentials): Promise<VerifiedPrincipal> => {
      if (creds.type === "bearer_token") {
        const tokenParts = creds.token.split(":");
        const principalId = tokenParts.length > 1 ? tokenParts[1] : creds.token;
        return {
          id: principalId,
          type: "user",
          issuer: "dev",
          authenticated_at: new Date().toISOString(),
          authentication_method: "oauth2",
          claims: {},
          assurance_level: "substantial",
        } as VerifiedPrincipal;
      }
      if (creds.type === "api_key") {
        return {
          id: `key-${creds.key.slice(0, 8)}`,
          type: "service",
          issuer: "dev",
          authenticated_at: new Date().toISOString(),
          authentication_method: "api_key",
          claims: {},
          assurance_level: "substantial",
        } as VerifiedPrincipal;
      }
      if (creds.type === "test_token") {
        return {
          id: creds.principal_id || "dev-user",
          type: "user",
          issuer: "dev",
          authenticated_at: new Date().toISOString(),
          authentication_method: "test_token",
          claims: {},
          assurance_level: "substantial",
        } as VerifiedPrincipal;
      }
      throw new Error("Dev authenticator: unsupported credential type");
    },
  };

  return createProductionRuntime({
    registry,
    authenticator: devAuthenticator,
    authorityEngine,
    policyEngine,
    riskEngine,
    executionStore,
    authorityStore,
    idempotencyStore,
    budgetStore,
    eventStore,
    auditStore: {
      append: async (r) => auditStore.record(r),
      verify: async () => auditStore.verify(),
      list: async () => auditStore.list(),
    },
    events,
    productionMode: false,
    defaultTimeoutMs: 30_000,
  });
}
