# AEP Profile — Authority

**Status:** AEP Profile 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Motivation

Authority  primitive   AEP   MCP. :

```text
Agent → Capability
```


```text
Agent
  ↓
Authority
  ↓
Capability
  ↓
Resource
```

Agent    request capability. Agent MUST  authority .

## 2. Authority Object

```json
{
  "id": "auth_abc123",
  "subject": {
    "type": "agent",
    "id": "agent.deploy",
    "tenant_id": "tenant_acme"
  },
  "capabilities": ["deployment.create", "deployment.list"],
  "resources": ["environment:staging", "environment:production"],
  "constraints": {
    "max_duration_ms": 300000,
    "max_cost_usd": 5,
    "max_calls": 20
  },
  "expires_at": "2026-08-17T12:30:00Z",
  "delegatable": false,
  "issued_by": {
    "type": "user",
    "id": "user_alice"
  },
  "issued_at": "2026-08-17T11:30:00Z",
  "revocation_ref": "rev_xxx",
  "signature": {
    "algorithm": "ed25519",
    "value": "<base64>",
    "key_id": "k_42"
  }
}
```

### 2.1 Required Fields

| Field | Type | Required | Semantics |
|---|---|---|---|
| `id` | string | MUST | unique identifier |
| `subject` | Principal | MUST | من يحمل الـauthority |
| `capabilities` | string[] | MUST | glob patterns للـcapabilities المسموحة |
| `resources` | string[] | SHOULD | scoped resources (`[]` = any) |
| `constraints` | object | SHOULD | حدود التنفيذ |
| `expires_at` | ISO 8601 | MUST | انتهاء الصلاحية |
| `delegatable` | boolean | MUST (default false) | هل يمكن للـsubject تفويض |
| `issued_by` | Principal | MUST | من أصدر الـauthority |
| `issued_at` | ISO 8601 | MUST | وقت الإصدار |
| `signature` | object | SHOULD | توقيع رقمي (للـportable authority) |

## 3. Authority Lifecycle

```text
issue → active → revoked
              ↓
            expired
              ↓
       (terminal)
```

| State | Event | Next |
|---|---|---|
| `active` | `expire` (time) | `expired` |
| `active` | `revoke` | `revoked` |
| `active` | `use` (success) | `active` (still valid) |
| `active` | `use` (failure) | `active` (still valid for next attempt) |
| `expired` | — | (terminal) |
| `revoked` | — | (terminal) |

## 4. Capability Matching

server MUST    requested capability   patterns  `authority.capabilities`.

Examples:
- `deployment.create` يطابق `["deployment.create"]` ✓
- `deployment.create` يطابق `["deployment.*"]` ✓
- `deployment.create` يطابق `["*"]` ✓
- `payment.charge` يطابق `["deployment.*"]` ✗ → `FORBIDDEN`

## 5. Resource Matching

server MUST    requested resource  `authority.resources`.

`authority.resources = []`    resource ( ).
`["environment:staging"]`     `environment:staging`.

## 6. Constraint Enforcement

| Constraint | Semantics |
|---|---|
| `max_duration_ms` | execution لا يتجاوز هذه المدة |
| `max_cost_usd` | total cost لا يتجاوز |
| `max_calls` | عدد الـexecutions |
| `max_records` | عدد السجلات المتأثرة |
| `max_artifact_size_mb` | حجم artifact |

server MUST  execution  constraints  `BUDGET_EXCEEDED`  `FORBIDDEN`.

## 7. Delegation

subject   `delegatable: true` MAY  authority :

```text
Authority(parent)
        ↓
derive(subset)
        ↓
Authority(child)
```

### 7.1 Subset Rule

child authority MUST  subset   parent:

```text
child.capabilities ⊆ parent.capabilities
child.resources ⊆ parent.resources
child.constraints ≤ parent.constraints
child.expires_at ≤ parent.expires_at
child.delegatable ≤ parent.delegatable ( )
```

 : `DELEGATION_DENIED`.

### 7.2 Delegation Chain

 authority MUST  `delegation_chain`   origin principal:

```json
{
  "delegation_chain": ["user_alice", "agent_supervisor", "agent_research"]
}
```

### 7.3 Non-Escalation

child MUST NOT     parent.   privilege escalation.

## 8. Portable Authority

portable authority (  runtimes) authority MUST   :

```json
{
  "signature": {
    "algorithm": "ed25519",
    "value": "<base64>",
    "key_id": "k_42"
  }
}
```

runtime   authority MUST     trusted key.
 key management: `profiles/enterprise.md`.

## 9. Authority Tokens vs API Keys

| Aspect | API Key | Authority Token |
|---|---|---|
| Scope | شامل | محدود بـcapabilities + resources |
| Lifetime | طويل | قصير (ساعات) |
| Delegatable | لا | yes (if `delegatable: true`) |
| Revocable | يدوي | فوري عبر `revocation_ref` |
| Auditable | limited | full provenance |
| Portable | limited | yes (signed) |

## 10. Authority Engine API

```ts
class AuthorityEngine {
  issue(subject: Principal, spec: AuthoritySpec, issuedBy: Principal): Authority
  verify(authority: Authority): { valid: boolean; reason?: string }
  canExercise(authority: Authority, capability: string, resource?: string): boolean
  derive(parent: Authority, subset: AuthoritySubset): Authority
  revoke(authorityId: string, by: Principal): void
  isRevoked(authorityId: string): boolean
}
```

## 11. Integration with Execution Engine

 `execute` request Execution Engine MUST:

1.    `authority`  request ( )
2.    `authority`
3.    `authority.subject` = `request.principal`
4.    `authority.capabilities`  `request.capability.id`
5.    `authority.constraints`
6.  `authority.id`  `ExecutionRecord.authority_id`

: `FORBIDDEN`, `UNAUTHORIZED`,  `TOKEN_EXPIRED`.

## 12. Examples

### 12.1 Deploy Agent Authority

```json
{
  "id": "auth_deploy_01",
  "subject": { "type": "agent", "id": "agent.deploy", "tenant_id": "tenant_acme" },
  "capabilities": ["deploy.staging", "deploy.rollback"],
  "resources": ["environment:staging"],
  "constraints": { "max_duration_ms": 600000, "max_cost_usd": 10 },
  "expires_at": "2026-08-17T13:00:00Z",
  "delegatable": false,
  "issued_by": { "type": "user", "id": "user_alice" },
  "issued_at": "2026-08-17T12:00:00Z"
}
```

### 12.2 Research Agent (read-only)

```json
{
  "id": "auth_research_01",
  "subject": { "type": "agent", "id": "agent.research" },
  "capabilities": ["web.search", "web.read", "db.query"],
  "resources": [],
  "constraints": { "max_calls": 100, "max_cost_usd": 1 },
  "expires_at": "2026-08-17T14:00:00Z",
  "delegatable": true,
  "issued_by": { "type": "user", "id": "user_alice" },
  "issued_at": "2026-08-17T12:00:00Z"
}
```

### 12.3 Delegated Sub-Authority

```json
{
  "id": "auth_sub_01",
  "subject": { "type": "agent", "id": "agent.research.sub" },
  "capabilities": ["web.search"],
  "resources": [],
  "constraints": { "max_calls": 10 },
  "expires_at": "2026-08-17T13:00:00Z",
  "delegatable": false,
  "issued_by": { "type": "agent", "id": "agent.research" },
  "issued_at": "2026-08-17T12:30:00Z",
  "parent_authority_id": "auth_research_01",
  "delegation_chain": ["user_alice", "agent.research", "agent.research.sub"]
}
```
