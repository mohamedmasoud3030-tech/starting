import { Card } from "@/components/ui/Card";
import { EVENT_STATUS_LABELS } from "../eventWorkspace.model";
import type { StatusHistoryRow } from "../events.api";

const ORDERED_STATUSES = [
  "DRAFT",
  "QUOTED",
  "CONFIRMED",
  "PREPARING",
  "DISPATCHED",
  "IN_PROGRESS",
  "RETURNING",
  "CLOSED",
  "CANCELLED",
] as const;

/**
 * Compact operational timeline of the event's status history, newest first.
 * Built from the append-only `event_status_history` (single source of truth),
 * not from the mutable status column.
 */
export function EventTimeline({ history }: { history: StatusHistoryRow[] }) {
  const ordered = [...history]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 8);

  if (ordered.length === 0) {
    return null;
  }

  return (
    <Card>
      <h2 className="font-black">خط زمني</h2>
      <ol className="mt-3 space-y-2 border-s-2 border-slate-200 ps-4">
        {ordered.map((h) => {
          const label = EVENT_STATUS_LABELS[h.to_status] ?? h.to_status;
          return (
            <li key={h.id} className="relative">
              <span className="absolute -start-[1.15rem] top-1.5 h-3 w-3 rounded-full bg-brand-600" />
              <p className="font-bold">{label}</p>
              <p className="text-sm text-slate-500">
                {new Date(h.created_at).toLocaleString("ar-OM", {
                  timeZone: "Asia/Muscat",
                })}
                {h.reason ? ` — ${h.reason}` : ""}
              </p>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export { ORDERED_STATUSES };
