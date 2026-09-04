import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  CreditCard,
  FileText,
  ShoppingBag,
  UserCheck,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { formatOMR, fromDbAmount } from "@/lib/money";
import {
  NEXT_ACTION_TAB,
  readinessReasonLabel,
  type ReadinessReasonCode,
} from "../operationalReadiness";
import type { CommandCenter } from "../commandCenter.api";
import type { WorkspaceTab } from "../eventWorkspace.model";

/**
 * The Event Command Center — the decision surface above the detailed tabs.
 * It answers one question: WHAT DOES THIS EVENT STILL NEED?
 *
 * Everything rendered here comes from the single canonical server projection
 * (`event_command_center`, 0082). The component deliberately contains NO
 * readiness logic: each dimension block is a rendering of server counts, and
 * every problem is a button that navigates to the place that fixes it.
 * Commercial state sits in its own block — an outstanding balance can never
 * flip the operational badge, and the operational badge never leaks money.
 */
export function EventCommandCenter({
  center,
  canReadMoney,
  onOpenTab,
  eventStatus,
}: {
  center: CommandCenter;
  /** cost.visibility — whether commercial AMOUNTS may be shown (server already filtered). */
  canReadMoney: boolean;
  onOpenTab: (tab: WorkspaceTab) => void;
  eventStatus: string;
}) {
  const o = center.operational;
  const ready = o.status === "READY";
  const dimsExecuted = ["DISPATCHED", "IN_PROGRESS", "RETURNING", "CLOSED"].includes(eventStatus);
  const showAttendance =
    dimsExecuted || center.attendance.assigned > 0 || center.attendance.checked_in > 0;

  return (
    <section aria-label="مركز قيادة المناسبة" className="space-y-3">
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${
          ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
        }`}
      >
        <div className="flex items-center gap-2">
          {ready ? (
            <CheckCircle2 className="h-6 w-6 text-emerald-700" />
          ) : (
            <AlertTriangle className="h-6 w-6 text-amber-700" />
          )}
          <p className="text-lg font-black">
            {ready ? "جاهزة للتنفيذ" : "غير جاهزة للتنفيذ"}
          </p>
        </div>
        {center.next_action && center.next_action.code !== "NONE" && (
          <button
            type="button"
            onClick={() => onOpenTab(NEXT_ACTION_TAB[center.next_action!.code])}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800"
          >
            الإجراء التالي: {center.next_action.label}
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        {!center.next_action || center.next_action.code === "NONE" ? (
          <Badge tone={ready ? "success" : "warning"}>
            {ready ? "لا إجراء عاجل" : "راجع البنود أدناه"}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DimensionCard
          title="الفريق"
          icon={<Users className="h-5 w-5" />}
          reason="STAFF_SHORTAGE"
          missing={o.reasons.includes("STAFF_SHORTAGE")}
          onOpen={() => onOpenTab("الفريق")}
        >
          {o.staff_required > 0 ? (
            <p className="text-sm">
              {o.staff_assigned} / {o.staff_required}
              {o.staff_missing > 0 && (
                <span className="font-bold text-amber-800"> — ينقص {o.staff_missing}</span>
              )}
            </p>
          ) : (
            <p className="text-sm text-slate-500">لا متطلبات فريق مسجلة</p>
          )}
        </DimensionCard>

        <DimensionCard
          title="المعدات"
          icon={<Boxes className="h-5 w-5" />}
          reason="EQUIPMENT_SHORTAGE"
          missing={o.reasons.includes("EQUIPMENT_SHORTAGE")}
          onOpen={() => onOpenTab("المعدات")}
        >
          {o.equipment_shortage > 0 ? (
            <ul className="space-y-1 text-sm">
              {o.equipment_lines.slice(0, 3).map((line) => (
                <li key={line.label}>
                  {line.label}: مطلوب {line.required} / محجوز {line.reserved}
                </li>
              ))}
              <li className="font-bold text-amber-800">{o.equipment_shortage} أصناف ناقصة</li>
            </ul>
          ) : (
            <p className="text-sm text-emerald-800">مكتملة ✓</p>
          )}
        </DimensionCard>

        <DimensionCard
          title="المواد"
          icon={<ShoppingBag className="h-5 w-5" />}
          reason="CONSUMABLE_SHORTAGE"
          missing={o.reasons.includes("CONSUMABLE_SHORTAGE")}
          onOpen={() => onOpenTab("المواد")}
        >
          {o.consumables_shortage > 0 ? (
            <ul className="space-y-1 text-sm">
              {o.consumable_lines.slice(0, 3).map((line) => (
                <li key={line.label}>
                  {line.label}: المطلوب {line.required} · المجهز {line.prepared} · الناقص{" "}
                  {line.missing} {line.unit}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-emerald-800">لا نقص في المواد ✓</p>
          )}
        </DimensionCard>

        <DimensionCard
          title="الموردون"
          icon={<FileText className="h-5 w-5" />}
          reason="PROCUREMENT_PENDING"
          missing={o.reasons.includes("PROCUREMENT_PENDING")}
          onOpen={() => onOpenTab("المشتريات")}
        >
          {o.procurement_pending > 0 ? (
            <ul className="space-y-1 text-sm">
              {o.procurement_orders.slice(0, 3).map((order) => (
                <li key={order.order_number}>
                  {order.order_number} — {order.supplier_name}:{" "}
                  {order.order_status === "PARTIALLY_RECEIVED" ? "استلام جزئي" : "لم يصل بعد"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-emerald-800">التموين مكتمل أو غير مطلوب</p>
          )}
        </DimensionCard>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {showAttendance && (
          <DimensionCard
            title="الحضور"
            icon={<UserCheck className="h-5 w-5" />}
            missing={
              center.attendance.assigned > 0 &&
              center.attendance.checked_in < center.attendance.assigned
            }
            onOpen={() => onOpenTab("الحضور")}
          >
            <p className="text-sm">
              مسند {center.attendance.assigned} · داخل {center.attendance.checked_in} · خرج{" "}
              {center.attendance.checked_out}
              {center.attendance.pending_confirmations > 0 && (
                <span className="font-bold text-amber-800">
                  {" "}
                  — {center.attendance.pending_confirmations} بانتظار تأكيد الخروج
                </span>
              )}
            </p>
          </DimensionCard>
        )}

        {/* Commercial attention — SEPARATE from readiness by construction. */}
        <Card>
          <CardBody className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-black">
                <CreditCard className="h-5 w-5 text-brand-700" />
                الوضع التجاري
              </h3>
              <Badge tone={center.commercial.attention ? "warning" : "success"}>
                {center.commercial.attention ? "يحتاج متابعة" : "لا ملاحظات"}
              </Badge>
            </div>
            {canReadMoney && center.commercial.value !== null ? (
              <p className="text-sm leading-6" dir="ltr">
                <span className="text-slate-500">القيمة:</span>{" "}
                <b>{formatOMR(fromDbAmount(center.commercial.value))} OMR</b>{" "}
                <span className="text-slate-500">المحصل:</span>{" "}
                <b>{formatOMR(fromDbAmount(center.commercial.collected ?? "0"))}</b>{" "}
                <span className="text-slate-500">المتبقي:</span>{" "}
                <b className={center.commercial.attention ? "text-amber-800" : "text-emerald-800"}>
                  {formatOMR(fromDbAmount(center.commercial.outstanding ?? "0"))}
                </b>
              </p>
            ) : (
              <p className="text-sm text-slate-500">
                {center.commercial.attention
                  ? "مالياً: يحتاج متابعة — التفاصيل من شاشة المدفوعات."
                  : "لا توجد متابعات مالية على المناسبة."}
              </p>
            )}
            {center.documents.quotation_status && (
              <p className="text-sm text-slate-500">
                عرض السعر: {center.documents.quotation_status === "ACCEPTED" || center.documents.quotation_status === "CONVERTED" ? "معتمد ✓" : center.documents.quotation_status}
                {center.documents.invoice_status && (
                  <> · الفاتورة: {center.documents.invoice_status === "PAID" ? "مدفوعة ✓" : "صادرة"}</>
                )}
                {center.documents.warehouse_sheet_lines > 0 && (
                  <> · أمر تجهيز المخزن: {center.documents.warehouse_sheet_lines} بنداً</>
                )}
              </p>
            )}
            {canReadMoney && center.commercial.attention && (
              <button
                type="button"
                onClick={() => onOpenTab("المدفوعات")}
                className="text-sm font-bold text-brand-700 hover:text-brand-900"
              >
                تسجيل دفعة / متابعة التحصيل ←
              </button>
            )}
          </CardBody>
        </Card>
      </div>
    </section>
  );
}

function DimensionCard({
  title,
  icon,
  reason,
  missing,
  onOpen,
  children,
}: {
  title: string;
  icon: ReactNode;
  /** canonical reason code this card resolves — rendered from the model. */
  reason?: ReadinessReasonCode;
  missing: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <Card className={missing ? "border-amber-200" : ""}>
      <CardBody className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-black">
            {icon}
            {title}
          </h3>
          <Badge tone={missing ? "warning" : "success"}>
            {missing ? (reason ? readinessReasonLabel(reason) : "يحتاج معالجة") : "مكتمل ✓"}
          </Badge>
        </div>
        {children}
        {missing && (
          <button
            type="button"
            onClick={onOpen}
            className="mt-1 text-sm font-bold text-brand-700 hover:text-brand-900"
          >
            معالجة ←
          </button>
        )}
      </CardBody>
    </Card>
  );
}
