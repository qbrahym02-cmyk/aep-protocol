# Security Policy

## المبدأ المركزي

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

side effects  (:  144  ).

## الالتزامات

1. **Secure by default**:  side effect  authorization  risk metadata.
2. **Zero Trust**:  handle   authorization.  request  authorization .
3. **Capability Tokens**:   Agent API key .  token  capabilities  resources  budget.
4. **No secrets in prompts**:  `credential_ref`   `api_key`.
5. **Discoverable ≠ executable**:  capability    .

## التهديدات المغطاة (مرجع: قسم 114 من المواصفة)

| التهديد | التخفيف |
|---|---|
| Prompt injection | Least privilege + Policy + Approval + bounded execution |
| Capability poisoning | Contract fingerprint + Provider Manifest |
| Credential theft | credential_ref (no secrets in envelope) |
| Replay | idempotency_key + nonce + issued_at/expires_at |
| Confused deputy | Delegation chain non-escalating |
| Privilege escalation | DELEGATION_DENIED + deny-override |
| Data exfiltration | Resource scoping + Audit |
| SSRF | (Profile-specific — HTTP provider TODO) |
| Malicious provider | Provider Manifest + Sandboxing (TODO) |
| Event injection | typed events + envelope boundary |
| Artifact poisoning | checksum + provenance + access_policy |
| Supply chain | (Profile-specific — TODO) |

## الإبلاغ عن ثغرات

- لا تفتح Issue عام للثغرات الأمنية
- راسل: security@aep.dev (TODO — setup)
- PGP key: (TODO)

## ما يجب ألا تفعله

- لا تجعل LLM هو Policy Engine (قسم 143 من المواصفة)
- لا تجعل discovery يعادل authorization
- لا تخزن secrets في prompts
- لا تعتمد على session state مخفي
- لا تضيف كل feature إلى Core

## حدود الـSDK الحالي

**  production** :
2.  mTLS  OAuth profile
3.  Provider Manifest + Sandboxing
4.  Rate Limiting + Circuit Breaker 
5.  Fuzzing + Chaos (:  111 113)
