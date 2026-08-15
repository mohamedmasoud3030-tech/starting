# 13 — مدفوعات العملاء واقتصاديات المناسبة (S6)

## الغرض

الطبقة المالية للعميل في المناسبة: تسجيل مدفوعات العملاء، سجل الدفعات، طرق
الدفع والمراجع، وإغلاق السؤال المالي للمناسبة بشكل موثّق:

- ما الذي تمّت موافقة العميل عليه تجارياً؟
- كم دُفع؟
- كم تبقّى على العميل؟
- ما التكاليف الملتزم بها / الفعلية؟
- ما الهامش الإجمالي / الوضع الاقتصادي الحالي؟

## مصادر الحقيقة (لا نماذج محاسبية منافسة)

- **أساس الإيراد:** العرض المعتمد (`quotations`). `accepted_revenue` هو
  `total_selling` للعرض المقبول — **وليس** إعادة جمع أسطر المناسبة الحالية.
- **التكلفة المتوقعة/الربح المتوقع:** لقطة العرض المعتمد
  (`total_expected_cost` / `total_expected_profit`).
- **التكلفة الملتزم بها / الفعلية:** من `event_procurement_cost_summaries`
  (S5) — `active_committed_cost` و `delivered_cost`.
- **المدفوع/المتبقي:** من سجل الدفعات `customer_payments` (حالة `RECORDED`
  فقط؛ `VOIDED` مستبعدة).

لا يوجد جدول فواتير أو دفتر أستاذ عام أو حسابات دائنة في هذه الشريحة؛
«المُحصَّل» هو القيمة التجارية المقبولة، و«المتبقي» = المقبول − المدفوع.

## النموذج

### الأنواع

- `payment_method` — `CASH`, `BANK_TRANSFER`, `CARD`, `CHEQUE`,
  `MOBILE_WALLET`, `OTHER`.
- `customer_payment_status` — `RECORDED`, `VOIDED`.

### الجداول

- `customer_payments` — سجل مالي إلحاقي. `amount numeric(12,3) check (> 0)`،
  `reference` (مرجع البنك/الشيك/المحفظة)، `paid_at`، `recorded_by`،
  `idempotency_key`، `request_fingerprint`، وحقول الإلغاء `voided_*`.
- `payments_command_idempotency` — سجل المعاملة المالية للأوامر (مطابق لنمط S5).

### الأوامر (Server-authoritative RPC)

- `record_customer_payment` — `OWNER`/`MANAGER`/`ACCOUNTANT`. يتحقق من: دقة
  OMR (3 خانات)، المبلغ > 0، وجود مناسبة غير ملغاة **بها عرض معتمد**، وعزل
  المنظمة. معرّف المعاملة + قفل استشاري + بصمة طلب.
- `void_customer_payment` — `OWNER`/`MANAGER`/`ACCOUNTANT`. انتقال محروس
  `RECORDED → VOIDED` مع سبب إلزامي (≥ 3 أحرف) دون حذف الحقيقة المالية.

### الحساب

- `amount_paid` = مجموع دفعات `RECORDED` (لا يُخزَّن الرصيد — يُشتق من السجل،
  فلا يمكن لسباق أوامر أن يُفسد رصيداً).
- `outstanding_balance` = `accepted_revenue − amount_paid`.
- `gross_margin` = `accepted_revenue − (active_committed_cost إن وُجدت طلبات
  نشطة، وإلا total_expected_cost)`.

## الأمان

- القراءة المالية (المبالغ، الاقتصاديات) مقصورة على `can_read_cost`
  (`OWNER`/`MANAGER`/`ACCOUNTANT`) — **عند حدود البيانات** عبر شرط
  `where can_read_cost(...)` في نماذج القراءة، وليس إخفاءً في الواجهة.
- الكتابة المالية مقصورة على `OWNER`/`MANAGER`/`ACCOUNTANT` داخل الأوامر.
- RLS مفعّل على الجداول، بلا سياسات كتابة؛ الطاولات الخام غير ممنوحة
  للعميل (النماذج فقط)، والحذف التدميري ممنوع هيكلياً (مُشغِّل
  `customer_payment_guard`).

## الواجهة

- تبويب «المدفوعات» في مساحة عمل المناسبة: بطاقات الاقتصاديات، سجل الدفعات،
  نموذج تسجيل دفعة (المبلغ بدقة 3 خانات عبر `MoneyInput`)، وإلغاء دفعة.
- ملخّص صوتي للمالك (`buildPaymentsVoiceSummary`) لا ينطق التكلفة/الهامش إلا
  للصلاحيات المصرّحة (`canReadCost`).
