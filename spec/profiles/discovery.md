# AEP Profile — Discovery & Capability Resolution

**Status:** AEP Profile 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Motivation

Agent `github.issue.create`    **intent**  AEP    capability.

```json
{
  "intent": {
    "operation": "create_issue",
    "domain": "project_management"
  },
  "constraints": {
    "risk_max": "medium",
    "latency_max_ms": 3000,
    "cost_max_usd": 0.10
  }
}
```

AEP  **Capability Resolution**:

```text
Semantic Resolution
        ↓
Capability candidates
        ↓
Schema compatibility
        ↓
Authority filter
        ↓
Policy filter
        ↓
Risk filter
        ↓
Provider health
        ↓
Cost filter
        ↓
Latency filter
        ↓
Best Capability (ranked)
```

## 2. Discovery ≠ Authorization


```text
discoverable != executable
```

Discovery    capabilities   current principal .
Authorization   Execution Engine.

## 3. Progressive Disclosure

 context bloat (5000 capability   request model context):

| Level | Returns | Use case |
|---|---|---|
| 1 | name, summary, kind, risk, provider | initial discovery |
| 2 | + contract (input/output schemas) | schema matching |
| 3 | + examples, advanced metadata | detailed inspection |
| 4 | + everything (full) | debugging |

client SHOULD  Level 1  .

## 4. Capability Resolution Request

```json
{
  "aep": "0.1",
  "id": "req_resolve_01",
  "type": "discover",
  "principal": { "type": "agent", "id": "agent.research" },
  "input": {
    "intent": {
      "operation": "create_issue",
      "domain": "project_management",
      "description": "Create an issue in a project management system"
    },
    "constraints": {
      "risk_max": "medium",
      "latency_max_ms": 3000,
      "cost_max_usd": 0.10
    },
    "limit": 5
  }
}
```

## 5. Resolution Algorithm

```text
Step 1: Semantic Match
   - match intent.operation against capability.semantic_class
   - match intent.domain against capability.domain
   - if intent.description present, use embedding similarity (optional)

Step 2: Authority Filter
   - filter out capabilities not in authority.capabilities

Step 3: Schema Compatibility
   - check intent.input_schema (if provided) is compatible with capability.input.schema

Step 4: Policy Filter
   - run policy.evaluate for (subject, capability, context)
   - filter out deny

Step 5: Risk Filter
   - filter out capabilities with risk_level > constraints.risk_max

Step 6: Provider Health Filter
   - filter out capabilities with health = "offline"
   - down-rank "degraded"

Step 7: Cost Filter
   - filter out capabilities with estimated cost > constraints.cost_max_usd

Step 8: Latency Filter
   - filter out capabilities with p95 > constraints.latency_max_ms

Step 9: Rank
   - sort by composite score:
     score = w1*health + w2*latency_score + w3*cost_score + w4*risk_score + w5*quality
   - default weights: 0.3, 0.25, 0.2, 0.15, 0.10

Step 10: Return top N (limit)
```

## 6. Resolution Response

```json
{
  "aep": "0.1",
  "id": "req_resolve_01",
  "status": "completed",
  "output": {
    "matches": [
      {
        "rank": 1,
        "capability_id": "github.issue.create",
        "version": "1.0.0",
        "provider": "github",
        "health": "healthy",
        "risk_level": "medium",
        "estimated_cost_usd": 0.001,
        "p95_ms": 1500,
        "score": 0.87,
        "factors": ["semantic:exact", "authority:allowed", "policy:allow", "risk:ok"]
      },
      {
        "rank": 2,
        "capability_id": "linear.issue.create",
        "version": "1.0.0",
        "provider": "linear",
        "health": "healthy",
        "risk_level": "medium",
        "estimated_cost_usd": 0.002,
        "p95_ms": 800,
        "score": 0.81,
        "factors": ["semantic:exact", "authority:allowed", "policy:allow", "risk:ok"]
      }
    ],
    "rejected": [
      {
        "capability_id": "jira.issue.create",
        "reason_code": "PROVIDER_OFFLINE"
      }
    ]
  }
}
```

## 7. Capability Equivalence

Capabilities  `semantic_class`   :

```text
issue.creation ← github.issue.create
issue.creation ← linear.issue.create
issue.creation ← jira.issue.create
```

provider A runtime MAY   :

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

## 8. Capability Bundles

capabilities   bundle:

```text
github.project_management ← [
  github.issue.create,
  github.issue.list,
  github.issue.update,
  github.repo.read
]
```

client MAY  bundle     capability .

server MUST  bundle  discovery.

## 9. Registry

registry . server MAY  capabilities :

- static configuration
- local registry (file)
- federated registry (HTTP)
- enterprise registry (authenticated)

server MUST    registry  ( SPOF).

## 10. Health Tracking

| State | Semantics |
|---|---|
| `healthy` | يعمل بشكل طبيعي |
| `degraded` | يعمل لكن مع تأخير/أخطاء |
| `offline` | غير متاح |
| `unknown` | لم يُفحص بعد |

server SHOULD  health :
- periodic ping (كل 30s)
- success/failure rate monitoring
- latency monitoring

provider  `offline`:
- الـserver MUST يوقف discovery له
- الـserver MUST يبحث عن alternatives للـexecutions الجارية (إن لم تكتمل)
- الـserver SHOULD يرجع `PROVIDER_UNAVAILABLE` للـrequests الجديدة

## 11. CLI

```bash
# discover
aep discover --level 1
aep discover --kind action --risk-max medium

# resolve intent
aep resolve '{"intent":{"operation":"create_issue","domain":"project_management"}}'

# inspect
aep inspect github.issue.create
```
