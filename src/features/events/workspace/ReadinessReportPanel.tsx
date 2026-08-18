import { CheckCircle2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { ReadinessReport } from "../readinessReport";

const toneClasses: Record<string, string> = {
  READY: "border-emerald-300 bg-emerald-50",
  INCOMPLETE: "border-amber-300 bg-amber-50",
  EMPTY: "border-slate-300 bg-slate-50",
};

const toneText: Record<string, string> = {
  READY: "text-emerald-800",
  INCOMPLETE: "text-amber-800",
  EMPTY: "text-slate-600",
};

/**
 * Explainable readiness panel. Shows the derived readiness percentage and a
 * rule-based checklist (required vs assigned per resource) — never a fabricated
 * single number. Items that do not apply to the event are omitted entirely.
 */
export function ReadinessReportPanel({ report }: { report: ReadinessReport }) {
  const heading =
    report.overall === "READY"
      ? "المناسبة جاهزة"
      : report.overall === "EMPTY"
        ? "لا توجد متطلبات موارد مسجلة بعد"
        : "المناسبة غير مكتملة التجهيز";

  return (
    <Card className={toneClasses[report.overall]}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={`text-lg font-black ${toneText[report.overall]}`}>{heading}</h2>
        {report.percent !== null && (
          <span className={`text-2xl font-black ${toneText[report.overall]}`}>
            {report.percent}%
          </span>
        )}
      </div>

      {report.items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {report.items.map((item) => (
            <li key={item.key} className="flex items-start gap-2">
              {item.status === "ok" ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              )}
              <span className="text-sm leading-6 text-slate-700">
                <span className="font-bold">{item.label}</span>
                {" — "}
                {item.status === "ok" ? "مكتمل" : "غير مكتمل"}
                {" (مطلوب "}
                <span className="font-bold">{item.required}</span>
                {" / مخصص "}
                <span className="font-bold">{item.assigned}</span>
                {")"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
