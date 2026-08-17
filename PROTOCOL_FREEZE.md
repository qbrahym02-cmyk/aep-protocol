# Protocol Freeze — AEP 1.0

**Status:** FROZEN as of 2026-08-17  
**Version:** AEP 1.0.0  
**Scope:** This document defines what is frozen, what is allowed to change, and the policy for future evolution.

## What is Frozen

The following are **frozen** and **MUST NOT** have breaking changes without a major version bump (2.0):

### Wire Format
- `application/aep+json` content type
- Envelope shape (`aep`, `id`, `type`, `principal`, `capability`, `input`, `execution`, `budget`, `trace`)
- Response shape (`status`, `execution`, `output`, `artifacts`, `error`)
- Error object shape (`code`, `message`, `retryable`, `retry_after_ms`, `recovery`)

### Error Codes
All 38 error codes from `errors/aep-error.ts` are frozen. New codes may be added (minor version) but existing codes MUST NOT be removed or change semantics.

### State Machine
The 14-state execution state machine and its transition table (from `spec/core/004-execution.md`) are frozen. Transitions may only be added (never removed) in minor versions.

### Canonicalization Algorithm
- Lexicographic key sorting (recursive)
- Undefined values skipped
- No whitespace
- UTF-8 encoding
- SHA-256 for fingerprints

### Authority Algebra
- `child_authority ⊆ parent_authority` rule
- 9 authorization rules from `spec/profiles/authority.md`
- Recursive cascade revocation

### Test Vectors
All vectors in `conformance/vectors/vectors.ts` are frozen. New vectors may be added (minor version) but existing expected values MUST NOT change.

## Allowed Changes (Minor Versions, 1.x)

The following may change in 1.x without breaking the freeze:

- **Profiles**: New profiles may be added (Enterprise, Edge, etc.)
- **Adapters**: New storage adapters (PostgreSQL, Redis), new transports (WebSocket, QUIC)
- **Provider implementations**: New providers for existing capabilities
- **Discovery algorithms**: Improvements to ranking, semantic matching
- **Performance optimizations**: Internal refactors that preserve semantics
- **New error codes**: May be added (but existing codes' semantics preserved)
- **New state transitions**: May be added (but existing transitions preserved)
- **New test vectors**: May be added (but existing expected values preserved)

## Breaking Changes (Major Version 2.0+)

A major version bump is required for:
- Removing or renaming an error code
- Changing canonicalization output
- Changing state transition rules (removing existing transitions)
- Changing test vector expected values
- Removing envelope fields
- Changing AEP version string semantics

## Deprecation Policy

Features may be deprecated in minor versions (1.x) but MUST NOT be removed until 2.0:

1. **Deprecation notice** in CHANGELOG.md and the relevant spec file
2. **6-month grace period** minimum
3. **Alternative** provided in the same release
4. **Removal** only in next major version

## Version Negotiation

Clients SHOULD send `Accept-AEP: 1.0` header. Servers MUST respond with `AEP-Version: 1.0` header. If the client requests an unsupported version, the server responds with `400 Unsupported-AEP-Version`.

## Conformance Certification

A 1.0-compliant implementation MUST pass:
- All canonicalization vectors (12)
- All fingerprint vectors (12)
- All semver vectors (20)
- All state transition vectors (22)
- All audit chain vectors (1)
- All authority derivation vectors (6)
- All security tests (13)
- All race tests (3)
- All property tests (7)

Total: **96+ vectors** across TS, Python, Rust implementations.

## Reference Implementations

Three independent implementations are frozen at 1.0:
1. **TypeScript SDK** — `sdk/typescript/` (reference, most complete)
2. **Python SDK** — `sdk/python/` (conformance target)
3. **Rust SDK** — `sdk/rust/` (conformance target)

Cross-language interop verified via `scripts/cross-lang-interop-triple.ts`.

## Stability Commitments

1. **No silent breaking changes** — all breaking changes are versioned and announced
2. **Backward compatibility** — 1.x clients work with 1.x+1 servers
3. **Forward compatibility** — 1.x+1 clients can degrade gracefully with 1.x servers
4. **Test vector stability** — existing vectors are immutable contracts

## Governance

Changes to frozen items require:
1. AEP Improvement Proposal (AEP-IP)
2. Two independent implementation leads' approval
3. 30-day public review period
4. Conformance suite update

## Effective Date

This freeze is effective **2026-08-17** and applies to all 1.x releases.
