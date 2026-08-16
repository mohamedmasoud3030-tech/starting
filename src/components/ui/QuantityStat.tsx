import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "./Badge";

type Tone = "neutral" | "success" | "warning" | "danger" | "brand";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-slate-50 text-slate-800",
  success: "bg-emerald-50 text-emerald-800",
  warning: "bg-amber-50 text-amber-800",
  danger: "bg-red-50 text-red-700",
  brand: "bg-brand-50 text-brand-800",
};

/**
 * Standard compact quantity/stat chip used on operational screens
 * (warehouse, consumables, procurement): a small labelled box with a
 * prominent value. Pass an already-formatted string or a raw number as
 * `value`; exact quantity/OMR formatting stays with the caller so every
 * screen keeps its own precision rules.
 */
export function QuantityStat({
  label,
  value,
  tone = "neutral",
  className,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-20 flex-col items-center rounded-xl px-3 py-2",
        toneClasses[tone],
        className,
      )}
    >
      <span className="text-xs font-semibold opacity-75">{label}</span>
      <Badge tone={tone} className="mt-1 text-base font-black">
        {value}
      </Badge>
    </div>
  );
}
