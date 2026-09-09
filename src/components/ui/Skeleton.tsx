import { cn } from "@/lib/utils";

/**
 * Loading placeholder bar. Compose several to mirror the final layout's
 * geometry so panels don't shift when real content arrives (replaces plain
 * "جارٍ التحميل…" text cards that collapse into full layouts). Purely
 * decorative — the container must carry role="status" and an sr-only label
 * so screen readers still announce loading.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-lg bg-slate-200", className)}
    />
  );
}
