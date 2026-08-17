# AEP Profile — Enterprise

**Status:** AEP Profile 0.1 — NORMATIVE  
**Keywords:** RFC 2119.

## 1. Motivation

enterprise deployments: SSO, multi-tenancy, data residency, governance.

## 2. Multi-Tenancy

 request MAY  `tenant_id`:

```json
{
  "principal": {
    "type": "agent",
    "id": "agent.deploy",
    "tenant_id": "tenant_acme"
  }
}
```

server MUST    tenant boundary .

### 2.1 Tenant Isolation Rules

1. capability tokens   tenants.
2. idempotency keys  per-tenant.
3. artifacts   tenant.
4. audit records  per-tenant.

## 3. SSO Integration

```json
{
  "auth": {
    "method": "oidc",
    "issuer": "https://idp.acme.com",
    "client_id": "aep_client",
    "scopes": ["openid", "profile", "aep:execute"]
  }
}
```

server MUST   ID token   request.

## 4. Data Residency

```yaml
policies:
  - id: data-class-financial
    data_class: financial
    allowed_regions:
      - eu-west
      - eu-central
    forbidden_regions:
      - us-*
```

server MUST      .

## 5. Data Classification

```text
public
internal
confidential
restricted
secret
```

resource MAY  classification. Policy .

## 6. Governance

```yaml
governance:
  approval_quorum: 2  # for critical ops
  approver_roles: ["security_officer", "deployment_lead"]
  blackout_windows:
    - name: "weekend-deploy-blackout"
      cron: "0 0 * * 6,0"  # Saturday & Sunday
      forbid: ["deploy.production"]
```

## 7. Compliance

server MAY :
- SOC 2 audit logs
- GDPR data subject access requests
- HIPAA access logs
- PCI DSS payment records

## 8. Federation

```text
Enterprise A (tenant_acme)
    ↓ federation
Enterprise B (tenant_globex)
```

- Cross-tenant trust (rare, requires explicit policy)
- Federated identity (OIDC)
- Federated authority (signed portable authority)

## 9. High Availability

server SHOULD :
- Multi-AZ deployment
- Shared state (Redis, etcd)
- Load balancing (stateless runtime)
- Disaster recovery

## 10. Rate Limiting & Quotas

```yaml
quotas:
  - principal: "agent.*"
    limits:
      requests_per_minute: 100
      requests_per_hour: 5000
      cost_per_day_usd: 10
```

: `RATE_LIMITED`.
