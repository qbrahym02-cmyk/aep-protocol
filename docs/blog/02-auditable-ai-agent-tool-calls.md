# How to Make AI Agent Tool Calls Auditable

## The Problem

You have an AI agent that can call tools. It can deploy code, send emails, modify databases, charge credit cards.

After the fact, someone asks: **"Who did this? Why? Under what authority?"**

If you're using a typical agent framework, the answer is: "The agent did it."

That's not good enough. In production, you need to prove:

1. **Who** authorized this action?
2. **What** was the input?
3. **Which policy** allowed it?
4. **What risk** was assessed?
5. **Who approved** the high-risk operations?
6. **What** was the output?
7. **Has the record been tampered with?**

## The AEP Approach

Every execution through AEP produces a **receipt** — a tamper-evident record with SHA-256 digests of every component:

```json
{
  "execution_id": "exec_01M08V...",
  "request_id": "req_42",
  "request_digest": "sha256:a91f3c...",
  "capability_digest": "sha256:7b2e8f...",
  "authority_id": "auth_abc123",
  "policy_decision": "allow",
  "risk_level": "high",
  "provider_id": "github",
  "result_digest": "sha256:9c4d1a...",
  "started_at": "2026-08-17T12:00:00Z",
  "completed_at": "2026-08-17T12:00:01Z",
  "status": "completed"
}
```

### How It Works

1. When a request comes in, AEP **canonicalizes** it (deterministic JSON form)
2. AEP computes **SHA-256** of the canonical form → `request_digest`
3. The capability contract is also digested → `capability_digest`
4. The policy decision is recorded
5. The risk assessment is recorded
6. After execution, the output is digested → `result_digest`
7. All digests are stored in the receipt
8. The receipt is appended to the **audit chain** (hash chain)

### Tamper Detection

The audit chain uses a sequential hash:

```
entry_1.hash = SHA256(canonical(entry_1) + genesis_hash)
entry_2.hash = SHA256(canonical(entry_2) + entry_1.hash)
entry_3.hash = SHA256(canonical(entry_3) + entry_2.hash)
```

If anyone modifies entry_1, entry_2.hash won't match. If they recompute entry_2.hash, entry_3.hash won't match. The chain breaks at the point of tampering.

```typescript
const audit = new AuditEngine();
audit.record({ who: "alice", what: "deploy", capability: "deploy.prod" });
audit.record({ who: "bob", what: "email", capability: "slack.send" });

// Tamper with the first entry
audit.list()[0].decision = "deny";

// Detect it
const verification = audit.verify();
// { valid: false, broken_at: 2 }
```

### Verification

Anyone can verify a receipt independently:

```typescript
import { verifyReceipt } from "@aep/sdk";

const valid = verifyReceipt(receipt, {
  request: originalRequest,
  capability: contract,
  result: output,
});
// { valid: true } or { valid: false, reasons: ["result_digest mismatch"] }
```

## Real-World Example

An AI agent proposes deploying version 2.4 to production:

```
Agent: "Deploy v2.4 to production"
  ↓
AEP: Authenticating... ✓ (agent.deployer, verified via mTLS)
AEP: Authority check... ✓ (has deploy.* on environment:production)
AEP: Policy check... ✓ (allowed during business hours)
AEP: Risk assessment... CRITICAL (irreversible, production, financial impact)
AEP: Approval required...
  ↓
Human: reviews plan, approves
  ↓
AEP: Budget reserved ($0.05)
AEP: Executing deploy.production...
AEP: Output validated against schema... ✓
AEP: Receipt generated (sha256:...)
AEP: Audit entry appended to hash chain
  ↓
Result: { deployed: true, url: "https://app.com/v2.4" }
```

Later, an auditor asks: "Who deployed v2.4 on August 17?"

```
AEP audit query → entry found:
  who: agent.deployer
  what: deploy.production
  when: 2026-08-17T12:00:00Z
  authority: auth_abc123 (issued by user.alice)
  policy: allow (production-hours)
  risk: critical
  approval: approved by user.bob
  result: sha256:9c4d1a...
  audit_chain: valid ✓
```

## Conclusion

Auditable AI agent execution isn't a nice-to-have. It's a requirement for production.

Without auditability, you cannot:
- Prove compliance
- Debug failures
- Detect unauthorized access
- Trust your own agents

AEP makes every tool call auditable by construction — not as an afterthought.

---

*Read more at [github.com/qbrahym02-cmyk/aep-protocol](https://github.com/qbrahym02-cmyk/aep-protocol)*
