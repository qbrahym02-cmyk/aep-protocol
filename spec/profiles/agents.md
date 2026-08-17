# AEP Profile — Agents & Delegation

**Status:** AEP Profile 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Agent Identity

```json
{
  "agent": {
    "id": "agent.research",
    "version": "2.1",
    "issuer": "org.example",
    "trust_level": "restricted",
    "capabilities": ["web.search", "db.query"],
    "owner": "user_alice"
  }
}
```

agent MUST :
- identity فريد
- trust_level
- owner principal (أصله)

## 2. Agent Contract

```json
{
  "id": "agent.research",
  "version": "2.1.0",
  "description": "Research agent for scientific queries",
  "input": { "schema": { ... } },
  "output": { "schema": { ... } },
  "skills": ["web_search", "fact_check", "summarize"],
  "risk": { "level": "low", "side_effect": false, "reversible": true },
  "cost": { "currency": "USD", "estimated": 0.05 },
  "latency": { "p50_ms": 2000, "p95_ms": 8000 },
  "availability": "0.99",
  "trust_level": "restricted"
}
```

agents  capabilities    (`kind: agent`).

## 3. Multi-Agent Topology

```text
Supervisor Agent
    ├── Research Agent
    ├── Data Agent
    ├── Coding Agent
    └── Deployment Agent
```

- identity مستقلة
- scope (subset من parent)
- budget (subset من parent)
- expiration (≤ parent)
- delegation chain

## 4. Delegation Rules

```text
Authority(parent)
        ↓
derive(subset)
        ↓
Authority(child)
```

### 4.1 Subset Rule (Strict)

```text
child.capabilities ⊆ parent.capabilities
child.resources ⊆ parent.resources
child.constraints.max_* ≤ parent.constraints.max_*
child.expires_at ≤ parent.expires_at
child.delegatable ≤ parent.delegatable
```

 : `DELEGATION_DENIED`.

### 4.2 Non-Escalation

child MUST NOT     parent.   privilege escalation.

### 4.3 Delegation Chain

 request  child MUST :

```json
{
  "delegation": {
    "delegation_chain": ["user_alice", "agent_supervisor", "agent_research"],
    "parent_execution_id": "exec_parent_01"
  }
}
```

server MUST    .

## 5. Budget Propagation

```text
Parent: $10, 100 calls, 60min
  └── Child: $2, 20 calls, 30min
        └── Grandchild: $0.50, 5 calls, 10min
```

child MUST   parent   .

## 6. Agent Mailbox

agents MAY  mailboxes async communication:

```text
Supervisor → Research Agent: "find papers on quantum computing"
    ↓ (request)
Research Agent: ... processing ...
    ↓ (response)
Supervisor: receives response
```

 correlation IDs.

## 7. Agent Reputation (optional)

```json
{
  "agent_id": "agent.research",
  "reputation": {
    "score": 0.87,
    "successful_tasks": 1242,
    "failed_tasks": 18,
    "avg_latency_ms": 3200,
    "last_updated": "2026-08-17T12:00:00Z"
  }
}
```

Reputation   Core. Policy MAY   decisions.

## 8. Agent Discovery

```json
{
  "intent": { "task": "research", "domain": "scientific" }
}
```

server  agents  ( Capability Resolution).

## 9. Agent-to-Agent Patterns

### 9.1 Sequential Pipeline

```text
Research → Data → Coding → Deploy
```


### 9.2 Parallel Fan-out

```text
Supervisor
    ├── Research Agent  (parallel)
    ├── Data Agent      (parallel)
    └── Verification Agent (parallel)
```

supervisor    .

### 9.3 Hierarchical Delegation

```text
Supervisor
    └── Sub-supervisor
          ├── Agent A
          └── Agent B
```

.    subset rule.

## 10. Failure Patterns

### 10.1 Agent Unavailable

```text
Agent A times out
    ↓
Supervisor detects
    ↓
Find equivalent agent (semantic class)
    ↓
Retry with Agent B
```

### 10.2 Agent Failed

```text
Agent A returns error
    ↓
Supervisor checks retry policy
    ↓
If retryable: retry with backoff
If not: compensation (undo prior work)
```

### 10.3 Budget Exhausted

```text
Child budget exceeded
    ↓
Supervisor notified
    ↓
Either: increase budget (if has remaining)
Or: fail workflow
```
