import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import type { EventRow, CommercialLine, Quote } from "../events.api";
import { CommercialLineForm } from "./CommercialLineForm";

type PricingDeps = {
  packages: ReadonlyArray<{ package: { id: string; name: string } }>;
  run: (name: string, args: Record<string, unknown>, includeEvent?: boolean) => Promise<void>;
};

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
  const totalSell = lines.reduce((n, l) => n + Number(l.total_selling), 0);
  const totalCost = lines.reduce(
    (n, l) => n + Number(l.total_expected_cost ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">الإيراد المتوقع</p>
          <p className="text-xl font-black">{totalSell.toFixed(3)} ر.ع.</p>
        </Card>
        {canCost && (
          <>
            <Card>
              <p className="text-sm text-slate-500">التكلفة المتوقعة</p>
              <p className="text-xl font-black">{totalCost.toFixed(3)} ر.ع.</p>
            </Card>
            <Card>
              <p className="text-sm text-slate-500">الربح المتوقع</p>
              <p className="text-xl font-black">{(totalSell - totalCost).toFixed(3)} ر.ع.</p>
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
                <p className="font-black">{Number(l.total_selling).toFixed(3)} ر.ع.</p>
                {canCost && (
                  <p className="text-sm text-slate-500">
                    تكلفة {Number(l.total_expected_cost).toFixed(3)}
                  </p>
                )}
                {canCommercial && event.accepted_quotation_id === null && (
                  <Button
                    variant="secondary"
                    className="mt-2"
                    onClick={() => {
                      const quantity = window.prompt("الكمية", l.quantity);
                      const sell = window.prompt("سعر البيع", l.unit_selling_price);
                      const cost = window.prompt(
                        "التكلفة المتوقعة",
                        l.expected_unit_cost ?? "0.000",
                      );
                      if (quantity && sell && cost)
                        void run("save_event_commercial_line", {
                          p_line_id: l.id,
                          p_description: l.description,
                          p_item_type: l.item_type,
                          p_unit: l.unit,
                          p_pricing_method: l.pricing_method,
                          p_quantity: quantity,
                          p_unit_selling_price: sell,
                          p_expected_unit_cost: cost,
                          p_notes: null,
                        });
                    }}
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
                <p>{Number(q.total_selling).toFixed(3)} ر.ع.</p>
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
    </div>
  );
}
