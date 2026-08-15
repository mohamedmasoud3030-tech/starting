import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center sm:px-6 sm:py-16">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl sm:h-14 sm:w-14 sm:text-2xl">
        📋
      </div>
      <h3 className="text-base font-bold text-slate-800 sm:text-lg">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500 sm:text-base">
          {description}
        </p>
      )}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
