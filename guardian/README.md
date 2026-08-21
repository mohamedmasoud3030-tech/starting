# Database Guardian — نظام حارس قاعدة البيانات

نظام دائم داخل هذا المستودع يكتشف ويمنع مشاكل قاعدة البيانات تلقائياً:
فحوص Deterministic، اختبارات PostgreSQL/Supabase حقيقية، بوابة GitHub CI،
وتقرير machine-readable لكل تشغيل. لا يعتمد على رأي نموذج كحقيقة — كل قاعدة
في [`contract/canonical-contract.json`](contract/canonical-contract.json)
مُطبَّقة بالكود وتُختبر سلوكياً.

> A permanent, code-based database health system: deterministic checks, real
> PostgreSQL/Supabase tests, a GitHub CI merge gate, and a machine-readable
> report. Every rule in the canonical contract is enforced by code and
> verified behaviorally — never by opinion. Domain: **Hospitality / Event
> Operations** (organizations, events, quotations, attendance, equipment,
> consumables, procurement, payments) — the invariants come from this
> repository's own schema and tests (`guardian/contract/business-invariants.md`).

---

## التشغيل (Run)

```bash
# بوابة الإصدار المحمولة — كل شيء (typecheck, lint, test, build, Guardian static,
# ومع قاعدة متاحة: إعادة تشغيل migrations + pgTAP + Guardian dynamic)
npm run gate                     # أو: pnpm gate

# كل الفحوص (static + dynamic ضد قاعدة PostgreSQL متاحة)
pnpm db:guardian                 # أو: npm run db:guardian
DB_URL=postgresql://… pnpm db:guardian          # ضد أي قاعدة (مثلاً Supabase الحية)
pnpm db:guardian -- --mode static               # فحوص الملفات فقط (بدون قاعدة)
pnpm db:guardian:snapshot        # إعادة توليد snapshots العقد (expected-schema,
                                 # migration-hashes, applied-baseline)
pnpm db:guardian -- --fail-on CRITICAL          # تغيير حد المنع (الافتراضي HIGH)
pnpm db:guardian -- --skip G-WRITE-PATHS        # استثناء فحص معيّن
```

**الخروج غير الصفري** عند وجود أي FAIL بدرجة ≥ `--fail-on` (الافتراضي `HIGH`).

في بيئة التطوير المحلية بدون Supabase CLI/Docker، شغّل حارس PostgreSQL محلياً
ثم وجّه Guardian إليه:

```bash
# scratch harness خارج المستودع (npm-only egress sandbox):
#   node start-pg.mjs          → PostgreSQL 18 على المنفذ 5433 (postgres/postgres)
DB_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres pnpm db:guardian
```

في CI، يشغّل `.github/workflows/guardian.yml`:
1. **static** (بدون قاعدة) على أي PR يلمس `supabase/**`, `guardian/**`,
   `package.json`, أو `src/lib/database.types.ts`.
2. **dynamic** عبر Supabase stack كامل: `supabase db reset` + `supabase test db`
   (السلطة النهائية لـ pgTAP) + `pnpm db:guardian`.

**أي تغيير مستقبلي للقاعدة** (migration/RPC/RLS/types) سيشغّل Guardian تلقائياً
ويمنع الدمج عند وجود CRITICAL/HIGH.

---

## المخرجات (Report)

كل تشغيل يكتب إلى `guardian/reports/latest/`:

| ملف | المحتوى |
| --- | --- |
| `report.json` | التقرير machine-readable: findings كاملة (id, check, severity, status, title, evidence) |
| `summary.md` | ملخص PASS/FAIL حسب الدرجة + تفاصيل كل FAIL |
| `findings.csv` | نفس الـ findings بصيغة CSV |
| `inventory.md` / `inventory.json` | الجرد الكامل: tables, columns/types, constraints, indexes, views, triggers, functions/RPCs, RLS policies, SECURITY DEFINER |
| `write-paths.md` / `write-paths.json` | خريطة Frontend → RPC → table → trigger → function |

**حالة كل فحص:** `PASS` أو `FAIL` مع `severity` (`CRITICAL/HIGH/MEDIUM/LOW/INFO`)
و`finding ID` وأدلة (`evidence`) قابلة للتتبع.

---

## الفحوص (Checks)

### Static — بلا قاعدة بيانات
| ID | ماذا يفحص |
| --- | --- |
| `G-MIGRATION-IMMUTABILITY` | SHA-256 لكل migration مقابل `contract/migration-hashes.json`. تعديل migration مطبَّق = **CRITICAL**؛ الإصلاح دائماً migration جديد. |
| `G-MIGRATION-HYGIENE` | أنماط ممنوعة على مستوى البيانات: float للنقود، DROP/DELETE لجدول مالي/رئيسي، منح `anon` غير مُلغاة لاحقاً، SECURITY DEFINER بدون `search_path`، تكرار أرقام الترتيب. |
| `G-WRITE-PATHS` | كل عملية business لها مسار كتابة واحد: يستخرج RPCs المُستدعاة من الواجهة، الجداول التي تكتبها (من جسم الدالة)، والكتابات المباشرة من العميل، ويقارنها بقائمة `writePaths.allowedDirectClientWrites` في العقد. |

