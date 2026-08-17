# Why MCP Is Not an Authorization Layer

## The Tool-Calling Problem

MCP (Model Context Protocol) solved a real problem: giving AI agents a standard way to discover and call tools. Before MCP, every agent framework had its own tool format, its own discovery mechanism, its own way of passing arguments.

MCP standardized this. And it works well for what it was designed for: **connectivity**.

But here's the thing: connectivity is not governance.

## What MCP Does Well

- **Tool discovery**: Agents can find what tools are available
- **Tool execution**: Agents can call tools with structured arguments
- **Standard format**: JSON-RPC based, language-agnostic

This is valuable. MCP deserves credit for it.

## What MCP Does Not Do

When an agent calls a tool via MCP, nobody asks:

1. **Who is the agent?** MCP doesn't verify identity. The agent self-claims who it is.
2. **Is it authorized?** MCP has no concept of authority, scope, or permission.
3. **What resource is it acting on?** MCP doesn't model resources or resource-scoped access.
4. **Is this operation safe?** MCP doesn't assess risk or require approval.
5. **Can we afford this?** MCP has no budget concept.
6. **What if it fails?** MCP doesn't handle retry, compensation, or recovery.
7. **What happened?** MCP doesn't produce receipts or maintain an audit trail.

## The "Just Add OAuth" Fallacy

A common response is: "Just put OAuth in front of MCP."

OAuth gives you a token. The token has scopes. MCP checks the scope and executes.

But:
- OAuth scopes are **coarse-grained** ("can write to GitHub") — not per-resource, per-action
- OAuth doesn't model **delegation** (agent A delegates to agent B with reduced scope)
- OAuth doesn't assess **risk** or require **approval** for high-risk operations
- OAuth doesn't produce **receipts** or maintain **tamper-evident audit chains**
- OAuth + MCP means **two separate systems** that must be synchronized

## The "Add OPA Too" Fallacy

OK, so add OPA (Open Policy Agent) for fine-grained policy:

```
Agent → OAuth → MCP → OPA → Tool
```

Now you have:
- Three systems to configure
- Three failure modes to handle
- Three audit logs to correlate
- Zero guarantee that OPA's decision is actually enforced by MCP
- No receipts linking the policy decision to the execution result

The enforcement gap is the key problem: **OPA evaluates policy, but MCP executes the tool. There is no atomic binding between the policy decision and the execution.**

## What AEP Does Differently

AEP is not "MCP with more fields." It's a different layer entirely:

```
Agent → AEP → [Auth + Authority + Policy + Risk + Approval + Budget + Execute + Receipt + Audit] → Tool
```

Everything happens in **one pipeline, in one system, with one audit trail**:

1. **Authenticate**: The agent's identity is verified (not self-claimed)
2. **Resolve Authority**: Check if the agent has authority for this capability on this resource
3. **Evaluate Policy**: Run organization rules (allow/deny/constrain)
4. **Assess Risk**: Calculate risk from context (environment, input, principal)
5. **Require Approval**: Block critical operations until a human approves
6. **Reserve Budget**: Atomically reserve cost budget before execution
7. **Execute**: Run with timeout, cancellation, and retry support
8. **Generate Receipt**: Tamper-evident receipt with SHA-256 digests of all inputs/outputs
9. **Audit**: Hash chain that detects tampering

No enforcement gap. No synchronization between systems. One source of truth.

## The MCP + AEP Strategy

AEP doesn't replace MCP. It wraps it:

```
MCP tools → AEP governance layer → Safe execution
```

You keep your MCP tools. You keep your MCP server. But every tool call goes through AEP first, gaining:

- Authority enforcement (who can call what on which resource)
- Policy evaluation (organizational rules)
- Risk assessment (dynamic, based on context)
- Human approval (for critical operations)
- Budget enforcement (cost control)
- Idempotency (safe retries)
- Receipts (verifiable proof)
- Audit trail (tamper-evident)

```typescript
import { wrapMCPToolAsCapability } from "@aep/sdk";

wrapMCPToolAsCapability(registry, {
  name: "github.create_issue",
  description: "Create a GitHub issue",
  inputSchema: { ... },
  handler: async (args) => createIssue(args),
}, { risk_level: "medium", side_effect: true });
```

Now your MCP tool has governance. That's the value proposition.

## Conclusion

MCP is a connectivity protocol. AEP is a governance layer.

You need both. But you need AEP on top.

---

*This is the first in a series of articles about governed AI agent execution. Follow the [AEP project](https://github.com/qbrahym02-cmyk/aep-protocol) for more.*
