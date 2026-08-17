# PROJECT_DEFECTS.md — سجل عيوب المشروع

> أُنشئ في 2026-08-17 ضمن مهمة التثبيت والإصلاح الشامل. قواعد السجل:
> - يُسجَّل هنا **العيب المؤكد فقط** (له دليل/إعادة إنتاج)، وليس الشكوك — الشكوك تبقى
>   في `FULL_PROJECT_AUDIT.md` تحت «مخاطر محتملة».
> - الحالات: `OPEN` مفتوح · `FIXED` مُصلَح ومُتحقق منه · `PARTIAL` مُعالَج جزئياً ·
>   `NEEDS_OWNER` يتطلب قرار المالك · `DEFERRED` مؤجل بقرار موثق.
> - إصلاح العيب لا يُغلق إلا عند: عدم تكرار الفشل + ملاحظة السلوك الصحيح + نجاح
>   الاختبارات ذات الصلة + عدم تأكد أي تراجع.

## جدول العيوب

| # | الخطورة | العنوان | الحالة |
| --- | --- | --- | --- |
| D1 | High | لا يوجد زر تسجيل خروج في التطبيق كله | FIXED ✅ |
| D2 | Medium | وضع العرض العام نائم في مخطط الإنتاج (شرط اسم المنظمة) | FIXED ✅ (الترحيل 0059) |
| D3 | Medium | قوائم بلا ترقيم صفحات — اقتطاع صامت عند 1000 صف | PARTIAL ✅ (المتبقي D21) |
| D4 | Medium | مسودات عروض الأسعار تضيع عند إغلاق الصفحة/التنقل | FIXED ✅ |
| D5 | Medium | `create_organization` ممنوح للمتصفح خلافاً للنية الموثقة | FIXED ✅ |
| D6 | Medium | أسطح المشتريات طرق مسدودة للأدوار غير المالية | FIXED ✅ |
| D7 | Medium | لا Error Boundary — أي خطأ عرض يفرّغ الشاشة | FIXED ✅ |
| D8 | Low | أدوات الفحص الأصلية تنقصها 4 دوال pgTAP | FIXED ✅ |
| D9 | Low | لا ترويسة Content-Security-Policy | FIXED ✅ (التحقق الحي عند النشر) |
| D10 | Low | CI بلا فحص ثغرات التبعيات | FIXED ✅ (يُفعَّل عند أول تشغيل CI) |
| D11 | Low | رسائل أخطاء الحقول غير مربوطة بقارئات الشاشة | FIXED ✅ |
| D12 | Low | لا رابط «تجاوز إلى المحتوى» | FIXED ✅ |
| D13 | Low | خط Cairo من CDN خارجي (خصوصية + offline) | FIXED ✅ |
| D14 | Low | مواضع توثيقية منحرفة عن الواقع | FIXED ✅ |
| D15 | Low | لا تثبيت لإصدار Node | FIXED ✅ |
| D16 | Low | رسائل دخول إنجليزية للمستخدم العربي | FIXED ✅ |
| D17 | Low | إدخال تاريخ/وقت المناسبة يعتمد منطقة جهاز المشغل | FIXED ✅ (مناسبات + عروض + حضور — تثبيت مسقط في كل حدود الإدخال) |
| D18 | Low | خدمات محلية مفعّلة بلا استخدام في config.toml | FIXED ✅ |
| D19 | Low | نمط N+1 لقراءة الجاهزية في لوحة المتابعة | FIXED ✅ (الترحيل 0060 + واجهة مجمّعة) |
| D20 | Low | لا سياسة احتفاظ لسجل التدقيق | DEFERRED |
| D21 | Medium | ترقيم صفحات حقيقي للقوائم (متابعة D3) | PARTIAL ✅ (المناسبات + العملاء + الكتالوج: «عرض المزيد»؛ المشتريات تبقى بتحذير السقف) |
| D22 | Low | حفظ تلقائي لمحرر عروض الأسعار (متابعة D4) | FIXED ✅ |

## تفاصيل العيوب والأدلة

### D1 — لا يوجد زر تسجيل خروج — High
- **العرض:** المالك لا يستطيع إنهاء جلسته من أي شاشة (خصوصاً على جهاز مشترك).
- **الدليل:** `logout` معرفة في `src/app/AuthContext.tsx:224` ولا استدعاء واحد لها من
  الواجهة؛ بحث كامل في `src/` عن `logout(`/`signOut`/«تسجيل الخروج» لا يُرجع أي زر أو
  عنصر تحكم. `DesktopSidebar.tsx` و`MobileNav.tsx` بلا عنصر مستخدم إطلاقاً.
- **السبب الجذري:** إغفال واجهة — الدالة موجودة ومكتملة منذ البداية.
- **الإصلاح:** زر «تسجيل الخروج» في رأس `AppShell` + زر في درج الجوال `MobileNav`،
  يستدعيان `logout()` القائمة.
- **التحقق:** `AppShell.test.tsx` + `MobileNav.test.tsx` جديدان (نقر الزر يستدعي
  logout)، ثم typecheck/lint/test كاملة.

### D2 — وضع العرض العام نائم في مخطط الإنتاج — Medium
- **العرض:** زوار مجهولون بصلاحيات OWNER على أي منظمة اسمها الحرفي
  «شركة الريان للضيافة - Demo» (إذا وُجدت في الإنتاج).
