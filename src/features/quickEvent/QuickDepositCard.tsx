import { useState } from "react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatOMR, fromDbAmount, parseOMR, toOMRString } from "@/lib/money";
import { paymentError, useRecordPayment } from "@/features/payments/payments.api";
import type { PaymentMethod } from "@/lib/dbTypes";
import { DEPOSIT_PERCENT, depositMilli } from "./officeOffers";

const METHODS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "نقداً" },
  { value: "BANK_TRANSFER", label: "تحويل بنكي" },
  { value: "MOBILE_WALLET", label: "محفظة" },
  { value: "CARD", label: "بطاقة" },
];

/**
 * «سجّل العربون» — the office rule (30% at confirmation) as one tap.
 * Shown on the event summary while nothing has been collected yet. Records
 * through the existing `record_customer_payment` command (idempotent, audited,
 * capped by the accepted quotation), so the payments tab, statements and
 * receipts all see it.
 */
export function QuickDepositCard({
  orgId,
  eventId,
  acceptedValue,
  collected,
}: {
  orgId: string | null;
  eventId: string;
  /** exact decimal text from the command center (null = no accepted quote). */
  acceptedValue: string | null;
  collected: string | null;
}) {
  const record = useRecordPayment(orgId, eventId);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [custom, setCustom] = useState<string>("");

  if (!acceptedValue) return null;
  const valueMilli = fromDbAmount(acceptedValue);
  const collectedMilli = collected ? fromDbAmount(collected) : 0;
  if (valueMilli <= 0 || collectedMilli > 0) return null;

  const suggested = depositMilli(valueMilli);
  const amountMilli = custom.trim() ? parseOMR(custom) : suggested;
  const valid = Number.isFinite(amountMilli) && amountMilli > 0 && amountMilli <= valueMilli;

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-6 w-6 text-sky-700" />
          <div>
            <p className="text-lg font-black text-sky-900">لم يُسجَّل عربون بعد</p>
            <p className="text-sm text-sky-900/80">
              قيمة العرض {formatOMR(valueMilli)} · العربون {DEPOSIT_PERCENT}% = <b>{formatOMR(suggested)}</b>
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-sm font-bold text-sky-900">
          المبلغ
          <input
            inputMode="decimal"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={toOMRString(suggested)}
            className="mt-1 h-12 w-36 rounded-xl border border-sky-200 bg-white px-3 text-center text-xl font-black text-slate-900"
          />
        </label>
        <div className="flex flex-wrap gap-1">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMethod(m.value)}
              className={
                method === m.value
                  ? "min-h-12 rounded-xl bg-sky-700 px-3 text-sm font-bold text-white"
                  : "min-h-12 rounded-xl border border-sky-200 bg-white px-3 text-sm font-bold text-sky-900 hover:bg-sky-100"
              }
            >
              {m.label}
            </button>
          ))}
        </div>
        <Button
          size="lg"
          disabled={!valid || record.isPending}
          onClick={() =>
            record.mutate({
              amountMilli,
              method,
              reference: "",
              notes: `عربون ${DEPOSIT_PERCENT}% عند تأكيد الحجز`,
            })
          }
        >
          {record.isPending ? "جارٍ التسجيل…" : "سجّل العربون"}
        </Button>
      </div>
      {record.error ? (
        <p role="alert" className="mt-2 text-sm font-bold text-red-700">
          {paymentError(record.error)}
        </p>
      ) : null}
    </div>
  );
}
