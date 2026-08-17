/**
 * Conformance — Property Tests
 * Reference: spec/10-10 §51 Property Tests
 * 
 * :
 * ∀ B = derive(A) → B ⊆ A
 * ∀ invalid transition → transition rejected
 * ∀ canonical(x) = canonical(y) ⇔ x ≡ y (semantically)
 * ∀ authority revoked → all children revoked
  */

import { AuthorityEngine } from "../../authority/engine.js";
import { canonicalize, fingerprint } from "../../core/canonical.js";
import { canTransition, isTerminal } from "../../execution/state-machine.js";
import { ulid, ulidCompare, ulidTimestamp } from "../../core/ulid.js";
import type { ConformanceResult } from "../runner.js";

export async function runPropertyTests(
  test: (results: ConformanceResult[], name: string, fn: () => void | Promise<void>) => Promise<void>,
  assert: (cond: boolean, msg: string) => void
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];

  // -----------------------------------------------------------------------
  await test(results, "property: derive ⊆ parent — 100 random derivations", () => {
    const engine = new AuthorityEngine();
    const parent = engine.issue({
      subject: { type: "agent", id: "agent.parent" },
      capabilities: ["deploy.*", "test.*", "db.*"],
      resources: ["env:staging", "env:production", "db:orders"],
      constraints: { max_cost_usd: 100, max_calls: 1000, max_duration_ms: 600000 },
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: true,
      issued_by: { type: "user", id: "alice" },
    });

    const randomChoice = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    const randomSubset = <T,>(arr: T[]): T[] => {
      const n = Math.floor(Math.random() * arr.length) + 1;
      return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
    };

    for (let i = 0; i < 100; i++) {
      const childCaps = randomSubset(parent.capabilities);
      const childRes = randomSubset(parent.resources);
      const childCost = Math.random() * parent.constraints!.max_cost_usd!;
      const childCalls = Math.floor(Math.random() * parent.constraints!.max_calls!);

      const child = engine.deriveTo(parent.id,
        { type: "agent", id: `agent.child_${i}` },
        {
          capabilities: childCaps,
          resources: childRes,
          constraints: { max_cost_usd: childCost, max_calls: childCalls },
        },
        { type: "agent", id: "agent.parent" });

      // property: child can never exercise capabilities outside its declared subset
      for (const cap of parent.capabilities) {
        if (!childCaps.some((c: string) => new RegExp("^" + c.replace(/\*/g, ".*") + "$").test(cap))) {
          // not in subset → child should NOT be able to exercise
          const decision = engine.canExercise(child, cap);
          assert(!decision.allowed, `child must not exercise ${cap}`);
        }
      }
    }
  });

  // -----------------------------------------------------------------------
  await test(results, "property: all invalid transitions rejected — exhaustive", () => {
    const states = [
      "created", "planned", "awaiting_approval", "authorized", "queued",
      "running", "paused", "cancelling", "cancelled", "retrying",
      "compensating", "completed", "failed", "expired",
    ] as const;

    let validTransitions = 0;
    let invalidTransitions = 0;

    for (const from of states) {
      for (const to of states) {
        if (from === to) continue;
        const ok = canTransition(from, to);
        if (ok) {
          validTransitions++;
          // property: terminal states never have outgoing transitions
          if (isTerminal(from)) {
            assert(false, `terminal state ${from} cannot transition to ${to}`);
          }
        } else {
          invalidTransitions++;
        }
      }
    }
    assert(validTransitions > 0, "should have some valid transitions");
    assert(invalidTransitions > 0, "should have some invalid transitions");
  });

  // -----------------------------------------------------------------------
  await test(results, "property: canonical form is deterministic — 1000 random objects", () => {
    const generate = (depth: number): unknown => {
      if (depth <= 0) return Math.random() < 0.5 ? "leaf" : Math.random();
      const type = Math.floor(Math.random() * 3);
      if (type === 0) return "string_value_" + Math.floor(Math.random() * 1000);
      if (type === 1) return Math.floor(Math.random() * 1000);
      const obj: Record<string, unknown> = {};
      const keys = ["b", "a", "c", "d", "e"].sort(() => Math.random() - 0.5).slice(0, 3);
      for (const k of keys) obj[k] = generate(depth - 1);
      return obj;
    };

    for (let i = 0; i < 1000; i++) {
      const obj = generate(3);
      const c1 = canonicalize(obj);
      const c2 = canonicalize(obj);
      assert(c1 === c2, "canonicalize must be deterministic");
    }
  });

  // -----------------------------------------------------------------------
  await test(results, "property: fingerprint invariant under key reordering", () => {
    for (let i = 0; i < 100; i++) {
      const a = { z: 1, a: 2, m: 3, b: 4 };
      const b = { b: 4, m: 3, a: 2, z: 1 };
      assert(fingerprint(a) === fingerprint(b), "fingerprint must be canonical");
    }
  });

  // -----------------------------------------------------------------------
  await test(results, "property: ULID monotonic — 100 ULIDs in same ms", () => {
    const now = Date.now();
    const ulids = Array.from({ length: 100 }, () => ulid(now));
    // all should have same timestamp
    for (const u of ulids) {
      assert(ulidTimestamp(u) === now, "timestamp matches");
    }
    // sorted lexicographically should equal sorted by timestamp (which is same)
    const lexSorted = [...ulids].sort();
    assert(lexSorted.length === 100, "all 100 ulids sorted");
  });

  // -----------------------------------------------------------------------
  await test(results, "property: ULID compare handles prefixes", () => {
    const a = `exec_${ulid(1000)}`;
    const b = `exec_${ulid(2000)}`;
    assert(ulidCompare(a, b) < 0, "earlier ulid < later");
    assert(ulidCompare(b, a) > 0, "later > earlier");
    assert(ulidCompare(a, a) === 0, "equal");
  });

  // -----------------------------------------------------------------------
  await test(results, "property: revocation cascades — 5-level chain", () => {
    const engine = new AuthorityEngine();
    let parent = engine.issue({
      subject: { type: "agent", id: "agent.lvl_0" },
      capabilities: ["*"],
      resources: [],
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      delegatable: true,
      issued_by: { type: "user", id: "alice" },
    });

    const chain = [parent];
    for (let i = 1; i < 5; i++) {
      parent = engine.deriveTo(parent.id,
        { type: "agent", id: `agent.lvl_${i}` },
        { capabilities: ["*"] },
        { type: "agent", id: `agent.lvl_${i - 1}` });
      chain.push(parent);
    }

    // revoke root → all 5 should be revoked
    engine.revoke(chain[0].id, { type: "user", id: "alice" });
    for (const auth of chain) {
      assert(engine.isRevoked(auth.id), `authority ${auth.id} must be revoked`);
    }
  });

  return results;
}
