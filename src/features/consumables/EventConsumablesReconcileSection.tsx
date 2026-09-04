import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { Input } from "@/components/ui/Input";
import {
  reconcileConsumablesBlock,
  reconcileConsumablesBlockMessage,
  type ConsumableSummary,
} from "./consumables.model";

/** Final event consumables reconciliation: irreversible, confirmed. */
export function EventConsumablesReconcileSection({
  canManage,
  summary,
  busy,
  confirming,
  onStartConfirm,
  onCancel,
  notes,
  onNotesChange,
  onConfirm,
}: {
  /** stock.adjust — precomputed by the panel. */
  canManage: boolean;
  summary: ConsumableSummary;
  busy: boolean;
  confirming: boolean;
  onStartConfirm: () => void;
  onCancel: () => void;
  notes: string;
  onNotesChange: (value: string) => void;
  onConfirm: () => void;
}) {
  if (!canManage) return null;
  const recBlock = reconcileConsumablesBlock({ canManage, summary });

  return (
    <Card>
      <h3 className="font-black">التسوية النهائية للمواد الاستهلاكية</h3>
      <p className="mt-1 text-sm text-slate-600">
        بعد التسوية لا يمكن تسجيل صرف أو مرتجع أو استهلاك أو هالك لهذه المناسبة.
      </p>
      {!confirming ? (
        <div className="mt-3 flex flex-col">
          <Button
            size="lg"
            disabled={recBlock.blocked || busy}
            onClick={onStartConfirm}
          >
            إتمام التسوية النهائية
          </Button>
          {recBlock.blocked && (
            <span className="mt-2 text-sm font-semibold text-slate-600">
              {reconcileConsumablesBlockMessage(recBlock)}
            </span>
          )}
        </div>
      ) : (
        <ConfirmPanel
          title="تأكيد نهائي: هل تريد إغلاق مواد هذه المناسبة؟ لا يمكن التراجع."
          confirmLabel="نعم، إتمام التسوية"
          busy={busy}
          onConfirm={onConfirm}
          onCancel={onCancel}
        >
          <Input
            placeholder="ملاحظات التسوية (اختياري)"
            aria-label="ملاحظات التسوية"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
          />
        </ConfirmPanel>
      )}
    </Card>
  );
}
