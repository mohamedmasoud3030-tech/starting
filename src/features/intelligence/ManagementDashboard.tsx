import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CalendarDays, TrendingUp, Wallet } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatOMR } from "@/lib/money";
import {
  rangeForFilter,
  useManagementAlerts,
  useManagementMetrics,
  type TimeFilter,
} from "./intelligence.api";

const SEVERITY_TONE: Record<string, "warning" | "danger" | "neutral"> = {
  INFO: "neutral",
  WARNING: "warning",
  CRITICAL: "danger",
};

/**
 * Management dashboard (E1) + Today Command Center (E2). Consumes the two
 * canonical SQL functions (`management_metrics`, `management_alerts`); every
 * figure is server-computed, explainable, and a Link into the source records.
 */
export function ManagementDashboard() {
  const { currentOrganization, canReadCost } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const [filter, setFilter] = useState<TimeFilter>("month");
  const range = rangeForFilter(filter);

  const metrics = useManagementMetrics(orgId, range.from, range.to);
  const alerts = useManagementAlerts(orgId);

  const m = metrics.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="لوحة الإدارة"
        description="نظرة إدارية: ما يحدث اليوم، ما يحتاج تدخلاً، أين المال، وما هو مربح فعلاً"
        actions={
          <div className="flex gap-1" role="group" aria-label="فترة العرض">
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

      {/* E2 — Today Command Center (attention queue) */}
      <section aria-labelledby="attention-title">
        <h2 id="attention-title" className="mb-2 flex items-center gap-2 text-lg font-black">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          ما يحتاج انتباهي
        </h2>
        {alerts.isLoading ? (
          <Card className="p-4 text-slate-500">جارٍ فحص التنبيهات…</Card>
        ) : (alerts.data ?? []).length === 0 ? (
          <Card className="border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
            لا توجد عناصر تحتاج تدخلاً الآن.
          </Card>
        ) : (
          <ul className="space-y-2">
            {alerts.data!.slice(0, 12).map((a, i) => (
              <li key={`${a.alert_type}-${a.entity_id}-${i}`}>
                <Link to={a.destination} className="block">
                  <Card className="flex items-start gap-3 p-3 hover:border-brand-300">
                    <Badge tone={SEVERITY_TONE[a.severity]} className="mt-0.5 shrink-0">
                      {a.severity === "CRITICAL" ? "حرج" : a.severity === "WARNING" ? "تنبيه" : "معلومة"}
                    </Badge>
                    <div className="min-w-0">
                      <p className="font-bold">{a.title}</p>
                      <p className="text-sm text-slate-500">{a.explanation}</p>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* E1 — KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={CalendarDays} label="مناسبات اليوم" value={m?.events_today ?? "—"} to="/operations" />
        <Kpi icon={AlertTriangle} label="جاهزية منخفضة" value={m?.events_low_readiness ?? "—"} to="/operations" tone="warning" />
        <Kpi icon={Wallet} label="متبقٍ (ذمم)" value={m ? formatOMR(m.outstanding ?? 0) : "—"} to="/reports" tone="brand" />
        <Kpi icon={TrendingUp} label="ربح الفترة" value={m ? formatOMR(m.gross_profit ?? 0) : "—"} to="/reports" tone="brand" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <h3 className="font-black">التشغيل</h3>
          <dl className="mt-2 space-y-1 text-sm">
            <Metric label="مناسبات اليوم" value={m?.events_today} to="/operations" />
            <Metric label="غداً" value={m?.events_tomorrow} to="/operations" />
            <Metric label="هذا الأسبوع" value={m?.events_week} to="/operations" />
            <Metric label="مؤكدة قادمة" value={m?.confirmed_upcoming} to="/operations" />
            <Metric label="قيد التجهيز" value={m?.events_preparing} to="/operations" />
            <Metric label="قيد التنفيذ" value={m?.events_in_progress} to="/operations" />
            <Metric label="بانتظار الإرجاع" value={m?.events_waiting_return} to="/operations" />
          </dl>
        </Card>

        <Card className="p-4">
          <h3 className="font-black">المبيعات</h3>
          <dl className="mt-2 space-y-1 text-sm">
            <Metric label="مسودات" value={m?.quotes_draft} to="/quotes" />
            <Metric label="بانتظار الرد" value={m?.quotes_waiting} to="/quotes" />
            <Metric label="معتمدة" value={m?.quotes_accepted} to="/quotes" />
            <Metric label="منتهية" value={m?.quotes_expired} to="/quotes" />
            <Metric label="مرفوضة مؤخراً" value={m?.quotes_rejected} to="/quotes" />
            <Metric label="نسبة التحويل" value={m?.quote_conversion_rate != null ? `${m.quote_conversion_rate}%` : "—"} to="/quotes" />
          </dl>
        </Card>

        {canReadCost && (
          <Card className="p-4">
            <h3 className="font-black">المالية</h3>
            <dl className="mt-2 space-y-1 text-sm">
              <Metric label="الإيراد (متجدد)" value={m ? formatOMR(m.revenue ?? 0) : "—"} to="/reports" />
              <Metric label="المحصل" value={m ? formatOMR(m.collected ?? 0) : "—"} to="/reports" />
              <Metric label="الذمم" value={m ? formatOMR(m.outstanding ?? 0) : "—"} to="/reports" />
              <Metric label="التكاليف" value={m ? formatOMR(m.actual_cost ?? 0) : "—"} to="/reports" />
              <Metric label="الربح" value={m ? formatOMR(m.gross_profit ?? 0) : "—"} to="/reports" />
              <Metric label="الهامش" value={m?.margin_percent != null ? `${m.margin_percent.toFixed(1)}%` : "—"} to="/reports" />
              <Metric label="مكتملة مفتوحة مالياً" value={m?.financially_open_completed} to="/integrity" tone="warning" />
              <Metric label="متأخرات" value={m ? formatOMR(m.overdue_balance ?? 0) : "—"} to="/reports" tone="danger" />
            </dl>
          </Card>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  to,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  to: string;
  tone?: "neutral" | "warning" | "danger";
}) {
  return (
    <Link to={to} className="flex items-center justify-between gap-2 rounded-lg px-1 py-0.5 hover:bg-slate-50">
      <span className="text-slate-500">{label}</span>
      <span className={`font-bold ${tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-slate-900"}`}>
        {value}
      </span>
    </Link>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  to,
  tone = "neutral",
}: {
  icon: typeof CalendarDays;
  label: string;
  value: React.ReactNode;
  to: string;
  tone?: "neutral" | "warning" | "brand";
}) {
  return (
    <Link to={to} className="block">
      <Card className={`p-4 hover:border-brand-300 ${tone === "warning" ? "border-amber-200 bg-amber-50/60" : ""}`}>
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">{label}</p>
          <Icon className="h-5 w-5 text-brand-600" />
        </div>
        <p className={`mt-1 text-2xl font-black ${tone === "brand" ? "text-brand-800" : tone === "warning" ? "text-amber-800" : "text-slate-900"}`}>
          {value}
        </p>
      </Card>
    </Link>
  );
}
