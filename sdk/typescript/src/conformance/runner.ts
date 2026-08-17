/**
 * Conformance Suite Runner
 * Reference: spec/007 §Conformance Suite§110 §Golden Test Vectors
 * 
 * Verifies :
 * - core envelope parsing
 * - canonical / fingerprint
 * - semver matching
 * - capability registration + discovery (progressive disclosure)
 * - sync execution path (Client → Discovery → Capability → Execute → Typed Result)
 * - error model
 * - state machine
 * - idempotency
 * - policy engine
 * - risk engine
 * - workflow engine (deps, parallel, conditions, compensation)
 * - event emitter (subscribe, replay, backpressure)
 * - audit (tamper-evident hash chain)
  */

import { AEPServer, type CapabilityDefinition } from "../server.js";
import { CapabilityRegistry } from "../core/registry.js";
import { canonicalize, fingerprint, auditHash } from "../core/canonical.js";
import { satisfies, parseSemVer } from "../core/semver.js";
import { validate } from "../core/validator.js";
import { canTransition, isTerminal } from "../execution/state-machine.js";
import { IdempotencyCache } from "../execution/idempotency.js";
import { PolicyEngine } from "../policy/engine.js";
import { RiskEngine, estimateBlastRadius } from "../policy/risk.js";
import { WorkflowEngine, type WorkflowSpec, type WorkflowContext } from "../workflow/engine.js";
import { EventEmitter } from "../events/emitter.js";
import { AuditEngine } from "../events/audit.js";
import { ArtifactManager } from "../events/artifacts.js";
import { BUILTIN_CAPABILITIES } from "../providers/builtin.js";
import { AuthorityEngine, AuthorityError } from "../authority/engine.js";
import { CapabilityResolver } from "../discovery/resolver.js";
import { WorkflowArtifactEngine } from "../workflow-artifact/engine.js";
import type {
  AEPRequest,
  AEPResponse,
  ExecutionState,
} from "../core/types.js";

export interface ConformanceResult {
  name: string;
  pass: boolean;
  error?: string;
}

