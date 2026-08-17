# AEP 000 — Overview

## الغرض

AEP (Agent Execution Protocol)       .         **Capability Contracts** —        Workflows Events Artifacts Delegation Provenance  Recovery.

## الشعار

> **Models propose. Policies authorize. AEP executes.**

## الفكرة الجوهرية

`Model → Tool → Result`     .    :

- ماذا يستطيع النظام فعله؟
- ما الموارد التي يستطيع الوصول إليها؟
- ما الصلاحيات المطلوبة؟
- ما مستوى الخطر؟
- ما التكلفة؟
- ما زمن التنفيذ؟
- هل العملية قابلة للعكس؟
- هل يمكن عمل Dry Run؟
- هل يمكن إلغاؤها؟ استئنافها؟ إعادة تنفيذها بأمان؟
- ماذا يحدث إذا فشل Provider؟
- هل توجد Capability مكافئة؟
- هل تحتاج العملية موافقة بشرية؟
- كيف يتم تتبع مصدر النتيجة؟
- كيف يتم تفويض جزء من العمل لوكيل آخر؟

AEP         Profiles   Core .

## المسار الأساسي

```text
Intent
  ↓
Capability Discovery
  ↓
Planning
  ↓
Policy
  ↓
Risk Analysis
  ↓
Approval
  ↓
Execution
  ↓
Events / Observability
  ↓
Recovery / Compensation
  ↓
Provenance
```

## الوحدة الأساسية: Capability

AEP  **Capability**  Tool. Capability   :

- قراءة بيانات
- Query
- Search
- Action
- Workflow
- Event subscription
- Artifact operation
- Agent
- Agent delegation
- UI interaction

## المكونات المفاهيمية

```text
Capability · Resource · Action · Workflow · Execution · Event
Artifact · Principal · Policy · Agent · Delegation · Approval
Checkpoint · Provider · Credential
```

## الاستقلال عن MCP

AEP MUST NOT  :

- MCP wire format
- MCP lifecycle
- MCP session semantics
- MCP JSON-RPC assumptions
- MCP tool model
- MCP SDK
- MCP extensions

AEP       MCP. MCP    ecosystem   dependency.

## Profiles (مرجع: spec/001-principles.md §Extensible Core)

| Profile | المكونات |
|---|---|
| Core | envelope, capability, execution, result, error, handles |
| Security | identity, authentication, authorization, policy, approval, audit |
| Workflow | graphs, conditions, loops, budgets, checkpoint, compensation |
| Events | publish, subscribe, replay, backpressure |
| Agents | agent identity, delegation, agent discovery |
| Enterprise | SSO, multi-tenancy, data residency, audit, governance |
| Edge | offline, intermittent connectivity, small payloads, CBOR |

## المراجع

- `spec/001-principles.md` — المبادئ العشرة
- `spec/002-envelope.md` — رسالة AEP
- `spec/003-capabilities.md` — Capability Contract
- `spec/004-execution.md` — Execution Lifecycle
- `spec/005-errors.md` — Error Model
- `schemas/` — JSON Schemas الرسمية
- `sdk/typescript/` — TypeScript SDK + Core Runtime
