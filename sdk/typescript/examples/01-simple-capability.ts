/**
  * Example 1 — [ar] capability [ar] [ar]
  * Reference: spec/003-capabilities.md §Developer Experience
  * /

import { AEPServer } from "../src/server.js";

async function main() {
  const server = new AEPServer();

  // [ar] capability [ar]
  server.capability({
    id: "math.add",
    version: "1.0.0",
    kind: "action",
    description: "Add two numbers",
    input: {
      schema: {
        type: "object",
        required: ["a", "b"],
        properties: { a: { type: "number" }, b: { type: "number" } },
      },
    },
    output: {
      schema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "number" } },
      },
    },
    execution: { sync: true, async: true, streaming: false, cancel: false, retry: true, idempotent: true, dry_run: false },
    risk: { level: "low", side_effect: false, reversible: true },
    authorization: { scopes: [] },
    execute: async ({ input }) => {
      const { a, b } = input as { a: number; b: number };
      return { output: { result: a + b } };
    },
  });

  // [ar] [ar] (without HTTP)
  const response = await server.execute({
    aep: "0.1",
    id: "req_1",
    type: "execute",
    principal: { type: "user", id: "alice" },
    capability: { id: "math.add" },
    input: { a: 7, b: 8 },
  });

  console.log("Response:", JSON.stringify(response, null, 2));
}

main().catch(console.error);