### Dynamic — ضد قاعدة معاد تشغيلها (scratch) أو أي قاعدة مستهدفة
| ID | ماذا يفحص |
| --- | --- |
| `G-INVENTORY` | الجرد الكامل (فوق). |
| `G-SCHEMA-DRIFT` | Git migrations ↔ expected-schema.json ↔ actual schema. جدول ناقص = CRITICAL؛ عمود/قيد/فهرس ناقص = HIGH/MEDIUM؛ أي تغيير في migrations بدون تحديث snapshot = HIGH. |
| `G-FUNCTION-ACL` | كل SECURITY DEFINER: `search_path` مثبّت، لا ACL افتراضي (PUBLIC)، لا تنفيذ من `anon`، ودالة تكتب بدون guard = CRITICAL. |
| `G-VIEW-SECURITY` | كل view إمّا `security_invoker=true` أو مُفلتر org في جسمه؛ view بلا الاثنين = CRITICAL (تسريب عابر للمنظمات). |
| `G-RLS-INTEGRITY` | RLS مفعّل على كل جدول، لا سياسات DELETE على المالي/الرئيسي، لا منح anon، FKs بين جداول org-scoped تشمل `organization_id`. |
| `G-DATA-INTEGRITY` | orphans / broken FKs، علاقات عابرة للمنظمات، تكرار سجلات business، حالات مستحيلة (إغلاق مع outstanding، سالب، check-out قبل check-in)، انتقالات حالة غير صالحة. |
| `G-FINANCIAL-INTEGRITY` | النقود NUMERIC حصراً (scale 3)، reconciliation invoices/payments/installments، منع overpayment، كشف double posting، عدم قابلية تعديل المستندات المعتمدة، منع hard-delete، تفرد أرقام المستندات لكل منظمة، idempotency. |
| `G-MIGRATION-GUARDIAN` | إعادة التشغيل من قاعدة فارغة + تشغيل migrations الجديدة فوق الحالة القريبة من الحالية (`applied-baseline.json`). |
| `G-TENANT-ISOLATION` | تنفيذ كل `supabase/tests/*.test.sql` عبر shims النهج الأصلي (و`supabase test db` في CI هو السلطة). |

## بوابة الإصدار المحمولة (Portable Release Gate)

`npm run gate` (`scripts/release-gate.mjs`) يعمل في أي بيئة، مع أو بدون قاعدة:
1. `typecheck` · 2. `lint` · 3. `npm test` · 4. `build` · 5. Guardian static —
   ثم، إذا كانت قاعدة PostgreSQL متاحة (`DB_URL` أو المحلية): إعادة تشغيل
   migrations + كل pgTAP + Guardian dynamic. النتيجة:
   `guardian/reports/latest/release-gate.json` (machine-readable) وخروج 0/1.
   نفس الخطوات هي ما ينفذه `.github/workflows/guardian.yml` + `ci.yml` في GitHub
   Actions — أي أن التحقق مستقل عن CI. الأعمال الاختيارية تُسجَّل `SKIPPED`
   ولا تُعدّ فشلاً.

---

## اختبارات pgTAP الجديدة (supabase/tests/)

| الملف | يثبت |
| --- | --- |
| `guardian_schema_contract.test.sql` | العقد البنيوي: RLS، النقود الدقيقة، ACL الخاص بـ SECURITY DEFINER (لا anon)، views مفلترة org، تفرد أرقام المستندات، FKs org-scoped. |
| `guardian_tenant_isolation.test.sql` | سلوكياً: Company A لا تقرأ/تعدل Company B عبر SELECT/INSERT/UPDATE/DELETE/RPCs/Views/SECURITY DEFINER، وحراس append-only على مستوى القاعدة. |
| `guardian_financial_integrity.test.sql` | reconciliation، overpayment، double posting، جمود المستندات المعتمدة، منع hard-delete (expenses/closures/audit)، دقة OMR. |
| `guardian_data_integrity.test.sql` | منع orphans وcross-org عبر FKs المركبة، الحالات المستحيلة، انتقالات الحالة غير الصالحة، فحوص الكشف على بيانات نظيفة. |

---

## العقد (Canonical Database Contract)

`contract/canonical-contract.json` هو مصدر الحقيقة الآلي. أهم القواعد:

- **النقود:** NUMERIC فقط، scale 3، أبداً float. الأسعار الوحدوية `numeric(12,3)`
  والمجاميع المشتقة `numeric(14,3)`.
- **العزل:** RLS على كل جدول؛ FKs بين جداول org-scoped تشمل `organization_id`؛
  لا منح `anon`؛ كل view إمّا invoker أو مفلتر org.
- **المالي:** مستندات معتمدة غير قابلة للتعديل؛ ledgers append-only؛ لا hard-delete؛
  رقم مستند فريد لكل منظمة؛ منع overpayment وdouble posting؛ idempotency للأوامر.
- **الترحيلات:** خالدة بعد التطبيق؛ أي إصلاح = migration جديد؛ إعادة تشغيل من فارغ
  وعلى الحالة القريبة من الحالية؛ كل تغيير له اختبار regression.

`migration-hashes.json` و`expected-schema.json` و`applied-baseline.json` تُولَّد
بأمر `db:guardian:snapshot` من إعادة تشغيل نظيفة، ويجب أن تتطابق مع الـ migrations
في أي PR (وإلا يفشل `G-SCHEMA-DRIFT`).

---

## الإصلاح (Fix Protocol)

عند اكتشاف مشكلة:
**Finding → Evidence → Root Cause → failing regression test → أصغر إصلاح صحيح →
Guardian كامل → مراجعة مستقلة.**

لا يُصلَح أي شيء حساس بالتخمين. الاختبار الفاشل يُكتب أولاً (يثبت العيب على
الحالة الحالية)، ثم يُطبَّق الإصلاح حتى يمر الكل.

## قواعد صارمة

- لا تعديل على Production مباشرة؛ الاختبارات التدميرية على قواعد Test/ephemeral فقط.
- لا حذف بيانات.
- لا إنشاء Supabase preview/experimental branch من تلقاء النفس.
- لا تعديل Business Logic سليم لمجرد تبسيط الاختبارات.
- لا توسيع النطاق إلى redesign أو frontend غير مرتبط بالقاعدة.
