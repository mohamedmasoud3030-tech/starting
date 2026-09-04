import { DocumentShell } from "@/components/documents/DocumentShell";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import { ORDER_STATUS_LABELS } from "@/features/procurement/presentation";
import { STAFF_TYPE_LABELS } from "@/features/staff/labels";
import { formatQuantity } from "@/lib/utils";
import type {
  EventProcurementOpsRow,
  EventTeamSheetRow,
  EventWorkOrderHeaderRow,
  WarehouseSheetRow,
} from "./documents.api";

function muscatDateTime(value: string | null): string {
  return value
    ? new Date(value).toLocaleString("ar-OM", { timeZone: "Asia/Muscat" })
    : "—";
}

function dateOnly(value: string | null): string {
  return value
    ? new Date(value).toLocaleDateString("ar-OM", { timeZone: "Asia/Muscat" })
    : "—";
}

function muscatTime(value: string | null): string {
  return value
    ? new Date(value).toLocaleTimeString("ar-OM", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Muscat",
      })
    : "—";
}

/**
 * Event work order (أمر تشغيل المناسبة) — the office/field execution
 * summary of one event: customer, timing, venue, the assigned team, the
 * equipment/consumables requirement and the live procurement dependencies.
 *
 * This is an OPERATIONS document: it composes only projections that are free
 * of cost, wage and margin data (the team sheet, the warehouse sheet lines
 * and the cost-free procurement projection). It is deliberately not a
 * financial summary and never renders amounts.
 */
