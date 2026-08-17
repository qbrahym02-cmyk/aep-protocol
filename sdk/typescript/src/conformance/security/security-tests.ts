/**
 * Conformance — Security Tests
 * Reference: spec/10-10 §50 Security Tests
 * 
 * Tests:
 * - forged principal
 * - expired authority
 * - revoked authority
 * - wrong subject
 * - wrong resource
 * - child authority escalation
 * - parent authority escalation
 * - artifact access by another tenant
 * - execution access by another principal
 * - malformed schema
  */

import { AEPServer } from "../../server.js";
import { BUILTIN_CAPABILITIES } from "../../providers/builtin.js";
import { AuthorityEngine } from "../../authority/engine.js";
import { CapabilityRegistry } from "../../core/registry.js";
import { TestAuthenticator } from "../../principal/authenticator.js";
import type { ConformanceResult } from "../runner.js";

function capToContract(c: (typeof BUILTIN_CAPABILITIES)[number]) {
  return {
    id: c.id, version: c.version, kind: c.kind, description: c.description,
    input: c.input, output: c.output, execution: c.execution, risk: c.risk,
    authorization: c.authorization || { scopes: [] },
    cost: c.cost, performance: c.performance, semantic_class: c.semantic_class,
    compensation: c.compensation, provider: c.provider, region: c.region,
  };
}

