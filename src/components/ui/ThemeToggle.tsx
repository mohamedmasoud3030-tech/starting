import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Round theme switch that shows the mode you switch TO (mirrors its action). */
export function ThemeToggle({
  className,
  ariaLabel,
}: {
  className?: string;
  /** Extra context for screen readers (e.g. "على هذه الشاشة"). */
  ariaLabel?: string;
}) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={
        ariaLabel
          ? `تفعيل ${isDark ? "الوضع النهاري" : "الوضع الليلي"} ${ariaLabel}`
          : `تفعيل ${isDark ? "الوضع النهاري" : "الوضع الليلي"}`
      }
      title={isDark ? "الوضع النهاري" : "الوضع الليلي"}
      className={cn(
        "flex h-10 w-10 flex-none items-center justify-center rounded-xl border transition-colors",
        "border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-brand-700",
        "dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-brand-300",
        className,
      )}
    >
      {isDark ? (
        <Sun className="h-5 w-5" aria-hidden="true" />
      ) : (
        <Moon className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  );
}
