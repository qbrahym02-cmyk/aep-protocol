# AEP 008 — Idempotency

**Status:** AEP Core 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Overview

idempotency      ( timeout network failure retry)   side effect .

## 2. Idempotency Key

```json
{
  "execution": {
    "idempotency_key": "payment-order-123"
  }
}
```

`idempotency_key` SHOULD  present  capability  `execution.idempotent: true`.  
server MUST  key  requests .

## 3. Match Window

idempotency entries  TTL (default 24h max 7d).  

1.  request key K →   `(K → execution_id, state, output, expires_at)`.
2. request  K   →   `execution_id` ** side effect**.
3.    → request  K  request .

## 4. State Transition Rules

| حالة الـentry الأصلي | رد الـserver للـretry |
|---|---|
| `running` | `accepted` + same `execution_id` + state=`running` |
| `completed` | `completed` + same `output` + same `artifacts` |
| `failed` | `error` + same `error` |
| (انتهت النافذة) | request جديد |

## 5. Validation Rules

1. server MUST  key  (case-sensitive).
2. server MUST  keys  `principal` + `tenant` ( cross-tenant).
3. server MUST   keys  capabilities .
4. server SHOULD  SHA-256 key   raw value.

## 6. Concurrency

request  key   :

- الـserver MAY يستخدم lock لمنع double-execution.
- الـserver MUST يضمن أن side effect يحدث مرة واحدة فقط.
- الـserver SHOULD يرجع `accepted` للطلب الثاني بدلاً من رفضه.

## 7. When NOT to Use Idempotency

- للـread-only capabilities (لا side effect → لا فائدة).
- للـcapabilities مع `execution.idempotent: false` (الـserver SHOULD يرفض الـkey).
- للأعمال التي تتطلب نتائج مختلفة في كل مرة (مثل UUID generation).

## 8. Security

idempotency entries MUST    tenants.  
server MUST   idempotency  principals  ( key  agent  = entries ).
