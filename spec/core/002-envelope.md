# AEP 002 — Envelope (Formal Wire Specification)

**Status:** AEP Core 0.1 — NORMATIVE  
**Keywords:** The keywords "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

## 1. Overview

  AEP (request, response, event, error) MUST   Envelope .   parsing  canonicalization  routing  audit.

Content-Type:

```
application/aep+json
```

Encoding: UTF-8.  
Max single-envelope payload: 1 MiB. payloads  MUST  artifact reference ( `007-handles.md`).

## 2. Common Fields (الحقول المشتركة)

| Field | Type | Required | Semantics |
|---|---|---|---|
| `aep` | string | MUST | إصدار البروتوكول. القيمة `"0.1"` إجبارية في AEP 0.1. |
| `id` | string | MUST | معرّف فريد للرسالة. MUST يكون UUIDv4 أو ULID. SHOULD لا يتجاوز 64 محرفًا. |
| `type` | enum | MUST (request) | `execute` \| `discover` \| `cancel` \| `resume` \| `subscribe` \| `approve` |
| `status` | enum | MUST (response) | `accepted` \| `completed` \| `error` \| `approval_required` \| `partial` |

### 2.1 `aep` Field

The `aep` field MUST  present   message.  
server MUST   request   `"0.1"`  error code `INVALID_REQUEST`.  
client MUST    response     .

### 2.2 `id` Field

The `id` field MUST  unique  session client.  
server SHOULD   `request_id` ExecutionRecord.  
server MUST    `id` request    idempotency.

### 2.3 `type` Field

request MUST  .  response MUST   `id`  .
server MUST  request     error code `INVALID_REQUEST`.

## 3. Request Envelope

```json
{
  "aep": "0.1",
  "id": "req_01",
  "type": "execute",
  "principal": { "type": "agent", "id": "agent_01" },
  "capability": { "id": "github.issue.create", "version": "^1.0" },
  "input": {},
  "execution": {
    "mode": "async",
    "idempotency_key": "idem_123",
    "deadline": "2026-08-17T12:00:00Z",
    "dry_run": false
  },
  "authority": { "authority_id": "auth_xxx", "signature": "..." },
  "trace": { "trace_id": "trace_01" },
  "budget": { "max_cost_usd": 2, "max_calls": 20 }
}
```

### 3.1 `principal` (REQUIRED when type = `execute`)

```ts
interface Principal {
  type: "user" | "agent" | "service" | "system";
  id: string;
  tenant_id?: string;
  delegation_chain?: string[];
}
```

The `principal` field MUST  present   `execute` request.  
server MUST  request  principal  `UNAUTHORIZED`.  
`delegation_chain` MUST    origin  current.  
server MUST       chain     (`DELEGATION_DENIED`).

### 3.2 `capability` (REQUIRED when type = `execute`)

```ts
interface CapabilityRef {
  id: string;        // dotted: "github.issue.create"
  version?: string;  // semver range
}
```

The `capability.id` MUST  pattern: `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`.  
The `capability.version`   MUST  `*` ( ).
server MUST  `CAPABILITY_NOT_FOUND`    .
server MUST  `CAPABILITY_VERSION_UNSUPPORTED`     .

### 3.3 `input` (OPTIONAL)

The `input` field MUST  object.  
server MUST    `capability.input.schema`   (`SCHEMA_VALIDATION_FAILED`).  
server MUST  input   1 MiB (`INVALID_REQUEST`).

### 3.4 `execution` (OPTIONAL)

| Field | Type | Default | Semantics |
|---|---|---|---|
| `mode` | enum | `sync` | `sync` \| `async` \| `streaming` |
| `idempotency_key` | string | — | معرف deduplication |
| `deadline` | ISO 8601 | — | وقت نهائي مطلق |
| `dry_run` | boolean | `false` | محاكاة بدون side effect |
| `timeout_ms` | integer | server default | مهلة التنفيذ |
| `max_retries` | integer | 0 | حد إعادة المحاولة |

`mode` MUST    capability (`execution.sync`  `execution.async`  `execution.streaming`). : `INVALID_REQUEST`.  
`dry_run: true` MUST    capability (`execution.dry_run: true`). : `INVALID_REQUEST`.  
`deadline`   MUST   `EXECUTION_EXPIRED`.

