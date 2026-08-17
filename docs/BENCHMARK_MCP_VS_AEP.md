# AEP vs MCP+OAuth+OPA — Architectural Benchmark

## The Core Question

> Why do I need AEP instead of MCP + OAuth + a policy engine (like OPA)?

This document answers that question definitively by comparing what each stack must build to achieve governed agent execution.

---

## The 60-Second Pitch

```
MCP answers:   "What tools can my Agent call?"
AEP answers:   "Who is allowed to call this capability, on which resource,
                under what policy, with what risk, for how long,
                and what exactly happened?"
```

---

## Architecture Comparison

### Stack 1: MCP Only

```
Agent → MCP Server → Tool → Result
```

| Capability | Status |
|---|---|
| Tool discovery | Yes |
| Tool execution | Yes |
| Authorization | No |
| Delegation | No |
| Approval workflow | No |
| Audit trail | No |
| Idempotency | No |
| Recovery | No |
| Multi-tenancy | No |
| Workflow execution | No |
| Risk controls | No |
| Cross-provider execution | No |
| Receipts / Provenance | No |

### Stack 2: MCP + OAuth

```
Agent → OAuth Token → MCP Server → Tool → Result
```

| Capability | Status | Notes |
|---|---|---|
| Tool discovery | Yes | |
| Tool execution | Yes | |
| Authorization | Partial | OAuth scopes are coarse-grained; no per-resource, per-capability enforcement |
| Delegation | Partial | OAuth token delegation exists but no subset enforcement |
| Approval workflow | No | Must be built separately |
| Audit trail | No | Must be built separately |
| Idempotency | No | Must be built per-tool |
| Recovery | No | |
| Multi-tenancy | No | OAuth doesn't model tenants |
| Workflow execution | No | |
| Risk controls | No | |
| Cross-provider execution | No | MCP has no provider abstraction |
| Receipts / Provenance | No | |

### Stack 3: MCP + OAuth + OPA (Policy Engine)

```
Agent → OAuth Token → MCP Server → OPA Policy Check → Tool → Result
```

| Capability | Status | Gap |
|---|---|---|
| Tool discovery | Yes | |
| Tool execution | Yes | |
| Authorization | Partial | OPA evaluates policy but doesn't enforce at runtime; no atomicity |
| Delegation | Partial | No cryptographic delegation chain; no subset enforcement |
| Approval workflow | No | OPA can express "approval required" but no lifecycle management |
| Audit trail | Partial | OPA logs decisions but no tamper-evident chain; execution events not linked to policy decisions |
| Idempotency | No | Still must be built per-tool |
| Recovery | No | No durable execution state |
| Multi-tenancy | Partial | Must be modeled in OPA policies manually |
| Workflow execution | No | |
| Risk controls | Partial | Can be expressed in OPA but not enforced at execution layer |
| Cross-provider execution | No | MCP has no provider mesh |
| Receipts / Provenance | No | No cryptographic receipts |
| **Integration cost** | **High** | Three separate systems to configure, synchronize, and maintain |

### Stack 4: AEP (Unified)

```
Agent → AEP Runtime → [Auth + Authority + Policy + Risk + Approval + Budget
                        + Idempotency + Execution + Recovery + Receipt + Audit]
                     → Provider → Result
```

| Capability | Status | How |
|---|---|---|
| Tool discovery | Yes | Capability Registry with progressive disclosure |
| Tool execution | Yes | SecureExecutionEngine |
| Authorization | Yes | 9-rule authority enforcement with resource binding |
| Delegation | Yes | Cryptographic delegation chains with `child ⊆ parent` enforcement |
| Approval workflow | Yes | Full lifecycle: pending → approved/rejected with nonce + digest binding |
| Audit trail | Yes | Tamper-evident SHA-256 hash chain |
| Idempotency | Yes | Atomic scoped reservation: tenant + principal + capability + resource + authority + key |
| Recovery | Yes | Crash recovery engine with state reconstruction |
| Multi-tenancy | Yes | Tenant-bound resources, scoped idempotency, object-level authorization |
| Workflow execution | Yes | DAG with parallelism, compensation (saga), checkpoints |
| Risk controls | Yes | Dynamic risk: environment + input + principal + blast radius |
| Cross-provider execution | Yes | Provider mesh with semantic equivalence and failover |
| Receipts / Provenance | Yes | Cryptographic receipts with SHA-256 digests of all inputs/outputs |
| **Integration cost** | **Low** | One unified runtime, one configuration, one audit trail |

---

## Feature-by-Feature Deep Comparison

### Authorization

| Dimension | MCP+OAuth+OPA | AEP |
|---|---|---|
| Granularity | Per-tool OAuth scope + OPA policy | Per-capability + per-resource + per-principal |
| Enforcement point | OPA evaluates, MCP executes (gap) | SecureExecutionEngine enforces before execution (no gap) |
| Resource binding | Must be modeled in OPA manually | First-class `ResourceRef` with tenant_id |
| Authority model | OAuth token (flat) | Authority object with delegation chain, constraints, expiry |
| Subset enforcement | No | `child_authority ⊆ parent_authority` (property-tested) |
| Revocation | OAuth token revocation (centralized) | Authority revocation with cascade + cache invalidation |

