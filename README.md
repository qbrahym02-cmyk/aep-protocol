# AEP — Agent Execution Protocol

> **Models propose. Policies authorize. AEP executes.**

AEP    **protocol-grade**    .       **Capability Contracts** + **Authority Primitive**        Workflows Events Artifacts Delegation Provenance  Recovery.

AEP  MCP   . AEP  ** **:

```text
MCP:        capability
blast radius     provider
```

---

## الحالة

**AEP 0.2 — Protocol-Grade** (Sprint 1-8 covered **65 conformance tests**)

```
spec/
├── core/          (NORMATIVE — RFC 2119)
│   ├── 000-overview.md
│   ├── 001-principles.md
│   ├── 002-envelope.md           ← Formal Wire Spec
│   ├── 003-capability.md
│   ├── 004-execution.md           ← Formal State Machine Tables
│   ├── 005-result.md
│   ├── 006-error.md
│   ├── 007-handles.md
│   └── 008-idempotency.md
│
└── profiles/      (NORMATIVE — Extensions to Core)
    ├── authority.md               ← Authority primitive
    ├── discovery.md               ← Capability Resolution
    ├── workflow.md                ← Executable Artifact
    ├── security.md
    ├── policy.md
    ├── events.md
    ├── audit.md
    ├── agents.md
    ├── enterprise.md
    └── edge.md

schemas/             (JSON Schemas)
sdk/typescript/      (Reference implementation)
conformance/         (65 tests)
examples/            (release-v2.aep.json + 7 TS examples)
```

---

## المسار الأساسي

```text
Intent
  ↓
Capability Discovery (semantic resolution)
  ↓
Authority Verification (subject → authority → capability → resource)
  ↓
Planning
  ↓
Policy Decision (allow/deny/approval/constrain)
  ↓
Risk Analysis (dynamic: env + input + principal)
  ↓
Approval (if required)
  ↓
Execution (state machine)
  ↓
Events / Observability
  ↓
Recovery / Compensation (saga)
  ↓
Provenance (tamper-evident audit chain)
```

---

## التشغيل السريع

```bash
cd sdk/typescript
npm install
npm run build

# 1) conformance tests (65 tests)
npx tsx src/cli.ts conformance

# 2) HTTP server
npx tsx src/cli.ts serve --port 8080

# 3) في طرفية أخرى
npx tsx src/cli.ts discover --level 2
npx tsx src/cli.ts execute math.add '{"a":2,"b":3}'
npx tsx src/cli.ts execute github.issue.create '{"repository":"acme/x","title":"bug"}' --dry-run

# 4) Authority primitive
npx tsx src/cli.ts authority issue '{"type":"agent","id":"agent.deploy"}' 'deploy.*' --delegatable

# 5) Capability Resolution (intent → best capability)
npx tsx src/cli.ts resolve '{"intent":{"operation":"create_issue"},"constraints":{"risk_max":"medium"}}'

# 6) Workflow as Executable Artifact
npx tsx src/cli.ts workflow validate ../../examples/release-v2.aep.json
npx tsx src/cli.ts workflow plan ../../examples/release-v2.aep.json --input '{"version":"2.4.0"}'
npx tsx src/cli.ts workflow simulate ../../examples/release-v2.aep.json --input '{"version":"2.4.0"}'
npx tsx src/cli.ts workflow execute ../../examples/release-v2.aep.json --input '{"version":"2.4.0"}'
```

---

## الـ5 تحسينات الرئيسية في 0.2

### 1. Formal Wire Specification (RFC 2119)

 spec file  MUST / MUST NOT / SHOULD / MAY keywords . : `spec/core/002-envelope.md`.

### 2. Formal State Machine Tables

 transitions   `(Current, Event, Next, Side effect)`.  transition     `INVALID_STATE_TRANSITION`. : `spec/core/004-execution.md`.

### 3. Authority كـPrimitive حقيقي

 `Agent → Capability` :

```text
Agent
  ↓
Authority (subject + capabilities + resources + constraints + expires + delegatable)
  ↓
Capability
  ↓
Resource
```

Agent   request capability . Agent MUST  authority . child authority MUST  subset   parent.

```ts
const engine = new AuthorityEngine();
const parent = engine.issue({
  subject: { type: "agent", id: "agent.supervisor" },
  capabilities: ["deploy.*", "test.*"],
  resources: ["environment:staging"],
  constraints: { max_cost_usd: 10 },
  expires_at: "...",
  delegatable: true,
  issued_by: { type: "user", id: "alice" },
});

const child = engine.deriveTo(
  parent.id,
  { type: "agent", id: "agent.child" },
  { capabilities: ["deploy.staging"], constraints: { max_cost_usd: 5 } },
  { type: "agent", id: "agent.supervisor" }
);
// child ⊆ parent (strict subset rule)
```