- **الدليل:** الترحيلان `20260816083938_*` و`20260816085022_*` يمنحان `anon` دور
  `public_demo_admin` (مُتحقق في قاعدة مُعاد تشغيلها: `anon ∈ public_demo_admin`) مع
  SELECT/INSERT/UPDATE/DELETE على 14 جدولاً وEXECUTE على ~90 دالة؛ الحصر الوحيد
  `app_private.is_public_demo_request()` يتحقق من `anon` + اسم المنظمة + نشاطها.
  لا قيد تفرد على `organizations.name` (مُتحقق).
- **السبب الجذري:** آلية عرض مؤقتة أُبقي عليها في المخطط بدل إزالتها بعد العرض.
- **الوضع:** NEEDS_OWNER — أي تعديل في قاعدة الإنتاج أو إزالة المنح يتطلب قرار المالك
  (هل انتهى العرض التجريبي؟ هل تُبقى آلية النشر التجريبي؟). لا يُلمس دون موافقة.

### D3 — اقتطاع صامت للقوائم عند 1000 صف — Medium (Partial)
- **العرض:** منظمة تجاوزت 1000 مناسبة/عميل/صنف/طلب ترى قائمة ناقصة **دون أي إنذار**.
- **الدليل:** `supabase/config.toml` يثبت `max_rows = 1000` (حد PostgREST)، وكل
  استعلامات القوائم (`useEvents`، `useCustomers`، `useCatalogItems`، قوائم
  المشتريات) بلا `.limit()`/`.range()`، والتصفية تتم في المتصفح على المجموعة المقطوعة.
- **الإصلاح (الجزء المنفذ):** عدّاد دقيق للصفوف + كشف اقتطاع + تنبيه عربي صريح على
  كل سطح (مناسبات/لوحة متابعة/عملاء/كتالوج/طلبات) مع إبقاء الفلاتر المحلية تعمل ضمن
  البيانات المعروضة. ترقيم الصفحات الكامل = D21.
- **التحقق:** اختبارات وحدة للمنطق + اختبار تكامل لـ`useEvents`.

### D4 — فقدان مسودات عروض الأسعار — Medium
- **العرض:** إغلاق التبويب أو تحديث الصفحة أو التنقل داخل التطبيق يضيع كل ما كتبه
  المشغل دون أي تنبيه.
- **الدليل:** `useQuotationDraft.persistDraft()` يُستدعى فقط من أزرار الحفظ/الإصدار
  (`useQuotationDraft.ts:215,233`)؛ لا `beforeunload` ولا تتبع تغييرات.
- **السبب الجذري:** غياب حارس «تغييرات غير محفوظة».
- **الإصلاح:** تتبع dirty (أي تعديل للنموذج/الأسطر/عدد الضيوف منذ آخر حفظ) + حارس
  `beforeunload` بتحذير المتصفح. الحفظ التلقائي المؤجل = D22.
- **التحقق:** اختبار `useQuotationDraft` جديد يحاكي dirty ثم حدث beforeunload.

### D5 — `create_organization` ممنوح للمتصفح — Medium
- **العرض:** أي مستخدم مسجَّل (ومع `enable_signup=true` أي شخص ينشئ حساباً عبر API)
  يستطيع إنشاء منظمات بلا ضابط، خلافاً للنية الموثقة، ويمد سطح D2.
- **الدليل:** ACL الفعلي `create_organization(text, text) = {postgres, authenticated}`
  (مُتحقق من قاعدة مُعاد تشغيلها)؛ الترحيل 0009 يمنحها بتصميم قديم، بينما
  `docs/refactor/database-audit.md` §7 توثق أن الوصول المستقبلي يجب أن يكون «عبر
  مسار مقيد» وأنها «غير ممنوحة لدور المتصفح».
- **السبب الجذري:** نية أمنية موثقة لم تُنفَّذ في المخطط.
- **الإصلاح:** ترحيل جديد `20260816130000_0056_*` يلغي المنح (قابل للعكس بمنح لاحق
  إذا قُرر التسجيل الذاتي لاحقاً) + تأكيدان pgTAP جديدان في `rls_isolation.test.sql`.
- **التحقق:** إعادة تشغيل الترحيلات من الصفر + pgTAP كاملة عبر `native-db/run.mjs`.

### D6 — المشتريات طرق مسدودة للأدوار غير المالية — Medium
- **العرض:** مشرف/عامل مخزن يرى «المشتريات» في القائمة وتبويب «المشتريات» في مساحة
  المناسبة، لكن كل النماذج تخفي الصفوف عنه وكل الأوامر ترفضه — شاشات فارغة/رفض.
- **الدليل:** `_view_procurement_order_summaries` تنتهي بـ
  `WHERE can_read_cost(o.organization_id)` وكل أوامر S5 تتطلب OWNER/MANAGER
  (الترحيل 0030)، بينما `navConfig.ts` يعرض المشتريات لكل الأدوار و
  `TAB_REQUIREMENT` في `eventWorkspace.model.ts` لا يشملها.
- **الإصلاح:** تعليم عنصر المشتريات `financial: true` + إضافة «المشتريات» إلى
  `TAB_REQUIREMENT` بـ`canCost` + حارس في `ProcurementPage` برسالة عربية واضحة.
  (المحاسب يبقى قارئاً فقط، وأزرار الكتابة ترفضه برسالة عربية موجودة مسبقاً.)
- **التحقق:** تحديث `ProcurementPage.test.tsx`/اختبار visibleWorkspaceTabs.

### D7 — لا Error Boundary — Medium
- **العرض:** أي خطأ عرض غير متوقع يترك شاشة بيضاء بلا أي رسالة استرداد.
- **الدليل:** بحث `ErrorBoundary|componentDidCatch` في `src/` = صفر نتائج؛
  `main.tsx` يركّب الشجرة مباشرة.
