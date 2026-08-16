import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUpLeft,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  MessageCircle,
  Package,
  PackageSearch,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import {
  readinessLabel,
  readinessTone,
} from "@/features/events/readiness.model";
import { OwnerVoiceButton } from "@/features/ownerVoice/OwnerVoiceButton";
import {
  DEFAULT_TIME_ZONE,
  EVENT_STATUS_ARABIC,
  toArabicDigits,
} from "@/features/ownerVoice/screenSummary";
import type { AttendanceGap } from "@/features/staff/staff.api";
import { buildEventWhatsAppUrl } from "./operationalDashboard.model";
import { useOperationalDashboard } from "./useOperationalDashboard";

const timeFormatter = new Intl.DateTimeFormat("ar-OM", {
  timeZone: DEFAULT_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

export function HomePage() {
  const {
    profile,
    currentOrganization,
    dashboard,
    dashboardLoaded,
    readinessByEventId,
    attendanceGaps,
    attentionSummary,
    hasLoadError,
    metrics,
    shortcuts,
  } = useOperationalDashboard();

  const operatorName = profile?.full_name || "فريق التشغيل";
  const priorityCount =
    metrics.attention === null ||
    metrics.attendanceGaps === null ||
    metrics.lowStock === null
      ? null
      : metrics.attention + metrics.attendanceGaps + metrics.lowStock;
  const priorityAlerts = [...dashboard.alerts].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "danger" ? -1 : 1,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={currentOrganization?.name ?? undefined}
        title="مركز تشغيل اليوم"
        description={`متابعة مباشرة للجاهزية والمناسبات والمخزون. ${operatorName}`}
        actions={<OwnerVoiceButton summary={attentionSummary} />}
      />

      {hasLoadError && (
        <ErrorState message="تعذر تحميل جزء من لوحة التشغيل. أعد المحاولة قبل الاعتماد على حالة اليوم." />
      )}

      <TodayStatus
        loaded={dashboardLoaded && metrics.attendanceGaps !== null}
        priorityCount={priorityCount}
      />

      <section aria-labelledby="today-metrics-title">
        <h2 id="today-metrics-title" className="sr-only">
          مؤشرات اليوم
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label="مناسبات اليوم"
            value={metrics.todayEvents}
            icon={CalendarDays}
            tone="brand"
          />
          <StatCard
            label="جاهزة للتنفيذ"
            value={metrics.ready}
            icon={CheckCircle2}
            tone="success"
          />
          <StatCard
            label="تحتاج تدخل"
            value={metrics.attention}
            icon={AlertTriangle}
            tone="warning"
          />
          <StatCard
            label="فجوات الحضور"
            value={metrics.attendanceGaps}
            icon={UserCheck}
            tone="danger"
          />
          <StatCard
            label="مخزون منخفض"
            value={metrics.lowStock}
            icon={PackageSearch}
            tone="danger"
          />
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,.8fr)]">
        <section aria-labelledby="today-events-title" className="min-w-0">
          <SectionHeader
            id="today-events-title"
            title="برنامج اليوم"
            description="المناسبات مرتبة حسب وقت البداية في توقيت مسقط"
            action={
              <Link
                to="/events"
                className="inline-flex items-center gap-1 text-sm font-bold text-brand-700 hover:text-brand-900"
              >
                كل المناسبات
                <ArrowUpLeft className="h-4 w-4" />
              </Link>
            }
          />

          {!dashboardLoaded ? (
            <Card className="p-5 text-slate-500">جارٍ تحميل حالة مناسبات اليوم...</Card>
          ) : dashboard.todayEvents.length === 0 ? (
            <Card className="border-dashed p-8 text-center">
              <CalendarDays className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 font-bold text-slate-800">لا توجد مناسبات مجدولة اليوم</p>
              <p className="mt-1 text-sm text-slate-500">
                راجع كل المناسبات لمتابعة الأيام القادمة.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {dashboard.todayEvents.map((event) => {
                const readiness = readinessByEventId[event.id];
                const whatsappUrl = buildEventWhatsAppUrl(event);
                const needsAttention = readiness?.status !== "READY";

                return (
                  <Card
                    key={event.id}
                    className={`overflow-hidden border-r-4 p-0 ${
                      needsAttention ? "border-r-amber-400" : "border-r-emerald-400"
                    }`}
                  >
                    <div className="p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            to="/events/$eventId"
                            params={{ eventId: event.id }}
                            className="text-lg font-black text-slate-950 hover:text-brand-700"
                          >
                            {event.title}
                          </Link>
                          <p className="mt-1 text-xs font-semibold tracking-wide text-slate-400">
                            {event.event_number}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="neutral">
                            {EVENT_STATUS_ARABIC[event.status] ?? event.status}
                          </Badge>
                          <Badge tone={readinessTone(readiness?.status)}>
                            {readinessLabel(readiness?.status)}
                          </Badge>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 sm:grid-cols-3">
                        <span className="flex items-center gap-2">
                          <Clock3 className="h-4 w-4 text-slate-400" />
                          {timeFormatter.format(new Date(event.start_at))}
                        </span>
                        <span className="flex min-w-0 items-center gap-2">
                          <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="truncate">{event.venue_name}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-slate-400" />
                          {toArabicDigits(event.guest_count)} ضيف
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          to="/events/$eventId"
                          params={{ eventId: event.id }}
                          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-800"
                        >
                          فتح مساحة العمل
                        </Link>
                        {whatsappUrl ? (
                          <a
                            href={whatsappUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100"
                          >
                            <MessageCircle className="h-4 w-4" />
                            واتساب
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <aside aria-labelledby="priorities-title" className="order-first lg:order-none lg:sticky lg:top-24">
          <SectionHeader
            id="priorities-title"
            title="أولوية المتابعة"
            description="المشكلات المثبتة التي تحتاج قرارًا أو تنفيذًا الآن"
            action={
              priorityCount === null ? null : (
                <Badge tone={priorityCount > 0 ? "warning" : "success"}>
                  {toArabicDigits(priorityCount)} نقطة
                </Badge>
              )
            }
          />

          {!dashboardLoaded || metrics.attendanceGaps === null ? (
            <Card className="p-5 text-slate-500">جارٍ التحقق من نقاط المتابعة...</Card>
          ) : priorityAlerts.length === 0 && attendanceGaps.length === 0 ? (
            <Card className="border-emerald-200 bg-emerald-50 p-5">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <div>
                  <p className="font-black text-emerald-950">لا توجد نقاط تدخل حالية</p>
                  <p className="mt-1 text-sm leading-6 text-emerald-800">
                    الجاهزية والمخزون والحضور المستقر متوافقون مع البيانات المتاحة الآن.
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {priorityAlerts.map((alert) => {
                const content = (
                  <Card
                    className={`p-4 transition-colors hover:border-slate-300 ${
                      alert.severity === "danger"
                        ? "border-red-200 bg-red-50/80"
                        : "border-amber-200 bg-amber-50/80"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <AlertTriangle
                        className={`mt-0.5 h-5 w-5 shrink-0 ${
                          alert.severity === "danger" ? "text-red-700" : "text-amber-700"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="font-bold text-slate-950">{alert.title}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-700">{alert.detail}</p>
                      </div>
                    </div>
                  </Card>
                );

                return alert.kind === "EVENT" ? (
                  <Link key={alert.id} to="/events/$eventId" params={{ eventId: alert.eventId }}>
                    {content}
                  </Link>
                ) : (
                  <Link key={alert.id} to="/consumables">
                    {content}
                  </Link>
                );
              })}

              {attendanceGaps.map((gap: AttendanceGap) => (
                <Link key={gap.eventId} to="/events/$eventId" params={{ eventId: gap.eventId }}>
                  <Card className="border-amber-200 bg-amber-50/80 p-4 hover:border-amber-300">
                    <div className="flex items-start gap-3">
                      <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                      <div>
                        <p className="font-bold text-slate-950">{gap.eventTitle}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-700">
                          مسند لها {toArabicDigits(gap.assignmentCount)} مضيفًا، وسُجّل حضور{" "}
                          {toArabicDigits(gap.attendanceCount)} منهم اليوم.
                        </p>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>

      <section aria-labelledby="shortcuts-title" className="border-t border-slate-200 pt-5">
        <SectionHeader
          id="shortcuts-title"
          title="أدوات الإدارة"
          description="وصول سريع للبيانات المرجعية الأكثر استخدامًا"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ShortcutCard label="دليل الخدمات والمواد" value={shortcuts.catalog} icon={Boxes} to="/catalog" />
          <ShortcutCard label="الباقات" value={shortcuts.packages} icon={Package} to="/packages" />
          <ShortcutCard label="العملاء" value={shortcuts.customers} icon={Users} to="/customers" />
        </div>
      </section>
    </div>
  );
}

function TodayStatus({
  loaded,
  priorityCount,
}: {
  loaded: boolean;
  priorityCount: number | null;
}) {
  if (!loaded || priorityCount === null) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-500">
        جارٍ تحديث حالة التشغيل الحالية…
      </div>
    );
  }

  if (priorityCount === 0) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
        <div>
          <p className="font-black text-emerald-950">حالة اليوم مستقرة</p>
          <p className="text-sm text-emerald-800">لا توجد نقاط تدخل مثبتة في الجاهزية أو الحضور أو المخزون.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
      <div>
        <p className="font-black text-amber-950">
          اليوم يحتاج متابعة — {toArabicDigits(priorityCount)} نقطة تشغيلية
        </p>
        <p className="text-sm text-amber-800">ابدأ بقائمة «أولوية المتابعة» ثم راجع مساحة عمل كل مناسبة.</p>
      </div>
    </div>
  );
}

function SectionHeader({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-black text-slate-950 sm:text-xl">
          {title}
        </h2>
        <p className="mt-0.5 text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {action ? <div className="shrink-0 pt-0.5">{action}</div> : null}
    </div>
  );
}

function ShortcutCard({
  label,
  value,
  icon: Icon,
  to,
}: {
  label: string;
  value: number | null;
  icon: typeof Boxes;
  to: "/catalog" | "/packages" | "/customers";
}) {
  return (
    <Link to={to} className="group">
      <Card className="p-4 transition-all group-hover:-translate-y-0.5 group-hover:border-brand-300 group-hover:shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-700">{label}</p>
            <p className="mt-0.5 text-xl font-black text-slate-950">{value ?? "—"}</p>
          </div>
          <ArrowUpLeft className="h-4 w-4 text-slate-300 transition-colors group-hover:text-brand-600" />
        </div>
      </Card>
    </Link>
  );
}
