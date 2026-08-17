# AEP TypeScript SDK

> **Models propose. Policies authorize. AEP executes.**

AEP  TypeScript.

## التركيب

```bash
cd sdk/typescript
npm install
npm run build
```

## التشغيل السريع

### 1) استخدام مباشر (بدون HTTP)

```ts
import { AEPServer, BUILTIN_CAPABILITIES } from "@aep/sdk";

const server = new AEPServer();
for (const c of BUILTIN_CAPABILITIES) server.capability(c);

const response = await server.execute({
  aep: "0.1",
  id: "req_1",
  type: "execute",
  principal: { type: "user", id: "alice" },
  capability: { id: "math.add" },
  input: { a: 2, b: 3 },
});

console.log(response.output); // { result: 5 }
```

### 2) HTTP Server + Client

```ts
// server.ts
import { AEPServer, BUILTIN_CAPABILITIES } from "@aep/sdk";

const server = new AEPServer();
for (const c of BUILTIN_CAPABILITIES) server.capability(c);
await server.listen({ port: 8080 });
```

```ts
// client.ts
import { AEPClient } from "@aep/sdk";

const client = new AEPClient({ baseUrl: "http://localhost:8080" });
const r = await client.execute("math.add", { a: 2, b: 3 });
console.log(r.output); // { result: 5 }
```

### 3) CLI

```bash
# تشغيل الخادم
npx tsx src/cli.ts serve --port 8080

# في طرفية أخرى
npx tsx src/cli.ts discover --level 2
npx tsx src/cli.ts inspect math.add
npx tsx src/cli.ts execute math.add '{"a":2,"b":3}'
npx tsx src/cli.ts execute github.issue.create \
  '{"repository":"acme/project","title":"bug"}' --dry-run

# conformance tests
npx tsx src/cli.ts conformance
```

## API

### AEPServer

```ts
class AEPServer {
  registry: CapabilityRegistry;
  events: EventEmitter;
  artifacts: ArtifactManager;
  audit: AuditEngine;
  policy: PolicyEngine;
  risk: RiskEngine;

  constructor(opts?: AEPServerOptions);
  capability(def: CapabilityDefinition): this;
  execute(request: AEPRequest): Promise<AEPResponse>;
  listen(opts?: { port?: number; host?: string }): Promise<void>;
  close(): Promise<void>;
}
```

#### AEPServerOptions

```ts
interface AEPServerOptions {
  artifactsDir?: string;
  defaultTimeoutMs?: number;
  policies?: PolicyDocument[];
  environment?: "test" | "staging" | "production";
  autoApprove?: boolean;
}
```

#### CapabilityDefinition

```ts
interface CapabilityDefinition {
  id: string;                    // "github.issue.create"
  version: string;               // "1.0.0"
  kind: CapabilityKind;          // action | read | query | search | ...
  description: string;
  input: { schema: object };     // JSON Schema
  output: { schema: object };    // JSON Schema
  execution: ExecutionSemantics;
  risk: RiskAssessment;
  authorization?: AuthorizationSpec;
  cost?: { currency?: string; estimated?: number };
  performance?: { p50_ms?: number; p95_ms?: number };
  semantic_class?: string;       // for equivalence — "issue.creation"
  compensation?: string;         // inverse capability id
  provider?: { id: string; version?: string };
  region?: string;
  examples?: unknown[];
  execute: CapabilityHandler;    // (ctx) => Promise<ExecutionResult>
}
```

### AEPClient

```ts
class AEPClient {
  constructor(opts: { baseUrl: string; token?: string; defaultTimeoutMs?: number });
  send(request: AEPRequest): Promise<AEPResponse>;
  execute(capabilityId: string, input: unknown, opts?): Promise<AEPResponse>;
  discover(query?: DiscoveryQuery): Promise<unknown>;
  getExecution(id: string): Promise<unknown>;
  cancel(executionId: string): Promise<unknown>;
  subscribeEvents(onEvent: (e: unknown) => void, opts?): () => void;
}
```

## Endpoints (HTTP Profile)

| Method | Path | الوصف |
|---|---|---|
| GET | `/.well-known/aep` | Discovery metadata |
| POST | `/aep` | Execute / discover / cancel / resume / subscribe / approve |
| GET | `/aep/capabilities` | List (Level 1) |
| GET | `/aep/capabilities/{id}` | Inspect (Level 4) |
| GET | `/aep/executions/{id}` | Get execution state |
| POST | `/aep/executions/{id}/cancel` | Cancel execution |
| POST | `/aep/executions/{id}/resume` | Resume paused execution |
| GET | `/aep/artifacts/{id}` | Download artifact |
| GET | `/aep/events/stream` | SSE event stream |

## Content Types

- `application/aep+json` — Envelope
- `application/aep-event+json` — Events
- (مستقبلاً) `application/aep+cbor`

## Conformance Suite

```bash
npx tsx src/cli.ts conformance
```


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
| **المجموع** | **46** |

## أمثلة