### 4. Capability Resolution (Intent → Best Capability)

Agent     capability.  intent resolver   candidates   pipeline:

```
Semantic Match → Authority → Schema → Policy → Risk → Health → Cost → Latency → Rank
```

```ts
const resolver = new CapabilityResolver({ registry, authority: authEngine, policy, risk });
const result = resolver.resolve({
  principal: { type: "agent", id: "agent.research" },
  intent: { operation: "create_issue", description: "Create an issue" },
  constraints: { risk_max: "medium", latency_max_ms: 5000, cost_max_usd: 0.10 },
  authority: auth,
});
// result.matches[0] → { rank: 1, capability_id: "github.issue.create", score: 0.87, ... }
```

### 5. Workflow كـExecutable Artifact

- `validate` — التحقق من الصحة
- `plan` — إنتاج execution plan (topological + parallel groups)
- `simulate` — محاكاة بدون side effect (dry_run)
- `execute` — تنفيذ فعلي
- `replay` — إعادة بناء timeline من الأحداث

```bash
aep workflow validate release-v2.aep.json
aep workflow plan release-v2.aep.json --input '{"version":"2.4.0"}'
aep workflow simulate release-v2.aep.json --input '{"version":"2.4.0"}'
aep workflow execute release-v2.aep.json --input '{"version":"2.4.0"}'
```

: `examples/release-v2.aep.json`.

---

## الاستقلال عن MCP

AEP MUST NOT  :
- MCP wire format
- MCP lifecycle
- MCP session semantics
- MCP JSON-RPC assumptions
- MCP tool model
- MCP SDK

Adapter MCP  `AEP Core → Optional MCP Adapter`  .

## لا Lock-in قسري

AEP     .   :
- open spec + open SDK + portable workflows + portable authority
- huge capability ecosystem + conformance certification
- observability + provenance + provider mesh

---

## الـCore Modules

```
core/
types.ts              —
  canonical.ts          — canonicalization + fingerprint + auditHash
  semver.ts             — SemVer matcher
  validator.ts          — ajv-based JSON schema validator
  registry.ts           — Capability Registry + Discovery

execution/
  state-machine.ts      — Formal State Machine
  idempotency.ts        — Idempotency Cache
  engine.ts             — Execution Engine (lifecycle)

policy/
  engine.ts             — Policy Engine
  risk.ts               — Risk Engine + Blast Radius

workflow/
  engine.ts             — Workflow Engine (graph + saga + budget)

workflow-artifact/
  engine.ts             — Executable Workflow (validate/plan/simulate/execute/replay)

events/
  emitter.ts            — Event Emitter + Subscriptions + Replay + Backpressure
  artifacts.ts          — Artifact Manager
  audit.ts              — Audit Engine (tamper-evident hash chain)

authority/
  engine.ts             — Authority primitive (issue/verify/derive/revoke)

discovery/
  resolver.ts           — Capability Resolver (intent → best capability)

gateway/
  http.ts               — HTTP Profile Server
  client.ts             — HTTP Client

server.ts               — AEPServer high-level API
cli.ts                  — CLI (serve/discover/execute/authority/resolve/workflow)
providers/builtin.ts    — 9 built-in capabilities
conformance/runner.ts   — Conformance Suite (65 tests)
```

## Conformance Suite

```bash
npx tsx src/cli.ts conformance
```

**65 tests** :

| المجموعة | عدد الاختبارات |
|---|---|
| Canonicalization | 4 |
| SemVer | 7 |
| Schema Validation | 1 |
| Capability Registry | 6 |
| Execution Engine | 6 |
| State Machine | 3 |
| Idempotency | 2 |
| Policy Engine | 4 |
| Risk Engine | 3 |
| Workflow Engine | 5 |
| Event Engine | 3 |
| Audit Engine | 1 |
| Artifact Manager | 1 |
| End-to-End | 1 |
| **Authority Engine** | **7** |
| **Capability Resolver** | **5** |
| **Workflow Artifact** | **7** |
| **المجموع** | **65** |

## Built-in Capabilities

| id | kind | risk | الوصف |
|---|---|---|---|
| `math.add` | action | low | جمع رقمين |
| `math.multiply` | action | low | ضرب رقمين |
| `echo.ping` | read | low | echo + health check |
| `text.transform` | transform | low | uppercase/lowercase/reverse/base64 |
| `counter.inc` | action | low | counter stateful مع dry_run |
| `counter.get` | read | low | قراءة counter |
| `github.issue.create` | action | medium | mock GitHub issue |
| `linear.issue.create` | action | medium | mock Linear issue — مكافئة لـgithub |
| `payment.charge` | action | critical | mock payment charge |

## License

MIT —  `LICENSE`
