import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Copy, Eye, FileCheck2, Printer, XCircle } from "lucide-react";
import { JobPath } from "@/components/ui/JobPath";
import { jobPathForQuoteStatus } from "@/features/events/eventWorkspace.model";
import { useAuth } from "@/app/authContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { OwnerVoiceButton } from "@/features/ownerVoice/OwnerVoiceButton";
import { buildQuotationVoiceSummary } from "@/features/ownerVoice/screenSummary";
import { buildDocumentIdentity } from "@/components/documents/documentIdentity";
import { printDocument } from "@/components/documents/printDocument";
import { useOrganizationSettings } from "@/features/settings/settings.api";
import { formatOMR, fromDbAmount } from "@/lib/money";
import { PRICING_METHOD_LABELS } from "@/lib/domain";
import { InlineError } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { QuotationDocument } from "./QuotationDocument";
import {
  arabicQuotationError,
  useAcceptQuotation,
  useConvertQuotation,
  useExpireQuotation,
  useQuotation,
  useQuotationLines,
  useRejectQuotation,
  useReviseQuotation,
} from "./quotes.api";

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function QuotationReview({ quoteId }: { quoteId: string }) {
  const { currentOrganization, canManageCommercial, canIssueQuotation } =
    useAuth();
  const orgId = currentOrganization?.id ?? null;
  const navigate = useNavigate();

  const quote = useQuotation(orgId, quoteId);
  const lines = useQuotationLines(orgId, quoteId);
  const settings = useOrganizationSettings(orgId);
  const [previewOpen, setPreviewOpen] = useState(false);

  const accept = useAcceptQuotation(orgId);
  const convert = useConvertQuotation(orgId);
  const reject = useRejectQuotation(orgId);
  const expire = useExpireQuotation(orgId);
  const revise = useReviseQuotation(orgId);

  const [convertOpen, setConvertOpen] = useState(false);
  const [convertForm, setConvertForm] = useState({
    startAt: "",
    endAt: "",
    venueName: "",
    guestCount: "",
    eventTitle: "",
  });
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseReason, setReviseReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const q = quote.data;

  function openConvert() {
    setError("");
    setConvertForm({
      startAt: isoToLocalInput(q?.start_at_snapshot),
      endAt: isoToLocalInput(q?.end_at_snapshot),
      venueName: q?.venue_snapshot ?? "",
      guestCount: q?.guest_count_snapshot != null ? String(q.guest_count_snapshot) : "",
      eventTitle: q?.event_title_snapshot ?? "",
    });
    setConvertOpen(true);
  }

  async function onAccept() {
    if (!q) return;
    setError("");
    setBusy("اعتماد");
    try {
      await accept.mutateAsync(q.id);
    } catch (x) {
      setError(arabicQuotationError(x));
    } finally {
      setBusy("");
    }
  }

  async function onConvert() {
    if (!q) return;
    setError("");
    setBusy("تحويل");
    try {
      const event = await convert.mutateAsync({
        quotationId: q.id,
        startAt: convertForm.startAt,
        endAt: convertForm.endAt,
        venueName: convertForm.venueName,
        guestCount: convertForm.guestCount.trim() === "" ? undefined : Number(convertForm.guestCount),
        eventTitle: convertForm.eventTitle,
      });
      setConvertOpen(false);
      await navigate({ to: "/events/$eventId", params: { eventId: event.id } });
    } catch (x) {
      setError(arabicQuotationError(x));
    } finally {
      setBusy("");
    }
  }

  async function onRevise() {
    if (!q) return;
    setError("");
    setBusy("نسخة");
    try {
      const revision = await revise.mutateAsync({ quotationId: q.id, reason: reviseReason });
      setReviseOpen(false);
      await navigate({ to: "/quotes/$quoteId", params: { quoteId: revision.id } });
    } catch (x) {
      setError(arabicQuotationError(x));
    } finally {
      setBusy("");
    }
  }

  async function onReject() {
    if (!q) return;
    setError("");
    setBusy("رفض");
    try {
      await reject.mutateAsync({ quotationId: q.id });
    } catch (x) {
      setError(arabicQuotationError(x));
    } finally {
      setBusy("");
    }
  }

  async function onExpire() {
    if (!q) return;
    setError("");
    setBusy("صلاحية");
    try {
      await expire.mutateAsync(q.id);
    } catch (x) {
      setError(arabicQuotationError(x));
    } finally {
      setBusy("");
    }
  }

  const statusLabel: Record<string, string> = {
    DRAFT: "مسودة",
    ISSUED: "مُرسل",
    EXPIRED: "منتهي الصلاحية",
    ACCEPTED: "معتمد",
    REJECTED: "مرفوض",
    CONVERTED: "محوّل لمناسبة",
    CANCELLED: "ملغي",
    SUPERSEDED: "مستبدل",
  };

  function statusTone(): "neutral" | "success" | "warning" | "danger" | "brand" {
    if (q?.status === "ACCEPTED") return "success";
    if (q?.status === "CONVERTED") return "brand";
    if (q?.status === "REJECTED" || q?.status === "CANCELLED") return "danger";
    if (q?.status === "DRAFT" || q?.status === "EXPIRED" || q?.status === "SUPERSEDED") return "neutral";
    return "warning";
  }

  if (quote.isLoading || lines.isLoading) {
    return <LoadingState label="جارٍ التحميل…" />;
  }
  if (!q) {
    return <p>تعذر العثور على عرض السعر.</p>;
  }

  const voiceSummary = buildQuotationVoiceSummary({
    totalSellingOmr: q.total_selling,
    guestCount: q.guest_count_snapshot,
    status: q.status,
  });

  return (
    <div className="space-y-5">
      <Link to="/quotes" className="font-bold text-brand-700">
        → العودة إلى عروض الأسعار
      </Link>

      <PageHeader
        title="عرض السعر"
        description={`${q.quotation_number ?? ""} · مراجعة ${q.revision}`}
        actions={
          <>
            <OwnerVoiceButton summary={voiceSummary} />
            <Button variant="outline" onClick={() => setPreviewOpen((v) => !v)}>
              <Eye className="h-5 w-5" />
              {previewOpen ? "إخفاء المعاينة" : "معاينة المستند"}
            </Button>
            <Button onClick={() => printDocument()}>
              <Printer className="h-5 w-5" />
              طباعة / حفظ PDF
            </Button>
            <Badge tone={statusTone()}>
              {statusLabel[q.status] ?? q.status}
            </Badge>
          </>
        }
      />

      <JobPath current={jobPathForQuoteStatus(q.status)} />

      {q.status === "ISSUED" && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm font-bold leading-6 text-brand-900">
          الخطوة التالية: إذا وافق العميل اضغط «اعتماد العرض»، ثم حوّله إلى مناسبة.
        </p>
      )}
      {q.status === "ACCEPTED" && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm font-bold leading-6 text-brand-900">
          الخطوة التالية: حوّل العرض إلى مناسبة لتبدأ التنفيذ والتحصيل.
        </p>
      )}
      {q.status === "CONVERTED" && q.converted_event_id && (
        <p className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm font-bold leading-6 text-brand-900">
          اكتمل العرض. أكمل التنفيذ والتحصيل من المناسبة.
        </p>
      )}

      {error && (
        <InlineError message={error} />
      )}

      {previewOpen && (
        <div className="space-y-3">
          <QuotationDocument
            identity={buildDocumentIdentity(currentOrganization, settings.data ?? null)}
            data={{
              quotationNumber: q.quotation_number,
              customerName: q.customer_name_snapshot,
              customerPhone: q.customer_phone_snapshot,
              eventTitle: q.event_title_snapshot,
              guestCount: q.guest_count_snapshot,
              startAt: q.start_at_snapshot,
              venue: q.venue_snapshot,
              subtotal: q.subtotal,
              transportAmount: q.transport_amount,
              transportNote: q.transport_note,
              surchargeAmount: q.surcharge_amount,
              discountAmount: q.discount_amount,
              totalSelling: q.total_selling,
              preVatTotal: q.pre_vat_total,
              vatRegistered: q.vat_registered,
              vatPercent: q.vat_percent,
              vatAmount: q.vat_amount,
              vatRegistrationNumber: q.vat_registration_number,
              revision: q.revision,
              issuedAt: q.issued_at,
              validUntil: q.valid_until,
            }}
            lines={lines.data ?? []}
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-black">بيانات العميل المتوقع</h2>
          <dl className="mt-3 space-y-2">
            <div>
              <dt className="text-sm text-slate-500">الاسم</dt>
              <dd className="font-bold">{q.customer_name_snapshot}</dd>
            </div>
            {q.customer_phone_snapshot && (
              <div>
                <dt className="text-sm text-slate-500">الجوال</dt>
                <dd dir="ltr" className="text-right font-bold">
                  {q.customer_phone_snapshot}
                </dd>
              </div>
            )}
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="font-black">بيانات المناسبة (إن وُجدت)</h2>
          <dl className="mt-3 space-y-2">
            <div>
              <dt className="text-sm text-slate-500">التاريخ</dt>
              <dd className="font-bold">
                {q.start_at_snapshot
                  ? new Date(q.start_at_snapshot).toLocaleString("ar-OM", {
                      timeZone: "Asia/Muscat",
                    })
                  : "غير محدد"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">الموقع</dt>
              <dd className="font-bold">{q.venue_snapshot ?? "غير محدد"}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">عدد الضيوف</dt>
              <dd className="font-bold">{q.guest_count_snapshot ?? "غير محدد"}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-3 font-black">الخدمات</h2>
        <div className="space-y-2">
          {lines.data?.length === 0 ? (
            <p className="text-slate-500">لا توجد خدمات.</p>
          ) : (
            lines.data?.map((line) => (
              <div
                key={line.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
              >
                <div>
                  <p className="font-bold">{line.description}</p>
                  <p className="text-sm text-slate-500">
                    {line.quantity} {line.unit} · {PRICING_METHOD_LABELS[line.pricing_method]}
                  </p>
                </div>
                <p className="font-black">{formatOMR(fromDbAmount(line.total_selling))}</p>
              </div>
            ))
          )}
        </div>
        <div className="mt-4 space-y-1 border-t border-slate-100 pt-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">المجموع الفرعي</span>
            <span className="font-bold">{formatOMR(fromDbAmount(q.subtotal))}</span>
          </div>
          {fromDbAmount(q.transport_amount) > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-slate-500">النقل</span>
              <span className="font-bold">{formatOMR(fromDbAmount(q.transport_amount))}</span>
            </div>
          )}
          {fromDbAmount(q.surcharge_amount) > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-slate-500">رسوم إضافية</span>
              <span className="font-bold">{formatOMR(fromDbAmount(q.surcharge_amount))}</span>
            </div>
          )}
          {fromDbAmount(q.discount_amount) > 0 && (
            <div className="flex items-center justify-between text-red-600">
              <span className="text-slate-500">الخصم</span>
              <span className="font-bold">-{formatOMR(fromDbAmount(q.discount_amount))}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 pt-2">
            <span className="text-base text-slate-500">الإجمالي النهائي</span>
            <span className="text-2xl font-black text-brand-800">{formatOMR(fromDbAmount(q.total_selling))}</span>
          </div>
        </div>
      </Card>

      {q.is_expired && q.status === "ISSUED" && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
          انتهت صلاحية هذا العرض وفق تاريخ «صالح حتى» — يمكنك تجديده أو إنهاؤه رسمياً.
        </p>
      )}

      {(q.status === "ISSUED"
        ? canManageCommercial || canIssueQuotation
        : q.status === "ACCEPTED"
          ? canIssueQuotation
          : false) && (
        <div className="flex flex-wrap justify-end gap-3">
          {q.status === "ISSUED" && (
            <>
              {/* revise_quotation → quotation.manage */}
              {canManageCommercial && (
                <Button variant="outline" onClick={() => setReviseOpen(true)} disabled={busy !== ""}>
                  <Copy className="h-5 w-5" />
                  نسخة معدلة (Revision)
                </Button>
              )}
              {/* accept/reject/expire → quotation.issue */}
              {canIssueQuotation && (
                <>
                  <Button variant="outline" onClick={() => void onExpire()} disabled={busy !== ""}>
                    إنهاء الصلاحية
                  </Button>
                  <Button variant="danger" onClick={() => void onReject()} disabled={busy !== ""}>
                    <XCircle className="h-5 w-5" />
                    رفض العرض
                  </Button>
                  <Button size="lg" onClick={() => void onAccept()} disabled={busy !== ""}>
                    <FileCheck2 className="h-5 w-5" />
                    {busy === "اعتماد" ? "جارٍ الاعتماد…" : "اعتماد العرض"}
                  </Button>
                </>
              )}
            </>
          )}
          {/* convert_quotation_to_event → quotation.issue */}
          {q.status === "ACCEPTED" && (
            <Button size="lg" onClick={openConvert} disabled={busy !== ""}>
              <CheckCircle2 className="h-5 w-5" />
              تأكيد الحجز / تحويل إلى مناسبة
            </Button>
          )}
        </div>
      )}

      {q.status === "CONVERTED" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-50 p-4">
          <p className="font-bold text-brand-800">تم تحويل هذا العرض إلى مناسبة.</p>
          {q.converted_event_id && (
            <Link
              to="/events/$eventId"
              params={{ eventId: q.converted_event_id }}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-800"
            >
              افتح المناسبة
            </Link>
          )}
        </div>
      )}
      {q.status === "SUPERSEDED" && (
        <p className="rounded-xl bg-slate-100 p-3 font-bold text-slate-600">
          استُبدل هذا الإصدار بنسخة أحدث{q.superseded_reason ? ` — ${q.superseded_reason}` : ""}.
        </p>
      )}

      <Dialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        title="تأكيد الحجز"
        description="سيتم إنشاء العميل والمناسبة من بيانات العرض. أكمل أي معلومات ناقصة."
      >
        <div className="grid gap-3">
          <Field label="تاريخ البداية" htmlFor="convert-start">
            <Input
              id="convert-start"
              type="datetime-local"
              value={convertForm.startAt}
              onChange={(e) => setConvertForm((f) => ({ ...f, startAt: e.target.value }))}
            />
          </Field>
          <Field label="تاريخ النهاية" htmlFor="convert-end">
            <Input
              id="convert-end"
              type="datetime-local"
              value={convertForm.endAt}
              onChange={(e) => setConvertForm((f) => ({ ...f, endAt: e.target.value }))}
            />
          </Field>
          <Field label="الموقع" htmlFor="convert-venue">
            <Input
              id="convert-venue"
              value={convertForm.venueName}
              onChange={(e) => setConvertForm((f) => ({ ...f, venueName: e.target.value }))}
            />
          </Field>
          <Field label="عدد الضيوف" htmlFor="convert-guests">
            <Input
              id="convert-guests"
              type="number"
              min="1"
              value={convertForm.guestCount}
              onChange={(e) => setConvertForm((f) => ({ ...f, guestCount: e.target.value }))}
            />
          </Field>
          <Field label="اسم المناسبة" htmlFor="convert-title">
            <Input
              id="convert-title"
              value={convertForm.eventTitle}
              onChange={(e) => setConvertForm((f) => ({ ...f, eventTitle: e.target.value }))}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setConvertOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={() => void onConvert()} disabled={busy !== ""}>
              {busy === "تحويل" ? "جارٍ التحويل…" : "تأكيد التحويل"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={reviseOpen}
        onOpenChange={setReviseOpen}
        title="نسخة معدلة"
        description="سيُنشأ إصدار جديد (Revision) من هذا العرض ويبقى الإصدار الحالي محفوظاً دون تغيير."
      >
        <div className="grid gap-3">
          <Field label="سبب التعديل (اختياري)" htmlFor="revise-reason">
            <Input
              id="revise-reason"
              value={reviseReason}
              onChange={(e) => setReviseReason(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReviseOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={() => void onRevise()} disabled={busy !== ""}>
              {busy === "نسخة" ? "جارٍ الإنشاء…" : "إنشاء النسخة المعدلة"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
