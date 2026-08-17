# AEP — دليل البدء السريع

## ما هو AEP؟

AEP هو طبقة حماية بين وكيل الذكاء الاصطناعي والأدوات.

**بدون AEP:**
```
الوكيل → الأداة → تنفيذ (لا حماية، لا تحكم، لا تتبع)
```

**مع AEP:**
```
الوكيل → AEP → (هوية + صلاحية + سياسة + مخاطر + موافقة + ميزانية) → الأداة → إيصال + تدقيق
```

---

## البدء في 3 أسطر

```typescript
import { AEP } from "@aep/kit";

const aep = AEP.quickstart();           // ابدأ خادم محلي فوراً
const result = await aep.run("math.add", { a: 2, b: 3 });  // نفّذ أمر
console.log(result);                    // { result: 5 }
```

---

## تسجيل أداة مخصصة

```typescript
const aep = AEP.quickstart();

// سجّل أي أداة ببضع أسطر
aep.tool("send_email", {
  description: "إرسال بريد إلكتروني",
  input: { to: "string", subject: "string", body: "string" },
  side_effect: true,      // لها تأثير خارجي
  risk: "medium",         // مخاطر متوسطة
}, async ({ to, subject, body }) => {
  // منطق الإرسال هنا
  return { sent: true };
});

// الوكيل يمكنه الآن استدعاءها
await aep.run("send_email", {
  to: "alice@example.com",
  subject: "مرحبا",
  body: "هذه رسالة من وكيل ذكي",
});
```

---

## ربط وكيل OpenAI

```typescript
import { AEP } from "@aep/kit";

const aep = AEP.quickstart();

// سجّل الأدوات
aep.tool("search", { description: "بحث", input: { query: "string" } },
  async ({ query }) => ({ results: [`نتائج: ${query}`] })
);

aep.tool("deploy", {
  description: "نشر للإنتاج",
  input: { version: "string" },
  side_effect: true,
  risk: "critical",  // ← هذا سيطلب موافقة بشرية!
}, async ({ version }) => ({ deployed: true, version }));

// الوكيل يحاول النشر → AEP يطلب موافقة!
try {
  await aep.run("deploy", { version: "2.0" });
} catch (err) {
  console.log("AEP: هذا الإجراء يتطلب مواففة بشرية!");
  // الوكيل لا يمكنه النشر بدون موافقة — هذه هي قوة AEP
}
```

---

## محاكاة بدون مخاطر (Dry Run)

```typescript
// جرّب قبل التنفيذ — لا تأثيرات جانبية
const preview = await aep.try("deploy", { version: "2.0" });
console.log(preview);
// { would_change: true, estimated_cost: 0.05 }
```

---

## الإنتاج (Production)

```typescript
const aep = AEP.production({
  server: "https://aep.mycompany.com",
  token: process.env.AEP_TOKEN,
});

await aep.run("deploy.production", { version: "2.4" });
```

---

## قائمة الأدوات

```typescript
const tools = await aep.tools();
console.log(tools);
// ["math.add", "send_email", "deploy", ...]
```

---

## لماذا AEP؟

| السؤال | بدون AEP | مع AEP |
|---|---|---|
| من يستطيع تنفيذ هذا؟ | أي وكيل | فقط من يملك صلاحية |
| ما هي المخاطر؟ | غير معروفة | محسوبة ومقيّدة |
| هل تحتاج موافقة؟ | لا أحد يعرف | AEP يطلب مواففة للعمليات الخطرة |
| ماذا لو فشل؟ | قد يتكرر بشكل خاطئ | إعادة آمنة + تعويض |
| هل يمكن تتبع ما حدث؟ | صعب | إيصال مشفّر + سجل تدقيق |
| من فوض من؟ | غير معروف | سلسلة تفويض كاملة |

---

## Docker (تشغيل فوري)

```bash
docker compose up
# AEP يعمل على http://127.0.0.1:8080
```

## التثبيت المحلي

```bash
cd sdk/typescript
npm install && npm run build
npx tsx examples/kit-quickstart.ts
```
