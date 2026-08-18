import { useState, type FormEvent } from "react";
import { CheckCircle2, Lock, RotateCcw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatOMR, fromDbAmount, parseOMR } from "@/lib/money";
import type { ExpenseCategory, PaymentMethod } from "@/lib/dbTypes";
import { useEventFinance } from "@/features/payments/payments.api";
import {
  financeError,
  useCloseFinancially,
  useEventExpenseCategories,
  useEventExpenses,
  useEventFinancialClosures,
  useFinancialReadiness,
  useRecordExpense,
  useReopenFinancially,
  useVoidExpense,
} from "./finance.api";

const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  TRANSPORT: "نقل",
  FUEL: "وقود",
  RENTAL: "إيجارات خارجية",
  THIRD_PARTY: "خدمات طرف ثالث",
  CONSUMABLE: "مواد مستهلكة",
  DAMAGE_LOSS: "فقد/تلف",
  OTHER: "أخرى",
};

/**
 * The event's unified finance section: value / collected / remaining / costs /
 * profit / margin, the expense ledger, and the financial-close cycle. This is
 * the single source of truth for "how is this event doing financially" — never
 * a mix of cash and revenue.
 */
export function EventFinancePanel({
  orgId,
  eventId,
  canMutate,
}: {
  orgId: string | null;
  eventId: string;
  canMutate: boolean;
}) {
  const finance = useEventFinance(orgId, eventId);
  const expenses = useEventExpenses(orgId, eventId);
  const categories = useEventExpenseCategories(orgId, eventId);
  const closures = useEventFinancialClosures(orgId, eventId);
  const readiness = useFinancialReadiness(orgId, eventId);

  const recordExpense = useRecordExpense(orgId, eventId);
  const voidExpense = useVoidExpense(orgId, eventId);
  const close = useCloseFinancially(orgId, eventId);
  const reopen = useReopenFinancially(orgId, eventId);

  const [error, setError] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false);

  const f = finance.data;
  const activeClosure = (closures.data ?? []).find((c) => c.reopenedAt === null);
  const isClosed = !!activeClosure;
  const marginText = f?.marginPercent != null ? `${f.marginPercent.toFixed(1)}%` : "—";

  function submitExpense(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    const amount = String(form.get("amount") ?? "");
    let amountMilli: number;
    try {
      amountMilli = parseOMR(amount);
    } catch {
      setError("أدخل مبلغاً صحيحاً");
      return;
    }
    if (amountMilli <= 0) {
      setError("أدخل مبلغاً صحيحاً أكبر من صفر");
      return;
    }
    void recordExpense
      .mutateAsync({
        category: String(form.get("category")) as ExpenseCategory,
        amountMilli,
        expenseDate: String(form.get("date") ?? ""),
        description: String(form.get("description") ?? ""),
        payee: String(form.get("payee") ?? ""),
        reference: String(form.get("reference") ?? ""),
        paymentMethod: (form.get("method") as PaymentMethod) || null,
      })
      .then(() => e.currentTarget.reset())
      .catch((x) => setError(financeError(x)));
  }

  async function onClose() {
    setError("");
    try {
      await close.mutateAsync({});
    } catch (x) {
      setError(financeError(x));
    }
  }

  async function onReopen() {
    setError("");
    if (reopenReason.trim().length < 3) return;
    try {
      await reopen.mutateAsync({ reason: reopenReason.trim() });
      setReopenOpen(false);
      setReopenReason("");
    } catch (x) {
      setError(financeError(x));
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</Card>
      )}

      {/* Financial summary */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-black">الحالة المالية</h2>
          {isClosed ? (
            <Badge tone="neutral">
              <Lock className="h-4 w-4" />
              مغلقة مالياً
            </Badge>
          ) : (
            <Badge tone="warning">مفتوحة مالياً</Badge>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <SummaryStat label="القيمة" value={f ? formatOMR(f.acceptedRevenueMilli) : "—"} />
          <SummaryStat label="المحصل" value={f ? formatOMR(f.amountPaidMilli) : "—"} />
          <SummaryStat label="المتبقي" value={f ? formatOMR(f.outstandingMilli) : "—"} />
          <SummaryStat label="المصروف" value={f ? formatOMR(f.actualCostMilli) : "—"} />
          <SummaryStat label="الربح" value={f ? formatOMR(f.actualProfitMilli) : "—"} tone="brand" />
          <SummaryStat label="الهامش" value={marginText} />
        </div>

        {categories.data && categories.data.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="text-sm font-bold text-slate-500">توزيع التكاليف</p>
            <ul className="mt-2 space-y-1 text-sm">
              {f && f.staffCostMilli > 0 && (
                <li className="flex justify-between">
                  <span>عمالة</span>
                  <span className="font-bold">{formatOMR(f.staffCostMilli)}</span>
                </li>
              )}
              {f && f.procurementCostMilli > 0 && (
                <li className="flex justify-between">
                  <span>مشتريات</span>
                  <span className="font-bold">{formatOMR(f.procurementCostMilli)}</span>
                </li>
              )}
              {categories.data.map((c) => (
                <li key={c.category} className="flex justify-between">
                  <span>{EXPENSE_CATEGORY_LABELS[c.category as ExpenseCategory] ?? c.category}</span>
                  <span className="font-bold">{formatOMR(fromDbAmount(c.total))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Expenses ledger + record form */}
      <Card className="p-5">
        <h2 className="font-black">المصروفات</h2>
        {canMutate && !isClosed && (
          <form onSubmit={submitExpense} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="الفئة" htmlFor="exp-category">
              <Select id="exp-category" name="category" defaultValue="TRANSPORT">
                {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="المبلغ (ريال)" htmlFor="exp-amount">
              <Input id="exp-amount" name="amount" dir="ltr" inputMode="decimal" required />
            </Field>
            <Field label="التاريخ" htmlFor="exp-date">
              <Input id="exp-date" name="date" type="date" required />
            </Field>
            <Field label="طريقة الدفع (اختياري)" htmlFor="exp-method">
              <Select id="exp-method" name="method" defaultValue="">
                <option value="">—</option>
                <option value="CASH">نقدي</option>
                <option value="BANK_TRANSFER">تحويل بنكي</option>
                <option value="CARD">بطاقة</option>
                <option value="OTHER">أخرى</option>
              </Select>
            </Field>
            <Field label="الوصف" htmlFor="exp-desc">
              <Input id="exp-desc" name="description" required />
            </Field>
            <Field label="المستفيد/المورد (اختياري)" htmlFor="exp-payee">
              <Input id="exp-payee" name="payee" />
            </Field>
            <Field label="مرجع (اختياري)" htmlFor="exp-ref">
              <Input id="exp-ref" name="reference" dir="ltr" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={recordExpense.isPending}>
                {recordExpense.isPending ? "جارٍ الحفظ…" : "إضافة مصروف"}
              </Button>
            </div>
          </form>
        )}

        {(expenses.data ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">لا توجد مصروفات مسجلة.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {(expenses.data ?? []).map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 p-3">
                <div>
                  <p className="font-bold">
                    {EXPENSE_CATEGORY_LABELS[e.category]} · {formatOMR(e.amountMilli)}
                  </p>
                  <p className="text-sm text-slate-500">
                    {e.description}
                    {e.payee ? ` · ${e.payee}` : ""}
                    {e.status === "VOIDED" ? " · ملغى" : ""}
                  </p>
                </div>
                {canMutate && e.status === "RECORDED" && !isClosed && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void voidExpense.mutateAsync({ expenseId: e.id, reason: "إلغاء" }).catch((x) => setError(financeError(x)))}
                  >
                    <XCircle className="h-4 w-4" />
                    إلغاء
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Financial close */}
      <Card className="p-5">
        <h2 className="font-black">الإغلاق المالي</h2>

        {readiness.data && !isClosed && (
          <ul className="mt-3 space-y-2">
            {(readiness.data ?? []).map((c) => (
              <li key={c.check_key} className="flex items-start gap-2 text-sm">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                ) : (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                )}
                <span className={c.ok ? "text-slate-700" : "font-bold text-amber-800"}>{c.detail}</span>
              </li>
            ))}
          </ul>
        )}

        {canMutate && !isClosed && (
          <Button className="mt-4" onClick={() => void onClose()} disabled={close.isPending}>
            <Lock className="h-5 w-5" />
            {close.isPending ? "جارٍ الإغلاق…" : "إغلاق مالي"}
          </Button>
        )}

        {isClosed && activeClosure && (
          <div className="mt-4">
            <p className="rounded-xl bg-slate-100 p-3 font-bold text-slate-700">
              مغلقة مالياً في{" "}
              {new Date(activeClosure.closedAt).toLocaleString("ar-OM", { timeZone: "Asia/Muscat" })}
              {activeClosure.closeNote ? ` — ${activeClosure.closeNote}` : ""}
              {" · "}الربح عند الإغلاق: {formatOMR(activeClosure.profitAtCloseMilli)}
            </p>
            {canMutate && !reopenOpen && (
              <Button variant="outline" className="mt-3" onClick={() => setReopenOpen(true)}>
                <RotateCcw className="h-5 w-5" />
                إعادة فتح مالي
              </Button>
            )}
            {reopenOpen && (
              <div className="mt-3 grid gap-2">
                <Field label="سبب إعادة الفتح (إجباري)" htmlFor="reopen-reason">
                  <Input
                    id="reopen-reason"
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    placeholder="مثال: ظهر مصروف نقل غير مسجّل"
                  />
                </Field>
                <div className="flex gap-2">
                  <Button onClick={() => void onReopen()} disabled={reopenReason.trim().length < 3 || reopen.isPending}>
                    {reopen.isPending ? "جارٍ الفتح…" : "تأكيد إعادة الفتح"}
                  </Button>
                  <Button variant="secondary" onClick={() => setReopenOpen(false)}>إلغاء</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {(closures.data ?? []).length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="text-sm font-bold text-slate-500">سجل الإغلاق</p>
            <ul className="mt-2 space-y-1 text-sm">
              {(closures.data ?? []).map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <span>
                    أُغلقت {new Date(c.closedAt).toLocaleString("ar-OM", { timeZone: "Asia/Muscat" })}
                    {c.reopenedAt ? ` · أُعيد فتحها (${c.reopenReason ?? ""})` : ""}
                  </span>
                  <span className="font-bold">{formatOMR(c.profitAtCloseMilli)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "brand" }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-black ${tone === "brand" ? "text-brand-800" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}
