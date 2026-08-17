# AEP Governance

## Project Structure

AEP is governed as an open protocol, not a single-vendor project.

## Roles

| Role | Responsibility |
|---|---|
| Spec Maintainer | Owns the protocol specification, approves RFCs |
| Runtime Maintainer | Owns the reference implementation (TypeScript SDK) |
| Security Officer | Owns threat model, security review, vulnerability disclosure |
| Conformance Officer | Owns test vectors, certification, compatibility |
| SDK Maintainer | Owns language-specific SDK (Python, Rust, Go) |

## RFC Process

1. **Draft** — Open an issue with `[RFC]` prefix describing the proposed change
2. **Discussion** — 30-day public comment period
3. **Implementation** — PR with code + tests + spec changes
4. **Review** — Two maintainers must approve
5. **Merge** — If approved, merged into spec + reference implementation

## Versioning Policy

```
AEP 1.0.x — Patch (bug fixes, no breaking changes)
AEP 1.x.0 — Minor (new features, backward compatible)
AEP x.0.0 — Major (breaking changes, requires RFC)
```

## Breaking Change Policy

Breaking changes require:
1. RFC with migration guide
2. 6-month deprecation period
3. Conformance suite update
4. All certified implementations must update within 6 months

## Security Disclosure

1. Report vulnerabilities privately to: security@aep.dev (PGP key TBD)
2. Maintain 90-day disclosure deadline
3. Fix released before public disclosure
4. CVE assigned if applicable

## Compatibility Guarantees

- 1.x clients work with 1.x+1 servers
- 1.x+1 clients degrade gracefully with 1.x servers
- Test vectors are immutable contracts
- Canonicalization algorithm is frozen

## Working Groups

| WG | Scope |
|---|---|
| Core Protocol | Envelope, canonicalization, state machine, errors |
| Security | Authentication, authority, policy, risk, approval |
| Persistence | Store interfaces, adapters (SQLite, PostgreSQL, Redis) |
| Workflow | DAG, compensation, checkpoints, plan/proof |
| Provider Ecosystem | Provider SDK, MCP adapter, provider mesh |
| Conformance | Test vectors, certification, cross-language |
