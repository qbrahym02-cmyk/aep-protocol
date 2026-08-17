/**
  * Example 6 — Authority + Delegation
  * Reference: spec/profiles/authority.md
  * 
  * [ar]:
  * 1) alice (user) [ar] authority [ar]supervisor agent
  * 2) supervisor [ar] subset [ar]child agent
  * 3) child [ar] [ar] capability
  * /

import { AuthorityEngine } from "../src/authority/engine.js";
import type { Principal } from "../src/core/types.js";

async function main() {
  const engine = new AuthorityEngine();

  const alice: Principal = { type: "user", id: "user.alice" };
  const supervisor: Principal = { type: "agent", id: "agent.supervisor" };
  const child: Principal = { type: "agent", id: "agent.child" };

  // 1) Alice issues authority to supervisor
  console.log("--- 1) Alice issues authority to supervisor ---");
  const parentAuth = engine.issue({
    subject: supervisor,
    capabilities: ["deploy.*", "test.*", "db.*"],
    resources: ["environment:staging", "environment:production"],
    constraints: {
      max_duration_ms: 600000,
      max_cost_usd: 10,
      max_calls: 50,
    },
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    delegatable: true,
    issued_by: alice,
  });
  console.log("Parent authority:", parentAuth.id);
  console.log("Capabilities:", parentAuth.capabilities);
  console.log("Constraints:", parentAuth.constraints);

  // 2) Supervisor delegates subset to child
  console.log("\n--- 2) Supervisor delegates subset to child ---");
  const childAuth = engine.deriveTo(
    parentAuth.id,
    child,
    {
      capabilities: ["deploy.staging"],         // subset of deploy.*
      resources: ["environment:staging"],       // only staging
      constraints: { max_cost_usd: 5 },         // ≤ parent
      expires_at: new Date(Date.now() + 1800_000).toISOString(), // ≤ parent
    },
    supervisor
  );
  console.log("Child authority:", childAuth.id);
  console.log("Delegation chain:", childAuth.delegation_chain);

  // 3) Test what child can/cannot do
  console.log("\n--- 3) Child canExercise checks ---");
  console.log("deploy.staging:   ", engine.canExercise(childAuth, "deploy.staging"));
  console.log("deploy.production:", engine.canExercise(childAuth, "deploy.production"), "(NOT in capabilities)");
  console.log("test.run:         ", engine.canExercise(childAuth, "test.run"), "(NOT in capabilities)");
  console.log("db.query:         ", engine.canExercise(childAuth, "db.query"), "(NOT in capabilities)");

  // 4) Try invalid derivation (subset violation)
  console.log("\n--- 4) Subset violation ---");
  try {
    engine.deriveTo(
      parentAuth.id,
      child,
      { capabilities: ["payment.*"] }, // NOT subset
      supervisor
    );
  } catch (err) {
    console.log("Correctly rejected:", (err as Error).message);
  }

  // 5) Revoke parent → cascade to child
  console.log("\n--- 5) Revoke parent (cascade) ---");
  engine.revoke(parentAuth.id, alice);
  console.log("Parent revoked:", engine.isRevoked(parentAuth.id));
  console.log("Child cascaded:", engine.isRevoked(childAuth.id));

  // 6) Stats
  console.log("\n--- 6) Stats ---");
  console.log(engine.stats());
}

main().catch(console.error);
