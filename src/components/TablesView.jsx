import React, { useState } from "react";
import {
  Users,
  Clock,
  Plus,
  Check,
  Ban,
  UtensilsCrossed,
  Sparkles,
  Layers,
  ChevronLeft
} from "lucide-react";

export default function TablesView({
  tables,
  onSelectTableForOrder,
  onUpdateTableStatus,
  currency
}) {
  const [selectedSection, setSelectedSection] = useState("all");

  const sections = [
    { id: "all", name: "كل الصالات والأقسام" },
    { id: "الصالة الرئيسية", name: "الصالة الرئيسية" },
    { id: "كبائن العائلات", name: "كبائن العائلات (VIP)" },
    { id: "التراس الخارجي", name: "التراس الخارجي" }
  ];

  const filteredTables = tables.filter(
    (t) => selectedSection === "all" || t.section === selectedSection
  );

  const availableCount = tables.filter((t) => t.status === "available").length;
  const occupiedCount = tables.filter((t) => t.status === "occupied").length;
  const reservedCount = tables.filter((t) => t.status === "reserved").length;

  return (
    <div className="h-[calc(100vh-62px)] bg-slate-950 p-4 flex flex-col gap-4 overflow-y-auto select-none">
      {/* Overview Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-semibold">إجمالي الطاولات</span>
            <h3 className="text-xl font-black text-white font-mono mt-0.5">{tables.length}</h3>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-xs text-emerald-400 font-semibold">طاولات شاغرة</span>
            <h3 className="text-xl font-black text-emerald-400 font-mono mt-0.5">{availableCount}</h3>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <Check className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-xs text-rose-400 font-semibold">طاولات مشغولة</span>
            <h3 className="text-xl font-black text-rose-400 font-mono mt-0.5">{occupiedCount}</h3>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-xs text-amber-400 font-semibold">طاولات محجوزة</span>
            <h3 className="text-xl font-black text-amber-400 font-mono mt-0.5">{reservedCount}</h3>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Sections Filter Tabs */}
      <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-2xl border border-slate-800 self-start">
        {sections.map((sec) => (
          <button
            key={sec.id}
            onClick={() => setSelectedSection(sec.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
              selectedSection === sec.id
                ? "bg-orange-500 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {sec.name}
          </button>
        ))}
      </div>

      {/* Tables Grid Layout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredTables.map((table) => {
          const isOccupied = table.status === "occupied";
          const isReserved = table.status === "reserved";
          const isAvailable = table.status === "available";

          return (
            <div
              key={table.id}
              className={`bg-slate-900 border rounded-3xl p-4 flex flex-col justify-between gap-4 transition-all duration-200 hover:shadow-lg ${
                isOccupied
                  ? "border-rose-500/50 bg-rose-950/10 hover:border-rose-500"
                  : isReserved
                  ? "border-amber-500/50 bg-amber-950/10 hover:border-amber-500"
                  : "border-slate-800 hover:border-emerald-500/60 bg-slate-900/90"
              }`}
            >
              {/* Top Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-base text-white">{table.name}</h3>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isOccupied
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          : isReserved
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      }`}
                    >
                      {isOccupied ? "مشغولة" : isReserved ? "محجوزة" : "شاغرة"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{table.section}</p>
                </div>

                <div className="flex items-center gap-1 text-xs text-slate-400 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800">
                  <Users className="w-3.5 h-3.5 text-orange-400" />
                  <span className="font-mono">{table.capacity} مقاعد</span>
                </div>
              </div>

              {/* Table Body Info */}
              <div className="bg-slate-950/70 p-3 rounded-2xl border border-slate-800/80 space-y-2 text-xs">
                {isOccupied ? (
                  <>
                    <div className="flex justify-between items-center text-slate-300">
                      <span>الفاتورة الحالية:</span>
                      <span className="font-mono font-black text-sm text-amber-400">
                        {table.amount ? Number(table.amount).toFixed(2) : "0.00"} {currency}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-slate-400 text-[11px]">
                      <span>وقت الجلوس:</span>
                      <span className="font-medium text-slate-300 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-400" />
                        {table.time || "15 دقيقة"}
                      </span>
                    </div>
                  </>
                ) : isReserved ? (
                  <div className="text-center py-1 text-amber-300 text-xs font-semibold">
                    {table.time || "محجوزة لطرف عائلة"}
                  </div>
                ) : (
                  <div className="text-center py-1 text-emerald-400 text-xs font-semibold">
                    جاهزة لاستقبال الزبائن والضيوف
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-1 border-t border-slate-800/60">
                {isAvailable && (
                  <button
                    onClick={() => onSelectTableForOrder(table)}
                    className="w-full py-2.5 px-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-orange-500/20 transition"
                  >
                    <Plus className="w-4 h-4 stroke-[3]" />
                    <span>بدء طلب جديد للطاولة</span>
                  </button>
                )}

                {isOccupied && (
                  <div className="grid grid-cols-2 gap-2 w-full">
                    <button
                      onClick={() => onSelectTableForOrder(table)}
                      className="py-2 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-1 transition"
                    >
                      <span>إضافة أصناف</span>
                    </button>
                    <button
                      onClick={() => onUpdateTableStatus(table.id, "available")}
                      className="py-2 px-2 rounded-xl bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white font-bold text-xs flex items-center justify-center gap-1 border border-rose-500/30 transition"
                    >
                      <span>تفريغ الطاولة</span>
                    </button>
                  </div>
                )}

                {isReserved && (
                  <div className="grid grid-cols-2 gap-2 w-full">
                    <button
                      onClick={() => onUpdateTableStatus(table.id, "occupied")}
                      className="py-2 px-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs flex items-center justify-center gap-1 transition"
                    >
                      <span>حضور العميل</span>
                    </button>
                    <button
                      onClick={() => onUpdateTableStatus(table.id, "available")}
                      className="py-2 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center justify-center gap-1 transition"
                    >
                      <span>إلغاء الحجز</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
