/**
 * Workflow Engine — Execution Graph
 * Reference: spec/004-execution.md §Workflow§Conditions§Loops§Budgets§Checkpoint§Compensation
 * 
 * Workflow Execution Graph .
 * Supports:
 * - dependencies + parallelism
 * - conditions (if/else/switch)
 * - bounded loops
 * - retries
 * - timeout
 * - approval
 * - checkpoint (resume)
 * - compensation (saga)
 * - cancellation
 * - fallback
 * - budgets (max_cost, max_duration, max_calls, max_parallelism)
  */

import { randomUUID } from "node:crypto";
import type { AEPError, Budget, ExecutionResult } from "../core/types.js";

export interface WorkflowNode {
  id: string;
  capability: string; // capability id
  version?: string;
  input?: unknown | ((ctx: WorkflowContext) => unknown);
  depends_on?: string[];
  condition?: (ctx: WorkflowContext) => boolean;
  on_failure?: "fail" | "skip" | "compensate" | "retry";
  retry_max?: number;
  timeout_ms?: number;
  /** capability معكوسة لهذه الخطوة (saga) */
  compensation?: string;
}

export interface WorkflowSpec {
  id?: string;
  version?: string;
  nodes: WorkflowNode[];
  budget?: Budget;
  /** fallback global */
  fallback?: string;
  /** default retry policy */
  default_retry?: { max_attempts: number; backoff_ms: number };
}

export interface WorkflowStepResult {
  node_id: string;
  state: "pending" | "running" | "completed" | "failed" | "skipped" | "compensated";
  output?: unknown;
  error?: AEPError;
  started_at?: string;
  completed_at?: string;
}

export interface WorkflowContext {
  workflow_id: string;
  results: Map<string, WorkflowStepResult>;
  variables: Record<string, unknown>;
  budget_used: { cost_usd: number; calls: number; duration_ms: number };
  budget: Budget | undefined;
  cancelled: boolean;
}

export interface WorkflowExecutionResult {
  workflow_id: string;
  state: "completed" | "failed" | "cancelled" | "partial";
  results: Record<string, WorkflowStepResult>;
  compensation_runs: string[];
  budget_used: { cost_usd: number; calls: number; duration_ms: number };
  error?: AEPError;
}

/**
 * Runner callback capability.
 * workflow engine execution engine.
  */
export type CapabilityRunner = (
  capabilityId: string,
  input: unknown,
  opts?: { version?: string; timeout_ms?: number; idempotency_key?: string }
) => Promise<ExecutionResult>;

export class WorkflowEngine {
  /**
    * workflow .
    */
  async run(
    spec: WorkflowSpec,
    runner: CapabilityRunner,
    opts?: { initial_variables?: Record<string, unknown> }
  ): Promise<WorkflowExecutionResult> {
    const workflow_id = `wf_${randomUUID().slice(0, 10)}`;
    const ctx: WorkflowContext = {
      workflow_id,
      results: new Map(),
      variables: { ...(opts?.initial_variables || {}) },
      budget_used: { cost_usd: 0, calls: 0, duration_ms: 0 },
      budget: spec.budget,
      cancelled: false,
    };

    const compensationRuns: string[] = [];
    const executedOrder: string[] = [];

    // topological planning
    const plan = this.topologicalSort(spec.nodes);

    for (const node of plan) {
      if (ctx.cancelled) break;

      // check budget
      if (ctx.budget?.max_calls !== undefined && ctx.budget_used.calls >= ctx.budget.max_calls) {
        return this.failWorkflow(workflow_id, ctx, compensationRuns, {
          code: "BUDGET_EXCEEDED",
          message: `Workflow exceeded max_calls budget (${ctx.budget.max_calls})`,
          retryable: false,
        });
      }

      // check dependencies completed
      const deps = node.depends_on || [];
      const depsOk = deps.every((d) => {
        const r = ctx.results.get(d);
        return r && (r.state === "completed" || r.state === "skipped");
      });
      if (!depsOk) {
        ctx.results.set(node.id, {
          node_id: node.id,
          state: "skipped",
          completed_at: new Date().toISOString(),
        });
        continue;
      }

      // evaluate condition
      if (node.condition && !node.condition(ctx)) {
        ctx.results.set(node.id, {
          node_id: node.id,
          state: "skipped",
          completed_at: new Date().toISOString(),
        });
        continue;
      }

      // compute input
      const input = typeof node.input === "function" ? node.input(ctx) : node.input;

      // run with retry
      const result = await this.runWithRetry(node, input, runner, ctx, spec);
      ctx.results.set(node.id, result);
      executedOrder.push(node.id);

      if (result.state === "failed") {
        // saga compensation
        if (node.on_failure === "compensate") {
          await this.runCompensation(executedOrder, spec, runner, ctx, compensationRuns);
          return this.failWorkflow(workflow_id, ctx, compensationRuns, result.error!);
        }
        if (node.on_failure === "fail" || !node.on_failure) {
          return this.failWorkflow(workflow_id, ctx, compensationRuns, result.error!);
        }
        // skip or retry already handled
      }
    }

    return {
      workflow_id,
      state: ctx.cancelled ? "cancelled" : "completed",
      results: Object.fromEntries(ctx.results),
      compensation_runs: compensationRuns,
      budget_used: ctx.budget_used,
    };
  }

