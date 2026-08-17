/**
 * Workflow Artifact — Executable Workflow File
 * Reference: spec/profiles/workflow.md
 * 
 * :
 * validate  — Verification (syntax + DAG + capabilities)
 * simulate   — without side effect (dry_run )
 * plan       — execution plan (topological order + parallel groups)
 * execute    — with compensation saga
 * replay     — Retry timeline Events
 * 
 * File format:
 * YAML  (.aep.yaml)  — yaml parser
 * JSON  (.aep.json)
  */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  AEPError,
  Budget,
  CapabilityContract,
  Principal,
} from "../core/types.js";
import type { CapabilityRegistry } from "../core/registry.js";
import type { AuthorityEngine, Authority } from "../authority/engine.js";
import { WorkflowEngine, type CapabilityRunner, type WorkflowSpec } from "../workflow/engine.js";

// ============================================================================
// Workflow Artifact Types
// ============================================================================

export interface WorkflowInput {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface WorkflowAuthoritySpec {
  required_capabilities: string[];
  required_resources?: string[];
  constraints?: {
    max_duration_ms?: number;
    max_cost_usd?: number;
    max_calls?: number;
  };
}

export interface WorkflowDefaults {
  retry?: { max_attempts: number; backoff_ms: number };
  on_failure?: "fail" | "skip" | "compensate" | "retry";
}

export interface WorkflowArtifactNode {
  id: string;
  capability: string;            // capability id, or "kind: approval" for approval nodes
  version?: string;
  inputs?: Record<string, unknown>;
  depends_on?: string[];
  condition?: string;            // expression
  on_failure?: "fail" | "skip" | "compensate" | "retry";
  retry?: { max_attempts: number; backoff_ms: number };
  timeout_ms?: number;
  compensation?: string;
  checkpoint?: boolean;
  kind?: "capability" | "approval";
  approval?: {
    reason: string;
    expires_in?: string;
    allowed_decisions?: string[];
  };
}

export interface WorkflowArtifact {
  name: string;
  version: string;
  description?: string;
  author?: string;
  inputs?: WorkflowInput[];
  authority?: WorkflowAuthoritySpec;
  budget?: Budget;
  defaults?: WorkflowDefaults;
  nodes: WorkflowArtifactNode[];
}

// ============================================================================
// Validation Result
// ============================================================================

export interface ValidationIssue {
  severity: "error" | "warning";
  node_id?: string;
  message: string;
}

export const errIssue = (message: string, node_id?: string): ValidationIssue => ({ severity: "error", node_id, message });
export const warnIssue = (message: string, node_id?: string): ValidationIssue => ({ severity: "warning", node_id, message });

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// ============================================================================
// Plan Result
// ============================================================================

export interface ExecutionPlan {
  plan_id: string;
  topological_order: string[];
  parallel_groups: string[][];
  approvals_required: string[];
  compensation_chain: string[];
  estimated_cost_usd: number;
  estimated_duration_ms: number;
}

// ============================================================================
// Simulation Result
// ============================================================================

export interface SimulationResult {
  would_execute: string[];
  would_skip: string[];
  estimated_cost_usd: number;
  estimated_duration_ms: number;
  blast_radius: {
    resources: number;
    services: number;
    financial_exposure: number;
  };
  approvals_required: string[];
  errors: string[];
}

// ============================================================================
// Replay Result
// ============================================================================

export interface ReplayEvent {
  t: number;
  event: string;
  data?: Record<string, unknown>;
}

export interface ReplayResult {
  execution_id: string;
  timeline: ReplayEvent[];
  final_state: string;
  audit_chain_valid: boolean;
}

// ============================================================================
// Workflow Artifact Engine
// ============================================================================

export interface ArtifactEngineOptions {
  registry: CapabilityRegistry;
  authority?: AuthorityEngine;
  workflowEngine?: WorkflowEngine;
  runner?: CapabilityRunner;
}

export class WorkflowArtifactEngine {
  private opts: ArtifactEngineOptions;

  constructor(opts: ArtifactEngineOptions) {
    this.opts = opts;
  }

  /**
    * workflow .
    */
  loadFile(path: string): WorkflowArtifact {
    const content = readFileSync(path, "utf-8");
    if (path.endsWith(".yaml") || path.endsWith(".yml")) {
      // simple YAML parser — for production use a proper yaml lib
      return this.parseSimpleYaml(content);
    }
    return JSON.parse(content);
  }

  /**
    * workflow object.
    */
  loadObject(obj: WorkflowArtifact): WorkflowArtifact {
    return obj;
  }

  // ========================================================================
  // validate
  // ========================================================================