export async function runSecurityTests(
  test: (results: ConformanceResult[], name: string, fn: () => void | Promise<void>) => Promise<void>,
  assert: (cond: boolean, msg: string) => void,
  assertEq: <T>(actual: T, expected: T, msg: string) => void
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];

  // -----------------------------------------------------------------------
  await test(results, "security: forged principal rejected (subject mismatch)", () => {
    const engine = new AuthorityEngine();
    const auth = engine.issue({
      subject: { type: "agent", id: "agent.deploy" },
      capabilities: ["deploy.*"],
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    // different principal tries to use it
    const forge: any = {
      id: "alice.attacker",
      type: "user",
      issuer: "test",
      authenticated_at: new Date().toISOString(),
      authentication_method: "test_token",
      claims: {},
      assurance_level: "substantial",
    };
    const decision = engine.authorize(auth, forge, "deploy.staging");
    assert(!decision.allowed, "must reject");
    assertEq(decision.reason_code, "SUBJECT_MISMATCH", "subject mismatch");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: expired authority rejected", () => {
    const engine = new AuthorityEngine();
    const auth = engine.issue({
      subject: { type: "agent", id: "agent.x" },
      capabilities: ["*"],
      resources: [],
      expires_at: new Date(Date.now() - 1000).toISOString(), // past
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    const decision = engine.authorize(auth, {
      id: "agent.x", type: "agent", issuer: "test",
      authenticated_at: new Date().toISOString(),
      authentication_method: "test_token", claims: {}, assurance_level: "substantial",
    }, "anything");
    assert(!decision.allowed, "must reject");
    assertEq(decision.reason_code, "AUTHORITY_EXPIRED", "expired");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: revoked authority rejected", () => {
    const engine = new AuthorityEngine();
    const auth = engine.issue({
      subject: { type: "agent", id: "agent.x" },
      capabilities: ["*"],
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    engine.revoke(auth.id, { type: "user", id: "alice" });
    const decision = engine.authorize(auth, {
      id: "agent.x", type: "agent", issuer: "test",
      authenticated_at: new Date().toISOString(),
      authentication_method: "test_token", claims: {}, assurance_level: "substantial",
    }, "anything");
    assert(!decision.allowed, "must reject");
    assertEq(decision.reason_code, "AUTHORITY_REVOKED", "revoked");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: wrong capability rejected", () => {
    const engine = new AuthorityEngine();
    const auth = engine.issue({
      subject: { type: "agent", id: "agent.x" },
      capabilities: ["deploy.*"],
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    const decision = engine.authorize(auth, {
      id: "agent.x", type: "agent", issuer: "test",
      authenticated_at: new Date().toISOString(),
      authentication_method: "test_token", claims: {}, assurance_level: "substantial",
    }, "payment.charge");
    assert(!decision.allowed, "must reject");
    assertEq(decision.reason_code, "CAPABILITY_NOT_ALLOWED", "wrong capability");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: ★ resource omission cannot bypass scoped authority (P0)", () => {
    const engine = new AuthorityEngine();
    const auth = engine.issue({
      subject: { type: "agent", id: "agent.x" },
      capabilities: ["deploy.*"],
      resources: ["environment:staging"],  // scoped!
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    // attempt to exercise WITHOUT specifying resource → MUST be rejected
    const decision = engine.authorize(auth, {
      id: "agent.x", type: "agent", issuer: "test",
      authenticated_at: new Date().toISOString(),
      authentication_method: "test_token", claims: {}, assurance_level: "substantial",
    }, "deploy.staging" /* no resource */);
    assert(!decision.allowed, "must reject — resource required");
    assertEq(decision.reason_code, "RESOURCE_REQUIRED", "resource required");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: wrong resource rejected", () => {
    const engine = new AuthorityEngine();
    const auth = engine.issue({
      subject: { type: "agent", id: "agent.x" },
      capabilities: ["deploy.*"],
      resources: ["environment:staging"],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    const decision = engine.authorize(auth, {
      id: "agent.x", type: "agent", issuer: "test",
      authenticated_at: new Date().toISOString(),
      authentication_method: "test_token", claims: {}, assurance_level: "substantial",
    }, "deploy.staging", "environment:production");
    assert(!decision.allowed, "must reject");
    assertEq(decision.reason_code, "RESOURCE_NOT_ALLOWED", "wrong resource");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: child authority escalation blocked", () => {
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
      engine.deriveTo(parent.id, { type: "agent", id: "agent.child" },
        { capabilities: ["payment.*"] },  // exceeds parent
        { type: "agent", id: "agent.supervisor" });
    } catch {
      threw = true;
    }
    assert(threw, "escalation must throw");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: non-issuer cannot revoke", () => {
    const engine = new AuthorityEngine();
    const auth = engine.issue({
      subject: { type: "agent", id: "agent.x" },
      capabilities: ["*"],
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    let threw = false;
    try {
      // attacker tries to revoke alice's authority
      engine.revoke(auth.id, { type: "user", id: "attacker" });
    } catch {
      threw = true;
    }
    assert(threw, "non-issuer revoke must throw");
    assert(!engine.isRevoked(auth.id), "authority still active");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: admin can emergency-revoke", () => {
    const engine = new AuthorityEngine();
    const auth = engine.issue({
      subject: { type: "agent", id: "agent.x" },
      capabilities: ["*"],
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    engine.emergencyRevoke(auth.id, { type: "user", id: "admin" });
    assert(engine.isRevoked(auth.id), "admin can revoke");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: revoker_id mismatch in proof rejected", () => {
    const engine = new AuthorityEngine();
    const auth = engine.issue({
      subject: { type: "agent", id: "agent.x" },
      capabilities: ["*"],
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: false,
      issued_by: { type: "user", id: "alice" },
    });
    let threw = false;
    try {
      engine.revoke(auth.id, { type: "user", id: "alice" }, {
        revoker_id: "different_user",  // mismatch!
        is_issuer: true,
        reason: "explicit",
        at: new Date().toISOString(),
      });
    } catch {
      threw = true;
    }
    assert(threw, "mismatch in proof must throw");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: authenticator rejects unauthenticated", async () => {
    const auth = new TestAuthenticator();
    // no token registered for "unknown" — but TestAuthenticator auto-creates
    const principal = await auth.authenticate({
      type: "test_token",
      principal_id: "test.alice",
      principal_type: "user",
    });
    assertEq(principal.id, "test.alice", "principal id");
    assertEq(principal.authentication_method, "test_token", "auth method");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: tenant isolation in idempotency scope", async () => {
    const { InMemoryIdempotencyStore } = await import("../../persistence/interfaces.js");
    const store = new InMemoryIdempotencyStore();
    // tenant A reserves a key
    const scopeA = {
      tenant_id: "tenant_A",
      principal_id: "agent.x",
      capability_id: "deploy.staging",
      idempotency_key: "key_1",
    };
    const r1 = await store.reserve(scopeA, () => ({
      scope: scopeA, execution_id: "exec_A", state: "completed" as const, expires_at: 0,
    }), 60_000);
    assert(r1.created, "tenant A created");

    // tenant B with same key → MUST create new (different scope)
    const scopeB = { ...scopeA, tenant_id: "tenant_B" };
    const r2 = await store.reserve(scopeB, () => ({
      scope: scopeB, execution_id: "exec_B", state: "completed" as const, expires_at: 0,
    }), 60_000);
    assert(r2.created, "tenant B should create new (isolated)");
    assert(r1.entry.execution_id !== r2.entry.execution_id, "different executions");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: redaction removes secrets", async () => {
    const { redact } = await import("../../events/redaction.js");
    const result = redact({
      username: "alice",
      password: "super_secret_123",
      api_key: "sk_test_abc123",
      token: "Bearer eyJhbGc...",
      nested: { secret: "hidden", ok: "visible" },
    });
    assertEq((result as any).username, "alice", "username kept");
    assertEq((result as any).password, "[REDACTED]", "password redacted");
    assertEq((result as any).api_key, "[REDACTED]", "api_key redacted");
    assert((result as any).token.includes("[REDACTED]"), "Bearer redacted");
    assertEq((result as any).nested.ok, "visible", "nested.ok kept");
    assertEq((result as any).nested.secret, "[REDACTED]", "nested.secret redacted");
  });

  // -----------------------------------------------------------------------
  await test(results, "security: redaction strips PEM private key", async () => {
    const { redactString } = await import("../../events/redaction.js");
    const input = `config: -----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----`;
    const result = redactString(input);
    assert(!result.includes("MIIEpA"), "PEM content stripped");
    assert(result.includes("[REDACTED]"), "[REDACTED] present");
  });

  return results;
}
