/**
  * Example 4 — Policy + Risk + Approval
  * Reference: spec/002-envelope.md §Policy[ar] §Risk[ar] §Approval
  * 
  * [ar]:
  * - [ar] researcher Cannot[ar] [ar] payment.charge
  * - [ar] deployer Can[ar] [ar] deploy.production [ar] [ar] [ar] (high risk)
  * /

import { AEPServer } from "../src/server.js";
import { BUILTIN_CAPABILITIES } from "../src/providers/builtin.js";
import type { PolicyDocument } from "../src/core/types.js";

const policy: PolicyDocument = {
  version: "1.0",
  id: "demo-policy",
  default_decision: "allow",
  rules: [
    { id: "researcher-no-payment", principal: "agent.researcher", capability: "payment.*", effect: "deny", reason_code: "RESEARCH_AGENT_CANNOT_CHARGE" },
    { id: "deployer-needs-approval", principal: "agent.deployer", capability: "deploy.production", effect: "approval", max_risk_level: "high", require: ["human_approval"] },
  ],
};

async function main() {
  const server = new AEPServer({ policies: [policy] });
  for (const c of BUILTIN_CAPABILITIES) server.capability(c);

  // 1) researcher [ar] payment.charge → Must [ar] [ar]
  console.log("--- Test 1: researcher tries payment.charge ---");
  const r1 = await server.execute({
    aep: "0.1",
    id: "req_t1",
    type: "execute",
    principal: { type: "agent", id: "agent.researcher" },
    capability: { id: "payment.charge" },
    input: { amount: 100, currency: "USD" },
  });
  console.log("Result:", r1.status, "-", r1.error?.code, ":", r1.error?.message);

  // 2) user [ar] payment.charge [ar] [ar] → Must [ar] [ar] (with autoApprove = true [ar] [ar]server)
  console.log("\n--- Test 2: user tries small payment.charge ---");
  const server2 = new AEPServer({ policies: [policy], autoApprove: true });
  for (const c of BUILTIN_CAPABILITIES) server2.capability(c);
  const r2 = await server2.execute({
    aep: "0.1",
    id: "req_t2",
    type: "execute",
    principal: { type: "user", id: "alice" },
    capability: { id: "payment.charge" },
    input: { amount: 50, currency: "USD" },
  });
  console.log("Result:", r2.status);
  console.log("Output:", JSON.stringify(r2.output, null, 2));
}

main().catch(console.error);
