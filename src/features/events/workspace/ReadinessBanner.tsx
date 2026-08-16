import { Card } from "@/components/ui/Card";
import { readinessText } from "../eventWorkspace.model";
import type { EventReadiness } from "../events.api";

export function ReadinessBanner({ readiness }: { readiness: EventReadiness }) {
  return (
    <Card
      className={
        readiness.status === "READY"
          ? "border-emerald-300 bg-emerald-50"
          : "border-amber-300 bg-amber-50"
      }
    >
      <p className="font-black">{readinessText(readiness)}</p>
    </Card>
  );
}
