import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { formatOMR, type MilliOMR } from "@/lib/money";

/** Confirmation dialog before issuing a quotation (final, irreversible). */
export function IssueQuotationDialog({
  open,
  onOpenChange,
  grandTotalMilli,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grandTotalMilli: MilliOMR;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="تأكيد إصدار عرض السعر"
      description="سيُنشأ رقم رسمي وتصبح الأسعار والخدمات لقطة تجارية غير قابلة للتعديل. راجع الإجمالي قبل المتابعة."
    >
      <div className="space-y-5">
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-sm font-bold text-slate-500">الإجمالي النهائي</p>
          <p className="mt-1 text-3xl font-black text-slate-900">
            {formatOMR(grandTotalMilli)}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            العودة للمراجعة
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            تأكيد الإصدار
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