### 3.5 `authority` (REQUIRED for sensitive operations)

```json
{
  "authority": {
    "authority_id": "auth_xxx",
    "signature": "<base64>",
    "key_id": "k_42"
  }
}
```

  side_effect  risk ≥ medium `authority` MUST  present.  
server MUST      (`TOKEN_EXPIRED`).
: `profiles/authority.md`.

### 3.6 `trace` (OPTIONAL but RECOMMENDED)

```json
{
  "trace": {
    "trace_id": "trace_01",
    "span_id": "span_01",
    "parent_span_id": "span_00",
    "baggage": { "user.id": "alice" }
  }
}
```

server SHOULD  propagates `trace_id`   capability execution.  
server MUST  `trace_id`   events    request.

### 3.7 `budget` (OPTIONAL)

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

server MUST  .  : `BUDGET_EXCEEDED`.
child execution MUST   budget parent.

## 4. Response Envelope

### 4.1 Accepted (async)

```json
{
  "aep": "0.1",
  "id": "req_01",
  "status": "accepted",
  "execution": { "id": "exec_01", "state": "running" }
}
```

`status` MUST  `"accepted"`  `mode=async`.  
`execution.id` MUST  unique   .
`execution.state` MUST     state machine ( `004-execution.md`).

### 4.2 Completed (sync)

```json
{
  "aep": "0.1",
  "id": "req_01",
  "status": "completed",
  "execution": { "id": "exec_01", "state": "completed" },
  "output": {},
  "artifacts": []
}
```

`output` MUST  `capability.output.schema`. : `INTERNAL_ERROR`.  
`artifacts` MUST  list of artifact handles.

### 4.3 Error

```json
{
  "aep": "0.1",
  "id": "req_01",
  "status": "error",
  "execution": { "id": "exec_01", "state": "failed" },
  "error": { "code": "RATE_LIMITED", "message": "...", "retryable": true, "retry_after_ms": 2500 }
}
```

`error` MUST  `code`, `message`, `retryable`.  
: `006-error.md`.

### 4.4 Approval Required

```json
{
  "aep": "0.1",
  "id": "req_01",
  "status": "approval_required",
  "execution": { "id": "exec_01", "state": "awaiting_approval" },
  "approval": {
    "approval_id": "ap_01",
    "reason": "Production deployment",
    "risk": "critical",
    "expires_at": "2026-08-17T12:30:00Z",
    "allowed_decisions": ["approve", "deny", "approve_with_constraints"]
  }
}
```

`approval.expires_at` MUST   .
: `APPROVAL_EXPIRED`.

### 4.5 Partial

```json
{
  "aep": "0.1",
  "id": "req_01",
  "status": "partial",
  "execution": { "id": "exec_01", "state": "running" },
  "output": { "items": [...] },
  "partial": true,
  "continuation_handle": "cur_xyz"
}
```

server MAY  partial  `continuation_handle`.
client MUST   request  .

## 5. Canonicalization (REQUIRED for signing)

envelope MUST  canonical representation :
- request signing
- fingerprint / cache key / dedup
- audit integrity

Algorithm:

```text
1.    lexicographically (recursive)
2.    `undefined`
3.  whitespace (no spaces, no newlines)
4. UTF-8 encoding
5. JSON.stringify with sorted keys
```

Example:

```js
canonicalize({ b: 2, a: 1, c: { z: 1, y: 2 } })
// → '{"a":1,"b":2,"c":{"y":2,"z":1}}'
```

```text
fingerprint = SHA-256(canonical)
```

server MUST  canonical form :
- حساب fingerprint للـcapability
- توقيع الـrequest
- حساب audit hash chain

## 6. Version Negotiation

client MAY  `Accept-AEP: 0.1, 0.2` HTTP header.  
server MUST    .
: `400 Unsupported-AEP-Version`.

## 7. Security Constraints

1. server MUST   envelope   1 MiB inline.
2. server MUST   protocol metadata  user content (: `006-error.md §Protocol/Data Separation`).
3. server MUST     authority  input tampering.
4. server MUST   nonce  `mode=sensitive` (request signing).

## 8. Open Questions (للنقاش في 0.2)

- CBOR binary encoding (مرجع `profiles/edge.md`).
- WebSocket transport profile.
- Batch requests (multiple envelopes في POST واحد).
