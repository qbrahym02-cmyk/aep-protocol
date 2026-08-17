# AEP Profile — Security

**Status:** AEP Profile 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Motivation

Security Profile : Identity, Authentication, Authorization (Policy), Risk, Approval, Audit.

Core    . Security  Profile.

## 2. The Central Security Path

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

## 3. Identity

```ts
interface Identity {
  type: "user" | "agent" | "service" | "system";
  id: string;
  tenant_id?: string;
  trust_level?: "restricted" | "trusted" | "privileged";
  attributes?: Record<string, string>;
}
```

execution MUST   identity.

## 4. Authentication (Profile-level)

Core    . Authentication methods  Profiles:

| Method | Use case |
|---|---|
| OAuth 2.1 | user agents, web flows |
| OIDC | federated identity |
| mTLS | service-to-service |
| Signed requests | high-security ops |
| Workload identity | cloud-native (SPIFFE) |
| API keys | simple (not recommended for production) |

server MUST   `authenticated` (identity verified)  `authorized` (allowed to do X).

## 5. Authorization (Policy Engine)

: `policy.md`.

## 6. Risk Engine

: `policy.md §Risk`.

## 7. Approval

: `policy.md §Approval`.

## 8. Audit

: `audit.md`.

## 9. Threat Model

server MUST :

| Threat | Mitigation |
|---|---|
| Prompt injection | Least privilege + bounded execution + Policy |
| Capability poisoning | Contract fingerprint + Provider Manifest |
| Credential theft | `credential_ref` instead of inline secrets |
| Replay | idempotency_key + nonce + timestamp window |
| Confused deputy | Delegation chain non-escalating |
| Privilege escalation | `DELEGATION_DENIED` + deny-override in Policy |
| Data exfiltration | Resource scoping + Audit + Data Classification |
| SSRF | (HTTP Provider Profile) domain allowlist + private IP blocking |
| Malicious provider | Provider Manifest + Sandboxing |
| Event injection | typed events + envelope boundary |
| Artifact poisoning | checksum + provenance + access_policy |
| Supply chain | (Profile) SBOM + signature + vulnerability scan |

## 10. Sandboxing

Providers   MAY  :

```text
container
microVM (Firecracker)
WASM sandbox
separate process with seccomp
```

- CPU quotas
- Memory limits
- Network allowlist
- Filesystem isolation
- Time budgets

## 11. Provider Manifest

```json
{
  "provider": {
    "id": "github",
    "version": "1.0"
  },
  "capabilities": ["github.issue.create", "github.issue.list"],
  "sandbox": {
    "filesystem": "none",
    "network": ["api.github.com"],
    "memory_mb": 128,
    "cpu_quota": 0.5
  },
  "signature": {
    "algorithm": "ed25519",
    "value": "...",
    "key_id": "k_github_release"
  }
}
```

server MUST   manifest   provider.

## 12. Secrets Management

Agents MUST   API secrets. :

```json
{ "input": { "api_key": "sk_xxx" } }  // 
```


```json
{ "input": { "credential_ref": "cred/github/prod" } }
```

server  `credential_ref` secret   sandbox .

## 13. Request Signing (for sensitive ops)

```json
{
  "signature": {
    "algorithm": "ed25519",
    "value": "<base64 of canonical envelope>",
    "key_id": "k_alice_42",
    "timestamp": "2026-08-17T12:00:00Z",
    "nonce": "n_xyz"
  }
}
```

server MUST  :
1. timestamp   5
2. nonce    (replay protection)

## 14. Step-up Authentication

```text
$10 payment    → no step-up
$1000 payment  → step-up (MFA required)
$100,000 payment → step-up + human approval
```

Policy  thresholds.

## 15. Zero Trust

 execution  authorization .  
 handle   authorization.  
cache authorization decisions SHOULD   (60s).
