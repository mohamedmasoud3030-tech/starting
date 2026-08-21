import { Link } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { OwnerVoiceButton } from "@/features/ownerVoice/OwnerVoiceButton";
import { EVENT_STATUS_LABELS } from "../eventWorkspace.model";
import type { EventRow } from "../events.api";

/** Workspace header: back link, event identity, status badge, edit and voice. */
export function EventWorkspaceHeader({
  event,
  voiceSummary,
  canEdit,
  onEdit,
}: {
  event: EventRow;
  voiceSummary: string;
  canEdit: boolean;
  onEdit: () => void;
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
            · {event.venue_name} · {event.guest_count} ضيف
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={event.status === "CANCELLED" ? "danger" : "brand"}>
            {EVENT_STATUS_LABELS[event.status]}
          </Badge>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              تعديل البيانات
            </Button>
          )}
          <OwnerVoiceButton summary={voiceSummary} />
        </div>
      </div>
    </>
  );
}
