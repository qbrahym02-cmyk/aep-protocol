/**
 * Conformance — Durable Stores + Recovery + Test Vectors
 * Reference: spec/10-10 §36 Persistence§83 Crash Recovery§91 Test Vectors
  */

import { SQLiteStore } from "../persistence/adapters/sqlite.js";
import { RecoveryEngine } from "../recovery/engine.js";
import { runAllVectors, exportVectorsAsJSON } from "./vectors/vectors.js";
import type { ConformanceResult } from "./runner.js";

export async function runDurableTests(
  test: (results: ConformanceResult[], name: string, fn: () => void | Promise<void>) => Promise<void>,
  assert: (cond: boolean, msg: string) => void,
  assertEq: <T>(actual: T, expected: T, msg: string) => void
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];

  // SQLite ExecutionStore
  await test(results, "sqlite: save + load execution", async () => {
    const store = new SQLiteStore({ dbPath: ":memory:" });
    const execStore = store.asExecutionStore();
    const record: any = {
      id: "exec_sqlite_1", request_id: "req_1",
      principal: { type: "user", id: "alice" },
      capability: { id: "math.add" }, state: "created",
      created_at: new Date().toISOString(),
    };
    await execStore.save(record);
    const loaded = await execStore.load("exec_sqlite_1");
    assert(loaded !== null, "loaded");
    assertEq(loaded!.state, "created", "state match");
    store.close();
  });

  await test(results, "sqlite: atomic transition (CAS)", async () => {
    const store = new SQLiteStore({ dbPath: ":memory:" });
    const execStore = store.asExecutionStore();
    await execStore.save({
      id: "exec_sqlite_2", request_id: "req_2",
      principal: { type: "user", id: "alice" },
      capability: { id: "math.add" }, state: "created",
      created_at: new Date().toISOString(),
    } as any);
    const r1 = await execStore.transition("exec_sqlite_2", "created", "planned");
    assert(r1.success, "valid transition");
    const r2 = await execStore.transition("exec_sqlite_2", "created", "planned");
    assert(!r2.success, "invalid (state mismatch)");
    store.close();
  });

  await test(results, "sqlite: list executions", async () => {
    const store = new SQLiteStore({ dbPath: ":memory:" });
    const execStore = store.asExecutionStore();
    for (let i = 0; i < 5; i++) {
      await execStore.save({
        id: `exec_${i}`, request_id: `req_${i}`,
        principal: { type: "user", id: "alice" },
        capability: { id: "math.add" }, state: "running",
        created_at: new Date().toISOString(),
      } as any);
    }
    const list = await execStore.list({ principal_id: "alice" });
    assertEq(list.length, 5, "5 executions");
    const running = await execStore.list({ state: "running" });
    assertEq(running.length, 5, "5 running");
    store.close();
  });

  await test(results, "sqlite: idempotency atomic reserve (dedup)", async () => {
    const store = new SQLiteStore({ dbPath: ":memory:" });
    const idemStore = store.asIdempotencyStore();
    const scope = { principal_id: "alice", capability_id: "math.add", idempotency_key: "k_sqlite_1" };
    let counter = 0;
    const r1 = await idemStore.reserve(scope, () => ({
      scope, execution_id: `exec_${++counter}`, state: "completed" as const, expires_at: 0,
    }), 60_000);
    assert(r1.created, "first reserve creates");
    const r2 = await idemStore.reserve(scope, () => ({
      scope, execution_id: `exec_${++counter}`, state: "completed" as const, expires_at: 0,
    }), 60_000);
    assert(!r2.created, "second reserve dedups");
    assertEq(counter, 1, "factory called once");
    store.close();
  });

  await test(results, "sqlite: idempotency tenant isolation", async () => {
    const store = new SQLiteStore({ dbPath: ":memory:" });
    const idemStore = store.asIdempotencyStore();
    const scopeA = { tenant_id: "tenant_A", principal_id: "alice", capability_id: "deploy", idempotency_key: "shared_key" };
    const scopeB = { ...scopeA, tenant_id: "tenant_B" };
    const r1 = await idemStore.reserve(scopeA, () => ({ scope: scopeA, execution_id: "exec_A", state: "completed" as const, expires_at: 0 }), 60_000);
    const r2 = await idemStore.reserve(scopeB, () => ({ scope: scopeB, execution_id: "exec_B", state: "completed" as const, expires_at: 0 }), 60_000);
    assert(r1.created, "tenant A creates");
    assert(r2.created, "tenant B creates (isolated)");
    store.close();
  });

  await test(results, "sqlite: authority recursive cascade revoke (5 levels)", async () => {
    const store = new SQLiteStore({ dbPath: ":memory:" });
    const authStore = store.asAuthorityStore();
    const future = (offset: number) => new Date(Date.now() + offset).toISOString();
    await authStore.save({
      id: "auth_root", subject: { type: "agent", id: "agent.lvl_0" },
      capabilities: ["*"], resources: [],
      expires_at: future(3600_000), delegatable: true,
      issued_by: { type: "user", id: "alice" }, issued_at: future(0),
      state: "active", delegation_chain: ["alice", "agent.lvl_0"],
    } as any);
    for (let i = 1; i < 5; i++) {
      await authStore.save({
        id: `auth_lvl_${i}`, subject: { type: "agent", id: `agent.lvl_${i}` },
        capabilities: ["*"], resources: [],
        expires_at: future(3600_000 - i * 600_000), delegatable: true,
        issued_by: { type: "agent", id: `agent.lvl_${i - 1}` }, issued_at: future(0),
        state: "active",
        parent_authority_id: i === 1 ? "auth_root" : `auth_lvl_${i - 1}`,
        delegation_chain: ["alice", `agent.lvl_${i}`],
      } as any);
    }
    const success = await authStore.revoke("auth_root", { type: "user", id: "alice" } as any, true);
    assert(success, "revoke succeeded");
    for (let i = 0; i < 5; i++) {
      const id = i === 0 ? "auth_root" : `auth_lvl_${i}`;
      const isRevoked = await authStore.isRevoked(id);
      assert(isRevoked, `${id} revoked (depth ${i})`);
    }
    store.close();
  });

  await test(results, "sqlite: event store append + read", async () => {
    const store = new SQLiteStore({ dbPath: ":memory:" });
    const eventStore = store.asEventStore();
    for (let i = 0; i < 5; i++) {
      await eventStore.append({
        event_id: `e_${i}`, type: "execution.progress", source: "test",
        timestamp: new Date().toISOString(), sequence: i + 1,
      });
    }
    const events = await eventStore.read(1);
    assertEq(events.length, 5, "5 events");
    assertEq(await eventStore.lastSequence(), 5, "sequence 5");
    store.close();
  });

  await test(results, "sqlite: audit hash chain verifies", async () => {
    const store = new SQLiteStore({ dbPath: ":memory:" });
    const auditStore = store.asAuditStore();
    const ts = new Date().toISOString();
    await auditStore.append({ timestamp: ts, who: "alice", what: "execute", capability: "math.add", decision: "allow" });
    await auditStore.append({ timestamp: ts, who: "bob", what: "execute", capability: "math.add", decision: "allow" });
    await auditStore.append({ timestamp: ts, who: "alice", what: "execute", capability: "payment.charge", decision: "deny" });
    const v = await auditStore.verify();
    assert(v.valid, "chain valid");
    const list = await auditStore.list();
    assertEq(list.length, 3, "3 entries");
    store.close();
  });

  await test(results, "recovery: fail unfinished 'created' executions", async () => {
    const store = new SQLiteStore({ dbPath: ":memory:" });
    const execStore = store.asExecutionStore();
    await execStore.save({
      id: "exec_recover_1", request_id: "req_1",
      principal: { type: "user", id: "alice" },
      capability: { id: "math.add" }, state: "created",
      created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    } as any);
    const recovery = new RecoveryEngine({
      executionStore: execStore, eventStore: store.asEventStore(),
      stuckThresholdMs: 5 * 60_000,
    });
    const report = await recovery.recover();
    assertEq(report.total_unfinished, 1, "1 unfinished");
    assertEq(report.recovered[0].action, "fail", "should fail");
    const loaded = await execStore.load("exec_recover_1");
    assertEq(loaded!.state, "failed", "state moved to failed");
    store.close();
  });

  await test(results, "recovery: expire awaiting_approval past deadline", async () => {
    const store = new SQLiteStore({ dbPath: ":memory:" });
    const execStore = store.asExecutionStore();
    await execStore.save({
      id: "exec_recover_2", request_id: "req_2",
      principal: { type: "user", id: "alice" },
      capability: { id: "deploy.production" }, state: "awaiting_approval",
      created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    } as any);
    const recovery = new RecoveryEngine({
      executionStore: execStore, eventStore: store.asEventStore(),
      stuckThresholdMs: 5 * 60_000,
    });
    const report = await recovery.recover();
    assertEq(report.recovered[0].action, "fail", "should fail (expired approval)");
    store.close();
  });

  await test(results, "recovery: keep recent running executions (no action)", async () => {
    const store = new SQLiteStore({ dbPath: ":memory:" });
    const execStore = store.asExecutionStore();
    await execStore.save({
      id: "exec_recover_3", request_id: "req_3",
      principal: { type: "user", id: "alice" },
      capability: { id: "math.add" }, state: "running",
      created_at: new Date().toISOString(),
    } as any);
    const recovery = new RecoveryEngine({
      executionStore: execStore, eventStore: store.asEventStore(),
      stuckThresholdMs: 5 * 60_000,
    });
    const report = await recovery.recover();
    assertEq(report.recovered[0].action, "no_action", "should not touch recent");
    store.close();
  });

  await test(results, "recovery: reconstruct state from event log", async () => {
    const store = new SQLiteStore({ dbPath: ":memory:" });
    const eventStore = store.asEventStore();
    await eventStore.append({ event_id: "e1", type: "execution.created", source: "test", timestamp: "2026-08-17T12:00:00.000Z", execution_id: "exec_recon", sequence: 1 });
    await eventStore.append({ event_id: "e2", type: "execution.started", source: "test", timestamp: "2026-08-17T12:00:00.100Z", execution_id: "exec_recon", sequence: 2 });
    await eventStore.append({ event_id: "e3", type: "execution.completed", source: "test", timestamp: "2026-08-17T12:00:01.000Z", execution_id: "exec_recon", sequence: 3 });
    const recovery = new RecoveryEngine({
      executionStore: store.asExecutionStore(), eventStore,
    });
    const recon = await recovery.reconstructState("exec_recon");
    assertEq(recon.events.length, 3, "3 events");
    assertEq(recon.final_state, "completed", "final state inferred");
    assertEq(recon.timeline.length, 3, "timeline has 3");
    store.close();
  });

  // Test Vectors
  await test(results, "vectors: canonicalization vectors pass", () => {
    const summary = runAllVectors();
    const cat = summary.by_category["canonicalization"] || { failed: 0 };
    assertEq(cat.failed, 0, "0 canonicalization failures");
  });

  await test(results, "vectors: fingerprint vectors pass", () => {
    const summary = runAllVectors();
    assertEq(summary.by_category.fingerprint.failed, 0, "0 fingerprint failures");
  });

  await test(results, "vectors: semver vectors pass", () => {
    const summary = runAllVectors();
    assertEq(summary.by_category.semver.failed, 0, "0 semver failures");
  });

  await test(results, "vectors: state transition vectors pass", () => {
    const summary = runAllVectors();
    assertEq(summary.by_category.transitions.failed, 0, "0 transition failures");
  });

  await test(results, "vectors: audit chain vectors pass", () => {
    const summary = runAllVectors();
    assertEq(summary.by_category.audit_chain.failed, 0, "0 audit chain failures");
  });

  await test(results, "vectors: runAllVectors returns summary", () => {
    const summary = runAllVectors();
    assert(summary.total > 0, "has vectors");
    assert(summary.passed > 0, "some passed");
    const categories = Object.keys(summary.by_category);
    assert(categories.length >= 5, "5 categories");
  });

  await test(results, "vectors: export vectors as JSON", () => {
    const json = exportVectorsAsJSON();
    const parsed = JSON.parse(json);
    assert(parsed.canonical !== undefined, "has canonical");
    assert(parsed.fingerprint !== undefined, "has fingerprint");
    assert(parsed.semver !== undefined, "has semver");
    assert(parsed.transitions !== undefined, "has transitions");
    assert(parsed.audit_chain !== undefined, "has audit_chain");
  });

  return results;
}
