import { useRef, useState } from "react";
import { Camera, ShieldCheck, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/app/authContext";
import { attendanceError } from "@/features/staff/staff.api";
import {
  useFaceEnrollmentFlow,
  useFaceProvider,
  useRevokeStaffFace,
  useStaffFaceEnrollment,
} from "./face.api";

/**
 * Face enrollment surface on the staff profile (تسجيل الوجه).
 *
 * Authorization: enrollment is STAFF PROFILE administration, gated by
 * `staff.manage` both here and in the `enroll_staff_face`/`revoke_staff_face`
 * commands (no new capability — see §“Capability Reuse”). Being able to view an
 * event or even record attendance never grants administration over faces.
 *
 * Provider state: enrollment needs the recognition engine; when no provider
 * is deployed, the panel says so honestly and offers NO fake flow — there is
 * no "capture anyway" path that would persist a meaningless template.
 */
export function FaceEnrollmentPanel({
  orgId,
  staffMemberId,
  staffName,
}: {
  orgId: string | null;
  staffMemberId: string;
  staffName: string;
}) {
  const { currentRole, capabilities } = useAuth();
  const canManageStaff =
    capabilities !== null ? capabilities.has("staff.manage") : currentRole === "OWNER" || currentRole === "MANAGER";
  const enrollment = useStaffFaceEnrollment(orgId, staffMemberId);
  const providerState = useFaceProvider();
  const flow = useFaceEnrollmentFlow(orgId, staffMemberId);
  const revoke = useRevokeStaffFace(orgId);
  const frameInput = useRef<HTMLInputElement>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeError, setRevokeError] = useState("");

  const status = enrollment.data?.status ?? "NONE";
  const engineReady = providerState.status === "available";

  async function onFrame(file: File | null) {
    if (frameInput.current) frameInput.current.value = "";
    if (!file) return;
    const result = await flow.submitFrame(file);
    if (result === "more" || result === "retry") {
      // queue the next capture without an extra click on each frame
      window.setTimeout(() => frameInput.current?.click(), 50);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-black">
            {status === "ACTIVE" ? (
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
            ) : (
              <ShieldOff className="h-5 w-5 text-slate-400" />
            )}
            تسجيل الوجه
          </h2>
          <Badge tone={status === "ACTIVE" ? "success" : "neutral"}>
            {status === "ACTIVE" ? "مُسجَّل على أجهزة الفريق" : "غير مسجَّل"}
          </Badge>
        </div>

        <p className="text-sm leading-6 text-slate-600">
          التسجيل يولّد قوالب تعريف محلية على الجهاز — لا تُرفع الصور الخام إلى الخادم.
          القوالب تبقى على الجهاز الذي أجّر التسجيل؛ أي جهاز آخر يظهر لديه
          «يحتاج إعادة تسجيل» ويرجع المسار تلقائياً إلى الاختيار اليدوي.
        </p>

        {enrollment.data?.status === "ACTIVE" && (
          <p className="text-sm text-slate-500">
            المحرك: <b>{enrollment.data.provider_code}</b> · إصدار النموذج{" "}
            <b dir="ltr">{enrollment.data.model_version}</b> · صور التسجيل{" "}
            <b>{enrollment.data.capture_count}</b> · آخر تحديث{" "}
            <b>{enrollment.data.updated_at?.slice(0, 10) ?? "—"}</b>
          </p>
        )}

        {!engineReady && (
          <p role="status" className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">
            {providerState.status === "loading"
              ? "جارٍ التحقق من محرك التعرف…"
              : "محرك التعرف على الوجه غير مُنشر في هذا النظام بعد؛ التسجيل غير متاح ولا يُفعَّل الوهم مكانه. الحضور اليدوي يعمل بالكامل."}
          </p>
        )}

        {canManageStaff && engineReady && flow.phase !== "capturing" && (
          <div className="flex flex-wrap gap-2">
            {status !== "ACTIVE" && (
              <Button onClick={flow.begin}>بدء تسجيل الوجه ({flow.total} صور)</Button>
            )}
            {status === "ACTIVE" && !revoking && (
              <Button variant="outline" onClick={() => setRevoking(true)}>
                إلغاء تسجيل الوجه
              </Button>
            )}
          </div>
        )}

        {flow.phase === "capturing" && (
          <div className="rounded-xl border border-brand-200 bg-brand-50 p-3">
            <p className="font-bold">
              التقاط {flow.captured + 1} من {flow.total} — وجهاً واضحاً بإضاءة جيدة
            </p>
            <input
              ref={frameInput}
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={(e) => void onFrame(e.target.files?.[0] ?? null)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => frameInput.current?.click()} disabled={flow.busy}>
                <Camera className="h-4 w-4" />
                {flow.captured === 0 ? "التقاط الصورة الأولى" : "الالتقاط التالي"}
              </Button>
              <Button variant="outline" onClick={flow.cancel} disabled={flow.busy}>
                إلغاء
              </Button>
            </div>
          </div>
        )}

        {flow.phase === "no-face" && (
          <p className="text-sm font-semibold text-amber-800">
            لم يُعثر على وجه واضح في آخر إطار.{" "}
            <button type="button" className="underline" onClick={flow.begin}>
              أعد المحاولة
            </button>
          </p>
        )}

        {flow.phase === "done" && (
          <p className="text-sm font-bold text-emerald-800">اكتمل التسجيل — ظهرت الحالة أعلاه كمسجَّلة.</p>
        )}

        {flow.error && <p role="alert" className="text-sm font-bold text-red-700">{flow.error}</p>}

        {revoking && (
          <div className="space-y-2 rounded-xl border p-3">
            <Field label="سبب الإلغاء" htmlFor="face-revoke-reason" required>
              <Input
                id="face-revoke-reason"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="مثال: ترك المضيف العمل"
              />
            </Field>
            {revokeError && <p role="alert" className="text-sm font-bold text-red-700">{revokeError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRevoking(false); setRevokeError(""); }}>
                تراجع
              </Button>
              <Button
                variant="danger"
                disabled={revoke.isPending}
                onClick={async () => {
                  setRevokeError("");
                  try {
                    await revoke.mutateAsync({ staffMemberId, reason: revokeReason.trim() });
                    setRevoking(false);
                    setRevokeReason("");
                  } catch (cause) {
                    setRevokeError(attendanceError(cause) || String(cause));
                  }
                }}
              >
                تأكيد الإلغاء — {staffName}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
