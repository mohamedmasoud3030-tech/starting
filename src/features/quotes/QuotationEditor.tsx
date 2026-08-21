import { Calculator } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { InlineError } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/ui/PageHeader";
import { JobPath } from "@/components/ui/JobPath";
import { formatOMR } from "@/lib/money";
import { IssueQuotationDialog } from "./IssueQuotationDialog";
import { QuotationDetailsStep } from "./QuotationDetailsStep";
import { QuotationPricingStep } from "./QuotationPricingStep";
import { QuotationReviewStep } from "./QuotationReviewStep";
import { QuotationServicesStep } from "./QuotationServicesStep";
import { ScratchCalculator } from "./ScratchCalculator";
import { useQuotationDraft } from "./useQuotationDraft";

export function QuotationEditor({ draftId }: { draftId?: string }) {
  const draft = useQuotationDraft(draftId);

  if (!draft.canManageCommercial) {
    return (
      <p className="rounded-xl bg-amber-50 p-4 font-bold text-amber-800">
        عروض الأسعار متاحة للمالك والمدير فقط.
      </p>
    );
  }

  if (draftId && draft.existing.isLoading) {
    return <LoadingState label="جارٍ التحميل…" />;
  }
  if (draftId && draft.existing.data?.status !== "DRAFT") {
    return (
      <p className="rounded-xl bg-amber-50 p-4 font-bold text-amber-800">
        هذا العرض صادر أو محوّل ولا يمكن تعديله.
      </p>
    );
  }

  const packages = draft.packages.data ?? [];

  return (
    <div>
      <PageHeader
        title={draftId ? "تعديل عرض السعر" : "عرض سعر جديد"}
        description="اكتب الخدمات والأسعار، ثم أصدر العرض. بعد موافقة العميل تعتمده وتحوّله إلى مناسبة"
      />
      <div className="mb-5">
        <JobPath current="quote" />
      </div>
      {draft.error && <InlineError message={draft.error} className="mb-4" />}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <QuotationDetailsStep
            form={draft.form}
            onFieldChange={draft.setField}
            guestCount={draft.guestCount}
            onGuestCountChange={draft.setGuestCount}
          />
          <QuotationServicesStep
            packages={packages}
            selectedPackage={draft.selectedPackage}
            onSelectedPackageChange={draft.setSelectedPackage}
            onApplyPackage={draft.applySelectedPackage}
            onAddCustomLine={draft.addCustomLine}
            lines={draft.lines}
            lineTotals={draft.lineTotals}
            onUpdateLine={draft.updateLine}
            onRemoveLine={draft.removeLine}
          />
          <QuotationPricingStep
            pricing={draft.pricing}
            onChange={draft.setPricingField}
          />
          <QuotationReviewStep
            prospectName={draft.form.prospectName}
            guestCount={draft.guestCountNum}
            venueName={draft.form.venueName}
            lineCount={draft.lines.length}
            grandTotalMilli={draft.grandTotalMilli}
            pricingBlocked={draft.pricingBlocked}
            savedDraftId={draft.savedDraftId}
            editMode={draft.editMode}
            busy={draft.busy}
            dirty={draft.dirty}
            onDiscard={() => void draft.onDiscard()}
            onSaveDraft={() => void draft.onSaveDraft()}
            onRequestIssue={() => draft.setIssueConfirmationOpen(true)}
          />
        </div>

        <div className="space-y-5">
          <Card className="p-5 lg:sticky lg:top-20">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-black">
              <Calculator className="h-5 w-5 text-brand-700" />
              حاسبة سريعة
            </h2>
            <p className="mb-3 text-sm text-slate-500">
              احسب سعراً قبل اتخاذ القرار — الحساب هنا لا ينشئ أي سجلات.
            </p>
            <ScratchCalculator guestCount={draft.guestCountNum} />
          </Card>
          {draft.lines.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">المجموع الفرعي</p>
                <p className="font-bold">{formatOMR(draft.subtotalMilli)}</p>
              </div>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-sm text-slate-500">الإجمالي النهائي</p>
                <p className="mt-1 text-2xl font-black">{formatOMR(draft.grandTotalMilli)}</p>
              </div>
              <Badge tone={draft.pricingBlocked ? "warning" : "success"} className="mt-2">
                {draft.pricingBlocked ? "ينقص عدد الضيوف" : "جاهز للإصدار"}
              </Badge>
            </Card>
          )}
        </div>
      </div>

      <IssueQuotationDialog
        open={draft.issueConfirmationOpen}
        onOpenChange={draft.setIssueConfirmationOpen}
        grandTotalMilli={draft.grandTotalMilli}
        busy={draft.busy !== ""}
        onConfirm={() => void draft.onIssue()}
      />
    </div>
  );
}
