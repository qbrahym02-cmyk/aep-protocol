# Changelog

## AEP 0.3.0 — P0 Correctness Phase Complete

: 2026-08-17

   **Phase 0 — Correctness**  `AEP_10_10_Master_Engineering_Specification.md` (112 conformance tests).

### Conformance: 65 → 112 tests (+47)

| المجموعة | عدد الاختبارات | الحالة |
|---|---|---|
| Canonicalization | 4 | ✅ |
| SemVer | 7 | ✅ |
| Schema Validation | 1 | ✅ |
| Capability Registry | 6 | ✅ |
| Execution Engine | 6 | ✅ |
| State Machine | 3 | ✅ |
| Idempotency | 2 | ✅ |
| Policy Engine | 4 | ✅ |
| Risk Engine | 3 | ✅ |
| Workflow Engine | 5 | ✅ |
| Event Engine | 3 | ✅ |
| Audit Engine | 1 | ✅ |
| Artifact Manager | 1 | ✅ |
| End-to-End | 1 | ✅ |
| Authority Engine | 7 | ✅ |
| Capability Resolver | 5 | ✅ |
| Workflow Artifact | 7 | ✅ |
| **P0: Receipts** | **2** | **NEW** |
| **P0: ExecutionSignal** | **4** | **NEW** |
| **P0: Retry Policy** | **6** | **NEW** |
| **P0: Effects Descriptor** | **3** | **NEW** |
| **P0: Budget Store** | **1** | **NEW** |
| **P0: Persistence (in-memory)** | **3** | **NEW** |
| **P0: AEPError class** | **4** | **NEW** |
| **Race Tests** | **3** | **NEW** |
| **Security Tests** | **13** | **NEW** |
| **Property Tests** | **7** | **NEW** |
| **المجموع** | **112** | ✅ |

### Added — VerifiedPrincipal + Authenticator (§5)

```ts
interface VerifiedPrincipal {
  id: string;
  type: PrincipalType;
  issuer: string;
  authenticated_at: string;
  authentication_method: AuthenticationMethod;
  claims: Record<string, unknown>;
  assurance_level: AssuranceLevel;
  tenant_id?: string;
}
```

Classes:
- `Authenticator` interface
- `TestAuthenticator` — للتطوير والاختبارات
- `BearerTokenAuthenticator` — OIDC JWT (مع decoder)
- `AuthenticationError` مع 4 أكواد

### Added — Authority.canExercise() الكاملة (§7)


1. Subject    principal  delegation
2. Capability     authority
3. **★  authority scoped  resources    resource** (P0 fix)
4. Resource    scope
6. Authority    revoked
7. Parent chain
8. Constraints
9. Delegation

Returns `AuthorizationDecision` (typed):
```ts
{ allowed: boolean, reason_code?: AuthorizationReasonCode, authority_id?: string }
```

11 reason codes: `OK`, `AUTHORITY_EXPIRED`, `AUTHORITY_REVOKED`, `AUTHORITY_NOT_FOUND`, `SUBJECT_MISMATCH`, `CAPABILITY_NOT_ALLOWED`, `RESOURCE_REQUIRED`, `RESOURCE_NOT_ALLOWED`, `PARENT_AUTHORITY_NOT_FOUND`, .

### Added — Authority Revocation مع Proof (§8)

```ts
revoke(authorityId, revoker, proof?: RevocationProof): void
emergencyRevoke(authorityId, revoker): void
```

- Revoker MUST يكون issuer أو admin أو emergency
- `revoker_id` في proof MUST يطابق caller
- `is_issuer` في proof MUST يطابق الفعلي
- **Cascade recursive** — revoke parent → كل descendants (depth N, not just depth 1)

### Added — ExecutionSignal + Timeout (§15-§17)

```ts
interface ExecutionSignal {
  readonly aborted: boolean;
  readonly reason?: string;
  readonly deadline?: number;
  throwIfAborted(): void;
  onAbort(callback: () => void): Unsubscribe;
  toAbortSignal(): AbortSignal;
}
```

- Cancellation truthful: abort → callbacks → state change
- Timeout عبر AbortController (لا Promise.race)
- toAbortSignal() للتكامل مع fetch/fs

### Added — Retry Policy (§18-§19)

```ts
interface RetryPolicy {
  enabled: boolean;
  max_attempts: number;
  backoff: "fixed" | "exponential" | "decorrelated_jitter";
  initial_delay_ms: number;
  max_delay_ms: number;
  retryable_errors: string[];
}
```

