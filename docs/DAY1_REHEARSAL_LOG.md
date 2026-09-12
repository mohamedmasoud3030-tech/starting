# سجل بروفة يوم‑1 — تنفيذ فعلي على مشروع الإنتاج

| الحقل | القيمة |
| --- | --- |
| التاريخ | 2026‑09‑13 |
| المشروع | Supabase `livpmxwwxsfnaceczyth` (الإنتاجي، وفق `OPERATIONS.md:16`) |
| الكود | فرع `arena/01a09729-starting` @ `d7a7418` (CI أخضر: 19/19 خطوة DB + Frontend) |
| التقديم | `vite dev` من بيئة العمل على `0.0.0.0:3000` (`allowedHosts: true`) — المتصفح عند المالك هو الذي يتصل بـ Supabase |
| المساعد | مخفي (`VITE_ENABLE_ASSISTANT=false`) |
| القرار | **الخيار C — بروفة كاملة على الإنتاج**، اتخذه المالك بعد عرض الأدلة على أن الحذف غير ممكن إطلاقًا |

> **قيد مُسجَّل على القرار:** الترحيلات الـ104 لا تتضمّن أي سياسة `DELETE`
> (16 `SELECT`، 2 `ALL` على `staff_members`/`equipment_capacity` فقط، 1 `UPDATE`، 1 `INSERT`).
> كل ما تنشئه البروفة يبقى في الإنتاج للأبد؛ خطة التصفير أدناه تُصفِّر **الأرقام** لا **الصفوف**.

---

## قيود هذه البروفة (نقاط عمياء يجب قراءتها مع كل نتيجة)

1. **CSP غير مطبَّق هنا.** خادم التطوير لا يرسل ترويسات `vercel.json`، فأي سلوك يعتمد على
   CSP سيبدو سليمًا في المعاينة بينما ينكسر على `jiwdah.vercel.app` — انظر **PRE‑1**.
2. **لا وصول لي إلى القاعدة** (لا منفذ شبكة من بيئة العمل إلى `*.supabase.co`): كل النتائج
   أدناه من ملاحظات المتصفح عند المالك ولقطات الشاشة، لا من استعلامات مباشرة.
3. **حالة الترحيلات على المشروع غير مؤكدة** → الخطوة 0 إلزامية قبل البند 1.

---

## PRE‑1 — CSP يحجب كل صور الأدلة في الإنتاج (P1، مكتشف قبل البروفة)

`vercel.json:50` يضبط `img-src 'self' data:`، بينما صور الأدلة تُحمَّل من
`https://<ref>.supabase.co/storage/v1/object/sign/...`:

| الموضع | ما يعرضه |
| --- | --- |
| `src/features/attachments/EvidenceFileField.tsx:75` | مصغّرة الدليل (إيصال/سيلفي/إثبات) |
| `src/features/warehouse/HandoverEvidenceSection.tsx:122` | مصغّرة دليل التسليم |
| `src/components/documents/DocumentShell.tsx:36` | شعار المنشأة (`organization_settings.logo_url`) |

`connect-src` يسمح بـ`https://*.supabase.co` (لذلك ينجح `createSignedUrl` نفسه)، لكن
**تحميل الصورة** تحكمه `img-src` → صور مكسورة في الإنتاج، وسليمة في المعاينة.

**الإصلاح المقترح (سطر واحد):** `img-src 'self' data: https://*.supabase.co;`
لا يكسر `npm run smoke:production`: الفحص يتحقق من `script-src 'self'` و`connect-src`
و`frame-ancestors 'none'` فقط (`scripts/production_smoke.mjs:159‑165`).

**الحالة:** بانتظار موافقة المالك — خارج خطوات Track A المعدودة، لكنه يُسقط معيار نجاح في
القائمة («سيلفي حضور يرفع ويظهر رابط موقّع») على الموقع الحي.

---

## PRE‑2 — الموقع الحي يقدّم كودًا أقدم من الإصلاحات (P1 نشر)

`https://jiwdah.vercel.app/version.json` (قراءة مباشرة أثناء التحضير):