  validate(workflow: WorkflowArtifact): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // 1) basic fields
    if (!workflow.name) errors.push(errIssue("Missing name"));
    if (!workflow.version) errors.push(errIssue("Missing version"));
    if (!workflow.nodes || workflow.nodes.length === 0) {
      errors.push(errIssue("Must have at least one node"));
    }

    // 2) unique node ids
    const ids = new Set<string>();
    for (const node of workflow.nodes) {
      if (ids.has(node.id)) {
        errors.push(errIssue("Duplicate node id", node.id));
      }
      ids.add(node.id);
    }

    // 3) depends_on refers to existing nodes
    for (const node of workflow.nodes) {
      for (const dep of node.depends_on || []) {
        if (!ids.has(dep)) {
          errors.push(errIssue(`depends_on refers to unknown node '${dep}'`, node.id));
        }
      }
    }

    // 4) no cycles (topological sort)
    try {
      this.topologicalSort(workflow.nodes);
    } catch (err) {
      errors.push(errIssue(`Cycle detected: ${(err as Error).message}`));
    }

    // 5) capability exists in registry
    for (const node of workflow.nodes) {
      if (node.kind === "approval") continue;
      const reg = this.opts.registry.resolve({ id: node.capability });
      if (!reg) {
        errors.push(errIssue(`Capability '${node.capability}' not found in registry`, node.id));
      }
    }

    // 6) approval nodes have reason
    for (const node of workflow.nodes) {
      if (node.kind === "approval" && !node.approval?.reason) {
        errors.push(errIssue("Approval node missing 'approval.reason'", node.id));
      }
    }

    // 7) compensation defined when on_failure: compensate
    for (const node of workflow.nodes) {
      if (node.on_failure === "compensate" && !node.compensation) {
        warnings.push(warnIssue("Uses on_failure: compensate but no compensation defined", node.id));
      }
    }

    // 8) no timeout_ms
    for (const node of workflow.nodes) {
      if (node.kind !== "approval" && !node.timeout_ms) {
        warnings.push(warnIssue("No timeout_ms — defaulting to 30s", node.id));
      }
    }

