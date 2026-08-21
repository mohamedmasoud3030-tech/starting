import { useParams } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Phone, MessageCircle } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { CUSTOMER_TYPE_LABELS } from "@/lib/domain";
import { formatOMR, fromDbAmount } from "@/lib/money";
import { omanTelUrl, omanWhatsAppUrl } from "@/lib/phone";
import { useCustomer360 } from "@/features/intelligence/intelligence.api";

/**
 * Customer 360 (E4): a single customer's profile, commercial history and
 * financial relationship — understandable facts, not a fabricated score.
 */
export function CustomerDetail() {
  const { customerId } = useParams({ from: "/app/customers/$customerId" });
  const { currentOrganization, canReadCost } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const c360 = useCustomer360(orgId);

  const row = (c360.data ?? []).find((c) => c.customer_id === customerId);

  if (c360.isLoading) return <p className="py-12 text-center text-slate-500">جارٍ التحميل…</p>;
  if (!row) return <p className="py-12 text-center text-slate-500">تعذر العثور على العميل.</p>;

  const repeatCustomer = row.events_count >= 2;

  const telUrl = omanTelUrl(row.phone);
  const whatsappUrl = omanWhatsAppUrl(row.phone);

  return (
    <div className="space-y-5">
      <Link to="/customers" className="font-bold text-brand-700">→ العودة إلى العملاء</Link>
      <PageHeader
        title={row.name}
        description={row.phone ?? ""}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {telUrl && (
              <a
                href={telUrl}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 hover:bg-slate-50"
              >
                <Phone className="h-4 w-4" />
                اتصال
              </a>
            )}
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
              >
                <MessageCircle className="h-4 w-4" />
                واتساب
              </a>
            )}
            <Link
              to="/quotes/new"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800"
            >
              عرض سعر جديد
            </Link>
            <Badge tone={row.is_active ? "brand" : "neutral"}>
              {CUSTOMER_TYPE_LABELS[row.customer_type as keyof typeof CUSTOMER_TYPE_LABELS] ?? row.customer_type}
            </Badge>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-black">العلاقة</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">عدد المناسبات</dt>
              <dd className="font-bold">{row.events_count}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">مناسبات قادمة</dt>
              <dd className="font-bold">{row.upcoming_events}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">مناسبات مكتملة</dt>
              <dd className="font-bold">{row.completed_events}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">عميل متكرر</dt>
              <dd>
                <Badge tone={repeatCustomer ? "success" : "neutral"}>
                  {repeatCustomer ? "نعم" : "لا"}
                </Badge>
              </dd>
            </div>
            {row.days_since_last_event != null && (
              <div className="flex justify-between">
                <dt className="text-slate-500">منذ آخر مناسبة</dt>
                <dd className="font-bold">{row.days_since_last_event} يوم</dd>
              </div>
            )}
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="font-black">التاريخ التجاري</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">عروض الأسعار</dt>
              <dd className="font-bold">{row.quotes_count}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">عروض معتمدة</dt>
              <dd className="font-bold">{row.accepted_quotes}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">عروض مرفوضة</dt>
              <dd className="font-bold">{row.rejected_quotes}</dd>
            </div>
            {row.last_interaction_at && (
              <div className="flex justify-between">
                <dt className="text-slate-500">آخر تفاعل</dt>
                <dd className="font-bold">
                  {new Date(row.last_interaction_at).toLocaleDateString("ar-OM", { timeZone: "Asia/Muscat" })}
                </dd>
              </div>
            )}
          </dl>
        </Card>
      </div>

      {canReadCost && (
        <Card className="p-5">
          <h2 className="font-black">العلاقة المالية</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FinanceStat label="إجمالي القيمة" value={formatOMR(fromDbAmount(row.total_commercial_value))} />
            <FinanceStat label="المحصل" value={formatOMR(fromDbAmount(row.total_collected))} />
            <FinanceStat label="المتبقي" value={formatOMR(fromDbAmount(row.outstanding))} />
            <FinanceStat label="الربح المحقق" value={formatOMR(fromDbAmount(row.gross_profit))} tone="brand" />
          </div>
        </Card>
      )}
    </div>
  );
}

function FinanceStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "brand" }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-black ${tone === "brand" ? "text-brand-800" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}