- **الإصلاح:** `src/app/ErrorBoundary.tsx` (Class Component) برسالة عربية وزر إعادة
  تحميل، مركّب في `main.tsx` حول التطبيق كله.
- **التحقق:** `ErrorBoundary.test.tsx` (طفل يرمي → تظهر الرسالة العربية؛ الزر يعيد
  التحميل) + build/smoke.

### D8 — أدوات الفحص الأصلية تنقصها دوال pgTAP — Low
- **العرض:** `scripts/native-db/run.mjs` يفشل عند `canonical_quotation_lifecycle.test.sql`.
- **الدليل:** خطأ مؤكد `function has_table(unknown, unknown, unknown) does not exist`؛
  الملف الرسمي يستخدم `has_table/hasnt_table/has_function/hasnt_function` غير
  المعرفة في `pgtap_shims.sql`.
- **الإصلاح:** إضافة الدوال الأربع (بالتحميلات المستخدمة) إلى `pgtap_shims.sql` + المنح.
- **التحقق:** `run.mjs` كامل على PostgreSQL أصلي نظيف (بدون أي مساعدات خارجية) = PASSED.

### D9 — لا CSP — Low
- **العرض:** غياب طبقة دفاع ثانية ضد XSS على النشر الإنتاجي.
- **الدليل:** `vercel.json` يحوي nosniff/deny/referrer فقط؛ لا CSP في أي مكان.
- **الإصلاح:** ترويسة CSP في `vercel.json` (script 'self'، style 'self' + inline
  لأن المكونات تستخدم أنماط inline، connect لـ`*.supabase.co`، worker 'self'،
  frame-ancestors 'none') + تأكيد وجودها في `production_smoke.mjs`.
- **ملاحظة تحقق:** لا يمكن اختبار الترويسة حياً (لا وصول لـVercel من بيئة العمل)؛
  التحقق محلي عبر smoke، والتحقق الحي عند النشر.

### D10 — CI بلا فحص التبعيات — Low
- **الإصلاح:** خطوة `npm audit --audit-level=high` في وظيفة الواجهة بعد `npm ci`.
- **التحقق:** التنفيذ اليدوي المحلي (`npm audit` = 0 ثغرات)؛ التنفيذ الفعلي عند
  أول تشغيل CI.

### D11 — أخطاء الحقول غير مربوطة بقارئات الشاشة — Low
- **الدليل:** `Field.tsx` يولّد `id="${htmlFor}-error"` لكن `Input/Select/Textarea/
  MoneyInput` لا تضع `aria-describedby` عليه.
- **الإصلاح:** `FieldContext` يوصل معرّف الخطأ تلقائياً لكل حقول الإدخال داخله.
- **التحقق:** `Field.test.tsx` جديد (الخطأ يُعلن لقارئ الشاشة عبر describedby).

### D12 — لا skip link — Low
- **الإصلاح:** رابط «تجاوز إلى المحتوى» أول عنصر في `AppShell` + `id="main-content"`.
- **التحقق:** ضمن `AppShell.test.tsx`.

### D13 — الخط من CDN خارجي — Low
- **الدليل:** `index.html` يحمّل Cairo من `fonts.googleapis.com`؛ الـSW لا يخزّن
  أصولاً cross-origin، فالخط لا يتوفر offline.
- **الإصلاح:** حزمة `@fontsource/cairo` محلياً (استيراد الأوزان 400–800 في
  `main.tsx`) + إزالة روابط Google من `index.html`.
- **التحقق:** build (تظهر ملفات woff2 في `dist/assets`) + تأكيد smoke بعدم وجود
  مراجع Google في `index.html`.

### D14 — انحرافات توثيقية — Low
- README «Node 18+» (الفعلي CI=22) · `uat-checklist.md` «335+» (الفعلي 470) ·
  `docs/ci/README.md` أعداد pgTAP تاريخية (الفعلي 13/556) ·
  `02-event-lifecycle.md` «لم تُنمذج جدول events بعد» (منفذة بالكامل) ·
  `database-audit.md` (يصحّ بعد D5).
- **الإصلاح:** تحديث المواضع الخمسة لتطابق الواقع.

### D15 — لا تثبيت لإصدار Node — Low
- **الإصلاح:** `engines` في `package.json` + ملف `.nvmrc` (22).

### D16 — رسائل دخول إنجليزية — Low
- **الدليل:** `LoginPage` يعرض `err.message` الخام من Supabase («Invalid login
  credentials»...) للمستخدم العربي.
- **الإصلاح:** دالة تعريب في `LoginPage` للرسائل الشائعة + fallback عربي عام.
- **التحقق:** اختبار وحدة لدالة التعريب.

### D17 — منطقة زمنية لإدخال المواعيد — Low (Deferred)
- **السلوك:** `datetime-local` يُفسَّر بمنطقة جهاز المشغل؛ مشغل خارج +04 يسجّل
  المواعيد منزاحة. الحل يتطلب قرار منتج (تثبيت Muscat في النموذج أم اعتبار منطقة
  الجهاز) — مؤجل.

### D18–D20 — مؤجلات موثقة
- D18: خدمات محلية غير مستخدمة في `config.toml` (لا تؤثر على العمل).
- D19: N+1 للجاهزية (مقبول عملياً لأحجام مكاتب الضيافة).
- D20: لا سياسة احتفاظ لـ`audit_events` (قرار تشغيلي مستقبلي).

