import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="جارٍ التحميل"
      className={cn(
        "inline-block h-6 w-6 animate-spin rounded-full border-[3px] border-slate-200 border-t-brand-600",
        className,
      )}
    />
  );
}
