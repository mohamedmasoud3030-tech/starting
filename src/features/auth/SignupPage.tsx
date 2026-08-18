import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/app/authContext";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { authLoginErrorMessage } from "./authErrors";

/**
 * Self-serve sign-up (email + password) for the first login. When the Supabase
 * project has email confirmation enabled, a session is not returned and the
 * user is told to check their inbox; otherwise they proceed straight to the
 * first-organization onboarding screen.
 */
export function SignupPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (password.length < 8) {
      setError("كلمة المرور يجب أن تكون ٨ أحرف على الأقل");
      return;
    }
    if (password !== confirm) {
      setError("كلمتا المرور غير متطابقتين");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (signUpError) throw signUpError;
      if (data.session) {
        await login(email.trim(), password);
        await navigate({ to: "/home" });
        return;
      }
      setNotice(
        "تم إنشاء حسابك. تحقق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول.",
      );
    } catch (cause) {
      setError(authLoginErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-xl font-bold text-white">
            ض
          </div>
          <h1 className="text-xl font-black text-slate-900">إنشاء حساب جديد</h1>
          <p className="mt-1 text-sm text-slate-500">
            أنشئ حسابك ثم منشأتك لبدء إدارة مناسباتك
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {!isSupabaseConfigured && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
              النظام غير مهيأ بعد. يرجى ضبط إعدادات الاتصال في ملف البيئة (.env).
            </div>
          )}
          {notice && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold leading-6 text-emerald-800">
              {notice}
            </div>
          )}
          <form onSubmit={submit} className="space-y-4">
            <Field label="البريد الإلكتروني" htmlFor="signup-email" required>
              <Input
                id="signup-email"
                type="email"
                dir="ltr"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="كلمة المرور" htmlFor="signup-password" required>
              <Input
                id="signup-password"
                dir="ltr"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Field label="تأكيد كلمة المرور" htmlFor="signup-confirm" required>
              <Input
                id="signup-confirm"
                dir="ltr"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </Field>
            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold leading-6 text-red-700">
                {error}
              </div>
            )}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting || !isSupabaseConfigured}
            >
              {submitting ? "جارٍ إنشاء الحساب…" : "إنشاء الحساب"}
            </Button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-slate-500">
          لديك حساب بالفعل؟{" "}
          <Link to="/login" className="font-bold text-brand-700">
            تسجيل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
}
