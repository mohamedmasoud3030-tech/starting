import { DocumentShell } from "@/components/documents/DocumentShell";
import type { DocumentIdentity } from "@/components/documents/documentIdentity";
import { formatOMR, fromDbAmount } from "@/lib/money";
import { PRICING_METHOD_LABELS } from "@/lib/domain";
import type { QuotationLineRow } from "./quotes.api";

export interface QuotationDocumentData {
  quotationNumber: string | null;
  customerName: string;
  customerPhone: string | null;
  eventTitle: string;
  guestCount: number | null;
  startAt: string | null;
  venue: string | null;
  subtotal: string | number;
  transportAmount: string | number;
  transportNote: string | null;
  surchargeAmount: string | number;
  discountAmount: string | number;
  totalSelling: string | number;
  preVatTotal: string | number | null;
  vatRegistered: boolean | null;
  vatPercent: number | null;
  vatAmount: string | number | null;
  vatRegistrationNumber: string | null;
  revision: number;
  issuedAt: string | null;
  validUntil: string | null;
}

/**
 * Printable quotation document — the customer-facing artifact. Renders the
 * quotation lines and total inside the shared DocumentShell so it carries the
 * organization's letterhead, contact block, terms and signature.
 */
export function QuotationDocument({
  identity,
  data,
  lines,
}: {
  identity: DocumentIdentity;
  data: QuotationDocumentData;
  lines: QuotationLineRow[];
}) {
  const dateText = data.issuedAt
    ? new Date(data.issuedAt).toLocaleDateString("ar-OM", {
        timeZone: "Asia/Muscat",
      })
    : null;

  const eventDate = data.startAt
    ? new Date(data.startAt).toLocaleString("ar-OM", {
        timeZone: "Asia/Muscat",
      })
    : "غير محدد";

  return (
    <DocumentShell
      identity={identity}
      title="عرض سعر"
      documentNumber={data.quotationNumber}
      dateText={dateText}
      meta={
        <div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-slate-500">العميل: </span>
            <span className="font-bold">{data.customerName}</span>
            {data.customerPhone && (
              <>
                {" · "}
                <span dir="ltr">{data.customerPhone}</span>
              </>
            )}
          </div>
          <div>
            <span className="text-slate-500">المناسبة: </span>
            <span className="font-bold">{data.eventTitle}</span>
          </div>
          <div>
            <span className="text-slate-500">الموعد: </span>
            <span className="font-bold">{eventDate}</span>
          </div>
          <div>
            <span className="text-slate-500">الموقع: </span>
            <span className="font-bold">{data.venue ?? "غير محدد"}</span>
          </div>
          <div>
            <span className="text-slate-500">عدد الضيوف: </span>
            <span className="font-bold">{data.guestCount ?? "غير محدد"}</span>
          </div>
          <div>
            <span className="text-slate-500">الإصدار: </span>
            <span className="font-bold">{data.revision}</span>
          </div>
          {data.validUntil && (
            <div>
              <span className="text-slate-500">صالح حتى: </span>
              <span className="font-bold">
                {new Date(data.validUntil).toLocaleDateString("ar-OM", {
                  timeZone: "Asia/Muscat",
                })}
              </span>
            </div>
          )}
        </div>
      }
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-300 text-right">
            <th className="py-2 pe-2 font-black">البند</th>
            <th className="py-2 px-2 font-black">الكمية</th>
            <th className="py-2 px-2 font-black">الوحدة</th>
            <th className="py-2 ps-2 text-left font-black">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-4 text-center text-slate-500">
                لا توجد بنود.
              </td>
            </tr>
          ) : (
            lines.map((line) => (
              <tr key={line.id} className="border-b border-slate-100">
                <td className="py-2 pe-2 font-bold">{line.description}</td>
                <td className="py-2 px-2">{line.quantity}</td>
                <td className="py-2 px-2">
                  {line.unit} · {PRICING_METHOD_LABELS[line.pricing_method] ?? line.pricing_method}
                </td>
                <td className="py-2 ps-2 text-left font-bold">
                  {formatOMR(fromDbAmount(line.total_selling))}
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200">
            <td colSpan={3} className="py-1 pe-2 text-slate-600">
              المجموع الفرعي
            </td>
            <td className="py-1 ps-2 text-left font-bold">
              {formatOMR(fromDbAmount(data.subtotal))}
            </td>
          </tr>
          {fromDbAmount(data.transportAmount) > 0 && (
            <tr>
              <td colSpan={3} className="py-1 pe-2 text-slate-600">
                النقل{data.transportNote ? ` (${data.transportNote})` : ""}
              </td>
              <td className="py-1 ps-2 text-left font-bold">
                {formatOMR(fromDbAmount(data.transportAmount))}
              </td>
            </tr>
          )}
          {fromDbAmount(data.surchargeAmount) > 0 && (
            <tr>
              <td colSpan={3} className="py-1 pe-2 text-slate-600">
                رسوم إضافية
              </td>
              <td className="py-1 ps-2 text-left font-bold">
                {formatOMR(fromDbAmount(data.surchargeAmount))}
              </td>
            </tr>
          )}
          {fromDbAmount(data.discountAmount) > 0 && (
            <tr>
              <td colSpan={3} className="py-1 pe-2 text-red-600">
                الخصم
              </td>
              <td className="py-1 ps-2 text-left font-bold text-red-600">
                -{formatOMR(fromDbAmount(data.discountAmount))}
              </td>
            </tr>
          )}
          {data.vatRegistered && data.preVatTotal != null && (
            <tr>
              <td colSpan={3} className="py-1 pe-2 text-slate-600">
                المجموع قبل الضريبة
              </td>
              <td className="py-1 ps-2 text-left font-bold">
                {formatOMR(fromDbAmount(data.preVatTotal))}
              </td>
            </tr>
          )}
          {data.vatRegistered && (
            <tr>
              <td colSpan={3} className="py-1 pe-2 text-slate-600">
                ضريبة القيمة المضافة ({data.vatPercent}%)
                {data.vatRegistrationNumber ? ` — ${data.vatRegistrationNumber}` : ""}
              </td>
              <td className="py-1 ps-2 text-left font-bold">
                {formatOMR(fromDbAmount(data.vatAmount))}
              </td>
            </tr>
          )}
          <tr className="border-t-2 border-slate-300">
            <td colSpan={3} className="py-3 pe-2 text-base font-black">
              الإجمالي النهائي
            </td>
            <td className="py-3 ps-2 text-left text-xl font-black text-brand-800">
              {formatOMR(fromDbAmount(data.totalSelling))}
            </td>
          </tr>
        </tfoot>
      </table>
    </DocumentShell>
  );
}
