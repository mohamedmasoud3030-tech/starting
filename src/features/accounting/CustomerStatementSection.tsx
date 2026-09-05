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
import { AccountingCustomerStatement } from "@/features/documents/AccountingCustomerStatement";
import { PrintDocumentDialog } from "@/features/documents/PrintDocumentDialog";
import { useCustomers } from "@/features/customers/customers.api";
import { useOrganizationSettings } from "@/features/settings/settings.api";
import { formatOMR, fromDbAmount } from "@/lib/money";
import { STATEMENT_PAGE_SIZE, useAccountingCustomerStatement } from "./accounting.api";
import { dateOnly, sourceTypeLabel } from "./presentation";

/**
 * Customer statement with allocation detail (0096 §20): chronological
 * customer-side journal activity (event-scoped), impact + running
 * outstanding from the §17 identity, and the authoritative gross/net/VAT
 * allocation record per participating payment.
 */
export function CustomerStatementSection() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const customers = useCustomers(orgId);
  const settings = useOrganizationSettings(orgId);

  const [customerId, setCustomerId] = useState("");
  const [limit, setLimit] = useState(STATEMENT_PAGE_SIZE);
  const [printOpen, setPrintOpen] = useState(false);

  const statement = useAccountingCustomerStatement(orgId, customerId || null, limit);

  const selectedCustomer = (customers.data?.rows ?? []).find(
    (c) => c.id === customerId,
  );

  function changeCustomer(next: string) {
    setCustomerId(next);
    setLimit(STATEMENT_PAGE_SIZE);
  }

  const rows = statement.data ?? [];
  const hasMore = rows.length === limit;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-56 flex-1">
            <Field label="العميل" htmlFor="accounting-customer-picker">
              <Select
                id="accounting-customer-picker"
                value={customerId}
                onChange={(e) => changeCustomer(e.target.value)}
              >
                <option value="">اختر عميلاً…</option>
                {(customers.data?.rows ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            variant="outline"
            disabled={!customerId}
            onClick={() => setPrintOpen(true)}
          >
            <Printer className="h-4 w-4" />
            طباعة / حفظ PDF
          </Button>
        </div>
      </Card>

      {!customerId ? (
        <EmptyState
          title="اختر عميلاً لعرض كشف حسابه"
          description="يعرض الكشف الحركات المحاسبية للعميل مع تفاصيل تخصيص المدفوعات على الفواتير."
        />
      ) : statement.isLoading ? (
        <LoadingState label="جارٍ تجهيز كشف الحساب…" />
      ) : statement.error ? (
        <ErrorState
          title="تعذّر تحميل كشف الحساب"
          message="حدث خطأ أثناء تحميل كشف حساب العميل. أعد المحاولة."
          onRetry={() => void statement.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="لا توجد حركات محاسبية"
          description="لم تُسجَّل لهذا العميل حركات محاسبية (دفعات، فواتير، إثبات إيراد) بعد."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-right">
                  <th className="p-3 font-bold">التاريخ</th>
                  <th className="p-3 font-bold">البيان</th>
                  <th className="p-3 font-bold">التأثير (ر.ع.)</th>
                  <th className="p-3 font-bold">الرصيد الجاري</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <StatementBodyRow key={`${r.entry_number}-${i}`} row={r} />
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
        title="كشف حساب عميل"
        description="الحركات المحاسبية مع تفاصيل التخصيص من النموذج الرسمي (0096)."
      >
        {statement.isSuccess && selectedCustomer && (
          <AccountingCustomerStatement
            identity={buildDocumentIdentity(currentOrganization, settings.data ?? null)}
            customerName={selectedCustomer.name}
            asOf={new Date().toISOString()}
            rows={rows}
          />
        )}
      </PrintDocumentDialog>
    </div>
  );
}

function StatementBodyRow({
  row,
}: {
  row: NonNullable<ReturnType<typeof useAccountingCustomerStatement>["data"]>[number];
}) {
  return (
    <>
      <tr className="border-b border-slate-100 align-top">
        <td className="p-3 whitespace-nowrap">{dateOnly(row.entry_date)}</td>
        <td className="p-3">
          <span className="font-bold">{sourceTypeLabel(row.source_type)}</span>
          {row.is_reversal && <span className="mr-1 text-red-600">(إلغاء)</span>}
          {row.document_number && (
            <span dir="ltr" className="mr-1 font-semibold">
              {row.document_number}
            </span>
          )}
          {row.event_number && (
            <span className="mr-1 text-slate-500">{row.event_number}</span>
          )}
          {row.memo && <span className="block text-slate-500">{row.memo}</span>}
        </td>
        <td className="p-3 text-left" dir="ltr">
          {formatOMR(fromDbAmount(row.impact_on_outstanding))}
        </td>
        <td className="p-3 text-left font-bold" dir="ltr">
          {formatOMR(fromDbAmount(row.running_outstanding))}
        </td>
      </tr>
      {row.allocations && row.allocations.length > 0 && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td className="p-3" />
          <td colSpan={3} className="p-3">
            <details>
              <summary className="cursor-pointer text-xs font-bold text-slate-500">
                تفاصيل التخصيص ({row.allocations.length})
              </summary>
              <ul className="mt-1 space-y-1 text-xs text-slate-600">
                {row.allocations.map((a, j) => (
                  <li key={j} dir="ltr" className="flex flex-wrap justify-between gap-x-4">
                    <span>
                      {[a.payment_reference ? `دفعة ${a.payment_reference}` : null,
                        a.invoice_number ? `فاتورة ${a.invoice_number}` : null]
                        .filter(Boolean)
                        .join(" — ") || "تخصيص"}
                    </span>
                    <span>
                      الإجمالي {formatOMR(fromDbAmount(a.gross_amount))} · الصافي{" "}
                      {formatOMR(fromDbAmount(a.net_amount))} · الضريبة{" "}
                      {formatOMR(fromDbAmount(a.vat_amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </td>
        </tr>
      )}
    </>
  );
}
