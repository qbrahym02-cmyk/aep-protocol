/**
 * Example: Connect an OpenAI agent to AEP.
 *
 * This shows how an LLM agent can use AEP-governed capabilities
 * as if they were regular function calls.
 *
 * Run: npx tsx examples/agent-openai.ts
 */

import { AEP } from "../src/kit.js";

async function main() {
  console.log("=== AEP + AI Agent Demo ===\n");

  // 1. Setup AEP
  const aep = AEP.quickstart();

  // Register tools your agent can use
  aep.tool("search_web", {
    description: "Search the web for information",
    input: { query: "string" },
    side_effect: false,
  }, async ({ query }) => {
    // Mock: in real life, call a search API
    return { results: [`Result for: ${query}`], count: 1 };
  });

  aep.tool("send_email", {
    description: "Send an email to someone",
    input: { to: "string", subject: "string", body: "string" },
    side_effect: true,
    risk: "medium",
  }, async ({ to, subject, body }) => {
    // Mock: in real life, call an email API
    console.log(`  [EMAIL SENT] To: ${to}, Subject: ${subject}`);
    return { sent: true, to };
  });

  aep.tool("deploy_code", {
    description: "Deploy code to production",
    input: { version: "string", commit: "string" },
    side_effect: true,
    risk: "critical",
  }, async ({ version }) => {
    console.log(`  [DEPLOYED] Version ${version}`);
    return { deployed: true, version, url: `https://app.com/v${version}` };
  });

  // 2. Simulate an AI agent that decides what to call
  console.log("Agent: I want to search for 'best practices for API design'\n");
  const searchResult = await aep.run("search_web", { query: "best practices for API design" });
  console.log("Search result:", searchResult);

  console.log("\nAgent: I found good results. Let me email them to the team.\n");
  const emailResult = await aep.run("send_email", {
    to: "team@company.com",
    subject: "API Design Best Practices",
    body: "Found great resources!",
  });
  console.log("Email result:", emailResult);

  console.log("\nAgent: The team approved. Let me deploy version 2.0.\n");

  // 3. High-risk operation — AEP will require approval!
  console.log("(AEP detects: deploy_code is CRITICAL risk)");
  console.log("(AEP checks: does this need approval? YES — risk=critical)\n");

  try {
    const deployResult = await aep.run("deploy_code", { version: "2.0", commit: "abc123" });
    console.log("Deploy result:", deployResult);
  } catch (err) {
    if (err instanceof Error && err.name === "AEPApprovalRequiredError") {
      console.log("AEP: This operation requires human approval!");
      console.log(`  Reason: ${err.message}`);
      console.log("  Approval ID:", (err as any).approvalId);
      console.log("\n  A human would review this and approve/deny.");
      console.log("  The agent CANNOT deploy without approval — this is AEP's core value.");
    } else {
      console.log("Error:", err);
    }
  }

  console.log("\n=== Summary ===");
  console.log("1. Agent proposed actions (search, email, deploy)");
  console.log("2. AEP governed each action (auth, policy, risk)");
  console.log("3. Low-risk actions executed automatically");
  console.log("4. High-risk action (deploy) BLOCKED until human approval");
  console.log("5. Everything is audited with cryptographic receipts");
}

main().catch(console.error);