```json
{ "version": "5ac6cc07763c", "deployedAt": "2026-09-11T01:05:47.543Z" }
```

أي أن الإنتاج يقدّم **نفس نقطة انطلاق هذا الفرع** (`5ac6cc07763c…`) — فهو يحتوي على
العلل الثلاث التي أصلحناها (لوحة فحص التخزين، ابتلاع أخطاء المطاعم، وCSP الصور في
PRE‑1) ولا يحتوي على أيٍّ من الإصلاحات.

**تبعات على البروفة:** النتائج التي سنسجّلها تخص كود الفرع
`arena/01a09729-starting` كما يُقدَّم من المعاينة، **لا** الموقع الحي. لن يستفيد
`jiwdah.vercel.app` من الإصلاحات إلا بعد نشر جديد (دمج الفرع في `main` — وهو ما
ينشره Vercel تلقائيًا — أو نشر الفرع مباشرة).

**ملاحظة توثيقية (لا تُصلَح الآن، خارج النطاق):** `PROJECT_STATUS.md:16` يذكر أن
الإنتاج عند `225f10b` (READY)، و`version.json` يدحض ذلك.

---

## الخطوة 0 — مسبار الجاهزية (يلزم تنفيذها أولًا)

في المتصفح (تبويب `about:blank` → Console)، بمفتاح `anon` لدى المالك:

```js
const URL='https://livpmxwwxsfnaceczyth.supabase.co', KEY='ANON_KEY';
const h={apikey:KEY,Authorization:`Bearer ${KEY}`};
const root=await fetch(`${URL}/rest/v1/`,{headers:h}).then(r=>r.json());
const names=Object.keys(root.definitions??{});
console.log('relations:',names.length,
  ['organization_settings','supplier_summaries','supplier_contract_summaries',
   'meal_booking_summaries','event_financial_closures']
   .map(n=>`${n}=${names.includes(n)}`).join(' '));
for(const fn of ['complete_evidence_reclaim','create_meal_booking','reopen_event_financially']){
  const r=await fetch(`${URL}/rest/v1/rpc/${fn}`,{method:'POST',
    headers:{...h,'Content-Type':'application/json'},body:'{}'});
  console.log(fn,r.status,(await r.text()).slice(0,110));
}
```

**التفسير:** `404` + `PGRST202` = الكائن غير موجود (الترحيل لم يُطبَّق). أي خطأ آخر
(`NOT_AUTHENTICATED` / `NOT_AUTHORIZED` / عدد الوسائط) = **موجود** ونُفِّذ.

| الفحص | النتيجة |
| --- | --- |
| عدد العلاقات المكشوفة | _لم يُنفَّذ بعد_ |
| `meal_booking_summaries` (0099) | _—_ |
| `supplier_contract_summaries` (0099) | _—_ |
| `organization_settings` (0103) | _—_ |
| `complete_evidence_reclaim` (0078) | _—_ |
| `reopen_event_financially` (0069) | _—_ |

---

## البنود 1–16

| # | البند | النتيجة | P1 (ملف:سطر) |
| -- | --- | --- | --- |
| 1 | `/signup` — تسجيل بريد جديد | _—_ | |
| 2 | تأكيد البريد (أو الدخول مباشرة إن عُطّل) | _—_ | |
| 3 | Onboarding — «مكتب الضيافة التجريبي» | _—_ | |
| 4 | `/settings` — فحص النظام أخضر + اختبار رفع ملف | _—_ | |
| 5 | `/customers` — «شركة الاختبار» | _—_ | |
| 6 | `/catalog` — «كرسي» REUSABLE_EQUIPMENT بيع 2.000 / تكلفة 0.500 | _—_ | |
| 7 | `/quotes/new` — إصدار → `QT-YYYY-0001` | _—_ | |
| 8 | اعتماد → تحويل لمناسبة `CONFIRMED` | _—_ | |
| 9 | تبويب الفريق — إسناد عضو | _—_ | |
| 10 | تبويب المعدات — حجز 50 كرسي (السعة معرّفة مسبقًا) | _—_ | |
| 11 | تبويب المدفوعات — دفعة 100.000 نقدًا → تغيّر المحصل/المتبقي | _—_ | |
| 12 | تبويب المالية — مصروف نقل 20.000 | _—_ | |
| 13 | بدء التجهيز → الإرسال → التنفيذ → العودة → الإغلاق → الإغلاق المالي | _—_ | |
| 14 | `/reports` — إيراد/محصّل/متبقٍ/تكلفة/ربح | _—_ | |
| 15 | `/accounting` — التقادم + كشف حساب العميل | _—_ | |
| 16 | `/dashboard` — مؤشرات اليوم + تنبيهات | _—_ | |

