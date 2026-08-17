# AEP 005 — Result

**Status:** AEP Core 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Overview

Result   execution.  `execute` request MUST  result  error (    ).

## 2. Result Structure

```json
{
  "output": { ... },
  "artifacts": ["art_42", "art_43"],
  "cost_usd": 0.029,
  "duration_ms": 1234,
  "provenance": { ... }
}
```

| Field | Type | Required | Semantics |
|---|---|---|---|
| `output` | object | SHOULD | مخرج الـcapability. MUST يطابق `capability.output.schema`. |
| `artifacts` | string[] | SHOULD | list of artifact handles للبيانات الكبيرة. |
| `cost_usd` | number | MAY | التكلفة الفعلية. |
| `duration_ms` | integer | MAY | زمن التنفيذ الفعلي. |
| `provenance` | object | SHOULD | سلسلة المصدر (مرجع `profiles/audit.md`). |

## 3. Validation Rules

1. `output` MUST  `capability.output.schema`.   : `INTERNAL_ERROR`.
2. `artifacts` MUST  list of valid artifact handles.  handle MUST    (checksum).
3. `cost_usd` MUST  ≥ 0.
4. server MUST  `provenance`   result capabilities  `risk.side_effect: true`.

## 4. Partial Results

server MAY  partial  `continuation_handle`:

```json
{
  "aep": "0.1",
  "id": "req_42",
  "status": "partial",
  "execution": { "id": "exec_42", "state": "running" },
  "output": { "items": [...100 items...] },
  "partial": true,
  "continuation_handle": "cur_abc"
}
```

client MAY :

```json
{
  "aep": "0.1",
  "id": "req_43",
  "type": "execute",
  "capability": { "id": "cursor.next" },
  "input": { "handle": "cur_abc", "limit": 100 }
}
```

server MUST   SQL  internal representation  `continuation_handle` ( `007-handles.md §Cursor Security`).

## 5. Streaming Results

`mode=streaming` server    SSE:

```
event: execution.output_chunk
data: {"chunk_index":0, "data":"..."}

event: execution.progress
data: {"progress": 0.5, "stage":"processing"}

event: execution.completed
data: {"execution_id":"exec_42"}
```

server MUST  `execution.completed`  `execution.failed`  event.  
client MUST      .

## 6. Provenance in Result

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

server MUST :
- `execution_id`
- `principal`
- `capability`
- `sources` (إن وُجدت)

: `profiles/audit.md`.
