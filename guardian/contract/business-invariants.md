# Business Invariants — Hospitality / Event Operations (real, extracted from code)

> هذه القواعد استُخرجت من الـ schema والكود والاختبارات الفعلية لهذا المشروع
> (Hospitality Ops)، وليست افتراضات من مشروع آخر. كل قاعدة لها دليل من
> القاعدة (constraint/trigger/function) أو من اختبار pgTAP موجود.
>
> Machine-readable نسخة: `canonical-contract.json`.

## 1. Tenant / Organization isolation (الأهم)

| # | Invariant | Evidence |
| --- | --- | --- |
| 1.1 | `organizations` هو جذر العزل؛ كل جدول أعمال يحمل `organization_id` (42 جدول أعمال) | `information_schema.columns` |
| 1.2 | RLS مفعّل على كل جدول أعمال | كل migrations من `0008_rls.sql` فصاعداً؛ فحص `G-RLS-INTEGRITY` |
| 1.3 | كل FK بين جدولين org-scoped يشمل `organization_id` (66 FK — لا رابط عابر للمنظمات) | فحص `G-RLS-INTEGRITY`؛ `guardian_schema_contract.test.sql #19` |
| 1.4 | لا grants لـ `anon` على الجداول/الوظائف؛ لا تنفيذ anon لأي RPC | `0008_rls.sql` وما بعده؛ فحص `G-FUNCTION-ACL` |
| 1.5 | فصل بيانات التكلفة عند حدود البيانات: `can_read_cost()` لـ OWNER/MANAGER/ACCOUNTANT فقط | `0003` (can_read_cost) + سياسات SELECT في كل جدول مالي |
| 1.6 | العضوية غير النشطة أو المنظمة غير النشطة تمنع الوصول | `is_org_member()` / `has_org_role()` |
| 1.7 | Company A لا تقرأ/تعدل Company B عبر أي مسار (SELECT/INSERT/UPDATE/DELETE/RPC/View) | `rls_isolation.test.sql` + `guardian_tenant_isolation.test.sql` |

## 2. Event lifecycle consistency

| # | Invariant | Evidence |
| --- | --- | --- |
| 2.1 | حالة الحدث تتحرك عبر `transition_event_status()` فقط وفق مصفوفة موثقة: `DRAFT→QUOTED→CONFIRMED→PREPARING→DISPATCHED→IN_PROGRESS→RETURNING→CLOSED` (+`CANCELLED` عبر `cancel_event()` فقط) | `0014`, `0066`؛ `throws_ok INVALID_EVENT_TRANSITION` في اختبارات متعددة |
| 2.2 | لا إغلاق (`CLOSED`) مع معدات/مستهلكات outstanding | `transition_event_status` + `close_event_financially` (حارس `WAREHOUSE_OUTSTANDING_BLOCKS_CLOSE` / `CONSUMABLE_OUTSTANDING_BLOCKS_CLOSE`) |
| 2.3 | `DISPATCHED` يتطلب جاهزية (READY) أو override موثق في `event_transition_overrides` | `0066`؛ `event_readiness()` |
| 2.4 | كل انتقال يُسجَّل في `event_status_history` (تاريخ تدقيق) | `transition_event_status` / `accept_event_quotation` / `cancel_event` |
| 2.5 | `event_number` فريد لكل منظمة | قيد `events_org_number_unique` |

## 3. Quotations (المستند التجاري الأساسي)

| # | Invariant | Evidence |
| --- | --- | --- |
| 3.1 | `quotation_number + revision` فريد لكل منظمة | قيد `quotations_org_number_revision_key` |
| 3.2 | DRAFT قابل للتعديل فقط عبر `update_quotation_draft()`؛ بعد ISSUE تصبح اللقطة غير قابلة للتعديل | `protect_quotation_snapshot` trigger؛ `canonical_quotation_lifecycle.test.sql` |
| 3.3 | أسطر الاقتباس (`quotation_lines`) غير قابلة للتعديل/الحذف بعد الإصدار | `prevent_quotation_line_mutation` trigger |
| 3.4 | قبول اقتباس يحوّل الحدث إلى CONFIRMED ويُلغى (SUPERSEDED) الاقتباسات الأخرى لنفس الحدث | `accept_event_quotation` / `accept_quotation` |
| 3.5 | أسعار الحدث لقطات (snapshots) — لا ترتبط حياً بأسعار الكتالوج | تصميم `quotation_lines` / `event_commercial_lines` (AGENTS.md) |
| 3.6 | دورة حياة الاقتباس: `DRAFT→ISSUED→(ACCEPTED|REJECTED|EXPIRED|SUPERSEDED|CANCELLED|CONVERTED)` | `canonical_quotation_lifecycle.test.sql` |

