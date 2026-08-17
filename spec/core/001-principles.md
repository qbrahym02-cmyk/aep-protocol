# AEP 001 — Principles

AEP     .          .

---

## 5.1 Capability-first

Tool primitive . Capability    :
- identity, version, kind
- input/output schemas
- execution semantics (sync/async/streaming/cancel/retry/idempotent/dry_run)
- authorization, risk, reversibility
- (اختياري) cost, latency, quality, freshness, compensation, provider, region, data classification

Tool primitive    feature    authorizatio retry  audit. Capability      .

---

## 5.2 Stateless by default

request     instance  AEP Runtime.   affinity  client server.

- horizontal scaling بدون session replication
- recovery أسهل عند crash
- load balancing طبيعي

:    **Explicit Handles** (: §5.3).

---

## 5.3 Explicit state

opaque handles:

```text
execution_handle
resource_handle
cursor_handle
transaction_handle
subscription_handle
artifact_handle
delegation_handle
```

 handle:
- opaque — لا يكشف state داخليًا
- scoped — محدود بـprincipal وscope
- expirable عند الحاجة
- لا يتجاوز authorization

server   implicit session  requests.

---

## 5.4 Secure by default

side effect  authorization  risk metadata. runtime    side effect    .


```text
LLM proposes
      ↓
AEP validates
      ↓
Policy authorizes
      ↓
Risk evaluates
      ↓
Approval if required
      ↓
Executor executes
      ↓
Audit records
```

side effects .

---

## 5.5 Deterministic execution boundary

runtime    .        —         .

- non-determinism في النموذج (LLM output)
- determinism في الـruntime (state machine, policy, audit)

---

## 5.6 Extensible Core

Core .    **Profiles**  Core:

| Profile | يضيف |
|---|---|
| Core | envelope, capability, execution, result, error, handles |
| Security | identity, authn, authz, policy, approval, audit |
| Workflow | graphs, conditions, loops, budgets, checkpoint, compensation |
| Events | publish, subscribe, replay, backpressure |
| Agents | agent identity, delegation, agent discovery |
| Enterprise | SSO, multi-tenancy, residency, governance |
| Edge | offline, CBOR, small payloads |

:    feature Profile   interoperability    Core.

---

## 5.7 Provider independence

Capability   Provider.  capability ( `issue.creation`)      providers:

```text
github.issue.create
linear.issue.create
jira.issue.create
```

- load balancing
- failover
- cost routing
- region routing
- quality routing

---

## 5.8 Portable workflows

Workflow format       AEP Runtime . workflow  artifact :
- export / import
- simulate / replay / inspect
- version

---

## 5.9 Fail safely

typed  .  error :

```text
code
retryable
retry_after_ms
recovery[]
```

Recovery   : retry, fallback, reauthorize, ask_user, compensate, abort.

Client/Runtime   Policy —    recovery .

---

## 5.10 No artificial lock-in

ecosystem  .     .   :

```text
capability ecosystem
workflow library
policy library
provider mesh
observability
provenance
agent identity
certification
benchmarks
```

 `open export · open spec · open SDK`.

---

## المبدأ المركزي للتصميم


```text
high impact
irreversible
financial
destructive
privacy sensitive
production critical
```

Agent.    :

```text
authorization
risk
possibly approval
audit
```

