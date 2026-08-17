# AEP Profile — Workflow (Executable Artifact)

**Status:** AEP Profile 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Motivation

Workflow    **Executable Artifact** —  :
- `validate` — التحقق من الصحة
- `simulate` — محاكاة بدون side effect
- `plan` — إنتاج execution plan
- `execute` — تنفيذ فعلي
- `replay` — إعادة بناء لأغراض debugging

## 2. Workflow File Format

YAML  JSON   `.aep.yaml`  `.aep.json`.

### 2.1 Example

```yaml
# release-v2.aep.yaml
name: release-v2
version: 1.0.0
description: Autonomous software release workflow
author: alice@example.com

inputs:
  - name: version
    type: string
    required: true
    description: "Version to release"
  - name: skip_tests
    type: boolean
    default: false

authority:
  required_capabilities:
    - app.build
    - security.scan
    - test.run
    - deploy.staging
    - deploy.production
  required_resources:
    - environment:staging
    - environment:production
  constraints:
    max_duration_ms: 1800000
    max_cost_usd: 20

budget:
  max_cost_usd: 5
  max_calls: 30
  max_duration_ms: 600000
  max_parallel: 4

defaults:
  retry: { max_attempts: 2, backoff_ms: 500 }
  on_failure: fail

nodes:
  - id: build
    capability: app.build
    inputs:
      commit: "${inputs.version}"
    timeout_ms: 120000

  - id: security
    capability: security.scan
    depends_on: [build]
    inputs:
      artifact: "${build.output.artifact_id}"
    on_failure: fail

  - id: tests
    capability: test.run
    depends_on: [build]
    condition: "${!inputs.skip_tests}"
    inputs:
      artifact: "${build.output.artifact_id}"
    on_failure: fail

  - id: deploy_staging
    capability: deploy.staging
    depends_on: [security, tests]
    inputs:
      artifact: "${build.output.artifact_id}"
    on_failure: compensate
    compensation: deploy.rollback

  - id: smoke_test
    capability: test.smoke
    depends_on: [deploy_staging]
    timeout_ms: 60000

  - id: approval_gate
    kind: approval
    depends_on: [smoke_test]
    reason: "Production deployment requires human approval"
    expires_in: 30m
    allowed_decisions: [approve, deny, approve_with_constraints]

  - id: deploy_production
    capability: deploy.production
    depends_on: [approval_gate]
    inputs:
      artifact: "${build.output.artifact_id}"
    on_failure: compensate
    compensation: deploy.rollback
```

## 3. Required Fields

| Field | Required | Semantics |
|---|---|---|
| `name` | MUST | workflow identifier |
| `version` | MUST | semver |
| `inputs` | SHOULD | input schema |
| `authority` | SHOULD | authority requirements |
| `budget` | SHOULD | workflow budget |
| `nodes` | MUST | execution graph nodes |

## 4. Node Schema

```ts
interface WorkflowNodeSpec {
  id: string;                   // unique within workflow
  capability: string;           // capability id (or "kind: approval" for approval nodes)
  version?: string;
  inputs?: Record<string, any>; // static or ${expression}
  depends_on?: string[];
  condition?: string;           // boolean expression
  on_failure?: "fail" | "skip" | "compensate" | "retry";
  retry?: { max_attempts: number; backoff_ms: number };
  timeout_ms?: number;
  compensation?: string;        // capability id for saga undo
  approval?: {
    reason: string;
    expires_in: string;
    allowed_decisions: string[];
  };
}
```

## 5. Expression Language

expressions  `${...}` MUST   context:

| Variable | Description |
|---|---|
| `${inputs.X}` | workflow input |
| `${node_id.output.X}` | output of previous node |
| `${node_id.state}` | state of previous node |
| `${workflow.id}` | workflow execution id |
| `${budget.remaining}` | remaining budget |

Examples:
- `${inputs.version}`
- `${build.output.artifact_id}`
- `${!inputs.skip_tests}` (negation)
- `${count > 0 ? 'yes' : 'no'}` (ternary — TODO in 0.2)

## 6. Operations

### 6.1 `validate`

```bash
aep workflow validate release-v2.aep.yaml
```

server MUST  :
1. syntax 
2.  `node.id` 
3.  `depends_on`   node
4.  cycles (topological sort)
5.  `capability`   registry
6.  `inputs`  `capability.input.schema`
7. `authority.required_capabilities`   `node.capability`

