import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";

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
      setError(
        err instanceof Error
          ? err.message
          : "تعذّر تسجيل الدخول. تحقق من البيانات وأعد المحاولة.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-8 sm:py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center sm:mb-6">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-xl font-bold text-white sm:h-16 sm:w-16 sm:text-2xl">
            ض
          </div>
          <h1 className="text-xl font-black text-slate-900 sm:text-2xl">
            نظام إدارة الضيافة
          </h1>
          <p className="mt-1 text-sm leading-6 text-slate-500 sm:text-base">
            عمليات المناسبات والضيافة في سلطنة عُمان
          </p>
        </div>

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
  );
}