    // 9) authority covers capabilities
    if (workflow.authority) {
      const required = new Set(workflow.authority.required_capabilities);
      for (const node of workflow.nodes) {
        if (node.kind === "approval") continue;
        const covered = Array.from(required).some(
          (cap) => cap === node.capability || cap === "*"
        );
        if (!covered) {
          errors.push(errIssue(`Capability '${node.capability}' not declared in authority.required_capabilities`, node.id));
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ========================================================================
  // plan
  // ========================================================================

  plan(workflow: WorkflowArtifact, inputs: Record<string, unknown> = {}): ExecutionPlan {
    const validation = this.validate(workflow);
    if (!validation.valid) {
      throw new Error(`Workflow invalid: ${validation.errors.map((e) => e.message).join("; ")}`);
    }

    const sorted = this.topologicalSort(workflow.nodes);
    const parallelGroups = this.computeParallelGroups(workflow.nodes, sorted);
    const approvals = workflow.nodes
      .filter((n) => n.kind === "approval")
      .map((n) => n.id);
    const compensationChain = workflow.nodes
      .filter((n) => n.on_failure === "compensate" && n.compensation)
      .map((n) => n.id);

    // estimate
    let estCost = 0;
    let estDuration = 0;
    for (const node of workflow.nodes) {
      if (node.kind === "approval") continue;
      const reg = this.opts.registry.resolve({ id: node.capability });
      if (reg) {
        if (reg.contract.cost?.estimated) estCost += reg.contract.cost.estimated;
        if (reg.contract.performance?.p95_ms) {
          estDuration += reg.contract.performance.p95_ms;
        } else {
          estDuration += node.timeout_ms || 30000;
        }
      }
    }

    return {
      plan_id: `plan_${randomUUID().slice(0, 10)}`,
      topological_order: sorted.map((n) => n.id),
      parallel_groups: parallelGroups,
      approvals_required: approvals,
      compensation_chain: compensationChain,
      estimated_cost_usd: Math.round(estCost * 1000) / 1000,
      estimated_duration_ms: estDuration,
    };
  }

  // ========================================================================
  // simulate
  // ========================================================================

  async simulate(
    workflow: WorkflowArtifact,
    inputs: Record<string, unknown> = {},
    authority?: Authority
  ): Promise<SimulationResult> {
    const validation = this.validate(workflow);
    if (!validation.valid) {
      return {
        would_execute: [],
        would_skip: [],
        estimated_cost_usd: 0,
        estimated_duration_ms: 0,
        blast_radius: { resources: 0, services: 0, financial_exposure: 0 },
        approvals_required: [],
        errors: validation.errors.map((e) => e.message),
      };
    }

    const plan = this.plan(workflow, inputs);
    const wouldExecute: string[] = [];
    const wouldSkip: string[] = [];

    // resolve expressions + check conditions
    for (const node of workflow.nodes) {
      // check condition
      if (node.condition) {
        const ctx = { inputs, results: new Map() };
        const condResult = this.evalExpression(node.condition, ctx);
        if (!condResult) {
          wouldSkip.push(node.id);
          continue;
        }
      }
      if (node.kind === "approval") {
        wouldExecute.push(node.id);
        continue;
      }
      wouldExecute.push(node.id);
    }

    return {
      would_execute: wouldExecute,
      would_skip: wouldSkip,
      estimated_cost_usd: plan.estimated_cost_usd,
      estimated_duration_ms: plan.estimated_duration_ms,
      blast_radius: {
        resources: wouldExecute.length,
        services: new Set(
          wouldExecute
            .map((id) => workflow.nodes.find((n) => n.id === id))
            .filter((n) => n && n.kind !== "approval")
            .map((n) => n!.capability.split(".")[0])
        ).size,
        financial_exposure: 0,
      },
      approvals_required: plan.approvals_required,
      errors: [],
    };
  }

  // ========================================================================
  // execute
  // ========================================================================

  async execute(
    workflow: WorkflowArtifact,
    inputs: Record<string, unknown> = {},
    opts: { principal: Principal; authority?: Authority; runner?: CapabilityRunner }
  ): Promise<{
    execution_id: string;
    state: "completed" | "failed" | "cancelled" | "partial";
    results: Record<string, unknown>;
    budget_used: { cost_usd: number; calls: number; duration_ms: number };
    approvals?: Array<{ approval_id: string; decision: string }>;
    error?: AEPError;
  }> {
    const validation = this.validate(workflow);
    if (!validation.valid) {
      return {
        execution_id: `exec_${randomUUID().slice(0, 10)}`,
        state: "failed",
        results: {},
        budget_used: { cost_usd: 0, calls: 0, duration_ms: 0 },
        error: {
          code: "INVALID_REQUEST",
          message: `Workflow validation failed: ${validation.errors.map((e) => e.message).join("; ")}`,
          retryable: false,
        },
      };
    }

    // convert to WorkflowSpec for the existing engine
    const spec: WorkflowSpec = {
      id: workflow.name,
      version: workflow.version,
      budget: workflow.budget,
      default_retry: workflow.defaults?.retry,
      nodes: workflow.nodes
        .filter((n) => n.kind !== "approval")
        .map((n) => ({
          id: n.id,
          capability: n.capability,
          version: n.version,
          input: this.resolveInputs(n.inputs, inputs, new Map()),
          depends_on: n.depends_on,
          condition: n.condition
            ? (ctx) => Boolean(this.evalExpression(n.condition!, { inputs, results: ctx.results }))
            : undefined,
          on_failure: n.on_failure,
          retry_max: n.retry?.max_attempts,
          timeout_ms: n.timeout_ms,
          compensation: n.compensation,
        })),
    };

    const engine = this.opts.workflowEngine || new WorkflowEngine();
    const runner = opts.runner || this.opts.runner;
    if (!runner) {
      throw new Error("No capability runner provided");
    }
    const result = await engine.run(spec, runner, { initial_variables: inputs });

    return {
      execution_id: `exec_${randomUUID().slice(0, 10)}`,
      state: result.state,
      results: Object.fromEntries(
        Object.entries(result.results).map(([k, v]) => [k, v.output])
      ),
      budget_used: result.budget_used,
      error: result.error,
    };
  }

  // ========================================================================
  // replay (stub — needs event log access)
  // ========================================================================

  replay(events: Array<{ event_id: string; type: string; timestamp: string; data?: Record<string, unknown> }>): ReplayResult {
    const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const t0 = sorted.length > 0 ? new Date(sorted[0].timestamp).getTime() : 0;
    const timeline = sorted.map((e) => ({
      t: new Date(e.timestamp).getTime() - t0,
      event: e.type,
      data: e.data,
    }));
    const finalEvent = sorted[sorted.length - 1];
    const finalState = finalEvent?.type.split(".")[1] || "unknown";
    return {
      execution_id: `exec_${randomUUID().slice(0, 10)}`,
      timeline,
      final_state: finalState,
      audit_chain_valid: true,
    };
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  /**
    * Topological sort using DFS.
    */
  private topologicalSort(nodes: WorkflowArtifactNode[]): WorkflowArtifactNode[] {
    const sorted: WorkflowArtifactNode[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const visit = (node: WorkflowArtifactNode) => {
      if (visited.has(node.id)) return;
      if (visiting.has(node.id)) {
        throw new Error(`Cycle at node ${node.id}`);
      }
      visiting.add(node.id);
      for (const depId of node.depends_on || []) {
        const dep = nodeMap.get(depId);
        if (dep) visit(dep);
      }
      visiting.delete(node.id);
      visited.add(node.id);
      sorted.push(node);
    };

    for (const n of nodes) visit(n);
    return sorted;
  }

  /**
    * Group nodes into parallel batches based on dependencies.
    */
  private computeParallelGroups(
    nodes: WorkflowArtifactNode[],
    sorted: WorkflowArtifactNode[]
  ): string[][] {
    const groups: string[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(sorted.map((n) => n.id));

    while (remaining.size > 0) {
      const batch: string[] = [];
      for (const id of remaining) {
        const node = sorted.find((n) => n.id === id)!;
        const depsReady = (node.depends_on || []).every((d) => completed.has(d));
        if (depsReady) batch.push(id);
      }
      if (batch.length === 0) {
        // stuck — shouldn't happen if no cycles
        break;
      }
      groups.push(batch);
      for (const id of batch) {
        completed.add(id);
        remaining.delete(id);
      }
    }
    return groups;
  }

  /**
    * Resolve inputs: replace ${inputs.X} and ${node.output.Y}.
    */
  private resolveInputs(
    inputs: Record<string, unknown> | undefined,
    workflowInputs: Record<string, unknown>,
    nodeResults: Map<string, unknown>
  ): Record<string, unknown> | undefined {
    if (!inputs) return undefined;
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(inputs)) {
      resolved[k] = this.resolveValue(v, workflowInputs, nodeResults);
    }
    return resolved;
  }

  private resolveValue(
    value: unknown,
    workflowInputs: Record<string, unknown>,
    nodeResults: Map<string, unknown>
  ): unknown {
    if (typeof value === "string") {
      return this.evalExpression(value, { inputs: workflowInputs, results: nodeResults });
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.resolveValue(v, workflowInputs, nodeResults));
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = this.resolveValue(v, workflowInputs, nodeResults);
      }
      return out;
    }
    return value;
  }

  /**
    * Eval expression: ${inputs.X} or ${node.output.Y} or ${!inputs.skip_tests}.
    */
  private evalExpression(
    expr: string,
    ctx: { inputs: Record<string, unknown>; results: Map<string, unknown> }
  ): unknown {
    // match ${...}
    const matches = expr.matchAll(/\$\{([^}]+)\}/g);
    let result: string = expr;
    let isBoolean = false;

    if (expr.startsWith("${") && expr.endsWith("}") && expr.match(/^\$\{[^}]+\}$/)) {
      // single expression — return native type
      const inner = expr.slice(2, -1).trim();
      const val = this.evalInner(inner, ctx);
      if (typeof val === "boolean") return val;
      return val;
    }

    // string interpolation
    for (const m of matches) {
      const inner = m[1];
      const val = this.evalInner(inner, ctx);
      result = result.replace(m[0], String(val));
    }
    return result;
  }

  private evalInner(
    expr: string,
    ctx: { inputs: Record<string, unknown>; results: Map<string, unknown> }
  ): unknown {
    expr = expr.trim();
    if (expr.startsWith("!")) {
      const v = this.evalInner(expr.slice(1), ctx);
      return !v;
    }
    if (expr.startsWith("inputs.")) {
      const path = expr.slice("inputs.".length).split(".");
      let v: unknown = ctx.inputs;
      for (const p of path) v = (v as Record<string, unknown>)?.[p];
      return v;
    }
    if (expr.includes(".output.")) {
      const [nodeId, ...pathParts] = expr.split(".output.");
      const path = pathParts.join(".").split(".");
      let v: unknown = (ctx.results.get(nodeId) as { output?: unknown })?.output;
      for (const p of path) v = (v as Record<string, unknown>)?.[p];
      return v;
    }
    return expr;
  }

  /**
    * Simple YAML parser — only handles basic structure.
    * For production: use 'yaml' or 'js-yaml' package.
    */
  private parseSimpleYaml(content: string): WorkflowArtifact {
    // Use JSON as fallback — recommend users provide JSON
    throw new Error(
      "YAML parsing requires 'yaml' package. For now, please use .aep.json format or install 'yaml' package."
    );
  }
}
