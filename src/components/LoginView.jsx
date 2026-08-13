import React, { useState } from "react";
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  LogIn,
  ShieldCheck,
  ChefHat,
  CreditCard,
  AlertCircle,
  Store
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { playSound } from "../utils/audio";

export default function LoginView() {
  const { login, error: authError } = useAuth();
  const { settings, logAuditAction } = useData();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLocalError("");
    setIsSubmitting(true);

    try {
      const cleanEmail = email.trim();
      const res = await login(cleanEmail, password);
      if (res?.success) {
        playSound("success");
        logAuditAction(
          "تسجيل الدخول",
          `تسجيل دخول ناجح للمستخدم: ${res.profile?.full_name || res.profile?.username} (${res.profile?.role})`
        );
      }
    } catch (err) {
      playSound("remove");
      setLocalError(err.message || "فشل تسجيل الدخول. يرجى التحقق من البيانات.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickFill = (demoEmail, demoPass) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setLocalError("");
    playSound("beep");
  };

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden select-none font-sans"
      dir="rtl"
    >
      <div className="absolute top-1/4 -right-20 w-96 h-96 bg-orange-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 -left-20 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-md z-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-gradient-to-tr from-orange-600 to-amber-500 shadow-xl shadow-orange-500/25 text-3xl mb-1 ring-4 ring-orange-500/20">
            🍔
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            {settings?.restaurantName || "RestoPOS Pro"}
          </h1>
          <p className="text-xs text-slate-400 font-medium flex items-center justify-center gap-1.5">
            <Store className="w-3.5 h-3.5 text-orange-400" />
            {settings?.branchName || "الفرع الرئيسي"} · نظام الكاشير السحابي
          </p>
        </div>

        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-base font-extrabold text-white flex items-center gap-2">
              <LogIn className="w-4 h-4 text-orange-400" />
              تسجيل الدخول للنظام (Supabase Auth)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              أدخل البريد الإلكتروني وكلمة المرور الخاصة بوردية العمل
            </p>
          </div>

          {(localError || authError) && (
            <div className="bg-rose-500/15 border border-rose-500/30 text-rose-300 p-3 rounded-2xl flex items-start gap-2.5 text-xs animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <span>{localError || authError}</span>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-300 font-bold mb-1.5">
                البريد الإلكتروني / اسم الحساب:
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="admin@restopos.app أو cashier@restopos.app"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl pr-10 pl-3 py-3 text-slate-100 text-xs md:text-sm placeholder-slate-500 focus:outline-none focus:border-orange-500 transition"
                  required
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-bold mb-1.5">
                كلمة المرور:
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl pr-10 pl-10 py-3 text-slate-100 text-xs md:text-sm placeholder-slate-500 focus:outline-none focus:border-orange-500 transition font-mono"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-white font-black text-sm shadow-xl shadow-orange-500/25 flex items-center justify-center gap-2 transition active:scale-[0.98] mt-2"
            >
              {isSubmitting ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <LogIn className="w-4 h-4 stroke-[2.5]" />
                  <span>دخول النظام ↵</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-3 border-t border-slate-800/80 space-y-2">
            <span className="text-[11px] text-slate-400 font-semibold block text-center">
              حسابات سريعة للتجربة:
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleQuickFill("admin@restopos.app", "123456")}
                className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-center transition group"
              >
                <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-amber-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>المدير</span>
                </div>
                <span className="text-[9px] text-slate-400 font-mono block mt-0.5 group-hover:text-slate-300">
                  123456
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill("cashier@restopos.app", "123456")}
                className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-center transition group"
              >
                <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-emerald-400">
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>الكاشير</span>
                </div>
                <span className="text-[9px] text-slate-400 font-mono block mt-0.5 group-hover:text-slate-300">
                  123456
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill("kitchen@restopos.app", "123456")}
                className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-center transition group"
              >
                <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-blue-400">
                  <ChefHat className="w-3.5 h-3.5" />
                  <span>المطبخ</span>
                </div>
                <span className="text-[9px] text-slate-400 font-mono block mt-0.5 group-hover:text-slate-300">
                  123456
                </span>
              </button>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-500 text-center">
          RestoPOS Pro · نظام إدارة المطاعم السحابي Supabase + Vercel v3.0
        </p>
      </div>
    </div>
  );
}
