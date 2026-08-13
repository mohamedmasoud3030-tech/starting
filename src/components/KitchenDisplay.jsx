import React from "react";
import {
  ChefHat,
  Clock,
  CheckCircle,
  ArrowRight,
  Flame,
  UtensilsCrossed,
  ShoppingBag,
  Bike,
  Sparkles,
  RefreshCw,
  Bell,
  Eye
} from "lucide-react";

export default function KitchenDisplay({
  orders,
  onUpdateOrderStatus,
  currency,
  settings,
  onPlayBell,
  readOnly = false
}) {
  const activeOrders = orders.filter((o) => o.status !== "completed");
  const completedOrders = orders.filter((o) => o.status === "completed").slice(0, 5);

  const getStatusColumn = (status) => {
    return orders.filter((o) => o.status === status);
  };

  const getElapsedTime = (createdAt) => {
    const elapsedMinutes = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    return elapsedMinutes;
  };

  const renderOrderCard = (order) => {
    const elapsed = getElapsedTime(order.createdAt);
    const isLate = elapsed > 15;
    const isWarning = elapsed > 8 && elapsed <= 15;

    return (
      <div
        key={order.id}
        className={`bg-slate-900 border rounded-2xl p-3.5 space-y-3 transition-all duration-200 shadow-md ${
          isLate
            ? "border-red-500/80 bg-red-950/10 ring-1 ring-red-500/30"
            : isWarning
            ? "border-amber-500/60 bg-amber-950/10"
            : "border-slate-800 hover:border-slate-700"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono font-black text-sm text-white px-2 py-0.5 rounded-lg bg-slate-800 border border-slate-700">
              #{order.orderNumber || order.id}
            </span>
            <span
              className={`text-[11px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 ${
                order.type === "dine_in"
                  ? "bg-blue-500/20 text-blue-400"
                  : order.type === "takeaway"
                  ? "bg-amber-500/20 text-amber-400"
                  : "bg-purple-500/20 text-purple-400"
              }`}
            >
              {order.type === "dine_in" ? (
                <>
                  <UtensilsCrossed className="w-3 h-3" />
                  {order.table || "طاولة"}
                </>
              ) : order.type === "takeaway" ? (
                <>
                  <ShoppingBag className="w-3 h-3" />
                  سفري
                </>
              ) : (
                <>
                  <Bike className="w-3 h-3" />
                  توصيل
                </>
              )}
            </span>
          </div>

          {/* Timer */}
          <div
            className={`flex items-center gap-1 text-[11px] font-mono font-bold px-2 py-0.5 rounded-md ${
              isLate
                ? "bg-red-500 text-white animate-pulse"
                : isWarning
                ? "bg-amber-500/20 text-amber-300"
                : "bg-slate-800 text-slate-300"
            }`}
          >
            <Clock className="w-3 h-3" />
            <span>{elapsed} دقيقة</span>
          </div>
        </div>

        {/* Customer / Note */}
        {(order.customer || order.notes) && (
          <div className="text-[11px] bg-slate-950/80 p-2 rounded-xl border border-slate-800 space-y-1">
            {order.customer && (
              <p className="text-slate-300 font-semibold">العميل: {order.customer}</p>
            )}
            {order.notes && (
              <p className="text-amber-300 font-bold flex items-center gap-1">
                <span>⚠️ تنبيه المطبخ:</span>
                <span>{order.notes}</span>
              </p>
            )}
          </div>
        )}

        {/* Items List */}
        <div className="space-y-1.5 pt-1 border-t border-slate-800 text-xs">
          {order.items.map((item, idx) => (
            <div
              key={idx}
              className="flex items-start justify-between bg-slate-950/40 p-2 rounded-xl border border-slate-800/60"
            >
              <div>
                <span className="font-bold text-slate-100">{item.name}</span>
                {item.selectedOptions && item.selectedOptions.length > 0 && (
                  <div className="text-[10px] text-orange-400 font-semibold mt-0.5">
                    {item.selectedOptions.join(" + ")}
                  </div>
                )}
              </div>
              <span className="font-mono font-black text-xs px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
                ×{item.qty}
              </span>
            </div>
          ))}
        </div>

        {/* Status Advance Button or Read-Only indicator */}
        <div className="pt-2 border-t border-slate-800">
          {readOnly ? (
            <div className="py-1.5 px-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 text-[11px] font-semibold text-center flex items-center justify-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-slate-500" />
              <span>
                {order.status === "in_kitchen"
                  ? "معتمد في انتظار الطهي"
                  : order.status === "cooking"
                  ? "جاري التحضير بالمطبخ"
                  : order.status === "ready"
                  ? "جاهز للاستلام"
                  : "تم التسليم"}
              </span>
            </div>
          ) : (
            <>
              {order.status === "in_kitchen" && (
                <button
                  onClick={() => onUpdateOrderStatus(order.id, "cooking")}
                  className="w-full py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition"
                >
                  <Flame className="w-4 h-4" />
                  <span>بدء الطهي والتحضير</span>
                </button>
              )}

              {order.status === "cooking" && (
                <button
                  onClick={() => onUpdateOrderStatus(order.id, "ready")}
                  className="w-full py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-md shadow-amber-500/20 transition"
                >
                  <Bell className="w-4 h-4" />
                  <span>جاهز للتقديم (تنبيه الكاشير)</span>
                </button>
              )}

              {order.status === "ready" && (
                <button
                  onClick={() => onUpdateOrderStatus(order.id, "completed")}
                  className="w-full py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-500/20 transition"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>تم التسليم للعميل بنجاح ✓</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-62px)] bg-slate-950 p-4 flex flex-col gap-4 overflow-hidden select-none">
      {/* KDS Header Banner */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 px-4 py-3 rounded-2xl flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400">
            <ChefHat className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-extrabold text-sm text-white">
                شاشة المطبخ وإعداد الطلبات (KDS Mosaic)
              </h2>
              <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full font-bold">
                {activeOrders.length} طلبات قيد العمل
              </span>
              {readOnly && (
                <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  وضع المشاهدة فقط (كاشير)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              تحديث لحظي لخط سير الطلبات بين الكاشير وطهاة المطبخ
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onPlayBell}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition"
          >
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            <span>رنة جرس المطبخ</span>
          </button>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 flex-grow overflow-hidden">
        {/* Column 1: New / In Kitchen */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl flex flex-col overflow-hidden">
          <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse"></span>
              <span className="font-extrabold text-xs text-slate-200">طلبات جديدة معتمدة</span>
            </div>
            <span className="font-mono font-bold text-xs bg-slate-800 px-2 py-0.5 rounded-md text-blue-400">
              {getStatusColumn("in_kitchen").length}
            </span>
          </div>

          <div className="p-3 space-y-3 overflow-y-auto flex-grow">
            {getStatusColumn("in_kitchen").map(renderOrderCard)}
            {getStatusColumn("in_kitchen").length === 0 && (
              <p className="text-center py-12 text-xs text-slate-600">لا توجد طلبات جديدة</p>
            )}
          </div>
        </div>

        {/* Column 2: Cooking */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl flex flex-col overflow-hidden">
          <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
              <span className="font-extrabold text-xs text-slate-200">جاري الطهي والتحضير</span>
            </div>
            <span className="font-mono font-bold text-xs bg-slate-800 px-2 py-0.5 rounded-md text-amber-400">
              {getStatusColumn("cooking").length}
            </span>
          </div>

          <div className="p-3 space-y-3 overflow-y-auto flex-grow">
            {getStatusColumn("cooking").map(renderOrderCard)}
            {getStatusColumn("cooking").length === 0 && (
              <p className="text-center py-12 text-xs text-slate-600">المطبخ هادئ حالياً</p>
            )}
          </div>
        </div>

        {/* Column 3: Ready */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl flex flex-col overflow-hidden">
          <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
              <span className="font-extrabold text-xs text-slate-200">جاهز للاستلام / الصالة</span>
            </div>
            <span className="font-mono font-bold text-xs bg-slate-800 px-2 py-0.5 rounded-md text-emerald-400">
              {getStatusColumn("ready").length}
            </span>
          </div>

          <div className="p-3 space-y-3 overflow-y-auto flex-grow">
            {getStatusColumn("ready").map(renderOrderCard)}
            {getStatusColumn("ready").length === 0 && (
              <p className="text-center py-12 text-xs text-slate-600">لا توجد طلبات جاهزة</p>
            )}
          </div>
        </div>

        {/* Column 4: Recently Completed */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl flex flex-col overflow-hidden opacity-80">
          <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-500"></span>
              <span className="font-extrabold text-xs text-slate-200">أحدث الطلبات المسلمة</span>
            </div>
            <span className="font-mono font-bold text-xs bg-slate-800 px-2 py-0.5 rounded-md text-slate-400">
              {completedOrders.length}
            </span>
          </div>

          <div className="p-3 space-y-3 overflow-y-auto flex-grow">
            {completedOrders.map((order) => (
              <div
                key={order.id}
                className="bg-slate-900/60 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-400"
              >
                <div className="flex justify-between items-center font-mono">
                  <span className="text-slate-200 font-bold">#{order.orderNumber || order.id}</span>
                  <span className="text-emerald-400 font-semibold">مكتمل ✓</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400 truncate">
                  {order.items.map((i) => `${i.name} (x${i.qty})`).join("، ")}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
