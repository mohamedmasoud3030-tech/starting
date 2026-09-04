import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AuthGate } from "@/app/AuthGate";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { SignupPage } from "@/features/auth/SignupPage";
import {
  CalendarPage,
  CatalogPage,
  ConsumablesPage,
  CustomerDetail,
  CustomersPage,
  EventWorkspace,
  EventsPage,
  HomePage,
  IntegrityCenter,
  ManagementDashboard,
  OperationsBoard,
  PackagesPage,
  ProcurementPage,
  QuotePage,
  QuotesPage,
  ReportsPage,
  SearchPage,
  SettingsPage,
  StaffPage,
  StaffProfilePage,
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

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  component: SignupPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPasswordPage,
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

const customerDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/customers/$customerId",
  component: CustomerDetail,
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
  /**
   * `?tab=` lets the command center and the Today dashboard deep-link a
   * specific operational area (e.g. a staff shortage → الفريق). The tab is
   * validated against the canonical tab list in the workspace — an invalid
   * value falls back to the overview, never to a blank pane.
   */
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
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

/** ملف المضيف — the staff profile page (identity, enrollment, finances). */
const staffProfileRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/staff/$staffId",
  component: StaffProfilePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsPage,
});

const calendarRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/calendar",
  component: CalendarPage,
});

const operationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/operations",
  component: OperationsBoard,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/dashboard",
  component: ManagementDashboard,
});

const reportsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/reports",
  component: ReportsPage,
});

const integrityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/integrity",
  component: IntegrityCenter,
});

const searchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/search",
  component: SearchPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  signupRoute,
  forgotPasswordRoute,
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
    customerDetailRoute,
    staffRoute,
    staffProfileRoute,
    settingsRoute,
    calendarRoute,
    operationsRoute,
    dashboardRoute,
    reportsRoute,
    integrityRoute,
    searchRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
