import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Kept for call-site compatibility; the org name already lives in the app bar. */
  showCompanyBranding?: boolean;
};

/**
 * Page title + one-line description + primary actions.
 *
 * Deliberately minimal: the organisation name is already in the sticky app
 * bar, so no per-page branding chip is repeated here (it read as a broken
 * "…WDAH ALANTALAQ" pill on phones).
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:mb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-lg font-black leading-tight text-slate-900 sm:text-xl">
          {title}
        </h1>
        {description && (
          <p className="mt-0.5 max-w-2xl text-sm leading-6 text-slate-500">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-none">
          {actions}
        </div>
      )}
    </div>
  );
}
