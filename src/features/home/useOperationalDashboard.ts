import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useAuth } from "@/app/authContext";
import { COST_READER_ROLES } from "@/lib/domain";
import { useCatalogItems } from "@/features/catalog/catalog.api";
import { useConsumableStock } from "@/features/consumables/consumables.api";
import { useCustomers } from "@/features/customers/customers.api";
import { eventReadinessQuery, useEvents } from "@/features/events/events.api";
import { usePackages } from "@/features/packages/packages.api";
import {
  buildAttentionVoiceSummary,
  DEFAULT_TIME_ZONE,
  isSameLocalDay,
} from "@/features/ownerVoice/screenSummary";
import { useAttendanceGaps } from "@/features/staff/staff.api";
import {
  buildOperationalDashboard,
  settledCount,
  type OperationalReadiness,
} from "./operationalDashboard.model";

/**
 * Controller for the operational dashboard.
 *
 * Owns data loading, readiness fan-out and the loaded/error bookkeeping so the
 * page component only composes layout. Every count it exposes is a
 * `PendingCount`: `null` until its source query has actually settled, so the
 * screen can render "—" instead of inventing a zero.
 */
export function useOperationalDashboard() {
  const { profile, currentOrganization, currentRole } = useAuth();
  const orgId = currentOrganization?.id ?? null;

  const catalog = useCatalogItems(orgId);
  const packages = usePackages(orgId);
  const customers = useCustomers(orgId);
  const events = useEvents(orgId);
  const stock = useConsumableStock(orgId);
  const gaps = useAttendanceGaps(orgId);

  /**
   * "Today" is evaluated ONCE per render pass and shared by the readiness
   * fan-out and the dashboard build. Previously each computed its own
   * `new Date()`, so the two could disagree across a midnight boundary.
   */
  const now = useMemo(() => new Date(), []);

  const todayEvents = useMemo(
    () =>
      (events.data ?? []).filter(
        (event) =>
          event.status !== "CANCELLED" &&
          isSameLocalDay(event.start_at, now, DEFAULT_TIME_ZONE),
      ),
    [events.data, now],
  );

  const readinessQueries = useQueries({
    queries: todayEvents.map((event) => eventReadinessQuery(orgId, event.id)),
  });

  const readinessSettled =
    events.isSuccess && readinessQueries.every((query) => query.isFetched);
  /** Readiness that failed to load is surfaced, never silently treated as ready. */
  const readinessFailed = readinessQueries.some((query) => query.isError);

  const readinessByEventId = useMemo(
    () =>
      Object.fromEntries(
        todayEvents.map((event, index) => [
          event.id,
          (readinessQueries[index]?.data as OperationalReadiness | undefined) ?? null,
        ]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readinessQueries is a new array each render; its data is captured via the map below.
    [todayEvents, readinessQueries.map((q) => q.dataUpdatedAt).join(",")],
  );

  const dashboard = useMemo(
    () =>
      buildOperationalDashboard({
        events: events.data ?? [],
        readinessByEventId,
        stockLines: stock.data?.lines ?? [],
        now,
      }),
    [events.data, readinessByEventId, stock.data?.lines, now],
  );

  const dashboardLoaded = readinessSettled && stock.isSuccess;
  const gapsLoaded = gaps.isSuccess;
  const attendanceGapCount = settledCount(gapsLoaded, gaps.data?.length);

  const canReadFinance = !!currentRole && COST_READER_ROLES.includes(currentRole);

  const attentionSummary = buildAttentionVoiceSummary({
    todayEventCount: dashboardLoaded ? dashboard.todayEvents.length : 0,
    readyCount: dashboardLoaded ? dashboard.readyCount : 0,
    attentionCount: dashboardLoaded ? dashboard.eventAttentionCount : 0,
    lowStockCount: dashboardLoaded ? dashboard.lowStockCount : 0,
    attendanceGapCount: attendanceGapCount ?? 0,
    canReadFinance,
  });

  return {
    orgId,
    profile,
    currentOrganization,
    dashboard,
    dashboardLoaded,
    readinessByEventId,
    readinessFailed,
    attendanceGaps: gaps.data ?? [],
    attendanceGapCount,
    attentionSummary,
    /** Any read that failed and would otherwise leave the screen quietly wrong. */
    hasLoadError: events.isError || stock.isError || gaps.isError || readinessFailed,
    metrics: {
      todayEvents: settledCount(dashboardLoaded, dashboard.todayEvents.length),
      ready: settledCount(dashboardLoaded, dashboard.readyCount),
      attention: settledCount(dashboardLoaded, dashboard.eventAttentionCount),
      lowStock: settledCount(dashboardLoaded, dashboard.lowStockCount),
      attendanceGaps: attendanceGapCount,
    },
    shortcuts: {
      catalog: settledCount(catalog.isSuccess, catalog.data?.length),
      packages: settledCount(packages.isSuccess, packages.data?.length),
      customers: settledCount(customers.isSuccess, customers.data?.length),
    },
  };
}
