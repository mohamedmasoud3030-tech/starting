import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { authLoginErrorMessage } from "./authErrors";

/**
 * Password reset request: uses Supabase's email reset link. Nothing about the
 * account is changed until the owner clicks the link in their inbox.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
      );
      if (resetError) throw resetError;
      setNotice(
        "أُرسل رابط إعادة التعيين إلى بريدك. افتحه وحدد كلمة مرور جديدة.",
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
          <h1 className="text-xl font-black text-slate-900">استعادة كلمة المرور</h1>
          <p className="mt-1 text-sm text-slate-500">
            أدخل بريدك وسنرسل لك رابطاً لإعادة التعيين
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {notice && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold leading-6 text-emerald-800">
              {notice}
            </div>
          )}
          <form onSubmit={submit} className="space-y-4">
            <Field label="البريد الإلكتروني" htmlFor="reset-email" required>
              <Input
                id="reset-email"
                type="email"
                dir="ltr"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
              {submitting ? "جارٍ الإرسال…" : "إرسال رابط التعيين"}
            </Button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-slate-500">
          تذكرت كلمة المرور؟{" "}
          <Link to="/login" className="font-bold text-brand-700">
            تسجيل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
}
