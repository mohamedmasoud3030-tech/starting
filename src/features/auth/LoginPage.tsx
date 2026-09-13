import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/app/authContext";
import { isSupabaseConfigured } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

import { authLoginErrorMessage } from "./authErrors";

/**
 * What the product does, stated as capabilities an office owner recognizes.
 * Kept factual (mirrors the shipped feature set — see PRODUCT_SPEC §3), not
 * aspirational: every line below maps to a real screen, not a promise.
 */
const CAPABILITIES: ReadonlyArray<{ title: string; detail: string }> = [
  {
    title: "عروض الأسعار والمناسبات",
    detail: "من عرض السعر حتى التنفيذ والإغلاق",
  },
  {
    title: "المخزن والمعدات",
    detail: "حجز وإرسال وإرجاع مع تسوية دقيقة",
  },
  {
    title: "المواد والمشتريات",
    detail: "أرصدة استهلاكية وأوامر شراء",
  },
  {
    title: "المدفوعات والفواتير",
    detail: "دفعات العميل والفواتير والربح الفعلي",
  },
];

/** Small brand mark used on both sides of the split screen. */
function BrandMark({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`flex flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-900 text-white shadow-card-lg ring-1 ring-white/20 ${className ?? ""}`}
    >
      <Sparkles className="h-1/2 w-1/2" />
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      await navigate({ to: "/home" });
    } catch (err) {
      setError(authLoginErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh bg-white lg:bg-transparent">
      {/* Theme switch is available even before login. */}
      <div className="absolute end-4 top-4 z-20">
        <ThemeToggle />
      </div>
      {/* Sign-in form — the single primary action. Sits on the leading side in
          RTL so the owner starts typing immediately, without hunting. */}
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-8 sm:px-8 lg:px-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -start-32 h-96 w-96 rounded-full bg-brand-100/60 blur-3xl lg:bg-brand-100/80"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -end-24 h-[26rem] w-[26rem] rounded-full bg-sky-100/70 blur-3xl"
        />

        <div className="relative w-full max-w-md">
          {/* Logo + product name — always visible. */}
          <div className="mb-6 flex items-center gap-3 lg:mb-8">
            <BrandMark className="h-12 w-12" />
            <div className="leading-tight">
              <p className="text-lg font-black text-slate-900">
                نظام إدارة الضيافة
              </p>
              <p className="text-sm text-slate-500">
                من العرض والعربون لحد الإقفال
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-card-lg">
            <div className="h-1.5 bg-gradient-to-l from-brand-900 via-brand-600 to-gold-400" />

            <div className="p-6 sm:p-8">
              <h1 className="text-2xl font-black leading-tight text-slate-900 sm:text-[1.7rem]">
                مرحباً بعودتك
              </h1>
              <p className="mt-2 text-base leading-7 text-slate-600">
                سجّل الدخول لتدير مناسباتك وعملياتك اليوم من مكان واحد.
              </p>

              {!isSupabaseConfigured && (
                <div
                  role="alert"
                  className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-base leading-7 text-amber-800"
                >
                  النظام غير مهيأ بعد. يرجى ضبط إعدادات الاتصال في ملف البيئة (
                  <span dir="ltr" className="font-mono">
                    .env
                  </span>
                  ).
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                <Field label="البريد الإلكتروني" htmlFor="email" required>
                  <div className="relative">
                    <Mail
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                    />
                    <Input
                      id="email"
                      type="email"
                      dir="ltr"
                      autoComplete="email"
                      inputMode="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      className="ps-12"
                    />
                  </div>
                </Field>

                <Field label="كلمة المرور" htmlFor="password" required>
                  <div className="relative">
                    <LockKeyhole
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                    />
                    <Input
                      id="password"
                      dir="ltr"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="ps-12 pe-14"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={
                        showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
                      }
                      className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" aria-hidden="true" />
                      ) : (
                        <Eye className="h-5 w-5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </Field>

                {error && (
                  <div
                    role="alert"
                    className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-base font-semibold leading-7 text-red-700"
                  >
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  disabled={submitting || !isSupabaseConfigured}
                  className="w-full"
                >
                  {submitting ? (
                    "جارٍ الدخول..."
                  ) : (
                    <>
                      دخول
                      <ArrowLeft className="h-5 w-5 rotate-180" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </form>

              <div className="mt-6 space-y-3 border-t border-slate-100 pt-5 text-center text-base">
                <p className="text-slate-500">
                  ليس لديك حساب؟{" "}
                  <Link
                    to="/signup"
                    className="font-bold text-brand-700 underline-offset-4 hover:underline"
                  >
                    أنشئ حساباً الآن
                  </Link>
                </p>
                <Link
                  to="/forgot-password"
                  className="inline-flex items-center gap-1.5 font-bold text-slate-400 underline underline-offset-4 transition-colors hover:text-white"
                >
                  نسيت كلمة المرور؟
                </Link>
              </div>
            </div>
          </div>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-200/90">
            <ShieldCheck className="h-4 w-4 text-brand-500" aria-hidden="true" />
            اتصال مشفّر — بيانات كل منشأة معزولة
          </p>
        </div>
      </main>

      {/* Product introduction: what it is, who it serves (desktop panel). */}
      <aside
        aria-label="عن النظام"
        className="relative hidden w-[44%] flex-none flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 p-10 text-white xl:p-14 lg:flex"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -end-24 h-80 w-80 rounded-full bg-gold-400/10 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -start-20 h-96 w-96 rounded-full bg-brand-400/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)",
            backgroundSize: "26px 26px",
          }}
        />

        <div className="relative flex items-center gap-3">
          <BrandMark className="h-12 w-12 bg-white/10 ring-white/15" />
          <p className="text-lg font-black tracking-tight text-white">
            الضيافة والمناسبات
          </p>
        </div>

        <div className="relative">
          <h2 className="text-3xl font-black leading-[1.35] xl:text-[2.6rem] xl:leading-[1.3]">
            من طلب العميل
            <br />
            إلى مناسبة رابحة <span className="text-gold-300">منفَّذة ومغلقة</span>
          </h2>
          <p className="mt-5 max-w-md text-lg leading-8 text-brand-50/85">
            حوّل طلب العميل إلى مناسبة منفَّذة ومغلقة وربحية — من عرض السعر
            حتى الإغلاق وحساب الربح الفعلي.
          </p>

          <ul className="mt-8 grid grid-cols-2 gap-3">
            {CAPABILITIES.map((capability) => (
              <li
                key={capability.title}
                className="rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-sm"
              >
                <CheckCircle2
                  className="h-5 w-5 text-gold-300"
                  aria-hidden="true"
                />
                <p className="mt-2.5 font-bold leading-6 text-white">
                  {capability.title}
                </p>
                <p className="mt-1 text-sm leading-6 text-brand-100/80">
                  {capability.detail}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative border-t border-white/10 pt-5 text-base leading-7 text-brand-100/80">
          مصمَّم لمكاتب خدمات الضيافة والمناسبات في سلطنة عُمان — أعراس، عزاء،
          مجالس، وفعاليات.
        </p>
      </aside>
    </div>
  );
}
