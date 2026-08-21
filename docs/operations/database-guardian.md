# Database Guardian — دليل التشغيل

> Operational guide for the Database Guardian (V1).
> Framework documentation: [`guardian/README.md`](../../guardian/README.md).

## متى يعمل تلقائياً

- **كل PR يلمس** `supabase/**` أو `guardian/**` أو `scripts/release-gate.mjs` أو
  `package.json` أو `src/lib/database.types.ts` يشغّل `.github/workflows/guardian.yml`:
  فحوص static + dynamic على Supabase stack محلي داخل GitHub Actions.
- **كل push إلى `main`** يلمس نفس المسارات يشغّل نفس البوابة.
- عند تعطل GitHub Actions لأسباب حساب/بنية تحتية، `npm run gate` هو البديل المحمول
  المحلي ولا يعتمد على CI.

## الأوامر

```bash
npm run gate                        # البوابة الكاملة؛ قاعدة PostgreSQL المحلية مطلوبة
npm run gate -- --skip-db           # frontend/static فقط — تخطٍ صريح وليس اعتماد إصدار DB
npm run db:guardian                 # static + dynamic على PostgreSQL محلي scratch فقط
npm run db:guardian:static          # فحوص الملفات فقط
npm run db:guardian:snapshot        # snapshot آمن بعد إضافة migration جديدة فقط
DB_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres npm run db:guardian
```

> **مهم:** لا تمرر direct/pooler URL لقاعدة Supabase حية إلى `db:guardian`.
> الـdynamic Guardian ينشئ قواعد scratch ويعيد migrations، لذلك يقبل loopback/localhost
> فقط ويرفض أي host بعيد. فحص production الحي يحتاج أداة read-only منفصلة، وليس هذا runner.

## قواعد البوابة المحمولة

- `npm run gate` لا يعطي PASS إذا كانت قاعدة الفحص غير متاحة؛ `db-gates` تصبح FAIL.
- التخطي ممكن فقط بأمر صريح `--skip-db` ويظهر `SKIPPED` في التقرير؛ لا يُعتمد هذا
  المسار لمراجعة تغيير يمس `supabase/**`.
- قاعدة الفحص يجب أن تكون PostgreSQL محلية غير إنتاجية ومسموح فيها CREATE/DROP DATABASE.

## Snapshot وMigration Immutability

- migration مطبقة/مسجلة في `migration-hashes.json` لا تُعدّل ولا تُحذف أبداً.
- `db:guardian:snapshot` يفحص البصمات أولاً؛ لو وجد تاريخاً معدلاً يرفض الكتابة.
- snapshot يحدّث `expected-schema.json` من replay نظيف ويضيف hash للـmigration الجديدة
  فقط؛ لا يعيد كتابة hashes القديمة.
- `applied-baseline.json` يمثل baseline مستقرة سابقة، ولا يتقدم تلقائياً مع snapshot.
  يُحدّث فقط بعد تحقق منفصل من أن migrations الجديدة أصبحت مطبقة/مستقرة.

## الحالة التي سبقت المراجعة المستقلة

قبل تصحيحات المراجعة الحالية كان التشغيل المسجل يذكر:
- **79 migration** replay من قاعدة فارغة.
- **29 ملف pgTAP** (25 سابقة + 4 Guardian).
- **45 finding: 45 PASS / 0 FAIL**.

بعد تعديل كود Guardian نفسه يجب إعادة `npm run gate` الكامل قبل الدمج؛ لا تُنقل أرقام
النجاح السابقة تلقائياً إلى النسخة المصححة.

## المشاكل الحقيقية المكتشفة في أول تشغيل

| ID | الدرجة | المشكلة | الإصلاح |
| --- | --- | --- | --- |
| G-0001 | HIGH | `save_organization_settings` SECDEF قابل للتنفيذ من `anon` بعد إعادة إنشائه | revoke anon/public + grant authenticated |
| G-0002 | HIGH | `transition_event_status` SECDEF قابل للتنفيذ من `anon` بعد drop/create | revoke anon/public + grant authenticated |
| G-0003 | HIGH | `guard_event_financially_closed` trigger helper قابل للتنفيذ من العميل | revoke من public/anon/authenticated |
| G-0004 | MEDIUM | views غير `security_invoker` تعتمد فلترة org داخل الجسم | فرض invoker أو org-filter + اختبار عزل سلوكي |
| G-0005 | MEDIUM | المجاميع المالية تحتاج `numeric(14,3)` بينما أسعار الوحدة `numeric(12,3)` | توحيد العقد والتوثيق على NUMERIC exact scale 3 |
| G-0006 | HIGH | `event_expenses` يسمح hard DELETE/UPDATE غير موثق | trigger append-only + VOID موثق |
| G-0007 | HIGH | `event_financial_closures` بلا حراسة تاريخية كافية | trigger append-only + REOPEN موثق |
| G-0008 | MEDIUM | `audit_events` بلا append-only guard | trigger يمنع UPDATE/DELETE |

## تصحيحات المراجعة المستقلة لـGuardian نفسه

- منع false-green عندما DB غير متاحة في Portable Release Gate.
- منع أي replay/scratch operation على DB بعيدة أو production.
- جعل scratch DB فريدة لكل تشغيل وتنظيفها بعده لتقليل تعارض التشغيل المتوازي.
- منع snapshot من إعادة كتابة hashes تاريخية أو ترقية `applied-baseline` تلقائياً.
- إبقاء baseline قبل migration الجديدة الجاري مراجعتها حتى يختبر incremental replay فعلياً.
- إصلاح جمع الفواتير المتساوية القيمة في فحص overpayment (إزالة `SUM(DISTINCT ...)`).
- عدم اعتبار انتقالات quotation الطبيعية ACCEPTED/CONVERTED عبثاً بالمستند.
- تدقيق كل SECURITY DEFINER بما فيها read-model helpers.

## المخرجات

`guardian/reports/latest/` ناتج تشغيل ولا يُلتزم في Git. التقارير تشمل `report.json`
و`summary.md` والجرد وخريطة مسارات الكتابة و`release-gate.json`.
