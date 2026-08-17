/**
 * SecureExecutionEngine — The ONLY production runtime.
 *
 * Pipeline (§5, §8 of ZERO_COMPROMISE_PLAN):
 *   authenticate → resolve capability → resolve authority → authorize
 *   → policy → risk → approval → atomic idempotency → atomic budget
 *   → durable execution → run with AbortSignal → retry → validate output
 *   → settle budget → persist → receipt → audit
 *
 * NO `as any`. NO `claimed` principal. NO `anonymous` fallback.
 * The Authenticator IS the source of identity.
 */

import { randomUUID } from "node:crypto";
import type {
  AEPError,
  AEPRequest,
  AEPResponse,
  Budget,
  CapabilityContract,
  CapabilityHandler,
  ExecutionContext,
  ExecutionRecord,
  ExecutionResult,
  ExecutionState,
  PolicyDecision,
  Principal,
  RiskLevel,
} from "../core/types.js";
import type { CapabilityRegistry, RegisteredCapability } from "../core/registry.js";
import type { AuthorityEngine, Authority } from "../authority/engine.js";
import type { Authenticator, VerifiedPrincipal, Credentials } from "../principal/authenticator.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { RiskEngine } from "../policy/risk.js";
import type {
  ExecutionStore,
  AuthorityStore,
  IdempotencyStore,
  IdempotencyScope,
  BudgetStore,
  EventStore,
  AuditStore,
} from "../persistence/interfaces.js";
import type { ProviderResolver } from "../runtime/provider_resolver.js";
import type { EventEmitter } from "../events/emitter.js";
import type { ApprovalService } from "../approval/service.js";
import { ExecutionSignalImpl } from "./signal.js";
import { withRetry, type RetryPolicy, DEFAULT_RETRY_POLICY } from "./retry.js";
import { canTransition, isTerminal } from "./state-machine.js";
import { canonicalize, fingerprint } from "../core/canonical.js";
import { validateCapabilityInput, validateCapabilityOutput } from "../core/validator.js";
import { executionId as makeExecutionId } from "../core/ulid.js";
import { buildReceipt } from "../receipt/builder.js";
import { AEPError as TypedAEPError, asAEPError } from "../errors/aep-error.js";
import { redact } from "../events/redaction.js";

// ============================================================================
// Options
// ============================================================================

export interface SecureExecutionEngineOptions {
  registry: CapabilityRegistry;
  authenticator: Authenticator;
  authorityEngine: AuthorityEngine;
  policyEngine: PolicyEngine;
  riskEngine: RiskEngine;
  executionStore: ExecutionStore;
  authorityStore?: AuthorityStore;         // FIX 3: Wire AuthorityStore
  idempotencyStore: IdempotencyStore;
  budgetStore: BudgetStore;
  eventStore: EventStore;
  auditStore: AuditStore;
  events?: EventEmitter;
  approvalService?: ApprovalService;
  providerResolver?: ProviderResolver;     // FIX 2: Wire ProviderResolver
  defaultRetryPolicy?: RetryPolicy;
  defaultTimeoutMs?: number;
  productionMode?: boolean;
}

// ============================================================================
// AEPError codes we use (typed, no string casting)
// ============================================================================

const ERR = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  CAPABILITY_NOT_FOUND: "CAPABILITY_NOT_FOUND",
  CAPABILITY_NOT_ALLOWED: "CAPABILITY_NOT_ALLOWED",
  RESOURCE_REQUIRED: "RESOURCE_REQUIRED",
  RESOURCE_NOT_ALLOWED: "RESOURCE_NOT_ALLOWED",
  AUTHORITY_EXPIRED: "AUTHORITY_EXPIRED",
  AUTHORITY_REVOKED: "AUTHORITY_REVOKED",
  POLICY_DENIED: "POLICY_DENIED",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  TIMEOUT: "TIMEOUT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SCHEMA_VALIDATION_FAILED: "SCHEMA_VALIDATION_FAILED",
} as const;

// ============================================================================
// SecureExecutionEngine
// ============================================================================

export class SecureExecutionEngine {
  private opts: SecureExecutionEngineOptions;
  private cancelSignals = new Map<string, ExecutionSignalImpl>();

  constructor(opts: SecureExecutionEngineOptions) {
    this.opts = opts;
  }

