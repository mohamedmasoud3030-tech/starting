import React, { useState } from "react";
import { X, Banknote, CreditCard, Smartphone, Check, Calculator, Sparkles } from "lucide-react";

export default function PaymentModal({
  isOpen,
  onClose,
  totalAmount,
  currency,
  onCompletePayment,
  orderType,
  table,
  customer
}) {
  if (!isOpen) return null;

  const [paymentMethod, setPaymentMethod] = useState("cash"); // cash, card, mobile
  const [cashTendered, setCashTendered] = useState(totalAmount.toString());

  const tenderedNumber = parseFloat(cashTendered) || 0;
  const changeDue = Math.max(0, tenderedNumber - totalAmount);

  // Quick cash amounts
  const roundedTotals = [
    Math.ceil(totalAmount),
    Math.ceil(totalAmount / 5) * 5 || 5,
    Math.ceil(totalAmount / 10) * 10 || 10,
    50,
    100
  ].filter((v, i, a) => a.indexOf(v) === i && v >= totalAmount);

  const handleKeypad = (val) => {
    if (val === "C") {
      setCashTendered("");
    } else if (val === "exact") {
      setCashTendered(totalAmount.toFixed(2));
    } else {
      setCashTendered((prev) => prev + val);
    }
  };

  const handleConfirm = () => {
    onCompletePayment({
      paymentMethod,
      cashPaid: paymentMethod === "cash" ? tenderedNumber : totalAmount,
      changeDue: paymentMethod === "cash" ? changeDue : 0
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="font-extrabold text-base text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-emerald-400" />
              إتمام الدفع وإصدار الفاتورة
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {orderType === "dine_in" ? `محلي (${table})` : orderType === "takeaway" ? "طلب سفري" : `توصيل: ${customer || "عميل"}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-5">
          {/* Total display box */}
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-400">المبلغ المطلوب للدفع:</span>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-3xl font-black text-amber-400">
                {totalAmount.toFixed(2)}
              </span>
              <span className="text-sm font-bold text-slate-400">{currency}</span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300">اختر وسيلة الدفع:</label>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setPaymentMethod("cash")}
                className={`flex flex-col items-center justify-center p-3 rounded-2xl border gap-1.5 transition ${
                  paymentMethod === "cash"
                    ? "bg-emerald-500/15 border-emerald-500 text-emerald-400 shadow-md"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                <Banknote className="w-6 h-6" />
                <span className="font-bold text-xs">نقدي (Cash)</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod("card")}
                className={`flex flex-col items-center justify-center p-3 rounded-2xl border gap-1.5 transition ${
                  paymentMethod === "card"
                    ? "bg-blue-500/15 border-blue-500 text-blue-400 shadow-md"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                <CreditCard className="w-6 h-6" />
                <span className="font-bold text-xs">بطاقة (مدى / فيزا)</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod("mobile")}
                className={`flex flex-col items-center justify-center p-3 rounded-2xl border gap-1.5 transition ${
                  paymentMethod === "mobile"
                    ? "bg-purple-500/15 border-purple-500 text-purple-400 shadow-md"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                <Smartphone className="w-6 h-6" />
                <span className="font-bold text-xs">Apple Pay / محفظة</span>
              </button>
            </div>
          </div>

          {/* Cash details section if cash selected */}
          {paymentMethod === "cash" && (
            <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-grow">
                  <label className="text-xs text-slate-400 block mb-1">المبلغ المستلم من العميل:</label>
                  <input
                    type="number"
                    step="any"
                    value={cashTendered}
                    onChange={(e) => setCashTendered(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-base font-mono font-bold text-white focus:outline-none focus:border-emerald-500"
                    placeholder="0.00"
                  />
                </div>

                <div className="text-left">
                  <span className="text-xs text-slate-400 block mb-1">المتبقي (الفكة):</span>
                  <div className="font-mono text-xl font-black text-emerald-400 bg-slate-900 px-3 py-2 rounded-xl border border-slate-800 min-w-[100px] text-center">
                    {changeDue.toFixed(2)} {currency}
                  </div>
                </div>
              </div>

              {/* Quick Cash Buttons */}
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-[11px] text-slate-400">مبالغ سريعة:</span>
                <button
                  type="button"
                  onClick={() => setCashTendered(totalAmount.toFixed(2))}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono font-bold text-emerald-400"
                >
                  المبلغ بالضبط
                </button>
                {roundedTotals.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setCashTendered(amount.toString())}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono font-bold text-slate-200"
                  >
                    {amount} {currency}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="py-3 px-5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-400 font-bold text-xs transition"
          >
            إلغاء
          </button>

          <button
            type="button"
            disabled={paymentMethod === "cash" && tenderedNumber < totalAmount}
            onClick={handleConfirm}
            className="flex-grow py-3.5 px-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black text-sm shadow-xl shadow-emerald-500/25 flex items-center justify-center gap-2 transition active:scale-[0.98]"
          >
            <Check className="w-5 h-5 stroke-[3]" />
            <span>تأكيد الدفع وطباعة الفاتورة ↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}
