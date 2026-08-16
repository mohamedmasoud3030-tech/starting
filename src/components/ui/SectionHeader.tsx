import type { ReactNode } from "react";

/**
 * Standard section header inside a page or workspace: title, optional
 * description, optional action cluster. Mirrors PageHeader but renders an
 * h2 for sections nested under a page title.
 */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-end justify-between gap-3 ${className ?? ""}`}
    >
      <div className="min-w-0">
        <h2 className="text-2xl font-black text-slate-900">{title}</h2>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
