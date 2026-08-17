# PROJECT_COMMANDS.md — الأوامر المؤكدة من المستودع

> كل أمر هنا **جُرِّب فعلياً في بيئة الفحص** أو مثبت من ملف CI الرسمي، مع النتيجة
> الملاحظة. التاريخ: 2026-08-17. البيئة: Node `v22.22.3`، npm `10.9.8`،
> PostgreSQL أصلي `18.4` (مؤقت، خارج المستودع).

---

## 1. التثبيت

```bash
npm ci
```
✅ نجح. (يُثبّت التبعيات طبقاً لـ `package-lock.json` دون تعديله.)

## 2. التطوير

```bash
npm run dev
```
✅ نجح — خادم Vite على `http://localhost:3000` (مربوط على `0.0.0.0`). يعمل بدون
أي متغيرات بيئة؛ تظهر صفحة الدخول مع تنبيه «النظام غير مهيأ بعد» حتى يُملأ `.env`.

إعداد `.env` (انسخ من `.env.example`):
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
# اختياري وموقت فقط لنشر العرض:
# VITE_PUBLIC_DEMO_MODE=true
```

## 3. الفحوصات الأمامية (كلها تنجح حالياً)

| الأمر | النتيجة الملاحظة |
| --- | --- |
| `npm run typecheck` | ✅ 0 أخطاء (`tsc --noEmit` بوضع strict) |
| `npm run lint` | ✅ 0 تحذيرات / 0 أخطاء (oxlint، 217 ملفاً) |
| `npm test` | ✅ 55 ملفاً / 470 اختباراً ناجحة (Vitest + Testing Library) |
| `npm run test:watch` | وضع المراقبة التفاعلي (لم يُستخدم في الفحص الآلي) |
| `npm run build` | ✅ نجح → `dist/` (مع تقسيم مسارات وقناديل vendor) |
| `npm run preview` | ✅ يعمل — يعرض البناء الإنتاجي (يستخدمه smoke على المنفذ 4173) |
| `npm run smoke:production` | ✅ نجح — فحص SPA routing + PWA manifest/أيقونات/SW + تقسيم chunks (حد 500 KiB) + عقد Vercel |

## 4. قاعدة البيانات (أدوات المستودع)

### أ) الطريق الرسمي — يتطلب Supabase CLI + Docker (غير متاحين في بيئة الفحص)

```bash
supabase start          # تشغيل المكدس المحلي (PG 15 + Auth + Studio)
supabase db reset       # إعادة تشغيل كل الترحيلات من قاعدة فارغة
supabase test db        # اختبارات pgTAP الحقيقية (الأدلة الأمنية المعتمدة)
supabase gen types typescript --local --schema public > src/lib/database.types.ts
```

معادلات npm:
```bash
npm run db:types        # = supabase gen types ... (يحتاج CLI)
npm run db:reset        # = supabase db reset (يحتاج CLI + Docker)
```

### ب) الطريق الأصلي التكميلي — PostgreSQL أصلي (ما استُخدم في هذا الفحص)

```bash
DB_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres \
  node scripts/native-db/run.mjs
```
✅ نجح بعد سد ثغرة shims (انظر PROJECT_STATUS.md §4): أعاد تشغيل **55 ترحيلاً**
من قاعدة فارغة وشغّل **13 ملف pgTAP (556 assertion)** بنجاح.

إثباتات التزامن (كلها ✅ PASSED):
```bash
DB_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres node scripts/native-db/warehouse_concurrency.mjs
DB_URL=... node scripts/native-db/consumable_concurrency.mjs
DB_URL=... node scripts/native-db/consumable_catalog_concurrency.mjs
DB_URL=... node scripts/native-db/payments_concurrency.mjs
DB_URL=... node scripts/native-db/quotation_concurrency.mjs
DB_URL=... node scripts/native-db/staff_payroll_concurrency.mjs
DB_URL=... node scripts/native-db/procurement_concurrency.mjs
DB_URL=... node scripts/native-db/procurement_lifecycle_concurrency.mjs
```

إثبات النسخ/الاستعادة (يتطلب `pg_dump`/`pg_restore` — مثبت في CI، غير ممكن في هذه البيئة):
```bash
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  npm run db:backup-restore-proof
```
⚠️ يرفض تشغيل نفسه ضد أي قاعدة غير محلية (guard أمان مدمج).

## 5. تسلسل الفحص الكامل المحلي الموصى به

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke:production
git diff --check     # فحص المسافات البيضاء (نفس بوابة CI)
```

## 6. بوابة CI (ما يشغّله `.github/workflows/ci.yml` تلقائياً عند كل push/PR)

- الوظيفة الأمامية: `npm ci` → typecheck → lint → test → build → smoke → artifact → `git diff --check`.
- وظيفة قاعدة البيانات: تثبيت Supabase CLI `2.114.0` → `supabase start` →
  `supabase db reset` → `supabase test db` → إثباتات التزامن الخمسة →
  `npm run db:backup-restore-proof` → توليد الأنواع → **فشل CI إذا انحرف
  `src/lib/database.types.ts` عن المخطط** (بوابة انحراف الأنواع).
- ⚠️ `src/lib/database.types.ts` **مملوك للمولّد** — لا يُعدَّل يدوياً أبداً.

## 7. ملاحظات تشغيلية مؤكدة

- البناء يعمل **بدون** متغيرات بيئة (حالة «غير مهيأ» على صفحة الدخول).
- أي متغير `VITE_*` يصبح عاماً في حزمة المتصفح — لا تُوضع فيه أسرار أبداً
  (مفتاح `service_role` ممنوع منعاً باتاً في الواجهة).
- الترحيلات المطبَّقة **خالدة**: أي تعديل لاحق يكون بملف ترحيل جديد، والسلسلة
  يجب أن تعمل من قاعدة فارغة (`supabase db reset`).
- قبل نشر أي ترحيل: `supabase test db` + توليد الأنواع والتزام الفارق.
- المنطقة الزمنية التشغيلية ثابتة: `Asia/Muscat`؛ والعملة: OMR بثلاث خانات عشرية.
