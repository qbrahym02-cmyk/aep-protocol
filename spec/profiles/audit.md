# AEP Profile — Audit & Provenance

**Status:** AEP Profile 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Motivation


```text
User → Agent → Plan → Execution → Capability → Resource → Artifact
```

Audit MUST  **tamper-evident** —    .

## 2. Audit Record

```json
{
  "seq": 42,
  "timestamp": "2026-08-17T12:00:00Z",
  "who": "agent.deploy",
  "what": "execute",
  "capability": "deploy.production",
  "resource": "environment:production",
  "decision": "allow",
  "result": "success",
  "details": {
    "execution_id": "exec_42",
    "principal": "agent.deploy",
    "policy_decision": "approval",
    "risk_level": "critical"
  },
  "hash": "abc...",
  "prev_hash": "def..."
}
```

## 3. Hash Chain (Tamper-evident)

```text
hash_0 = "0" * 64  (genesis)
hash_n = SHA256(canonical(record_n) + hash_(n-1))
```

`canonical(record_n)`  `hash`  `prev_hash` (  ).

record_n  `hash_n`   hashes .

## 4. Anchor (optional)

anchor  (blockchain  notarization service):

```json
{
  "anchor": {
    "service": "bitcoin_chainpoint",
    "proof": "...",
    "anchored_at": "2026-08-17T12:00:05Z"
  }
}
```

## 5. Audit Fields

| Field | Required | Semantics |
|---|---|---|
| `seq` | MUST | monotonic |
| `timestamp` | MUST | ISO 8601 |
| `who` | MUST | principal id |
| `what` | MUST | operation type |
| `when` | SHOULD | original action timestamp (may differ from record timestamp) |
| `where` | SHOULD | server id / region |
| `why` | SHOULD | reason / business justification |
| `capability` | SHOULD | if execution |
| `resource` | SHOULD | affected resource |
| `policy` | SHOULD | policy decision |
| `decision` | SHOULD | allow/deny/approval |
| `result` | SHOULD | success/failure |
| `details` | MAY | extra context |
| `hash` | MUST | computed |
| `prev_hash` | MUST | chain link |

## 6. Provenance Object

```json
{
  "provenance": {
    "execution_id": "exec_123",
    "principal": "agent_42",
    "delegation_chain": ["user_alice", "agent_supervisor", "agent_research"],
    "capability": "database.query",
    "capability_version": "1.2.0",
    "sources": ["db://orders"],
    "policy_decision": "allow",
    "risk_assessment": "low",
    "trace_id": "trace_01",
    "policy": "finance-v3",
    "authority_id": "auth_xxx"
  }
}
```

server MUST  `provenance`   result capabilities  `risk.side_effect: true`.

## 7. Verification

```bash
aep audit verify
```


```json
{
  "valid": true,
  "total_records": 1242,
  "last_hash": "abc...",
  "broken_at": null
}
```

 `valid: false`:

```json
{
  "valid": false,
  "broken_at": 42,
  "expected_hash": "...",
  "actual_hash": "..."
}
```

## 8. Audit Query

```bash
aep audit query --principal agent.deploy --capability "deploy.*" --from 2026-08-17T00:00:00Z
```

server  matching records.

## 9. Retention

| Record type | Min retention |
|---|---|
| Audit (security-relevant) | 7 years |
| Provenance (artifacts) | artifact lifetime + 30d |
| Events | 30 days |

## 10. Privacy

audit records MUST   :
- كلمات سر
- tokens
- PII مباشرة (hash them)

audit records SHOULD  data residency rules ( `enterprise.md`).
