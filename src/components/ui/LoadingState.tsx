import { Spinner } from "./Spinner";
import { cn } from "@/lib/utils";

/**
 * Standard loading state. `full` renders a page-height centered block for
 * top-level screens; the default is a compact inline block for panels and
 * workspace sections.
 */
export function LoadingState({
  label = "جارٍ التحميل…",
  full = false,
  className,
}: {
  label?: string;
  full?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn(
        "flex items-center justify-center gap-3 font-bold text-slate-600",
        full ? "py-24" : "min-h-48",
        className,
      )}
    >
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
