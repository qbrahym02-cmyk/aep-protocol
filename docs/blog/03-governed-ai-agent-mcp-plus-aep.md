# Building a Governed AI Agent: MCP + AEP

## The Setup

You have:
- An LLM (GPT-4, Claude, etc.)
- MCP tools (GitHub, Slack, databases)
- A need to let the agent use these tools safely

The problem: the agent can do anything. There's no governance layer.

## The Solution: MCP + AEP

```
LLM → AEP → MCP tools (governed execution)
```

AEP wraps your MCP tools with:
- Authentication (who is the agent?)
- Authority (is the agent allowed to do this?)
- Policy (organizational rules)
- Risk assessment (how dangerous is this?)
- Approval (human-in-the-loop for critical ops)
- Budget (cost control)
- Audit (tamper-evident trail)

## Step-by-Step

### 1. Install AEP

```bash
cd sdk/typescript
npm install && npm run build
```

### 2. Register your MCP tools as AEP capabilities

```typescript
import { AEP } from "@aep/kit";

const aep = AEP.quickstart();

// Wrap an MCP tool with AEP governance
aep.tool("github_deploy", {
  description: "Deploy to GitHub Pages",
  input: { repo: "string", branch: "string" },
  side_effect: true,
  risk: "high",
}, async ({ repo, branch }) => {
  // Your actual MCP tool call here
  const result = await mcpClient.callTool("github_deploy", { repo, branch });
  return result;
});

aep.tool("slack_notify", {
  description: "Send a Slack notification",
  input: { channel: "string", message: "string" },
  side_effect: true,
  risk: "low",
}, async ({ channel, message }) => {
  return await mcpClient.callTool("slack_notify", { channel, message });
});

aep.tool("db_query", {
  description: "Query the database (read-only)",
  input: { sql: "string" },
  side_effect: false,
  risk: "low",
}, async ({ sql }) => {
  return await mcpClient.callTool("db_query", { sql });
});
```

### 3. Connect your LLM

```typescript
import OpenAI from "openai";

const openai = new OpenAI();
const tools = await aep.tools();

// Convert to OpenAI function format
const functions = tools.map(id => ({
  name: id,
  description: `AEP-governed: ${id}`,
}));

// Agent loop
const response = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "system", content: "You are a deployment assistant." },
    { role: "user", content: "Deploy the main branch to production and notify the team." },
  ],
  functions,
  function_call: "auto",
});

// When GPT calls a function → route through AEP
const functionCall = response.choices[0].message.function_call;

if (functionCall) {
  const result = await aep.run(functionCall.name, JSON.parse(functionCall.arguments));
  console.log("Result:", result);
}
```

### 4. What happens when the agent tries to deploy

```
Agent: "I'll deploy the main branch to production"
  ↓
GPT calls: github_deploy({ repo: "myorg/myapp", branch: "main" })
  ↓
AEP receives the call
  ↓
AEP: Authenticating agent... ✓
AEP: Checking authority... ✓
AEP: Policy check... ✓
AEP: Risk assessment... HIGH (side_effect=true, production)
AEP: ⛔ APPROVAL REQUIRED
  ↓
AEP returns: "Approval required for high-risk operation"
  ↓
Agent: "I need human approval to deploy."
  ↓
Human reviews and approves
  ↓
AEP: Executing deploy...
AEP: ✓ Done. Receipt: sha256:...
AEP: Now I'll notify the team via Slack (low risk, auto-approved)
  ↓
AEP: Executing slack_notify...
AEP: ✓ Done. Receipt: sha256:...
```

### 5. Everything is audited

```typescript
// Every execution produces a receipt
const receipt = aep.getLastReceipt();
console.log(receipt);
// {
//   execution_id: "exec_01M...",
//   request_digest: "sha256:...",
//   capability_digest: "sha256:...",
//   authority_id: "auth_...",
//   risk_level: "high",
//   result_digest: "sha256:...",
//   status: "completed"
// }

// The audit chain is tamper-evident
const audit = aep.getAuditChain();
const verification = audit.verify();
console.log(verification);
// { valid: true }
```

## Why This Matters

Without AEP, your agent can:
- Deploy to production without approval
- Delete database records without authority checks
- Send emails without audit trails
- Call expensive APIs without budget limits

With AEP:
- Every action is authenticated and authorized
- High-risk operations require human approval
- Every action produces a verifiable receipt
- The audit trail is tamper-evident
- Budget is enforced before execution (not after)

## Conclusion

MCP gives your agent tools. AEP gives your agent **governed** tools.

You need both. MCP for connectivity, AEP for governance.

---

*Star the project: [github.com/qbrahym02-cmyk/aep-protocol](https://github.com/qbrahym02-cmyk/aep-protocol)*