| المثال | الوصف |
|---|---|
| `examples/01-simple-capability.ts` | تعريف capability وتنفيذها |
| `examples/02-workflow.ts` | workflow متعدد الخطوات مع parallel و compensation |
| `examples/03-provider-equivalence.ts` | provider interchangeability |
| `examples/04-policy-risk-approval.ts` | policy + risk + approval |
| `examples/05-http-server-client.ts` | HTTP server + client E2E |


```bash
npx tsx examples/01-simple-capability.ts
```

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

## Modules

### Core
- `core/types.ts` — كل الأنواع الأساسية
- `core/canonical.ts` — canonicalization + fingerprint + auditHash
- `core/semver.ts` — SemVer matcher (exact / caret / tilde / range / OR / star)
- `core/validator.ts` — ajv-based JSON schema validator
- `core/registry.ts` — Capability Registry + Discovery

### Execution
- `execution/state-machine.ts` — Execution State Machine
- `execution/idempotency.ts` — Idempotency Cache (TTL + GC)
- `execution/engine.ts` — Execution Engine (lifecycle)

### Policy & Risk
- `policy/engine.ts` — Policy Engine (rules + glob matching + deny-override)
- `policy/risk.ts` — Risk Engine (dynamic) + Blast Radius Estimator

### Workflow
- `workflow/engine.ts` — Workflow Engine (graph + saga + budget + conditions + retry)

### Events & Artifacts & Audit
- `events/emitter.ts` — Event Emitter + Subscriptions + Replay + Backpressure
- `events/artifacts.ts` — Artifact Manager (disk persistence + SHA-256)
- `events/audit.ts` — Audit Engine (tamper-evident hash chain)

### Gateway
- `gateway/http.ts` — HTTP Profile Server
- `gateway/client.ts` — HTTP Client

### High-level
- `server.ts` — AEPServer API
- `cli.ts` — CLI
- `providers/builtin.ts` — 9 built-in capabilities
- `conformance/runner.ts` — Conformance Suite

## الـState Machine

```
CREATED → PLANNED → AUTHORIZED → QUEUED → RUNNING
                                              ↓
                            PAUSED ←─→ RUNNING
                                              ↓
                            RETRYING → RUNNING
                                              ↓
                            COMPENSATING → COMPLETED
                                              ↓
                            CANCELLING → CANCELLED
                                              ↓
                                          FAILED
                                          EXPIRED
```

## المسار الكامل للتنفيذ

```
Request
  ↓
Validate Envelope
  ↓
Discover Capability (via Registry)
  ↓
Validate Version (SemVer)
  ↓
Idempotency Check (Cache lookup)
  ↓
Create Execution Record (state: created)
  ↓
Plan (state: planned)
  ↓
Policy Decision (allow / deny / approval / constrain)
  ↓
Risk Assessment (dynamic: env + input)
  ↓
Approval if required (awaiting_approval)
  ↓
Authorize + Queue (state: queued)
  ↓
Run Capability (state: running)
  ↓
Validate Input Schema
  ↓
Execute Handler
  ↓
Validate Output Schema
  ↓
Check Budget
  ↓
Complete (state: completed)
  ↓
Emit Events (audit + execution.*)
  ↓
Update Idempotency Cache
  ↓
Return Response
```

## الأنواع الأساسية

```ts
// Principal
type PrincipalType = "user" | "agent" | "service" | "system";
interface Principal {
  type: PrincipalType;
  id: string;
  tenant_id?: string;
  delegation_chain?: string[];
}

// Capability Reference
interface CapabilityRef {
  id: string;              // "github.issue.create"
  version?: string;       // "^1.0", "~1.2.3", "*"
}

// Request
interface AEPRequest {
  aep: "0.1";
  id: string;
  type: "execute" | "discover" | "cancel" | "resume" | "subscribe" | "approve";
  principal?: Principal;
  capability?: CapabilityRef;
  input?: unknown;
  execution?: {
    mode?: "sync" | "async" | "streaming";
    idempotency_key?: string;
    deadline?: string;
    dry_run?: boolean;
    timeout_ms?: number;
    max_retries?: number;
  };
  budget?: Budget;
  trace?: TraceContext;
  delegation?: { delegation_chain?: string[]; parent_execution_id?: string };
}

// Response
interface AEPResponse {
  aep: "0.1";
  id: string;
  status: "accepted" | "completed" | "error" | "approval_required" | "partial";
  execution?: { id: string; state: ExecutionState };
  output?: unknown;
  artifacts?: string[];
  error?: AEPError;
  approval?: ApprovalObject;
}
```

## Error Model

```ts
interface AEPError {
  code: ErrorCode;        // 26 typed codes
  message: string;
  retryable: boolean;
  retry_after_ms?: number;
  recovery?: ("retry" | "fallback" | "reauthorize" | "ask_user" | "compensate" | "abort")[];
  details?: Record<string, unknown>;
  trace_id?: string;
  execution_id?: string;
}
```

:  `spec/005-errors.md`  `core/types.ts`.

## License

MIT
