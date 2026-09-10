import { useMemo } from "react";
import { useAuth } from "@/app/authContext";
import { PermissionState } from "@/components/ui/PermissionState";
import { useEvents } from "@/features/events/events.api";
import { useProcurementDataSource } from "./useProcurementDataSource";
import { ProcurementWorkspace } from "./ProcurementWorkspace";

export function ProcurementPage() {
  const { currentOrganization, canReadCost } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const eventsQuery = useEvents(orgId);
  const dataSource = useProcurementDataSource();

  const eventOptions = useMemo(() => {
    return (eventsQuery.data?.rows ?? []).map((e) => ({
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

  if (!canReadCost) {
    return (
      <PermissionState
        title="المشتريات والموردون متاحة للصلاحيات المالية فقط."
        description="دورك الحالي لا يشمل الاطلاع على بيانات المشتريات."
      />
    );
  }

  return (
    <ProcurementWorkspace dataSource={dataSource} events={eventOptions} />
  );
}
