# AEP — أمثلة عملية


## التشغيل

```bash
cd sdk/typescript
npm install
npm run build

# تشغيل أي مثال
npx tsx examples/01-simple-capability.ts
npx tsx examples/02-workflow.ts
npx tsx examples/03-provider-equivalence.ts
npx tsx examples/04-policy-risk-approval.ts
npx tsx examples/05-http-server-client.ts
```

## الأمثلة

### 01-simple-capability.ts
`math.add` capability    AEPServer. :
- بناء CapabilityDefinition
- بناء AEPRequest
- الحصول على AEPResponse مع output موثّق

### 02-workflow.ts
workflow  release:
```
build → (security + tests ) → deploy
```
- WorkflowSpec مع nodes و depends_on
- Parallel branches
- Budget
- Compensation (saga)

### 03-provider-equivalence.ts
 semantic_class ("issue.creation")  provider:
- github.issue.create
- linear.issue.create

- Provider independence
- Capability equivalence
- Failover عند تعطل provider

### 04-policy-risk-approval.ts
- `agent.researcher` لا يمكنه عمل `payment.*` → POLICY_DENIED
- `agent.deployer` يحتاج موافقة لـ`deploy.production`

- PolicyDocument مع glob patterns
- deny-override
- Approval flow

### 05-http-server-client.ts
HTTP server  + client :
- Discovery (Level 1)
- Execute (sync)
- Dry Run
- Inspect (Level 4)
- SSE-ready (لاختبارEvent subscription)

- HTTP Profile (9 endpoints)
- AEPClient API
- End-to-end flow

## أمثلة متقدمة (TODO)

- `06-multi-agent-delegation.ts` — supervisor → research agent → data agent
- `07-event-recovery.ts` — deployment.failed → Recovery Agent → rollback
- `08-shadow-execution.ts` — plan → simulate → impact → approval → real
- `09-database-migration.ts` — analyze → blast-radius → dry-run → backup → approval → migrate → verify → compensate
- `10-autonomous-release.ts` — Demo الأول من قسم 136 من المواصفة
