import { AlertTriangle } from "lucide-react";

/**
 * Explicit warning shown when a list page could only load part of the
 * organization's rows (PostgREST `max_rows` cap). The message must be honest:
 * a partial list is never presented as the whole truth.
 */
export function TruncationNotice({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-800 sm:text-base"
    >
      <AlertTriangle className="mt-1 h-5 w-5 flex-none" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
