import {
  Navigate,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/app/AuthContext";
import { LoginPage } from "@/features/auth/LoginPage";
import { HomePage } from "@/features/home/HomePage";
import { CatalogPage } from "@/features/catalog/CatalogPage";
import { PackagesPage } from "@/features/packages/PackagesPage";
import { CustomersPage } from "@/features/customers/CustomersPage";
import { EventsPage } from "@/features/events/EventsPage";
import { EventWorkspace } from "@/features/events/EventWorkspace";
import { QuotesPage } from "@/features/quotes/QuotesPage";
import { QuotePage } from "@/features/quotes/QuotePage";
import { ConsumablesPage } from "@/features/consumables/ConsumablesPage";
import { ProcurementPage } from "@/features/procurement/ProcurementPage";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/home" });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

function AuthGate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AuthGate,
});

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/home",
  component: HomePage,
});

const catalogRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/catalog",
  component: CatalogPage,
});

const packagesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/packages",
  component: PackagesPage,
});

const customersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/customers",
  component: CustomersPage,
});

const eventsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/events",
  component: EventsPage,
});

const eventWorkspaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/events/$eventId",
  component: EventWorkspace,
});

const quotesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/quotes",
  component: QuotesPage,
});

const quoteNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/quotes/new",
  component: QuotePage,
});

const quoteDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/quotes/$quoteId",
  component: QuotePage,
});

const consumablesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/consumables",
  component: ConsumablesPage,
});

const procurementRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/procurement",
  component: ProcurementPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  appRoute.addChildren([
    homeRoute,
    eventsRoute,
    eventWorkspaceRoute,
    quotesRoute,
    quoteNewRoute,
    quoteDetailRoute,
    procurementRoute,
    consumablesRoute,
    catalogRoute,
    packagesRoute,
    customersRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
