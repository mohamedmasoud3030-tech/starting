import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MapPin, Plus, Users } from "lucide-react";
import { useSession } from "@/app/session";
import { useEngine } from "@/engine/engine";
import {
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  type EventStatus,
} from "@/lib/domain";
import {
  addDaysKey,
  formatMuscatRange,
  muscatDateKey,
  todayMuscatKey,
  weekRangeContaining,
} from "@/lib/time";
import { Button, Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { EventStatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

type DateFilter = "today" | "tomorrow" | "week" | "all";

export function EventsPage() {
  const { session } = useSession();
  const state = useEngine();
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [statusFilter, setStatusFilter] = useState<EventStatus | "ALL">("ALL");

  const events = useMemo(() => {
    const today = todayMuscatKey();
    const tomorrow = addDaysKey(today, 1);
    const week = weekRangeContaining(new Date().toISOString());
    return state.events
      .filter((e) => e.organizationId === session!.organizationId)
      .filter((e) => {
        const key = muscatDateKey(e.startAt);
        if (dateFilter === "today") return key === today;
        if (dateFilter === "tomorrow") return key === tomorrow;
        if (dateFilter === "week") return key >= week.startKey && key <= week.endKey;
        return true;
      })
      .filter((e) => (statusFilter === "ALL" ? true : e.status === statusFilter))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [state.events, session, dateFilter, statusFilter]);

  const filters: Array<{ id: DateFilter; label: string }> = [
    { id: "today", label: "اليوم" },
    { id: "tomorrow", label: "غداً" },
    { id: "week", label: "هذا الأسبوع" },
    { id: "all", label: "الكل" },
  ];

  return (
    <div>
      <PageHeader
        title="المناسبات"
        subtitle="جدول التشغيل — اضغط المناسبة لفتح مساحة العمل."
        actions={
          <Link to="/events/new">
            <Button size="lg">
              <Plus className="h-5 w-5" />
              مناسبة جديدة
            </Button>
          </Link>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setDateFilter(f.id)}
            className={cn(
              "min-h-11 rounded-full px-4 text-sm font-bold",
              dateFilter === f.id
                ? "bg-brand-700 text-white"
                : "bg-white text-slate-700 ring-1 ring-slate-200",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        <button
          onClick={() => setStatusFilter("ALL")}
          className={cn(
            "min-h-10 rounded-full px-3 text-sm font-bold",
            statusFilter === "ALL"
              ? "bg-slate-800 text-white"
              : "bg-white text-slate-600 ring-1 ring-slate-200",
          )}
        >
          كل الحالات
        </button>
        {(Object.keys(EVENT_STATUS_LABELS) as EventStatus[]).map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={cn(
              "min-h-10 rounded-full px-3 text-sm font-bold",
              statusFilter === st
                ? "bg-slate-800 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200",
            )}
          >
            {EVENT_STATUS_LABELS[st]}
          </button>
        ))}
      </div>

      {events.length === 0 ? (
        <EmptyState
          title="لا توجد مناسبات في هذا التصفية"
          action={
            <Link to="/events/new">
              <Button>إنشاء مناسبة</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const customer = state.customers.find((c) => c.id === event.customerId);
            return (
              <Link key={event.id} to={`/events/${event.id}`}>
                <Card className="transition hover:border-brand-300">
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-extrabold tracking-wide text-brand-700">
                          {event.eventNumber}
                        </p>
                        <h2 className="text-xl font-extrabold text-slate-900">
                          {customer?.name ?? "عميل"}
                        </h2>
                        <p className="text-sm text-slate-500">
                          {EVENT_TYPE_LABELS[event.eventType]} · {event.title}
                        </p>
                      </div>
                      <EventStatusBadge status={event.status} />
                    </div>
                    <p className="text-base font-bold text-slate-800">
                      {formatMuscatRange(event.startAt, event.endAt)}
                    </p>
                    <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {event.venueName}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        {event.guestCount} ضيف
                      </span>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
