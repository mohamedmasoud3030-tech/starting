import { useMemo } from "react";
import { useAuth } from "@/app/authContext";
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
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-lg font-bold text-slate-600">
          المشتريات والموردون متاحة للصلاحيات المالية فقط.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          دورك الحالي لا يشمل الاطلاع على بيانات المشتريات.
        </p>
      </div>
    );
  }

  return (
    <ProcurementWorkspace dataSource={dataSource} events={eventOptions} />
  );
}
