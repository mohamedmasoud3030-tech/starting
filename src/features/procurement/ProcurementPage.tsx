import { useMemo } from "react";
import { useAuth } from "@/app/AuthContext";
import { useEvents } from "@/features/events/events.api";
import { createSupabaseProcurementDataSource } from "./supabaseDataSource";
import { ProcurementWorkspace } from "./ProcurementWorkspace";

export function ProcurementPage() {
  const { currentOrganization, currentRole } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const eventsQuery = useEvents(orgId);

  const dataSource = useMemo(() => {
    if (!orgId) return null;
    return createSupabaseProcurementDataSource(orgId, currentRole);
  }, [orgId, currentRole]);

  const eventOptions = useMemo(() => {
    return (eventsQuery.data ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      eventNumber: e.event_number,
    }));
  }, [eventsQuery.data]);

  if (!orgId || !dataSource) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-lg font-bold text-slate-600">
          اختر منظمة لعرض المشتريات والموردين.
        </p>
      </div>
    );
  }

  return (
    <ProcurementWorkspace dataSource={dataSource} events={eventOptions} />
  );
}
