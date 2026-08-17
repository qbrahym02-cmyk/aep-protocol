/**
  * Example 5 — HTTP Server + Client
  * Reference: spec/002-envelope.md §HTTP Profile
  * 
  * [ar]:
  * npx tsx examples/05-http-server-client.ts
  * /

import { AEPServer } from "../src/server.js";
import { AEPClient } from "../src/gateway/client.js";
import { BUILTIN_CAPABILITIES } from "../src/providers/builtin.js";

async function main() {
  // 1) start server
  const server = new AEPServer({ environment: "production", autoApprove: true });
  for (const c of BUILTIN_CAPABILITIES) server.capability(c);

  await server.listen({ port: 18080 });

  // 2) create client
  const client = new AEPClient({ baseUrl: "http://localhost:18080" });

  // 3) discover capabilities (Level 1)
  console.log("--- Discovery (Level 1) ---");
  const caps = await client.discover({ level: 1, limit: 5 });
  console.log(JSON.stringify(caps, null, 2));

  // 4) execute math.add
  console.log("\n--- Execute math.add ---");
  const r = await client.execute("math.add", { a: 10, b: 5 });
  console.log(JSON.stringify(r, null, 2));

  // 5) dry-run github.issue.create
  console.log("\n--- Dry-run github.issue.create ---");
  const r2 = await client.execute("github.issue.create", {
    repository: "acme/project",
    title: "Found a bug",
  }, { dry_run: true });
  console.log(JSON.stringify(r2, null, 2));

  // 6) inspect capability (Level 4)
  console.log("\n--- Inspect math.add ---");
  const fetchResp = await fetch("http://localhost:18080/aep/capabilities/math.add");
  const inspect = await fetchResp.json();
  console.log(JSON.stringify(inspect, null, 2));

  // shutdown
  await server.close();
  console.log("\n✓ Server shut down");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