## 4. Attendance integrity

| # | Invariant | Evidence |
| --- | --- | --- |
| 4.1 | الحضور يسجَّل عبر أوامر (`clock_staff_in/out`, `record_staff_attendance`) وليس كتابة مباشرة | `0073`؛ سياسات RLS |
| 4.2 | الحالة: `PRESENT/LATE/PARTIAL/ABSENT/VOIDED` فقط؛ VOID انتقال موثق | `staff_attendance_guard` trigger |
| 4.3 | المبالغ المكتسبة تُحسب من `wage_method/wage_rate` والوقت الفعلي عبر `compute_earned_amount()` | `0038/0039`؛ `staff_attendance.test.sql` |
| 4.4 | لا check-out قبل check-in | `staff_attendance_guard` / فحص `G-DATA-INTEGRITY` |
| 4.5 | صفوف الحضور غير قابلة للحذف (append-only) | `staff_attendance_guard` |

## 5. Equipment dispatch / return integrity

| # | Invariant | Evidence |
| --- | --- | --- |
| 5.1 | حركات المعدات (`event_equipment_movements`: DISPATCH/RETURN) append-only | `warehouse_ledger_is_append_only` trigger |
| 5.2 | الحجز `ACTIVE/RELEASED/CANCELLED`؛ لا dispatch على حجز غير ACTIVE | `0015`, `0023`؛ `warehouse_concurrency.test.sql` |
| 5.3 | التسويات (`event_warehouse_reconciliations`) append-only | trigger `warehouse_ledger_is_append_only` |
| 5.4 | لا يمكن تجاوز الكمية المتاحة عند dispatch | `reserve_event_equipment`/`dispatch_event_equipment` (تزامن) |
| 5.5 | إغلاق الحدث يتطلب outstanding = 0 | راجع 2.2 |

## 6. Consumables integrity

| # | Invariant | Evidence |
| --- | --- | --- |
| 6.1 | كل حركة مستهلك من الأنواع السبعة: `RECEIVE/ISSUE_TO_EVENT/RETURN_FROM_EVENT/CONSUME_AT_EVENT/WASTE_AT_EVENT/WAREHOUSE_WASTE/ADJUSTMENT` | enum `consumable_movement_kind` |
| 6.2 | دفتر الحركات append-only | `consumable_ledger_guard` trigger |
| 6.3 | الرصيد الحالي (`on_hand`) مشتق من الدفتر فقط (لا عمود رصيد قابل للكتابة) | `_view_consumable_stock_summary()` |
| 6.4 | التسويات append-only | `consumable_reconciliation_append_only` trigger |
| 6.5 | الكميات لا تصبح سالبة إلا بحالات ADJUSTMENT موثقة | `assert_consumable_quantity` |

## 7. Expenses / payments / financial closure

