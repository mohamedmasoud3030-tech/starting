import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatOMR, type MilliOMR } from "@/lib/money";
import type { DraftBusy } from "./useQuotationDraft";

/**
 * Step 3 — "مراجعة وإرسال": summary, total, and the save/issue/discard
 * action cluster. Pure presentation over the controller.
 */
export function QuotationReviewStep({
  prospectName,
  guestCount,
  venueName,
  lineCount,
  grandTotalMilli,
  pricingBlocked,
  savedDraftId,
  editMode,
  busy,
  dirty,
  onDiscard,
  onSaveDraft,
  onRequestIssue,
}: {
  prospectName: string;
  guestCount: number | null;
  venueName: string;
  lineCount: number;
  grandTotalMilli: MilliOMR;
  pricingBlocked: boolean;
  savedDraftId: string | null;
  editMode: boolean;
  busy: DraftBusy;
  dirty: boolean;
  onDiscard: () => void;
  onSaveDraft: () => void;
  onRequestIssue: () => void;
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-1 text-xl font-black">
        <span className="text-brand-700">٣.</span> مراجعة وإرسال
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        راجع البيانات ثم أصدر عرض السعر. بعد الإصدار يصبح العرض نهائياً ولا يمكن تعديله.
      </p>
      <dl className="mb-4 grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-slate-500">العميل المتوقع</dt>
          <dd className="font-bold">{prospectName || "—"}</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">عدد الضيوف</dt>
          <dd className="font-bold">{guestCount ?? "غير محدد"}</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">الموقع</dt>
          <dd className="font-bold">{venueName || "—"}</dd>
        </div>
        <div>
          <dt className="text-sm text-slate-500">عدد الخدمات</dt>
          <dd className="font-bold">{lineCount}</dd>
        </div>
      </dl>
      {pricingBlocked && (
        <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">
          حدد عدد الضيوف أولاً حتى تُحسب الخدمات «لكل ضيف».
        </p>
      )}
      {dirty && (
        <p
          role="status"
          className="mb-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800"
        >
          لديك تغييرات غير محفوظة — احفظ المسودة قبل مغادرة الصفحة.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">الإجمالي</p>
          <p className="text-3xl font-black text-brand-800">{formatOMR(grandTotalMilli)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {savedDraftId && editMode && (
            <Button variant="danger" onClick={onDiscard} disabled={busy !== ""}>
              إلغاء المسودة
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={onSaveDraft}
            disabled={busy !== "" || !prospectName.trim() || pricingBlocked}
          >
            {busy === "الحفظ" ? "جارٍ الحفظ…" : "حفظ المسودة"}
          </Button>
          <Button
            size="lg"
            onClick={onRequestIssue}
            disabled={busy !== "" || lineCount === 0 || pricingBlocked}
          >
            {busy === "الإصدار" ? "جارٍ الإصدار…" : "إصدار عرض السعر"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
