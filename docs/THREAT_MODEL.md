# AEP Threat Model

## Overview

This document defines the formal threat model for AEP, covering all attack surfaces and the controls that mitigate each threat.

## Threats

### 1. Prompt Injection
- **Attack**: Malicious content in user input or provider response tricks the LLM into executing unauthorized actions.
- **Control**: AEP does not trust LLM output as authorization. The LLM proposes; AEP verifies authority, policy, and risk independently.
- **Test**: `attack: compromised agent — authority scoped to resource, missing resource`

### 2. Capability Poisoning
- **Attack**: Malicious provider registers a capability with a misleading contract or schema.
- **Control**: Capability fingerprints (SHA-256 of canonical contract). Receipts include `capability_digest` for verification.
- **Test**: `attack: malicious provider — output schema violation`

### 3. Credential Theft
- **Attack**: Credentials leaked via logs, events, audit, or artifacts.
- **Control**: `credential_ref` instead of inline secrets. `redact()` applied to all persisted data.
- **Test**: `security: redaction removes secrets`, `security: redaction strips PEM private key`

### 4. Replay Attack
- **Attack**: Attacker reuses an idempotency key or approval nonce.
- **Control**: Scoped idempotency (tenant + principal + capability + resource + authority + key). Nonce tracking in approval service.
- **Test**: `attack: replay — idempotency key reuse by different principal`

### 5. Confused Deputy
- **Attack**: Provider trusts caller-supplied principal instead of verified identity.
- **Control**: `SecureExecutionEngine` authenticates via `Authenticator` before any authorization. Provider receives `VerifiedPrincipal` via `ExecutionContext`.
- **Test**: `attack: confused deputy — provider trusts caller-supplied principal`

### 6. Privilege Escalation
- **Attack**: Child authority exceeds parent authority scope.
- **Control**: `child_authority ⊆ parent_authority` enforced in `deriveTo()`. Property test: 100 random derivations never exceed parent.
- **Test**: `attack: privilege escalation — child exceeds parent`

### 7. Data Exfiltration
- **Attack**: Provider or agent extracts sensitive data beyond authorized scope.
- **Control**: Resource-scoped authorities, tenant isolation, output validation, secret redaction.

### 8. SSRF (Server-Side Request Forgery)
- **Attack**: HTTP provider is tricked into accessing internal endpoints.
- **Control**: Provider manifest with network allowlist. URL validation (documented, implementation in provider sandbox).

### 9. Malicious Provider
- **Attack**: Provider returns malicious output, exceeds side effects, or ignores cancellation.
- **Control**: Output schema validation. Provider sandboxing. Effects descriptor. Provider quarantine.
- **Test**: `attack: malicious provider — output schema violation`

### 10. Event Injection
- **Attack**: Forged events injected into event log.
- **Control**: Typed events with execution_id binding. Audit chain (tamper-evident hash chain).
- **Test**: `attack: compromised server — audit chain tampering detected`

### 11. Artifact Poisoning
- **Attack**: Malicious artifact with wrong checksum.
- **Control**: SHA-256 checksum verification on retrieve. Access policy with tenant/authority scoping.

### 12. Supply Chain
- **Attack**: Compromised dependency in npm/cargo packages.
- **Control**: Lockfile, dependency scanning (documented CI requirement).

### 13. Cross-Tenant Access
- **Attack**: Principal from Tenant A accesses Tenant B's executions, artifacts, or authorities.
- **Control**: Object-level authorization checks `tenant_id`. Idempotency scoped by tenant. `listExecutions` forces `tenant_id` from authenticated principal.
- **Test**: `attack: tenant escape — cross-tenant idempotency read`

### 14. Receipt Forgery
- **Attack**: Forged receipt with wrong digests.
- **Control**: `verifyReceipt()` checks all digests. Signed receipts with HMAC-SHA256 or Ed25519.
- **Test**: `receipt: tampered request detected`

### 15. Policy Bypass
- **Attack**: Execution proceeds despite policy denial.
- **Control**: Policy evaluated before execution. Fail-closed in production mode.
- **Test**: `policy: deny overrides allow`

### 16. Budget Abuse
- **Attack**: Concurrent requests exceed budget.
- **Control**: Atomic `BudgetStore.reserve()` before execution. Race test for concurrent budget.
- **Test**: `budget: reserve + consume + settle`

### 17. TOCTOU (Time-of-Check-Time-of-Use)
- **Attack**: Authority revoked between check and execution.
- **Control**: Authority re-verified at execution time. Revocation with cascade + cache invalidation.
- **Test**: `attack: TOCTOU — authority revoked between check and execute`

## Attack Surface Summary

| Surface | Controls | Tests |
|---|---|---|
| Identity | Authenticator, VerifiedPrincipal, no anonymous | 3 tests |
| Authorization | 9-rule authority, resource binding, tenant isolation | 5 tests |
| Delegation | Subset enforcement, non-delegatable, cascade revoke | 4 tests |
| Execution | Atomic idempotency, budget reservation, state machine | 4 tests |
| Providers | Output validation, effects, sandbox, quarantine | 1 test |
| Audit | Tamper-evident chain, event integrity | 2 tests |
| Receipts | SHA-256 digests, signed receipts, verification | 2 tests |
| Approval | Nonce, expiry, plan digest binding | 1 test |
| Race conditions | Atomic stores, 100-concurrent race test | 1 test |
| **Total** | | **13 attack tests** |
