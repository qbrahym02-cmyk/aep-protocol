# AEP 004 — Execution (Formal State Machine)

**Status:** AEP Core 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Overview

Execution  lifecycle    .  state machine  events recovery  provenance.

## 2. Execution Record

```ts
interface ExecutionRecord {
  id: string;              // execution_id (opaque handle)
  request_id: string;
  principal: Principal;
  capability: CapabilityRef;
  capability_version: string;
  input: unknown;
  state: ExecutionState;
  previous_state?: ExecutionState;
  created_at: string;      // ISO 8601
  started_at?: string;
  completed_at?: string;
  expires_at?: string;
  policy_decision?: PolicyDecision;
  risk_assessment?: { level: RiskLevel; score?: number; factors?: string[] };
  trace_id?: string;
  delegation_chain?: string[];
  budget?: Budget;
  budget_used?: { cost_usd?: number; calls?: number; duration_ms?: number };
  result?: unknown;
  artifacts?: string[];
  error?: AEPError;
  approval?: ApprovalDecision;
  authority_id?: string;     //  Authority primitive
  idempotency_key?: string;
  parent_execution_id?: string;
  checkpoint_id?: string;
}
```

## 3. States

```text
created                  — initial state, record created
planned                  — capability discovered, plan computed
awaiting_approval        — blocked pending human/policy approval
authorized               — approval obtained (or not required)
queued                   — ready to run, awaiting worker
running                  — capability executing
paused                   — manually paused
retrying                 — failed, retry in progress
compensating             — undoing prior side effects (saga)
cancelling               — cancellation requested, in progress
cancelled                — cancelled (terminal)
completed                — successfully completed (terminal)
failed                   — failed (terminal)
expired                  — deadline passed or handle expired (terminal)
```

**Terminal states:** `completed`, `failed`, `cancelled`, `expired`.  
server MUST    transition  terminal state.

## 4. State Machine — Transition Table

