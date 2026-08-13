import React, { useState, useEffect } from "react";
import {
  Utensils,
  LayoutGrid,
  ChefHat,
  BarChart3,
  Settings,
  PauseCircle,
  Volume2,
  VolumeX,
  Clock,
  Sparkles,
  Maximize2,
  Minimize2,
  Store,
  LogOut,
  ShieldCheck,
  User
} from "lucide-react";

export default function Header({
  activeTab,
  setActiveTab,
  heldOrdersCount,
  openHeldOrders,
  settings,
  soundEnabled,
  setSoundEnabled,
  pendingKitchenCount,
  currentUser,
  onLogout
}) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const allNavItems = [
    { id: "pos", label: "نقطة البيع (الكاشير)", icon: Utensils, badge: null, roles: ["admin", "cashier"] },
    { id: "tables", label: "إدارة الطاولات", icon: LayoutGrid, badge: null, roles: ["admin", "cashier"] },
    { id: "kitchen", label: "شاشة المطبخ KDS", icon: ChefHat, badge: pendingKitchenCount > 0 ? pendingKitchenCount : null, roles: ["admin", "cashier", "kitchen"] },
    { id: "reports", label: "تقارير الوردية", icon: BarChart3, badge: null, roles: ["admin"] },
    { id: "settings", label: "الإعدادات والمنيو", icon: Settings, badge: null, roles: ["admin"] },
  ];

  const userRole = currentUser?.role || "admin";
  const visibleNavItems = allNavItems.filter((item) => item.roles.includes(userRole));

  const roleLabelMap = {
    admin: { label: "المدير العام", badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
    cashier: { label: "كاشير الصالة", badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
    kitchen: { label: "شيف المطبخ", badgeClass: "bg-blue-500/20 text-blue-300 border-blue-500/30" }
  };

  const currentRoleInfo = roleLabelMap[userRole] || { label: userRole, badgeClass: "bg-slate-800 text-slate-300 border-slate-700" };

  const firstLetter = (currentUser?.fullName || currentUser?.username || "م").charAt(0);

  return (
    <header className="bg-slate-900/90 backdrop-blur-md border-b border-slate-800 sticky top-0 z-30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-slate-100 select-none">
      {/* Brand & Store Info */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/20 text-white font-black text-xl">
          🍔
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-extrabold text-base tracking-tight text-white flex items-center gap-1.5">
              {settings.restaurantName}
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30">
                مباشر ●
              </span>
            </h1>
          </div>
          <p className="text-xs text-slate-400 flex items-center gap-1 font-medium">
            <Store className="w-3 h-3 text-orange-400" />
            {settings.branchName}
          </p>
        </div>
      </div>

      {/* Main Navigation Tabs (Filtered by Role) */}
      {userRole !== "kitchen" ? (
        <nav className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-xl border border-slate-800/80">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs md:text-sm font-semibold transition-all duration-150 ${
                  isActive
                    ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/25 scale-[1.02]"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
                {item.badge && (
                  <span className="animate-pulse bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      ) : (
        <div className="flex items-center gap-2 bg-blue-500/15 border border-blue-500/30 px-3.5 py-1.5 rounded-xl text-xs font-bold text-blue-300">
          <ChefHat className="w-4 h-4" />
          <span>شاشة أوامر المطبخ KDS (مخصصة للشيف)</span>
        </div>
      )}

      {/* Right Controls: User Profile, Held Orders, Clock, Sound, Fullscreen, Logout */}
      <div className="flex items-center gap-2.5">
        {/* Held Orders Button (for cashier & admin) */}
        {heldOrdersCount > 0 && userRole !== "kitchen" && (
          <button
            onClick={openHeldOrders}
            className="flex items-center gap-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 px-3 py-1.5 rounded-lg text-xs font-bold transition animate-bounce"
          >
            <PauseCircle className="w-4 h-4" />
            <span>طلبات معلقة ({heldOrdersCount})</span>
          </button>
        )}

        {/* Live Clock */}
        <div className="hidden xl:flex items-center gap-1.5 bg-slate-800/60 px-2.5 py-1.5 rounded-lg border border-slate-700/50 text-xs font-mono text-slate-300">
          <Clock className="w-3.5 h-3.5 text-orange-400" />
          <span>
            {currentTime.toLocaleTimeString("ar-OM", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>

        {/* Sound Toggle */}
        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          title={soundEnabled ? "كتم الصوت" : "تفعيل الصوت"}
          className={`p-2 rounded-lg border transition ${
            soundEnabled
              ? "bg-slate-800/80 border-slate-700 text-orange-400 hover:bg-slate-700"
              : "bg-slate-800/40 border-slate-800 text-slate-500 hover:text-slate-400"
          }`}
        >
          {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>

        {/* Fullscreen Button */}
        <button
          onClick={toggleFullscreen}
          title="شاشة كاملة"
          className="p-2 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white transition"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        {/* Current User Badge & Logout */}
        <div className="flex items-center gap-2 bg-slate-950/80 p-1 pr-2.5 rounded-xl border border-slate-800">
          <div className="text-right">
            <span className="font-bold text-xs text-slate-200 block line-clamp-1">
              {currentUser?.fullName || currentUser?.username || "مستخدم"}
            </span>
            <span className={`text-[9px] px-1.5 py-0.2 rounded border font-semibold inline-block mt-0.5 ${currentRoleInfo.badgeClass}`}>
              {currentRoleInfo.label}
            </span>
          </div>

          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-orange-500 to-amber-500 text-white font-bold text-xs flex items-center justify-center shadow-sm">
            {firstLetter}
          </div>

          <button
            onClick={onLogout}
            title="تسجيل الخروج"
            className="w-7 h-7 rounded-full bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-700 flex items-center justify-center transition"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
