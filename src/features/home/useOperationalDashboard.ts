import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/app/authContext";
import { COST_READER_ROLES } from "@/lib/domain";
import { supabase } from "@/lib/supabase";
import { listIsTruncated } from "@/lib/listCap";
import { useCatalogItems } from "@/features/catalog/catalog.api";
import { useConsumableStock } from "@/features/consumables/consumables.api";
import { useCustomers } from "@/features/customers/customers.api";
import { useEvents } from "@/features/events/events.api";
import { usePackages } from "@/features/packages/packages.api";
import {
  DEFAULT_TIME_ZONE,
  isSameLocalDay,
} from "@/features/ownerVoice/screenSummary";
import { useAttendanceGaps } from "@/features/staff/staff.api";
import {
  attentionSummaryWhenLoaded,
  buildEventStaffingMap,
  buildOperationalDashboard,
  isNewWorkspace,
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
      (events.data?.rows ?? []).filter(
        (event) =>
          event.status !== "CANCELLED" &&
          isSameLocalDay(event.start_at, now, DEFAULT_TIME_ZONE),
      ),
    [events.data, now],
  );

  // Batched readiness (defect D19): one RPC for all of today's events instead
  // of an N+1 fan-out, so the dashboard stays fast on a site phone.
  const todayIds = useMemo(
    () => todayEvents.map((event) => event.id),
    [todayEvents],
  );
  const readinessQuery = useQuery({
    queryKey: ["event-readiness-batch", orgId, todayIds.join(",")],
    enabled: !!orgId && events.isSuccess && todayIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("event_readiness_batch", {
        p_org_id: orgId!,
        p_event_ids: todayIds,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        event_id: string;
        status: string;
        staff_missing: number;
        equipment_shortage: number;
      }>;
    },
  });

  const readinessSettled =
    events.isSuccess && (todayIds.length === 0 || readinessQuery.isFetched);
  /** Readiness that failed to load is surfaced, never silently treated as ready. */
  const readinessFailed = readinessQuery.isError;

  const readinessByEventId = useMemo(
    () =>
      Object.fromEntries(
        todayEvents.map((event) => {
          const row = (readinessQuery.data ?? []).find(
            (item) => item.event_id === event.id,
          );
          return [
            event.id,
            row
              ? ({
                  status: row.status,
                  staff_missing: row.staff_missing,
                  equipment_shortage: row.equipment_shortage,
                } satisfies OperationalReadiness)
              : null,
          ] as const;
        }),
      ),
    [todayEvents, readinessQuery.data],
  );

  const dashboard = useMemo(
    () =>
      buildOperationalDashboard({
        events: events.data?.rows ?? [],
        readinessByEventId,
        stockLines: stock.data?.lines ?? [],
        now,
      }),
    [events.data, readinessByEventId, stock.data?.lines, now],
  );

  const staffingQuery = useQuery({
    queryKey: ["today-event-staffing", orgId, todayIds.join(",")],
    enabled: !!orgId && events.isSuccess && todayIds.length > 0,
    queryFn: async () => {
      const [assignments, attendance] = await Promise.all([
        supabase
          .from("event_staff_assignments_operational")
          .select("event_id, staff_member_id, status")
          .eq("organization_id", orgId!)
          .in("event_id", todayIds),
        supabase
          .from("staff_attendance_summaries")
          .select("event_id, staff_member_id, check_in, check_out, attendance_status")
          .eq("organization_id", orgId!)
          .in("event_id", todayIds),
      ]);
      if (assignments.error) throw assignments.error;
      if (attendance.error) throw attendance.error;
      return buildEventStaffingMap(assignments.data ?? [], attendance.data ?? []);
    },
  });

  const dashboardLoaded = readinessSettled && stock.isSuccess;
  const gapsLoaded = gaps.isSuccess;
  const attendanceGapCount = settledCount(gapsLoaded, gaps.data?.length);

  const canReadFinance = !!currentRole && COST_READER_ROLES.includes(currentRole);

  // Spoken facts only when the facts exist; null hides the voice button
  // while any source is still loading (see attentionSummaryWhenLoaded).
  const attentionSummary = attentionSummaryWhenLoaded({
    loaded: dashboardLoaded,
    dashboard,
    attendanceGapCount,
    canReadFinance,
  });

  /**
   * True only once the events and customers reads have both settled to empty —
   * the exact "first minutes" state a new office starts in. Gated by settled
   * reads so a still-loading dashboard never flashes onboarding.
   */
  const isNewOrganization = isNewWorkspace({
    eventsLoaded: events.isSuccess,
    eventCount: events.isSuccess ? (events.data?.total ?? 0) : null,
    customersLoaded: customers.isSuccess,
    customerCount: customers.isSuccess
      ? (customers.data?.rows.length ?? 0)
      : null,
  });

  return {
    orgId,
    profile,
    currentOrganization,
    dashboard,
    dashboardLoaded,
    staffingByEventId: staffingQuery.isSuccess ? staffingQuery.data : null,
    readinessByEventId,
    readinessFailed,
    attendanceGaps: gaps.data ?? [],
    attendanceGapCount,
    attentionSummary,
    isNewOrganization,
    /** Any read that failed and would otherwise leave the screen quietly wrong. */
    hasLoadError: events.isError || stock.isError || gaps.isError || readinessFailed,
    /** The events list is capped by PostgREST max_rows; today's events may be hidden. */
    eventsTruncated:
      events.isSuccess &&
      listIsTruncated(events.data?.rows.length ?? 0, events.data?.total),
    metrics: {
      todayEvents: settledCount(dashboardLoaded, dashboard.todayEvents.length),
      ready: settledCount(dashboardLoaded, dashboard.readyCount),
      attention: settledCount(dashboardLoaded, dashboard.eventAttentionCount),
      lowStock: settledCount(dashboardLoaded, dashboard.lowStockCount),
      attendanceGaps: attendanceGapCount,
    },
    shortcuts: {
      catalog: settledCount(catalog.isSuccess, catalog.data?.rows.length),
      packages: settledCount(packages.isSuccess, packages.data?.length),
      customers: settledCount(customers.isSuccess, customers.data?.rows.length),
    },
  };
}
