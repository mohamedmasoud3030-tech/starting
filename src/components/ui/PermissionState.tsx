import { ShieldAlert } from "lucide-react";

/**
 * In-page explanation shown when a member opens a surface their role cannot
 * use (e.g. procurement opened by a non-cost role). Centralizes the
 * previously duplicated "permission denied" block so every gated page reads
 * consistently.
 *
 * This is UX only: it never hides or grants access. The database (RLS/RPC)
 * remains the security boundary, and the page must still have already
 * enforced access itself.
 */
export function PermissionState({
  title,
  description,
}: {
  /** The single Arabic sentence stating what is unavailable and why. */
  title: string;
  /** Optional supporting line for the current role. */
  description?: string;
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
        <ShieldAlert className="h-6 w-6" aria-hidden="true" />
      </div>
      <p className="mt-3 text-lg font-bold text-amber-900">{title}</p>
      {description && (
        <p className="mt-2 text-base text-amber-800/90">{description}</p>
      )}
    </div>
  );
}
