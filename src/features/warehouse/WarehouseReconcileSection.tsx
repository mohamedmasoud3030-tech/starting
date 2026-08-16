import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { Input } from "@/components/ui/Input";
import type { AppRole } from "@/lib/dbTypes";
import {
  canReconcileWarehouse,
  reconcileBlock,
  reconcileBlockMessage,
  type WarehouseSummary,
} from "./warehouse.model";

/**
 * Final warehouse reconciliation: irreversible, requires an explicit
 * confirmation and (optionally) notes. Controller state comes from the
 * useWarehousePanel hook via props.
 */
export function WarehouseReconcileSection({
  role,
  summary,
  busy,
  confirming,
  onStartConfirm,
  onCancel,
  notes,
  onNotesChange,
  onConfirm,
}: {
  role: AppRole | null;
  summary: WarehouseSummary;
  busy: boolean;
  confirming: boolean;
  onStartConfirm: () => void;
  onCancel: () => void;
  notes: string;
  onNotesChange: (value: string) => void;
  onConfirm: () => void;
}) {
  if (!canReconcileWarehouse(role)) return null;
  const recBlock = reconcileBlock({ role, summary });

  return (
    <Card>
      <h3 className="font-black">التسوية النهائية للمخزن</h3>
      <p className="mt-1 text-sm text-slate-600">
        بعد التسوية لا يمكن تسجيل صرف أو إرجاع لهذه المناسبة.
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
              {reconcileBlockMessage(recBlock)}
            </span>
          )}
        </div>
      ) : (
        <ConfirmPanel
          title="تأكيد نهائي: هل تريد إغلاق مخزن هذه المناسبة؟ لا يمكن التراجع."
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
