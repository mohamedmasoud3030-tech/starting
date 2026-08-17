import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { MoneyInput } from "@/components/MoneyInput";
import { formatOMR, fromDbAmount, parseOMR, parseOptionalOMR, parseQuantityMilli, toOMRString } from "@/lib/money";
import type { EventRow, CommercialLine, Quote } from "../events.api";
import { CommercialLineForm } from "./CommercialLineForm";
import { pricingTotals } from "./pricingTotals";

type PricingDeps = {
  packages: ReadonlyArray<{ package: { id: string; name: string } }>;
  run: (name: string, args: Record<string, unknown>, includeEvent?: boolean) => Promise<void>;
};

/**
 * Inline editor for one commercial line (defect D35): replaces the three
 * blocking `window.prompt` dialogs with real form fields validated through
 * the same exact-money parsers the rest of the pricing flow uses.
 */
function EditLineDialog({
  line,
  canCost,
  open,
  onClose,
  run,
}: {
  line: CommercialLine;
  canCost: boolean;
  open: boolean;
  onClose: () => void;
  run: (name: string, args: Record<string, unknown>, includeEvent?: boolean) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState(() => String(line.quantity));
  const [sell, setSell] = useState(() =>
    toOMRString(fromDbAmount(line.unit_selling_price)),
  );
  const [cost, setCost] = useState(() =>
    toOMRString(fromDbAmount(line.expected_unit_cost ?? 0)),
  );
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    try {
      const q = parseQuantityMilli(quantity);
      const s = parseOMR(sell);
      const c = parseOMR(cost || "0.000");
      if (q <= 0) throw new Error("الكمية يجب أن تكون أكبر من صفر");
      if (s < 0 || c < 0) throw new Error("الأسعار لا يمكن أن تكون سالبة");
      void run(
        "save_event_commercial_line",
        {
          p_line_id: line.id,
          p_description: line.description,
          p_item_type: line.item_type,
          p_unit: line.unit,
          p_pricing_method: line.pricing_method,
          p_quantity: quantity,
          p_unit_selling_price: sell,
          p_expected_unit_cost: cost || "0.000",
          p_notes: null,
        },
      ).then(onClose, (cause) =>
        setError(cause instanceof Error ? cause.message : "تعذر حفظ التعديل"),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "قيم غير صالحة");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="تعديل سطر الخدمة"
      description={line.description}
    >
      <div className="grid gap-4">
        <Field label="الكمية" htmlFor="line-quantity">
          <Input
            id="line-quantity"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <MoneyInput
          id="line-sell"
          label="سعر البيع للوحدة"
          value={parseOptionalOMR(sell)}
          onChange={(millis) => setSell(millis === null ? "" : toOMRString(millis))}
        />
        {canCost && (
          <MoneyInput
            id="line-cost"
            label="التكلفة المتوقعة للوحدة"
            value={parseOptionalOMR(cost)}
            onChange={(millis) => setCost(millis === null ? "" : toOMRString(millis))}
          />
        )}
        {error && (
          <p className="text-sm font-bold text-red-700" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="button" onClick={submit}>
            حفظ التعديل
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Pricing tab: expected revenue/cost/profit, package application, custom
 * lines, and the quotation revision list. */
export function PricingTab({
  event,
  lines,
  quotes,
  canCost,
  canCommercial,
  deps,
}: {
  event: EventRow;
  lines: ReadonlyArray<CommercialLine>;
  quotes: ReadonlyArray<Quote>;
  canCost: boolean;
  canCommercial: boolean;
  deps: PricingDeps;
}) {
  const { packages, run } = deps;
  const [editingLine, setEditingLine] = useState<CommercialLine | null>(null);
  // Exact integer milli-OMR sums — never float reduce + toFixed (AGENTS.md).
  const totals = pricingTotals(lines);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">الإيراد المتوقع</p>
          <p className="text-xl font-black">{formatOMR(totals.sellMilli)}</p>
        </Card>
        {canCost && (
          <>
            <Card>
              <p className="text-sm text-slate-500">التكلفة المتوقعة</p>
              <p className="text-xl font-black">{formatOMR(totals.costMilli)}</p>
            </Card>
            <Card>
              <p className="text-sm text-slate-500">الربح المتوقع</p>
              <p className="text-xl font-black">{formatOMR(totals.profitMilli)}</p>
            </Card>
          </>
        )}
      </div>

      {canCommercial && event.accepted_quotation_id === null && (
        <>
          <Card>
            <h2 className="mb-3 font-black">تطبيق باقة</h2>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run("apply_package_to_event", {
                  p_package_id: String(f.get("package")),
                });
              }}
            >
              <Select name="package" required>
                <option value="">اختر باقة</option>
                {packages.map((p) => (
                  <option key={p.package.id} value={p.package.id}>
                    {p.package.name}
                  </option>
                ))}
              </Select>
              <Button type="submit">تطبيق</Button>
            </form>
          </Card>
          <CommercialLineForm submit={(values) => run("save_event_commercial_line", values)} />
        </>
      )}

      <div className="space-y-2">
        {lines.map((l) => (
          <Card key={l.id}>
            <div className="flex justify-between gap-3">
              <div>
                <h3 className="font-bold">{l.description}</h3>
                <p className="text-sm text-slate-500">
                  {l.quantity} {l.unit} · {l.pricing_method}
                </p>
              </div>
              <div className="text-left">
                <p className="font-black">{formatOMR(fromDbAmount(l.total_selling))}</p>
                {canCost && (
                  <p className="text-sm text-slate-500">
                    تكلفة {formatOMR(fromDbAmount(l.total_expected_cost))}
                  </p>
                )}
                {canCommercial && event.accepted_quotation_id === null && (
                  <Button
                    variant="secondary"
                    className="mt-2"
                    onClick={() => setEditingLine(l)}
                  >
                    تعديل
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {canCommercial && lines.length > 0 && (
        <Button
          onClick={() =>
            void run("issue_event_quotation", {
              p_terms: "",
              p_notes: "",
              p_idempotency_key: crypto.randomUUID(),
            })
          }
        >
          إصدار مراجعة عرض سعر
        </Button>
      )}

      <div className="space-y-2">
        {quotes.map((q) => (
          <Card key={q.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold">
                  {q.quotation_number} · مراجعة {q.revision}
                </p>
                <p>{formatOMR(fromDbAmount(q.total_selling))}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge>{q.status}</Badge>
                {q.status === "ISSUED" && canCommercial && (
                  <Button
                    onClick={() =>
                      void run(
                        "accept_event_quotation",
                        {
                          p_quotation_id: q.id,
                          p_idempotency_key: crypto.randomUUID(),
                        },
                        false,
                      )
                    }
                  >
                    اعتماد
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {editingLine && (
        <EditLineDialog
          line={editingLine}
          canCost={canCost}
          open={editingLine !== null}
          onClose={() => setEditingLine(null)}
          run={run}
        />
      )}
    </div>
  );
}