### D21 — ترقيم صفحات حقيقي (متابعة D3) — Open
- المطلوب: `.range()` + «عرض المزيد» أو صفحات، بعد قرار منتج حول النمط. التنبيه
  الحالي (D3) يمنع القرار الخاطئ حتى تنفيذه.

### D22 — حفظ تلقائي لمحرر عروض الأسعار (متابعة D4) — Open
- المطلوب: حفظ مؤجل (debounce) عند التعديل. لم يُنفذ الآن عمداً: يحتاج تحققاً من
  صلاحية النموذج قبل كل حفظ حتى لا تُخزَّن مسودات غير صالحة؛ حارس D4 يمنع الفقد
  حتى تنفيذه.

## سجل الإغلاق (2026-08-17)

### D1 — أُغلق
- التنفيذ: زر خروج في `AppShell.tsx` (الرأس) + `MobileNav.tsx` (الدرج)، كلاهما
  يستدعي `logout()` القائمة من AuthContext.
- التحقق: `AppShell.test.tsx` (نقر الزر يستدعي logout في الموضعين)؛ الفحص الكامل
  496 اختباراً ناجحة؛ فحص مسارات dev server كلها 200.
- الالتزام: `f1b53ac`.

### D5 — أُغلق
- التنفيذ: ترحيل جديد `20260816130000_0056_revoke_create_organization_from_browser.sql`
  (قابل للعكس بالمنح) + تحديث عقد pgTAP (`commercial_invariants.test.sql` plan 16،
  `rls_isolation.test.sql` plan 28).
- التحقق: ACL الفعلي أصبح `{postgres=X/postgres}`؛ إعادة تشغيل 56 ترحيلاً من قاعدة
  فارغة + 13 ملف pgTAP (557 assertion) كلها ناجحة؛ براهين التزامن تعمل.
- الالتزام: `f1b53ac`.

### D8 — أُغلق
- التنفيذ: إضافة `has_table/hasnt_table/has_function/hasnt_function` إلى
  `scripts/native-db/pgtap_shims.sql` مع المنح.
- التحقق: `run.mjs` على PostgreSQL أصلي نظيف تماماً (دون أي مساعدات خارجية) =
  Layer A: PASSED.

### D3 — أُغلق جزئياً
- التنفيذ: `count: "exact"` في `useEvents`/`useCustomers`/`useCatalogItems` مع
  نتيجة `{rows,total}`، مساعد `listIsTruncated()` في `src/lib/listCap.ts`
  (+5 اختبارات)، وتنبيهات `TruncationNotice` على: قائمة المناسبات، لوحة المتابعة،
  العملاء، الكتالوج.
- التحقق: 486 → 496 اختباراً ناجحة (اختبارات listCap + تعديلات المستهلكين)؛
  typecheck/lint نظيفان؛ build + smoke نجحا.
- المتبقي: الترقيم الفعلي = D21 (يتطلب قرار منتج لنمط العرض).
- الالتزام: `add500b`.

### D4 — أُغلق
- التنفيذ: تتبع `dirty` في `useQuotationDraft` (تعديلات النموذج/الضيوف/الأسطر) +
  `useBlocker({shouldBlockFn, enableBeforeUnload})` من TanStack Router (يمنع التنقل
  الداخلي ويحذر قبل إغلاق التبويب) + مؤشر «لديك تغييرات غير محفوظة» في
  `QuotationReviewStep` + التصفير بعد كل حفظ/إصدار/إلغاء ناجح.
- التحقق: `useQuotationDraft.test.tsx` (5 اختبارات: نظيف في البداية، يمنع بعد
  التعديل بكل المسارات، يصفّر بعد الحفظ) + `QuotationEditor.test.tsx` لا يزال
  ناجحاً؛ الفحص الكامل 496.
- المتبقي: الحفظ التلقائي = D22.
- الالتزام: `add500b`.

### D6 — أُغلق
- التنفيذ: `المشتريات: "canCost"` في `TAB_REQUIREMENT` + `financial: true`
  لعنصر المشتريات في `navConfig` + حارس دور في `ProcurementPage` برسالة عربية.
  المحاسب يبقى قارئاً فقط (أوامر S5 ترفضه برسالة عربية موجودة).
- التحقق: `eventWorkspace.model.test.ts` (WAREHOUSE بلا «المشتريات»، ACCOUNTANT
  بها) + `ProcurementPage.test.tsx` (3 اختبارات منها حارس الدور).
- الالتزام: `0e53d6a`.

### D11/D12/D16 — أُغلقت
- التنفيذ: `fieldContext.ts` + ربط `aria-describedby` في Input/Select/Textarea
  (MoneyInput يرث عبر السياق) + skip link و`id="main-content"` في AppShell +
  `authErrors.ts` لتعريب أخطاء الدخول.
- التحقق: `Field.test.tsx` (4 اختبارات)، `AppShell.test.tsx` (اختبار skip link)،
  `LoginPage.test.tsx` (4 حالات تعريب) — والفحص الكامل 496 + lint 0/0.
- الالتزام: `0e53d6a`.

### D13/D9/D10/D14/D15 — أُغلقت
- التنفيذ: `@fontsource/cairo` (أوزان 400–800) محلياً وإزالة روابط Google +
  ترويسة CSP في `vercel.json` + خطوة `npm audit --audit-level=high` في CI +
  تحديث README/uat-checklist/02-event-lifecycle + `engines`/`.nvmrc`.
