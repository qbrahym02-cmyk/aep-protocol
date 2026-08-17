# AEP Profile — Events

**Status:** AEP Profile 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Motivation

AEP event-native. Agents   polling.  :

```text
deployment.failed
payment.completed
customer.updated
```

## 2. Event Object

```json
{
  "event_id": "evt_01",
  "type": "execution.started",
  "source": "runtime",
  "timestamp": "2026-08-17T12:00:00Z",
  "sequence": 42,
  "execution_id": "exec_42",
  "trace_id": "trace_01",
  "principal": { "type": "agent", "id": "agent_01" },
  "data": { "state": "running", "capability": "math.add" },
  "delivery": "at_least_once"
}
```

### Required Fields

| Field | Type | Required | Semantics |
|---|---|---|---|
| `event_id` | string | MUST | unique |
| `type` | string | MUST | dotted (`execution.started`) |
| `source` | string | MUST | emitting component |
| `timestamp` | ISO 8601 | MUST | emit time |
| `sequence` | integer | SHOULD | monotonic per-source |
| `execution_id` | string | SHOULD | linked execution |
| `trace_id` | string | SHOULD | linked trace |
| `data` | object | MAY | event payload |
| `delivery` | enum | SHOULD | delivery semantics |

## 3. Event Types

### 3.1 Execution Events

| Type | When |
|---|---|
| `execution.created` | record created |
| `execution.planned` | after planning |
| `execution.authorized` | after policy allow |
| `execution.awaiting_approval` | approval needed |
| `execution.queued` | queued for execution |
| `execution.started` | entering running |
| `execution.progress` | capability-emitted progress |
| `execution.paused` | manually paused |
| `execution.resumed` | resumed |
| `execution.retrying` | retry in progress |
| `execution.compensating` | saga undo |
| `execution.cancelling` | cancellation requested |
| `execution.cancelled` | cancelled (terminal) |
| `execution.completed` | successfully completed (terminal) |
| `execution.failed` | failed (terminal) |
| `execution.expired` | expired (terminal) |

### 3.2 Approval Events

| Type | When |
|---|---|
| `approval.requested` | approval needed |
| `approval.resolved` | decision received |

### 3.3 Resource Events

| Type | When |
|---|---|
| `resource.changed` | resource state changed |
| `resource.snapshot` | periodic snapshot |

### 3.4 Provider Events

| Type | When |
|---|---|
| `provider.degraded` | entered degraded |
| `provider.offline` | entered offline |
| `provider.recovered` | back to healthy |

### 3.5 Artifact Events

| Type | When |
|---|---|
| `artifact.created` | artifact stored |
| `artifact.expired` | artifact TTL passed |
| `artifact.revoked` | artifact access revoked |

## 4. Delivery Semantics

| Mode | Guarantees | Use case |
|---|---|---|
| `at_most_once` | no redelivery, may miss | metrics, telemetry |
| `at_least_once` | may redeliver, won't miss | most cases |
| `effectively_once` | dedup via event_id | critical ops |

server SHOULD  `at_least_once` .
subscribers MUST  idempotent (handle `event_id` dedup).

## 5. Subscriptions

```http
POST /aep/events/subscribe
Content-Type: application/aep+json

{
  "filter": {
    "type": "execution.*"
  },
  "delivery": "at_least_once",
  "buffer_size": 100,
  "on_backpressure": "buffer"
}
```

server  `subscription_handle`.  

```http
GET /aep/events/stream
Authorization: Bearer <token>
```

SSE channel  events.

## 6. Filters

```json
{
  "filter": {
    "type": "execution.completed",
    "execution_id": "exec_42",
    "principal_id": "agent.research"
  }
}
```

filters MUST  combinable (AND logic).

## 7. Replay

client MAY  replay  sequence:

```http
POST /aep/events/replay
{ "from_sequence": 100, "filter": { "type": "execution.*" } }
```

server  events  sequence 100 .

network failure.

## 8. Backpressure

subscriber  跟上:

| Action | Semantics |
|---|---|
| `pause` | إيقاف مؤقت للـsubscription |
| `buffer` | تخزين مؤقت (حتى buffer_size) |
| `resume` | استئناف + flush buffer |
| `drop` | إسقاط الأحداث الجديدة |
| `disconnect` | فصل الـsubscription |

```text
client slow → buffer fills → overflow → action triggered
```

server MUST  `subscription.backpressure` event  activation.

## 9. Event Ordering

`source` events MUST   `sequence`.
sources    .
client SHOULD  `timestamp` ordering  sources.

## 10. Event Schema Registry

 event type SHOULD  schema :

```json
{
  "type": "execution.completed",
  "schema": {
    "type": "object",
    "required": ["execution_id", "state"],
    "properties": {
      "execution_id": { "type": "string" },
      "state": { "type": "string" },
      "output": { "type": "object" },
      "duration_ms": { "type": "integer" }
    }
  }
}
```

server MAY  events   schema (event schema validation).
