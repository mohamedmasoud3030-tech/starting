import { useState } from "react";
import { CheckCircle2, AlertTriangle, Upload, Database, HardDrive } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { ATTACHMENT_BUCKET } from "@/features/attachments/attachments.api";
import {
  HEALTH_PROBE_MIME,
  classifyStorageFailure,
  healthProbePath,
  storageProbeBlob,
} from "./systemHealth";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export function SystemHealthPanel() {
  const { currentOrganization, currentMembership } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadTest, setUploadTest] = useState<"idle" | "ok" | "warn" | "fail">("idle");
  const [uploadMsg, setUploadMsg] = useState("");

  async function runChecks() {
    if (!orgId) return;
    setLoading(true);
    const results: CheckResult[] = [];

    // 1. Supabase configured
    if (!isSupabaseConfigured) {
      results.push({ name: "إعدادات الاتصال", status: "error", message: "النظام غير مهيأ - .env مفقود" });
    } else {
      results.push({ name: "إعدادات الاتصال", status: "ok", message: "تم تكوين Supabase بنجاح" });
    }

    // 2. Organization + membership are actually usable (an INACTIVE organization
    //    or a non-ACTIVE membership blocks every protected read/write at the
    //    database boundary, so this is a real precondition — not a formality).
    if (!currentOrganization?.is_active) {
      results.push({
        name: "المنشأة",
        status: "error",
        message: "المنشأة غير نشطة (is_active = false) — كل القراءات والكتابات المحمية ستكون مرفوضة.",
      });
    } else if (currentMembership && currentMembership.status !== "ACTIVE") {
      results.push({
        name: "المنشأة",
        status: "warn",
        message: `عضويتك في المنشأة بحالة ${currentMembership.status} وليست ACTIVE — قد تُرفض بعض العمليات.`,
      });
    } else {
      results.push({
        name: "المنشأة",
        status: "ok",
        message: `منشأة نشطة: ${currentOrganization.name} — عضويتك ACTIVE`,
      });
    }

    // 3. Check attachments bucket existence via list (will fail if bucket missing)
    try {
      const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).list(`${orgId}`, { limit: 1 });
      if (error) {
        if (error.message.includes("Bucket not found") || error.message.includes("not found")) {
          results.push({ name: "تخزين المرفقات", status: "error", message: `Bucket "${ATTACHMENT_BUCKET}" غير موجود - يجب إنشاؤه في Supabase Dashboard → Storage` });
        } else {
          results.push({ name: "تخزين المرفقات", status: "warn", message: `تحذير: ${error.message}` });
        }
      } else {
        results.push({ name: "تخزين المرفقات", status: "ok", message: `Bucket "${ATTACHMENT_BUCKET}" موجود - ${data?.length ?? 0} ملف في مجلد المنشأة` });
      }
    } catch (e) {
      results.push({ name: "تخزين المرفقات", status: "error", message: `فشل فحص التخزين: ${e instanceof Error ? e.message : String(e)}` });
    }

    // 4. Check core tables readable
    try {
      const { error } = await supabase.from("customers").select("id").eq("organization_id", orgId).limit(1);
      if (error) throw error;
      results.push({ name: "قاعدة البيانات", status: "ok", message: "الجداول الأساسية قابلة للقراءة" });
    } catch (e) {
      results.push({ name: "قاعدة البيانات", status: "error", message: `فشل قراءة العملاء: ${e instanceof Error ? e.message : String(e)}` });
    }

    // 5. Check numbering defaults
    try {
      const { data, error } = await supabase.from("organization_settings").select("quotation_number_prefix, invoice_number_prefix, event_number_prefix, vat_registered").eq("organization_id", orgId).maybeSingle();
      if (error) throw error;
      if (!data) {
        results.push({ name: "ترقيم المستندات", status: "warn", message: "لم يتم حفظ إعدادات المنشأة بعد - سيتم استخدام QT/INV/EV افتراضياً" });
      } else {
        results.push({ name: "ترقيم المستندات", status: "ok", message: `البادئات: ${data.quotation_number_prefix}/${data.invoice_number_prefix}/${data.event_number_prefix} - VAT: ${data.vat_registered ? "مسجل" : "غير مسجل"}` });
      }
    } catch (e) {
      results.push({ name: "ترقيم المستندات", status: "warn", message: `تعذر فحص الإعدادات: ${e instanceof Error ? e.message : String(e)}` });
    }

    setChecks(results);
    setLoading(false);
  }

  /**
   * End-to-end storage proof on the SAME path the product uses for real
   * evidence: write into the private bucket under a valid evidence-type folder,
   * then read it back through a short-lived signed URL (the only read path the
   * application has — the bucket is private).
   *
   * Deletion is best-effort and its refusal is never a failure: migration 0074
   * deliberately creates NO delete policy on storage.objects, so removal is the
   * audited `reclaim_evidence` command, not a client call.
   */
  async function testUpload() {
    if (!orgId) return;
    setUploadTest("idle");
    setUploadMsg("جارٍ اختبار الرفع...");

    const probePath = healthProbePath(orgId, `${crypto.randomUUID()}.jpg`);
    try {
      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(probePath, storageProbeBlob(), {
          upsert: false,
          contentType: HEALTH_PROBE_MIME,
        });
      if (uploadError) throw uploadError;

      const { error: signedUrlError } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(probePath, 60);
      if (signedUrlError) throw signedUrlError;

      const { error: removeError } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .remove([probePath]);

      setUploadTest("ok");
      setUploadMsg(
        removeError
          ? "نجح الرفع والقراءة برابط موقّت — التخزين الخاص يعمل. تعذّر حذف ملف الفحص تلقائياً (لا توجد سياسة حذف من المتصفح by design)؛ سيظهر كعنصر يتيم في أمر تنظيف الأدلة."
          : "نجح اختبار الرفع والقراءة والحذف - التخزين يعمل بشكل صحيح",
      );
    } catch (cause) {
      const failure = classifyStorageFailure(cause);
      setUploadTest(failure.status === "warn" ? "warn" : "fail");
      setUploadMsg(failure.message);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Database className="h-5 w-5 text-brand-700" />
        <h2 className="font-black">حالة النظام والتشخيص</h2>
      </div>
      <p className="mt-1 text-sm leading-6 text-slate-500">
        فحص سريع للتأكد أن المنشأة جاهزة للتشغيل: الاتصال، التخزين، قاعدة البيانات، وترقيم المستندات. مفيد للمؤسس غير التقني.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void runChecks()} disabled={loading || !orgId} size="sm">
          {loading ? "جارٍ الفحص..." : "تشغيل فحص النظام"}
        </Button>
        <Button variant="outline" onClick={() => void testUpload()} disabled={!orgId} size="sm">
          <Upload className="h-4 w-4" />
          اختبار رفع ملف
        </Button>
      </div>

      {checks && (
        <div className="mt-4 space-y-2">
          {checks.map((c, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${c.status === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : c.status === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"}`}>
              {c.status === "ok" ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertTriangle className="h-5 w-5 shrink-0" />}
              <div>
                <p className="font-bold">{c.name}</p>
                <p className="mt-0.5 leading-5">{c.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {uploadMsg && (
        <div className={`mt-3 rounded-xl border p-3 text-sm ${uploadTest === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : uploadTest === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          <p className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 shrink-0" />
            {uploadMsg}
          </p>
        </div>
      )}

      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
        <p className="font-bold text-slate-700">ماذا تفعل إذا فشل فحص؟</p>
        <ul className="mt-1 list-disc space-y-1 pr-5">
          <li>إذا فشل "تخزين المرفقات": اذهب إلى Supabase Dashboard → Storage → أنشئ bucket باسم "attachments" واجعله Private (غير public).</li>
          <li>إذا ظهر اختبار الرفع بلون التحذير: التخزين سليم، لكن دورك لا يسمح برفع هذا النوع من الأدلة — أعد الفحص بحساب المالك (OWNER).</li>
          <li>إذا فشل "قاعدة البيانات": تأكد أنك سجلت دخول وعضويتك ACTIVE.</li>
          <li>إذا كان "ترقيم المستندات" تحذير: احفظ الإعدادات مرة واحدة من نفس الصفحة.</li>
        </ul>
      </div>
    </Card>
  );
}