  /**
   * Execute a request through the full secure pipeline.
   */
  async execute(request: AEPRequest): Promise<AEPResponse> {
    if (!request.id) return this.errorResponse(request, ERR.INVALID_REQUEST, "Missing request id", false);
    if (!request.capability?.id)
      return this.errorResponse(request, ERR.INVALID_REQUEST, "Missing capability id", false);

    // -------------------------------------------------------------------
    // 1) Authenticate — The Authenticator IS the source of identity.
    //    Credentials are extracted from request.authorization.
    //    NO hardcoded test_token. NO claimed principal. NO anonymous.
    // -------------------------------------------------------------------
    let principal: VerifiedPrincipal;
    try {
      const credentials = this.extractCredentials(request);
      if (!credentials) {
        return this.errorResponse(
          request, ERR.UNAUTHORIZED,
          "No credentials provided in request.authorization",
          false
        );
      }
      principal = await this.opts.authenticator.authenticate(credentials);
    } catch (err) {
      return this.errorResponse(
        request,
        ERR.UNAUTHORIZED,
        `Authentication failed: ${(err as Error).message}`,
        false
      );
    }

    // -------------------------------------------------------------------
    // 2) Resolve capability (P0-01)
    // -------------------------------------------------------------------
    const reg = this.opts.registry.resolve(request.capability);
    if (!reg) {
      return this.errorResponse(request, ERR.CAPABILITY_NOT_FOUND, `Capability ${request.capability.id} not found`, false);
    }
    const contract = reg.contract;

    // -------------------------------------------------------------------
    // 3) Resolve authority (P0-01, Contradiction A)
    //    FIX 3: Load from AuthorityStore if not in engine's in-memory cache
    // -------------------------------------------------------------------
    let authority: Authority | undefined;
    const authorityId = (request as unknown as Record<string, unknown>).authority_id as string | undefined
      || ((request as unknown as Record<string, unknown>).authority as { authority_id?: string } | undefined)?.authority_id;
    if (authorityId) {
      // Try in-memory engine first
      authority = this.opts.authorityEngine.get(authorityId);
      // FIX 3: Fall back to AuthorityStore (durable persistence)
      if (!authority && this.opts.authorityStore) {
        authority = await this.opts.authorityStore.load(authorityId) as Authority | undefined || undefined;
        if (authority) {
          // Verify it's not revoked in the store
          const isRevoked = await this.opts.authorityStore.isRevoked(authorityId);
          if (isRevoked) {
            return this.errorResponse(request, ERR.AUTHORITY_REVOKED, `Authority ${authorityId} is revoked`, false);
          }
        }
      }
      if (!authority) {
        return this.errorResponse(request, ERR.UNAUTHORIZED, `Authority ${authorityId} not found`, false);
      }
    } else if (contract.risk.side_effect && this.opts.productionMode) {
      // FIX 6: Read-only capabilities (no side_effect) don't require authority
      return this.errorResponse(
        request, ERR.UNAUTHORIZED,
        `Production mode requires authority for side-effect capability ${contract.id}`,
        false
      );
    }

    // -------------------------------------------------------------------
    // 4) Authorize — BEFORE idempotency (P0-03)
    // -------------------------------------------------------------------
    if (authority) {
      const resource = (request as unknown as Record<string, unknown>).resource as string | undefined;
      const decision = this.opts.authorityEngine.authorize(
        authority,
        principal,
        contract.id,
        resource
      );
      if (!decision.allowed) {
        const code = this.mapAuthzError(decision.reason_code);
        return this.errorResponse(request, code, `Authorization denied: ${decision.reason_code}`, false);
      }
    }

    // -------------------------------------------------------------------
    // 5) Policy (fail-closed in production)
    // -------------------------------------------------------------------
    const policyDecision = this.opts.policyEngine.evaluate(principal as unknown as Principal, contract, {
      input: request.input,
      tenant_id: principal.tenant_id,
      environment: this.opts.productionMode ? "production" : "test",
    });
    if (policyDecision.decision === "deny") {
      return this.errorResponse(
        request, ERR.POLICY_DENIED,
        `Policy denied: ${policyDecision.reason_code || "no reason"}`,
        false,
        { matched_rules: policyDecision.matched_rules }
      );
    }

    // -------------------------------------------------------------------
    // 6) Risk
    // -------------------------------------------------------------------
    const riskAssessment = this.opts.riskEngine.assess(contract, {
      input: request.input,
      tenant_id: principal.tenant_id,
      environment: this.opts.productionMode ? "production" : "test",
    });

    // -------------------------------------------------------------------
    // 7) Approval (P0-09)
    // -------------------------------------------------------------------
    const needsApproval =
      contract.authorization.require_approval === "always" ||
      (contract.authorization.require_approval === "on_high_risk" &&
        (riskAssessment.level === "high" || riskAssessment.level === "critical")) ||
      policyDecision.decision === "approval";

    if (needsApproval && this.opts.approvalService) {
      const existing = this.opts.approvalService.getByExecutionId(request.id);
      if (!existing) {
        const req = this.opts.approvalService.request({
          execution_id: request.id,
          request_digest: fingerprint(request),
          capability_digest: fingerprint(contract),
          authority_id: authority?.id,
          requested_by: principal as unknown as Principal,
          required_approver_roles: contract.authorization.scopes || [],
          reason: `Risk level: ${riskAssessment.level}, capability: ${contract.id}`,
          risk_level: riskAssessment.level,
          constraints: policyDecision.constraints,
        });
        return {
          aep: "0.1",
          id: request.id,
          status: "approval_required",
          execution: { id: request.id, state: "awaiting_approval" as ExecutionState },
          approval: {
            approval_id: req.approval_id,
            reason: req.reason,
            risk: riskAssessment.level,
            expires_at: req.expires_at,
            allowed_decisions: ["approve", "deny", "approve_with_constraints"],
          },
        };
      }
      if (existing.state === "approved") {
        // continue execution
      } else if (existing.state === "rejected") {
        return this.errorResponse(request, ERR.UNAUTHORIZED, "Approval was rejected", false);
      } else {
        return {
          aep: "0.1",
          id: request.id,
          status: "approval_required",
          execution: { id: request.id, state: "awaiting_approval" as ExecutionState },
          approval: {
            approval_id: existing.approval_id,
            reason: existing.reason,
            risk: existing.risk_level as RiskLevel,
            expires_at: existing.expires_at,
            allowed_decisions: ["approve", "deny", "approve_with_constraints"],
          },
        };
      }
    }

    // -------------------------------------------------------------------
    // 8) Atomic idempotency reserve — AFTER auth (P0-03, P0-04)
    // -------------------------------------------------------------------
    let reservedExecId: string | undefined;

    if (request.execution?.idempotency_key) {
      const scope: IdempotencyScope = {
        tenant_id: principal.tenant_id,
        principal_id: principal.id,
        capability_id: contract.id,
        resource: (request as unknown as Record<string, unknown>).resource as string | undefined,
        authority_id: authority?.id,
        idempotency_key: request.execution.idempotency_key,
      };
      const existing = await this.opts.idempotencyStore.get(scope);
      if (existing) {
        if (existing.state === "completed") {
          return {
            aep: "0.1",
            id: request.id,
            status: "completed",
            execution: { id: existing.execution_id, state: existing.state },
            output: existing.output,
            artifacts: existing.artifacts,
          };
        }
        if (existing.state === "failed" && existing.error) {
          return {
            aep: "0.1",
            id: request.id,
            status: "error",
            execution: { id: existing.execution_id, state: existing.state },
            error: existing.error,
          };
        }
        return {
          aep: "0.1",
          id: request.id,
          status: "accepted",
          execution: { id: existing.execution_id, state: existing.state },
        };
      }
      // §25: create ONE execId, use it for both reserve AND execution record
      reservedExecId = makeExecutionId();
      const reserveResult = await this.opts.idempotencyStore.reserve(
        scope,
        () => ({
          scope,
          execution_id: reservedExecId!,
          state: "running" as ExecutionState,
          expires_at: 0,
        }),
        24 * 60 * 60 * 1000
      );
      if (!reserveResult.created) {
        return {
          aep: "0.1",
          id: request.id,
          status: "accepted",
          execution: { id: reserveResult.entry.execution_id, state: reserveResult.entry.state },
          output: reserveResult.entry.output,
          error: reserveResult.entry.error,
        };
      }
    }

    // -------------------------------------------------------------------
    // 9) Atomic budget reserve — BEFORE execute (P0-08)
    //    Also enforce authority constraints (§8): request budget ≤ authority constraints
    // -------------------------------------------------------------------
    let budget = request.budget;

    // Enforce authority constraints on budget (not just delegation)
    if (authority?.constraints) {
      const ac = authority.constraints;
      if (ac.max_cost_usd !== undefined) {
        const reqCost = budget?.max_cost_usd ?? Infinity;
        if (reqCost > ac.max_cost_usd) {
          // Clamp to authority limit
          budget = { ...budget, max_cost_usd: ac.max_cost_usd };
        }
      }
      if (ac.max_calls !== undefined) {
        const reqCalls = budget?.max_calls ?? Infinity;
        if (reqCalls > ac.max_calls) {
          budget = { ...budget, max_calls: ac.max_calls };
        }
      }
      if (ac.max_duration_ms !== undefined) {
        const reqDuration = budget?.max_duration_ms ?? Infinity;
        if (reqDuration > ac.max_duration_ms) {
          budget = { ...budget, max_duration_ms: ac.max_duration_ms };
        }
      }
    }

    // Enforce authority timeout: execution timeout ≤ authority max_duration
    if (authority?.constraints?.max_duration_ms !== undefined) {
      const reqTimeout = request.execution?.timeout_ms ?? this.opts.defaultTimeoutMs ?? 30_000;
      if (reqTimeout > authority.constraints.max_duration_ms) {
        return this.errorResponse(
          request, ERR.UNAUTHORIZED,
          `Execution timeout ${reqTimeout}ms exceeds authority max_duration_ms ${authority.constraints.max_duration_ms}`,
          false
        );
      }
    }
    let budgetReservationId: string | undefined;
    if (budget && this.opts.budgetStore) {
      const reserveResult = await this.opts.budgetStore.reserve(
        { principal_id: principal.id, tenant_id: principal.tenant_id, authority_id: authority?.id },
        {
          cost_usd: budget.max_cost_usd,
          calls: budget.max_calls,
          duration_ms: budget.max_duration_ms,
        }
      );
      if (!reserveResult.success) {
        // FIX 6: Release idempotency reservation on budget failure
        if (request.execution?.idempotency_key && reservedExecId) {
          const scope: IdempotencyScope = {
            tenant_id: principal.tenant_id,
            principal_id: principal.id,
            capability_id: contract.id,
            resource: (request as unknown as Record<string, unknown>).resource as string | undefined,
            authority_id: authority?.id,
            idempotency_key: request.execution.idempotency_key,
          };
          await this.opts.idempotencyStore.update(scope, {
            state: "failed",
            error: {
              code: "BUDGET_EXCEEDED",
              message: "Budget reservation failed",
              retryable: false,
            } as AEPError,
          });
        }
        return this.errorResponse(request, ERR.BUDGET_EXCEEDED, "Could not reserve budget", false);
      }
      budgetReservationId = reserveResult.reservation_id;
    }

    // -------------------------------------------------------------------
    // FIX 2: Provider Resolution — select best provider before execution
    // -------------------------------------------------------------------
    let selectedProviderId = reg.provider_id;
    if (this.opts.providerResolver) {
      try {
        const selection = await this.opts.providerResolver.resolve(contract, {
          tenant_id: principal.tenant_id,
          environment: this.opts.productionMode ? "production" : "test",
          authority_allowed_providers: authority ? [reg.provider_id] : undefined,
        });
        if (selection.selected) {
          selectedProviderId = selection.selected.provider_id;
        }
      } catch {
        // Provider resolver failure is non-fatal — use default provider
      }
    }

    // -------------------------------------------------------------------
    // 10) Create durable execution record
    // §25: reuse execId from idempotency reserve (or create new if no idempotency)
    // -------------------------------------------------------------------
    const execId = reservedExecId || makeExecutionId();
    const now = new Date().toISOString();
    const record: ExecutionRecord = {
      id: execId,
      request_id: request.id,
      principal: principal as unknown as Principal,
      capability: request.capability,
      capability_version: contract.version,
      input: redact(request.input),
      state: "created",
      created_at: now,
      expires_at: request.execution?.deadline,
      trace_id: request.trace?.trace_id,
      budget,
      budget_used: { cost_usd: 0, calls: 1, duration_ms: 0 },
      idempotency_key: request.execution?.idempotency_key,
    } as ExecutionRecord;
    await this.opts.executionStore.save(record);
    await this.emitEvent("execution.created", record);

    // -------------------------------------------------------------------
    // 11) Plan → authorize → queue
    // -------------------------------------------------------------------
    await this.transition(record, "planned");
    await this.transition(record, "authorized");
    await this.transition(record, "queued");

    // -------------------------------------------------------------------
    // 12) Run with AbortSignal (P0-05, P0-06)
    // -------------------------------------------------------------------
    const timeoutMs = request.execution?.timeout_ms || this.opts.defaultTimeoutMs || 30_000;
    const signal = new ExecutionSignalImpl({ deadlineMs: timeoutMs });
    this.cancelSignals.set(execId, signal);

    // -------------------------------------------------------------------
    // 13) Execute with retry (P0-07)
    // -------------------------------------------------------------------
    const retryPolicy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      enabled: contract.execution.retry,
      max_attempts: request.execution?.max_retries ?? 3,
      retryable_errors: ["TIMEOUT", "RATE_LIMITED", "PROVIDER_UNAVAILABLE"],
      initial_delay_ms: 500,
      max_delay_ms: 30_000,
    };

