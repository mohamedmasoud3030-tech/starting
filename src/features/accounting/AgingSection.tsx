import { useAuth } from "@/app/authContext";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { formatOMR, fromDbAmount, type DbAmount, type MilliOMR } from "@/lib/money";
import { agingBucketLabel, agingBucketTone, dateOnly } from "./presentation";
import {
  useApAging,
  useArAging,
  useContractAssetAging,
  type ApAgingRow,
  type ArAgingRow,
  type ContractAssetAgingRow,
} from "./accounting.api";

interface AgingDisplayRow {
  id: string;
  primary: string;
  secondary: string | null;
  amount: DbAmount;
  originDate: string | null;
  ageDays: number | null;
  bucket: string;
}

function toArRows(rows: ArAgingRow[]): AgingDisplayRow[] {
  return rows.map((r) => ({
    id: r.event_id,
    primary: r.event_number,
    secondary: r.customer_name ?? null,
    amount: r.ar_gross,
    originDate: r.ar_origin_date ?? null,
    ageDays: r.age_days ?? null,
    bucket: r.aging_bucket,
  }));
}

function toApRows(rows: ApAgingRow[]): AgingDisplayRow[] {
  return rows.map((r) => ({
    id: r.supplier_id,
    primary: r.supplier_name,
    secondary: null,
    amount: r.ap_balance,
    originDate: r.ap_origin_date ?? null,
    ageDays: r.age_days ?? null,
    bucket: r.aging_bucket,
  }));
}

function toCaRows(rows: ContractAssetAgingRow[]): AgingDisplayRow[] {
  return rows.map((r) => ({
    id: r.event_id,
    primary: r.event_number,
    secondary: r.customer_name ?? null,
    amount: r.contract_asset_gross,
    originDate: r.recognition_date ?? null,
    ageDays: r.age_days ?? null,
    bucket: r.aging_bucket,
  }));
}

/**
 * Aging overview (0096): AR / AP / contract-asset aging. Amounts are gross
 * ledger figures (AR and contract asset carry their VAT component per the
 * posting contract); buckets are derived server-side from the as-of date.
 * Each card keeps its own loading / error / empty state.
 */
export function AgingSection() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;

  const ar = useArAging(orgId);
  const ap = useApAging(orgId);
  const ca = useContractAssetAging(orgId);

  return (
    <div className="space-y-5">
      <AgingCard
        title="أعمار الذمم المدينة (العملاء)"
        description="فواتير صادرة لم تُحصَّل بعد — الإجمالي شامل الضريبة"
        hasSecondary
        rows={ar.isSuccess ? toArRows(ar.data ?? []) : null}
        loading={ar.isLoading}
        error={ar.error}
        onRetry={() => void ar.refetch()}
      />
      <AgingCard
        title="أعمار الذمم الدائنة (الموردون)"
        description="مستحقات لموردين لم تُسدَّد بعد"
        hasSecondary={false}
        rows={ap.isSuccess ? toApRows(ap.data ?? []) : null}
        loading={ap.isLoading}
        error={ap.error}
        onRetry={() => void ap.refetch()}
      />
      <AgingCard
        title="أعمار أصول العقود (إيراد غير مفوتر)"
        description="مناسبات مغلقة أُثبت إيرادها قبل إصدار الفاتورة — الإجمالي شامل الضريبة"
        hasSecondary
        rows={ca.isSuccess ? toCaRows(ca.data ?? []) : null}
        loading={ca.isLoading}
        error={ca.error}
        onRetry={() => void ca.refetch()}
      />
    </div>
  );
}

function AgingCard({
  title,
  description,
  hasSecondary,
  rows,
  loading,
  error,
  onRetry,
}: {
  title: string;
  description: string;
  hasSecondary: boolean;
  rows: AgingDisplayRow[] | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  let totalMilli: MilliOMR = 0;
  if (rows) {
    for (const r of rows) totalMilli += fromDbAmount(r.amount);
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
        <div>
          <h2 className="font-black">{title}</h2>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        <div className="text-left">
          <p className="text-sm text-slate-500">الإجمالي</p>
          <p dir="ltr" className="text-lg font-black text-brand-800">
            {formatOMR(totalMilli)}
          </p>
        </div>
      </div>

      {loading ? (
        <LoadingState label="جارٍ تجهيز الأعمار…" />
      ) : error ? (
        <ErrorState
          title="تعذّر تحميل الأعمار"
          message="حدث خطأ أثناء تحميل بيانات التقادم. أعد المحاولة."
          onRetry={onRetry}
          className="m-4"
        />
      ) : !rows || rows.length === 0 ? (
        <p className="p-6 text-center text-slate-500">
          لا توجد أرصدة متقادمة في هذه الفئة.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-right">
                <th className="p-3 font-bold">{hasSecondary ? "المناسبة" : "الجهة"}</th>
                {hasSecondary && <th className="p-3 font-bold">العميل</th>}
                <th className="p-3 font-bold">المبلغ (ر.ع.)</th>
                <th className="p-3 font-bold">تاريخ النشأة</th>
                <th className="p-3 font-bold">العمر</th>
                <th className="p-3 font-bold">الفئة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-3 font-bold" dir="ltr">
                    {r.primary}
                  </td>
                  {hasSecondary && (
                    <td className="p-3 text-slate-600">{r.secondary ?? "—"}</td>
                  )}
                  <td className="p-3 font-bold" dir="ltr">
                    {formatOMR(fromDbAmount(r.amount))}
                  </td>
                  <td className="p-3 whitespace-nowrap">{dateOnly(r.originDate) ?? "—"}</td>
                  <td className="p-3 whitespace-nowrap">
                    {r.ageDays != null ? `${r.ageDays} يوم` : "—"}
                  </td>
                  <td className="p-3">
                    <Badge tone={agingBucketTone(r.bucket)}>
                      {agingBucketLabel(r.bucket)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