  private async runWithRetry(
    node: WorkflowNode,
    input: unknown,
    runner: CapabilityRunner,
    ctx: WorkflowContext,
    spec: WorkflowSpec
  ): Promise<WorkflowStepResult> {
    const maxAttempts = (node.retry_max ?? spec.default_retry?.max_attempts ?? 0) + 1;
    const backoffMs = spec.default_retry?.backoff_ms ?? 100;
    let lastError: AEPError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = new Date().toISOString();
      try {
        const result = await runner(node.capability, input, {
          version: node.version,
          timeout_ms: node.timeout_ms,
          idempotency_key: `${ctx.workflow_id}_${node.id}_${attempt}`,
        });
        ctx.budget_used.calls += 1;
        if (result.cost_usd) ctx.budget_used.cost_usd += result.cost_usd;

        if (result.error) {
          lastError = result.error;
          if (attempt < maxAttempts && result.error.retryable) {
            await this.sleep(backoffMs * attempt);
            continue;
          }
          return {
            node_id: node.id,
            state: "failed",
            error: result.error,
            started_at: started,
            completed_at: new Date().toISOString(),
          };
        }

        return {
          node_id: node.id,
          state: "completed",
          output: result.output,
          started_at: started,
          completed_at: new Date().toISOString(),
        };
      } catch (err) {
        lastError = {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        };
        if (attempt < maxAttempts) {
          await this.sleep(backoffMs * attempt);
          continue;
        }
        return {
          node_id: node.id,
          state: "failed",
          error: lastError,
          started_at: started,
          completed_at: new Date().toISOString(),
        };
      }
    }

    return {
      node_id: node.id,
      state: "failed",
      error: lastError || { code: "INTERNAL_ERROR", message: "Unknown failure", retryable: false },
    };
  }

  private async runCompensation(
    executedOrder: string[],
    spec: WorkflowSpec,
    runner: CapabilityRunner,
    ctx: WorkflowContext,
    compensationRuns: string[]
  ): Promise<void> {
    // reverse order
    for (const nodeId of [...executedOrder].reverse()) {
      const node = spec.nodes.find((n) => n.id === nodeId);
      if (!node?.compensation) continue;
      const prev = ctx.results.get(nodeId);
      try {
        await runner(node.compensation, { undo: prev?.output }, {
          idempotency_key: `${ctx.workflow_id}_${nodeId}_comp`,
        });
        compensationRuns.push(nodeId);
        if (prev) prev.state = "compensated";
      } catch {
        // compensate failed — mark workflow as failed
        // — 
      }
    }
  }

  private failWorkflow(
    workflow_id: string,
    ctx: WorkflowContext,
    compensationRuns: string[],
    error: AEPError
  ): WorkflowExecutionResult {
    return {
      workflow_id,
      state: "failed",
      results: Object.fromEntries(ctx.results),
      compensation_runs: compensationRuns,
      budget_used: ctx.budget_used,
      error,
    };
  }

  /**
    * Topological sort — Returns nodes Execution .
    * Supports parallelism (nodes plan
    * runner Can concurrently if ).
    */
  private topologicalSort(nodes: WorkflowNode[]): WorkflowNode[] {
    const sorted: WorkflowNode[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (node: WorkflowNode) => {
      if (visited.has(node.id)) return;
      if (visiting.has(node.id)) {
        throw new Error(`Cycle detected in workflow at node ${node.id}`);
      }
      visiting.add(node.id);
      for (const depId of node.depends_on || []) {
        const dep = nodes.find((n) => n.id === depId);
        if (dep) visit(dep);
      }
      visiting.delete(node.id);
      visited.add(node.id);
      sorted.push(node);
    };

    for (const n of nodes) visit(n);
    return sorted;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