export function WorkOrderDocument({
  identity,
  header,
  teamRows,
  warehouseRows,
  procurementRows,
  printedAt,
}: {
  identity: DocumentIdentity;
  header: EventWorkOrderHeaderRow;
  teamRows: EventTeamSheetRow[];
  warehouseRows: WarehouseSheetRow[];
  procurementRows: EventProcurementOpsRow[];
  printedAt: string;
}) {
  const equipment = warehouseRows.filter((r) => r.line_kind === "EQUIPMENT");
  const consumables = warehouseRows.filter((r) => r.line_kind === "CONSUMABLE");

  return (
    <DocumentShell
      identity={identity}
      title="أمر تشغيل المناسبة"
      documentNumber={header.event_number}
      dateText={dateOnly(printedAt)}
      meta={
        <div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-slate-500">العميل: </span>
            <span className="font-bold">{header.customer_name || "—"}</span>
          </div>
          <div>
            <span className="text-slate-500">المناسبة: </span>
            <span className="font-bold">
              {header.event_number}
              {header.title ? ` — ${header.title}` : ""}
            </span>
          </div>
          <div>
            <span className="text-slate-500">نوع المناسبة: </span>
            <span className="font-bold">{header.event_type || "—"}</span>
          </div>
          <div>
            <span className="text-slate-500">البداية: </span>
            <span className="font-bold">{muscatDateTime(header.start_at)}</span>
          </div>
          <div>
            <span className="text-slate-500">النهاية: </span>
            <span className="font-bold">{muscatDateTime(header.end_at)}</span>
          </div>
          <div>
            <span className="text-slate-500">المكان: </span>
            <span className="font-bold">
              {header.venue_name}
              {header.location_details ? ` — ${header.location_details}` : ""}
            </span>
          </div>
          <div>
            <span className="text-slate-500">عدد الضيوف: </span>
            <span dir="ltr" className="font-bold">
              {formatQuantity(header.guest_count)}
            </span>
          </div>
          {(header.contact_name || header.contact_phone) && (
            <div>
              <span className="text-slate-500">مسؤول التواصل: </span>
              <span className="font-bold">
                {header.contact_name || ""}
                {header.contact_phone && (
                  <span dir="ltr"> {header.contact_phone}</span>
                )}
              </span>
            </div>
          )}
          <div>
            <span className="text-slate-500">المسؤول من المكتب: </span>
            <span className="font-bold">{header.responsible_user_name || "—"}</span>
          </div>
          <div>
            <span className="text-slate-500">وقت الطباعة: </span>
            <span className="font-bold">{muscatDateTime(printedAt)}</span>
          </div>
        </div>
      }
      signature={false}
    >
      {header.notes && (
        <section className="mt-4">
          <h3 className="font-black text-brand-900">ملاحظات المناسبة</h3>
          <p className="mt-1 whitespace-pre-line text-sm leading-6">{header.notes}</p>
        </section>
      )}

      <section className="mt-4">
        <h3 className="font-black text-brand-900">الفريق المسند</h3>
        {teamRows.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">لم يُسند فريق بعد.</p>
        ) : (
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-1.5 text-right">المضيف</th>
                <th className="py-1.5 text-right">الجوال</th>
                <th className="py-1.5 text-right">المهمة</th>
                <th className="py-1.5 text-right">الوردية</th>
              </tr>
            </thead>
            <tbody>
              {teamRows.map((r, i) => (
                <tr key={`${r.staff_member_id}-${i}`} className="border-b border-slate-100">
                  <td className="py-1.5 font-bold">{r.staff_name}</td>
                  <td className="py-1.5" dir="ltr">
                    {r.staff_phone || "—"}
                  </td>
                  <td className="py-1.5">
                    {STAFF_TYPE_LABELS[r.assignment_role] ?? r.assignment_role}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">
                    {muscatTime(r.scheduled_start)} — {muscatTime(r.scheduled_end)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {(equipment.length > 0 || consumables.length > 0) && (
        <section className="mt-4">
          <h3 className="font-black text-brand-900">المعدات والمواد المطلوبة</h3>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-1.5 text-right">البند</th>
                <th className="py-1.5 text-right">النوع</th>
                <th className="py-1.5 text-right">الوحدة</th>
                <th className="py-1.5 text-right">الكمية المطلوبة</th>
              </tr>
            </thead>
            <tbody>
              {[...equipment, ...consumables].map((r, i) => (
                <tr key={`${r.line_kind}-${i}`} className="border-b border-slate-100">
                  <td className="py-1.5 font-bold">{r.item_name}</td>
                  <td className="py-1.5">
                    {r.line_kind === "EQUIPMENT" ? "معدات" : "مواد استهلاكية"}
                  </td>
                  <td className="py-1.5">{r.unit}</td>
                  <td className="py-1.5">{formatQuantity(r.required_qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {procurementRows.length > 0 && (
        <section className="mt-4">
          <h3 className="font-black text-brand-900">المشتريات والموردون</h3>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-1.5 text-right">المورد</th>
                <th className="py-1.5 text-right">أمر الشراء</th>
                <th className="py-1.5 text-right">البند</th>
                <th className="py-1.5 text-right">الكمية</th>
                <th className="py-1.5 text-right">التسليم المتوقع</th>
                <th className="py-1.5 text-right">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {procurementRows.map((r, i) => (
                <tr key={`${r.order_number}-${i}`} className="border-b border-slate-100">
                  <td className="py-1.5 font-bold">{r.supplier_name}</td>
                  <td className="py-1.5" dir="ltr">
                    {r.order_number}
                  </td>
                  <td className="py-1.5">
                    {r.item_name}
                    <span className="text-slate-500"> ({r.unit})</span>
                  </td>
                  <td className="py-1.5">{formatQuantity(r.quantity)}</td>
                  <td className="py-1.5 whitespace-nowrap">
                    {dateOnly(r.expected_delivery_at)}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">
                    {ORDER_STATUS_LABELS[r.order_status as keyof typeof ORDER_STATUS_LABELS] ??
                      r.order_status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="mt-6 text-sm">
        <h3 className="font-black text-brand-900">ملاحظات تشغيلية</h3>
        <div className="mt-2 space-y-6">
          <div className="border-b border-slate-300" />
          <div className="border-b border-slate-300" />
          <div className="border-b border-slate-300" />
        </div>
      </section>

      <p className="mt-3 text-xs text-slate-500">
        هذا الأمر تشغيلي فقط ولا يتضمن أي تكاليف أو هوامش ربح أو بيانات أجور.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-6 text-sm">
        <div className="text-center">
          <div className="mx-auto h-12 w-44 border-b border-slate-400" />
          <p className="mt-1 font-bold">توقيع المكتب</p>
        </div>
        <div className="text-center">
          <div className="mx-auto h-12 w-44 border-b border-slate-400" />
          <p className="mt-1 font-bold">توقيع مسؤول الموقع</p>
        </div>
      </div>
    </DocumentShell>
  );
}
