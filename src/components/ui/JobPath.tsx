import { cn } from "@/lib/utils";

const JOB_PATH_STEPS = [
  { id: "quote", label: "عرض السعر" },
  { id: "accept", label: "الاعتماد" },
  { id: "event", label: "المناسبة" },
  { id: "run", label: "التنفيذ" },
  { id: "money", label: "التحصيل" },
  { id: "done", label: "الربح" },
] as const;

export type JobPathStep = (typeof JOB_PATH_STEPS)[number]["id"];

/**
 * One visible job path from the first quote to closed profit.
 * Presentation only — it never invents status or money.
 */
export function JobPath({ current }: { current: JobPathStep }) {
  const currentIndex = JOB_PATH_STEPS.findIndex((step) => step.id === current);

  return (
    <ol
      aria-label="مسار العمل من عرض السعر حتى الربح"
      className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2"
    >
      {JOB_PATH_STEPS.map((step, index) => {
        const state =
          index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
        return (
          <li
            key={step.id}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex min-h-11 min-w-24 flex-1 items-center justify-center rounded-xl px-2 text-center text-sm font-bold",
              state === "current" && "bg-brand-700 text-white",
              state === "done" && "bg-brand-50 text-brand-800",
              state === "todo" && "text-slate-400",
            )}
          >
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