server MUST :

```json
{
  "valid": true,
  "warnings": ["Node 'tests' has no timeout_ms — defaulting to 30s"],
  "errors": []
}
```

### 6.2 `simulate`

```bash
aep workflow simulate release-v2.aep.yaml --input '{"version":"2.4.0"}'
```

server MUST:
1.  workflow
2.   authority
3.   node  `dry_run: true` mode
4.    side effect
5.  execution plan + estimated costs

```json
{
  "would_execute": ["build", "security", "tests", "deploy_staging", "smoke_test", "deploy_production"],
  "would_skip": [],
  "estimated_cost_usd": 0.15,
  "estimated_duration_ms": 180000,
  "blast_radius": {
    "resources": 4,
    "services": 2,
    "financial_exposure": 0
  },
  "approvals_required": ["approval_gate"]
}
```

### 6.3 `plan`

```bash
aep workflow plan release-v2.aep.yaml --input '{"version":"2.4.0"}'
```

server  execution plan  :

```json
{
  "plan_id": "plan_abc123",
  "topological_order": ["build", "security", "tests", "deploy_staging", "smoke_test", "approval_gate", "deploy_production"],
  "parallel_groups": [
    ["build"],
    ["security", "tests"],
    ["deploy_staging"],
    ["smoke_test"],
    ["approval_gate"],
    ["deploy_production"]
  ],
  "approvals_required": ["approval_gate"],
  "compensation_chain": ["deploy_staging", "deploy_production"]
}
```

### 6.4 `execute`

```bash
aep workflow execute release-v2.aep.yaml --input '{"version":"2.4.0"}'
```

server:
1.  execution record
2.  nodes  topological order
3.  events  node transition
4.   approval
5.  failure  compensation (saga)

```json
{
  "execution_id": "exec_w1",
  "state": "completed",
  "results": {
    "build": { "state": "completed", "output": {...} },
    "deploy_production": { "state": "completed", "output": {...} }
  },
  "budget_used": { "cost_usd": 0.12, "calls": 7, "duration_ms": 145000 },
  "approvals": [
    { "approval_id": "ap_1", "decision": "approve", "decided_by": "user_alice" }
  ]
}
```

### 6.5 `replay`

```bash
aep workflow replay exec_w1
```

server  timeline   .
replay MUST   side effects  —    .

```json
{
  "execution_id": "exec_w1",
  "timeline": [
    { "t": 0, "event": "execution.created", "data": {...} },
    { "t": 12, "event": "execution.planned", "data": {...} },
    { "t": 50, "event": "execution.started", "data": {...} },
    ...
  ],
  "results": {...},
  "audit_chain": { "valid": true, "length": 42 }
}
```

## 7. Checkpoints

workflow MAY  checkpoints:

```yaml
nodes:
  - id: build
    capability: app.build
checkpoint: true   #
```

 `resume` server:
1.   checkpoint
3.   checkpoint

## 8. Compensation (Saga)

 failure  workflow  `on_failure: compensate`:

```text
build (success)
  ↓
deploy_staging (success)
  ↓
smoke_test (FAIL)
  ↓
compensation chain (reverse):
  ↓
deploy_staging → rollback
  ↓
build → (no compensation defined, skip)
  ↓
workflow marked as failed
```

server MUST  compensation   nodes .
  compensation: `COMPENSATION_FAILED` → workflow state `failed`.

## 9. Workflow Validation Rules

| Rule | Severity | Message |
|---|---|---|
| Cycle in DAG | error | `Workflow has cycle at node X` |
| Unknown capability | error | `Capability X not found in registry` |
| Input schema mismatch | error | `Node X input field Y missing` |
| Approval node without `approval.reason` | error | `Approval node X missing reason` |
| Missing `compensation` when `on_failure: compensate` | warning | `Node X uses on_failure: compensate but no compensation defined` |
| No `timeout_ms` | warning | `Node X has no timeout_ms — defaulting to 30s` |
| Capability not in `authority.required_capabilities` | error | `Node X uses capability Y not declared in authority requirements` |

## 10. Portability

workflow file MUST  portable  AEP runtimes.  
- لا references إلى runtime-internal state
- لا hardcoded URLs
- لا references إلى secrets
- استخدام `${inputs.X}` و `${node.output.X}` فقط

workflow    runtime      .
