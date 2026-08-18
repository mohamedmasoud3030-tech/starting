import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { isSupabaseConfigured } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";

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
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-8 sm:py-10">
      <div className="w-full max-w-5xl">
        <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
          {/* Product introduction: what it is, who it serves, how access works. */}
          <section aria-label="عن النظام" className="text-center lg:text-right">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-xl font-bold text-white sm:h-16 sm:w-16 sm:text-2xl lg:mx-0">
              ض
            </div>
            <h1 className="text-2xl font-black leading-tight text-slate-900 sm:text-3xl">
              نظام إدارة الضيافة
            </h1>
            <p className="mx-auto mt-3 max-w-md text-base leading-7 text-slate-600 sm:text-lg lg:mx-0">
              حوّل طلب العميل إلى مناسبة منفَّذة ومغلقة وربحية — من عرض السعر
              حتى الإغلاق وحساب الربح الفعلي.
            </p>

            <ul className="mx-auto mt-6 hidden max-w-md space-y-3 text-right sm:block lg:mx-0">
              {CAPABILITIES.map((capability) => (
                <li key={capability.title} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                  <div>
                    <p className="font-bold text-slate-800">{capability.title}</p>
                    <p className="text-sm text-slate-500">{capability.detail}</p>
                  </div>
                </li>
              ))}
            </ul>

            <p className="mx-auto mt-6 max-w-md text-sm leading-6 text-slate-500 lg:mx-0">
              مصمَّم لمكاتب خدمات الضيافة والمناسبات في سلطنة عُمان — أعراس،
              عزاء، مجالس، فعاليات.
            </p>

            <p className="mx-auto mt-3 max-w-md rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-600 lg:mx-0">
              الدخول بحساب يزوّده مكتبك — لا يوجد تسجيل ذاتي.
            </p>
          </section>

          {/* Sign-in form — the single primary action. */}
          <div className="mx-auto w-full max-w-md lg:max-w-none">
            <h2 className="sr-only">تسجيل الدخول</h2>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              {!isSupabaseConfigured && (
                <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800 sm:text-base">
                  النظام غير مهيأ بعد. يرجى ضبط إعدادات الاتصال في ملف البيئة (
                  <span dir="ltr" className="font-mono">
                    .env
                  </span>
                  ).
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="البريد الإلكتروني" htmlFor="email" required>
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
                  />
                </Field>

                <Field label="كلمة المرور" htmlFor="password" required>
                  <div className="relative">
                    <Input
                      id="password"
                      dir="ltr"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pl-14"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                      className="absolute left-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </Field>

                {error && (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold leading-6 text-red-700 sm:text-base"
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
                  {submitting ? "جارٍ الدخول..." : "دخول"}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
