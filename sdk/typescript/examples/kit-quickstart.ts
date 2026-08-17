/**
 * Example: Connect any AI agent to AEP in 3 lines.
 *
 * Run: npx tsx examples/kit-quickstart.ts
 */

import { AEP } from "../src/kit.js";

async function main() {
  console.log("=== AEP Kit Quickstart ===\n");

  // ========================================
  // 1. Start AEP — one line, zero config
  // ========================================
  const aep = AEP.quickstart();

  // ========================================
  // 2. Register a custom tool — dead simple
  // ========================================
  aep.tool("greet", {
    description: "Greet someone by name",
    input: { name: "string" },
  }, async ({ name }) => {
    return { message: `Hello, ${name}!` };
  });

  aep.tool("calculate", {
    description: "Do a calculation",
    input: { operation: "string", a: "number", b: "number" },
    side_effect: false,
    risk: "low",
  }, async ({ operation, a, b }) => {
    const x = Number(a);
    const y = Number(b);
    let result: number;
    switch (operation) {
      case "add": result = x + y; break;
      case "sub": result = x - y; break;
      case "mul": result = x * y; break;
      case "div": result = x / y; break;
      default: throw new Error(`Unknown operation: ${operation}`);
    }
    return { result };
  });

  // ========================================
  // 3. Use it — your agent calls capabilities
  // ========================================
  console.log("Available tools:");
  const tools = await aep.tools();
  console.log("  " + tools.join(", ") + "\n");

  // Run a built-in capability
  console.log("--- math.add ---");
  const sum = await aep.run("math.add", { a: 7, b: 8 });
  console.log("Result:", sum);

  // Run a custom tool
  console.log("\n--- greet ---");
  const greeting = await aep.run("greet", { name: "World" });
  console.log("Result:", greeting);

  // Run another custom tool
  console.log("\n--- calculate ---");
  const calc = await aep.run("calculate", { operation: "mul", a: 6, b: 7 });
  console.log("Result:", calc);

  // Dry run (simulation — no side effects)
  console.log("\n--- dry run: github.issue.create ---");
  const preview = await aep.try("github.issue.create", {
    repository: "acme/project",
    title: "Found a bug",
  });
  console.log("Preview:", preview);

  console.log("\n=== That's it! ===");
  console.log("Your agent can now call any of these tools.");
  console.log("AEP handles: authentication, authorization, policy, risk,");
  console.log("approval, budget, idempotency, audit, receipts — all automatically.");
}

main().catch(console.error);