### Delegation

| Dimension | MCP+OAuth+OPA | AEP |
|---|---|---|
| Model | OAuth token exchange | Authority derivation with explicit subset |
| Enforcement | None (trust the token) | Cryptographic: `derive(parent, subset)` validates scope ⊆ |
| Depth limit | No | `max_delegation_depth` enforced |
| Expiry propagation | No | `child.expires_at ≤ parent.expires_at` enforced |
| Budget propagation | No | `child.budget ≤ parent.budget` enforced |
| Audit trail | OAuth logs (separate) | Delegation chain in receipt + audit |
| Cross-organization | No | Portable signed authorities |

### Approval

| Dimension | MCP+OAuth+OPA | AEP |
|---|---|---|
| Lifecycle | OPA says "approval required" — then what? | Full state machine: pending → approved/rejected/expired/cancelled |
| Plan binding | No | Approval bound to `plan_digest`; if plan changes, approval invalid |
| Replay protection | No | Nonce + timestamp + used-nonce tracking |
| Approver authorization | Must be built separately | `has_approver_role()` check with role-based access |
| Expiry | No | `expires_at` with automatic state transition to expired |
| Constraints | No | `approve_with_constraints` (e.g., "only staging", "max 1000 records") |

### Audit

| Dimension | MCP+OAuth+OPA | AEP |
|---|---|---|
| Integrity | OPA decision logs (mutable) | Tamper-evident SHA-256 hash chain: `hash_n = SHA256(record_n + hash_(n-1))` |
| Completeness | MCP events ≠ OPA logs ≠ OAuth logs (three separate logs) | Single unified event log + audit chain |
| Provenance | No | Full chain: Principal → Authority → Policy → Risk → Plan → Approval → Execution → Provider → Result → Receipt |
| Verification | No | `verifyReceipt()` + `verifyAuditChain()` |

### Idempotency

| Dimension | MCP+OAuth+OPA | AEP |
|---|---|---|
| Scope | Per-tool (if implemented at all) | Scoped: tenant + principal + capability + resource + authority + key |
| Atomicity | None | `IdempotencyStore.reserve()` — atomic conditional insert |
| Authorization | Idempotency before auth (insecure) | Auth before idempotency (secure) |
| Concurrency | Race-prone | Atomic reservation (tested: 100 concurrent → 1 execution) |

### Recovery

| Dimension | MCP+OAuth+OPA | AEP |
|---|---|---|
| Durable state | No (process memory) | `ExecutionStore` (SQLite/PostgreSQL) |
| Crash recovery | No | `RecoveryEngine`: load unfinished → reconstruct state → resume/compensate/fail |
| Compensation | No | Saga pattern: forward graph → failure → compensation graph |
| Checkpoints | No | Workflow checkpoint resume |

### Multi-Tenancy

| Dimension | MCP+OAuth+OPA | AEP |
|---|---|---|
| Tenant model | Must be modeled in OPA | First-class `tenant_id` in Principal, ResourceRef, Authority |
| Isolation | Policy-dependent (error-prone) | Enforced at runtime: object-level authorization + scoped idempotency |
| Cross-tenant access | Possible if policy is wrong | Denied by default: `record.principal.tenant_id !== caller.tenant_id` |

---

## Integration Complexity

### MCP + OAuth + OPA

```
Components: 3 separate systems
Configuration: MCP server config + OAuth provider config + OPA policy files
Synchronization: OAuth tokens must be passed to MCP, MCP must call OPA
Audit: 3 separate logs must be correlated
Failure modes: OPA down → MCP may or may not enforce; OAuth down → no access
Deployment: 3 separate processes/services
```

### AEP

```
Components: 1 unified runtime
Configuration: 1 composition root with all dependencies
Synchronization: Internal — all stages in one pipeline
Audit: 1 tamper-evident chain
Failure modes: Security store down → fail-closed; provider down → failover
Deployment: 1 process (horizontally scalable)
```

---

## Verdict

| Criterion | MCP+OAuth+OPA | AEP |
|---|---|---|
| Time to production | Weeks (integrate 3 systems) | Hours (one runtime) |
| Security gaps | Multiple (enforcement gap, audit gap, idempotency gap) | None (unified pipeline) |
| Maintenance burden | 3 systems × N versions | 1 runtime × 1 version |
| Auditability | Correlate 3 logs | 1 verifiable chain |
| Delegation | Not built-in | First-class with subset enforcement |
| Recovery | Not built-in | Crash recovery + compensation |
| Provider portability | Locked to MCP server | Provider mesh with failover |

**AEP is not "MCP with more fields." AEP is a different layer: governed execution infrastructure that MCP cannot provide.**

MCP handles connectivity. AEP handles governance.
