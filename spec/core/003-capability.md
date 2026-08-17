# AEP 003 — Capabilities

Capability     AEP.      Capability Contract.

---

## الحقول الإجبارية

 Capability Contract MUST :

```text
identity         (id, version)
kind             (read|query|search|transform|action|workflow|subscribe|stream|delegate|agent|artifact|ui)
description
input.schema
output.schema
errors[]
execution semantics (sync, async, streaming, cancel, retry, idempotent, dry_run)
authorization.scopes[]
risk (level, side_effect, reversible)
```

## الحقول الاختيارية

```text
cost (currency, estimated)
performance (p50_ms, p95_ms)
freshness (real_time|seconds|minutes|daily)
reversibility
compensation (capability_ref)
provider.id
region
data_classification (public|internal|confidential|restricted|secret)
semantic_class ( equivalence — : §Capability Equivalence)
examples[]
```

---

## مثال كامل

```json
{
  "id": "github.issue.create",
  "version": "1.0.0",
  "kind": "action",
  "description": "Create an issue in a GitHub repository",

  "input": {
    "schema": {
      "type": "object",
      "required": ["repository", "title"],
      "properties": {
        "repository": { "type": "string", "description": "owner/repo" },
        "title": { "type": "string" },
        "body": { "type": "string" },
        "labels": { "type": "array", "items": { "type": "string" } }
      }
    }
  },

  "output": {
    "schema": {
      "type": "object",
      "required": ["number", "url"],
      "properties": {
        "number": { "type": "integer" },
        "url": { "type": "string" }
      }
    }
  },

  "execution": {
    "sync": true,
    "async": true,
    "streaming": false,
    "cancel": true,
    "retry": true,
    "idempotent": true,
    "dry_run": true
  },

  "risk": {
    "level": "medium",
    "side_effect": true,
    "reversible": true,
    "compensation": "github.issue.close"
  },

  "authorization": {
    "scopes": ["github.issue.write"]
  },

  "cost": {
    "currency": "USD",
    "estimated": 0.001
  },

  "performance": {
    "p50_ms": 400,
    "p95_ms": 1500
  },

  "semantic_class": "issue.creation"
}
```

---

## أنواع Capabilities (kind)

| kind | الوصف | side_effect |
|---|---|---|
| `read` | قراءة مورد محدد | no |
| `query` | استعلام مهيكل عن مورد | no |
| `search` | بحث غير مهيكل | no |
| `transform` | تحويل بيانات | no |
| `action` | عملية ذات side effect | yes |
| `workflow` | تنفيذ graph متعدد الخطوات | depends |
| `subscribe` | اشتراك في أحداث مورد | no |
| `stream` | دفق بيانات مستمر | no |
| `delegate` | تفويض إلى وكيل آخر | depends |
| `agent` | استدعاء وكيل | depends |
| `artifact` | عملية على artifact | depends |
| `ui` | تفاعل مع واجهة | depends |

---

## Execution Semantics

Capability  :

```json
{
"sync": true,        //
"async": true,       //
"streaming": false,  //     events
  "cancel": true,      //  
"retry": true,       //
"idempotent": true,  //
"dry_run": true      //
}
```

runtime MUST    mode   (error: `INVALID_REQUEST`).

---

## Risk


```json
{
  "level": "low|medium|high|critical",
  "impact": "none|operational|financial|reputational|compliance|safety",
  "side_effect": true,
  "reversible": true,
  "blast_radius": "single_record|multi_record|service|tenant|account|global",
  "data_sensitivity": "public|internal|confidential|restricted|secret"
}
```

Risk     —  capability  :
- LOW في `test`
- HIGH في `staging`
- CRITICAL في `production`

runtime  context (principal, resource, environment, tenant, time)   .

---

## Authorization

```json
{
  "authorization": {
    "scopes": ["github.issue.write"],
    "require_approval": "always|on_high_risk|never",
    "require_strong_auth": false,
    "require_step_up": false
  }
}
```

Agent API key .  **Capability Token** :

```json
{
  "sub": "agent_01",
  "capabilities": ["github.issue.create"],
  "resources": ["repo:acme/project"],
  "limits": {
    "max_calls": 5,
    "max_cost_usd": 1
  },
  "expires_at": "2026-08-17T12:30:00Z"
}
```

---

## Capability Equivalence

capability  `semantic_class`:

```text
issue.creation ← github.issue.create
issue.creation ← linear.issue.create
issue.creation ← jira.issue.create
```

Provider A runtime    :

```text
Provider A unavailable
        ↓
find equivalent (semantic_class)
        ↓
schema compatibility check
        ↓
risk compatibility check
        ↓
policy check
        ↓
Provider B
```

semantics  .

---

## Capability Composition

  Composite Capability:

```text
A + B + C → D
```

side effects   `output.provenance`.

---

## Capability Versioning

```text
1.2.3         (exact)
^1.2          (caret — ≥1.2.0, <2.0.0)
~1.2.3        (tilde — ≥1.2.3, <1.3.0)
>=1.0.0 <2.0.0 (range)
```

pin exact version. runtime    breaking changes  `schema_compatibility`:

```text
backward_compatible
forward_compatible
breaking
```

---

## Capability Fingerprint

```text
fingerprint = SHA-256(canonical(capability))
```

- cache key
- deduplication
- integrity verification
- registry indexing

---

## Discovery ≠ Authorization


```text
discoverable != executable
```

capability    . runtime     discovery  authorization.
