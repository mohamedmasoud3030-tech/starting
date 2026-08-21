# Database Guardian — نظام حارس قاعدة البيانات

نظام دائم داخل هذا المستودع لاكتشاف ومنع مشاكل قاعدة البيانات بطريقة قابلة للتكرار:
فحوص deterministic، اختبارات PostgreSQL/Supabase، بوابة إصدار محمولة، GitHub CI،
وتقارير machine-readable. قواعد المجال مأخوذة من schema والكود والاختبارات الفعلية
لمشروع **Hospitality / Event Operations** ومثبتة في
[`contract/canonical-contract.json`](contract/canonical-contract.json) و
[`contract/business-invariants.md`](contract/business-invariants.md).

## التشغيل

```bash
# البوابة الكاملة — DB محلية مطلوبة، ولا يوجد false-green عند غيابها
npm run gate

# تخطٍ صريح للـDB: مناسب لفحص frontend/static فقط، وليس اعتماد تغيير DB
npm run gate -- --skip-db

# Guardian static + dynamic على PostgreSQL محلي scratch فقط
npm run db:guardian
DB_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres npm run db:guardian

# فحوص الملفات فقط
npm run db:guardian:static

# بعد إضافة migration جديدة فقط: snapshot آمن
npm run db:guardian:snapshot
```

الخروج غير الصفري يحدث عند وجود FAIL بدرجة `HIGH` أو `CRITICAL` افتراضياً.

### ممنوع تشغيل الـdynamic Guardian على Production

`db:guardian` يعيد migrations داخل **قواعد scratch** ويحتاج صلاحيات CREATE/DROP DATABASE.
لهذا السبب يقبل runner فقط `localhost` / loopback ويرفض أي `DB_URL` بعيد. لا تمرر
Supabase direct/pooler production URL. فحص قاعدة حية — إن احتجناه لاحقاً — يجب أن يكون
بأداة read-only منفصلة لا تنشئ ولا تحذف أي قاعدة.

### قاعدة محلية نموذجية

```bash
DB_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres npm run gate
```

المسار الرسمي في GitHub Actions يستخدم Supabase stack محلي داخل runner؛ ليس مشروع
Supabase حي.

## GitHub CI

`.github/workflows/guardian.yml` يعمل عند تغييرات:

- `supabase/**`
- `guardian/**`
- `scripts/release-gate.mjs`
- `package.json`
- `src/lib/database.types.ts`

ويشغّل:

1. Guardian static.
2. Supabase local stack + `supabase db reset`.
3. `supabase test db`.
4. Guardian dynamic على `127.0.0.1:54322`.

إذا تعطلت GitHub Actions لأسباب billing/infrastructure، يبقى `npm run gate` بوابة
محمولة مستقلة يمكن تشغيلها محلياً.

## بوابة الإصدار المحمولة

`npm run gate` يشغّل بالترتيب:

1. `typecheck`
2. `lint`
3. frontend tests
4. `build`
5. Guardian static
6. migration replay + pgTAP على DB محلية
7. Guardian dynamic

**غياب DB = FAIL** افتراضياً. لا يصبح DB `SKIPPED` إلا لو أعطى المشغّل
`--skip-db` صراحة، ويُسجل ذلك في `guardian/reports/latest/release-gate.json`.

## Snapshot وMigration Immutability

`contract/migration-hashes.json` هو سجل بصمات migrations التي تم قفلها. القاعدة:

- migration مسجلة لا تُعدّل ولا تُحذف.
- `db:guardian:snapshot` يفحص hashes التاريخية **قبل** أي كتابة.
- لو تغيّر hash تاريخي، snapshot يرفض العملية ولا يمحو الدليل.
- snapshot يضيف hashes للـmigrations الجديدة فقط؛ لا يعيد كتابة القديمة.
- `expected-schema.json` يُعاد توليده من replay نظيف فقط إذا لم توجد findings مانعة.
- `applied-baseline.json` **لا يتقدم تلقائياً** مع snapshot؛ هو baseline مستقرة سابقة
  ويُحدّث فقط بعد تحقق منفصل من أن migrations الأحدث أصبحت مطبقة/مستقرة.

بهذا يظل `G-MIGRATION-IMMUTABILITY` حارساً حقيقياً ولا يمكن تجاوزه بمجرد إعادة snapshot.

## المخرجات

كل تشغيل يكتب إلى `guardian/reports/latest/`، وهو مجلد مولد وموجود في `.gitignore`:

| ملف | المحتوى |
| --- | --- |
| `report.json` | findings كاملة: id / check / severity / status / evidence |
| `summary.md` | ملخص PASS/FAIL |
| `findings.csv` | findings بصيغة CSV |
| `inventory.md` / `inventory.json` | tables / columns / constraints / views / triggers / functions / RLS |
| `write-paths.md` / `write-paths.json` | Frontend → RPC → table write paths |
| `release-gate.json` | نتيجة البوابة المحمولة وخطواتها |