async function test(
  results: ConformanceResult[],
  name: string,
  fn: () => void | Promise<void>
): Promise<void> {
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({
      name,
      pass: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export async function runConformance(): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];

  // -----------------------------------------------------------------------
  // 1. Canonicalization
  // -----------------------------------------------------------------------
  await test(results, "canonical: deterministic ordering", () => {
    const a = canonicalize({ b: 2, a: 1, c: { z: 1, y: 2 } });
    const b = canonicalize({ c: { y: 2, z: 1 }, a: 1, b: 2 });
    assertEq(a, b, "canonical should be deterministic");
    assertEq(a, '{"a":1,"b":2,"c":{"y":2,"z":1}}', "canonical form check");
  });

  await test(results, "canonical: undefined skipped", () => {
    assertEq(canonicalize({ a: 1, b: undefined }), '{"a":1}', "undefined omitted");
  });

  await test(results, "fingerprint: SHA-256 deterministic", () => {
    const fp1 = fingerprint({ id: "x", version: "1.0.0" });
    const fp2 = fingerprint({ version: "1.0.0", id: "x" });
    assertEq(fp1, fp2, "fingerprint should be canonical");
    assert(fp1.length === 64, "sha256 hex length");
  });

  await test(results, "audit hash chain: tamper-evident", () => {
    let h0 = "0".repeat(64);
    const h1 = auditHash({ who: "alice", action: "x" }, h0);
    const h2 = auditHash({ who: "bob", action: "y" }, h1);
    assert(h1 !== h2, "hashes differ");
    assert(h1.length === 64 && h2.length === 64, "32-byte hex");
  });

  // -----------------------------------------------------------------------
  // 2. SemVer
  // -----------------------------------------------------------------------
  await test(results, "semver: parse exact", () => {
    const v = parseSemVer("1.2.3");
    assert(v !== null, "should parse");
    assertEq(v!.major, 1, "major");
    assertEq(v!.minor, 2, "minor");
    assertEq(v!.patch, 3, "patch");
  });

  await test(results, "semver: exact match", () => {
    assert(satisfies("1.2.3", "1.2.3"), "exact match");
    assert(!satisfies("1.2.4", "1.2.3"), "exact non-match");
  });

  await test(results, "semver: caret range", () => {
    assert(satisfies("1.5.0", "^1.2"), "caret: 1.5.0 satisfies ^1.2");
    assert(satisfies("1.2.0", "^1.2"), "caret: 1.2.0 satisfies ^1.2");
    assert(!satisfies("2.0.0", "^1.2"), "caret: 2.0.0 fails ^1.2");
    assert(satisfies("0.2.5", "^0.2.3"), "caret: 0.2.5 satisfies ^0.2.3");
    assert(!satisfies("0.3.0", "^0.2.3"), "caret: 0.3.0 fails ^0.2.3");
  });

  await test(results, "semver: tilde range", () => {
    assert(satisfies("1.2.5", "~1.2.3"), "tilde: 1.2.5 satisfies ~1.2.3");
    assert(!satisfies("1.3.0", "~1.2.3"), "tilde: 1.3.0 fails ~1.2.3");
  });

  await test(results, "semver: star", () => {
    assert(satisfies("99.99.99", "*"), "star matches all");
  });

  await test(results, "semver: OR", () => {
    assert(satisfies("1.2.3", "1.2.3 || 1.5.0"), "first OR match");
    assert(satisfies("1.5.0", "1.2.3 || 1.5.0"), "second OR match");
    assert(!satisfies("1.4.0", "1.2.3 || 1.5.0"), "neither OR");
  });

  // -----------------------------------------------------------------------
  // 3. Schema validation
  // -----------------------------------------------------------------------
  await test(results, "validator: basic object schema", () => {
    const schema = {
      type: "object",
      required: ["a"],
      properties: { a: { type: "number" }, b: { type: "string" } },
    };
    assert(validate({ a: 1 }, schema).valid, "valid");
    assert(!validate({ b: "x" }, schema).valid, "missing required");
    assert(!validate({ a: "x" }, schema).valid, "wrong type");
  });

  // -----------------------------------------------------------------------
  // 4. Capability Registry
  // -----------------------------------------------------------------------
  await test(results, "registry: register and resolve", () => {
    const reg = new CapabilityRegistry();
    const cap = BUILTIN_CAPABILITIES[0]; // math.add
    reg.register({ ...capToContract(cap) }, { handler: cap.execute });
    const r = reg.resolve({ id: "math.add" });
    assert(r !== null, "should resolve");
    assertEq(r!.contract.id, "math.add", "id match");
  });

  await test(results, "registry: provider independence — same id multiple providers", () => {
    const reg = new CapabilityRegistry();
    const contract1 = capToContract(BUILTIN_CAPABILITIES.find((c) => c.id === "github.issue.create")!);
    const contract2 = capToContract(BUILTIN_CAPABILITIES.find((c) => c.id === "linear.issue.create")!);
    reg.register({ ...contract1, id: "issue.create", provider: { id: "github" } }, { provider_id: "github" });
    reg.register({ ...contract2, id: "issue.create", provider: { id: "linear" } }, { provider_id: "linear" });
    const items = reg.discover({ id: "issue.create" });
    assertEq(items.length, 2, "should have 2 providers");
  });

  await test(results, "registry: discover with progressive disclosure", () => {
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) {
      reg.register(capToContract(c), { handler: c.execute });
    }
    const level1 = reg.discover({ level: 1 });
    const level2 = reg.discover({ level: 2 });
    assert(level1.length > 0, "level 1 has results");
    assert(level2.length > 0, "level 2 has results");
    assert(level1.every((i) => i.contract === undefined), "level 1: no contract");
    assert(level2.every((i) => i.contract !== undefined), "level 2: has contract");
  });

  await test(results, "registry: discover by kind", () => {
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const actions = reg.discover({ kind: "action" });
    assert(actions.every((c) => c.kind === "action"), "all actions");
    assert(actions.length > 0, "has actions");
  });

  await test(results, "registry: discover by semantic_class", () => {
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const items = reg.discover({ semantic_class: "issue.creation" });
    assert(items.length >= 2, "github + linear");
    assert(items.every((c) => c.semantic_class === "issue.creation"), "all have same semantic_class");
  });

  await test(results, "registry: discover with risk filter", () => {
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const items = reg.discover({
      intent: { constraints: { risk_max: "low" } },
    });
    assert(items.every((c) => c.risk_level === "low"), "all low risk");
  });

  // -----------------------------------------------------------------------
  // 5. Execution Engine — Golden Path
  // -----------------------------------------------------------------------
  await test(results, "execute: golden path (sync)", async () => {
    const server = new AEPServer();
    server.capability(BUILTIN_CAPABILITIES[0]); // math.add
    const response = await server.execute({
      aep: "0.1",
      id: "req_test1",
      type: "execute",
      principal: { type: "user", id: "alice" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "math.add" },
      input: { a: 2, b: 3 },
      execution: { mode: "sync" },
    });
    assertEq(response.status, "completed", "should complete");
    assertEq((response.output as { result: number }).result, 5, "2+3=5");
  });

  await test(results, "execute: capability_not_found", async () => {
    const server = new AEPServer();
    const response = await server.execute({
      aep: "0.1",
      id: "req_test2",
      type: "execute",
      principal: { type: "user", id: "alice" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "nonexistent.cap" },
      input: {},
    });
    assertEq(response.status, "error", "should error");
    assertEq(response.error!.code, "CAPABILITY_NOT_FOUND", "code");
  });

  await test(results, "execute: schema_validation_failed", async () => {
    const server = new AEPServer();
    server.capability(BUILTIN_CAPABILITIES[0]);
    const response = await server.execute({
      aep: "0.1",
      id: "req_test3",
      type: "execute",
      principal: { type: "user", id: "alice" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "math.add" },
      input: { a: "not-a-number", b: 3 },
    });
    assertEq(response.status, "error", "should error");
    assertEq(response.error!.code, "SCHEMA_VALIDATION_FAILED", "code");
  });

  await test(results, "execute: idempotency", async () => {
    const server = new AEPServer();
    server.capability(BUILTIN_CAPABILITIES.find((c) => c.id === "github.issue.create")!);
    const req: AEPRequest = {
      aep: "0.1",
      id: "req_idem",
      type: "execute",
      principal: { type: "agent", id: "agent_01" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "github.issue.create" },
      input: { repository: "acme/project", title: "Test issue" },
      execution: { idempotency_key: "key_abc" },
    };
    const r1 = await server.execute(req);
    const r2 = await server.execute(req);
    assertEq(r1.execution!.id, r2.execution!.id, "same execution_id");
    assertEq((r1.output as { number: number }).number, (r2.output as { number: number }).number, "same issue number");
  });

  await test(results, "execute: dry_run returns would_change", async () => {
    const server = new AEPServer();
    server.capability(BUILTIN_CAPABILITIES.find((c) => c.id === "github.issue.create")!);
    const response = await server.execute({
      aep: "0.1",
      id: "req_dry",
      type: "execute",
      principal: { type: "user", id: "alice" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "github.issue.create" },
      input: { repository: "acme/project", title: "Test" },
      execution: { dry_run: true },
    });
    assertEq(response.status, "completed", "dry run completes");
    assert((response.output as { would_change: boolean }).would_change === true, "would_change flag");
  });

  await test(results, "execute: async returns accepted", async () => {
    const server = new AEPServer();
    server.capability(BUILTIN_CAPABILITIES[0]);
    const response = await server.execute({
      aep: "0.1",
      id: "req_async",
      type: "execute",
      principal: { type: "user", id: "alice" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "math.add" },
      input: { a: 1, b: 2 },
      execution: { mode: "async" },
    });
    assert(response.status === "accepted" || response.status === "completed", "async status");
    assert(response.execution!.id.startsWith("exec_"), "execution_id");
  });

  // -----------------------------------------------------------------------
  // 6. State Machine
  // -----------------------------------------------------------------------
  await test(results, "state machine: valid transitions", () => {
    assert(canTransition("created", "planned"), "created→planned");
    assert(canTransition("planned", "authorized"), "planned→authorized");
    assert(canTransition("authorized", "queued"), "authorized→queued");
    assert(canTransition("queued", "running"), "queued→running");
    assert(canTransition("running", "completed"), "running→completed");
    assert(canTransition("running", "failed"), "running→failed");
    assert(canTransition("running", "paused"), "running→paused");
    assert(canTransition("paused", "running"), "paused→running");
    assert(canTransition("running", "cancelling"), "running→cancelling");
    assert(canTransition("cancelling", "cancelled"), "cancelling→cancelled");
  });

  await test(results, "state machine: invalid transitions rejected", () => {
    assert(!canTransition("completed", "running"), "completed→running blocked");
    assert(!canTransition("failed", "running"), "failed→running blocked");
    assert(!canTransition("cancelled", "running"), "cancelled→running blocked");
    assert(!canTransition("created", "running"), "created→running blocked");
    assert(!canTransition("created", "completed"), "created→completed blocked");
  });

  await test(results, "state machine: terminal states", () => {
    for (const s of ["completed", "failed", "cancelled", "expired"] as ExecutionState[]) {
      assert(isTerminal(s), `${s} is terminal`);
    }
    for (const s of ["running", "paused", "queued"] as ExecutionState[]) {
      assert(!isTerminal(s), `${s} not terminal`);
    }
  });

  // -----------------------------------------------------------------------
  // 7. Idempotency
  // -----------------------------------------------------------------------
  await test(results, "idempotency: dedup by key", () => {
    const cache = new IdempotencyCache();
    const r1 = cache.upsert("k1", () => ({ execution_id: "exec_a", state: "completed" as ExecutionState, expires_at: 0 }));
    const r2 = cache.upsert("k1", () => ({ execution_id: "exec_b", state: "completed" as ExecutionState, expires_at: 0 }));
    assertEq(r1.execution_id, "exec_a", "first");
    assertEq(r2.execution_id, "exec_a", "second deduped");
  });

  await test(results, "idempotency: ttl expiration", () => {
    const cache = new IdempotencyCache();
    cache.upsert("k2", () => ({ execution_id: "exec_c", state: "completed" as ExecutionState, expires_at: 0 }), 0);
    const r = cache.get("k2");
    assert(r === null, "should be expired");
  });

  // -----------------------------------------------------------------------
  // 8. Policy Engine
  // -----------------------------------------------------------------------
  await test(results, "policy: allow by default rule", () => {
    const engine = new PolicyEngine();
    engine.loadPolicy({
      version: "1.0",
      default_decision: "allow",
      rules: [
        { principal: "agent.*", capability: "math.*", effect: "allow" },
      ],
    });
    const decision = engine.evaluate(
      { type: "agent", id: "agent.research" },
      {
        id: "math.add", version: "1.0.0", kind: "action", description: "",
        input: { schema: {} }, output: { schema: {} },
        execution: { sync: true, async: false, streaming: false, cancel: false, retry: false, idempotent: false, dry_run: false },
        risk: { level: "low", side_effect: false, reversible: true },
        authorization: { scopes: [] },
      },
      {}
    );
    assertEq(decision.decision, "allow", "should allow");
    assert(decision.matched_rules.length > 0, "rule matched");
  });

  await test(results, "policy: deny overrides allow", () => {
    const engine = new PolicyEngine();
    engine.loadPolicy({
      version: "1.0",
      default_decision: "allow",
      rules: [
        { principal: "agent.*", capability: "*", effect: "allow" },
        { principal: "agent.*", capability: "payment.*", effect: "deny" },
      ],
    });
    const decision = engine.evaluate(
      { type: "agent", id: "agent.x" },
      {
        id: "payment.charge", version: "1.0.0", kind: "action", description: "",
        input: { schema: {} }, output: { schema: {} },
        execution: { sync: true, async: false, streaming: false, cancel: false, retry: false, idempotent: false, dry_run: false },
        risk: { level: "critical", side_effect: true, reversible: false },
        authorization: { scopes: [] },
      },
      {}
    );
    assertEq(decision.decision, "deny", "deny wins");
  });

  await test(results, "policy: approval required for high risk", () => {
    const engine = new PolicyEngine();
    engine.loadPolicy({
      version: "1.0",
      default_decision: "allow",
      rules: [
        { principal: "*", capability: "*", effect: "approval", max_risk_level: "high" },
      ],
    });
    const decision = engine.evaluate(
      { type: "user", id: "alice" },
      {
        id: "payment.charge", version: "1.0.0", kind: "action", description: "",
        input: { schema: {} }, output: { schema: {} },
        execution: { sync: true, async: false, streaming: false, cancel: false, retry: false, idempotent: false, dry_run: false },
        risk: { level: "high", side_effect: true, reversible: false },
        authorization: { scopes: [] },
      },
      {}
    );
    assertEq(decision.decision, "approval", "needs approval");
  });

  await test(results, "policy: simulate without execution", () => {
    const engine = new PolicyEngine();
    engine.loadPolicy({
      version: "1.0",
      default_decision: "deny",
      rules: [{ principal: "agent.deployer", capability: "deploy.*", effect: "allow" }],
    });
    const decision = engine.simulate(
      { type: "agent", id: "agent.researcher" },  // note: principal.id uses dot notation
      {
        id: "deploy.production", version: "1.0.0", kind: "action", description: "",
        input: { schema: {} }, output: { schema: {} },
        execution: { sync: true, async: false, streaming: false, cancel: false, retry: false, idempotent: false, dry_run: false },
        risk: { level: "high", side_effect: true, reversible: false },
        authorization: { scopes: [] },
      },
      {}
    );
    assertEq(decision.decision, "deny", "researcher not allowed");
  });

  // -----------------------------------------------------------------------
  // 9. Risk Engine
  // -----------------------------------------------------------------------
  await test(results, "risk: production boosts risk level", () => {
    const engine = new RiskEngine();
    const cap = { id: "x", risk: { level: "medium" as const, side_effect: true, reversible: false } } as never;
    const staging = engine.assess(cap, { environment: "staging" });
    const production = engine.assess(cap, { environment: "production" });
    assert(production.score > staging.score, "production has higher risk");
  });

  await test(results, "risk: input amount increases score", () => {
    const engine = new RiskEngine();
    const cap = { id: "x", risk: { level: "low" as const, side_effect: true, reversible: true } } as never;
    const small = engine.assess(cap, { input: { amount: 100 }, environment: "production" });
    const large = engine.assess(cap, { input: { amount: 50000 }, environment: "production" });
    assert(large.score > small.score, "large amount → higher risk");
    assertEq(large.level, "critical", "large amount → critical");
  });

  await test(results, "risk: blast radius estimate", () => {
    const cap = {
      id: "x",
      risk: {
        level: "high" as const,
        side_effect: true,
        reversible: false,
        blast_radius: "tenant" as const,
      },
    } as never;
    const estimate = estimateBlastRadius(cap, { count: 5000, amount: 1500 });
    assertEq(estimate.records, 5000, "records");
    assertEq(estimate.financial_exposure, 1500, "financial_exposure");
    assert(estimate.services > 0, "services");
  });

  // -----------------------------------------------------------------------
  // 10. Workflow Engine
  // -----------------------------------------------------------------------
  await test(results, "workflow: sequential execution", async () => {
    const engine = new WorkflowEngine();
    const spec: WorkflowSpec = {
      nodes: [
        { id: "step1", capability: "test.step", input: { value: 1 } },
        { id: "step2", capability: "test.step", input: (ctx: WorkflowContext) => ({ value: (ctx.results.get("step1")?.output as { value: number })?.value + 1 }), depends_on: ["step1"] },
        { id: "step3", capability: "test.step", input: (ctx: WorkflowContext) => ({ value: (ctx.results.get("step2")?.output as { value: number })?.value + 1 }), depends_on: ["step2"] },
      ],
    };
    const runner = async (_cap: string, input: unknown) => ({ output: input });
    const result = await engine.run(spec, runner);
    assertEq(result.state, "completed", "workflow completes");
    assertEq((result.results.step1.output as { value: number }).value, 1, "step1");
    assertEq((result.results.step2.output as { value: number }).value, 2, "step2");
    assertEq((result.results.step3.output as { value: number }).value, 3, "step3");
  });

  await test(results, "workflow: parallel branches", async () => {
    const engine = new WorkflowEngine();
    const spec: WorkflowSpec = {
      nodes: [
        { id: "build", capability: "test.step", input: { phase: "build" } },
        { id: "security", capability: "test.step", input: { phase: "security" }, depends_on: ["build"] },
        { id: "tests", capability: "test.step", input: { phase: "tests" }, depends_on: ["build"] },
        { id: "deploy", capability: "test.step", input: { phase: "deploy" }, depends_on: ["security", "tests"] },
      ],
    };
    const runner = async (_cap: string, input: unknown) => ({ output: input });
    const result = await engine.run(spec, runner);
    assertEq(result.state, "completed", "completes");
    assert(result.results.security.state === "completed", "security done");
    assert(result.results.tests.state === "completed", "tests done");
    assert(result.results.deploy.state === "completed", "deploy done");
  });

  await test(results, "workflow: condition skips branch", async () => {
    const engine = new WorkflowEngine();
    const spec: WorkflowSpec = {
      nodes: [
        { id: "build", capability: "test.step", input: { skipTests: true } },
        { id: "tests", capability: "test.step", input: { phase: "tests" }, depends_on: ["build"], condition: (ctx: WorkflowContext) => !(ctx.results.get("build")?.output as { skipTests?: boolean })?.skipTests },
      ],
    };
    const runner = async (_cap: string, input: unknown) => ({ output: input });
    const result = await engine.run(spec, runner);
    assertEq(result.results.tests.state, "skipped", "tests skipped");
  });

  await test(results, "workflow: compensation saga", async () => {
    const engine = new WorkflowEngine();
    const spec: WorkflowSpec = {
      nodes: [
        { id: "create_sub", capability: "subscription.create", input: { id: "sub1" }, compensation: "subscription.cancel", on_failure: "compensate" },
        { id: "charge", capability: "payment.charge", input: { amount: 100 }, depends_on: ["create_sub"], on_failure: "compensate" },
        { id: "fail_step", capability: "always.fail", input: {}, depends_on: ["charge"], on_failure: "compensate" },
      ],
    };
    let compensated = false;
    const runner = async (cap: string) => {
      if (cap === "always.fail") return { error: { code: "INTERNAL_ERROR" as const, message: "forced fail", retryable: false } };
      if (cap === "subscription.cancel") {
        compensated = true;
        return { output: { cancelled: true } };
      }
      return { output: { ok: true } };
    };
    const result = await engine.run(spec, runner);
    assertEq(result.state, "failed", "workflow fails");
    assert(compensated, "compensation was called");
    assert(result.compensation_runs.length > 0, "compensation runs recorded");
  });

  await test(results, "workflow: budget exceeded", async () => {
    const engine = new WorkflowEngine();
    const spec: WorkflowSpec = {
      budget: { max_calls: 2 },
      nodes: [
        { id: "a", capability: "test.step", input: {} },
        { id: "b", capability: "test.step", input: {}, depends_on: ["a"] },
        { id: "c", capability: "test.step", input: {}, depends_on: ["b"] },
        { id: "d", capability: "test.step", input: {}, depends_on: ["c"] },
      ],
    };
    const runner = async () => ({ output: { ok: true } });
    const result = await engine.run(spec, runner);
    assertEq(result.state, "failed", "workflow fails on budget");
    assertEq(result.error!.code, "BUDGET_EXCEEDED", "budget exceeded error");
  });

  // -----------------------------------------------------------------------
  // 11. Event Engine
  // -----------------------------------------------------------------------
  await test(results, "events: subscribe + emit + replay", async () => {
    const em = new EventEmitter();
    const received: string[] = [];
    em.subscribe((e) => { received.push(e.type); }, { delivery: "at_most_once" });
    em.emit({ event_id: "e1", type: "execution.started", source: "test", timestamp: new Date().toISOString(), sequence: 1 });
    em.emit({ event_id: "e2", type: "execution.completed", source: "test", timestamp: new Date().toISOString(), sequence: 2 });
    assertEq(received.length, 2, "received both");
    const replayed = em.replay(1);
    assertEq(replayed.length, 2, "replay 2");
    assertEq(replayed[0].type, "execution.started", "first replay");
  });

  await test(results, "events: filter", async () => {
    const em = new EventEmitter();
    const received: string[] = [];
    em.subscribe(
      (e) => { received.push(e.type); },
      { filter: (e) => e.type === "execution.completed" }
    );
    em.emit({ event_id: "e1", type: "execution.started", source: "test", timestamp: new Date().toISOString() });
    em.emit({ event_id: "e2", type: "execution.completed", source: "test", timestamp: new Date().toISOString() });
    assertEq(received.length, 1, "filtered");
    assertEq(received[0], "execution.completed", "right event");
  });

  await test(results, "events: backpressure buffer", async () => {
    const em = new EventEmitter();
    const received: string[] = [];
    const handle = em.subscribe(
      (e) => { received.push(e.type); },
      { buffer_size: 2, on_backpressure: "buffer" }
    );
    em.pause(handle);
    em.emit({ event_id: "e1", type: "evt1", source: "test", timestamp: new Date().toISOString() });
    em.emit({ event_id: "e2", type: "evt2", source: "test", timestamp: new Date().toISOString() });
    em.emit({ event_id: "e3", type: "evt3", source: "test", timestamp: new Date().toISOString() });
    em.resume_(handle);
    assert(received.length >= 2, "received buffered events");
    assert(received.includes("evt3"), "latest received");
  });

  // -----------------------------------------------------------------------
  // 12. Audit Engine
  // -----------------------------------------------------------------------
  await test(results, "audit: hash chain verifies", () => {
    const audit = new AuditEngine();
    const ts = new Date().toISOString();
    audit.record({ timestamp: ts, who: "alice", what: "execute", capability: "math.add", decision: "allow" });
    audit.record({ timestamp: ts, who: "bob", what: "execute", capability: "math.add", decision: "allow" });
    audit.record({ timestamp: ts, who: "alice", what: "execute", capability: "payment.charge", decision: "deny" });
    const v = audit.verify();
    assert(v.valid, "chain valid");
    assertEq(audit.list().length, 3, "3 records");
  });

  // -----------------------------------------------------------------------
  // 13. Artifact Manager
  // -----------------------------------------------------------------------
  await test(results, "artifact: store + retrieve + checksum", async () => {
    const tmpDir = `/tmp/aep-test-${Date.now()}`;
    const am = new ArtifactManager({ rootDir: tmpDir });
    const data = Buffer.from("Hello, AEP World!");
    const artifact = await am.store(data, { mime_type: "text/plain" });
    assert(artifact.id.startsWith("art_"), "id prefix");
    assertEq(artifact.size, data.length, "size");
    assertEq(artifact.checksum.algorithm, "sha256", "algo");
    const retrieved = await am.retrieve(artifact.id);
    assert(retrieved !== null, "retrieved");
    assertEq(retrieved!.data.toString(), data.toString(), "content match");
  });

  // -----------------------------------------------------------------------
  // 14. End-to-end: Discovery → Execute → Typed Result
  // -----------------------------------------------------------------------
  await test(results, "E2E: discovery → capability → execute → typed result", async () => {
    const server = new AEPServer();
    for (const c of BUILTIN_CAPABILITIES) server.capability(c);

    // 1) discover via registry
    const reg = server.registry;
    const found = reg.resolve({ id: "math.add" });
    assert(found !== null, "discovered");
    assertEq(found!.contract.id, "math.add", "right capability");

    // 2) execute with typed result
    const execReq: AEPRequest = {
      aep: "0.1",
      id: "req_e2e",
      type: "execute",
      principal: { type: "user", id: "alice" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "math.add", version: "^1.0" },
      input: { a: 7, b: 8 },
    };
    const execResp: AEPResponse = await server.execute(execReq);
    assertEq(execResp.status, "completed", "executed");
    assertEq((execResp.output as { result: number }).result, 15, "7+8=15");
  });

  // -----------------------------------------------------------------------
  // 15. Authority Engine
  // -----------------------------------------------------------------------
  await test(results, "authority: issue + verify", () => {
    // (imports are at top of file)
    const engine = new AuthorityEngine();
    const auth = engine.issue({
      subject: { type: "agent", id: "agent.deploy" },
      capabilities: ["deploy.*"],
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    assert(auth.id.startsWith("auth_"), "id prefix");
    assertEq(auth.state, "active", "active");
    const v = engine.verify(auth);
    assert(v.valid, "verify valid");
  });

  await test(results, "authority: canExercise (capability match)", () => {
    // (imports are at top of file)
    const engine = new AuthorityEngine();
    const auth = engine.issue({
      subject: { type: "agent", id: "agent.deploy" },
      capabilities: ["deploy.*"],
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    assert(engine.canExercise(auth, "deploy.staging").allowed, "deploy.staging ok");
    assert(engine.canExercise(auth, "deploy.production").allowed, "deploy.production ok");
    assert(!engine.canExercise(auth, "payment.charge").allowed, "payment.charge blocked");
  });

  await test(results, "authority: expired → invalid", () => {
    // (imports are at top of file)
    const engine = new AuthorityEngine();
    const auth = engine.issue({
      subject: { type: "agent", id: "x" },
      capabilities: ["*"],
      resources: [],
      expires_at: new Date(Date.now() - 1000).toISOString(), // past
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    const v = engine.verify(auth);
    assert(!v.valid, "expired");
    assertEq(v.reason, "AUTHORITY_EXPIRED", "expired reason");
  });

  await test(results, "authority: derive (child ⊆ parent)", () => {
    // (imports are at top of file)
    const engine = new AuthorityEngine();
    const parent = engine.issue({
      subject: { type: "agent", id: "agent.supervisor" },
      capabilities: ["deploy.*", "test.*"],
      resources: [],
      constraints: { max_cost_usd: 10, max_calls: 100 },
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: true,
      issued_by: { type: "user", id: "alice" },
    });
    const child = engine.deriveTo(
      parent.id,
      { type: "agent", id: "agent.child" },
      {
        capabilities: ["deploy.staging"],     // subset of deploy.*
        constraints: { max_cost_usd: 5 },     // ≤ parent
      },
      { type: "agent", id: "agent.supervisor" }
    );
    assert(child.id !== parent.id, "different id");
    assert(child.delegation_chain!.length > parent.delegation_chain!.length, "longer chain");
    assert(engine.canExercise(child, "deploy.staging").allowed, "child can deploy.staging");
    assert(!engine.canExercise(child, "deploy.production").allowed, "child cannot deploy.production");
    assert(!engine.canExercise(child, "test.run").allowed, "child cannot test.run (not in subset)");
  });

  await test(results, "authority: derive subset violation rejected", () => {
    // (imports are at top of file)
    const engine = new AuthorityEngine();
    const parent = engine.issue({
      subject: { type: "agent", id: "agent.supervisor" },
      capabilities: ["deploy.*"],
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: true,
      issued_by: { type: "user", id: "alice" },
    });
    let threw = false;
    try {
      engine.deriveTo(
        parent.id,
        { type: "agent", id: "agent.child" },
        { capabilities: ["payment.*"] },  // NOT subset of deploy.*
        { type: "agent", id: "agent.supervisor" }
      );
    } catch (err) {
      threw = true;
      assert(err instanceof AuthorityError, "AuthorityError type");
    }
    assert(threw, "subset violation throws");
  });

  await test(results, "authority: non-delegatable parent rejected", () => {
    // (imports are at top of file)
    const engine = new AuthorityEngine();
    const parent = engine.issue({
      subject: { type: "agent", id: "agent.supervisor" },
      capabilities: ["deploy.*"],
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: false,  // not delegatable
      issued_by: { type: "user", id: "alice" },
    });
    let threw = false;
    try {
      engine.deriveTo(
        parent.id,
        { type: "agent", id: "agent.child" },
        { capabilities: ["deploy.staging"] },
        { type: "agent", id: "agent.supervisor" }
      );
    } catch (err) {
      threw = true;
    }
    assert(threw, "non-delegatable throws");
  });

  await test(results, "authority: revoke cascades to children", () => {
    // (imports are at top of file)
    const engine = new AuthorityEngine();
    const parent = engine.issue({
      subject: { type: "agent", id: "agent.supervisor" },
      capabilities: ["deploy.*"],
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: true,
      issued_by: { type: "user", id: "alice" },
    });
    const child = engine.deriveTo(
      parent.id,
      { type: "agent", id: "agent.child" },
      { capabilities: ["deploy.staging"] },
      { type: "agent", id: "agent.supervisor" }
    );
    engine.revoke(parent.id, { type: "user", id: "alice" });
    assert(engine.isRevoked(parent.id), "parent revoked");
    assert(engine.isRevoked(child.id), "child cascaded");
  });

  // -----------------------------------------------------------------------
  // 16. Capability Resolver (semantic intent → best capability)
  // -----------------------------------------------------------------------
  await test(results, "resolver: semantic_class match", () => {
    // (imports are at top of file)
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const resolver = new CapabilityResolver({ registry: reg });
    const result = resolver.resolve({
      principal: { type: "user", id: "alice" },
      intent: { semantic_class: "issue.creation" },
      limit: 5,
    });
    assert(result.matches.length >= 2, "≥2 matches (github + linear)");
    assert(result.matches[0].rank === 1, "rank 1");
    assert(result.matches.every((m: any) => m.capability_id.includes("issue.create")), "all issue.create");
  });

  await test(results, "resolver: risk filter", () => {
    // (imports are at top of file)
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const resolver = new CapabilityResolver({ registry: reg });
    const result = resolver.resolve({
      principal: { type: "user", id: "alice" },
      intent: {},
      constraints: { risk_max: "low" as any },
      limit: 50,
    });
    assert(result.matches.every((m: any) => m.risk_level === "low"), "all low risk");
  });

  await test(results, "resolver: cost filter", () => {
    // (imports are at top of file)
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const resolver = new CapabilityResolver({ registry: reg });
    const result = resolver.resolve({
      principal: { type: "user", id: "alice" },
      intent: {},
      constraints: { cost_max_usd: 0.001 },
      limit: 50,
    });
    assert(result.matches.every((m: any) => m.estimated_cost_usd === undefined || m.estimated_cost_usd <= 0.001), "all ≤0.001");
  });

  await test(results, "resolver: authority filter", () => {
    // (imports are at top of file)
    // (imports are at top of file)
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const authEngine = new AuthorityEngine();
    const auth = authEngine.issue({
      subject: { type: "agent", id: "agent.research" },
      capabilities: ["math.*"],  // only math
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    const resolver = new CapabilityResolver({ registry: reg, authority: authEngine });
    const result = resolver.resolve({
      principal: { type: "agent", id: "agent.research" },
      intent: {},
      authority: auth,
      limit: 50,
    });
    assert(result.matches.every((m: any) => m.capability_id.startsWith("math.")), "all math.*");
  });

  await test(results, "resolver: rank ordering", () => {
    // (imports are at top of file)
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const resolver = new CapabilityResolver({ registry: reg });
    const result = resolver.resolve({
      principal: { type: "user", id: "alice" },
      intent: {},
      limit: 10,
    });
    for (let i = 0; i < result.matches.length - 1; i++) {
      assert(result.matches[i].score >= result.matches[i + 1].score, "ranked descending");
    }
  });

  // -----------------------------------------------------------------------
  // 17. Workflow Artifact (validate, plan, simulate, execute, replay)
  // -----------------------------------------------------------------------
  await test(results, "workflow-artifact: validate (valid)", () => {
    // (imports are at top of file)
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const engine = new WorkflowArtifactEngine({ registry: reg });
    const result = engine.validate({
      name: "test-wf",
      version: "1.0.0",
      nodes: [
        { id: "step1", capability: "math.add", inputs: { a: 1, b: 2 } },
        { id: "step2", capability: "math.add", depends_on: ["step1"], inputs: { a: 1, b: 2 } },
      ],
    });
    assert(result.valid, "should be valid");
    assertEq(result.errors.length, 0, "no errors");
  });

  await test(results, "workflow-artifact: validate (cycle detected)", () => {
    // (imports are at top of file)
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const engine = new WorkflowArtifactEngine({ registry: reg });
    const result = engine.validate({
      name: "test-wf",
      version: "1.0.0",
      nodes: [
        { id: "a", capability: "math.add", depends_on: ["b"] },
        { id: "b", capability: "math.add", depends_on: ["a"] },
      ],
    });
    assert(!result.valid, "should be invalid");
    assert(result.errors.some((e: any) => e.message.includes("Cycle")), "cycle error");
  });

  await test(results, "workflow-artifact: validate (unknown capability)", () => {
    // (imports are at top of file)
    const reg = new CapabilityRegistry();
    const engine = new WorkflowArtifactEngine({ registry: reg });
    const result = engine.validate({
      name: "test-wf",
      version: "1.0.0",
      nodes: [
        { id: "x", capability: "nonexistent.cap" },
      ],
    });
    assert(!result.valid, "invalid");
    assert(result.errors.some((e: any) => e.message.includes("not found")), "not found");
  });

  await test(results, "workflow-artifact: plan (topological order)", () => {
    // (imports are at top of file)
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const engine = new WorkflowArtifactEngine({ registry: reg });
    const plan = engine.plan({
      name: "release",
      version: "1.0.0",
      nodes: [
        { id: "build", capability: "math.add", inputs: { a: 1, b: 1 } },
        { id: "security", capability: "echo.ping", depends_on: ["build"] },
        { id: "tests", capability: "echo.ping", depends_on: ["build"] },
        { id: "deploy", capability: "echo.ping", depends_on: ["security", "tests"] },
      ],
    });
    assertEq(plan.topological_order[0], "build", "build first");
    assertEq(plan.topological_order[plan.topological_order.length - 1], "deploy", "deploy last");
    assert(plan.parallel_groups.length >= 3, "multiple parallel groups");
  });

  await test(results, "workflow-artifact: simulate (no side effects)", async () => {
    // (imports are at top of file)
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const engine = new WorkflowArtifactEngine({ registry: reg });
    const result = await engine.simulate({
      name: "release",
      version: "1.0.0",
      nodes: [
        { id: "build", capability: "math.add", inputs: { a: 1, b: 1 } },
        { id: "tests", capability: "echo.ping", depends_on: ["build"] },
      ],
    }, {});
    assert(result.would_execute.length === 2, "would execute 2");
    assertEq(result.would_execute[0], "build", "build first");
    assert(result.estimated_duration_ms > 0, "duration estimated");
  });

  await test(results, "workflow-artifact: execute (real run)", async () => {
    // (imports are at top of file)
    const reg = new CapabilityRegistry();
    for (const c of BUILTIN_CAPABILITIES) reg.register(capToContract(c), { handler: c.execute });
    const engine = new WorkflowArtifactEngine({ registry: reg });
    let calls = 0;
    const runner = async (_cap: string, input: unknown) => {
      calls++;
      return { output: { ok: true, input } };
    };
    const result = await engine.execute({
      name: "release",
      version: "1.0.0",
      nodes: [
        { id: "build", capability: "math.add", inputs: { a: 1, b: 1 } },
        { id: "test", capability: "echo.ping", depends_on: ["build"] },
      ],
    }, {}, {
      principal: { type: "user", id: "alice" },
      runner,
    });
    assertEq(result.state, "completed", "completes");
    assert(calls === 2, "ran 2 nodes");
  });

  await test(results, "workflow-artifact: replay (timeline build)", () => {
    // (imports are at top of file)
    const reg = new CapabilityRegistry();
    const engine = new WorkflowArtifactEngine({ registry: reg });
    const events = [
      { event_id: "e1", type: "execution.created", timestamp: "2026-08-17T12:00:00.000Z" },
      { event_id: "e2", type: "execution.started", timestamp: "2026-08-17T12:00:00.100Z" },
      { event_id: "e3", type: "execution.completed", timestamp: "2026-08-17T12:00:01.000Z" },
    ];
    const replay = engine.replay(events);
    assertEq(replay.timeline.length, 3, "timeline has 3");
    assertEq(replay.timeline[0].t, 0, "first event t=0");
    assert(replay.timeline[2].t > 0, "last event t>0");
  });

  // -----------------------------------------------------------------------
  // 18. P0 Phase — Receipts, Signals, Retry, Effects, Persistence, AEPError
  // -----------------------------------------------------------------------
  const { runP0Tests } = await import("./p0-tests.js");
  const p0Results = await runP0Tests(test, assert, assertEq);
  results.push(...p0Results);

  // -----------------------------------------------------------------------
  // 19. Race Tests — 100 concurrent identical requests
  // -----------------------------------------------------------------------
  const { runRaceTests } = await import("./race/race-tests.js");
  const raceResults = await runRaceTests(test, assert);
  results.push(...raceResults);

  // -----------------------------------------------------------------------
  // 20. Security Tests — forged principal, revoked, escalated, etc.
  // -----------------------------------------------------------------------
  const { runSecurityTests } = await import("./security/security-tests.js");
  const securityResults = await runSecurityTests(test, assert, assertEq);
  results.push(...securityResults);

  // -----------------------------------------------------------------------
  // 21. Property Tests — derive ⊆ parent, invalid transitions, canonicalization
  // -----------------------------------------------------------------------
  const { runPropertyTests } = await import("./property/property-tests.js");
  const propertyResults = await runPropertyTests(test, assert);
  results.push(...propertyResults);

  // -----------------------------------------------------------------------
  // 22. Durable Stores + Recovery + Test Vectors
  // -----------------------------------------------------------------------
  const { runDurableTests } = await import("./durable-tests.js");
  const durableResults = await runDurableTests(test, assert, assertEq);
  results.push(...durableResults);

  return results;
}

function capToContract(c: CapabilityDefinition): import("../core/types.js").CapabilityContract {
  return {
    id: c.id,
    version: c.version,
    kind: c.kind,
    description: c.description,
    input: c.input,
    output: c.output,
    execution: c.execution,
    risk: c.risk,
    authorization: c.authorization || { scopes: [] },
    cost: c.cost,
    performance: c.performance,
    semantic_class: c.semantic_class,
    compensation: c.compensation,
    provider: c.provider,
    region: c.region,
    examples: c.examples,
  };
}
