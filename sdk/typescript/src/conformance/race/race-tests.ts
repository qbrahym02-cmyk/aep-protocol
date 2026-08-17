/**
 * Conformance — Race Tests
 * Reference: spec/10-10 §49 Concurrency§104 Race Testing
 * 
 * 100 concurrent identical requests → 1 execution + 99 idempotent references.
 * if side effect → fail.
  */

import { AEPServer } from "../../server.js";
import { BUILTIN_CAPABILITIES } from "../../providers/builtin.js";
import type { ConformanceResult } from "../runner.js";

let sideEffectCount = 0;
let lastValue = 0;

const counterCap: typeof BUILTIN_CAPABILITIES[number] = {
  id: "race.counter",
  version: "1.0.0",
  kind: "action",
  description: "Race test counter — increments side effect counter",
  input: {
    schema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
  output: {
    schema: {
      type: "object",
      required: ["value"],
      properties: { value: { type: "integer" } },
    },
  },
  execution: { sync: true, async: false, streaming: false, cancel: false, retry: true, idempotent: true, dry_run: false },
  risk: { level: "low", side_effect: true, reversible: true, blast_radius: "single_record" },
  authorization: { scopes: [] },
  execute: async ({ input }: { input: unknown }) => {
    sideEffectCount++;
    lastValue++;
    return { output: { value: lastValue, side_effect_count: sideEffectCount } };
  },
};

export async function runRaceTests(
  test: (results: ConformanceResult[], name: string, fn: () => void | Promise<void>) => Promise<void>,
  assert: (cond: boolean, msg: string) => void
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];

  await test(results, "race: 100 concurrent identical requests → 1 side effect", async () => {
    sideEffectCount = 0;
    lastValue = 0;
    const server = new AEPServer();
    server.capability(counterCap);

    const req = {
      aep: "0.1" as const,
      id: "req_race_1",
      type: "execute" as const,
      principal: { type: "user" as const, id: "alice" },
      capability: { id: "race.counter" },
      input: { name: "visits" },
      execution: { idempotency_key: "race_key_42" },
    };

    // 100 concurrent
    const responses = await Promise.all(
      Array.from({ length: 100 }, () => server.execute({ ...req }))
    );

    // responses Must completed
    for (const r of responses) {
      assert(r.status === "completed" || r.status === "accepted", `response status: ${r.status}`);
    }

    // execution_id Must 
    const execIds = new Set(responses.map((r: any) => r.execution?.id).filter(Boolean));
    assert(execIds.size === 1, `expected 1 unique execution_id, got ${execIds.size}`);

    // side effect Must 
    assert(sideEffectCount === 1, `side effect must happen exactly once, got ${sideEffectCount}`);
  });

  await test(results, "race: different keys → different executions", async () => {
    sideEffectCount = 0;
    const server = new AEPServer();
    server.capability(counterCap);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        server.execute({
          aep: "0.1",
          id: `req_${i}`,
          type: "execute",
          principal: { type: "user", id: "alice" },
          capability: { id: "race.counter" },
          input: { name: `counter_${i}` },
          execution: { idempotency_key: `key_${i}` },
        })
      )
    );

    const execIds = new Set(responses.map((r: any) => r.execution?.id).filter(Boolean));
    assert(execIds.size === 10, `expected 10 unique execution_ids, got ${execIds.size}`);
    assert(sideEffectCount === 10, `expected 10 side effects, got ${sideEffectCount}`);
  });

  await test(results, "race: no idempotency_key → each request gets own execution", async () => {
    sideEffectCount = 0;
    const server = new AEPServer();
    server.capability(counterCap);

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        server.execute({
          aep: "0.1",
          id: `req_noidem_${i}`,
          type: "execute",
          principal: { type: "user", id: "alice" },
          capability: { id: "race.counter" },
          input: { name: "no_idem" },
          // no idempotency_key
        })
      )
    );

    const execIds = new Set(responses.map((r: any) => r.execution?.id).filter(Boolean));
    assert(execIds.size === 5, `expected 5 unique executions, got ${execIds.size}`);
  });

  return results;
}
