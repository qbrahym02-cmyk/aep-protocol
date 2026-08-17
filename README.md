# AEP — Agent Execution Protocol

> **Models propose. Policies authorize. AEP executes.**

**AEP is an open protocol for governed agent capabilities, authorization, durable execution, recovery, provenance, and verifiable execution.**

---

## The 60-Second Pitch

```
MCP answers:   "What tools can my Agent call?"
AEP answers:   "Who is allowed to call this capability, on which resource,
                under what policy, with what risk, for how long,
                and what exactly happened?"
```

AEP is **not** MCP with more fields. It's a different layer:

| Layer | Question | Examples |
|---|---|---|
| **Connectivity** (MCP) | "What can I call?" | Tool discovery, invocation |
| **Governance** (AEP) | "Should I call it? Am I authorized? What will happen?" | Authority, policy, risk, approval, budget, audit, recovery |

---

## Why AEP Exists

Building production agent systems requires:

1. **Who** is the agent? (Verified identity, not self-claimed)
2. **What** is it allowed to do? (Authority with scoped capabilities + resources)
3. **Is it safe** to do? (Policy + risk evaluation)
4. **Does it need approval?** (Human-in-the-loop for high-risk operations)
5. **Can we afford it?** (Budget reservation before execution)
6. **What if it fails?** (Retry, compensation, crash recovery)
7. **Can we prove it happened?** (Receipts, audit chain, provenance)

MCP + OAuth + OPA can address some of these — but you must build, configure, and synchronize three separate systems. AEP provides all of this in **one unified runtime** with no enforcement gaps.

---

## Key Features

- **Authority Primitive** — `Agent → Authority → Capability → Resource` with 9-rule enforcement
- **Delegation** — `child_authority ⊆ parent_authority` (cryptographically enforced)
- **Secure Execution Engine** — One pipeline: authenticate → authorize → policy → risk → approval → idempotency → budget → execute → receipt → audit
- **Durable Execution** — Crash recovery, state reconstruction, saga compensation
- **Cryptographic Receipts** — Tamper-evident, verifiable proof of execution
- **Provider Mesh** — Swap providers based on policy, cost, latency, health, region
- **MCP Adapter** — Wrap existing MCP tools with AEP governance
- **Multi-tenancy** — Tenant-bound resources, scoped idempotency, object-level authorization
- **Three Implementations** — TypeScript (131 tests), Python (67 tests), Rust (65 tests)
- **Cross-language Conformance** — All three pass identical test vectors

---

## Quick Start

```bash
cd sdk/typescript
npm install && npm run build

# Run conformance
npx tsx src/cli.ts conformance

# Start server
npx tsx src/cli.ts serve --port 8080

# Execute a capability
npx tsx src/cli.ts execute math.add '{"a":2,"b":3}'
```

## Define a Capability

```typescript
import { AEPServer } from "@aep/sdk";

const server = new AEPServer({ environment: "production" });

server.capability({
  id: "deploy.staging",
  version: "1.0.0",
  kind: "action",
  description: "Deploy to staging environment",
  input: { schema: { type: "object", required: ["version"], properties: { version: { type: "string" } } } },
  output: { schema: { type: "object", properties: { url: { type: "string" } } } },
  execution: { sync: true, async: true, streaming: false, cancel: true, retry: true, idempotent: true, dry_run: true },
  risk: { level: "high", side_effect: true, reversible: true },
  authorization: { scopes: ["deploy.staging.execute"], require_approval: "on_high_risk" },
  execute: async ({ input, dry_run }) => {
    if (dry_run) return { output: { would_change: true } };
    return { output: { url: `https://staging.app/v${(input as any).version}` } };
  },
});

await server.listen({ port: 8080 });
```

## MCP Integration

```typescript
import { createMCPServerAdapter, wrapMCPToolAsCapability } from "@aep/sdk";

// Wrap existing MCP tool with AEP governance
wrapMCPToolAsCapability(server.registry, {
  name: "github.create_issue",
  description: "Create a GitHub issue",
  inputSchema: { type: "object", properties: { title: { type: "string" } } },
  handler: async (args) => createIssue(args.title),
}, { risk_level: "medium", side_effect: true });

// Now this tool has: authority, policy, risk, approval, idempotency, budget, audit, receipts
```

---

## Architecture

```
Agent / Application
       ↓
  Transport Adapter (HTTP / WebSocket / stdio)
       ↓
  Authentication → VerifiedPrincipal
       ↓
  Capability Resolution
       ↓
  Authority + Resource Verification (9 rules)
       ↓
  Policy (fail-closed in production)
       ↓
  Risk Assessment
       ↓
  Approval Gate (if needed)
       ↓
  Atomic Idempotency Reserve
       ↓
  Atomic Budget Reserve
       ↓
  Durable Execution
       ↓
  Provider Selection + Execute (with AbortSignal)
       ↓
  Output Validation
       ↓
  Budget Settlement
       ↓
  Cryptographic Receipt
       ↓
  Audit / Provenance
```

---

## Conformance

| Implementation | Tests | Status |
|---|---|---|
| TypeScript | 131/131 | ✅ Pass |
| Python | 67/67 | ✅ Pass |
| Rust | 65/65 | ✅ Pass |
| Cross-language interop | 0 mismatches | ✅ Pass |

---

## Documentation

- [AEP vs MCP+OAuth+OPA Benchmark](docs/BENCHMARK_MCP_VS_AEP.md)
- [Protocol Freeze 1.0](PROTOCOL_FREEZE.md)
- [Completion Report](AEP_1_0_COMPLETION_REPORT.md)
- [SDK Documentation](docs/SDK.md)
- [Governance](GOVERNANCE.md)
- [Security Policy](SECURITY.md)
- [Conformance Certification](conformance/certification/README.md)

---

## License

MIT
