import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/Badge";
import { OwnerVoiceButton } from "@/features/ownerVoice/OwnerVoiceButton";
import { EVENT_STATUS_LABELS } from "../eventWorkspace.model";
import type { EventRow } from "../events.api";

/** Workspace header: back link, event identity, status badge, voice button. */
export function EventWorkspaceHeader({
  event,
  voiceSummary,
}: {
  event: EventRow;
  voiceSummary: string;
}) {
  return (
    <>
      <Link to="/events" className="font-bold text-brand-700">
        → العودة إلى المناسبات
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-slate-500" dir="ltr">
            {event.event_number}
          </p>
          <h1 className="text-2xl font-black">{event.title}</h1>
          <p className="text-slate-600">
            {new Date(event.start_at).toLocaleString("ar-OM", {
              timeZone: "Asia/Muscat",
            })}{" "}
            · {event.venue_name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={event.status === "CANCELLED" ? "danger" : "brand"}>
            {EVENT_STATUS_LABELS[event.status]}
          </Badge>
          <OwnerVoiceButton summary={voiceSummary} />
        </div>
      </div>
    </>
  );
}