| Current | Event | Next | Side effect (REQUIRED) |
|---|---|---|---|
| `created` | `plan` | `planned` | emit `execution.planned` |
| `created` | `cancel` | `cancelled` | emit `execution.cancelled` |
| `created` | `expire` | `expired` | emit `execution.expired` |
| `created` | `fail` | `failed` | emit `execution.failed` with error |
| `planned` | `request_approval` | `awaiting_approval` | emit `approval.requested` |
| `planned` | `authorize` | `authorized` | emit `execution.authorized` |
| `planned` | `cancel` | `cancelled` | emit `execution.cancelled` |
| `planned` | `expire` | `expired` | emit `execution.expired` |
| `planned` | `fail` | `failed` | emit `execution.failed` |
| `awaiting_approval` | `approve` | `authorized` | emit `approval.resolved` |
| `awaiting_approval` | `deny` | `failed` | emit `approval.resolved` + `execution.failed` |
| `awaiting_approval` | `expire` | `expired` | emit `execution.expired` |
| `awaiting_approval` | `cancel` | `cancelled` | emit `execution.cancelled` |
| `authorized` | `queue` | `queued` | — |
| `authorized` | `cancel` | `cancelled` | emit `execution.cancelled` |
| `authorized` | `expire` | `expired` | emit `execution.expired` |
| `authorized` | `fail` | `failed` | emit `execution.failed` |
| `queued` | `start` | `running` | set `started_at`, emit `execution.started` |
| `queued` | `cancel` | `cancelled` | emit `execution.cancelled` |
| `queued` | `expire` | `expired` | emit `execution.expired` |
| `queued` | `fail` | `failed` | emit `execution.failed` |
| `running` | `complete` | `completed` | set `completed_at`, emit `execution.completed` |
| `running` | `fail` | `retrying` (if retryable) or `failed` | emit `execution.failed` (or `execution.retrying`) |
| `running` | `pause` | `paused` | emit `execution.paused` |
| `running` | `cancel` | `cancelling` | emit `execution.cancelling` |
| `running` | `compensate` | `compensating` | emit `execution.compensating` |
| `paused` | `resume` | `running` | emit `execution.resumed` |
| `paused` | `cancel` | `cancelled` | emit `execution.cancelled` |
| `paused` | `expire` | `expired` | emit `execution.expired` |
| `paused` | `fail` | `failed` | emit `execution.failed` |
| `retrying` | `retry` | `running` | emit `execution.retrying` (with attempt #) |
| `retrying` | `exhausted` | `failed` | emit `execution.failed` |
| `retrying` | `cancel` | `cancelled` | emit `execution.cancelled` |
| `compensating` | `compensate_success` | `completed` (with compensated flag) | emit `execution.completed` |
| `compensating` | `compensate_fail` | `failed` | emit `COMPENSATION_FAILED` + `execution.failed` |
| `compensating` | `cancel` | `cancelled` | emit `execution.cancelled` |
| `cancelling` | `cancelled` | `cancelled` | emit `execution.cancelled` |
| `cancelling` | `cancel_fail` | `failed` | emit `execution.failed` |
| `completed` | (terminal — no transitions) | — | — |
| `failed` | (terminal — no transitions) | — | — |
| `cancelled` | (terminal — no transitions) | — | — |
| `expired` | (terminal — no transitions) | — | — |

**All transitions not listed above MUST be rejected** with error code `INVALID_STATE_TRANSITION`.

## 5. Events Emitted

 transition MUST  event  `EventEmitter`:

| Event type | When |
|---|---|
| `execution.created` | record created |
| `execution.planned` | after `plan` transition |
| `execution.authorized` | after `authorize` transition |
| `execution.awaiting_approval` | when entering `awaiting_approval` |
| `execution.queued` | after `queue` transition |
| `execution.started` | when entering `running` |
| `execution.progress` | during running (optional, capability-emitted) |
| `execution.paused` | when entering `paused` |
| `execution.resumed` | when re-entering `running` from `paused` |
| `execution.retrying` | when entering `retrying` |
| `execution.compensating` | when entering `compensating` |
| `execution.cancelling` | when entering `cancelling` |
| `execution.cancelled` | when entering `cancelled` |
| `execution.completed` | when entering `completed` |
| `execution.failed` | when entering `failed` |
| `execution.expired` | when entering `expired` |
| `approval.requested` | when approval needed |
| `approval.resolved` | when approval decision received |

## 6. Execution Modes

### 6.1 Sync

```http
POST /aep
{ "execution": { "mode": "sync" } }
```

client   terminal state.
 capabilities  p95 < 5s.  
server MUST  `completed`  `error`  `approval_required`.

### 6.2 Async

```http
POST /aep
{ "execution": { "mode": "async" } }
```


```json
{ "status": "accepted", "execution": { "id": "exec_42", "state": "running" } }
```

- `GET /aep/executions/{id}` للـpolling
- `POST /aep/events/subscribe` للاشتراك في الأحداث

### 6.3 Streaming

server  SSE channel  events:

```
event: execution.started
data: {...}

event: execution.progress
data: {"progress":0.5}

event: execution.completed
data: {"output":{...}}
```

server MUST  `execution.completed`  `execution.failed` terminal event.

## 7. Cancel

```http
POST /aep/executions/{id}/cancel
```

server    `cancelling`  `cancelled`.
capability   (`execution.reversible: true`) server MAY  `compensation`  ( Policy).

## 8. Resume

```http
POST /aep/executions/{id}/resume
```

- `paused` → `running`
- workflow مع `checkpoint_id` (يستأنف من الـcheckpoint)

## 9. Budgets

```json
{
  "budget": {
    "max_cost_usd": 2,
    "max_calls": 20,
    "max_duration_ms": 60000,
    "max_parallel": 4,
    "max_artifact_size_mb": 100
  }
}
```

server MUST  .  : `BUDGET_EXCEEDED` → state `failed`.

### 9.1 Budget Propagation

```text
Parent: $10
  └── Child: $2 (max <= $2)
        └── Grandchild: $0.50 (max <= $0.50)
```

child MUST   parent.   delegation.

## 10. Concurrency

```json
{
  "execution": { "expected_version": "v_42" }
}
```

server MUST   `expected_version`.   : `CONCURRENCY_CONFLICT` (state `failed`).

## 11. Trace Propagation

```json
{
  "trace": { "trace_id": "trace_01", "span_id": "span_01", "parent_span_id": "span_00" }
}
```

server SHOULD  propagates :
- كل capability execution
- كل child execution (delegation)
- كل event
- كل audit record

## 12. Authority Binding

execution MUST   authority:

```json
{
  "execution": { ... },
  "authority_id": "auth_xxx"
}
```

server MUST    authority:
1.    (`expires_at`  )
3.  capability
4.  resource

: `FORBIDDEN`  `TOKEN_EXPIRED`.  
: `profiles/authority.md`.

## 13. Open Questions (0.2)

- Distributed execution (multi-server workflows)
- Persistent checkpoint storage
- Workflow versioning