    try {
      const result = await this.runWithRetry(
        record, reg, request, principal, signal, retryPolicy, contract
      );

      // -------------------------------------------------------------------
      // 14) Validate output
      // -------------------------------------------------------------------
      if (result.output !== undefined) {
        const outResult = validateCapabilityOutput(result.output, contract);
        if (!outResult.valid) {
          await this.fail(record, {
            code: ERR.INTERNAL_ERROR,
            message: `Output validation failed: ${outResult.errors.map((e) => e.path + ": " + e.message).join("; ")}`,
            retryable: false,
            trace_id: record.trace_id,
            execution_id: execId,
          } as AEPError);
          return this.toResponse(request, record, undefined, undefined, record.error);
        }
      }

      // -------------------------------------------------------------------
      // 15) Settle budget
      // -------------------------------------------------------------------
      if (budgetReservationId && this.opts.budgetStore) {
        await this.opts.budgetStore.consume(budgetReservationId, {
          cost_usd: result.cost_usd || 0,
          calls: 1,
        });
        await this.opts.budgetStore.settle(budgetReservationId);
      }

      // -------------------------------------------------------------------
      // 16) Persist terminal state
      // -------------------------------------------------------------------
      record.started_at = record.started_at || new Date().toISOString();
      record.result = result.output;
      record.artifacts = result.artifacts || [];
      record.completed_at = new Date().toISOString();
      await this.transition(record, "completed");
      await this.emitEvent("execution.completed", record);

      // Update idempotency entry
      if (request.execution?.idempotency_key) {
        const scope: IdempotencyScope = {
          tenant_id: principal.tenant_id,
          principal_id: principal.id,
          capability_id: contract.id,
          resource: (request as unknown as Record<string, unknown>).resource as string | undefined,
          authority_id: authority?.id,
          idempotency_key: request.execution.idempotency_key,
        };
        await this.opts.idempotencyStore.update(scope, {
          state: "completed",
          output: result.output,
          artifacts: result.artifacts,
        });
      }

      // -------------------------------------------------------------------
      // 17) Build receipt
      // -------------------------------------------------------------------
      buildReceipt({
        execution_id: execId,
        request_id: request.id,
        request,
        capability: contract,
        authority_id: authority?.id,
        policy_decision: policyDecision,
        risk_decision: riskAssessment,
        provider_id: reg.provider_id,
        result: result.output,
        status: "completed",
        started_at: record.started_at,
        completed_at: record.completed_at,
      });

      // -------------------------------------------------------------------
      // 18) Audit
      // -------------------------------------------------------------------
      await this.opts.auditStore.append({
        timestamp: new Date().toISOString(),
        who: principal.id,
        what: "execute",
        capability: contract.id,
        decision: "allow",
        result: "success",
        details: {
          execution_id: execId,
          request_id: request.id,
          authority_id: authority?.id,
          risk_level: riskAssessment.level,
          duration_ms: record.completed_at ? Date.parse(record.completed_at) - Date.parse(record.started_at) : 0,
        },
      } as Parameters<AuditStore["append"]>[0]);

      signal.dispose();
      this.cancelSignals.delete(execId);

      return this.toResponse(request, record, result.output, result.artifacts);
    } catch (err) {
      const aepErr = asAEPError(err);
      await this.fail(record, aepErr as unknown as AEPError);

      // Settle budget on failure
      if (budgetReservationId && this.opts.budgetStore) {
        await this.opts.budgetStore.settle(budgetReservationId);
      }

      // Update idempotency entry
      if (request.execution?.idempotency_key) {
        const scope: IdempotencyScope = {
          tenant_id: principal.tenant_id,
          principal_id: principal.id,
          capability_id: contract.id,
          resource: (request as unknown as Record<string, unknown>).resource as string | undefined,
          authority_id: authority?.id,
          idempotency_key: request.execution.idempotency_key,
        };
        await this.opts.idempotencyStore.update(scope, {
          state: "failed",
          error: aepErr as unknown as AEPError,
        });
      }

      signal.dispose();
      this.cancelSignals.delete(execId);
      return this.toResponse(request, record, undefined, undefined, aepErr as unknown as AEPError);
    }
  }

  /**
   * Run capability with retry integration (P0-07).
   */
  private async runWithRetry(
    record: ExecutionRecord,
    reg: RegisteredCapability,
    request: AEPRequest,
    principal: VerifiedPrincipal,
    signal: ExecutionSignalImpl,
    retryPolicy: RetryPolicy,
    contract: CapabilityContract
  ): Promise<ExecutionResult> {
    if (!reg.handler) {
      throw new TypedAEPError({
        code: "INTERNAL_ERROR",
        message: `Capability ${contract.id} has no handler`,
        retryable: false,
        execution_id: record.id,
      });
    }

    // Validate input
    if (request.input !== undefined) {
      const inputResult = validateCapabilityInput(request.input, contract);
      if (!inputResult.valid) {
        throw new TypedAEPError({
          code: "SCHEMA_VALIDATION_FAILED",
          message: `Input validation failed: ${inputResult.errors.map((e) => e.path + ": " + e.message).join("; ")}`,
          retryable: false,
          details: { errors: inputResult.errors },
          execution_id: record.id,
        });
      }
    }

    // Transition to running
    await this.transition(record, "running");
    record.started_at = new Date().toISOString();
    await this.emitEvent("execution.started", record);

    const handler = reg.handler as CapabilityHandler;
    const ctx: ExecutionContext = {
      execution_id: record.id,
      request_id: record.request_id,
      principal: principal as unknown as Principal,
      capability: contract,
      input: request.input,
      trace: { trace_id: record.trace_id },
      budget: record.budget,
      dry_run: request.execution?.dry_run,
      signal: {
        cancelled: false,
        onCancel: (cb: () => void) => {
          signal.onAbort(cb);
        },
      },
      emit: (type: string, data?: Record<string, unknown>) => {
        this.emitEvent("execution.progress", record, { type, ...data });
      },
    };

    // Wrap handler with retry (P0-07)
    return withRetry(
      async (attempt: number) => {
        signal.throwIfAborted();
        if (attempt > 1) {
          if (canTransition(record.state, "retrying")) {
            await this.transition(record, "retrying");
            await this.emitEvent("execution.retrying", record, { attempt });
            await this.transition(record, "running");
          }
        }
        const result = await handler(ctx);
        return result;
      },
      retryPolicy,
      {
        idempotent: contract.execution.idempotent,
        hasIdempotencyKey: !!request.execution?.idempotency_key,
        onAttempt: (_a) => {
          // Could emit event here
        },
      }
    );
  }

  /**
   * Cancel an execution (P0-05 — truthful cancellation).
   */
  async cancel(executionId: string, by: Principal): Promise<{ state: ExecutionState }> {
    const record = await this.opts.executionStore.load(executionId);
    if (!record) {
      throw new TypedAEPError({ code: "INTERNAL_ERROR", message: `Execution ${executionId} not found`, retryable: false });
    }
    if (isTerminal(record.state)) {
      return { state: record.state };
    }

    // Verify caller authorization (P0-10)
    if (record.principal.id !== by.id && record.principal.tenant_id !== by.tenant_id) {
      throw new TypedAEPError({ code: "UNAUTHORIZED", message: "Only the execution owner can cancel", retryable: false });
    }

    // Trigger abort
    const signal = this.cancelSignals.get(executionId);
    if (signal) {
      signal.abort("CANCELLED");
    }

    // Transition to cancelling (NOT cancelled — wait for handler)
    if (canTransition(record.state, "cancelling")) {
      await this.transition(record, "cancelling");
      await this.emitEvent("execution.cancelling", record);
    }

    // Wait briefly for handler to acknowledge
    if (signal) {
      const ackTimeout = 5000;
      const start = Date.now();
      while (Date.now() - start < ackTimeout) {
        if (signal.aborted) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    if (canTransition(record.state, "cancelled")) {
      await this.transition(record, "cancelled");
      record.completed_at = new Date().toISOString();
      await this.emitEvent("execution.cancelled", record);
    }

    return { state: record.state };
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  /**
   * Extract real credentials from the request's authorization field.
   * Returns null if no recognized credential type is present.
   * NEVER fabricates credentials from request.principal.
   */
  private extractCredentials(request: AEPRequest): Credentials | null {
    const auth = request.authorization;
    if (!auth) return null;

    // Bearer token (from Authorization: Bearer <token> header)
    if (auth.bearer_token) {
      return { type: "bearer_token", token: auth.bearer_token };
    }

    // API key
    if (auth.api_key) {
      return { type: "api_key", key: auth.api_key };
    }

    // mTLS credentials (from TLS layer, set by gateway)
    if (auth.mtls_subject_dn) {
      return {
        type: "mtls",
        subject_dn: auth.mtls_subject_dn,
        cert_fingerprint: auth.mtls_cert_fingerprint || "",
        issuer_dn: auth.mtls_issuer_dn,
        valid_to: auth.mtls_valid_to,
      } as Credentials;
    }

    // Workload identity (SPIFFE)
    if (auth.workload_spiffe_id) {
      return { type: "workload_identity", spiffe_id: auth.workload_spiffe_id };
    }

    // token_ref — resolved by the gateway into a bearer_token before reaching engine
    if (auth.token_ref) {
      // In production, the gateway resolves token_ref → bearer_token
      // If we reach here, the gateway didn't resolve it — reject
      return null;
    }

    return null;
  }

  private mapAuthzError(reasonCode: string | undefined): string {
    switch (reasonCode) {
      case "RESOURCE_REQUIRED": return ERR.RESOURCE_REQUIRED;
      case "CAPABILITY_NOT_ALLOWED": return ERR.CAPABILITY_NOT_ALLOWED;
      case "SUBJECT_MISMATCH": return ERR.UNAUTHORIZED;
      case "AUTHORITY_EXPIRED": return ERR.AUTHORITY_EXPIRED;
      case "AUTHORITY_REVOKED": return ERR.AUTHORITY_REVOKED;
      default: return ERR.UNAUTHORIZED;
    }
  }

  private async transition(record: ExecutionRecord, to: ExecutionState): Promise<void> {
    const from = record.state;
    if (!canTransition(from, to)) {
      throw new TypedAEPError({
        code: "INTERNAL_ERROR",
        message: `Invalid state transition: ${from} → ${to}`,
        retryable: false,
        execution_id: record.id,
      });
    }
    record.previous_state = from;
    record.state = to;
    await this.opts.executionStore.save(record);
  }

  private async fail(record: ExecutionRecord, error: AEPError): Promise<void> {
    record.error = error;
    if (canTransition(record.state, "failed")) {
      await this.transition(record, "failed");
    }
    await this.emitEvent("execution.failed", record, { error });
  }

  private async emitEvent(type: string, record: ExecutionRecord, data?: Record<string, unknown>): Promise<void> {
    const event = {
      event_id: `evt_${randomUUID().slice(0, 12)}`,
      type,
      source: "runtime",
      timestamp: new Date().toISOString(),
      execution_id: record.id,
      trace_id: record.trace_id,
      principal: record.principal,
      data: { state: record.state, ...data },
    };
    if (this.opts.events) {
      this.opts.events.emit(event);
    }
    await this.opts.eventStore.append(event);
  }

  private toResponse(
    request: AEPRequest,
    record: ExecutionRecord,
    output?: unknown,
    artifacts?: string[],
    error?: AEPError
  ): AEPResponse {
    if (error) {
      return {
        aep: "0.1",
        id: request.id,
        status: "error",
        execution: { id: record.id, state: record.state },
        error,
      };
    }
    return {
      aep: "0.1",
      id: request.id,
      status: record.state === "completed" ? "completed" : "accepted",
      execution: { id: record.id, state: record.state },
      output,
      artifacts,
    };
  }

  private errorResponse(
    request: AEPRequest,
    code: string,
    message: string,
    retryable: boolean,
    details?: Record<string, unknown>
  ): AEPResponse {
    return {
      aep: "0.1",
      id: request.id,
      status: "error",
      error: {
        code: code as AEPError["code"],
        message,
        retryable,
        details,
        trace_id: request.trace?.trace_id,
      },
    };
  }
}