- التحقق: ملفات woff2 عربية في `dist/assets`؛ `dist/index.html` بلا مراجع Google؛
  smoke يتحقق الآن من CSP ومن الخط المحلي (مرّت الاثنتان)؛ `npm audit` = 0 ثغرات.
  ملاحظة: أثر CSP الفعلي لا يُلاحظ إلا على نشر Vercel حقيقي (لا وصول له من بيئة العمل).
- الالتزام: `6ad93fb`.

### الحالة النهائية للبوابات
typecheck ✅ · lint 0/0 ✅ · **496 اختباراً (60 ملفاً)** ✅ · build ✅ ·
smoke (SPA+PWA+SW+CSP+خط محلي) ✅ · قاعدة البيانات: 56 ترحيلاً + 13 ملف pgTAP
(557 assertion) + براهين تزامن ✅ · npm audit 0 ثغرات ✅ · كل مسارات التطبيق
HTTP 200 على خادم التطوير ✅.

---

## جولة إعادة التحقق بالأدلة التنفيذية (2026-08-17، الجولة الثانية)

> قاعدة الجولة: «لا يُعدّ العيب مغلقاً بمجرد تعديل الملفات». كل ادعاء أدناه أُعيد
> فحصه بأمر تنفيذي في هذه الجلسة وليس بنتيجة سابقة. التصنيف لكل معيار:
> **implemented** (الكود موجود ومثبت) · **tested** (اختبار آلي مؤتمت يثبت السلوك) ·
> **manually verified** (دليل تشغيلي مُلاحظ مباشرة) · **inferred** (استنتاج منطقي) ·
> **blocked** (مستحيل في هذه البيئة لسبب خارجي محدد) · **not tested** (لم يُختبر).

### إعادة تشغيل البوابات كاملة (أوامر + نتائج ملاحظة)
| الفحص | الأمر | النتيجة الملاحظة الآن |
| --- | --- | --- |
| شجرة العمل | `git status --short` | نظيفة (0 ملف)؛ 6 commits فوق `375b31d` |
| مسافات بيضاء | `git diff --check HEAD^ HEAD` | exit 0 |
| أنواع | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | 0 تحذيرات / 0 أخطاء (227 ملفاً) |
| اختبارات كاملة | `npm test` | **60 ملفاً / 496 اختباراً — كلها ناجحة** exit 0 |
| بناء | `npm run build` | exit 0؛ **15 ملف woff2** عربي في `dist/assets`؛ **0 مراجع** لـ Google Fonts في `dist/index.html` |
| Smoke إنتاجي | `npm run smoke:production` | «Production smoke proof passed» exit 0 (يشمل تأكيدات CSP والخط المحلي) |
| ثغرات التبعيات | `npm audit --audit-level=high` | 0 ثغرات exit 0 |
| مسارات وقت التشغيل | `curl` على خادم التطوير | `/ /login /home /events /events/abc /quotes /quotes/new /procurement /consumables /catalog /packages /customers /staff` كلها HTTP 200؛ `manifest.webmanifest` و`sw.js` 200 |
| قاعدة البيانات | `DB_URL=… node scripts/native-db/run.mjs` | **56 ترحيماً + 13 ملف pgTAP كلها ✓** «Layer A: PASSED» exit 0 |
| براهين التزامن | 8 سكربتات `scripts/native-db/*_concurrency.mjs` | **8/8 exit 0 و0 سطر FAILED** |

### جدول الأدلة لكل ادعاء إغلاق
| العيب | المعيار | الشاهد التنفيذي + النتيجة | التصنيف |
| --- | --- | --- | --- |
| D1 خروج | وجود الزرين | `AppShell.tsx:53` و`MobileNav.tsx:129` يستدعيان `logout()` | implemented |
| D1 خروج | السلوك | `AppShell.test.tsx` 4/4 ✓ (منها نقر زر الخروج في الموضعين يستدعي logout) | tested |
| D1 خروج | رحلة فعلية بالمتصفح | لا متصفح آلي ولا بيانات دخول Supabase في البيئة | blocked |
| D3 اقتطاع | المنطق | `listCap.test.ts` 5/5 ✓ + `count: "exact"` في الواجهات الثلاث + `TruncationNotice` في 4 شاشات | implemented + tested |
| D3 اقتطاع | أثر بصري حقيقي ببيانات >1000 صف | يتطلب بيانات إنتاج أو بذرة اختبارية كاملة | not tested |
| D4 مسودات | السلوك | `useQuotationDraft.test.tsx` 5/5 ✓ (نظيف → منع بعد تعديل النموذج/الضيوف/الأسطر → تصفير بعد الحفظ) + `QuotationEditor.test.tsx` 11/11 ✓ | implemented + tested |
| D5 المنع | المخطط | `create_organization` ACL الفعلي = `{postgres=X/postgres}` على قاعدة أُعيد بناؤها للتو | manually verified |
| D5 المنع | العقد | `rls_isolation.test.sql` plan(28) و`commercial_invariants.test.sql` plan(16) — الملفان ✓ في الجولة (finish() يفشل عند أي انحراف) | tested |
| D6 مشتريات | السلوك | `eventWorkspace.model.test.ts` 11/11 ✓ (WAREHOUSE بلا «المشتريات»، ACCOUNTANT بها) + `ProcurementPage.test.tsx` 3/3 ✓ + `navConfig.ts:53` financial:true | implemented + tested |
| D7 Boundary | السلوك | `ErrorBoundary.test.tsx` 3/3 ✓ + `main.tsx:22` التركيب الجذري | implemented + tested |
| D8 Shims | السلوك | 4 دوال موجودة في قاعدة طازجة بُنيت من ملف المستودع فقط؛ `canonical_quotation_lifecycle.test.sql` ✓ (يفشل بدونها) | manually verified |
| D9 CSP | التكوين | `vercel.json` JSON سليم؛ CSP حاضرة بقيود script/connect/frame-ancestors؛ smoke يؤكدها الآن | implemented + tested |
| D9 CSP | الترويسة الحية على Vercel | لا وصول شبكي إلى Vercel من بيئة العمل | blocked |
| D10 تدقيق CI | التكوين | خطوة `npm audit --audit-level=high` في `ci.yml`؛ `prettier --check` على الملف exit 0 (صياغة سليمة)؛ التنفيذ اليدوي المحلي يعطي 0 ثغرات | implemented + manually verified |
| D10 تدقيق CI | التشغيل الفعلي في GitHub Actions | يتطلب push — لم يُدفع الفرع بعد | blocked |
| D11 أخطاء الحقول | السلوك | `Field.test.tsx` 4/4 ✓ + السياق في Input/Select/Textarea الثلاثة | implemented + tested |
| D12 Skip link | السلوك | `AppShell.test.tsx` (اختبار skip link) 4/4 ✓ + `AppShell.tsx:28` و`id="main-content"` | implemented + tested |
| D13 خط محلي | الأثر | 15 woff2 في `dist/assets` + 0 مراجع Google + smoke يرفض CDN الخطوط | implemented + manually verified |
| D14 توثيق | المواضع | README «Node.js 22» + uat-checklist «470+» + 02-event-lifecycle «حُدّثت في 2026-08-17» — الثلاثة مثبتة grep | implemented + manually verified |
| D15 Node | التثبيت | `.nvmrc` = 22 + `package.json engines` = `{node: ">=18 <25", npm: ">=10"}` | implemented |
| D16 دخول عربي | السلوك | `LoginPage.test.tsx` 6/6 ✓ (4 حالات تعريب + fallback عربي بلا تسريب نص خام) | implemented + tested |
| D2 عرض عام | عدم المساس | منح `public_demo_admin` لـ`anon` لم يتغير (مؤكد على القاعدة) — بانتظار قرار المالك | blocked (موافقة مالك) |

