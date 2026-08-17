# AEP Conformance Certification

## Certification Levels

### AEP Core Certified

**Requirements:**
- Pass all canonicalization vectors (12)
- Pass all SemVer vectors (20)
- Pass all state transition vectors (22)
- Pass all fingerprint vectors (12)
- Pass all audit chain vectors (1)

**Tests:** 67 vectors minimum

### AEP Security Certified

**Requirements (in addition to Core):**
- Pass all 13 attack tests (privilege escalation, confused deputy, delegation abuse, replay, authority forgery, tenant escape, approval bypass, race condition, TOCTOU, malicious provider, compromised agent, compromised server, expired authority)
- Authority enforcement with all 9 rules
- Object-level authorization
- Tenant isolation verified
- Cryptographic receipt verification
- Audit chain tamper detection

**Tests:** 80+ vectors

### AEP Authority Certified

**Requirements (in addition to Security):**
- Authority derivation with subset enforcement (`child ⊆ parent`)
- Recursive cascade revocation (5+ levels)
- Delegation chain validation
- Authority expiration enforcement
- Resource-scoped authority (RESOURCE_REQUIRED)
- Property test: 100 random derivations never exceed parent

**Tests:** 90+ vectors

### AEP Workflow Certified

**Requirements (in addition to Authority):**
- DAG execution with topological sort
- Parallel branch execution
- Condition evaluation (skip nodes)
- Compensation (saga) on failure
- Budget enforcement in workflows
- Checkpoint/resume

**Tests:** 100+ vectors

### AEP Enterprise Certified

**Requirements (in addition to Workflow):**
- Durable persistence (SQLite or PostgreSQL)
- Crash recovery engine
- Multi-tenant isolation (4 mandatory tests)
- mTLS authentication
- Rate limiting
- CORS allowlist (no wildcard)
- Body size limits
- Prometheus metrics
- Production fail-closed validation

**Tests:** 120+ vectors

---

## How to Get Certified

1. Implement the AEP runtime from the specification
2. Run the conformance suite: `aep conformance`
3. Submit results to the AEP Foundation
4. Receive certification badge

## Current Certified Implementations

| Implementation | Core | Security | Authority | Workflow | Enterprise |
|---|---|---|---|---|---|
| TypeScript SDK | Yes (131 tests) | Yes (13 attacks) | Yes (7 tests) | Yes (5 tests) | Partial |
| Python SDK | Yes (67 tests) | Pending | Pending | Pending | Pending |
| Rust SDK | Yes (65 tests) | Pending | Pending | Pending | Pending |
