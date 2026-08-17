# AEP Profile — Policy & Risk

**Status:** AEP Profile 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Policy Document

```yaml
version: "1.0"
id: "enterprise-policy-v3"
default_decision: deny
rules:
  - id: researcher-restrictions
    principal: "agent.researcher"
    principal_type: agent
    capability: "*"
    effect: allow
    max_risk_level: medium

  - id: researcher-no-payment
    principal: "agent.researcher"
    capability: "payment.*"
    effect: deny
    reason_code: RESEARCH_AGENT_CANNOT_CHARGE

  - id: deployer-needs-approval
    principal: "agent.deployer"
    capability: "deploy.production"
    effect: approval
    require: [human_approval, strong_auth]
    max_risk_level: high

  - id: admin-full-access
    principal: "user.admin"
    effect: allow
```

## 2. Evaluation Algorithm

```text
1.  policy iterate rules
2.  rule  (principal, capability, resource, environment) 
3. deny    allow
4.     rule  default_decision
5. default safe = deny
```

## 3. Policy Rule Schema

```ts
interface PolicyRule {
  id?: string;
  principal?: string;        // glob: "agent.*"
  principal_type?: "user" | "agent" | "service" | "system";
  capability?: string;      // glob: "github.*"
  resource?: string;
  tenant_id?: string;
  environment?: "test" | "staging" | "production";
  effect: "allow" | "deny" | "approval" | "constrain";
  reason_code?: string;
  require?: Array<"human_approval" | "strong_auth" | "step_up" | "dry_run_first">;
  constraints?: Record<string, unknown>;
  max_risk_level?: RiskLevel;
  max_cost_usd?: number;
}
```

## 4. Decision Object

```json
{
  "decision": "deny",
  "reason_code": "RISK_TOO_HIGH",
  "matched_rules": ["production-destructive-actions"],
  "constraints": { "environment": "staging", "max_records": 1000 }
}
```

## 5. Risk Model

```json
{
  "risk": {
    "level": "critical",
    "impact": "financial",
    "reversible": false,
    "blast_radius": "account",
    "data_sensitivity": "high",
    "factors": ["production-env", "high-amount", "irreversible"]
  }
}
```

### 5.1 Risk Levels (ordered)

| Level | Score | Semantics |
|---|---|---|
| `low` | 0-25 | عمليات قراءة أو transform بسيط |
| `medium` | 26-50 | side effects محدودة، قابلة للعكس |
| `high` | 51-75 | side effects مهمة، صعبة العكس |
| `critical` | 76-100 | عمليات حساسة، غير قابلة للعكس، مالية/إنتاجية |

### 5.2 Dynamic Risk

Risk  static.  :

```text
principal trust level
environment (test/staging/production)
input size / amount / count
data classification
tenant trust
time of day (incident state)
```

:  `payment.charge`:
- $10 in test → low
- $1000 in production → high
- $100,000 in production → critical

## 6. Approval Flow

### 6.1 When Required

Approval required :
1. `capability.authorization.require_approval === "always"`
2. `capability.authorization.require_approval === "on_high_risk"`  risk.level ∈ {high, critical}
3. `policy.decision === "approval"`

### 6.2 Approval Object

```json
{
  "approval_id": "ap_01",
  "reason": "Production deployment requires human approval",
  "risk": "critical",
  "expires_at": "2026-08-17T12:30:00Z",
  "allowed_decisions": ["approve", "deny", "approve_with_constraints"]
}
```

### 6.3 Decisions

```json
// approve
{ "decision": "approve", "decided_by": "user_alice" }

// deny
{ "decision": "deny", "decided_by": "user_alice", "reason": "wrong window" }

// approve with constraints
{
  "decision": "approve_with_constraints",
  "decided_by": "user_alice",
  "constraints": {
    "environment": "staging",
    "max_records": 1000,
    "expires_in": "30m"
  }
}
```

### 6.4 Expiration

 `expires_at`: `APPROVAL_EXPIRED` → execution state `expired`.

## 7. Policy Simulation

```bash
aep policy check user_alice deploy.production --environment production
```

server  decision   .  debugging  testing policies.

## 8. Blast Radius

side effect   server SHOULD  :

```json
{
  "impact": {
    "resources": 128,
    "records": 42093,
    "services": 4,
    "financial_exposure": 50000
  }
}
```

approval request  human approver  .
