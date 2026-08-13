import React from "react";
import {
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  PauseCircle,
  CreditCard,
  Percent,
  UtensilsCrossed,
  ShoppingBag as BagIcon,
  Bike,
  Sparkles,
  ChevronDown
} from "lucide-react";

export default function Cart({
  cartItems,
  orderType,
  setOrderType,
  selectedTable,
  setSelectedTable,
  tables,
  onUpdateQty,
  onRemoveItem,
  onClearCart,
  onHoldOrder,
  onOpenPayment,
  currency,
  settings,
  discountPercent,
  setDiscountPercent,
  customerName,
  setCustomerName
}) {
  // Calculations
  const subtotal = cartItems.reduce(
    (acc, item) => acc + item.unitPrice * item.quantity,
    0
  );
  const discountAmount = (subtotal * discountPercent) / 100;
  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const taxAmount = (taxableAmount * (settings.taxRate || 0)) / 100;
  const grandTotal = taxableAmount + taxAmount;

  return (
    <aside className="w-full lg:w-96 flex-shrink-0 bg-slate-900 border-t lg:border-t-0 lg:border-r border-slate-800 flex flex-col h-full overflow-hidden select-none">
      {/* Order Type Header */}
      <div className="p-3 bg-slate-950/60 border-b border-slate-800 space-y-2.5">
        <div className="grid grid-cols-3 gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setOrderType("takeaway")}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition ${
              orderType === "takeaway"
                ? "bg-orange-500 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <BagIcon className="w-3.5 h-3.5" />
            <span>سفري</span>
          </button>

          <button
            onClick={() => setOrderType("dine_in")}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition ${
              orderType === "dine_in"
                ? "bg-orange-500 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <UtensilsCrossed className="w-3.5 h-3.5" />
            <span>صالة ومحلي</span>
          </button>

          <button
            onClick={() => setOrderType("delivery")}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition ${
              orderType === "delivery"
                ? "bg-orange-500 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Bike className="w-3.5 h-3.5" />
            <span>توصيل</span>
          </button>
        </div>

        {/* Dynamic fields based on order type */}
        {orderType === "dine_in" && (
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5">
            <span className="text-xs text-slate-400 font-medium">الطاولة:</span>
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              className="bg-transparent text-xs font-bold text-orange-400 flex-grow focus:outline-none cursor-pointer"
            >
              <option value="" className="bg-slate-900 text-white">اختر الطاولة...</option>
              {tables.map((t) => (
                <option key={t.id} value={t.name} className="bg-slate-900 text-white">
                  {t.name} ({t.section}) {t.status === "occupied" ? "🔴 مشغولة" : "🟢 متاحة"}
                </option>
              ))}
            </select>
          </div>
        )}

        {orderType === "delivery" && (
          <input
            type="text"
            placeholder="اسم العميل ورقم الهاتف..."
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500"
          />
        )}
      </div>

      {/* Cart Items List */}
      <div className="flex-grow overflow-y-auto p-3 space-y-2">
        {cartItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <div className="w-16 h-16 rounded-3xl bg-slate-950 flex items-center justify-center mb-3 text-2xl border border-slate-800/80">
              🛒
            </div>
            <p className="font-bold text-sm text-slate-300">السلة فارغة</p>
            <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
              اضغط على أي وجبة أو مشروب من القائمة لإضافتها للطلب
            </p>
          </div>
        ) : (
          cartItems.map((item, index) => (
            <div
              key={index}
              className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-2.5 transition hover:border-slate-700"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-grow">
                  <h4 className="font-bold text-xs text-slate-200 line-clamp-1">
                    {item.product.name}
                  </h4>
                  {item.selectedOptions && item.selectedOptions.length > 0 && (
                    <div className="text-[10px] text-orange-400/90 mt-0.5 space-y-0.5">
                      {item.selectedOptions.map((opt, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <span>•</span>
                          <span>{opt}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {item.notes && (
                    <p className="text-[10px] text-amber-300 italic mt-0.5">
                      ملاحظة: {item.notes}
                    </p>
                  )}
                </div>

                <div className="text-left font-mono font-bold text-xs text-amber-400">
                  {(item.unitPrice * item.quantity).toFixed(2)} {currency}
                </div>
              </div>

              {/* Quantity controls & Delete */}
              <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-900">
                <button
                  onClick={() => onRemoveItem(index)}
                  className="text-slate-500 hover:text-red-400 p-1 transition"
                  title="حذف الصنف"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <div className="flex items-center gap-1.5 bg-slate-900 px-1.5 py-0.5 rounded-lg border border-slate-800">
                  <button
                    onClick={() => onUpdateQty(index, item.quantity - 1)}
                    className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-white"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-6 text-center font-mono font-bold text-xs text-white">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => onUpdateQty(index, item.quantity + 1)}
                    className="w-5 h-5 rounded flex items-center justify-center text-orange-400 hover:text-orange-300"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Quick Discounts Bar */}
      {cartItems.length > 0 && (
        <div className="px-3 py-2 bg-slate-950/40 border-t border-slate-800/80 flex items-center justify-between gap-1 text-[11px]">
          <span className="text-slate-400 font-medium flex items-center gap-1">
            <Percent className="w-3 h-3 text-orange-400" />
            خصم سريع:
          </span>
          <div className="flex items-center gap-1">
            {[0, 5, 10, 15, 20].map((p) => (
              <button
                key={p}
                onClick={() => setDiscountPercent(p)}
                className={`px-2 py-0.5 rounded-md font-bold transition ${
                  discountPercent === p
                    ? "bg-amber-500 text-slate-950 font-black shadow-sm"
                    : "bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {p === 0 ? "بدون" : `${p}%`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bill Summary */}
      <div className="p-3 bg-slate-950 border-t border-slate-800 space-y-1.5 text-xs">
        <div className="flex justify-between text-slate-400">
          <span>المجموع الفرعي:</span>
          <span className="font-mono">{subtotal.toFixed(2)} {currency}</span>
        </div>

        {discountPercent > 0 && (
          <div className="flex justify-between text-amber-400 font-semibold">
            <span>الخصم ({discountPercent}%):</span>
            <span className="font-mono">-{discountAmount.toFixed(2)} {currency}</span>
          </div>
        )}

        <div className="flex justify-between text-slate-400">
          <span>ضريبة القيمة المضافة ({settings.taxRate}%):</span>
          <span className="font-mono">{taxAmount.toFixed(2)} {currency}</span>
        </div>

        <div className="flex justify-between items-baseline pt-2 border-t border-slate-800 text-white">
          <span className="font-black text-sm">الإجمالي النهائي:</span>
          <div className="flex items-baseline gap-1">
            <span className="font-mono font-black text-xl text-amber-400">
              {grandTotal.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400 font-bold">{currency}</span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="p-3 bg-slate-950 border-t border-slate-800/80 flex flex-col gap-2">
        <button
          disabled={cartItems.length === 0}
          onClick={onOpenPayment}
          className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black text-sm shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition active:scale-[0.98]"
        >
          <CreditCard className="w-4 h-4 stroke-[2.5]" />
          <span>الدفع وإصدار الفاتورة ({grandTotal.toFixed(2)} {currency})</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={cartItems.length === 0}
            onClick={onHoldOrder}
            className="py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-amber-300 text-xs font-bold flex items-center justify-center gap-1.5 transition"
          >
            <PauseCircle className="w-3.5 h-3.5" />
            <span>تعليق الطلب</span>
          </button>

          <button
            disabled={cartItems.length === 0}
            onClick={onClearCart}
            className="py-2 px-3 rounded-xl bg-slate-900 hover:bg-red-500/10 border border-slate-800 hover:border-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-slate-400 hover:text-red-400 text-xs font-bold flex items-center justify-center gap-1.5 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>إلغاء الطلب</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
