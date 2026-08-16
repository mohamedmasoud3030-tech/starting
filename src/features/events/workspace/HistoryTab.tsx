import { Card } from "@/components/ui/Card";

export function HistoryTab({
  history,
}: {
  history: ReadonlyArray<{
    id: number;
    from_status: string | null;
    to_status: string;
    reason: string | null;
    created_at: string;
  }>;
}) {
  return (
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
  );
}
