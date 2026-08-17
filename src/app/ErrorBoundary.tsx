import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Root render-error boundary.
 *
 * Any uncaught render error in the tree below must never leave the owner
 * staring at a blank white screen: the boundary shows a clear Arabic recovery
 * state with a reload action. Business errors inside screens (query/mutation
 * failures) are still handled by the screens themselves; this is strictly the
 * last line of defense.
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
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-black text-slate-900">
            حدث خطأ غير متوقع في الشاشة
          </h1>
          <p className="mt-2 text-base leading-7 text-slate-500">
            لم تُفقد بياناتك المحفوظة. أعد تحميل الصفحة للمتابعة، وإذا تكرر الخطأ
            فأعد المحاولة لاحقاً.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex h-14 items-center justify-center rounded-xl bg-brand-700 px-7 text-lg font-bold text-white hover:bg-brand-800 focus-visible:outline-brand-700"
          >
            إعادة تحميل الصفحة
          </button>
        </div>
      </div>
    );
  }
}
