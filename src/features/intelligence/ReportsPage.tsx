import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/app/authContext";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatOMR } from "@/lib/money";
import {
  rangeForFilter,
  useReportCustomers,
  useReportEvents,
  useReportPackages,
  type TimeFilter,
} from "./intelligence.api";

/**
 * Focused reporting layer (E7) that answers real business questions, with
 * Muscat-safe time filters (E8). Revenue / collected / outstanding / cost /
 * profit are always shown separately. No decorative charts.
 */
export function ReportsPage() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const [filter, setFilter] = useState<TimeFilter>("month");
  const range = rangeForFilter(filter);

  const events = useReportEvents(orgId, range.from, range.to);
  const customers = useReportCustomers(orgId);
  const packages = useReportPackages(orgId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="التقارير"
        description="أسئلة الأعمال الحقيقية: الإيراد، الربحية، المناسبات، الباقات، والعملاء"
        actions={
          <div className="flex gap-1" role="group" aria-label="فترة التقرير">
            {([["today", "اليوم"], ["week", "الأسبوع"], ["month", "الشهر"], ["all", "الكل"]] as const).map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={`min-h-11 rounded-xl px-3 text-sm font-bold ${filter === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {label}
                </button>
              ),
            )}
          </div>
        }
      />

      <Card className="overflow-hidden">
        <h2 className="border-b border-slate-100 p-4 font-black">الإيراد والربحية حسب المناسبة</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-right">
                <th className="p-3 font-bold">المناسبة</th>
                <th className="p-3 font-bold">الحالة</th>
                <th className="p-3 font-bold">الإيراد</th>
                <th className="p-3 font-bold">المحصل</th>
                <th className="p-3 font-bold">المتبقي</th>
                <th className="p-3 font-bold">التكاليف</th>
                <th className="p-3 font-bold">الربح</th>
                <th className="p-3 font-bold">الهامش</th>
              </tr>
            </thead>
            <tbody>
              {(events.data ?? []).length === 0 ? (
                <tr><td colSpan={8} className="p-4 text-center text-slate-500">لا توجد مناسبات في هذه الفترة.</td></tr>
              ) : (
                (events.data ?? []).map((e) => (
                  <tr key={e.event_id} className="border-b border-slate-100">
                    <td className="p-3">
                      <Link to="/events/$eventId" params={{ eventId: e.event_id }} className="font-bold text-brand-700 hover:underline">
                        {e.title}
                      </Link>
                    </td>
                    <td className="p-3 text-slate-500">{e.status}</td>
                    <td className="p-3 font-bold">{formatOMR(fromDbNum(e.revenue))}</td>
                    <td className="p-3">{formatOMR(fromDbNum(e.collected))}</td>
                    <td className="p-3">{formatOMR(fromDbNum(e.outstanding))}</td>
                    <td className="p-3">{formatOMR(fromDbNum(e.actual_cost))}</td>
                    <td className="p-3 font-bold text-brand-800">{formatOMR(fromDbNum(e.gross_profit))}</td>
                    <td className="p-3">{e.margin_percent != null ? `${e.margin_percent.toFixed(1)}%` : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="overflow-hidden">
          <h2 className="border-b border-slate-100 p-4 font-black">الباقات — الاستخدام مقابل الربحية</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-right">
                  <th className="p-3 font-bold">الباقة</th>
                  <th className="p-3 font-bold">الاستخدام</th>
                  <th className="p-3 font-bold">القيمة</th>
                  <th className="p-3 font-bold">الربح</th>
                  <th className="p-3 font-bold">الهامش</th>
                </tr>
              </thead>
              <tbody>
                {(packages.data ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="p-4 text-center text-slate-500">لا توجد باقات.</td></tr>
                ) : (
                  (packages.data ?? []).map((p) => (
                    <tr key={p.package_id} className="border-b border-slate-100">
                      <td className="p-3 font-bold">{p.package_name}</td>
                      <td className="p-3">{p.usage_count}</td>
                      <td className="p-3">{formatOMR(fromDbNum(p.commercial_value))}</td>
                      <td className="p-3 font-bold text-brand-800">{formatOMR(fromDbNum(p.gross_profit))}</td>
                      <td className="p-3">{p.margin_percent != null ? `${p.margin_percent.toFixed(1)}%` : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <h2 className="border-b border-slate-100 p-4 font-black">العملاء — الأعلى قيمة</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-right">
                  <th className="p-3 font-bold">العميل</th>
                  <th className="p-3 font-bold">المناسبات</th>
                  <th className="p-3 font-bold">القيمة</th>
                  <th className="p-3 font-bold">المتبقي</th>
                  <th className="p-3 font-bold">الربح</th>
                </tr>
              </thead>
              <tbody>
                {(customers.data ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="p-4 text-center text-slate-500">لا توجد بيانات.</td></tr>
                ) : (
                  (customers.data ?? []).map((c) => (
                    <tr key={c.customer_id} className="border-b border-slate-100">
                      <td className="p-3">
                        <Link to="/customers/$customerId" params={{ customerId: c.customer_id }} className="font-bold text-brand-700 hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="p-3">{c.events_count}</td>
                      <td className="p-3 font-bold">{formatOMR(fromDbNum(c.total_value))}</td>
                      <td className="p-3">{formatOMR(fromDbNum(c.outstanding))}</td>
                      <td className="p-3 font-bold text-brand-800">{formatOMR(fromDbNum(c.gross_profit))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function fromDbNum(value: number | null | undefined): number {
  return Math.round((value ?? 0) * 1000);
}
