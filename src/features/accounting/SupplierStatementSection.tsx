import { useState } from "react";
import { Printer } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { LoadingState } from "@/components/ui/LoadingState";
import { Select } from "@/components/ui/Select";
import { buildDocumentIdentity } from "@/components/documents/documentIdentity";
import { SupplierStatement } from "@/features/documents/SupplierStatement";
import { PrintDocumentDialog } from "@/features/documents/PrintDocumentDialog";
import { useOrganizationSettings } from "@/features/settings/settings.api";
import { formatOMR, fromDbAmount } from "@/lib/money";
import {
  STATEMENT_PAGE_SIZE,
  useSupplierPositions,
  useSupplierStatement,
} from "./accounting.api";
import { dateOnly, sourceTypeLabel } from "./presentation";

/**
 * Supplier statement (0096 §20): chronological AP activity for one supplier
 * with a credit-normal running balance. The picker reuses the 0094 supplier
 * positions so the operator can see each supplier's current AP balance before
 * opening its statement.
 */
export function SupplierStatementSection() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const positions = useSupplierPositions(orgId);
  const settings = useOrganizationSettings(orgId);

  const [supplierId, setSupplierId] = useState("");
  const [limit, setLimit] = useState(STATEMENT_PAGE_SIZE);
  const [printOpen, setPrintOpen] = useState(false);

  const statement = useSupplierStatement(orgId, supplierId || null, limit);

  const selected = (positions.data ?? []).find((s) => s.supplier_id === supplierId);

  function changeSupplier(next: string) {
    setSupplierId(next);
    setLimit(STATEMENT_PAGE_SIZE);
  }

  const rows = statement.data ?? [];
  const hasMore = rows.length === limit;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-56 flex-1">
            <Field label="المورد" htmlFor="accounting-supplier-picker">
              <Select
                id="accounting-supplier-picker"
                value={supplierId}
                onChange={(e) => changeSupplier(e.target.value)}
              >
                <option value="">اختر مورداً…</option>
                {(positions.data ?? []).map((s) => (
                  <option key={s.supplier_id} value={s.supplier_id}>
                    {s.supplier_name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {selected && (
            <div className="text-sm text-slate-500">
              الرصيد المستحق حالياً:{" "}
              <span dir="ltr" className="font-bold text-slate-900">
                {formatOMR(fromDbAmount(selected.ap_balance))}
              </span>
            </div>
          )}
          <Button
            variant="outline"
            disabled={!supplierId}
            onClick={() => setPrintOpen(true)}
          >
            <Printer className="h-4 w-4" />
            طباعة / حفظ PDF
          </Button>
        </div>
      </Card>

      {!supplierId ? (
        <EmptyState
          title="اختر مورداً لعرض كشف حسابه"
          description="يعرض الكشف فواتير المورد ومدفوعاته والرصيد المستحق عليه."
        />
      ) : statement.isLoading ? (
        <LoadingState label="جارٍ تجهيز كشف الحساب…" />
      ) : statement.error ? (
        <ErrorState
          title="تعذّر تحميل كشف الحساب"
          message="حدث خطأ أثناء تحميل كشف حساب المورد. أعد المحاولة."
          onRetry={() => void statement.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="لا توجد حركات محاسبية"
          description="لم تُسجَّل لهذا المورد فواتير أو مدفوعات بعد."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-right">
                  <th className="p-3 font-bold">التاريخ</th>
                  <th className="p-3 font-bold">البيان</th>
                  <th className="p-3 font-bold">مدين (ر.ع.)</th>
                  <th className="p-3 font-bold">دائن (ر.ع.)</th>
                  <th className="p-3 font-bold">الرصيد المستحق</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.entry_number}-${i}`} className="border-b border-slate-100 align-top">
                    <td className="p-3 whitespace-nowrap">{dateOnly(r.entry_date)}</td>
                    <td className="p-3">
                      <span className="font-bold">{sourceTypeLabel(r.source_type)}</span>
                      {r.is_reversal && <span className="mr-1 text-red-600">(إلغاء)</span>}
                      {r.document_number && (
                        <span dir="ltr" className="mr-1 font-semibold">
                          {r.document_number}
                        </span>
                      )}
                      {r.event_number && (
                        <span className="mr-1 text-slate-500">{r.event_number}</span>
                      )}
                      {r.memo && <span className="block text-slate-500">{r.memo}</span>}
                    </td>
                    <td className="p-3 text-left" dir="ltr">
                      {formatOMR(fromDbAmount(r.ap_debit))}
                    </td>
                    <td className="p-3 text-left" dir="ltr">
                      {formatOMR(fromDbAmount(r.ap_credit))}
                    </td>
                    <td className="p-3 text-left font-bold" dir="ltr">
                      {formatOMR(fromDbAmount(r.running_balance))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div className="border-t border-slate-100 p-3 text-center">
              <Button
                variant="outline"
                onClick={() => setLimit((current) => current + STATEMENT_PAGE_SIZE)}
              >
                عرض المزيد
              </Button>
            </div>
          )}
        </Card>
      )}

      <PrintDocumentDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="كشف حساب مورد"
        description="الحركات المحاسبية للمورد من النموذج الرسمي (0096)."
      >
        {statement.isSuccess && selected && (
          <SupplierStatement
            identity={buildDocumentIdentity(currentOrganization, settings.data ?? null)}
            supplierName={selected.supplier_name}
            asOf={new Date().toISOString()}
            rows={rows}
          />
        )}
      </PrintDocumentDialog>
    </div>
  );
}
