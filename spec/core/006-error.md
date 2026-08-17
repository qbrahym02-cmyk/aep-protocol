# AEP 005 — Errors

AEP **typed**.  error     retry  recovery.

---

## Error Object

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Provider rate limit exceeded",
    "retryable": true,
    "retry_after_ms": 2500,
    "recovery": ["retry", "use_alternative_provider"],
    "details": {
      "provider": "github",
      "limit": 5000,
      "remaining": 0,
      "reset_at": "2026-08-17T12:00:00Z"
    },
    "trace_id": "trace_01",
    "execution_id": "exec_42"
  }
}
```

### الحقول

| الحقل | إجباري | الوصف |
|---|---|---|
| `code` | ✓ | كود موحد من قائمة محددة |
| `message` | ✓ | رسالة بشرية واضحة |
| `retryable` | ✓ | هل retry آمن؟ |
| `retry_after_ms` | ✓ عند retryable | زمن الانتظار المقترح |
| `recovery` | | قائمة بدائل: retry, fallback, reauthorize, ask_user, compensate, abort |
| `details` | | معطيات إضافية typed |
| `trace_id` | | للربط مع الـtrace |
| `execution_id` | | للربط مع الـexecution |

---

## الأكواد الموحدة

### Client Errors (4xx equivalent)

| Code | السبب | retryable |
|---|---|---|
| `INVALID_REQUEST` | Envelope غير صالح | no |
| `INVALID_CAPABILITY` | مرجع capability غير صالح | no |
| `CAPABILITY_NOT_FOUND` | الـcapability غير مسجلة | no |
| `CAPABILITY_VERSION_UNSUPPORTED` | الإصدار غير مدعوم | no |
| `UNAUTHORIZED` | لا يوجد token أو غير صالح | no |
| `FORBIDDEN` | الـprincipal ليس له الصلاحية | no |
| `APPROVAL_REQUIRED` | العملية تحتاج موافقة | no |
| `APPROVAL_EXPIRED` | الموافقة انتهت | no |
| `POLICY_DENIED` | السياسة ترفض | no |
| `RISK_TOO_HIGH` | مستوى الخطر أعلى من المسموح | no |
| `RESOURCE_NOT_FOUND` | المورد غير موجود | no |
| `RESOURCE_CONFLICT` | تعارض في المورد | maybe |
| `SCHEMA_VALIDATION_FAILED` | input لا يطابق schema | no |
| `CONCURRENCY_CONFLICT` | تغير resource_version | yes |
| `DELEGATION_DENIED` | تجاوز الـchild صلاحية الـparent | no |
| `TOKEN_EXPIRED` | الـcapability token انتهى | no |
| `BUDGET_EXCEEDED` | تجاوز الحد المالي/الزمني | no |
| `EXECUTION_CANCELLED` | أُلغي التنفيذ | no |
| `EXECUTION_EXPIRED` | انتهى deadline | no |

### Server/Provider Errors (5xx equivalent)

| Code | السبب | retryable |
|---|---|---|
| `RATE_LIMITED` | تجاوز حد المعدل | yes |
| `TIMEOUT` | انتهى المهلة | yes |
| `PROVIDER_UNAVAILABLE` | الـprovider غير متاح | yes |
| `CHECKPOINT_NOT_FOUND` | checkpoint مفقود | no |
| `COMPENSATION_FAILED` | فشلت المعالجة التعويضية | maybe |
| `INTERNAL_ERROR` | خطأ داخلي | yes |

---

## Recovery Suggestions

```text
retry            —    retry_after_ms
fallback         —  provider 
reauthorize      —  token 
ask_user         —
compensate       —  side effect 
abort            —
```

Client/Runtime   Policy —   recovery    .

---

## مثال: RATE_LIMITED

```json
{
  "aep": "0.1",
  "id": "req_42",
  "status": "error",
  "error": {
    "code": "RATE_LIMITED",
    "message": "GitHub API rate limit exceeded",
    "retryable": true,
    "retry_after_ms": 2500,
    "recovery": ["retry", "use_alternative_provider"],
    "details": {
      "provider": "github",
      "remaining": 0,
      "reset_at": "2026-08-17T12:00:00Z"
    }
  }
}
```

---

## مثال: APPROVAL_REQUIRED

```json
{
  "aep": "0.1",
  "id": "req_42",
  "status": "approval_required",
  "approval": {
    "approval_id": "ap_01",
    "reason": "Production deployment requires human approval",
    "risk": "critical",
    "expires_at": "2026-08-17T12:30:00Z",
    "allowed_decisions": ["approve", "deny", "approve_with_constraints"]
  },
  "execution": {
    "id": "exec_42",
    "state": "awaiting_approval"
  }
}
```

client  decision:

```http
POST /aep/approvals/ap_01
Content-Type: application/aep+json

{
  "decision": "approve_with_constraints",
  "constraints": {
    "environment": "staging",
    "max_records": 1000
  }
}
```

---

## مثال: BUDGET_EXCEEDED

```json
{
  "error": {
    "code": "BUDGET_EXCEEDED",
    "message": "Workflow exceeded max_cost_usd budget",
    "retryable": false,
    "details": {
      "budget_max_usd": 2,
      "budget_used_usd": 2.05,
      "step": "tests"
    },
    "recovery": ["abort"]
  }
}
```

---

## مثال: POLICY_DENIED

```json
{
  "error": {
    "code": "POLICY_DENIED",
    "message": "Research agents cannot perform payment operations",
    "retryable": false,
    "details": {
      "decision": "deny",
      "reason_code": "PRINCIPAL_NOT_ALLOWED",
      "matched_rules": ["research-agent-restrictions-v3"],
      "principal": "agent.researcher",
      "capability": "payment.charge"
    }
  }
}
```

---

## مثال: DELEGATION_DENIED

```json
{
  "error": {
    "code": "DELEGATION_DENIED",
    "message": "Child agent requested capability outside parent scope",
    "retryable": false,
    "details": {
      "parent_principal": "agent.researcher",
      "child_principal": "agent.research.sub",
      "requested_capability": "database.drop_table",
      "parent_scopes": ["db.read"]
    }
  }
}
```

---

## Error → State

error runtime  execution   :

| Error | State |
|---|---|
| `APPROVAL_REQUIRED` | `AWAITING_APPROVAL` |
| `EXECUTION_CANCELLED` | `CANCELLED` |
| `EXECUTION_EXPIRED` | `EXPIRED` |
| retryable error أثناء RUNNING | `RETRYING` |
| non-retryable error | `FAILED` |
| `COMPENSATION_FAILED` | `FAILED` |

---

## Boundary: Protocol vs Data vs Provider


```text
Protocol metadata != user content != provider data
```

(user content, provider response)       protocol instruction. parser     .
