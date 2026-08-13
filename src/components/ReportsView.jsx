import React, { useState, useEffect } from "react";
import {
  TrendingUp,
  DollarSign,
  ShoppingBag,
  CreditCard,
  Banknote,
  Calendar,
  Printer,
  Search,
  CheckCircle2,
  Award,
  Sparkles,
  FileText,
  ShieldAlert,
  User,
  Clock,
  History,
  Download,
  Filter
} from "lucide-react";
import { getAuditLogs, logAction } from "../utils/audit";

export default function ReportsView({
  orders,
  currency,
  settings,
  onViewReceipt,
  currentUser
}) {
  const [activeReportTab, setActiveReportTab] = useState("sales"); // sales, audit
  const [searchFilter, setSearchFilter] = useState("");

  // Audit Log state & filters
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditUserFilter, setAuditUserFilter] = useState("all");
  const [auditDateFilter, setAuditDateFilter] = useState("all"); // today, all, custom
  const [customDate, setCustomDate] = useState(new Date().toISOString().split("T")[0]);
  const [auditSearchQuery, setAuditSearchQuery] = useState("");

  useEffect(() => {
    setAuditLogs(getAuditLogs());
  }, [activeReportTab]);

  const completedOrders = orders.filter((o) => o.status === "completed" || o.paymentMethod !== "unpaid");

  const totalSales = completedOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalTax = completedOrders.reduce((sum, o) => sum + Number(o.tax || 0), 0);
  const totalDiscounts = completedOrders.reduce((sum, o) => sum + Number(o.discount || 0), 0);

  const cashSales = completedOrders
    .filter((o) => o.paymentMethod === "cash")
    .reduce((sum, o) => sum + Number(o.total || 0), 0);

  const cardSales = completedOrders
    .filter((o) => o.paymentMethod === "card" || o.paymentMethod === "mobile")
    .reduce((sum, o) => sum + Number(o.total || 0), 0);

  const avgOrderValue = completedOrders.length > 0 ? totalSales / completedOrders.length : 0;

  // Calculate top selling items
  const itemCounts = {};
  completedOrders.forEach((o) => {
    o.items.forEach((item) => {
      if (!itemCounts[item.name]) {
        itemCounts[item.name] = { name: item.name, qty: 0, revenue: 0 };
      }
      itemCounts[item.name].qty += item.qty;
      itemCounts[item.name].revenue += item.price * item.qty;
    });
  });

  const topItems = Object.values(itemCounts)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const filteredOrders = orders.filter((o) => {
    const query = searchFilter.toLowerCase();
    return (
      o.id.toLowerCase().includes(query) ||
      (o.orderNumber && o.orderNumber.toLowerCase().includes(query)) ||
      (o.customer && o.customer.toLowerCase().includes(query)) ||
      (o.table && o.table.toLowerCase().includes(query))
    );
  });

  const handlePrintZReport = () => {
    logAction("فتح تقرير Z", "تمت معاينة وطباعة تقرير نهاية الوردية Z-Report");
    window.print();
  };

  // Filter audit logs
  const todayStr = new Date().toISOString().split("T")[0];
  const filteredAuditLogs = auditLogs.filter((log) => {
    const logDate = log.timestamp ? log.timestamp.split("T")[0] : "";

    // Date filter
    if (auditDateFilter === "today" && logDate !== todayStr) return false;
    if (auditDateFilter === "custom" && logDate !== customDate) return false;

    // User filter
    if (auditUserFilter !== "all" && log.username !== auditUserFilter && log.userId !== auditUserFilter) return false;

    // Search query
    if (auditSearchQuery) {
      const q = auditSearchQuery.toLowerCase();
      const matchAction = (log.action || "").toLowerCase().includes(q);
      const matchDetails = (log.details || "").toLowerCase().includes(q);
      const matchUser = (log.username || "").toLowerCase().includes(q);
      if (!matchAction && !matchDetails && !matchUser) return false;
    }

    return true;
  });

  // Unique usernames from audit logs for filter dropdown
  const uniqueUsers = Array.from(new Set(auditLogs.map((l) => l.username).filter(Boolean)));

  const handleExportAuditLogs = () => {
    const blob = new Blob([JSON.stringify(filteredAuditLogs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-[calc(100vh-62px)] bg-slate-950 p-4 flex flex-col gap-4 overflow-y-auto select-none">
      {/* Header Bar with Tab Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
        <div>
          <h2 className="font-extrabold text-base text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            تقارير المبيعات والرقابة والتدقيق
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            متابعة دقيقة لحركة المبيعات، الوردية، وسجل تدقيق العمليات
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveReportTab("sales")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                activeReportTab === "sales"
                  ? "bg-orange-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              تقرير المبيعات والوردية
            </button>

            <button
              onClick={() => setActiveReportTab("audit")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                activeReportTab === "audit"
                  ? "bg-orange-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>سجل التدقيق (Audit Log)</span>
            </button>
          </div>

          {activeReportTab === "sales" && (
            <button
              onClick={handlePrintZReport}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-orange-500/20 transition"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة تقرير Z</span>
            </button>
          )}
        </div>
      </div>

      {activeReportTab === "sales" ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Sales */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">إجمالي المبيعات اليوم</span>
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <DollarSign className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black text-white font-mono">
                  {totalSales.toFixed(2)}
                </span>
                <span className="text-xs font-bold text-emerald-400">{currency}</span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">شامل الضريبة والخدمة</span>
            </div>

            {/* Orders count */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">عدد الطلبات المكتملة</span>
                <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
                  <ShoppingBag className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black text-white font-mono">
                  {completedOrders.length}
                </span>
                <span className="text-xs font-bold text-slate-400">طلب</span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">
                متوسط الطلب: {avgOrderValue.toFixed(2)} {currency}
              </span>
            </div>

            {/* Cash vs Card */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">النقدية بالكاشير (Cash)</span>
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Banknote className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black text-amber-400 font-mono">
                  {cashSales.toFixed(2)}
                </span>
                <span className="text-xs font-bold text-slate-400">{currency}</span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">مبالغ الدرج المتوقعة</span>
            </div>

            {/* Card Payments */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">دفع البطاقات والشبكة</span>
                <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                  <CreditCard className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black text-purple-400 font-mono">
                  {cardSales.toFixed(2)}
                </span>
                <span className="text-xs font-bold text-slate-400">{currency}</span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">مدى / فيزا / Apple Pay</span>
            </div>
          </div>

          {/* Two columns: Top Selling Items + Orders Ledger */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Top 5 Best Sellers */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-extrabold text-sm text-white flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-amber-400" />
                  الأصناف الأكثر مبيعاً
                </h3>
                <span className="text-[10px] text-slate-400">اليوم</span>
              </div>

              <div className="space-y-3 flex-grow">
                {topItems.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">لا توجد بيانات كافية بعد</p>
                ) : (
                  topItems.map((item, idx) => (
                    <div key={idx} className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-200">{item.name}</span>
                        <span className="font-mono font-bold text-amber-400">
                          {item.revenue.toFixed(2)} {currency}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1">
                        <span>الكمية المباعة: {item.qty} وجبات</span>
                        <span className="font-semibold text-emerald-400">#المركز {idx + 1}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Recent Orders Ledger Table */}
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="font-extrabold text-sm text-white flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-orange-400" />
                  سجل فواتير اليوم
                </h3>

                {/* Filter Search */}
                <div className="relative w-full sm:w-60">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="بحث برقم الطلب أو العميل..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-8 pl-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <div className="overflow-x-auto flex-grow">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                      <th className="pb-2">رقم الفاتورة</th>
                      <th className="pb-2">النوع</th>
                      <th className="pb-2">طريقة الدفع</th>
                      <th className="pb-2">المبلغ</th>
                      <th className="pb-2">الحالة</th>
                      <th className="pb-2 text-left">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredOrders.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="text-center py-8 text-slate-500">
                          لا توجد فواتير مطابقة
                        </td>
                      </tr>
                    ) : (
                      filteredOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-slate-950/40">
                          <td className="py-2.5 font-mono font-bold text-slate-200">
                            #{order.orderNumber || order.id}
                          </td>
                          <td className="py-2.5 text-slate-300">
                            {order.type === "dine_in"
                              ? `محلي (${order.table})`
                              : order.type === "takeaway"
                              ? "سفري"
                              : "توصيل"}
                          </td>
                          <td className="py-2.5">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                              {order.paymentMethod === "cash"
                                ? "💵 كاش"
                                : order.paymentMethod === "card"
                                ? "💳 بطاقة"
                                : "غير مدفوع"}
                            </span>
                          </td>
                          <td className="py-2.5 font-mono font-bold text-amber-400">
                            {Number(order.total).toFixed(2)} {currency}
                          </td>
                          <td className="py-2.5">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                order.status === "completed"
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : order.status === "ready"
                                  ? "bg-amber-500/20 text-amber-400"
                                  : "bg-blue-500/20 text-blue-400"
                              }`}
                            >
                              {order.status === "completed"
                                ? "مسلم ✓"
                                : order.status === "ready"
                                ? "جاهز"
                                : "قيد التحضير"}
                            </span>
                          </td>
                          <td className="py-2.5 text-left">
                            <button
                              onClick={() => onViewReceipt(order)}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition"
                            >
                              معاينة
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* Audit Log Tab */
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-4 flex flex-col flex-grow">
          {/* Audit Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              {/* Date filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-semibold">التاريخ:</span>
                <select
                  value={auditDateFilter}
                  onChange={(e) => setAuditDateFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 font-medium focus:outline-none focus:border-orange-500"
                >
                  <option value="all">كل التواريخ</option>
                  <option value="today">اليوم فقط</option>
                  <option value="custom">تاريخ محدد...</option>
                </select>
                {auditDateFilter === "custom" && (
                  <input
                    type="date"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-orange-500"
                  />
                )}
              </div>

              {/* User filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-semibold">المستخدم:</span>
                <select
                  value={auditUserFilter}
                  onChange={(e) => setAuditUserFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 font-medium focus:outline-none focus:border-orange-500"
                >
                  <option value="all">كل المستخدمين</option>
                  {uniqueUsers.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              {/* Keyword search */}
              <div className="relative w-48 sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="بحث في تفاصيل العملية..."
                  value={auditSearchQuery}
                  onChange={(e) => setAuditSearchQuery(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pr-8 pl-2 py-1 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-[11px] font-mono">
                {filteredAuditLogs.length} سجل
              </span>
              <button
                onClick={handleExportAuditLogs}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 transition border border-slate-700"
              >
                <Download className="w-3 h-3" />
                <span>تصدير السجل</span>
              </button>
            </div>
          </div>

          {/* Audit Logs Table */}
          <div className="overflow-x-auto flex-grow rounded-xl border border-slate-800">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-bold">
                  <th className="p-3">الوقت والتاريخ</th>
                  <th className="p-3">المستخدم</th>
                  <th className="p-3">نوع العملية</th>
                  <th className="p-3">التفاصيل والبيانات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900">
                {filteredAuditLogs.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="text-center py-12 text-slate-500">
                      لا توجد سجلات تدقيق مطابقة للشروط
                    </td>
                  </tr>
                ) : (
                  filteredAuditLogs.map((log) => {
                    const dateFormatted = new Date(log.timestamp).toLocaleString("ar-OM", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit"
                    });

                    return (
                      <tr key={log.id} className="hover:bg-slate-950/40 transition">
                        <td className="p-3 whitespace-nowrap text-slate-300 font-mono text-[11px]">
                          {dateFormatted}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-200">{log.username}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                              {log.role}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-orange-500/15 text-orange-300 border border-orange-500/30">
                            {log.action}
                          </span>
                        </td>
                        <td className="p-3 text-slate-300 max-w-md font-sans">
                          {log.details}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
