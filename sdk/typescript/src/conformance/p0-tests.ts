/**
 * Conformance — P0 Tests (Receipts, Signals, Retry, Budget, Effects)
 * Reference: spec/10-10 §15-§20§29 Receipt§69 Proof Object
  */

import { buildReceipt, verifyReceipt } from "../receipt/builder.js";
import { ExecutionSignalImpl, createSignal } from "../execution/signal.js";
import { withRetry, computeDelay, shouldRetry, DEFAULT_RETRY_POLICY, type RetryPolicy } from "../execution/retry.js";
import { hasSideEffect, requiresApproval, summarizeEffects } from "../effects/descriptor.js";
import { InMemoryExecutionStore, InMemoryAuthorityStore, InMemoryIdempotencyStore, InMemoryBudgetStore, InMemoryEventStore } from "../persistence/interfaces.js";
import { AEPError, isAEPError, invalidRequest, unauthorized, timeout as timeoutErr, rateLimited, budgetExceeded, policyDenied, asAEPError } from "../errors/aep-error.js";
import type { ConformanceResult } from "./runner.js";

export async function runP0Tests(
  test: (results: ConformanceResult[], name: string, fn: () => void | Promise<void>) => Promise<void>,
  assert: (cond: boolean, msg: string) => void,
  assertEq: <T>(actual: T, expected: T, msg: string) => void
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];

  // -----------------------------------------------------------------------
  // Execution Receipt
  // -----------------------------------------------------------------------
  await test(results, "receipt: build + verify (valid)", () => {
    const request: any = { id: "req_1", type: "execute", capability: { id: "math.add" } };
    const capability: any = { id: "math.add", version: "1.0.0" };
    const result: any = { sum: 5 };
    const receipt = buildReceipt({
      execution_id: "exec_1",
      request_id: "req_1",
      request,
      capability,
      result,
      status: "completed",
      started_at: "2026-08-17T12:00:00Z",
      completed_at: "2026-08-17T12:00:01Z",
    });
    assert(receipt.request_digest.startsWith("sha256:"), "request_digest");
    assert(receipt.capability_digest.startsWith("sha256:"), "capability_digest");
    assert(receipt.result_digest?.startsWith("sha256:") === true, "result_digest");
    assertEq(receipt.duration_ms, 1000, "duration_ms");

    const v = verifyReceipt(receipt, { request, capability, result });
    assert(v.valid, "receipt valid");
    assertEq(v.reasons.length, 0, "no reasons");
  });

  await test(results, "receipt: tampered request detected", () => {
    const request: any = { id: "req_1", type: "execute" };
    const receipt = buildReceipt({
      execution_id: "exec_1", request_id: "req_1",
      request, capability: {}, status: "completed", started_at: "2026-08-17T12:00:00Z",
    });
    // tamper
    const tampered: any = { id: "req_1", type: "execute", evil: true };
    const v = verifyReceipt(receipt, { request: tampered });
    assert(!v.valid, "must detect tampering");
    assert(v.reasons.includes("request_digest mismatch"), "mismatch reason");
  });

  // -----------------------------------------------------------------------
  // ExecutionSignal
  // -----------------------------------------------------------------------
  await test(results, "signal: abort fires callbacks", () => {
    const sig = new ExecutionSignalImpl();
    let called = 0;
    sig.onAbort(() => { called++; });
    sig.onAbort(() => { called++; });
    assertEq(called, 0, "no abort yet");
    sig.abort("CANCELLED");
    assertEq(called, 2, "both callbacks fired");
    assertEq(sig.aborted, true, "aborted flag");
    assertEq(sig.reason, "CANCELLED", "reason");
  });

  await test(results, "signal: throwIfAborted throws AEPError", () => {
    const sig = new ExecutionSignalImpl();
    sig.abort("TIMEOUT");
    let threw = false;
    try {
      sig.throwIfAborted();
    } catch (err) {
      threw = true;
      assert(isAEPError(err), "is AEPError");
      assertEq((err as AEPError).code, "TIMEOUT", "code");
    }
    assert(threw, "must throw");
  });

  await test(results, "signal: timeout fires automatically", async () => {
    const sig = new ExecutionSignalImpl({ deadlineMs: 50 });
    assertEq(sig.aborted, false, "not aborted yet");
    await new Promise((r) => setTimeout(r, 100));
    assertEq(sig.aborted, true, "aborted after timeout");
    assertEq(sig.reason, "TIMEOUT", "timeout reason");
  });

  await test(results, "signal: toAbortSignal works with fetch", async () => {
    const sig = createSignal({ timeoutMs: 50 });
    const abortSignal = sig.toAbortSignal();
    assertEq(abortSignal.aborted, false, "not aborted");
    await new Promise((r) => setTimeout(r, 100));
    assertEq(abortSignal.aborted, true, "aborted");
  });

  // -----------------------------------------------------------------------
  // Retry Policy
  // -----------------------------------------------------------------------
  await test(results, "retry: computeDelay exponential", () => {
    const policy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      backoff: "exponential",
      initial_delay_ms: 100,
      max_delay_ms: 10_000,
    };
    assertEq(computeDelay(policy, 1), 100, "attempt 1");
    assertEq(computeDelay(policy, 2), 200, "attempt 2");
    assertEq(computeDelay(policy, 3), 400, "attempt 3");
    assertEq(computeDelay(policy, 10), 10_000, "capped at max");
  });

  await test(results, "retry: shouldRetry respects retryable_errors", () => {
    const policy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      enabled: true,
      max_attempts: 3,
      retryable_errors: ["TIMEOUT", "RATE_LIMITED"],
    };
    const timeoutErr: any = { code: "TIMEOUT", message: "timeout", retryable: true };
    const internalErr: any = { code: "INTERNAL_ERROR", message: "internal", retryable: true };
    assert(shouldRetry(policy, 1, timeoutErr, { idempotent: true }), "TIMEOUT retryable");
    assert(!shouldRetry(policy, 1, internalErr, { idempotent: true }), "INTERNAL_ERROR not in retryable_errors");
  });

  await test(results, "retry: shouldRetry respects max_attempts", () => {
    const policy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      enabled: true,
      max_attempts: 3,
      retryable_errors: ["TIMEOUT"],
    };
    const err: any = { code: "TIMEOUT", message: "timeout", retryable: true };
    assert(shouldRetry(policy, 1, err), "attempt 1 → retry");
    assert(shouldRetry(policy, 2, err), "attempt 2 → retry");
    assert(!shouldRetry(policy, 3, err), "attempt 3 = max → stop");
  });

  await test(results, "retry: shouldRetry blocks non-idempotent side effects", () => {
    const policy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      enabled: true,
      max_attempts: 3,
      retryable_errors: ["PROVIDER_ERROR"],
    };
    const err: any = { code: "PROVIDER_ERROR", message: "err", retryable: true };
    // non-idempotent, no idempotency_key → block
    assert(!shouldRetry(policy, 1, err, { idempotent: false, hasIdempotencyKey: false }), "block non-idempotent");
    // with idempotency_key → allow
    assert(shouldRetry(policy, 1, err, { idempotent: false, hasIdempotencyKey: true }), "allow with key");
  });

  await test(results, "retry: withRetry retries and succeeds", async () => {
    const policy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      enabled: true,
      max_attempts: 3,
      initial_delay_ms: 1,
      max_delay_ms: 5,
      retryable_errors: ["TIMEOUT"],
    };
    let attempt = 0;
    const result = await withRetry(async (a: number) => {
      attempt = a;
      if (a < 3) throw new AEPError({ code: "TIMEOUT", message: "timeout" });
      return "success";
    }, policy);
    assertEq(result, "success", "eventually succeeds");
    assertEq(attempt, 3, "3 attempts");
  });

  await test(results, "retry: withRetry exhausts max_attempts", async () => {
    const policy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      enabled: true,
      max_attempts: 2,
      initial_delay_ms: 1,
      max_delay_ms: 5,
      retryable_errors: ["TIMEOUT"],
    };
    let threw = false;
    try {
      await withRetry(async () => {
        throw new AEPError({ code: "TIMEOUT", message: "timeout" });
      }, policy);
    } catch (err) {
      threw = true;
      assert(isAEPError(err), "is AEPError");
    }
    assert(threw, "must throw after exhaustion");
  });

  // -----------------------------------------------------------------------
  // Effects Descriptor
  // -----------------------------------------------------------------------
  await test(results, "effects: read = no side effect", () => {
    assert(!hasSideEffect({ kind: "read" }), "read has no side effect");
    assert(hasSideEffect({ kind: "write" }), "write has side effect");
    assert(hasSideEffect({ kind: "delete" }), "delete has side effect");
    assert(hasSideEffect({ kind: "financial" }), "financial has side effect");
  });

  await test(results, "effects: requiresApproval flags risky operations", () => {
    assert(requiresApproval([{ kind: "read" }]) === false, "read doesn't need approval");
    assert(requiresApproval([{ kind: "financial" }]) === true, "financial needs approval");
    assert(requiresApproval([{ kind: "delete" }]) === true, "delete needs approval");
    assert(requiresApproval([{ kind: "irreversible" }]) === true, "irreversible needs approval");
    assert(requiresApproval([{ kind: "identity" }]) === true, "identity needs approval");
  });

  await test(results, "effects: summarizeEffects gives full summary", () => {
    const summary = summarizeEffects([
      { kind: "write", resource: "repo:org/proj" },
      { kind: "financial", resource: "account:alice" },
      { kind: "network" },
    ]);
    assertEq(summary.has_side_effects, true, "has side effects");
    assertEq(summary.financial, true, "financial");
    assertEq(summary.network, true, "network");
    assertEq(summary.irreversible, false, "not irreversible");
    assert(summary.resources.includes("repo:org/proj"), "includes resource 1");
    assert(summary.resources.includes("account:alice"), "includes resource 2");
  });

  // -----------------------------------------------------------------------
  // Budget Store
  // -----------------------------------------------------------------------
  await test(results, "budget: reserve + consume + settle", async () => {
    const store = new InMemoryBudgetStore();
    const scope = { principal_id: "alice" };
    const r1 = await store.reserve(scope, { cost_usd: 5, calls: 10 });
    assert(r1.success, "reserved");
    await store.consume(r1.reservation_id, { cost_usd: 3, calls: 5 });
    await store.settle(r1.reservation_id);
    // no throw = pass
  });

  // -----------------------------------------------------------------------
  // Persistence interfaces (in-memory)
  // -----------------------------------------------------------------------
  await test(results, "execution-store: save + load + transition atomic", async () => {
    const store = new InMemoryExecutionStore();
    const record: any = {
      id: "exec_1", request_id: "req_1", principal: { type: "user", id: "alice" },
      authorization: { bearer_token: "test-token:alice" },
      capability: { id: "math.add" }, state: "created", created_at: new Date().toISOString(),
    };
    await store.save(record);
    const loaded = await store.load("exec_1");
    assert(loaded !== null, "loaded");
    assertEq(loaded!.state, "created", "state");

    // valid transition
    const r1 = await store.transition("exec_1", "created", "planned");
    assert(r1.success, "valid transition succeeds");
    // invalid transition (current is now 'planned')
    const r2 = await store.transition("exec_1", "created", "running");
    assert(!r2.success, "invalid transition fails (state mismatch)");
  });

  await test(results, "idempotency-store: atomic reserve (dedup)", async () => {
    const store = new InMemoryIdempotencyStore();
    const scope = {
      principal_id: "alice", capability_id: "math.add", idempotency_key: "k1",
    };
    let counter = 0;
    const r1 = await store.reserve(scope, () => {
      counter++;
      return { scope, execution_id: `exec_${counter}`, state: "completed" as const, expires_at: 0 };
    }, 60_000);
    assert(r1.created, "first reserve creates");
    const r2 = await store.reserve(scope, () => {
      counter++;
      return { scope, execution_id: `exec_${counter}`, state: "completed" as const, expires_at: 0 };
    }, 60_000);
    assert(!r2.created, "second reserve dedups");
    assertEq(r1.entry.execution_id, r2.entry.execution_id, "same execution_id");
    assertEq(counter, 1, "factory called once");
  });

  await test(results, "event-store: append + read + lastSequence", async () => {
    const store = new InMemoryEventStore();
    await store.append({ event_id: "e1", type: "execution.started", source: "test", timestamp: new Date().toISOString() });
    await store.append({ event_id: "e2", type: "execution.completed", source: "test", timestamp: new Date().toISOString() });
    assertEq(await store.lastSequence(), 2, "sequence 2");
    const events = await store.read(1);
    assertEq(events.length, 2, "read 2");
  });

  // -----------------------------------------------------------------------
  // AEPError class
  // -----------------------------------------------------------------------
  await test(results, "aep-error: typed error with code + retryable", () => {
    const err = new AEPError({ code: "TIMEOUT", message: "timed out", retry_after_ms: 1000 });
    assertEq(err.code, "TIMEOUT", "code");
    assertEq(err.retryable, true, "retryable");
    assertEq(err.retryAfterMs, 1000, "retry_after_ms");
    assertEq(err.name, "AEPError", "name");
    assert(isAEPError(err), "isAEPError");
  });

  await test(results, "aep-error: default retryable from table", () => {
    const err1 = new AEPError({ code: "INVALID_REQUEST", message: "bad" });
    assertEq(err1.retryable, false, "INVALID_REQUEST not retryable");
    const err2 = new AEPError({ code: "RATE_LIMITED", message: "rate" });
    assertEq(err2.retryable, true, "RATE_LIMITED retryable");
  });

  await test(results, "aep-error: factories", () => {
    assertEq(invalidRequest("bad").code, "INVALID_REQUEST", "factory invalidRequest");
    assertEq(unauthorized("no").code, "UNAUTHORIZED", "factory unauthorized");
    assertEq(timeoutErr("slow").code, "TIMEOUT", "factory timeout");
    assertEq(rateLimited(500).code, "RATE_LIMITED", "factory rateLimited");
    assertEq(budgetExceeded(15, 10).code, "BUDGET_EXCEEDED", "factory budgetExceeded");
    assertEq(policyDenied("RISK_TOO_HIGH").code, "POLICY_DENIED", "factory policyDenied");
  });

  await test(results, "aep-error: asAEPError classifies generic errors", () => {
    const e1 = asAEPError(new Error("Connection timeout"));
    assertEq(e1.code, "TIMEOUT", "classified as TIMEOUT");
    const e2 = asAEPError(new Error("Unauthorized access"));
    assertEq(e2.code, "UNAUTHORIZED", "classified as UNAUTHORIZED");
    const e3 = asAEPError("plain string error");
    assertEq(e3.code, "INTERNAL_ERROR", "default INTERNAL_ERROR");
  });

  return results;
}
