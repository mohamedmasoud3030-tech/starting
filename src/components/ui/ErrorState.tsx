import { Button } from "./Button";

/**
 * Standard error state: the Arabic red alert box used across every
 * operational screen. Optionally offers a retry action.
 */
export function ErrorState({
  message,
  title,
  onRetry,
  retryLabel = "إعادة المحاولة",
  className,
}: {
  message: string;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 ${className ?? ""}`}
    >
      {title && <p className="font-black">{title}</p>}
      <p className={title ? "mt-1 font-semibold" : "font-bold"}>{message}</p>
      {onRetry && (
        <Button variant="outline" className="mt-3" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

/** Inline (non-bordered, compact) error notice for inside cards/forms. */
export function InlineError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">
      {message}
    </p>
  );
}
