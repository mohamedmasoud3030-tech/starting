import React from "react";
import { Printer, Download, CheckCircle2, X } from "lucide-react";

export default function ThermalReceipt({ order, settings, onClose, onNewOrder }) {
  if (!order) return null;

  const handlePrint = () => {
    window.print();
  };

  const formattedDate = new Date(order.createdAt || Date.now()).toLocaleString("ar-OM", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[95vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Top bar */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-bold text-sm text-white">تم الدفع وإصدار الفاتورة بنجاح</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable Area / Receipt Preview */}
        <div className="p-4 overflow-y-auto flex-grow flex justify-center bg-slate-950/40">
          <div
            id="printable-receipt"
            className="w-full max-w-[340px] bg-white text-black p-5 rounded-xl shadow-xl font-mono text-[11px] leading-relaxed border border-slate-200 select-all"
            dir="rtl"
          >
            {/* Store Header */}
            <div className="text-center pb-3 border-b-2 border-dashed border-gray-400">
              <div className="text-2xl mb-1">🍔</div>
              <h2 className="font-black text-base text-gray-900 leading-tight">
                {settings.restaurantName}
              </h2>
              <p className="text-[10px] text-gray-600 mt-0.5">{settings.branchName}</p>
              <p className="text-[10px] text-gray-600">{settings.address}</p>
              <p className="text-[10px] text-gray-600">هاتف: {settings.phone}</p>
              <p className="text-[10px] font-bold text-gray-800 mt-1">
                الرقم الضريبي: {settings.taxNumber}
              </p>
              <div className="mt-1.5 inline-block bg-gray-900 text-white font-bold px-2.5 py-0.5 rounded text-[10px]">
                فاتورة ضريبية مبسطة
              </div>
            </div>

            {/* Order Meta */}
            <div className="py-2 border-b border-dashed border-gray-400 space-y-0.5 text-[10px]">
              <div className="flex justify-between">
                <span className="font-bold">رقم الفاتورة:</span>
                <span className="font-black">#{order.orderNumber || order.id}</span>
              </div>
              <div className="flex justify-between">
                <span>التاريخ والوقت:</span>
                <span>{formattedDate}</span>
              </div>
              <div className="flex justify-between">
                <span>نوع الطلب:</span>
                <span className="font-bold">
                  {order.type === "dine_in"
                    ? `محلي (${order.table || "طاولة"})`
                    : order.type === "takeaway"
                    ? "سفري (Takeaway)"
                    : `توصيل (${order.customer || "عميل"})`}
                </span>
              </div>
              <div className="flex justify-between">
                <span>طريقة الدفع:</span>
                <span className="font-bold">
                  {order.paymentMethod === "cash"
                    ? "نقدي (Cash)"
                    : order.paymentMethod === "card"
                    ? "بطاقة بنكية (Card/Mada)"
                    : "دفع إلكتروني"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>الكاشير:</span>
                <span>أحمد السعيد</span>
              </div>
            </div>

            {/* Items Table */}
            <div className="py-2 border-b-2 border-dashed border-gray-400">
              <div className="grid grid-cols-12 font-bold text-[10px] pb-1 border-b border-gray-300 text-gray-700">
                <span className="col-span-6">الصنف</span>
                <span className="col-span-2 text-center">الكمية</span>
                <span className="col-span-4 text-left">المجموع</span>
              </div>

              <div className="pt-1.5 space-y-1.5">
                {order.items &&
                  order.items.map((item, i) => (
                    <div key={i} className="text-[10px]">
                      <div className="grid grid-cols-12">
                        <span className="col-span-6 font-bold text-gray-900 leading-tight">
                          {item.name}
                        </span>
                        <span className="col-span-2 text-center font-bold">{item.qty}</span>
                        <span className="col-span-4 text-left font-bold font-mono">
                          {(item.price * item.qty).toFixed(2)} {settings.currency}
                        </span>
                      </div>
                      {item.selectedOptions && item.selectedOptions.length > 0 && (
                        <div className="text-[9px] text-gray-500 pr-2">
                          {item.selectedOptions.join("، ")}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>

            {/* Financial Summary */}
            <div className="py-2 border-b-2 border-dashed border-gray-400 space-y-1 text-[10px]">
              <div className="flex justify-between">
                <span>المجموع الخاضع للضريبة:</span>
                <span className="font-mono">{(order.subtotal - (order.discount || 0)).toFixed(2)} {settings.currency}</span>
              </div>

              {order.discount > 0 && (
                <div className="flex justify-between text-gray-700">
                  <span>الخصم الممنوح:</span>
                  <span className="font-mono">-{Number(order.discount).toFixed(2)} {settings.currency}</span>
                </div>
              )}

              <div className="flex justify-between">
                <span>ضريبة القيمة المضافة ({settings.taxRate}%):</span>
                <span className="font-mono">{Number(order.tax).toFixed(2)} {settings.currency}</span>
              </div>

              <div className="flex justify-between text-xs font-black pt-1 border-t border-gray-300 text-gray-950">
                <span>الإجمالي شامل الضريبة:</span>
                <span className="font-mono text-sm font-black">
                  {Number(order.total).toFixed(2)} {settings.currency}
                </span>
              </div>

              {order.cashPaid && (
                <>
                  <div className="flex justify-between pt-1 text-[9px] text-gray-600">
                    <span>المبلغ المستلم:</span>
                    <span className="font-mono">{Number(order.cashPaid).toFixed(2)} {settings.currency}</span>
                  </div>
                  <div className="flex justify-between text-[9px] text-gray-600">
                    <span>المبلغ المتبقي:</span>
                    <span className="font-mono">{Number(order.changeDue || 0).toFixed(2)} {settings.currency}</span>
                  </div>
                </>
              )}
            </div>

            {/* QR Code and Footer */}
            <div className="pt-3 text-center space-y-2">
              {/* Simulated QR Code */}
              <div className="flex justify-center">
                <div className="p-1.5 bg-gray-50 border border-gray-300 rounded inline-block">
                  <svg className="w-20 h-20" viewBox="0 0 100 100" fill="currentColor">
                    {/* QR Code Matrix Pattern */}
                    <rect x="0" y="0" width="30" height="30" fill="#111827" />
                    <rect x="5" y="5" width="20" height="20" fill="white" />
                    <rect x="10" y="10" width="10" height="10" fill="#111827" />
                    <rect x="70" y="0" width="30" height="30" fill="#111827" />
                    <rect x="75" y="5" width="20" height="20" fill="white" />
                    <rect x="80" y="10" width="10" height="10" fill="#111827" />
                    <rect x="0" y="70" width="30" height="30" fill="#111827" />
                    <rect x="5" y="75" width="20" height="20" fill="white" />
                    <rect x="10" y="80" width="10" height="10" fill="#111827" />
                    <rect x="40" y="10" width="10" height="10" fill="#111827" />
                    <rect x="55" y="10" width="10" height="10" fill="#111827" />
                    <rect x="40" y="30" width="20" height="10" fill="#111827" />
                    <rect x="70" y="40" width="10" height="20" fill="#111827" />
                    <rect x="40" y="50" width="10" height="10" fill="#111827" />
                    <rect x="55" y="50" width="20" height="10" fill="#111827" />
                    <rect x="40" y="70" width="25" height="10" fill="#111827" />
                    <rect x="75" y="70" width="15" height="25" fill="#111827" />
                  </svg>
                </div>
              </div>
              <p className="text-[9px] text-gray-500 font-sans">
                امسح الرمز للتحقق من الفاتورة الإلكترونية
              </p>

              <p className="text-[10px] font-bold text-gray-800 font-sans">
                {settings.footerNote}
              </p>

              {/* Barcode representation */}
              <div className="pt-1 flex justify-center">
                <div className="h-6 w-48 bg-[repeating-linear-gradient(90deg,#111,#111_2px,#fff_2px,#fff_4px,#111_4px,#111_7px,#fff_7px,#fff_9px)]"></div>
              </div>
              <p className="text-[8px] text-gray-400 font-mono tracking-widest">
                * {order.orderNumber || order.id} *
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 grid grid-cols-2 gap-3">
          <button
            onClick={handlePrint}
            className="py-3 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 transition"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة الإيصال (Print)</span>
          </button>

          <button
            onClick={onNewOrder}
            className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-2 transition"
          >
            <span>طلب جديد ↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}
