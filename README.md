<div align="center">

# AEP — Agent Execution Protocol

### The authorization and execution control plane for AI agents.

[![Tests](https://img.shields.io/badge/tests-144%2F144-brightgreen)](https://github.com/qbrahym02-cmyk/aep-protocol)
[![Languages](https://img.shields.io/badge/SDK-TypeScript%20%7C%20Python%20%7C%20Rust-blue)](https://github.com/qbrahym02-cmyk/aep-protocol)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Protocol: 1.0](https://img.shields.io/badge/protocol-1.0%20frozen-orange)](PROTOCOL_FREEZE.md)

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
- **Can we prove** what happened? (Cryptographic receipts, audit trail)

## The Solution

```
MCP answers:   "What tools can my Agent call?"
AEP answers:   "Who is allowed to call this capability, on which resource,
                under what policy, with what risk, for how long,
                and what exactly happened?"
```

AEP sits between your AI agent and your tools:

```
AI Agent → AEP → [Auth + Authority + Policy + Risk + Approval + Budget + Execute + Receipt + Audit] → Tool
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
  // Your logic here
  return { sent: true };
});

// Your agent can now call it — AEP handles all governance automatically
await aep.run("send_email", { to: "alice@x.com", subject: "Hi", body: "Hello" });
```

### High-risk operations require human approval

```typescript
aep.tool("deploy_production", {
  description: "Deploy to production",
  input: { version: "string" },
  side_effect: true,
  risk: "critical",  // ← AEP will require human approval!
}, async ({ version }) => {
  return { deployed: true, version };
});

// Agent tries to deploy → AEP blocks it until a human approves
try {
  await aep.run("deploy_production", { version: "2.0" });
} catch (err) {
  console.log("AEP: Human approval required for production deployment!");
}
```

## Docker (one command)

```bash
docker compose up
# AEP running at http://127.0.0.1:8080
```

## CLI

```bash
# Start server
npx aep serve --port 8080

# Discover capabilities
npx aep discover

# Execute a capability
npx aep execute math.add '{"a":2,"b":3}'

# Dry run (simulation)
npx aep execute deploy.production '{"version":"2.0"}' --dry-run
```

## What AEP Does Automatically

When your agent calls `aep.run()`, AEP executes this pipeline **every time**:

| Step | What happens | Why it matters |
|---|---|---|
| 1. **Authenticate** | Verifies agent identity via token/mTLS/OIDC | No anonymous agents |
| 2. **Resolve Authority** | Checks if agent has authority for this capability | No unauthorized access |
| 3. **Verify Resource** | Checks resource scope (e.g., staging vs production) | No cross-environment leaks |
| 4. **Evaluate Policy** | Runs policy rules (allow/deny/constrain) | Organization rules enforced |
| 5. **Assess Risk** | Calculates risk based on context | Risk-aware execution |
| 6. **Require Approval** | Blocks critical operations until human approves | Human-in-the-loop |
| 7. **Reserve Budget** | Atomic budget reservation before execution | No cost overruns |
| 8. **Idempotency Check** | Prevents duplicate side effects | Safe retries |
| 9. **Execute** | Runs with timeout + cancellation support | Bounded execution |
| 10. **Validate Output** | Schema validation on results | No malformed data |
| 11. **Generate Receipt** | Cryptographic proof of execution | Verifiable evidence |
| 12. **Audit Trail** | Tamper-evident hash chain | Immutable history |

**Your agent doesn't need to know about any of this. It just calls `aep.run()`.**

## Connect Any LLM

### OpenAI / GPT

```typescript
const aep = AEP.quickstart();

// Register tools
aep.tool("search", { description: "Search the web", input: { query: "string" } },
  async ({ query }) => ({ results: await searchAPI(query) }));

aep.tool("deploy", {
  description: "Deploy to production",
  input: { version: "string" },
  side_effect: true,
  risk: "critical",
}, async ({ version }) => await deploy(version));

// Convert to OpenAI function-calling format
const functions = aep.tools().map(id => ({
  name: id,
  description: `AEP-governed: ${id}`,
}));

// Use with OpenAI
const response = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [...],
  functions,
});

// When GPT calls a function → route through AEP
const result = await aep.run(functionCall.name, functionCall.arguments);
```

### LangChain

```typescript
import { aepToLangChain } from "@aep/kit";

const aep = AEP.quickstart();
const tool = aepToLangChain(aep, "search");
// Use with LangChain agent
```

### Any framework

```typescript
const aep = AEP.production({
  server: "https://aep.yourcompany.com",
  token: process.env.AEP_TOKEN,
});

// Just call aep.run() from anywhere
const result = await aep.run("any.capability", { ... });
```

## MCP Integration

AEP doesn't compete with MCP — it wraps it:

```
MCP tools → AEP governance → Safe execution
```

```typescript
import { wrapMCPToolAsCapability } from "@aep/sdk";

// Wrap any MCP tool with AEP governance
wrapMCPToolAsCapability(aep.registry, {
  name: "github.create_issue",
  description: "Create a GitHub issue",
  inputSchema: { type: "object", properties: { title: { type: "string" } } },
  handler: async (args) => createIssue(args),
}, { risk_level: "medium", side_effect: true });

// Now this MCP tool has: authority, policy, risk, approval, audit, receipts
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
                    │  ┌─────────────────┐ │
                    │  │  Authentication  │ │
                    │  ├─────────────────┤ │
                    │  │  Authority      │ │
                    │  ├─────────────────┤ │
                    │  │  Policy Engine  │ │
                    │  ├─────────────────┤ │
                    │  │  Risk Engine    │ │
                    │  ├─────────────────┤ │
                    │  │  Approval Gate   │ │
                    │  ├─────────────────┤ │
                    │  │  Budget Manager  │ │
                    │  ├─────────────────┤ │
                    │  │  Execution      │ │
                    │  ├─────────────────┤ │
                    │  │  Receipt Builder │ │
                    │  ├─────────────────┤ │
                    │  │  Audit Chain    │ │
                    │  └─────────────────┘ │
                    └──────────┬────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
          GitHub          Database          Kubernetes
          Slack           Stripe            AWS
          Jira            PostgreSQL        Custom APIs
```

## Key Features

- **Authority Primitive** — `Agent → Authority → Capability → Resource` with 9-rule enforcement
- **Delegation** — `child_authority ⊆ parent_authority` (cryptographically enforced)
- **Cryptographic Receipts** — Tamper-evident, verifiable proof of every execution
- **Durable Execution** — Crash recovery, state reconstruction, saga compensation
- **Provider Mesh** — Swap providers based on policy, cost, latency, health
- **MCP Adapter** — Wrap existing MCP tools with AEP governance
- **Multi-tenancy** — Tenant-bound resources, scoped idempotency
- **3 SDKs** — TypeScript (144 tests), Python (67 tests), Rust (65 tests)
- **Cross-language Conformance** — All three pass identical test vectors

## Security

- **Zero Trust** — Every request is re-authenticated
- **Fail-closed** — Missing dependency = startup failure in production
- **Object-level AuthZ** — Can't read/cancel other principals' executions
- **SSRF Protection** — Domain allowlist, private IP blocking, DNS rebinding prevention
- **Provider Sandboxing** — Network + filesystem isolation per provider
- **Secret Redaction** — Passwords, tokens, keys stripped from all logs/audit/events
- **mTLS Support** — Production-grade service-to-service authentication
- **Rate Limiting** — Always enabled (100 req/10s default, configurable)
- **CORS Allowlist** — No wildcard in production
- **Body Limits** — 1 MiB default, streaming-aware

## Benchmarks

```
| Benchmark         | p50 (ms) | p95 (ms) | Ops/sec |
|-------------------|----------|----------|---------|
| Direct call       | 0.02     | 0.05     | 50,000  |
| AEP full pipeline | 1.2      | 3.5      | 833     |
```

AEP adds ~1ms overhead per execution. For governed agent operations, this is negligible.

## Documentation

- [Quick Start (English)](QUICKSTART.md)
- [Quick Start (العربية)](QUICKSTART_AR.md)
- [AEP vs MCP+OAuth+OPA Benchmark](docs/BENCHMARK_MCP_VS_AEP.md)
- [Threat Model](docs/THREAT_MODEL.md)
- [Protocol Freeze 1.0](PROTOCOL_FREEZE.md)
- [Governance](GOVERNANCE.md)
- [Security Policy](SECURITY.md)
- [SDK Documentation](docs/SDK.md)

## Comparison

| Feature | MCP | MCP+OAuth+OPA | AEP |
|---|---|---|---|
| Tool discovery | ✅ | ✅ | ✅ |
| Tool execution | ✅ | ✅ | ✅ |
| Authorization | ❌ | Partial | ✅ (9 rules) |
| Delegation | ❌ | Partial | ✅ (subset enforced) |
| Approval workflow | ❌ | ❌ | ✅ (full lifecycle) |
| Audit trail | ❌ | Partial | ✅ (hash chain) |
| Idempotency | ❌ | ❌ | ✅ (atomic) |
| Recovery | ❌ | ❌ | ✅ (crash recovery) |
| Risk controls | ❌ | Partial | ✅ (dynamic) |
| Receipts | ❌ | ❌ | ✅ (cryptographic) |
| Provider mesh | ❌ | ❌ | ✅ (failover) |
| Components needed | 1 | 3 | 1 |

## Who Uses AEP?

AEP is designed for teams building **production AI agents** that interact with:
- Production infrastructure (deploy, scale, configure)
- Financial systems (payments, transfers, billing)
- Sensitive data (databases, file systems, APIs)
- Multi-tenant environments
- Regulated industries (audit, compliance, provenance)

## Roadmap

- ✅ Core protocol (frozen 1.0)
- ✅ TypeScript SDK (144 tests)
- ✅ Python SDK (67 tests)
- ✅ Rust SDK (65 tests)
- ✅ MCP adapter
- ✅ Docker + CLI
- ✅ AEP Kit (simple agent interface)
- ✅ Security audit suite (13 attack vectors)
- ✅ Adversarial tests (13 tests)
- ✅ Provider SDK (GitHub, Stripe, Slack, Postgres)
- 🔄 PostgreSQL adapter (code complete, needs production testing)
- 🔄 Kubernetes Helm chart
- 🔄 Web UI dashboard
- 🔄 Conformance certification program

## Community

- **Issues**: [Report bugs or request features](https://github.com/qbrahym02-cmyk/aep-protocol/issues)
- **Discussions**: [Ask questions or share ideas](https://github.com/qbrahym02-cmyk/aep-protocol/discussions)
- **Contributing**: Read [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

**AEP — The Capability Execution Standard for Agents.**

*Discover capabilities. Prove authority. Plan execution. Control risk. Execute safely. Recover automatically. Trace everything.*

</div>
