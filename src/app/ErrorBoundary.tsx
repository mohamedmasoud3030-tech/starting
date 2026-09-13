import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError, reloadForFreshBuild } from "./chunkRecovery";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * When provided, the boundary resets itself whenever this value changes
   * (e.g. the current pathname) so navigating to another page recovers from a
   * page-level error without a full reload.
   */
  resetKey?: string;
  /** Compact variant for page-level boundaries inside the app shell. */
  variant?: "full" | "page";
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Render-error boundary.
 *
 * Any uncaught render error in the tree below must never leave the owner
 * staring at a blank white screen: the boundary shows a clear Arabic recovery
 * state with a reload action. Business errors inside screens (query/mutation
 * failures) are still handled by the screens themselves; this is strictly the
 * last line of defense.
 *
 * Stale-chunk errors (a page's JS file no longer exists after a new deploy)
 * are recovered automatically with a single page reload.
 *
 * The original error is logged for diagnostics — the Arabic message shown to
 * the user deliberately contains no technical detail.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled render error", error, info.componentStack);
    if (isChunkLoadError(error)) {
      reloadForFreshBuild();
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const page = this.props.variant === "page";

    return (
      <div
        className={
          page
            ? "flex items-center justify-center px-4 py-10"
            : "flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10"
        }
      >
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-black text-slate-900">
            حدث خطأ غير متوقع في الشاشة
          </h1>
          <p className="mt-2 text-base leading-7 text-slate-500">
            لم تُفقد بياناتك المحفوظة. أعد تحميل الصفحة للمتابعة، وإذا تكرر الخطأ
            فأعد المحاولة لاحقاً.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {page ? (
              <button
                type="button"
                onClick={() => this.setState({ hasError: false })}
                className="inline-flex h-14 items-center justify-center rounded-xl border border-slate-300 bg-white px-7 text-lg font-bold text-slate-800 hover:bg-slate-50"
              >
                إعادة المحاولة
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-14 items-center justify-center rounded-xl bg-brand-700 px-7 text-lg font-bold text-white hover:bg-brand-800 focus-visible:outline-brand-700"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      </div>
    );
  }
}