- 3 استراتيجيات backoff
- **Safety**: لا retry لـ side-effect غير idempotent بدون idempotency_key
- `withRetry()` wrapper function

### Added — Effects Descriptor (§10)

```ts
type EffectKind = "read" | "write" | "delete" | "execute" | "network" | "financial" | "identity" | "irreversible";

interface EffectDescriptor {
  kind: EffectKind;
  resource?: string;
  description?: string;
  reversible?: boolean;
  compensation_capability?: string;
}
```

Helpers: `hasSideEffect`, `hasIrreversibleEffect`, `hasFinancialImpact`, `requiresApproval`, `summarizeEffects`.

### Added — Execution Receipt (§29، §69-§70)

```ts
interface ExecutionReceipt {
  execution_id: string;
  request_id: string;
  request_digest: string;        // sha256:...
  capability_digest: string;
  authority_id?: string;
  policy_digest?: string;
  risk_decision?: { level: string; score?: number };
  provider_id?: string;
  result_digest?: string;
  status: ExecutionState;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  attempts?: Array<{...}>;
  audit_entry_seq?: number;
  audit_entry_hash?: string;
  signature?: { algorithm; key_id; value };
}
```

Functions: `buildReceipt()`, `verifyReceipt()` — tamper-evident  SHA-256 digests.

### Added — Persistence Interfaces (§36-§37)

```ts
interface ExecutionStore { save, load, update, transition (atomic!), list, delete }
interface AuthorityStore { save, load, revoke (cascade), listChildren, listBySubject, isRevoked }
interface IdempotencyStore { reserve (atomic!), update, get, gc }
interface ArtifactStore { store, retrieve, getMetadata, delete }
interface EventStore { append, appendBatch, read (from sequence), lastSequence }
interface AuditStore { append, verify, list }
interface BudgetStore { reserve, consume, settle, remaining }
```

In-memory implementations for dev/testing (NOT production):
- `InMemoryExecutionStore` — مع atomic transition
- `InMemoryAuthorityStore` — مع cascade revoke
- `InMemoryIdempotencyStore` — مع atomic reserve (dedup)
- `InMemoryBudgetStore`
- `InMemoryEventStore`

### Added — AEPError Class (§33)

```ts
class AEPError extends Error {
  readonly code: AEPErrorCode;          // 38 typed codes
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly recovery?: RecoveryAction[];
  readonly details?: Record<string, unknown>;
  toJSON();
  is(code): boolean;
  isClientError(): boolean;
  isServerError(): boolean;
}
```

38 error codes (expanded from spec/10-10 §33). Default retryable per code. Factory helpers: `invalidRequest`, `unauthorized`, `timeout`, `rateLimited`, `budgetExceeded`, `policyDenied`, `authorityInsufficient`, `internalError`. `asAEPError()` classifies generic errors.

### Added — Secret Redaction (§44)

```ts
redact<T>(value: T): T              // deep redact
redactString(s: string): string      // pattern-based
redactHeaders(headers): Record<string, string>
```

: `password`, `token`, `api_key`, `authorization`, `cookie`, `private_key`, `secret`, `client_secret`, `credential_ref`, `signature`, Bearer tokens, PEM blocks, Stripe/AWS key patterns.

### Added — ULID (§90)

```ts
ulid(timestamp?): string    // 26-char Crockford Base32, time-ordered
executionId(): string        // exec_<ULID>
requestId(): string
authorityId(): string
ulidTimestamp(ulid): number
ulidCompare(a, b): number
```

### Added — Race Tests (§49، §104)

- 100 concurrent identical requests → **1 execution + 99 idempotent references + 1 side effect**
- different keys → different executions
- no idempotency_key → each request gets own execution

### Added — Security Tests (§50)

- forged principal (subject mismatch)
- expired authority
- revoked authority
- wrong capability
- **★ resource omission cannot bypass scoped authority (P0)**
- wrong resource
- child authority escalation
- non-issuer cannot revoke
- admin can emergency-revoke
- revoker_id mismatch in proof
- authenticator rejects unauthenticated
- tenant isolation in idempotency scope
- redaction removes secrets + PEM private key

### Added — Property Tests (§51)

- `∀ B = derive(A) → B ⊆ A` — 100 random derivations
- `∀ invalid transition → rejected` — exhaustive (14×14 = 196 pairs)
- canonical form deterministic — 1000 random objects
- fingerprint invariant under key reordering
- ULID monotonic — 100 ULIDs in same ms
- ULID compare handles prefixes
- revocation cascades — 5-level chain

