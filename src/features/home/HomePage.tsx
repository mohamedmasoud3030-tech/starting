import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Clock3,
  HelpCircle,
  MapPin,
  MessageCircle,
  Package,
  PackageSearch,
  UserCheck,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { TruncationNotice } from "@/components/ui/TruncationNotice";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import {
  readinessLabel,
  readinessReasonLabel,
  readinessReasonTab,
  readinessTone,
} from "@/features/events/operationalReadiness";
import { EVENT_STATUS_ARABIC, toArabicDigits } from "@/lib/arabic";
import { DEFAULT_TIME_ZONE } from "@/lib/dates";
import type { AttendanceGap } from "@/features/staff/staff.api";
import { buildEventWhatsAppUrl, todayBlockers } from "./operationalDashboard.model";
import { outstandingMilliText } from "./dailyOperations.api";
import { FirstStepsCard } from "./FirstStepsCard";
import { useOperationalDashboard } from "./useOperationalDashboard";

const timeFormatter = new Intl.DateTimeFormat("ar-OM", {
  timeZone: DEFAULT_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Readiness badge with a shape cue in addition to tone and text: the daily
 * question «هل المناسبة جاهزة؟» must be scannable by hue-independent means
 * (aging eyes / color-vision deficiency / sunlight on site).
 */
function ReadinessBadge({ status }: { status: string | null | undefined }) {
  return (
    <Badge tone={readinessTone(status)}>
      {status === "READY" ? (
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      ) : status === "NOT_READY" ? (
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {readinessLabel(status)}
    </Badge>
  );
}

/** Skeleton mirroring a today-event card's geometry (zero layout shift). */
function EventCardsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
    >
      <span className="sr-only">جارٍ تحميل حالة مناسبات اليوم…</span>
      {[0, 1, 2].map((i) => (
        <Card key={i} className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />
          <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
            <Skeleton className="h-11 w-32 rounded-xl" />
            <Skeleton className="h-11 w-28 rounded-xl" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Skeleton mirroring two compact list rows (collections / closures / alerts). */
function ListRowsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="space-y-2">
      <span className="sr-only">{label}</span>
      {[0, 1].map((i) => (
        <Card key={i} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </Card>
      ))}
    </div>
  );
}

/**
 * Today / Daily Operations dashboard (Scope D).
 *
 * Structure mirrors the office's morning question — WHAT IS HAPPENING TODAY
 * AND WHAT NEEDS ATTENTION? Each event card is a decision, not a summary:
 * time, readiness badge, one chip per canonical server reason, a deep link to
 * the tab that resolves the reason, and (for money-visible roles) the
 * outstanding figure. Collection and closure sections are separate,
 * permission-gated projections — and the readiness data on this screen is the
 * SAME server model the event command center renders, never a second formula.
 */
export function HomePage() {
  const {
    profile,
    currentOrganization,
    dashboard,
    dashboardLoaded,
    readinessByEventId,
    attendanceGaps,
    hasLoadError,
    eventsTruncated,
    metrics,
    shortcuts,
    isNewOrganization,
    canReadFinance,
    canRecordPayment,
    canManageEvents,
    canCloseFinancially,
    collections,
    closures,
    collectionsLoaded,
    closuresLoaded,
  } = useOperationalDashboard();

  const name = profile?.full_name || "أهلاً بك";
  const showCollections = canReadFinance || canRecordPayment;
  const showClosures = canManageEvents || canCloseFinancially;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${name}، ${currentOrganization?.name ?? ""}`}
        description="لوحة تشغيل اليوم: المناسبات، الجاهزية والتنبيهات التي تحتاج تدخل"
      />

      {isNewOrganization && <FirstStepsCard />}

      {hasLoadError && (
        <ErrorState message="تعذر تحميل جزء من لوحة التشغيل. أعد المحاولة قبل الاعتماد على حالة اليوم." />
      )}

      {eventsTruncated && (
        <TruncationNotice message="عدد مناسباتك تجاوز حد العرض. جزء من مناسبات — وقد يشمل مناسبات اليوم — غير معروض في هذه اللوحة." />
      )}

      <section aria-labelledby="today-metrics-title">
        <h2 id="today-metrics-title" className="sr-only">
          مؤشرات اليوم
        </h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-5">
          <StatCard label="مناسبات اليوم" value={metrics.todayEvents} icon={CalendarDays} tone="brand" />
          <StatCard label="جاهزة للتنفيذ" value={metrics.ready} icon={CheckCircle2} tone="success" />
          <StatCard label="تحتاج تدخل" value={metrics.attention} icon={AlertTriangle} tone="warning" />
          <StatCard label="لم يُسجَّل حضورها" value={metrics.attendanceGaps} icon={UserCheck} tone="danger" />
          <StatCard label="مواد مخزونها منخفض" value={metrics.lowStock} icon={PackageSearch} tone="danger" />
        </div>
      </section>

      <section aria-labelledby="today-events-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="today-events-title" className="text-xl font-bold text-slate-900">
              مناسبات اليوم
            </h2>
            <p className="text-base text-slate-500">
              المرتبطة بالحاجة إلى إجراء أولاً، ثم حسب وقت البداية في توقيت مسقط
            </p>
          </div>
          <Link to="/events" className="text-base font-bold text-brand-700 hover:text-brand-900">
            كل المناسبات
          </Link>
        </div>

        {!dashboardLoaded ? (
          <EventCardsSkeleton />
        ) : dashboard.todayEvents.length === 0 ? (
          <Card className="p-5 text-slate-600">
            لا توجد مناسبات مجدولة اليوم — تابع المناسبات القادمة من التقويم أو لوحة التشغيل.
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {dashboard.todayEvents.map((event) => {
              const readiness = readinessByEventId[event.id];
              const blockers = todayBlockers(readiness);
              const whatsappUrl = buildEventWhatsAppUrl(event);

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
                      <p className="mt-1 text-base text-slate-500">{event.event_number}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-slate-600">
                        {timeFormatter.format(new Date(event.start_at))}
                      </span>
                      <Badge tone="neutral">
                        {EVENT_STATUS_ARABIC[event.status] ?? event.status}
                      </Badge>
                      <ReadinessBadge status={readiness?.status} />
                    </div>
                  </div>

                  {blockers.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2" aria-label="عوائق اليوم">
                      {blockers.map((reason) => (
                        <li key={reason}>
                          <Link
                            to="/events/$eventId"
                            params={{ eventId: event.id }}
                            search={{ tab: readinessReasonTab(reason) }}
                            className="inline-flex min-h-9 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-bold text-amber-900 hover:bg-amber-100"
                          >
                            {readinessReasonLabel(reason)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {readiness?.status === "READY" && blockers.length === 0 && (
                    <p className="mt-3 flex items-center gap-1.5 text-base font-semibold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      جاهزة — لا عوائق تشغيلية مسجلة
                    </p>
                  )}

                  <div className="mt-3 grid gap-1 text-base text-slate-600 sm:grid-cols-3">
                    <span className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      {event.venue_name}
                    </span>
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      {event.guest_count} ضيف
                    </span>
                    <span className="flex items-center gap-2">
                      <Clock3 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      {EVENT_STATUS_ARABIC[event.status] ?? event.status}
                    </span>
                  </div>

                  {canReadFinance && readiness?.status === "NOT_READY" && (
                    <p className="mt-2 text-sm text-slate-400">
                      ملاحظة: الجاهزية التشغيلية لا تتأثر بالتحصيل — راجع قسم «يحتاج تحصيل» بشكل منفصل.
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                    <Link
                      to="/events/$eventId"
                      params={{ eventId: event.id }}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-700 px-4 py-2 text-base font-bold text-white hover:bg-brand-800"
                    >
                      فتح مركز القيادة
                    </Link>
                    {whatsappUrl ? (
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-base font-bold text-emerald-800 hover:bg-emerald-100"
                      >
                        <MessageCircle className="h-4 w-4" aria-hidden="true" />
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

      {showCollections && (
        <section aria-labelledby="collections-title">
          <div className="mb-3">
            <h2 id="collections-title" className="text-xl font-bold text-slate-900">
              يحتاج تحصيل
            </h2>
            <p className="text-base text-slate-500">
              مبالغ متبقية على مناسبات نشطة أو منتهية — منفصل تماماً عن الجاهزية التشغيلية.
            </p>
          </div>
          {!collectionsLoaded ? (
            <ListRowsSkeleton label="جارٍ فحص التحصيل…" />
          ) : collections.length === 0 ? (
            <Card className="border-emerald-200 bg-emerald-50 p-5 text-emerald-800">
              لا متبقٍ يستحق المتابعة الآن — التحصيل مطابق للقيمة المعتمدة.
            </Card>
          ) : (
            <ul className="space-y-2">
              {collections.map((row) => (
                <li key={row.event_id}>
                  <Link to="/events/$eventId" params={{ eventId: row.event_id }} search={{ tab: "المدفوعات" }}>
                    <Card className="p-4 hover:border-brand-300">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-bold text-slate-900">
                            {row.event_title}
                            <span className="mr-2 text-base font-normal text-slate-500">
                              · {row.customer_name}
                            </span>
                          </p>
                          <p className="text-base text-slate-500">
                            {row.event_number} · {timeFormatter.format(new Date(row.start_at))}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {row.overdue && <Badge tone="danger">متأخر</Badge>}
                          <span className="font-black text-amber-900" dir="ltr">
                            متبقٍ {outstandingMilliText(row.outstanding)} OMR
                          </span>
                        </div>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {showClosures && (
        <section aria-labelledby="closures-title">
          <div className="mb-3">
            <h2 id="closures-title" className="text-xl font-bold text-slate-900">
              مناسبات جاهزة للإغلاق
            </h2>
            <p className="text-base text-slate-500">
              الإغلاق التشغيلي يتطلب إرجاع المعدات وتسوية المواد؛ الإغلاق المالي يتطلب استيفاء المتبقي — وفق قواعد النظام نفسها.
            </p>
          </div>
          {!closuresLoaded ? (
            <ListRowsSkeleton label="جارٍ فحص حالات الإغلاق…" />
          ) : closures.length === 0 ? (
            <Card className="p-5 text-slate-600">
              لا توجد مناسبات تستحق إجراء إغلاق الآن.
            </Card>
          ) : (
            <ul className="space-y-2">
              {closures.map((row) => (
                <li key={`${row.event_id}:${row.action}`}>
                  <Link
                    to="/events/$eventId"
                    params={{ eventId: row.event_id }}
                    search={{ tab: "ملخص" }}
                  >
                    <Card className="p-4 hover:border-brand-300">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold text-slate-900">
                          {row.event_title}
                          <span className="mr-2 text-base font-normal text-slate-500">
                            · {row.event_number}
                          </span>
                        </p>
                        <div className="flex items-center gap-2">
                          {row.outstanding !== null && (
                            <span className="text-base text-slate-500" dir="ltr">
                              متبقٍ {outstandingMilliText(row.outstanding)}
                            </span>
                          )}
                          <Badge tone={row.action === "CLOSE_OPS" ? "brand" : "warning"}>
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {row.action === "CLOSE_OPS"
                              ? "جاهزة للإغلاق التشغيلي"
                              : "جاهزة للإغلاق المالي"}
                          </Badge>
                        </div>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="alerts-title">
        <div className="mb-3">
          <h2 id="alerts-title" className="text-xl font-bold text-slate-900">
            التنبيهات التشغيلية
          </h2>
          <p className="text-base text-slate-500">
            تنبيهات مشتقة من الجاهزية والمخزون الفعلي، وليست إحصائيات تقديرية.
          </p>
        </div>

        {!dashboardLoaded ? (
          <ListRowsSkeleton label="جارٍ فحص التنبيهات…" />
        ) : dashboard.alerts.length === 0 && attendanceGaps.length === 0 ? (
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
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-bold text-slate-900">{alert.title}</p>
                      <p className="mt-1 text-base text-slate-700">{alert.detail}</p>
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

            {attendanceGaps.map((gap: AttendanceGap) => (
              <Link key={gap.eventId} to="/events/$eventId" params={{ eventId: gap.eventId }} search={{ tab: "الحضور" }}>
                <Card className="border-amber-200 bg-amber-50 p-4 hover:border-amber-300">
                  <div className="flex items-start gap-3">
                    <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
                    <div>
                      <p className="font-bold text-slate-900">{gap.eventTitle}</p>
                      <p className="mt-1 text-base text-slate-700">
                        مُسند لها {toArabicDigits(gap.assignmentCount)} مضيفاً ولم يُسجَّل حضور{" "}
                        {toArabicDigits(gap.attendanceCount)} منهم اليوم.
                      </p>
                    </div>
                  </div>
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
          <ShortcutCard label="صنف في الكتالوج" value={shortcuts.catalog} icon={Boxes} to="/catalog" />
          <ShortcutCard label="باقة جاهزة" value={shortcuts.packages} icon={Package} to="/packages" />
          <ShortcutCard label="عميل" value={shortcuts.customers} icon={Users} to="/customers" />
        </div>
      </section>
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
      <Card className="p-5 transition-colors group-hover:border-brand-300">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base text-slate-500">{label}</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{value ?? "—"}</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
            <Icon className="h-6 w-6" aria-hidden="true" />
          </div>
        </div>
      </Card>
    </Link>
  );
}
