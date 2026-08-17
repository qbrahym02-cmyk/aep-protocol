/**
  * Example 7 — Capability Resolution (Intent → Best Capability)
  * Reference: spec/profiles/discovery.md
  * 
  * [ar]Agent [ar] [ar] with[ar] [ar] capability [ar].
  * [ar] intent[ar] [ar]resolver [ar] [ar] candidates [ar].
  * /

import { CapabilityResolver } from "../src/discovery/resolver.js";
import { CapabilityRegistry } from "../src/core/registry.js";
import { BUILTIN_CAPABILITIES } from "../src/providers/builtin.js";
import { AuthorityEngine } from "../src/authority/engine.js";

function capToContract(c: (typeof BUILTIN_CAPABILITIES)[number]) {
  return {
    id: c.id, version: c.version, kind: c.kind, description: c.description,
    input: c.input, output: c.output, execution: c.execution, risk: c.risk,
    authorization: c.authorization || { scopes: [] },
    cost: c.cost, performance: c.performance, semantic_class: c.semantic_class,
    compensation: c.compensation, provider: c.provider, region: c.region,
    examples: c.examples,
  };
}

async function main() {
  const registry = new CapabilityRegistry();
  for (const c of BUILTIN_CAPABILITIES) registry.register(capToContract(c), { handler: c.execute });

  const resolver = new CapabilityResolver({ registry });

  // 1) Resolve "create_issue" intent
  console.log("--- 1) Resolve intent: create_issue ---");
  const r1 = resolver.resolve({
    principal: { type: "user", id: "alice" },
    intent: {
      operation: "create_issue",
      description: "Create an issue",
    },
    constraints: {
      risk_max: "medium",
      latency_max_ms: 5000,
    },
    limit: 5,
  });
  console.log(JSON.stringify(r1, null, 2));

  // 2) Resolve with strict risk filter
  console.log("\n--- 2) Resolve with risk_max=low ---");
  const r2 = resolver.resolve({
    principal: { type: "user", id: "alice" },
    intent: {},
    constraints: { risk_max: "low" },
    limit: 10,
  });
  console.log(`Total matches: ${r2.matches.length}`);
  for (const m of r2.matches) {
    console.log(`  rank ${m.rank}: ${m.capability_id} (score: ${m.score}, risk: ${m.risk_level})`);
  }

  // 3) Resolve with authority filter
  console.log("\n--- 3) Resolve with authority (only math.*) ---");
  const authEngine = new AuthorityEngine();
  const auth = authEngine.issue({
    subject: { type: "agent", id: "agent.math" },
    capabilities: ["math.*"],
    resources: [],
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    delegatable: false,
    issued_by: { type: "user", id: "alice" },
  });

  const resolverWithAuth = new CapabilityResolver({ registry, authority: authEngine });
  const r3 = resolverWithAuth.resolve({
    principal: { type: "agent", id: "agent.math" },
    intent: {},
    authority: auth,
    limit: 10,
  });
  console.log(`Total matches (authority-filtered): ${r3.matches.length}`);
  for (const m of r3.matches) {
    console.log(`  ${m.capability_id} (score: ${m.score})`);
  }
}

main().catch(console.error);