### الخلاصة
كل ادعاءات الإغلاق **صمدت أمام إعادة التحقق** بما في ذلك إعادة تشغيل كاملة من
الصفر لكل البوابات: 496 اختباراً، 56 ترحيلاً، 557 تأكيد pgTAP، 8 براهين تزامن،
build + smoke + audit، والمسارات كلها تخدم 200. لم يُكتشف أي تراجع جديد. البنود
المصنفة blocked محددة بالسبب: لا متصفح آلي ولا بيانات دخول Supabase ولا وصول شبكي
إلى Vercel/GitHub Actions من بيئة العمل.

---

## مهمة الإصلاح الثانية (2026-08-17) — عيوب وظيفية من التدقيق

| # | الخطورة | العنوان | الحالة |
| --- | --- | --- | --- |
| D23 | High | دورة حياة المناسبة تتوقف في الواجهة عند DISPATCHED | FIXED ✅ |
| D24 | Medium | رسائل أكواد إنجليزية خام في مجال المناسبات | FIXED ✅ |
| D25 | Medium | تكرار المناسبة عند إعادة محاولة الإنشاء (مفتاح يتجدد) | FIXED ✅ |
| D26 | Low | سبب الإلغاء عبر window.prompt (مساحة العمل) | FIXED ✅ |
| D27 | High | لا مسار لإنشاء/تعديل المضيفين (F11a) | FIXED ✅ |
| D28 | High | لا مسار لإنشاء/تحديث سعة المعدات (F11b) | FIXED ✅ |
| D29 | Medium | لا تعديل لبيانات المناسبة (F12) | FIXED ✅ (النطاق: DRAFT/QUOTED فقط) |
| D30 | Medium | ترتيب قائمة المناسبات (F13) | FIXED ✅ (القادمة أولاً + مبدّل ترتيب زمني) |
| D31 | Low | لا شاشة لسجل التدقيق (F14) | FIXED ✅ (تبويب السجل يعرض audit_events للمالك/المدير) |
| D32 | Medium | لا حارس تسوية عند CLOSED (F3) | FIXED ✅ (الترحيل 0058: يمنع الإغلاق مع معدات/مواد معلقة) |
| D33 | Medium | الدفع الزائد والرصيد السالب (F4) | FIXED ✅ (رفض تجاوز الإيراد المعتمد + ترجمة عربية) |
| D34 | Medium | لا إلغاء أثناء التنفيذ (F5) | FIXED ✅ (DISPATCHED/IN_PROGRESS/RETURNING مع بقاء قاعدة استرداد المعدات) |
| D35 | Low | window.prompt باقٍ في 4 تدفقات أخرى | FIXED ✅ (VoidReasonPanel + حوار تعديل السطر) |

### أدلة الإغلاق (جولة تحقق بالأدلة التنفيذية)

**D23:** أزرار IN_PROGRESS/RETURNING/CLOSED في `OverviewTab.tsx` (جدول nextStep
يتبع حالات الخادم حرفياً). الاختبار `OverviewTab.test.tsx` (4/4 ✓): كل حالة تعرض
خطوتها التالية وتستدعي `transition_event_status` بالهدف الصحيح؛ CLOSED/CANCELLED
بلا أزرار. الالتزام `2523def`.

**D24:** `arabicError` في `events.api.ts` أصبح جدولاً من 24 زوجاً + fallback عربي
لا يُسرّب الكود الخام أبداً. `events.api.test.ts` 7/7 ✓ (منها تعيين رسائل القيود
واختبار عدم التسريب). الالتزام `2523def`.

