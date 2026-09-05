import { cn } from "@/lib/utils";

/**
 * Shared segmented (radio-style) filter control used by the dashboards and
 * reports for time-range selection. Renders an accessible `role="group"` of
 * `aria-pressed` buttons with the active segment visually emphasized.
 *
 * RTL-safe: options render in document order (Arabic labels), and the control
 * wraps on narrow viewports.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1",
        className,
      )}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "min-h-11 rounded-lg px-4 text-sm font-bold transition-colors",
              active
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:bg-white hover:text-slate-900",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