## الفحوص

### Static

| ID | ماذا يفحص |
| --- | --- |
| `G-MIGRATION-IMMUTABILITY` | SHA-256 للمigrations المسجلة؛ تعديل/حذف تاريخي = CRITICAL. |
| `G-MIGRATION-HYGIENE` | أنماط schema خطرة: float للنقود، DROP/DELETE غير الآمن، ACL/SECDEF غير الآمن، وغير ذلك. |
| `G-WRITE-PATHS` | مسارات الكتابة من الواجهة/RPC والجداول مقابل العقد المسموح. |

### Dynamic — scratch محلي فقط

| ID | ماذا يفحص |
| --- | --- |
| `G-INVENTORY` | جرد schema الفعلي بعد replay. |
| `G-SCHEMA-DRIFT` | replay النظيف مقابل `expected-schema.json`. |
| `G-FUNCTION-ACL` | **كل** SECURITY DEFINER بما فيها read-model helpers: search_path + ACL + no anon + authorization guards للكتابة. |
| `G-VIEW-SECURITY` | view يجب أن تكون security_invoker أو تحمل org filtering مثبتاً ومختبراً. |
| `G-RLS-INTEGRITY` | RLS / org-scoped FKs / grants / DELETE policies. |
| `G-DATA-INTEGRITY` | orphans / cross-org / حالات مستحيلة / سلامة العلاقات. |
| `G-FINANCIAL-INTEGRITY` | exact OMR، reconciliation، overpayment، duplicate-payment detection، immutability، hard-delete، uniqueness، idempotency. |
| `G-MIGRATION-GUARDIAN` | replay من فارغ + تطبيق migrations الجديدة فوق `applied-baseline.json`. |
| `G-TENANT-ISOLATION` | اختبارات pgTAP الخاصة بالعزل وسلوك RPC/views. |

### ملاحظات مهمة على الفحص المالي

- مجموع الفواتير يجمع **كل invoice row**؛ لا يستخدم `SUM(DISTINCT total_amount)` لأن
  فاتورتين شرعيتين قد تكونان بنفس القيمة.
- تطابق `event/reference/amount/method` بين دفعتين هو **إشارة مراجعة** لاحتمال double
  posting وليس قاعدة تمنع كل حالة متشابهة بصورة مطلقة.
- لا نستخدم `quotations.updated_at > issued_at` كدليل عبث؛ انتقالات
  `ISSUED → ACCEPTED → CONVERTED` تحدث بشكل شرعي وتحدث `updated_at`. الحماية الصحيحة
  هي trigger immutable snapshot + اختبارات السلوك.

## اختبارات pgTAP المضافة

| الملف | يثبت |
| --- | --- |
| `guardian_schema_contract.test.sql` | RLS، exact money، SECDEF ACL، view filtering، uniqueness، org-scoped FKs. |
| `guardian_tenant_isolation.test.sql` | عزل المنظمات عبر SELECT/INSERT/UPDATE/DELETE/RPC/views. |
| `guardian_financial_integrity.test.sql` | reconciliation، overpayment، duplicate detection، immutability، hard-delete، OMR precision. |
| `guardian_data_integrity.test.sql` | FK/cross-org والحالات غير الصالحة. |

## العقد الكانوني

أهم القواعد في `contract/canonical-contract.json`:

- OMR exact NUMERIC، scale 3؛ unit/rates غالباً `numeric(12,3)` والمجاميع المشتقة
  يمكن أن تكون `numeric(14,3)`.
- RLS وعزل `organization_id` إلزاميان.
- SECURITY DEFINER: search_path مثبت، ACL صريح، لا anon، وتفويض server-side للكتابة.
- financial ledgers append-only، لا hard-delete، أرقام مستندات فريدة لكل منظمة.
- overpayment ممنوع؛ duplicate-looking payments يجب كشفها ومراجعتها.
- migrations التاريخية immutable؛ كل تغيير جديد في migration جديدة مع regression test.

## بروتوكول الإصلاح

**Finding → Evidence → Root Cause → failing regression test → أصغر إصلاح صحيح →
Guardian كامل → مراجعة مستقلة.**

## قواعد صارمة

- لا تعديل Production مباشرة.
- لا reset أو CREATE/DROP DATABASE على host بعيد.
- لا حذف بيانات حية.
- لا Supabase preview/experimental branch من تلقاء النفس.
- لا تعديل migration تاريخية؛ الإصلاح دائماً migration جديدة.
- لا تغيير Business Logic سليم فقط لإرضاء الاختبار.
