import { Suspense } from "react";
import { Navigate, Outlet } from "@tanstack/react-router";
import { useAuth } from "@/app/authContext";
import { AppShell } from "@/components/layout/AppShell";
import { Spinner } from "@/components/ui/Spinner";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function AuthGate() {
  const { currentOrganization, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!currentOrganization) {
    return <Navigate to="/login" />;
  }

  return (
    <AppShell>
      <Suspense fallback={<LoadingScreen />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}