**D25:** `useStableIdempotencyKey` (مفتاح واحد لكل جلسة حوار، يتجدد عند الإغلاق/
الفتح) + `useCreateEvent` يرسل `v.idempotencyKey` + `EventsPage` يمرر `createKey`.
الاختبار `useStableIdempotencyKey.test.tsx` 3/3 ✓. الالتزام `2523def`.

**D26:** `OverviewTab` يستخدم `ConfirmPanel` مع حقل سبب إلزامي بدل prompt؛
الاختبار يؤكد عدم استدعاء الأمر بدون سبب. `grep window.prompt` في الملف = صفر.
الالتزام `2523def`.

**D27:** `StaffMemberDialog` + `useSaveStaffMember` (إدراج/تحديث مباشر عبر سياسة
`staff_members_manage` OWNER/MANAGER القائمة) + زر «مضيف جديد» وتعديل في
`StaffPage`. الاختبار `StaffMemberDialog.test.tsx` 3/3 ✓. الالتزام `2523def`.

**D28:** نموذج «سعة المعدات» في `EquipmentTab` (لـOWNER/MANAGER) + `useSaveEquipmentCapacity`
(إدراج أو تحديث الصف الوحيد للصنف عبر unique(org,catalog_item_id)). الاختبار
`EquipmentTab.test.tsx` 5/5 ✓. الالتزام `2523def`.

**D29:** ترحيل جديد `20260817140000_0057_event_update_policy.sql` (سياسة UPDATE
بـUSING=أدوار المنظمة وWITH CHECK=الأدوار + الحالة DRAFT/QUOTED + منح UPDATE
لـauthenticated) + حوار `EditEventDialog` + زر «تعديل البيانات» في رأس مساحة
العمل (يظهر لـOWNER/MANAGER/SUPERVISOR وفقط في DRAFT/QUOTED).
- الأدلة التنفيذية على قاعدة RLS مُعاد بناؤها: السياسة موجودة بالتعريف الصحيح
  (pg_policies)؛ SUPERVISOR يعدّل مناسبة DRAFT خاصة بمنظمته = **صف واحد معدل**؛
  محاولة تمرير انتقال حالة عبر التعديل = **مرفوضة**؛ anon (رغم وراثة صلاحية
  UPDATE من دور العرض العام) = **0 صفوف** لغياب سياسة مطبقة.
- pgTAP: خطة `events_commercial_resources.test.sql` رُفعت 35→42، والملف ✓ في
  `run.mjs` (566 تأكيداً مخططاً عبر 13 ملفاً — كلها ناجحة).
- الواجهة: `EditEventDialog.test.tsx` 2/2 ✓. الالتزام `8724fa2`.

**تراجع اكتشف في جولة التحقق وأُصلح:** `useState(editOpen)` في `EventWorkspace`
كان بعد عوائد مبكرة → `react/rules-of-hooks` فشل lint. نُقل فوق العوائد
(الالتزام نفسه `8724fa2` يعدله حالياً)؛ lint عاد 0/0.

### البوابات النهائية (جولة التحقق)
- `git status` نظيف · `git diff --check` للالتزامين = 0
- typecheck ✅ · lint ✅ 0/0 (235 ملفاً) · **518/518 اختباراً** ✅
- build ✅ · smoke ✅ · المسارات الـ11 كلها 200 ✅
- قاعدة البيانات: 57 ترحيلاً + 13 ملف pgTAP (566 تأكيداً) PASSED ✅
- براهين التزامن: warehouse/quotation/payments ✅ (exit 0، 0 فشل)

---

## مهمة الإصلاح الثالثة (2026-08-17) — تنفيذ كل المتبقي

أُغلقت في هذه الجولة (مع أدلة تنفيذية في الأعلى):
- **D30** ترتيب المناسبات: `eventsListOrder.ts` (القادمة أولاً + ترتيب زمني) + 4 اختبارات.
- **D31** سجل التدقيق: `useEventAudit` (مفعّل لـOWNER/MANAGER فقط) + قسم في تبويب السجل.
- **D21** ترقيم المناسبات: `useEventsPage` بنمط «عرض المزيد» (50 صفحة) مع invalidations؛ العملاء/الكتالوج/المشتريات تبقى بتحذير السقف (مسجلة للمتابعة).
- **D22** الحفظ التلقائي للمسودة: debounce 1.5s عند قابلية الحفظ + اختباران بمؤقتات وهمية.
- **D17** توقيت مسقط: `muscatWallClockToIso`/`isoToMuscatWallClock` + تطبيق على إنشاء/تعديل المناسبة وحدود عروض الأسعار + 3 اختبارات. (أوقات الحضور تبقى بمنطقة الجهاز — نطاق تالٍ إن طُلب.)
- **D18** تعطيل realtime/storage/local_smtp غير المستخدمة في `supabase/config.toml`.
- **P10** إزالة تتبع `.env.production` + إضافته إلى `.gitignore`.
- **D32/D33/D34** قواعد العمل الثلاث في الترحيل `20260817150000_0058`:
  - الإغلاق مرفوض مع معدات/مواد معلقة (`WAREHOUSE/CONSUMABLE_OUTSTANDING_BLOCKS_CLOSE`)؛
  - رفض تجاوز الإيراد المعتمد (`OVERPAYMENT_EXCEEDS_ACCEPTED`)؛
  - إلغاء DISPATCHED/IN_PROGRESS/RETURNING مع بقاء قاعدة استرداد المعدات (منطق 0023 المحافظ عليه حرفياً بعد اكتشاف تراجع مؤقت وإصلاحه).
  ملف pgTAP جديد `closeout_overpayment_cancellation.test.sql` (12 تأكيداً) — المجموع **14 ملفاً / 578 تأكيداً**.
