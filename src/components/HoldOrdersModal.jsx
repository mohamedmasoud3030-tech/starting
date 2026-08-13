import React from "react";
import { X, Play, Trash2, Clock, PauseCircle } from "lucide-react";

export default function HoldOrdersModal({
  isOpen,
  onClose,
  heldOrders,
  onRecallOrder,
  onDeleteHeldOrder,
  currency
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[80vh] animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PauseCircle className="w-5 h-5 text-amber-400" />
            <h2 className="font-extrabold text-base text-white">الطلبات المعلقة ({heldOrders.length})</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-grow space-y-3">
          {heldOrders.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              <p className="text-sm">لا توجد طلبات معلقة حالياً</p>
            </div>
          ) : (
            heldOrders.map((order, index) => {
              const totalItemsCount = order.cartItems.reduce((acc, item) => acc + item.quantity, 0);
              const subtotal = order.cartItems.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0);

              return (
                <div
                  key={order.id || index}
                  className="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 flex items-center justify-between gap-3 hover:border-amber-500/40 transition"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-amber-400 text-xs">
                        #{order.id}
                      </span>
                      <span className="text-xs font-bold text-slate-200">
                        {order.orderType === "dine_in"
                          ? `محلي (${order.selectedTable || "طاولة"})`
                          : order.orderType === "takeaway"
                          ? "سفري"
                          : `توصيل: ${order.customerName || "عميل"}`}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1 font-medium">
                      <span>{totalItemsCount} أصناف</span>
                      <span>•</span>
                      <span className="font-mono font-bold text-slate-300">
                        {subtotal.toFixed(2)} {currency}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {new Date(order.timestamp).toLocaleTimeString("ar-OM", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onRecallOrder(order)}
                      className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs flex items-center gap-1 shadow-md shadow-amber-500/20 transition"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>استرجاع</span>
                    </button>

                    <button
                      onClick={() => onDeleteHeldOrder(order.id)}
                      className="p-1.5 rounded-xl bg-slate-900 hover:bg-red-500/20 text-slate-500 hover:text-red-400 border border-slate-800 transition"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