| # | Invariant | Evidence |
| --- | --- | --- |
| 7.1 | النقود NUMERIC دقيقة scale 3 (لا float) | فحص `G-FINANCIAL-INTEGRITY`؛ `assert_payment_omr` |
| 7.2 | المدفوعات `RECORDED→VOIDED` فقط؛ المبلغ/الطريقة/المرجع غير قابلين للتعديل | `customer_payment_guard` |
| 7.3 | منع overpayment: المدفوعات لا تتجاوز الإيراد المقبول | `OVERPAYMENT_EXCEEDS_ACCEPTED` (`0036`, `0058`) |
| 7.4 | منع double posting: `idempotency_key + request_fingerprint` فريد لكل منظمة؛ إعادة نفس المفتاح بنفس الحمولة تُعيد النتيجة، وبحمولة مختلفة تُرفض | `command_idempotency` register؛ `begin_payment_command` |
| 7.5 | المصاريف `RECORDED→VOIDED` فقط؛ غير قابلة للحذف حتى والأحداث مفتوحة | `event_expenses_append_only_guard` (0078) |
| 7.6 | الإغلاق المالي (`event_financial_closures`) append-only؛ لا إعادة فتح إلا عبر `reopen_event_financially()` مرة واحدة | `event_financial_closures_guard` (0078)؛ `0069` |
| 7.7 | بينما الحدث مغلق مالياً، تُمنع كل طفرات التكلفة/التحصيل (payments/expenses/attendance/payouts) | `guard_event_financially_closed` triggers |
| 7.8 | سجل التدقيق (`audit_events`) append-only | `audit_events_append_only_guard` (0078) |
| 7.9 | `invoice_number` فريد لكل منظمة؛ الفواتير `ISSUED→CANCELLED` فقط ومالياً غير قابلة للتعديل | `invoices_org_number_unique`؛ `invoice_guard` |
| 7.10 | الأقساط `DEPOSIT/INSTALLMENT/FINAL`؛ `PENDING→PAID/CANCELLED`؛ مجموعها يطابق الفاتورة | `invoice_installment_guard`؛ `guardian_financial_integrity.test.sql` |
| 7.11 | صرف المضيفين (`host_payouts`) و`host_payout_allocations` append-only، `RECORDED→VOIDED` | `host_payout_guard` (0076) |
| 7.12 | سلف الموظفين append-only، `RECORDED→VOIDED` | `staff_advance_guard` |
| 7.13 | أوامر الشراء: التاريخ append-only (`procurement_order_history_guard`)؛ بنود الاستلام append-only؛ الموردون (master) لا يُحذفون | `0029/0030/0032`؛ `suppliers_no_delete` |
| 7.14 | كل أمر مالي يمر عبر idempotency register (`command_idempotency`) | `0030/0032`, `0036`, `0042`... |

## 8. Document numbering

| # | Invariant | Evidence |
| --- | --- | --- |
| 8.1 | `events.event_number` فريد لكل منظمة | `events_org_number_unique` |
| 8.2 | `invoices.invoice_number` فريد لكل منظمة | `invoices_org_number_unique` |
| 8.3 | `procurement_orders.order_number` فريد لكل منظمة | `procurement_orders_org_number_unique` |
| 8.4 | `quotations.quotation_number + revision` فريد لكل منظمة | `quotations_org_number_revision_key` |
| 8.5 | الأرقام تولَّد من `document_sequences` عبر `next_document_number()` داخل نفس المعاملة | `0014`؛ `document_sequences` |

## 9. RLS / SECURITY DEFINER safety

| # | Invariant | Evidence |
| --- | --- | --- |
| 9.1 | كل SECURITY DEFINER يثبّت `search_path` | `SET search_path TO ''` في كل دالة؛ فحص `G-FUNCTION-ACL` |
| 9.2 | لا ACL افتراضي (PUBLIC) لأي SECURITY DEFINER؛ لا تنفيذ من anon | `0078` (إصلاح G-0001/G-0002/G-0003)؛ `guardian_schema_contract.test.sql` |
| 9.3 | دوال الكتابة (RPCs) تتحقق من الدور/العضوية في الجسم (`has_org_role`/`can_manage_commercial`/`can_read_cost`) | كل أوامر `*_commands.sql` |
| 9.4 | لا سياسات DELETE من العميل على الجداول المالية أو الرئيسية | فحص `G-RLS-INTEGRITY` |
| 9.5 | كل view إمّا `security_invoker=true` أو مفلتر org في جسمه | `guardian_schema_contract.test.sql #11` |
| 9.6 | لا مسار demo/backdoor | `0059` أزال demo نهائياً؛ `public_demo_removal.test.sql` |

## 10. Migration / schema discipline

| # | Invariant | Evidence |
| --- | --- | --- |
| 10.1 | الترحيلات المطبقة خالدة (لا تعديل) | `G-MIGRATION-IMMUTABILITY` (SHA-256 لكل ملف) |
| 10.2 | السلسلة تُعاد من قاعدة فارغة وعلى الحالة القريبة من الحالية | `G-MIGRATION-GUARDIAN` |
| 10.3 | أي تغيير schema له اختبار regression في `supabase/tests/` | ممارسة المشروع (كل migration منذ 0049 لها اختبار) |
| 10.4 | الـ schema الفعلي يطابق `expected-schema.json` (العقد) | `G-SCHEMA-DRIFT` |
