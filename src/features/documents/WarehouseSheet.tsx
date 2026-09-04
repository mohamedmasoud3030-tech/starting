import { DocumentShell } from "@/components/documents/DocumentShell";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import { formatQuantity } from "@/lib/utils";
import type { WarehouseSheetRow } from "./documents.api";

/**
 * Warehouse operational sheets (أمر تجهيز المخزن / كشف استرجاع المخزن).
 *
 * Deliberately pen-and-paper friendly: canonical KNOWN quantities from the
 * server, blank cells for the physical count, a print timestamp, and
 * sign-off areas. The projection carries NO cost, margin, or financial
 * columns — a warehouse worker must never see financial data here.
 */
export function WarehouseSheet({
  identity,
  mode,
  eventNumber,
  eventTitle,
  printedAt,
  rows,
}: {
  identity: DocumentIdentity;
  mode: "PREP" | "RETURN";
  eventNumber: string;
  eventTitle: string;
  printedAt: string;
  rows: WarehouseSheetRow[];
}) {
  const prep = mode === "PREP";
  const title = prep ? "أمر تجهيز المخزن" : "كشف استرجاع المخزن";

  return (
    <DocumentShell
      identity={identity}
      title={title}
      documentNumber={eventNumber}
      dateText={new Date(printedAt).toLocaleString("ar-OM", {
        timeZone: "Asia/Muscat",
      })}
      meta={
        <div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-slate-500">المناسبة: </span>
            <span className="font-bold">{eventNumber}</span>
            {eventTitle ? ` — ${eventTitle}` : ""}
          </div>
          <div>
            <span className="text-slate-500">وقت الطباعة: </span>
            <span className="font-bold">
              {new Date(printedAt).toLocaleString("ar-OM", {
                timeZone: "Asia/Muscat",
              })}
            </span>
          </div>
        </div>
      }
      signature={false}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          لا توجد بنود تشغيلية لهذه المناسبة.
        </p>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-brand-700 text-brand-900">
              <th className="py-2 text-right">البند</th>
              <th className="py-2 text-right">الوحدة</th>
              {prep ? (
                <>
                  <th className="py-2 text-left">المطلوب</th>
                  <th className="py-2 text-center w-16">✓</th>
                </>
              ) : (
                <>
                  <th className="py-2 text-left">مُرسَل</th>
                  <th className="py-2 text-left">مسترجع صالح</th>
                  <th className="py-2 text-left">تالف</th>
                  <th className="py-2 text-left">ضائع</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-200">
                <td className="py-2">{r.item_name}</td>
                <td className="py-2 whitespace-nowrap">{r.unit || "—"}</td>
                {prep ? (
                  <>
                    <td className="py-2 text-left" dir="ltr">
                      {formatQuantity(r.required_qty)}
                    </td>
                    <td className="py-2">
                      <div className="mx-auto h-7 w-7 rounded border-2 border-slate-400" />
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-2 text-left" dir="ltr">
                      {formatQuantity(r.dispatched_qty)}
                    </td>
                    <td className="py-2 text-left" dir="ltr">
                      {formatQuantity(r.returned_good_qty)}
                    </td>
                    <td className="py-2 text-left" dir="ltr">
                      {formatQuantity(r.damaged_qty)}
                    </td>
                    <td className="py-2 text-left" dir="ltr">
                      {formatQuantity(r.lost_qty)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Sign-off areas — the paper workflow's evidence. */}
      <div className="mt-10 grid grid-cols-3 gap-4 text-center text-sm font-bold text-slate-600">
        <div className="border-t-2 border-slate-400 pt-2">
          {prep ? "جهّز (المخزن)" : "استلم (المخزن)"}
        </div>
        <div className="border-t-2 border-slate-400 pt-2">فحص (المشرف)</div>
        <div className="border-t-2 border-slate-400 pt-2">اعتماد (المدير)</div>
      </div>
    </DocumentShell>
  );
}
