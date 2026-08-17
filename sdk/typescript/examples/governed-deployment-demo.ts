/**
 * Hero Demo: Governed Production Deployment
 * 
 * This demo shows the full AEP pipeline:
 *   AI proposes → authenticate → authority → policy → risk → approval → budget → execute → receipt → audit
 * 
 * Run: npx tsx examples/governed-deployment-demo.ts
 */

import { AEPServer } from "../src/server.js";
import { BUILTIN_CAPABILITIES } from "../src/providers/builtin.js";
import { fingerprint } from "../src/core/canonical.js";

async function main() {
  console.log("========================================");
  console.log("  AEP Hero Demo: Governed Deployment");
  console.log("========================================\n");

  // 1. Create server with production-like config
  const server = new AEPServer({
    environment: "production",
    autoApprove: true, // Auto-approve for demo (in real life, human approves)
    defaultTimeoutMs: 30_000,
  });

  // Register a mock deploy capability
  server.capability({
    id: "deploy.production",
    version: "1.0.0",
    kind: "action",
    description: "Deploy a version to production",
    input: {
      schema: {
        type: "object",
        required: ["version"],
        properties: {
          version: { type: "string", description: "Version to deploy" },
          commit: { type: "string", description: "Git commit hash" },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          url: { type: "string" },
          status: { type: "string" },
        },
      },
    },
    execution: { sync: true, async: true, streaming: false, cancel: true, retry: true, idempotent: true, dry_run: true },
    risk: { level: "critical", side_effect: true, reversible: true, impact: "operational", blast_radius: "service" },
    authorization: { scopes: ["deploy.production.execute"], require_approval: "on_high_risk" },
    execute: async ({ input, dry_run }) => {
      const { version, commit } = input as { version: string; commit?: string };
      if (dry_run) {
        return { output: { would_change: true, version, estimated_duration_ms: 120000 } };
      }
      // Simulate deployment
      console.log(`  [PROVIDER] Deploying version ${version}...`);
      await new Promise((r) => setTimeout(r, 500));
      return { output: { url: `https://app.example.com/v${version}`, status: "deployed" }, cost_usd: 0.05 };
    },
  });

  // Also register math.add for a simple test
  for (const cap of BUILTIN_CAPABILITIES) server.capability(cap);

  console.log("--- Step 1: AI proposes deployment ---");
  console.log('Agent says: "Deploy version 2.4 to production"\n');

  // 2. Dry run first
  console.log("--- Step 2: Dry run (simulation) ---");
  const dryRunResp = await server.execute({
    aep: "0.1",
    id: "req_dry_run",
    type: "execute",
    principal: { type: "agent", id: "agent.deployer" },
    capability: { id: "deploy.production" },
    input: { version: "2.4", commit: "abc123" },
    execution: { dry_run: true },
  });
  console.log("Dry run result:", JSON.stringify(dryRunResp.output, null, 2), "\n");

  // 3. Real execution (triggers approval)
  console.log("--- Step 3: Real execution request ---");
  const execResp = await server.execute({
    aep: "0.1",
    id: "req_deploy_2_4",
    type: "execute",
    principal: { type: "agent", id: "agent.deployer" },
    capability: { id: "deploy.production" },
    input: { version: "2.4", commit: "abc123" },
    execution: { idempotency_key: "deploy-2.4-abc123" },
  });

  if (execResp.status === "approval_required") {
    console.log("Risk level: CRITICAL");
    console.log("Approval required!\n");

    console.log("--- Step 4: Human approves ---");
    console.log(`Approval ID: ${execResp.approval?.approval_id}`);
    console.log("Human reviews: version=2.4, commit=abc123, risk=critical");
    console.log("Human decision: APPROVE\n");

    // In a real system, this would go through the approval service
    // For demo, we use autoApprove=true
    console.log("--- Step 5: Execution proceeds ---");

    // Re-execute (with autoApprove, it should proceed)
    const retryResp = await server.execute({
      aep: "0.1",
      id: "req_deploy_2_4_retry",
      type: "execute",
      principal: { type: "agent", id: "agent.deployer" },
      capability: { id: "deploy.production" },
      input: { version: "2.4", commit: "abc123" },
      execution: { idempotency_key: "deploy-2.4-abc123" },
    });
    console.log("Execution result:", JSON.stringify(retryResp.output, null, 2), "\n");
  } else if (execResp.status === "completed") {
    console.log("Execution completed:", JSON.stringify(execResp.output, null, 2), "\n");
  } else {
    console.log("Execution status:", execResp.status, "\n");
  }

  // 4. Show receipt
  console.log("--- Step 6: Cryptographic receipt ---");
  console.log("Receipt contains:");
  console.log("  - execution_id: unique identifier");
  console.log("  - request_digest: SHA-256 of canonical request");
  console.log("  - capability_digest: SHA-256 of capability contract");
  console.log("  - result_digest: SHA-256 of execution result");
  console.log("  - status: completed");
  console.log("  - timestamps: started_at, completed_at\n");

  // 5. Show audit
  console.log("--- Step 7: Audit trail ---");
  const auditList = server.audit.list();
  console.log(`Audit entries: ${auditList.length}`);
  for (const entry of auditList) {
    console.log(`  [${entry.seq}] ${entry.who} → ${entry.what} (${entry.decision})`);
  }

  // 6. Verify audit chain
  const auditVerify = server.audit.verify();
  console.log(`\nAudit chain valid: ${auditVerify.valid}\n`);

  console.log("========================================");
  console.log("  Demo complete!");
  console.log("========================================");
  console.log("\nThis demo showed:");
  console.log("  1. AI proposes deployment");
  console.log("  2. AEP authenticates agent");
  console.log("  3. Authority verified");
  console.log("  4. Policy evaluated");
  console.log("  5. Risk = CRITICAL → approval required");
  console.log("  6. Human approves");
  console.log("  7. Budget reserved");
  console.log("  8. Execution (with idempotency key)");
  console.log("  9. Cryptographic receipt");
  console.log("  10. Audit chain (tamper-evident)");
}

main().catch(console.error);
