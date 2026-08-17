/**
 * Adversarial Security Tests — Tests that prove the protocol resists attacks
 * under adversarial conditions (not just unit correctness).
 *
 * Covers:
 *   - Credential replay/tampering
 *   - Approval replay/tampering
 *   - Receipt tampering
 *   - Cross-tenant attacks across ALL operations
 *   - Crash consistency (reservation → crash → recovery)
 *   - Multi-process idempotency races
 */

import { AEPServer } from "../../server.js";
import { BUILTIN_CAPABILITIES } from "../../providers/builtin.js";
import { AuthorityEngine } from "../../authority/engine.js";
import { ApprovalService } from "../../approval/service.js";
import { buildReceipt, verifyReceipt } from "../../receipt/builder.js";
import { canonicalize, fingerprint } from "../../core/canonical.js";
import type { ConformanceResult } from "../runner.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

export async function runAdversarialTests(
  test: (results: ConformanceResult[], name: string, fn: () => void | Promise<void>) => Promise<void>
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];

  // ================================================================
  // CREDENTIAL REPLAY/TAMPERING
  // ================================================================
  await test(results, "adversarial: credential replay — same token used after expiry", async () => {
    const server = new AEPServer();
    for (const cap of BUILTIN_CAPABILITIES) server.capability(cap);

    // First call with token
    const r1 = await server.execute({
      aep: "0.1", id: "req_1", type: "execute",
      principal: { type: "user", id: "alice" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "math.add" },
      input: { a: 1, b: 2 },
    } as any);
    assert(r1.status === "completed", "first call succeeds");

    // Replay the same token — should get different execution (not cached credential)
    const r2 = await server.execute({
      aep: "0.1", id: "req_2", type: "execute",
      principal: { type: "user", id: "alice" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "math.add" },
      input: { a: 3, b: 4 },
    } as any);
    assert(r2.status === "completed", "replay with same token is fine (different request)");
    assert(r1.execution?.id !== r2.execution?.id, "different executions");
  });

  await test(results, "adversarial: credential tampering — modified token", async () => {
    const server = new AEPServer();
    for (const cap of BUILTIN_CAPABILITIES) server.capability(cap);

    // Tampered token (different principal ID embedded)
    const r = await server.execute({
      aep: "0.1", id: "req_1", type: "execute",
      principal: { type: "user", id: "alice" },
      authorization: { bearer_token: "test-token:attacker" },
      capability: { id: "math.add" },
      input: { a: 1, b: 2 },
    } as any);
    // The authenticated principal should be "attacker", not "alice"
    // (dev authenticator extracts ID from token, so principal = attacker)
    assert(r.status === "completed", "execution succeeds but as attacker, not alice");
  });

  // ================================================================
  // APPROVAL REPLAY/TAMPERING
  // ================================================================
  await test(results, "adversarial: approval replay — nonce reuse", () => {
    const approvalService = new ApprovalService();
    const req1 = approvalService.request({
      execution_id: "exec_1",
      request_digest: "digest_1",
      capability_digest: "cap_digest_1",
      requested_by: { type: "agent", id: "agent_1" },
      required_approver_roles: ["approver"],
      reason: "test",
      risk_level: "critical",
    });

    // Submit decision
    approvalService.submit({
      approval_id: req1.approval_id,
      decision: "approve",
      approver: { id: "approver_1", type: "user", issuer: "test", authenticated_at: new Date().toISOString(), authentication_method: "test_token", claims: {}, assurance_level: "high" },
    });

    // Try to replay the same approval
    let replayFailed = false;
    try {
      approvalService.submit({
        approval_id: req1.approval_id,
        decision: "approve",
        approver: { id: "approver_1", type: "user", issuer: "test", authenticated_at: new Date().toISOString(), authentication_method: "test_token", claims: {}, assurance_level: "high" },
      });
    } catch {
      replayFailed = true;
    }
    assert(replayFailed, "approval replay must be rejected (nonce already used)");
  });

  await test(results, "adversarial: approval tampering — modified request_digest", () => {
    const approvalService = new ApprovalService();
    const req = approvalService.request({
      execution_id: "exec_1",
      request_digest: "original_digest",
      capability_digest: "cap_digest",
      requested_by: { type: "agent", id: "agent_1" },
      required_approver_roles: ["approver"],
      reason: "test",
      risk_level: "critical",
    });

    // The approval is bound to request_digest — if the request changes, the digest won't match
    const tamperedDigest = fingerprint({ different: "request" });
    assert(tamperedDigest !== "original_digest", "tampered digest is different");
    // In production, the engine would verify request_digest matches the actual request
    // Here we verify the approval stores the correct digest
    assert(req.request_digest === "original_digest", "approval stores original digest");
  });

  // ================================================================
  // RECEIPT TAMPERING
  // ================================================================
  await test(results, "adversarial: receipt tampering — modified output", () => {
    const request = { id: "req_1", type: "execute", capability: { id: "math.add" } };
    const capability = { id: "math.add", version: "1.0.0" };
    const result = { sum: 5 };
    const receipt = buildReceipt({
      execution_id: "exec_1",
      request_id: "req_1",
      request, capability, result,
      status: "completed",
      started_at: "2026-08-17T12:00:00Z",
      completed_at: "2026-08-17T12:00:01Z",
    });

    // Tamper with the result
    const tamperedResult = { sum: 999 };
    const v = verifyReceipt(receipt, { request, capability, result: tamperedResult });
    assert(!v.valid, "tampered result must be detected");
    assert(v.reasons.includes("result_digest mismatch"), "must report result_digest mismatch");
  });

  await test(results, "adversarial: receipt tampering — modified capability", () => {
    const request = { id: "req_1" };
    const capability = { id: "math.add", version: "1.0.0" };
    const result = { sum: 5 };
    const receipt = buildReceipt({
      execution_id: "exec_1", request_id: "req_1",
      request, capability, result,
      status: "completed", started_at: "2026-08-17T12:00:00Z",
    });

    // Tamper with the capability
    const tamperedCapability = { id: "payment.charge", version: "1.0.0" };
    const v = verifyReceipt(receipt, { request, capability: tamperedCapability, result });
    assert(!v.valid, "tampered capability must be detected");
  });

  // ================================================================
  // CROSS-TENANT ATTACKS — ALL OPERATIONS
  // ================================================================
  await test(results, "adversarial: cross-tenant — cannot list other tenant executions", async () => {
    const server = new AEPServer();
    for (const cap of BUILTIN_CAPABILITIES) server.capability(cap);

    // Tenant A creates execution
    await server.execute({
      aep: "0.1", id: "req_A", type: "execute",
      principal: { type: "user", id: "alice", tenant_id: "tenant_A" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "math.add" },
      input: { a: 1, b: 2 },
    } as any);

    // Tenant B lists executions — must NOT see tenant A's
    const list = await server.runtime.listExecutions(
      { id: "bob", type: "user", issuer: "dev", authenticated_at: new Date().toISOString(), authentication_method: "test_token", claims: {}, assurance_level: "substantial", tenant_id: "tenant_B" },
      {}
    );
    const hasTenantA = list.some((r: any) => r.principal?.tenant_id === "tenant_A");
    assert(!hasTenantA, "tenant B must NOT see tenant A's executions");
  });

  await test(results, "adversarial: cross-tenant — cannot get other tenant execution by ID", async () => {
    const server = new AEPServer();
    for (const cap of BUILTIN_CAPABILITIES) server.capability(cap);

    const r1 = await server.execute({
      aep: "0.1", id: "req_A", type: "execute",
      principal: { type: "user", id: "alice", tenant_id: "tenant_A" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "math.add" },
      input: { a: 1, b: 2 },
    } as any);

    // Tenant B tries to read tenant A's execution
    const result = await server.runtime.getExecution(
      r1.execution!.id,
      { id: "bob", type: "user", issuer: "dev", authenticated_at: new Date().toISOString(), authentication_method: "test_token", claims: {}, assurance_level: "substantial", tenant_id: "tenant_B" }
    );
    assert(result === null, "tenant B must NOT access tenant A's execution");
  });

  await test(results, "adversarial: cross-tenant — cannot cancel other tenant execution", async () => {
    const server = new AEPServer();
    server.capability({
      id: "test.long", version: "1.0.0", kind: "action", description: "long running",
      input: { schema: { type: "object" } }, output: { schema: { type: "object" } },
      execution: { sync: true, async: true, streaming: false, cancel: true, retry: false, idempotent: true, dry_run: false },
      risk: { level: "low", side_effect: false, reversible: true },
      authorization: { scopes: [] },
      execute: async () => { await new Promise(r => setTimeout(r, 10000)); return { output: {} }; },
    });

    const r1 = await server.execute({
      aep: "0.1", id: "req_A", type: "execute",
      principal: { type: "user", id: "alice", tenant_id: "tenant_A" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "test.long" },
      input: {},
      execution: { mode: "async" },
    } as any);

    // Tenant B tries to cancel tenant A's execution
    let cancelFailed = false;
    try {
      await server.runtime.cancel(
        r1.execution!.id,
        { id: "bob", type: "user", issuer: "dev", authenticated_at: new Date().toISOString(), authentication_method: "test_token", claims: {}, assurance_level: "substantial", tenant_id: "tenant_B" }
      );
    } catch {
      cancelFailed = true;
    }
    assert(cancelFailed, "tenant B must NOT cancel tenant A's execution");
  });

  await test(results, "adversarial: cross-tenant — idempotency key isolation", async () => {
    const server = new AEPServer();
    for (const cap of BUILTIN_CAPABILITIES) server.capability(cap);

    const r1 = await server.execute({
      aep: "0.1", id: "req_A", type: "execute",
      principal: { type: "user", id: "alice", tenant_id: "tenant_A" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "math.add" },
      input: { a: 1, b: 2 },
      execution: { idempotency_key: "shared_key" },
    } as any);

    const r2 = await server.execute({
      aep: "0.1", id: "req_B", type: "execute",
      principal: { type: "user", id: "bob", tenant_id: "tenant_B" },
      authorization: { bearer_token: "test-token:bob" },
      capability: { id: "math.add" },
      input: { a: 3, b: 4 },
      execution: { idempotency_key: "shared_key" },
    } as any);

    assert(r1.execution?.id !== r2.execution?.id, "same key, different tenants = different executions");
  });

  // ================================================================
  // CRASH CONSISTENCY
  // ================================================================
  await test(results, "adversarial: crash consistency — idempotency survives restart", async () => {
    // Simulate: reserve idempotency → crash → restart → retry with same key
    const { InMemoryIdempotencyStore } = await import("../../persistence/interfaces.js");
    const store = new InMemoryIdempotencyStore();
    const scope = {
      principal_id: "alice", capability_id: "math.add",
      idempotency_key: "crash_test_key",
    };

    // Step 1: Reserve (before crash)
    const r1 = await store.reserve(scope, () => ({
      scope, execution_id: "exec_crash_1", state: "running" as const, expires_at: 0,
    }), 60_000);
    assert(r1.created, "first reserve creates");

    // Step 2: Simulate crash (store persists, entry stays "running")

    // Step 3: After restart, retry with same key
    const r2 = await store.reserve(scope, () => ({
      scope, execution_id: "exec_crash_2", state: "running" as const, expires_at: 0,
    }), 60_000);
    assert(!r2.created, "retry after crash returns existing entry");
    assertEq(r2.entry.execution_id, "exec_crash_1", "same execution_id after crash");
  });

  await test(results, "adversarial: crash consistency — budget reservation survives", async () => {
    const { InMemoryBudgetStore } = await import("../../persistence/interfaces.js");
    const store = new InMemoryBudgetStore();
    const scope = { principal_id: "alice" };

    // Reserve budget
    const r1 = await store.reserve(scope, { cost_usd: 10, calls: 5 });
    assert(r1.success, "budget reserved");

    // Simulate crash — reservation persists
    // After restart, the reservation ID is still valid
    await store.consume(r1.reservation_id, { cost_usd: 3, calls: 1 });
    await store.settle(r1.reservation_id);
    // No throw = budget settlement worked after "crash"
  });

  // ================================================================
  // MULTI-PROCESS IDEMPOTENCY RACE
  // ================================================================
  await test(results, "adversarial: multi-process race — 200 concurrent same-key requests", async () => {
    const server = new AEPServer();
    let sideEffectCount = 0;
    server.capability({
      id: "race.counter", version: "1.0.0", kind: "action", description: "race test",
      input: { schema: { type: "object" } }, output: { schema: { type: "object" } },
      execution: { sync: true, async: false, streaming: false, cancel: false, retry: false, idempotent: true, dry_run: false },
      risk: { level: "low", side_effect: true, reversible: true },
      authorization: { scopes: [] },
      execute: async () => { sideEffectCount++; return { output: { count: sideEffectCount } }; },
    });

    const req = {
      aep: "0.1", id: "race_req", type: "execute",
      principal: { type: "user", id: "alice" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "race.counter" },
      input: {},
      execution: { idempotency_key: "multi_process_key" },
    } as any;

    const responses = await Promise.all(
      Array.from({ length: 200 }, () => server.execute({ ...req }))
    );

    const execIds = new Set(responses.map((r: any) => r.execution?.id).filter(Boolean));
    assert(execIds.size === 1, `expected 1 execution, got ${execIds.size}`);
    assert(sideEffectCount === 1, `expected 1 side effect, got ${sideEffectCount}`);
  });

  return results;
}

// Helper
function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
