import { Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  MessageCircle,
  Package,
  PackageSearch,
  Users,
} from "lucide-react";
import { useAuth } from "@/app/authContext";
import { COST_READER_ROLES } from "@/lib/domain";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCatalogItems } from "@/features/catalog/catalog.api";
import { useConsumableStock } from "@/features/consumables/consumables.api";
import { useCustomers } from "@/features/customers/customers.api";
import { eventReadinessQuery, useEvents } from "@/features/events/events.api";
import { usePackages } from "@/features/packages/packages.api";
import { OwnerVoiceButton } from "@/features/ownerVoice/OwnerVoiceButton";
import {
  buildAttentionVoiceSummary,
  DEFAULT_TIME_ZONE,
  EVENT_STATUS_ARABIC,
  isSameLocalDay,
  toArabicDigits,
} from "@/features/ownerVoice/screenSummary";
import { useAttendanceGaps, type AttendanceGap } from "@/features/staff/staff.api";
import {
  buildEventWhatsAppUrl,
  buildOperationalDashboard,
} from "./operationalDashboard.model";

const timeFormatter = new Intl.DateTimeFormat("ar-OM", {
  timeZone: DEFAULT_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

function readinessLabel(status: string | undefined): string {
  switch (status) {
    case "READY":
      return "جاهزة";
    case "STAFF_MISSING":
      return "نقص في الفريق";
    case "EQUIPMENT_SHORTAGE":
      return "نقص معدات";
    case "MULTIPLE_ISSUES":
      return "تحتاج تدخل";
    default:
      return "الجاهزية غير متاحة";
  }
}

export function HomePage() {
  const { profile, currentOrganization, currentRole } = useAuth();
  const orgId = currentOrganization?.id ?? null;

  const catalog = useCatalogItems(orgId);
  const packages = usePackages(orgId);
  const customers = useCustomers(orgId);
  const events = useEvents(orgId);
  const stock = useConsumableStock(orgId);

  const todayEvents = (events.data ?? []).filter(
    (event) =>
      event.status !== "CANCELLED" &&
      isSameLocalDay(event.start_at, new Date(), DEFAULT_TIME_ZONE),
  );
  const readinessQueries = useQueries({
    queries: todayEvents.map((event) => eventReadinessQuery(orgId, event.id)),
  });
  const readinessSettled =
    events.isSuccess && readinessQueries.every((query) => query.isFetched);

  const readinessByEventId = Object.fromEntries(
    todayEvents.map((event, index) => [
      event.id,
      readinessQueries[index]?.data ?? null,
    ]),
  );
  const dashboard = buildOperationalDashboard({
    events: events.data ?? [],
    readinessByEventId,
    stockLines: stock.data?.lines ?? [],
  });
  const dashboardLoaded = readinessSettled && stock.isSuccess;

  const gaps = useAttendanceGaps(orgId);
  const attendanceGapCount = (gaps.data ?? []).length;
  const attentionSummary = buildAttentionVoiceSummary({
    todayEventCount: dashboardLoaded ? dashboard.todayEvents.length : 0,
    readyCount: dashboardLoaded ? dashboard.readyCount : 0,
    attentionCount: dashboardLoaded ? dashboard.eventAttentionCount : 0,
    lowStockCount: dashboardLoaded ? dashboard.lowStockCount : 0,
    attendanceGapCount,
    canReadFinance: !!currentRole && COST_READER_ROLES.includes(currentRole),
  });

  const name = profile?.full_name || "أهلاً بك";

  const metrics = [
    {
      label: "مناسبات اليوم",
      value: dashboardLoaded ? dashboard.todayEvents.length : "—",
      icon: CalendarDays,
      tone: "text-brand-700 bg-brand-50",
    },
    {
      label: "جاهزة للتنفيذ",
      value: dashboardLoaded ? dashboard.readyCount : "—",
      icon: CheckCircle2,
      tone: "text-emerald-700 bg-emerald-50",
    },
    {
      label: "تحتاج تدخل",
      value: dashboardLoaded ? dashboard.eventAttentionCount : "—",
      icon: AlertTriangle,
      tone: "text-amber-700 bg-amber-50",
    },
    {
      label: "مواد مخزونها منخفض",
      value: dashboardLoaded ? dashboard.lowStockCount : "—",
      icon: PackageSearch,
      tone: "text-red-700 bg-red-50",
    },
  ];

  const shortcuts = [
    {
      label: "صنف في الكتالوج",
      value: catalog.data?.length ?? "—",
      icon: Boxes,
      to: "/catalog" as const,
    },
    {
      label: "باقة جاهزة",
      value: packages.data?.length ?? "—",
      icon: Package,
      to: "/packages" as const,
    },
    {
      label: "عميل",
      value: customers.data?.length ?? "—",
      icon: Users,
      to: "/customers" as const,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${name}، ${currentOrganization?.name ?? ""}`}
        description="لوحة تشغيل اليوم: المناسبات، الجاهزية والتنبيهات التي تحتاج تدخل"
        actions={<OwnerVoiceButton summary={attentionSummary} />}
      />

      {(events.isError || stock.isError) && (
        <Card className="border-red-200 bg-red-50 p-4 text-red-800">
          تعذر تحميل جزء من لوحة التشغيل. أعد المحاولة قبل الاعتماد على حالة اليوم.
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label} className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-500 sm:text-base">
                  {metric.label}
                </p>
                <p className="mt-1 text-3xl font-bold text-slate-900">
                  {metric.value}
                </p>
              </div>
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${metric.tone}`}>
                <metric.icon className="h-5 w-5" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <section aria-labelledby="today-events-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="today-events-title" className="text-xl font-bold text-slate-900">
              مناسبات اليوم
            </h2>
            <p className="text-sm text-slate-500">مرتبة حسب وقت البداية في توقيت مسقط</p>
          </div>
          <Link to="/events" className="text-sm font-bold text-brand-700 hover:text-brand-900">
            كل المناسبات
          </Link>
        </div>

        {!dashboardLoaded ? (
          <Card className="p-5 text-slate-500">جارٍ تحميل حالة مناسبات اليوم...</Card>
        ) : dashboard.todayEvents.length === 0 ? (
          <Card className="p-5 text-slate-600">لا توجد مناسبات مجدولة اليوم.</Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {dashboard.todayEvents.map((event) => {
              const readiness = readinessByEventId[event.id];
              const whatsappUrl = buildEventWhatsAppUrl(event);
              const ready = readiness?.status === "READY";

              return (
                <Card key={event.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link
                        to="/events/$eventId"
                        params={{ eventId: event.id }}
                        className="text-lg font-bold text-slate-900 hover:text-brand-700"
                      >
                        {event.title}
                      </Link>
                      <p className="mt-1 text-sm text-slate-500">{event.event_number}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone="neutral">
                        {EVENT_STATUS_ARABIC[event.status] ?? event.status}
                      </Badge>
                      <Badge tone={ready ? "success" : "warning"}>
                        {readinessLabel(readiness?.status)}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                    <span className="flex items-center gap-2">
                      <Clock3 className="h-4 w-4 text-slate-400" />
                      {timeFormatter.format(new Date(event.start_at))}
                    </span>
                    <span className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-slate-400" />
                      {event.venue_name}
                    </span>
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-slate-400" />
                      {event.guest_count} ضيف
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                    <Link
                      to="/events/$eventId"
                      params={{ eventId: event.id }}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-700 px-4 py-2 text-sm font-bold text-white hover:bg-brand-800"
                    >
                      فتح مساحة العمل
                    </Link>
                    {whatsappUrl ? (
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100"
                      >
                        <MessageCircle className="h-4 w-4" />
                        مشاركة واتساب
                      </a>
                    ) : (
                      <span className="inline-flex min-h-11 items-center rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
                        لا يوجد رقم تواصل صالح
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="alerts-title">
        <div className="mb-3">
          <h2 id="alerts-title" className="text-xl font-bold text-slate-900">
            التنبيهات التشغيلية
          </h2>
          <p className="text-sm text-slate-500">
            تنبيهات مشتقة من الجاهزية والمخزون الفعلي، وليست إحصائيات تقديرية.
          </p>
        </div>

        {!dashboardLoaded ? (
          <Card className="p-5 text-slate-500">جارٍ فحص التنبيهات...</Card>
        ) : dashboard.alerts.length === 0 ? (
          <Card className="border-emerald-200 bg-emerald-50 p-5 text-emerald-800">
            لا توجد تنبيهات تشغيلية تحتاج تدخل الآن.
          </Card>
        ) : (
          <div className="space-y-3">
            {dashboard.alerts.map((alert) => {
              const body = (
                <Card
                  className={
                    alert.severity === "danger"
                      ? "border-red-200 bg-red-50 p-4"
                      : "border-amber-200 bg-amber-50 p-4"
                  }
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle
                      className={
                        alert.severity === "danger"
                          ? "mt-0.5 h-5 w-5 shrink-0 text-red-700"
                          : "mt-0.5 h-5 w-5 shrink-0 text-amber-700"
                      }
                    />
                    <div>
                      <p className="font-bold text-slate-900">{alert.title}</p>
                      <p className="mt-1 text-sm text-slate-700">{alert.detail}</p>
                    </div>
                  </div>
                </Card>
              );

              return alert.kind === "EVENT" ? (
                <Link key={alert.id} to="/events/$eventId" params={{ eventId: alert.eventId }}>
                  {body}
                </Link>
              ) : (
                <Link key={alert.id} to="/consumables">
                  {body}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="attention-center-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="attention-center-title" className="text-xl font-bold text-slate-900">
              مركز انتباه المالك
            </h2>
            <p className="text-sm text-slate-500">ما يحتاج عينك اليوم — اضغط زر الصوت لتسمعه.</p>
          </div>
          <OwnerVoiceButton summary={attentionSummary} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <p className="text-sm font-semibold text-slate-500">مناسبات اليوم</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {dashboardLoaded ? dashboard.todayEvents.length : "—"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-semibold text-slate-500">تحتاج تدخل</p>
            <p className="mt-1 text-2xl font-bold text-amber-700">
              {dashboardLoaded ? dashboard.eventAttentionCount : "—"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-semibold text-slate-500">لم يُسجَّل حضورها</p>
            <p className="mt-1 text-2xl font-bold text-red-700">{attendanceGapCount}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-semibold text-slate-500">مخزون منخفض</p>
            <p className="mt-1 text-2xl font-bold text-red-700">
              {dashboardLoaded ? dashboard.lowStockCount : "—"}
            </p>
          </Card>
        </div>

        {!gaps.isLoading && (gaps.data ?? []).length > 0 && (
          <div className="space-y-2">
            {(gaps.data ?? []).map((g: AttendanceGap) => (
              <Link key={g.eventId} to="/events/$eventId" params={{ eventId: g.eventId }}>
                <Card className="border-amber-200 bg-amber-50 p-4 hover:border-amber-300">
                  <p className="font-bold text-slate-900">{g.eventTitle}</p>
                  <p className="mt-1 text-sm text-slate-700">
                    مُسند لها {toArabicDigits(g.assignmentCount)} مضيفاً ولم يُسجَّل حضور {toArabicDigits(g.attendanceCount)} منهم اليوم.
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="shortcuts-title">
        <h2 id="shortcuts-title" className="mb-3 text-xl font-bold text-slate-900">
          اختصارات الإدارة
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {shortcuts.map((shortcut) => (
            <Link key={shortcut.label} to={shortcut.to} className="group">
              <Card className="p-5 transition-colors group-hover:border-brand-300">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base text-slate-500">{shortcut.label}</p>
                    <p className="mt-1 text-3xl font-bold text-slate-900">
                      {shortcut.value}
                    </p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                    <shortcut.icon className="h-6 w-6" />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
