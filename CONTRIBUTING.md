# Contributing to AEP


## قبل البدء

1.  `spec/`
2.  `GOVERNANCE.md`
3.  `SECURITY.md`
4.     Sprint   (:  152-160  )

## إعداد بيئة التطوير

```bash
cd sdk/typescript
npm install
npm run build
npx tsx src/cli.ts conformance
```

conformance (46/46).

## معايير PR

### 1. شكل الكود

- TypeScript strict mode
- ESM modules (`.js` extensions في imports)
- JSDoc مع تعليقات عربية/إنجليزية
- لا `any` بدون تبرير

### 2. Tests

- كل feature جديدة تحتاج test في `conformance/runner.ts`
- يجب أن يبقى `npm run conformance` ناجحًا
- أضف أمثلة في `examples/` عند الإمكان

### 3. التوثيق

- حدّث `CHANGELOG.md`
- حدّث `spec/` عند تغيير البروتوكول
- اشرح الـdesign decisions في PR

### 4. الأخطاء

- استخدم typed errors من `core/types.ts` (ErrorCode)
- لا تستخدم `Error` مباشرةً في الـruntime — استخدم `AEPError`
- كل error يجب أن يصرّح: code, message, retryable, recovery[]

## ما يجب تجنبه

- ❌ إضافة dependency على MCP
- ❌ إضافة dependency على LLM provider محدد
- ❌ تخزين secrets في الـenvelope
- ❌ إضافة feature إلى Core إذا أمكن كـProfile
- ❌ تجاوز المسار: LLM → Validate → Policy → Risk → Approval → Execute → Audit

## بنية الـRepository

```
spec/         —   (Markdown)
schemas/      — JSON Schemas
sdk/typescript/ — TypeScript SDK + Runtime + CLI
conformance/  — (   )
examples/     —
docs/         —
```

## عملية المراجعة

1. CI   : `npm run build && npx tsx src/cli.ts conformance`
2.   maintainers
3.  Core   lead maintainer
4.  spec  RFC

## الإصدار

- 0.x: التطوير الأولي، قد يكسر التوافق
- 1.0: بعد 3 تنفيذات مستقلة + conformance + security review

## License

MIT —  `LICENSE`
