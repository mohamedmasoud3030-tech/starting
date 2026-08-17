import { Card } from "@/components/ui/Card";
import type { EventAuditRow } from "../events.api";

/** Status transitions + the append-only audit trail for OWNER/MANAGER. */
export function HistoryTab({
  history,
  audit,
}: {
  history: ReadonlyArray<{
    id: number;
    from_status: string | null;
    to_status: string;
    reason: string | null;
    created_at: string;
  }>;
  audit: ReadonlyArray<EventAuditRow>;
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="status-history-title">
        <h2 id="status-history-title" className="mb-2 text-lg font-black">
          سجل الحالات
        </h2>
        <ol className="space-y-3">
          {history.map((h) => (
            <li key={h.id}>
              <Card>
                <p className="font-bold">
                  {h.from_status ? `${h.from_status} ← ` : ""}
                  {h.to_status}
                </p>
                <p className="text-sm text-slate-500">
                  {new Date(h.created_at).toLocaleString("ar-OM")}
                  {h.reason && ` · ${h.reason}`}
                </p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {audit.length > 0 && (
        <section aria-labelledby="audit-history-title">
          <h2 id="audit-history-title" className="mb-2 text-lg font-black">
            سجل التدقيق
          </h2>
          <ol className="space-y-3">
            {audit.map((a) => (
              <li key={a.id}>
                <Card>
                  <p className="font-bold" dir="ltr">
                    {a.action}
                  </p>
                  <p className="text-sm text-slate-500">
                    {new Date(a.created_at).toLocaleString("ar-OM", {
                      timeZone: "Asia/Muscat",
                    })}
                  </p>
                </Card>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
