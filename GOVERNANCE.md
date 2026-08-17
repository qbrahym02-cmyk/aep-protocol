# AEP Governance

## القرارات المعمارية

AEP    `spec/001-principles.md`.        .

## عملية التطوير

### Sprint-based (مرجع: spec/Sprints 152-160)

| Sprint | الميزات |
|---|---|
| 1 | Envelope · Capability · Discovery · Execute · Result · Errors · Handles · Idempotency |
| 2 | async · streaming · cancel · timeout · artifacts |
| 3 | policy · risk · approval · dry-run · budget |
| 4 | workflow · graphs · checkpoint · compensation · retry |
| 5 | events · subscriptions · replay · provider health · fallback |
| 6 | agents · identity · delegation · capability tokens · budget propagation |
| 7 | semantic discovery · equivalence · adaptive routing |
| 8 | audit · provenance · enterprise policies · certification |
| 9 | dashboard · registry · marketplace · developer portal |

### المستوى الحالي

**Sprint 1-8** ( ). Sprint 9 dashboard/registry      "  Dashboard" ( 142).

## الاستقلال عن MCP

: **AEP    MCP.**  PR   dependency  MCP .   Adapter MCP `adapters/mcp/`    dependency  Core.

## Core vs Profile

feature Profile   interoperability    Core.    147  .

## معيار القبول

1.   `npm run build`
2.   `npx tsx src/cli.ts conformance` (46/46  )
3.    conformance
4.      feature
5.  `CHANGELOG.md`

## الإصدار

AEP 0.1 — Sprint .   1.0 :
- 3 تنفيذات مستقلة
- conformance suite كاملة
- security review
- interop tests
- real deployments


## المساهمة

2.  PR  tests
3.   `npm run build`  conformance pass
4.  design decision  PR description
