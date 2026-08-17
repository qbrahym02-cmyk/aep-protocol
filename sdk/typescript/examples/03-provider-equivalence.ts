/**
  * Example 3 — Provider interchangeability
  * Reference: spec/003-capabilities.md §Capability Equivalence[ar] §Provider Model
  * 
  * [ar] [ar]semantic_class [ar] provider[ar] [ar].
  * /

import { CapabilityRegistry } from "../src/core/registry.js";
import { BUILTIN_CAPABILITIES } from "../src/providers/builtin.js";

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
  const reg = new CapabilityRegistry();
  const github = BUILTIN_CAPABILITIES.find((c) => c.id === "github.issue.create")!;
  const linear = BUILTIN_CAPABILITIES.find((c) => c.id === "linear.issue.create")!;

  reg.register(capToContract(github), { handler: github.execute, provider_id: "github" });
  reg.register(capToContract(linear), { handler: linear.execute, provider_id: "linear" });

  // [ar] [ar] [ar] [ar]capabilities [ar] semantic_class
  console.log("Discovering 'issue.creation' semantic class:\n");
  const items = reg.discover({ semantic_class: "issue.creation", level: 2 });
  for (const item of items) {
    console.log(`  - ${item.id} (provider: ${item.provider}, risk: ${item.risk_level})`);
  }

  // [ar] [ar] github → fallback [ar] linear
  console.log("\n--- Simulating github provider failure ---\n");
  reg.setHealth("github.issue.create", "github", "offline");

  const afterFail = reg.discover({ semantic_class: "issue.creation" });
  console.log("After github went offline:");
  for (const item of afterFail) {
    console.log(`  - ${item.id} (provider: ${item.provider}, health: ${item.health})`);
  }

  // resolve should pick linear now
  const resolved = reg.resolve({ id: "linear.issue.create" });
  console.log("\nResolved:", resolved?.contract.id, "from provider:", resolved?.provider_id);
}

main().catch(console.error);
