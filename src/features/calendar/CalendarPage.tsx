import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/app/authContext";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EVENT_STATUS_LABELS } from "@/features/events/eventWorkspace.model";
import { readinessTone } from "@/features/events/operationalReadiness";
import { useEvents, type EventRow } from "@/features/events/events.api";
import { useQuery } from "@tanstack/react-query";
import { callRpc } from "@/lib/rpc";
import {
  buildMonthGrid,
  groupEventsByDay,
  monthLabel,
  type LocalDay,
} from "./calendarModel";

type ViewMode = "month" | "day";

const WEEKDAYS = ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

export function CalendarPage() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const events = useEvents(orgId);

  const today = new Date();
  const [view, setView] = useState<ViewMode>("month");
  const [selected, setSelected] = useState<LocalDay>({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    day: today.getDate(),
  });

  const eventsByDay = useMemo(
    () => groupEventsByDay(events.data?.rows ?? []),
    [events.data],
  );

  const weeks = useMemo(
    () => buildMonthGrid(selected.year, selected.month, eventsByDay),
    [selected.year, selected.month, eventsByDay],
  );

  const selectedKey = `${selected.year}-${String(selected.month).padStart(2, "0")}-${String(selected.day).padStart(2, "0")}`;
  const dayEvents = (eventsByDay.get(selectedKey) ?? []).sort((a, b) =>
    a.start_at.localeCompare(b.start_at),
  );
  const todayEvents = (eventsByDay.get(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
  ) ?? []).sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <div>
      <PageHeader title="التقويم" description="رؤية المناسبات يومياً أو شهرياً — اضغط على يوم لعرض مناسباته" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label="عرض التقويم">
          {([["month", "الشهر"], ["day", "اليوم"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              aria-pressed={view === value}
              className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold ${view === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "month" && (
          <p className="text-lg font-black text-slate-800">{monthLabel(selected.year, selected.month)}</p>
        )}
      </div>

      {view === "month" ? (
        <Card className="p-3">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-bold text-slate-400">
                {d}
              </div>
            ))}
            {weeks.flat().map((cell) =>
              cell.inMonth ? (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() =>
                    setSelected((s) => ({ ...s, year: selected.year, month: selected.month, day: cell.day }))
                  }
                  className={`flex min-h-14 flex-col items-center justify-center rounded-xl border text-sm ${
                    cell.day === selected.day ? "border-brand-500 bg-brand-50 font-black text-brand-800" : "border-transparent text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>{cell.day}</span>
                  {cell.events.length > 0 && (
                    <span className="mt-0.5 h-2 w-2 rounded-full bg-brand-600" />
                  )}
                </button>
              ) : (
                <div key={cell.key} className="min-h-14" />
              ),
            )}
          </div>
          <DayList events={dayEvents} orgId={orgId} />
        </Card>
      ) : (
        <DayList events={todayEvents} orgId={orgId} />
      )}
    </div>
  );
}

function DayList({ events, orgId }: { events: EventRow[]; orgId: string | null }) {
  const readiness = useReadinessForEvents(orgId, events) ?? {};
  if (events.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
        لا توجد مناسبات في هذا اليوم.
      </p>
    );
  }
  return (
    <ul className="mt-4 space-y-2">
      {events.map((event) => {
        const r = readiness[event.id];
        return (
          <li key={event.id}>
            <Link to="/events/$eventId" params={{ eventId: event.id }} className="block">
              <Card className="p-3 hover:border-brand-300">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{event.title}</p>
                    <p className="truncate text-sm text-slate-500">
                      {new Date(event.start_at).toLocaleTimeString("ar-OM", { timeZone: "Asia/Muscat" })} · {event.venue_name}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Badge tone={readinessTone(r?.status)}>{r?.status === "READY" ? "جاهزة" : r ? "غير جاهزة" : ""}</Badge>
                    <Badge tone="neutral">{EVENT_STATUS_LABELS[event.status] ?? event.status}</Badge>
                  </div>
                </div>
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Batch readiness for the events shown in a day (reuses the batched RPC). */
function useReadinessForEvents(orgId: string | null, events: EventRow[]) {
  return useQuery({
    queryKey: ["calendar-readiness", orgId, events.map((e) => e.id).join(",")],
    enabled: !!orgId && events.length > 0,
    queryFn: async () => {
      // Only the canonical STATUS is consumed here (calendar chips); the full
      // reason list stays in the dashboard/command-center projections.
      const rows = await callRpc<Array<{ event_id: string; status: "READY" | "NOT_READY" }>>(
        "event_readiness_batch",
        { p_org_id: orgId, p_event_ids: events.map((e) => e.id) },
      );
      return Object.fromEntries(rows.map((r) => [r.event_id, r])) as Record<
        string,
        { event_id: string; status: "READY" | "NOT_READY" }
      >;
    },
  }).data;
}
