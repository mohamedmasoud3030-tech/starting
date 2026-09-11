# دليل التشغيل المبسط — 8 نقرات من عرض السعر حتى الربح

هذا الدليل لصاحب مكتب الضيافة غير التقني. لا يشرح الكود، يشرح ماذا تضغط.

## المتطلبات قبل البدء
- مشروع Supabase جديد (URL + anon key في .env)
- تشغيل `supabase db reset` لتطبيق كل الهجرات (102 هجرة)
- التأكد من إنشاء bucket اسمه `attachments` في Storage → Private
- تسجيل مستخدم أول → إنشاء منشأة (Owner)

## الخطوات الثمانية

### 1) أضف عميلاً
اذهب إلى `/customers` → زر "عميل جديد" → اسم + جوال + نوع → حفظ.
→ يكتب في جدول `customers` مع RLS.

### 2) أضف مادة/خدمة في الدليل
`/catalog` → "مادة جديدة" → اسم، نوع (REUSABLE_EQUIPMENT أو CONSUMABLE أو SERVICE)، وحدة، سعر بيع، سعر تكلفة (يظهر فقط للمالك/محاسب) → حفظ.

### 3) أنشئ باقة (اختياري)
`/packages` → باقة جديدة → اختر مواد من الدليل → حفظ عبر `save_package` RPC.

### 4) أنشئ عرض سعر
`/quotes/new`:
- بيانات العميل والمناسبة: اسم، تاريخ، موقع، عدد ضيوف
- أضف خدمات: من الدليل أو مخصص
- الحاسبة السريعة على اليمين لا تحفظ — فقط للتجربة
- اضغط "حفظ مسودة" → `persist_quotation_draft` RPC يكتب `quotations` + `quotation_lines`
- اضغط "إصدار العرض" → `issue_quotation` → الحالة DRAFT→ISSUED → الرقم يصبح مثل QT-2026-0001 (من `document_sequences`)

### 5) اعتمد العرض وحوله لمناسبة
افتح العرض المصدر `/quotes/$quoteId` → زر "اعتماد" → `accept_quotation` → ISSUED→ACCEPTED
→ زر "تحويل لمناسبة" → `convert_quotation` → ينشئ `events` جديد ويربط `accepted_quotation_id` ويحول العرض إلى CONVERTED
→ الآن المناسبة في `/events` بحالة CONFIRMED.

### 6) جهز المناسبة للتنفيذ
افتح `/events/$eventId`:
- تبويب "ملخص": يظهر جاهزية (READY/NOT_READY) من `event_readiness` RPC + مركز القيادة `event_command_center`
- إذا غير جاهز: اذهب إلى الفريق → أسند مضيفين (`assign_event_staff` RPC)
- المعدات → احجز (`reserve_event_equipment`) → بعد ذلك المستودع → إرسال (`dispatch_event_equipment`) مع مرجع
- المواد → صرف (`issue_stock`) → تسوية
- المشتريات → أنشئ أمر شراء لمورد (`create_procurement_order`) → اعتماد → إرسال → استلام (`receive_procurement_order`)
- المطاعم المتعاقدة → أنشئ عقد مطعم → احجز وجبة غداء/عشاء (`create_meal_booking`) → تأكيد → تم التقديم
- عندما تكتمل كل الأبعاد، اضغط في الملخص "بدء التجهيز" → PREPARING → "تأكيد الإرسال" → DISPATCHED (إذا غير جاهز، يجب كتابة سبب تجاوز موثق)

### 7) نفذ وسجل حضور ودفعات
- أثناء المناسبة: الفريق يسجل حضور بالساعة عبر `AttendanceClock` → يرفع سيلفي إلى `attachments` bucket الخاص → `record_staff_attendance` RPC
- بعد المناسبة: المدفوعات → "تسجيل دفعة" → `record_customer_payment` مع مبلغ وطريقة → يظهر في `event_finance_summaries` (المحصل/المتبقي)
- المصاريف → "تسجيل مصروف" → `record_event_expense` (نقل، وقود، إيجار...) مع إيصال (يرفع إلى attachments)
- العودة والإرجاع: المستودع → إرجاع معدات (سليم/تالف/مفقود) → `return_event_equipment` → تسوية `reconcile_event_warehouse`

### 8) أغلق مالياً واعرف الربح
- في ملخص المناسبة: بعد RETURNING → "إغلاق المناسبة" → CLOSED
- إذا كنت مالك/محاسب: المالية → "إغلاق مالي" → `close_event_financially` RPC → يحسب الربح الحقيقي (الإيراد المعتمد - المصاريف - تكلفة المشتريات - أجور حضور - وجبات مطاعم)
- اذهب إلى `/reports`: يظهر إيراد/محصل/متبقي/تكلفة/ربح لكل مناسبة + استخدام الباقات + أعلى العملاء
- `/accounting`: 
  - التقادم → AR/AP/contract asset aging من `accounting_*_aging` RPCs
  - كشف حساب عميل → `accounting_customer_statement` مع تفاصيل التخصيص (allocation)
  - كشف حساب مورد → `accounting_supplier_statement`
- `/dashboard`: مؤشرات الإدارة `management_metrics` + تنبيهات `management_alerts` (جاهزية منخفضة، ذمم متأخرة، مناسبات بانتظار إرجاع)

## ماذا لو فشل شيء؟
- اذهب إلى `/settings` → "حالة النظام والتشخيص" → اضغط "تشغيل فحص النظام" → يفحص اتصال Supabase، وجود bucket، قراءة الجداول، ترقيم المستندات
- زر "اختبار رفع ملف" يرفع ملف صغير ويحذفه للتأكد أن التخزين يعمل
- إذا فشل التخزين: Supabase Dashboard → Storage → Create bucket → id=attachments → Public=false
- إذا ظهرت "وضع تجريبي — ردود عامة" في مساعد لينا: هذا يعني GEMINI_API_KEY غير مهيأ في Edge Functions → الردود ستكون عامة من لوحتك فقط، والصوت من جهازك. لإخفائها: ضع VITE_ENABLE_ASSISTANT=false في .env

## أرقام المستندات والضريبة
- البادئات الافتراضية: QT للعروض، INV للفواتير، EV للمناسبات — من `organization_settings` (QT/INV/EV)
- الضريبة: افتراضياً غير مسجل (vat_registered=false، نسبة 5%). عند التفعيل، تُثبت النسبة على المستندات وقت الإصدار ولا تتغير المستندات القديمة
- أرقام المستندات تُولد من `document_sequences` بمعاملة آمنة (لا تكرار)

## أدوار الفريق
- OWNER: كل شيء + إعدادات + فريق
- MANAGER: تجاري + تشغيل + مالي
- ACCOUNTANT: قراءة تكلفة + محاسبة + تقارير
- SUPERVISOR: تشغيل + حضور
- WAREHOUSE: معدات ومواد فقط (لا يرى أسعار تكلفة)

انتهى — بهذه الثمانية تكون دورة كاملة قابلة للبيع.
