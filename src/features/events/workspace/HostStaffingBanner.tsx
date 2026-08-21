import { staffingCoverageLabel, type StaffingPlan } from "@/lib/staffing";

/** Soft operational guidance: guests → recommended hosts vs assigned. */
export function HostStaffingBanner({ plan }: { plan: StaffingPlan }) {
  if (plan.guestCount == null && plan.assigned == null) return null;
  const warning = plan.coverage === "BELOW";
  const label = staffingCoverageLabel(plan);

  return (
    <div
      className={`rounded-xl border p-4 text-sm leading-6 ${
        warning
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-slate-200 bg-slate-50 text-slate-800"
      }`}
    >
      <p className="font-black">تغطية المضيفين (تقدير تشغيلي)</p>
      <p className="mt-1">
        {plan.guestCount != null ? (
          <>
            عدد الضيوف: <span className="font-bold">{plan.guestCount}</span>
          </>
        ) : (
          <>عدد الضيوف: غير متاح</>
        )}
        {plan.recommended != null && (
          <>
            {" · "}المقترح تقريبًا: <span className="font-bold">{plan.recommended}</span> مضيفين
          </>
        )}
        {plan.assigned != null ? (
          <>
            {" · "}المعيّن حاليًا: <span className="font-bold">{plan.assigned}</span>
          </>
        ) : (
          <>
            {" · "}المعيّن حاليًا: غير متاح
          </>
        )}
      </p>
      {label && <p className="mt-1 font-bold">{label}</p>}
      <p className="mt-1 text-xs text-slate-500">
        تقدير فقط (مضيف لكل ١٥ ضيفًا تقريبًا) — لا يمنع التأكيد ولا يغيّر العرض أو الأجور.
      </p>
    </div>
  );
}
