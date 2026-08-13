// src/components/ProtectedRoute.jsx
// Role-based route guard for RestoPOS Pro

import React from "react";
import { useAuth } from "../context/AuthContext";
import LoginView from "./LoginView";
import { ShieldAlert } from "lucide-react";

export default function ProtectedRoute({ children, allowedRoles }) {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-200">
        <div className="w-12 h-12 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin mb-4"></div>
        <p className="font-bold text-sm text-slate-400">جاري التحقق من الجلسة وتحديث البيانات السحابية...</p>
      </div>
    );
  }

  if (!session && !profile) {
    return <LoginView />;
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(profile?.role)) {
    return (
      <div className="h-[calc(100vh-62px)] bg-slate-950 flex flex-col items-center justify-center p-6 text-center select-none" dir="rtl">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center text-2xl mb-3 shadow-lg shadow-rose-500/10">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-black text-white">غير مصرح لك بالوصول إلى هذه الشاشة</h2>
        <p className="text-xs text-slate-400 mt-1 max-w-sm">
          حسابك الحالي ({profile?.role}) لا يمتلك الصلاحيات الكافية لعرض هذه الصفحة. يرجى مراجعة إدارة المطعم.
        </p>
      </div>
    );
  }

  return children;
}
