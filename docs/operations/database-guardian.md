# Database Guardian — دليل التشغيل

> Operational guide for the Database Guardian (built 2026-08-21, V1).
> Framework documentation: [`guardian/README.md`](../../guardian/README.md).

## متى يعمل تلقائياً

- **كل PR يلمس** `supabase/**` أو `guardian/**` أو `package.json` أو
  `src/lib/database.types.ts` يشغّل `.github/workflows/guardian.yml`:
  فحوص static + dynamic (Supabase stack كامل) ويمنع الدمج عند CRITICAL/HIGH.
- **كل push إلى `main`** يلمس نفس المسارات يشغّل نفس البوابة.

## الأوامر

```bash
npm run gate                        # بوابة الإصدار المحمولة: كل البوابات بامر واحد
npm run db:guardian                 # static + dynamic (يتطلب DB_URL أو local)
npm run db:guardian:static          # فحوص الملفات فقط
npm run db:guardian:snapshot        # توليد snapshots العقد بعد تغيير migrations
DB_URL=postgresql://… npm run db:guardian   # ضد قاعدة حية (مثلاً Supabase)
```

## الحالة الحالية (V1)

- **79 migration** تُعاد من قاعدة فارغة + تُختبر على الحالة القريبة من الحالية.
- **29 ملف pgTAP** (25 سابقة + 4 Guardian) — كلها ناجحة عبر `supabase test db`
  وعبر النهج الأصلي المحلي.
- **45 فحصاً** في آخر تشغيل: 45 PASS / 0 FAIL، حد المنع `HIGH`.

## المشاكل الحقيقية المكتشفة في أول تشغيل (وقد أُصلحت في migration 0078)

| ID | الدرجة | المشكلة | الإصلاح |
| --- | --- | --- | --- |
| G-0001 | HIGH | `save_organization_settings` (SECURITY DEFINER) أصبح قابلاً للتنفيذ من `anon` بعد إعادة إنشائه بـ 0077 (ACL افتراضي) | revoke anon/public + grant authenticated |
| G-0002 | HIGH | `transition_event_status` (SECURITY DEFINER) قابلة للتنفيذ من `anon` بعد drop/create في 0066 | revoke anon/public + grant authenticated |
| G-0003 | HIGH | `guard_event_financially_closed` (SECURITY DEFINER) قابلة للتنفيذ من `anon` | revoke من الجميع (داخلية فقط) |
| G-0004 | MEDIUM | 3 views غير `security_invoker` لكنها مفلترة org في جسمها (محققة سلوكياً) | العقد يفرض "invoker أو مفلتر org" + اختبار يمنع إسقاط الفلتر |
| G-0005 | MEDIUM | مجاميع مالية `numeric(14,3)` بينما AGENTS.md ينص على `numeric(12,3)` حصراً | توثيق: الوحدات 12,3 والمجاميع 14,3 — كلاهما NUMERIC دقيق scale 3 |
| G-0006 | HIGH | `event_expenses` يسمح hard DELETE/UPDATE للمصاريف والأحداث مفتوحة | trigger append-only + انتقال VOID موثق |
| G-0007 | HIGH | `event_financial_closures` بلا حراسة: DELETE/UPDATE ممكن | trigger append-only + انتقال REOPEN موثق |
| G-0008 | MEDIUM | `audit_events` بلا حراسة append-only | trigger يمنع UPDATE/DELETE |

## ملاحظات تشغيلية

- `guardian/reports/latest/` لا يُلتزم في Git (يُعاد توليده ويعمل artifact في CI).
- عند إضافة migration جديدة: شغّل `npm run db:guardian:snapshot` بعدها — وإلا
  يفشل `G-SCHEMA-DRIFT` (الـ snapshot لم يعد يطابق الـ migrations).
- لفحص قاعدة Supabase الحية: `DB_URL=<direct/pooler connection> npm run db:guardian`
  (يُقارن المانيفست الحقيقي مع `expected-schema.json` ويشغّل فحوص البيانات
  المالية/التكاملية على البيانات الفعلية).