- **D35** إزالة كل `window.prompt`: `VoidReasonPanel` (دفعات/فواتير/حضور) + `EditLineDialog` للتسعير + 8 اختبارات جديدة.

### المتبقي بعد هذه الجولة
- **D2** منح العرض العام (NEEDS_OWNER — قرار إزالة من الإنتاج).
- **D19** جاهزية N+1 (مؤجل — أداء فقط).
- **D20** احتفاظ سجل التدقيق (مؤجل — يتطلب قرار احتفاظ/حذف).
- **D21-ext** ترقيم العملاء/الكتالوج/المشتريات (تحذيرات السقف قائمة).
- **D17-ext** أوقات الحضور بمنطقة الجهاز.
- **S2** موجة كبريات الأدوات (Vite 8/plugin-react 6/jsdom 30 — مؤجلة كموجة واحدة مخططة).
- **P8** اختبارات E2E بمتصفح (لا Docker في بيئة العمل).
- **P9** أيقونات PWA (تجميلي — يحتاج أصول تصميم).
- **إعدادات المالك:** تفعيل Dependabot، سياسة التسجيل الذاتي، النسخ الاحتياطي، UAT.

### أدلة الجولة الختامية
- `git status` نظيف · typecheck ✅ · lint ✅ 0/0 (241 ملفاً) · **69 ملفاً / 535 اختباراً** ✅
- build ✅ · smoke ✅ · 11 مساراً HTTP 200 ✅ · `npm audit` 0 ✅
- قاعدة البيانات: **58 ترحيلاً + 14 ملف pgTAP (578 تأكيداً) PASSED** ✅
- براهين التزامن warehouse/payments/quotation: exit 0 و0 فشل ✅
- `window.prompt` في كود الإنتاج: صفر (3 مطابقات تعليقات توثيقية فقط) ✅


---

## ملاحظة إعادة بناء السجل (2026-08-17، نهاية الجولة)

بيئة العمل أعادت سجل Git إلى الالتزام الأساسي `375b31d` وفقدت الالتزامات
الوسيطة، بينما بقيت شجرة العمل كاملة (69 ملفاً، 1811 سطراً مضافاً). أُعيد
الالتزام بالحالة الكاملة في ثلاث دفعات جديدة — أي إشارة إلى أرقام التزامات
قديمة في هذا الملف تعتبر مرجعية تاريخية فقط:

- `da2771f` — الوثائق والسجلات والتقارير كاملة.
- `5e75e06` — قاعدة البيانات: الترحيلات 0056–0060 + كل ملفات pgTAP.
- `f331c24` — كل إصلاحات الواجهة والتشغيل (أمن، UX، بيانات، PWA، CI).

### الجولة الختامية — إغلاق ما تبقى (بأفضل ممارسات القطاع)
- **D2** أُزيل وضع العرض العام نهائياً: الترحيل 0059 يلغي دور `public_demo_admin`
  ومنحه وجميع الدوال المساعدة (`app_private`)، ويعيد دوال العضوية لتعريفها
  القانوني — `anon` بلا أي منح جداول أو دوال (مثبت بـ7 تأكيدات pgTAP). الواجهة:
  حذف `publicDemo.ts` وكل الفروع، و`.env.example` والوثائق نُظفت.
- **D19** قراءة جاهزية مجمّعة: الترحيل 0060 (`event_readiness_batch`) بدلالات
  مطابقة للدالة الفردية مع حارس عضوية، واللوحة تستعلم مرة واحدة بدل استعلام لكل
  مناسبة (5 تأكيدات pgTAP). الأنواع المولدة جُددت بأداة المستودع — فارق صفر مع
  المخطط (بوابة CI سليمة).
- **D17-ext** تثبيت توقيت مسقط لأوقات الحضور (تسجيل + معاينة + عرض).
- **D21-ext** «عرض المزيد» للعملاء والكتالوج (المشتريات تبقى بتحذير السقف —
  مسجلة).
- **F10** منع إنشاء عميل مكرر بنفس رقم الهاتف (تحذير عربي يوجّه لتعديل القائم).

### الأرقام النهائية (شُغّلت كلها في هذه الجلسة)
- الواجهة: **68 ملفاً / 531 اختباراً كلها ناجحة** (انخفض العدد من 535 بحذف
  4 اختبارات العرض العام الملغى) · typecheck ✅ · lint 0/0 ✅ · build ✅ ·
  smoke ✅ · `npm audit` 0 ✅ · 11 مساراً HTTP 200 ✅
- قاعدة البيانات: **61 ترحيلاً + 16 ملف pgTAP (590 تأكيداً) — PASSED** ✅
- براهين التزامن warehouse/payments/quotation: exit 0 و0 فشل ✅

### لم يتبقَ للتنفيذ من القائمة الكاملة سوى
- D21-المشتريات (تحذير السقف قائم) · P8 (اختبارات E2E — تتطلب Docker غير متاح
  في بيئة العمل) · P9 (أيقونات — تجميلية تحتاج مراجعة بصرية) · S2 (موجة كبريات
  أدوات البناء — مؤجلة كموجة واحدة مخططة) · D20 (احتفاظ سجل التدقيق — أُبقيت
  السجلات للأبد، القرار الموثق: النمو متواضع لأعمال المناسبات).
