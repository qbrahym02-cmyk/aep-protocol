/**
 * Execution Engine
 * Reference: spec/004-execution.md
 * 
 * :
 * - execution records
 * - state transitions
 * - capability handlers
 * - sync/async modes
 * - dry_run
 * - budget
 * - Policy / Risk / Approval
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
  Principal,
  RecoveryAction,
} from "../core/types.js";
import type { CapabilityRegistry, RegisteredCapability } from "../core/registry.js";
import { assertTransition, isTerminal } from "./state-machine.js";
import { IdempotencyCache } from "./idempotency.js";
import { validateCapabilityInput, validateCapabilityOutput } from "../core/validator.js";
import type { EventEmitter } from "../events/emitter.js";

export interface ExecutionEngineOptions {
  registry: CapabilityRegistry;
  events?: EventEmitter;
  policyEngine?: {
    evaluate: (
      principal: Principal,
      capability: CapabilityContract,
      ctx: { input?: unknown; tenant_id?: string; environment?: string }
    ) => { decision: "allow" | "deny" | "approval" | "constrain"; reason_code?: string; matched_rules: string[] };
  };
  riskEngine?: {
    assess: (
      capability: CapabilityContract,
      ctx: { input?: unknown; tenant_id?: string; environment?: string }
    ) => { level: "low" | "medium" | "high" | "critical"; factors?: string[] };
  };
  approvals?: {
    request: (record: ExecutionRecord) => Promise<{
      approval_id: string;
      expires_at: string;
    }>;
    autoApprove?: boolean;
  };
  defaultTimeoutMs?: number;
  idempotencyTtlMs?: number;
  environment?: "test" | "staging" | "production";
}

export class ExecutionEngine {
  private records = new Map<string, ExecutionRecord>();
  private byIdempotencyKey = new IdempotencyCache();
  private cancelCallbacks = new Map<string, Set<() => void>>();
  private opts: ExecutionEngineOptions;

  constructor(opts: ExecutionEngineOptions) {
    this.opts = opts;
  }

  /**
    * AEP — .
    * Path: CREATED → PLANNED → AUTHORIZED → QUEUED → RUNNING → COMPLETED
    */
  async execute(request: AEPRequest): Promise<AEPResponse> {
    // 1) validate envelope basics
    if (!request.id) return this.errorResponse(request, "INVALID_REQUEST", "Missing request id", false);
    if (!request.capability?.id)
      return this.errorResponse(request, "INVALID_REQUEST", "Missing capability id", false);

    // 2) discover capability
    const reg = this.opts.registry.resolve(request.capability);
    if (!reg)
      return this.errorResponse(request, "CAPABILITY_NOT_FOUND", `Capability ${request.capability.id} not found`, false);

    const contract = reg.contract;

    // 3) validate version
    if (request.capability.version) {
      const { satisfies } = await import("../core/semver.js");
      if (!satisfies(contract.version, request.capability.version)) {
        return this.errorResponse(
          request,
          "CAPABILITY_VERSION_UNSUPPORTED",
          `Version ${contract.version} does not satisfy ${request.capability.version}`,
          false
        );
      }
    }

    // 4) idempotency check
    if (request.execution?.idempotency_key) {
      const existing = this.byIdempotencyKey.get(request.execution.idempotency_key);
      if (existing) {
        return this.toResponse(request.id, existing.execution_id, existing.state, existing.output, existing.artifacts, existing.error);
      }
    }

    // 5) create execution record
    const executionId = `exec_${randomUUID().slice(0, 12)}`;
    const traceId = request.trace?.trace_id || `trace_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const deadline = request.execution?.deadline;
    const expires_at = deadline || new Date(Date.now() + (this.opts.defaultTimeoutMs || 60_000) * 10).toISOString();

    const record: ExecutionRecord = {
      id: executionId,
      request_id: request.id,
      principal: request.principal || { type: "system", id: "anonymous" },
      capability: request.capability,
      capability_version: contract.version,
      input: request.input,
      state: "created",
      created_at: now,
      expires_at,
      trace_id: traceId,
      delegation_chain: request.delegation?.delegation_chain,
      budget: request.budget,
      budget_used: { cost_usd: 0, calls: 1, duration_ms: 0 },
      idempotency_key: request.execution?.idempotency_key,
      parent_execution_id: request.delegation?.parent_execution_id,
    };

    this.records.set(executionId, record);
    this.emitEvent("execution.created", record);

    // register idempotency
    if (request.execution?.idempotency_key) {
      this.byIdempotencyKey.upsert(request.execution.idempotency_key, () => ({
        execution_id: executionId,
        state: "created",
        expires_at: Date.now() + (this.opts.idempotencyTtlMs || 24 * 3600_000),
      }));
    }

    // 6) state: planned
    this.transition(record, "planned");
    this.emitEvent("execution.planned", record);

    // 7) policy decision
    if (this.opts.policyEngine) {
      const decision = this.opts.policyEngine.evaluate(record.principal, contract, {
        input: request.input,
        tenant_id: record.principal.tenant_id,
        environment: this.opts.environment || "production",
      });
      record.policy_decision = {
        decision: decision.decision,
        reason_code: decision.reason_code,
        matched_rules: decision.matched_rules,
      };

      if (decision.decision === "deny") {
        this.transition(record, "failed");
        const err: AEPError = {
          code: "POLICY_DENIED",
          message: `Policy denied: ${decision.reason_code || "no reason given"}`,
          retryable: false,
          details: { matched_rules: decision.matched_rules },
          trace_id: traceId,
          execution_id: executionId,
        };
        record.error = err;
        this.emitEvent("execution.failed", record, { error: err });
        this.updateIdempotency(executionId, "failed", undefined, undefined, err);
        return this.toResponse(request.id, executionId, "failed", undefined, undefined, err);
      }
    }

    // 8) risk assessment
    if (this.opts.riskEngine) {
      const risk = this.opts.riskEngine.assess(contract, {
        input: request.input,
        tenant_id: record.principal.tenant_id,
        environment: this.opts.environment || "production",
      });
      record.risk_assessment = risk;
      this.emitEvent("execution.risk_assessed", record, { risk });
    } else {
      record.risk_assessment = { level: contract.risk.level, factors: ["static"] };
    }

    // 9) approval if required
    const needsApproval =
      contract.authorization.require_approval === "always" ||
      (contract.authorization.require_approval === "on_high_risk" &&
        (record.risk_assessment.level === "high" || record.risk_assessment.level === "critical")) ||
      (this.opts.policyEngine && record.policy_decision?.decision === "approval");

    if (needsApproval && !this.opts.approvals?.autoApprove) {
      this.transition(record, "awaiting_approval");
      this.emitEvent("execution.awaiting_approval", record);

      const approvalResp = this.opts.approvals
        ? await this.opts.approvals.request(record)
        : { approval_id: `ap_${randomUUID().slice(0, 8)}`, expires_at: expires_at };

      return {
        aep: "0.1",
        id: request.id,
        status: "approval_required",
        execution: { id: executionId, state: "awaiting_approval" },
        approval: {
          approval_id: approvalResp.approval_id,
          reason: `${contract.id} requires human approval (risk: ${record.risk_assessment.level})`,
          risk: record.risk_assessment.level,
          expires_at: approvalResp.expires_at,
          allowed_decisions: ["approve", "deny", "approve_with_constraints"],
        },
      };
    }

    // 10) authorize + queue
    this.transition(record, "authorized");
    this.emitEvent("execution.authorized", record);
    this.transition(record, "queued");
    this.emitEvent("execution.queued", record);

    // 11) mode: async — return immediately
    if (request.execution?.mode === "async") {
      // run in background
      this.runCapability(record, reg, request).catch((err) => {
        this.failExecution(record, {
          code: "INTERNAL_ERROR",
          message: err?.message || "Unknown error",
          retryable: false,
          trace_id: traceId,
          execution_id: executionId,
        });
      });
      return {
        aep: "0.1",
        id: request.id,
        status: "accepted",
        execution: { id: executionId, state: "running" },
      };
    }

    // 12) sync — run and wait
    const result = await this.runCapability(record, reg, request);
    return this.toResponse(
      request.id,
      executionId,
      record.state,
      result.output,
      result.artifacts,
      record.error
    );
  }

  /**
    * capability .
    */
  private async runCapability(
    record: ExecutionRecord,
    reg: RegisteredCapability,
    request: AEPRequest
  ): Promise<ExecutionResult> {
    const { contract, handler } = reg;
    if (!handler) {
      return this.failExecution(record, {
        code: "INTERNAL_ERROR",
        message: `Capability ${contract.id} registered without handler`,
        retryable: false,
        execution_id: record.id,
        trace_id: record.trace_id,
      });
    }

    // validate input
    if (request.input !== undefined) {
      const result = validateCapabilityInput(request.input, contract);
      if (!result.valid) {
        return this.failExecution(record, {
          code: "SCHEMA_VALIDATION_FAILED",
          message: `Input validation failed: ${result.errors.map((e) => e.path + ": " + e.message).join("; ")}`,
          retryable: false,
          details: { errors: result.errors },
          execution_id: record.id,
          trace_id: record.trace_id,
        });
      }
    }

    // start running
    this.transition(record, "running");
    record.started_at = new Date().toISOString();
    this.emitEvent("execution.started", record);

    const ctx: ExecutionContext = {
      execution_id: record.id,
      request_id: record.request_id,
      principal: record.principal,
      capability: contract,
      input: request.input,
      trace: request.trace,
      budget: request.budget,
      dry_run: request.execution?.dry_run,
      signal: {
        cancelled: false,
        onCancel: (cb) => {
          if (!this.cancelCallbacks.has(record.id)) this.cancelCallbacks.set(record.id, new Set());
          this.cancelCallbacks.get(record.id)!.add(cb);
        },
      },
      emit: (type, data) => {
        this.emitEvent("execution.progress", record, { type, ...data });
      },
    };

    try {
      const handlerFn = handler as CapabilityHandler;
      const result = await handlerFn(ctx);

      // validate output
      if (result.output !== undefined) {
        const outResult = validateCapabilityOutput(result.output, contract);
        if (!outResult.valid) {
          return this.failExecution(record, {
            code: "INTERNAL_ERROR",
            message: `Output validation failed: ${outResult.errors.map((e) => e.path + ": " + e.message).join("; ")}`,
            retryable: false,
            details: { errors: outResult.errors },
            execution_id: record.id,
            trace_id: record.trace_id,
          });
        }
      }

      // budget tracking
      if (result.cost_usd !== undefined && record.budget_used) {
        record.budget_used.cost_usd = (record.budget_used.cost_usd || 0) + result.cost_usd;
      }
      if (record.budget?.max_cost_usd !== undefined && (record.budget_used?.cost_usd || 0) > record.budget.max_cost_usd) {
        return this.failExecution(record, {
          code: "BUDGET_EXCEEDED",
          message: `Cost budget exceeded: used ${record.budget_used?.cost_usd}, max ${record.budget.max_cost_usd}`,
          retryable: false,
          details: record.budget_used,
          execution_id: record.id,
          trace_id: record.trace_id,
        });
      }

      // completed
      this.transition(record, "completed");
      record.completed_at = new Date().toISOString();
      record.result = result.output;
      record.artifacts = result.artifacts || [];
      this.emitEvent("execution.completed", record, { output: result.output });

      // update idempotency
      this.updateIdempotency(record.id, "completed", result.output, result.artifacts);

      return { output: result.output, artifacts: result.artifacts };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = this.classifyError(message);
      const aepErr: AEPError = {
        code,
        message,
        retryable: code === "TIMEOUT" || code === "RATE_LIMITED" || code === "PROVIDER_UNAVAILABLE",
        trace_id: record.trace_id,
        execution_id: record.id,
      };
      return this.failExecution(record, aepErr);
    }
  }

  private classifyError(message: string): AEPError["code"] {
    const m = message.toLowerCase();
    if (m.includes("timeout") || m.includes("timed out")) return "TIMEOUT";
    if (m.includes("rate limit")) return "RATE_LIMITED";
    if (m.includes("unavailable") || m.includes("econnrefused")) return "PROVIDER_UNAVAILABLE";
    if (m.includes("not found")) return "RESOURCE_NOT_FOUND";
    if (m.includes("conflict")) return "RESOURCE_CONFLICT";
    return "INTERNAL_ERROR";
  }

  private failExecution(record: ExecutionRecord, error: AEPError): ExecutionResult {
    if (isTerminal(record.state)) {
      // — 
      return { error };
    }
    record.error = error;
    this.transition(record, "failed");
    this.emitEvent("execution.failed", record, { error });
    this.updateIdempotency(record.id, "failed", undefined, undefined, error);
    return { error };
  }

  /**
    * .
    */
  async cancel(executionId: string): Promise<{ state: ExecutionState } | null> {
    const record = this.records.get(executionId);
    if (!record) return null;
    if (isTerminal(record.state)) return { state: record.state };

    // call cancel callbacks
    const cbs = this.cancelCallbacks.get(executionId);
    if (cbs) for (const cb of cbs) try { cb(); } catch { /* ignore */ }

    this.transition(record, "cancelling");
    this.emitEvent("execution.cancelling", record);
    this.transition(record, "cancelled");
    record.completed_at = new Date().toISOString();
    this.emitEvent("execution.cancelled", record);

    return { state: record.state };
  }

  /**
    * .
    */
  async resume(executionId: string): Promise<{ state: ExecutionState } | null> {
    const record = this.records.get(executionId);
    if (!record) return null;
    if (record.state !== "paused") return { state: record.state };
    this.transition(record, "running");
    this.emitEvent("execution.resumed", record);
    return { state: record.state };
  }

  /**
    * Execution.
    */
  get(executionId: string): ExecutionRecord | undefined {
    return this.records.get(executionId);
  }

  /**
    * Records (tests debugging).
    */
  list(): ExecutionRecord[] {
    return Array.from(this.records.values());
  }

  /**
    * record with Verification .
    */
  private transition(record: ExecutionRecord, to: ExecutionState): void {
    assertTransition(record.state, to);
    record.previous_state = record.state;
    record.state = to;
  }

  private emitEvent(type: string, record: ExecutionRecord, data?: Record<string, unknown>): void {
    if (!this.opts.events) return;
    this.opts.events.emit({
      event_id: `evt_${randomUUID().slice(0, 12)}`,
      type,
      source: "runtime",
      timestamp: new Date().toISOString(),
      execution_id: record.id,
      trace_id: record.trace_id,
      principal: record.principal,
      data: { state: record.state, ...data },
    });
  }

  private updateIdempotency(
    executionId: string,
    state: ExecutionState,
    output?: unknown,
    artifacts?: string[],
    error?: AEPError
  ): void {
    const record = this.records.get(executionId);
    if (!record?.idempotency_key) return;
    this.byIdempotencyKey.update(record.idempotency_key, {
      state,
      output,
      artifacts,
      error,
    });
  }

  private toResponse(
    requestId: string,
    executionId: string,
    state: ExecutionState,
    output?: unknown,
    artifacts?: string[],
    error?: AEPError
  ): AEPResponse {
    if (error) {
      return {
        aep: "0.1",
        id: requestId,
        status: "error",
        execution: { id: executionId, state },
        error,
      };
    }
    return {
      aep: "0.1",
      id: requestId,
      status: state === "completed" ? "completed" : "accepted",
      execution: { id: executionId, state },
      output,
      artifacts,
    };
  }

  private errorResponse(
    request: AEPRequest,
    code: AEPError["code"],
    message: string,
    retryable: boolean,
    recovery: RecoveryAction[] = []
  ): AEPResponse {
    return {
      aep: "0.1",
      id: request.id,
      status: "error",
      error: {
        code,
        message,
        retryable,
        recovery: recovery.length ? recovery : undefined,
        trace_id: request.trace?.trace_id,
      },
    };
  }
}
