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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-700 text-2xl font-bold text-white">
            ض
          </div>
          <h1 className="text-2xl font-bold text-slate-900">نظام إدارة الضيافة</h1>
          <p className="mt-1 text-base text-slate-500">
            عمليات المناسبات والضيافة في سلطنة عُمان
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {!isSupabaseConfigured && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-base text-amber-800">
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
                  className="pl-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
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
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-base font-semibold text-red-700"
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
