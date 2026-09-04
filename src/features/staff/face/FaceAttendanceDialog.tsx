import { useRef } from "react";
import { Camera } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineError } from "@/components/ui/ErrorState";
import { useEventAttendanceCandidates, useFaceAttendanceFlow, type FaceAction } from "./face.api";
import { useEventAttendanceStatus } from "../staff.api";

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ar-OM", {
    timeZone: "Asia/Muscat",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Assisted face-matching attendance dialog (one entry point for check-in and
 * check-out).
 *
 * The flow is deliberately identical for both actions and for the failure
 * paths: camera frame → potential match → MANAGER CONFIRMATION → attendance.
 * A match never writes anything; the assigned roster below the camera control
 * is a first-class manual path at all times, not an error corner. Everything
 * shown here is re-authorized server-side at confirmation time.
 */
export function FaceAttendanceDialog({
  orgId,
  eventId,
  action,
  open,
  onOpenChange,
}: {
  orgId: string | null;
  eventId: string;
  action: FaceAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const candidates = useEventAttendanceCandidates(orgId, eventId);
  const attendance = useEventAttendanceStatus(orgId, eventId);
  const flow = useFaceAttendanceFlow({
    orgId,
    eventId,
    action,
    candidates: candidates.data ?? [],
    rosterRows: attendance.data ?? [],
  });
  const cameraInput = useRef<HTMLInputElement>(null);

  function close(next: boolean) {
    // Closing always drops the transient match context (§60).
    flow.reset();
    onOpenChange(next);
  }

  async function onFile(file: File | null) {
    if (cameraInput.current) cameraInput.current.value = "";
    if (!file) return;
    // While a manual row is selected the next frame is EVIDENCE for that
    // selection; otherwise the frame goes through the provider (assist only).
    if (flow.manualStaffId && flow.phase !== "candidate") {
      await flow.attachManualEvidence(file);
      return;
    }
    await flow.capture(file);
  }

  const actionLabel = action === "CHECK_IN" ? "تأكيد الدخول" : "تأكيد الخروج";

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={action === "CHECK_IN" ? "بصمة الدخول — تطابق بمساعدة المدير" : "بصمة الخروج — تطابق بمساعدة المدير"}
      description="النظام يقترح هوية محتملة فقط؛ لا يُكتب أي سجل إلا بعد تأكيد المدير صراحةً."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-500">
            {flow.providerState.status === "available"
              ? "محرك التعرف على الوجه مُفعّل على هذا الجهاز."
              : flow.providerState.status === "loading"
                ? "جارٍ التحقق من محرك التعرف…"
                : "خدمة التعرف على الوجه غير مُفعّلة في هذا النشر — الاختيار اليدوي من الفريق المسند يعمل بكامله."}
          </p>
          <Badge tone={flow.providerState.status === "available" ? "success" : "neutral"}>
            {flow.providerState.status === "available" ? "تعرّف متاح" : "تعرّف غير متاح"}
          </Badge>
        </div>

        {flow.error && <InlineError message={flow.error} />}

        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />

        {(candidates.data ?? []).length === 0 && !candidates.isLoading ? (
          <EmptyState
            title="لا يوجد فريق مسند"
            description="أسند المضيفين من تبويب الفريق أولاً — ثم تعود هذه الشاشة تعمل."
          />
        ) : (
          <>
            {flow.phase === "candidate" && flow.candidate ? (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
                <p className="text-sm font-bold text-emerald-800">تطابق محتمل</p>
                <p className="mt-1 text-lg font-black">{flow.candidate.staffName}</p>
                {flow.candidate.confidenceLabel && (
                  <p className="text-sm text-emerald-800">{flow.candidate.confidenceLabel}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={() => void flow.confirm()} disabled={flow.busy}>
                    {flow.busy ? "جارٍ التسجيل…" : actionLabel}
                  </Button>
                  <Button variant="outline" onClick={flow.rejectCandidate} disabled={flow.busy}>
                    ليس هو — اختر يدوياً
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="lg"
                  onClick={() => cameraInput.current?.click()}
                  disabled={flow.busy || flow.providerState.status === "loading"}
                >
                  <Camera className="h-5 w-5" />
                  {flow.manualStaffId
                    ? "التقاط صورة الإثبات للمضيف المختار"
                    : "فتح الكاميرا والتقاط إطار"}
                </Button>
                {flow.phase === "unrecognized" && (
                  <p className="font-bold text-amber-800" role="status">
                    لم يتم التعرف بثقة كافية — اختر من القائمة أدناه
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2" aria-label="الفريق المسند">
              <p className="text-sm font-black text-slate-700">
                {action === "CHECK_IN" ? "الفريق المسند — تسجيل دخول" : "بالداخل الآن — تسجيل خروج"}
              </p>
              <ul className="space-y-1">
                {flow.actionable.map((row) => (
                  <li key={row.staff_member_id}>
                    <button
                      type="button"
                      onClick={() => flow.selectManual(row.staff_member_id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl border p-3 text-right hover:bg-slate-50 ${
                        flow.manualStaffId === row.staff_member_id
                          ? "border-brand-500 bg-brand-50"
                          : "border-slate-200"
                      }`}
                      aria-pressed={flow.manualStaffId === row.staff_member_id}
                    >
                      <span className="font-bold">{row.staff_name}</span>
                      <span className="text-sm text-slate-500">
                        {action === "CHECK_OUT" && row.open_check_in
                          ? `دخول ${fmtTime(row.open_check_in)}`
                          : row.enrollment_active
                            ? "مسجّل الوجه"
                            : "بدون تسجيل وجه"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {flow.actionable.length === 0 && (
                <p className="text-sm text-slate-500">
                  {action === "CHECK_OUT"
                    ? "لا يوجد أحد بالداخل الآن لتسجيل خروجه."
                    : "كل المسندين سجّلوا دخولهم بالفعل."}
                </p>
              )}
              {flow.manualStaffId && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Badge tone={flow.manualEvidenceReady ? "success" : "warning"}>
                    {flow.manualEvidenceReady ? "صورة الإثبات جاهزة" : "يلتقط إطار الإثبات أولاً"}
                  </Badge>
                  <Button
                    onClick={() => void flow.confirm()}
                    disabled={flow.busy || !flow.manualEvidenceReady}
                  >
                    {flow.busy ? "جارٍ التسجيل…" : actionLabel}
                  </Button>
                  <Button variant="outline" onClick={flow.reset} disabled={flow.busy}>
                    إلغاء
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        <p className="text-xs leading-5 text-slate-400">
          صورة الإثبات تُرفع إلى التخزين الخاص وتُربط بالسجل داخل نفس الأمر عند التأكيد؛
          لا يُحفظ أي إطار تدريب مؤقت هنا، ولا يُنشأ أي سجل دون ضغط زر التأكيد.
        </p>
      </div>
    </Dialog>
  );
}
