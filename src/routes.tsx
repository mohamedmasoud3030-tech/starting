import {
  Navigate,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AuthGate } from "@/app/AuthGate";
import { LoginPage } from "@/features/auth/LoginPage";
import {
  CatalogPage,
  ConsumablesPage,
  CustomersPage,
  EventWorkspace,
  EventsPage,
  HomePage,
  PackagesPage,
  ProcurementPage,
  QuotePage,
  QuotesPage,
  StaffPage,
} from "@/routes.lazy";

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

const staffRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/staff",
  component: StaffPage,
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
    staffRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
