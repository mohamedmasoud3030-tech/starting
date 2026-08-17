/** Arabic labels for the known audit actions; unknown codes stay visible. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  EVENT_CREATED: "إنشاء المناسبة",
  EVENT_CANCELLED: "إلغاء المناسبة",
  EVENT_STATUS_CHANGED: "تغيير حالة المناسبة",
  QUOTATION_DRAFT_CREATED: "إنشاء مسودة عرض سعر",
  QUOTATION_DRAFT_SAVED: "حفظ مسودة عرض سعر",
  QUOTATION_DRAFT_CANCELLED: "إلغاء مسودة عرض سعر",
  QUOTATION_ISSUED: "إصدار عرض سعر",
  QUOTATION_ACCEPTED: "اعتماد عرض سعر",
  QUOTATION_CONVERTED: "تحويل العرض إلى مناسبة",
  QUICK_QUOTE_CREATED: "إنشاء عرض سريع",
  QUICK_QUOTE_ISSUED: "إصدار عرض سريع",
  QUICK_QUOTE_CONVERTED: "تحويل العرض السريع",
  QUICK_QUOTE_DISCARDED: "تجاهل العرض السريع",
  PACKAGE_APPLIED: "تطبيق باقة",
  PACKAGE_APPLIED_QUOTATION: "تطبيق باقة على العرض",
  PACKAGE_APPLIED_QUICK_QUOTE: "تطبيق باقة على عرض سريع",
  EQUIPMENT_RESERVED: "حجز معدات",
  EQUIPMENT_DISPATCHED: "صرف معدات",
  EQUIPMENT_RETURNED: "إرجاع معدات",
  EQUIPMENT_RELEASED: "تحرير حجز معدات",
  WAREHOUSE_RECONCILED: "تسوية مخزن المناسبة",
  CONSUMABLES_RECONCILED: "تسوية مواد المناسبة",
  CONSUMABLE_STOCK_ITEM_SAVED: "حفظ صنف مخزون",
  CUSTOMER_PAYMENT_RECORDED: "تسجيل دفعة عميل",
  CUSTOMER_PAYMENT_VOIDED: "إلغاء دفعة عميل",
  INVOICE_ISSUED: "إصدار فاتورة",
  INVOICE_CANCELLED: "إلغاء فاتورة",
  STAFF_ASSIGNED: "إسناد طاقم",
  STAFF_RELEASED: "تحرير إسناد طاقم",
  STAFF_ATTENDANCE_RECORDED: "تسجيل حضور",
  STAFF_ATTENDANCE_VOIDED: "إلغاء سجل حضور",
  STAFF_ADVANCE_RECORDED: "تسجيل سلفة",
  STAFF_ADVANCE_VOIDED: "إلغاء سلفة",
  HOST_PAYOUT_RECORDED: "تسجيل صرف مضيف",
  HOST_PAYOUT_VOIDED: "إلغاء صرف مضيف",
  SUPPLIER_CREATED: "إضافة مورد",
  SUPPLIER_UPDATED: "تعديل مورد",
  SUPPLIER_STATUS_CHANGED: "تغيير حالة مورد",
  PROCUREMENT_ORDER_CREATED: "إنشاء أمر شراء",
  PROCUREMENT_ORDER_UPDATED: "تعديل أمر شراء",
  PROCUREMENT_ORDER_APPROVED: "اعتماد أمر شراء",
  PROCUREMENT_ORDER_SENT: "إرسال أمر شراء",
  PROCUREMENT_ORDER_CONFIRMED: "تأكيد أمر شراء",
  PROCUREMENT_ORDER_CANCELLED: "إلغاء أمر شراء",
  SEND_PROCUREMENT_ORDER: "إرسال أمر شراء",
  CONFIRM_PROCUREMENT_ORDER: "تأكيد أمر شراء",
};

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

import { Card } from "@/components/ui/Card";
import type { EventAuditRow } from "../events.api";

/** Status transitions + the append-only audit trail for OWNER/MANAGER. */
export function HistoryTab({
  history,
  audit,
}: {
  history: ReadonlyArray<{
    id: number;
    from_status: string | null;
    to_status: string;
    reason: string | null;
    created_at: string;
  }>;
  audit: ReadonlyArray<EventAuditRow>;
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="status-history-title">
        <h2 id="status-history-title" className="mb-2 text-lg font-black">
          سجل الحالات
        </h2>
        <ol className="space-y-3">
          {history.map((h) => (
            <li key={h.id}>
              <Card>
                <p className="font-bold">
                  {h.from_status ? `${h.from_status} ← ` : ""}
                  {h.to_status}
                </p>
                <p className="text-sm text-slate-500">
                  {new Date(h.created_at).toLocaleString("ar-OM")}
                  {h.reason && ` · ${h.reason}`}
                </p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {audit.length > 0 && (
        <section aria-labelledby="audit-history-title">
          <h2 id="audit-history-title" className="mb-2 text-lg font-black">
            سجل التدقيق
          </h2>
          <ol className="space-y-3">
            {audit.map((a) => (
              <li key={a.id}>
                <Card>
                  <p className="font-bold">
                    {auditActionLabel(a.action)}
                  </p>
                  <p className="text-xs text-slate-400" dir="ltr">
                    {a.action}
                  </p>
                  <p className="text-sm text-slate-500">
                    {new Date(a.created_at).toLocaleString("ar-OM", {
                      timeZone: "Asia/Muscat",
                    })}
                  </p>
                </Card>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
