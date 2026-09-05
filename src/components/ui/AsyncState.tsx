import type { ReactNode } from "react";
import { LoadingState } from "./LoadingState";
import { ErrorState } from "./ErrorState";

/**
 * Standard loading → error → content gate for data-driven screens.
 *
 * Every top-level page that depends on one primary query should use this so
 * the whole product shares ONE loading skeleton and ONE error+retry surface,
 * instead of each page hand-rolling a centered spinner (or, worse, silently
 * rendering an empty screen when the query failed).
 *
 * - `loading`  → the shared page-height loading state.
 * - `error`    → the shared red error box with a retry action.
 * - otherwise  → `children`.
 *
 * Panels/sections inside a workspace should keep using `<LoadingState>` /
 * `<ErrorState>` directly; this wrapper is for full-page and full-card use.
 */
export function AsyncState({
  loading,
  error,
  onRetry,
  errorTitle,
  errorMessage = "تعذّر تحميل البيانات. تحقق من الاتصال ثم أعد المحاولة.",
  children,
}: {
  loading: boolean;
  error: unknown;
  onRetry?: () => void;
  errorTitle?: string;
  errorMessage?: string;
  children: ReactNode;
}) {
  if (loading) {
    return <LoadingState full />;
  }
  if (error) {
    const message =
      error instanceof Error && error.message
        ? friendlyErrorMessage(error.message, errorMessage)
        : errorMessage;
    return (
      <ErrorState
        title={errorTitle}
        message={message}
        onRetry={onRetry}
        className="my-6"
      />
    );
  }
  return <>{children}</>;
}

/**
 * Never leak a raw Postgres/plpgsql message into the UI. If the error text
 * looks like a database internals string, fall back to the friendly default.
 */
function friendlyErrorMessage(message: string, fallback: string): string {
  const looksInternal =
    /plpgsql|pg_|\bSQL\b|syntax error|relation .* does not exist|duplicate key|JWT|permission denied for|type ".*"/i.test(
      message,
    );
  return looksInternal ? fallback : message;
}