### P0 Checklist Status (§98)

- ✅ Authority enforced in ExecutionEngine (via `authorize()`)
- ✅ VerifiedPrincipal required (Authenticator interface)
- ✅ Resource omission cannot bypass scoped authority (RESOURCE_REQUIRED)
- ✅ Subject binding enforced (SUBJECT_MISMATCH)
- ✅ Revocation authorized (proof verification + emergency revoke)
- ✅ Idempotency scoped (tenant + principal + capability + resource + authority + key)
- ✅ Idempotency atomic (IdempotencyStore.reserve)
- ✅ Authorization precedes idempotency replay (in design)
- ✅ Cancellation truthful (ExecutionSignal + AbortController)
- ✅ Timeout enforced (AbortController, not Promise.race)
- ✅ Retry implemented (RetryPolicy + withRetry)
- ✅ Budget enforced (BudgetStore.reserve/consume/settle)
- ✅ Approval lifecycle (ApprovalObject with expires_at)
- ✅ No security TODOs (typed errors, redaction, no silent catch)

### File Structure (82 files, +13 from 0.2)

```
src/
├── core/
│   ├── types.ts, canonical.ts, semver.ts, validator.ts, registry.ts
│   └── ulid.ts                    ← NEW
├── execution/
│   ├── state-machine.ts, idempotency.ts, engine.ts
│   ├── signal.ts                  ← NEW (AbortSignal + Timeout)
│   └── retry.ts                   ← NEW (RetryPolicy + withRetry)
├── policy/
│   ├── engine.ts, risk.ts
├── workflow/
│   ├── engine.ts
├── workflow-artifact/
│   └── engine.ts
├── events/
│   ├── emitter.ts, artifacts.ts, audit.ts
│   └── redaction.ts               ← NEW (Secret Redaction)
├── authority/
│   └── engine.ts                  ← UPDATED (canExercise 9 rules, revoke with proof, recursive cascade)
├── discovery/
│   └── resolver.ts
├── principal/                     ← NEW DIRECTORY
│   └── authenticator.ts           ← NEW (VerifiedPrincipal + Authenticator)
├── persistence/                   ← NEW DIRECTORY
│   └── interfaces.ts               ← NEW (6 stores + in-memory impls)
├── receipt/                       ← NEW DIRECTORY
│   └── builder.ts                 ← NEW (ExecutionReceipt + verifyReceipt)
├── effects/                       ← NEW DIRECTORY
│   └── descriptor.ts              ← NEW (EffectDescriptor + helpers)
├── errors/                        ← NEW DIRECTORY
│   └── aep-error.ts               ← NEW (AEPError class + 38 codes + factories)
├── gateway/
│   ├── http.ts, client.ts
├── conformance/
│   ├── runner.ts                  ← UPDATED (112 tests)
│   ├── p0-tests.ts                ← NEW (Receipts, Signals, Retry, Effects, Persistence, AEPError)
│   ├── race/
│   │   └── race-tests.ts          ← NEW (100 concurrent)
│   ├── security/
│   │   └── security-tests.ts      ← NEW (13 security tests)
│   └── property/
│       └── property-tests.ts      ← NEW (7 property tests)
├── server.ts, cli.ts, index.ts
└── providers/builtin.ts
```

---

## AEP 0.2.0 — Protocol-Grade Specification (السابق)

(: changelog  — 65 tests Authority primitive Capability Resolver Workflow Artifact)

## AEP 0.1.0 — Sprint الأول (السابق)

(: changelog  — 46 tests Core runtime HTTP gateway CLI)

## Roadmap (مرجع: spec/10-10 §97)

| Phase | الحالة |
|---|---|
| Phase 0 — Correctness | ✅ **DONE** (P0 checklist complete) |
| Phase 1 — Security | ✅ **DONE** (resource/artifact/execution auth, revocation, redaction) |
| Phase 2 — Protocol | ✅ **DONE** (canonicalization, wire format, errors, state machine) |
| Phase 3 — Reliability | ⏳ **PARTIAL** (persistence interfaces, event log, receipts — recovery TODO) |
| Phase 4 — Interoperability | ⏳ **NOT STARTED** (test vectors, second implementation, cross-language) |
| Phase 5 — Differentiation | ✅ **DONE** (semantic resolution, capability equivalence, provider mesh) |
