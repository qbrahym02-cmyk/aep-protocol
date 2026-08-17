<div align="center">

# AEP — Agent Execution Protocol

### The authorization and execution control plane for AI agents.

![TypeScript](https://img.shields.io/badge/TypeScript-144%20tests%20%E2%9C%93-brightgreen)
![Python](https://img.shields.io/badge/Python-67%20tests%20%E2%9C%93-blue)
![Rust](https://img.shields.io/badge/Rust-65%20tests%20%E2%9C%93-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Protocol: 1.0](https://img.shields.io/badge/protocol-1.0%20frozen-orange)

**Stop giving your AI agents unrestricted access to your tools.**

</div>

---

## The Problem

Every AI agent framework gives the agent a tool and says "go ahead, call it."

But nobody asks:
- **Who** is the agent? (Identity)
- **Is it allowed** to do this? (Authority)
- **Is it safe** to do? (Risk assessment)
- **Should a human approve** this? (Approval gate)
- **Can we afford** this operation? (Budget enforcement)
- **What if it fails?** (Retry, compensation, recovery)
- **Can we trace** what happened? (Audit trail, receipts)

## The Solution

```
MCP answers:   "What tools can my Agent call?"
AEP answers:   "Who is allowed to call this, on which resource,
                under what policy, with what risk, and what happened?"
```

AEP sits between your AI agent and your tools:

```
AI Agent → AEP → [Auth + Authority + Policy + Risk + Approval + Budget + Execute + Audit] → Tool
```

## Demo

```
$ aep execute deploy.production '{"version":"2.0"}'

  Agent requests: deploy.production v2.0
  ↓
  AEP: Authenticating agent... ✓
  AEP: Checking authority... ✓ (agent.deployer has deploy.* scope)
  AEP: Evaluating policy... ✓ (allowed in production)
  AEP: Assessing risk... ⚠ CRITICAL (irreversible, production)
  AEP: Budget check... ✓ ($0.05 reserved)
  AEP: ⛔ APPROVAL REQUIRED — Risk is CRITICAL
  AEP: Waiting for human approval...

  Human reviews: deploy v2.0 to production
  Human decision: ✅ APPROVED

  AEP: Executing deploy.production...
  AEP: ✓ Deployed: https://app.com/v2.0
  AEP: Receipt: sha256:a91f3c... (tamper-evident)
  AEP: Audit: recorded in hash chain
```

## Quick Start (3 lines)

```typescript
import { AEP } from "@aep/kit";

const aep = AEP.quickstart();                              // Start — zero config
const result = await aep.run("math.add", { a: 2, b: 3 }); // Execute — fully governed
console.log(result);                                       // { result: 5 }
```

### Register your own tool

```typescript
aep.tool("send_email", {
  description: "Send an email",
  input: { to: "string", subject: "string", body: "string" },
  side_effect: true,
  risk: "medium",
}, async ({ to, subject, body }) => {
  return { sent: true };
});

await aep.run("send_email", { to: "alice@x.com", subject: "Hi", body: "Hello" });
```

### High-risk operations require human approval

```typescript
aep.tool("deploy_production", {
  description: "Deploy to production",
  input: { version: "string" },
  side_effect: true,
  risk: "critical",
}, async ({ version }) => ({ deployed: true, version }));

// AEP blocks this until a human approves
try {
  await aep.run("deploy_production", { version: "2.0" });
} catch (err) {
  // AEPApprovalRequiredError — agent cannot deploy without human approval
}
```

## Docker (one command)

```bash
docker compose up
# AEP running at http://127.0.0.1:8080
```

## CLI

```bash
aep serve --port 8080          # Start server
aep discover                   # List capabilities
aep execute math.add '{"a":2,"b":3}'  # Execute
aep execute deploy '{"v":"2"}' --dry-run  # Simulate
```

## What AEP Does Automatically

| Step | What happens | Why it matters |
|---|---|---|
| 1. Authenticate | Verifies agent identity | No anonymous agents |
| 2. Resolve Authority | Checks if agent has authority | No unauthorized access |
| 3. Verify Resource | Checks resource scope | No cross-environment leaks |
| 4. Evaluate Policy | Runs policy rules | Organization rules enforced |
| 5. Assess Risk | Calculates risk from context | Risk-aware execution |
| 6. Require Approval | Blocks critical operations | Human-in-the-loop |
| 7. Reserve Budget | Atomic budget reservation | No cost overruns |
| 8. Idempotency | Prevents duplicate side effects | Safe retries |
| 9. Execute | Runs with timeout + cancellation | Bounded execution |
| 10. Validate Output | Schema validation on results | No malformed data |
| 11. Generate Receipt | Tamper-evident receipt of execution | Verifiable evidence |
| 12. Audit Trail | Hash chain (tamper-evident) | Traceable history |

**Your agent doesn't need to know about any of this. It just calls `aep.run()`.**

## Connect Any LLM

### OpenAI / GPT

```typescript
const aep = AEP.quickstart();

aep.tool("search", { description: "Search", input: { query: "string" } },
  async ({ query }) => ({ results: await searchAPI(query) }));

aep.tool("deploy", {
  description: "Deploy", input: { version: "string" },
  side_effect: true, risk: "critical",
}, async ({ version }) => await deploy(version));

// Route GPT function calls through AEP
const result = await aep.run(functionCall.name, functionCall.arguments);
```

### LangChain / Any Framework

```typescript
import { aepToLangChain } from "@aep/kit";
const tool = aepToLangChain(aep, "search");
```

### Production

```typescript
const aep = AEP.production({
  server: "https://aep.yourcompany.com",
  token: process.env.AEP_TOKEN,
});
await aep.run("any.capability", { ... });
```

## MCP Integration

AEP doesn't compete with MCP — it wraps it:

```
MCP tools → AEP governance layer → Safe execution
```

```typescript
import { wrapMCPToolAsCapability } from "@aep/sdk";

wrapMCPToolAsCapability(registry, {
  name: "github.create_issue",
  description: "Create a GitHub issue",
  inputSchema: { type: "object", properties: { title: { type: "string" } } },
  handler: async (args) => createIssue(args),
}, { risk_level: "medium", side_effect: true });

// Now this MCP tool has: authority, policy, risk, approval, audit
```

## Architecture

```
                         ┌─────────────┐
                         │  AI Agent   │
                         └──────┬──────┘
                                │ aep.run()
                                ▼
                    ┌───────────────────────┐
                    │     AEP Runtime       │
                    │                       │
                    │  Auth → Authority →    │
                    │  Policy → Risk →      │
                    │  Approval → Budget →  │
                    │  Execute → Receipt →  │
                    │  Audit                │
                    │                       │
                    └──────────┬────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
          GitHub          Database          Kubernetes
          Slack           Stripe            AWS
          Jira            PostgreSQL        Custom APIs
```

## Security

- **Zero Trust** — Every request re-authenticated
- **Fail-closed** — Missing dependency = startup failure in production
- **Object-level AuthZ** — Can't read/cancel other principals' executions
- **SSRF Protection** — Domain allowlist, private IP blocking
- **Provider Sandboxing** — Network + filesystem isolation per provider
- **Secret Redaction** — Passwords/tokens stripped from all logs/audit
- **mTLS Support** — Service-to-service authentication
- **Rate Limiting** — Always enabled (configurable)
- **CORS Allowlist** — No wildcard in production
- **Body Limits** — 1 MiB default, streaming-aware

**Threat model covers 17 attack vectors. See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).**

## Performance

Benchmark on Node 22, local machine, 1000 iterations:

```
| Benchmark         | p50 (ms) | p95 (ms) |
|-------------------|----------|----------|
| Direct call       | 0.02     | 0.05     |
| AEP full pipeline | 1.2      | 3.5      |
```

Reproduce: `npx tsx src/conformance/benchmark.ts`

AEP adds ~1ms per execution. For governed agent operations, this is negligible.

## Comparison

| Feature | MCP | MCP+OAuth+OPA | AEP |
|---|---|---|---|
| Tool discovery | ✅ | ✅ | ✅ |
| Authorization | ❌ | Partial | ✅ (9 rules) |
| Delegation | ❌ | Partial | ✅ (subset enforced) |
| Approval workflow | ❌ | ❌ | ✅ |
| Audit trail | ❌ | Partial | ✅ (hash chain) |
| Idempotency | ❌ | ❌ | ✅ (atomic) |
| Recovery | ❌ | ❌ | ✅ |
| Receipts | ❌ | ❌ | ✅ (tamper-evident) |
| Components needed | 1 | 3 | 1 |

## Test Results

| SDK | Tests | Status |
|---|---|---|
| TypeScript | 144 | ✅ |
| Python | 67 | ✅ |
| Rust | 65 | ✅ |
| Cross-language | 0 mismatches | ✅ |

## Documentation

- [Quick Start](QUICKSTART.md) | [العربية](QUICKSTART_AR.md)
- [AEP vs MCP+OAuth+OPA](docs/BENCHMARK_MCP_VS_AEP.md)
- [Threat Model](docs/THREAT_MODEL.md)
- [Protocol Freeze](PROTOCOL_FREEZE.md)
- [Governance](GOVERNANCE.md)

## Roadmap

- ✅ Core protocol (frozen 1.0)
- ✅ 3 SDKs (TypeScript, Python, Rust)
- ✅ MCP adapter
- ✅ AEP Kit (3-line agent integration)
- ✅ Security audit (17 attack vectors tested)
- ✅ Provider SDK (GitHub, Stripe, Slack, Postgres)
- 🔄 PostgreSQL adapter (code complete, needs prod testing)
- 🔄 Kubernetes Helm chart
- 🔄 Web UI dashboard
- 🔄 Blog posts & tutorials

## Community

- [Report bugs](https://github.com/qbrahym02-cmyk/aep-protocol/issues)
- [Discussions](https://github.com/qbrahym02-cmyk/aep-protocol/discussions)
- [Contributing](CONTRIBUTING.md)

## License

MIT

---

<div align="center">

**AEP — Governed execution for AI agents.**

*Authenticate. Authorize. Assess risk. Approve. Execute. Audit.*

</div>
