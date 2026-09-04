import { lazy } from "react";

export const HomePage = lazy(async () => ({
  default: (await import("@/features/home/HomePage")).HomePage,
}));

export const CatalogPage = lazy(async () => ({
  default: (await import("@/features/catalog/CatalogPage")).CatalogPage,
}));

export const PackagesPage = lazy(async () => ({
  default: (await import("@/features/packages/PackagesPage")).PackagesPage,
}));

export const CustomersPage = lazy(async () => ({
  default: (await import("@/features/customers/CustomersPage")).CustomersPage,
}));

export const EventsPage = lazy(async () => ({
  default: (await import("@/features/events/EventsPage")).EventsPage,
}));

export const EventWorkspace = lazy(async () => ({
  default: (await import("@/features/events/EventWorkspace")).EventWorkspace,
}));

export const QuotesPage = lazy(async () => ({
  default: (await import("@/features/quotes/QuotesPage")).QuotesPage,
}));

export const QuotePage = lazy(async () => ({
  default: (await import("@/features/quotes/QuotePage")).QuotePage,
}));

export const ConsumablesPage = lazy(async () => ({
  default: (await import("@/features/consumables/ConsumablesPage")).ConsumablesPage,
}));

export const ProcurementPage = lazy(async () => ({
  default: (await import("@/features/procurement/ProcurementPage")).ProcurementPage,
}));

export const StaffPage = lazy(async () => ({
  default: (await import("@/features/staff/StaffPage")).StaffPage,
}));

export const StaffProfilePage = lazy(async () => ({
  default: (await import("@/features/staff/StaffProfilePage")).StaffProfilePage,
}));

export const SettingsPage = lazy(async () => ({
  default: (await import("@/features/settings/SettingsPage")).SettingsPage,
}));

export const CalendarPage = lazy(async () => ({
  default: (await import("@/features/calendar/CalendarPage")).CalendarPage,
}));

export const OperationsBoard = lazy(async () => ({
  default: (await import("@/features/operations/OperationsBoard")).OperationsBoard,
}));

export const ManagementDashboard = lazy(async () => ({
  default: (await import("@/features/intelligence/ManagementDashboard")).ManagementDashboard,
}));

export const ReportsPage = lazy(async () => ({
  default: (await import("@/features/intelligence/ReportsPage")).ReportsPage,
}));

export const IntegrityCenter = lazy(async () => ({
  default: (await import("@/features/intelligence/IntegrityCenter")).IntegrityCenter,
}));

export const SearchPage = lazy(async () => ({
  default: (await import("@/features/intelligence/SearchPage")).SearchPage,
}));

export const CustomerDetail = lazy(async () => ({
  default: (await import("@/features/customers/CustomerDetail")).CustomerDetail,
}));
