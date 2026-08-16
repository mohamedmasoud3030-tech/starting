import { Card } from "@/components/ui/Card";
import { readinessText } from "../eventWorkspace.model";
import { readinessTone } from "../readiness.model";
import type { EventReadiness } from "../events.api";

/**
 * Workspace readiness banner.
 *
 * The sentence stays the workspace's own detailed register (`readinessText`);
 * only the SEVERITY COLOUR is taken from the shared `readinessTone`, so an
 * event that is "تحتاج تدخل" reads as equally severe here and on the
 * dashboard instead of being amber in one place and red in the other.
 */
const toneClasses: Record<string, string> = {
  success: "border-emerald-300 bg-emerald-50",
  warning: "border-amber-300 bg-amber-50",
  danger: "border-red-300 bg-red-50",
  neutral: "border-slate-300 bg-slate-50",
};

export function ReadinessBanner({ readiness }: { readiness: EventReadiness }) {
  return (
    <Card className={toneClasses[readinessTone(readiness.status)]}>
      <p className="font-black">{readinessText(readiness)}</p>
    </Card>
  );
}
