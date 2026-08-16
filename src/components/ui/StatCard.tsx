import type { LucideIcon } from "lucide-react";
import { Card } from "./Card";

export type StatTone = "brand" | "success" | "warning" | "danger" | "neutral";

const toneClasses: Record<StatTone, string> = {
  brand: "text-brand-700 bg-brand-50",
  success: "text-emerald-700 bg-emerald-50",
  warning: "text-amber-700 bg-amber-50",
  danger: "text-red-700 bg-red-50",
  neutral: "text-slate-700 bg-slate-100",
};

/**
 * A headline operational number.
 *
 * `value` accepts `null` to mean "not established yet" and renders "—".
 * Passing a real 0 renders 0. This distinction is deliberate: a dash says
 * "we do not know yet", a zero asserts a fact, and the two must never be
 * confused on an operations dashboard.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: number | string | null;
  icon?: LucideIcon;
  tone?: StatTone;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-500 sm:text-base">{label}</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{value ?? "—"}</p>
        </div>
        {Icon && (
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${toneClasses[tone]}`}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </Card>
  );
}