**معايير النجاح:** لا خطأ أحمر · ترقيم تلقائي · المحصل/المتبقي/الربح من القاعدة ·
عدم تسريب بين منشأتين · مرفق سيلفي برابط موقّع (**معرّض لـ PRE‑1 في الإنتاج**).

---

## بقايا الإنتاج وخطة التصفير (كلها محققة من الكود)

| الكائن | قابل للإزالة؟ | الوسيلة / السبب |
| --- | --- | --- |
| منظمة «مكتب الضيافة التجريبي» | **لا** | لا سياسة حذف على `organizations` |
| عميل «شركة الاختبار» | **لا** | لا سياسة حذف |
| مادة «كرسي» | **لا** (تعطيل فقط إن وُجد `is_active`) | لا سياسة حذف |
| عرض `QT-…` | **لا** | `reject/expire` ممكنان **قبل** الاعتماد فقط |
| المناسبة بعد البند 13 | **لا** | `cancel_event` ترفع `EVENT_CANNOT_BE_CANCELLED` خارج `DRAFT/QUOTED/CONFIRMED/PREPARING` (0015:70) |
| دفعة 100.000 | تُصفَّر | `void_customer_payment` — معروض في الواجهة (`payments.api.ts:190`) |
| مصروف 20.000 | يُصفَّر | `void_event_expense` — معروض في الواجهة (`finance.api.ts:125`) |
| الإغلاق المالي | يُفتح | `reopen_event_financially` (`finance.api.ts:236`) |
| قيود اليومية | **لا من التطبيق** | `reverse_journal_entry` مسحوبة من `anon, authenticated` (0084:646) → SQL Editor كمالك القاعدة فقط |
| المرفقات/السيلفي | جزئيًا | `reclaim_evidence` → `complete_evidence_reclaim` (0078) |
| سجل التدقيق | **لا** (بحكم التصميم) | `purge_old_audit_events` (0098) للتقادم الزمني فقط |

**ترتيب التصفير بعد البروفة (إلزامي بهذا الترتيب):**
1. `reopen_event_financially` — أولًا، لأن `guard_event_financially_closed` (0069)
   يمنع أي `INSERT/UPDATE/DELETE` مالية على مناسبة مغلقة.
2. `void_customer_payment` (الدفعة 100.000).
3. `void_event_expense` (المصروف 20.000).
4. اختياري: `reclaim_evidence` + `complete_evidence_reclaim` للمرفقات، ومنها ملف الفحص
   الصحي `{org}/EXPENSE_RECEIPT/health_check/<uuid>.jpg`.

---

## سجل P1

| # | البند | الوصف | الملف:السطر | الحالة |
| -- | --- | --- | --- | --- |
| PRE‑1 | معيار المرفقات | `img-src` في CSP يحجب صور Storage في الإنتاج | `vercel.json:50` | **أُصلح** في `3d48750` + تثبيت في smoke |
| PRE‑1ب | صوت المساعد | `media-src` غير معرّف فيحجب `blob:` لصوت «لينا» السحابي | `vercel.json:50` / `AssistantLauncher.tsx:24` | **أُصلح** في `3d48750` |
| PRE‑2 | النشر | الإنتاج عند `5ac6cc07763c` — لا يحتوي الإصلاحات | `version.json` الحي / `PROJECT_STATUS.md:16` | مفتوح: يلزم نشر بعد الدمج |
