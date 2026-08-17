/**
  * Example 2 — Workflow [ar] [ar] with parallel [ar] compensation
  * Reference: spec/004-execution.md §Workflow
  * 
  * [ar]: build → (security + tests) → deploy
  * /

import { WorkflowEngine, type WorkflowSpec } from "../src/workflow/engine.js";

async function main() {
  const engine = new WorkflowEngine();

  const spec: WorkflowSpec = {
    id: "release-workflow",
    version: "1.0.0",
    budget: { max_calls: 10, max_duration_ms: 30_000 },
    nodes: [
      { id: "build", capability: "app.build", input: { commit: "abc123" } },
      { id: "security", capability: "security.scan", input: (ctx) => ({ artifact: ctx.results.get("build")?.output }), depends_on: ["build"] },
      { id: "tests", capability: "test.run", input: (ctx) => ({ artifact: ctx.results.get("build")?.output }), depends_on: ["build"] },
      {
        id: "deploy",
        capability: "deploy.staging",
        input: (ctx) => ({
          security_report: ctx.results.get("security")?.output,
          test_report: ctx.results.get("tests")?.output,
        }),
        depends_on: ["security", "tests"],
        on_failure: "compensate",
        compensation: "deploy.rollback",
      },
    ],
  };

  // mock runner
  const runner = async (cap: string, input: unknown) => {
    console.log(`  → running ${cap} with`, JSON.stringify(input));
    return { output: { ok: true, capability: cap } };
  };

  console.log("Running release workflow...\n");
  const result = await engine.run(spec, runner);

  console.log("\nFinal result:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
