import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/app/authContext";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { callRpc } from "@/lib/rpc";
import { useEvents, type EventRow } from "@/features/events/events.api";
import { readinessTone } from "@/features/events/operationalReadiness";

type ReadinessRow = { event_id: string } & import("@/features/events/operationalReadiness").OperationalReadiness;

/**
 * Daily operations board: what is today, what is tomorrow, what is not ready,
 * and what is waiting on dispatch or return — grouped from the live event list
 * and the batched readiness read model. No fabricated numbers.
 */
export function OperationsBoard() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const events = useEvents(orgId);
  const rows = events.data?.rows ?? [];

  const readiness = useQuery({
    queryKey: ["operations-readiness", orgId, rows.map((e) => e.id).join(",")],
    enabled: !!orgId && rows.length > 0,
    queryFn: async () => {
      const data = await callRpc<ReadinessRow[]>("event_readiness_batch", {
        p_org_id: orgId,
        p_event_ids: rows.map((e) => e.id),
      });
      return Object.fromEntries(data.map((r) => [r.event_id, r])) as Record<string, ReadinessRow>;
    },
  });
  const readinessByEvent = readiness.data ?? {};

  const active = rows.filter((e) => e.status !== "CLOSED" && e.status !== "CANCELLED");

  const dayKey = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };
  const todayKey = dayKey(0);
  const tomorrowKey = dayKey(1);
  const muscatDayKey = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return `${g("year")}-${g("month")}-${g("day")}`;
  };

  const today = active.filter((e) => muscatDayKey(e.start_at) === todayKey);
  const tomorrow = active.filter((e) => muscatDayKey(e.start_at) === tomorrowKey);
  const notReady = active.filter((e) => {
    const r = readinessByEvent[e.id];
    return r && r.status !== "READY";
  });
  const toDispatch = active.filter((e) => e.status === "PREPARING");
  const toReturn = active.filter((e) =>
    ["DISPATCHED", "IN_PROGRESS", "RETURNING"].includes(e.status),
  );

  return (
    <div className="space-y-5">
      <PageHeader title="لوحة التشغيل" description="نظرة يومية: اليوم، غداً، ما غير الجاهز، وما ينتظر الإرسال أو الإرجاع" />

      <div className="grid gap-4 md:grid-cols-2">
        <BoardSection title="مناسبات اليوم" events={today} readinessByEvent={readinessByEvent} emptyText="لا توجد مناسبات اليوم." />
        <BoardSection title="مناسبات الغد" events={tomorrow} readinessByEvent={readinessByEvent} emptyText="لا توجد مناسبات غداً." />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <BoardSection title="غير جاهزة" events={notReady} readinessByEvent={readinessByEvent} emptyText="كل المناسبات النشطة جاهزة أو بلا متطلبات." />
        <BoardSection title="بانتظار الإرسال" events={toDispatch} readinessByEvent={readinessByEvent} emptyText="لا توجد مناسبات بانتظار الإرسال." />
        <BoardSection title="بانتظار الإرجاع" events={toReturn} readinessByEvent={readinessByEvent} emptyText="لا توجد معدات بانتظار الإرجاع." />
      </div>
    </div>
  );
}

function BoardSection({
  title,
  events,
  readinessByEvent,
  emptyText,
}: {
  title: string;
  events: EventRow[];
  readinessByEvent: Record<string, ReadinessRow>;
  emptyText: string;
}) {
  return (
    <Card className="p-4">
      <h2 className="font-black">{title}</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {events.map((e) => {
            const r = readinessByEvent[e.id];
            return (
              <li key={e.id}>
                <Link to="/events/$eventId" params={{ eventId: e.id }} className="block">
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 hover:border-brand-300">
                    <div className="min-w-0">
                      <p className="truncate font-bold">{e.title}</p>
                      <p className="truncate text-sm text-slate-500">
                        {new Date(e.start_at).toLocaleString("ar-OM", { timeZone: "Asia/Muscat" })} · {e.venue_name}
                      </p>
                      {r && r.status !== "READY" && (
                        <p className="mt-1 text-xs font-bold text-amber-700">
                          ناقص: فريق {r.staff_missing} · معدات {r.equipment_shortage}
                        </p>
                      )}
                    </div>
                    <Badge tone={readinessTone(r?.status)}>
                      {r?.status === "READY" ? "جاهزة" : r ? "غير جاهزة" : "—"}
                    </Badge>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
