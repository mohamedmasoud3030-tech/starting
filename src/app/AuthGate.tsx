import { Suspense } from "react";
import { Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { useAuth } from "@/app/authContext";
import { AppShell } from "@/components/layout/AppShell";
import { OnboardingPage } from "@/features/auth/OnboardingPage";
import { Spinner } from "@/components/ui/Spinner";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function AuthGate() {
  const { user, memberships, currentOrganization, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (memberships.length === 0) {
    return <OnboardingPage />;
  }

  if (!currentOrganization) {
    return <Navigate to="/login" />;
  }

  return (
    <AppShell>
      {/* Page-level boundary: a crash in one page never takes down the shell
          (sidebar/nav stay usable) and navigating away resets it. */}
      <ErrorBoundary variant="page" resetKey={pathname}>
        <Suspense fallback={<LoadingScreen />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}
