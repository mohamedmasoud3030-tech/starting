import { useState, type FormEvent } from "react";
import { useAuth } from "@/app/authContext";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

/**
 * First-login onboarding: a signed-in user with no organization yet creates
 * their first منشأة and becomes its OWNER (migration 0061). This replaces the
 * old dead-end where a fresh account was bounced back to the login screen.
 */
export function OnboardingPage() {
  const { user, createOrganization, claimInvitation, logout } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createOrganization(name);
      // On success the provider reloads memberships; AuthGate then renders
      // the application shell automatically.
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "تعذّر إنشاء المنشأة",
      );
      setBusy(false);
    }
  }

  async function submitClaim(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClaimError(null);
    setClaiming(true);
    try {
      // The invitation's email must match THIS account's email (server
      // check). On success the provider reloads memberships and the shell
      // appears — the user is already an owner-managed member of that org.
      await claimInvitation(code);
    } catch (cause) {
      setClaimError(
        cause instanceof Error && cause.message
          ? cause.message
          : "تعذّر تفعيل الدعوة",
      );
      setClaiming(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-xl font-bold text-white">
            ض
          </div>
          <h1 className="text-xl font-black text-slate-900">أهلاً بك</h1>
          <p className="mt-1 text-sm text-slate-500">
            {user?.email ? `حسابك: ${user.email}` : "حسابك جاهز"}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="mb-4 text-base leading-7 text-slate-600">
            أنشئ منشأتك لبدء إدارة مناسباتك. ستصبح مالكها ويمكنك لاحقاً إضافة
            فريقك.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <Field label="اسم المنشأة" htmlFor="org-name" required>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: مؤسسة الريان للضيافة"
                required
              />
            </Field>
            {error && (
              <p role="alert" className="text-sm font-bold text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? "جارٍ الإنشاء…" : "إنشاء منشأتي"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs font-bold text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            أو
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <p className="text-sm leading-6 text-slate-500">
            هل دُعيت للانضمام إلى منشأة؟ فعّل رمز الدعوة — يجب أن يطابق البريد
            الإلكتروني للدعوة بريد حسابك.
          </p>
          <form onSubmit={submitClaim} className="mt-3 space-y-4">
            <Field label="رمز الدعوة" htmlFor="claim-code" required>
              <Input
                id="claim-code"
                dir="ltr"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX"
                required
              />
            </Field>
            {claimError && (
              <p role="alert" className="text-sm font-bold text-red-700">
                {claimError}
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              variant="secondary"
              className="w-full"
              disabled={claiming}
            >
              {claiming ? "جارٍ التفعيل…" : "تفعيل الدعوة"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => void logout()}
            className="mt-4 w-full text-center text-sm font-bold text-slate-500 hover:text-slate-700"
          >
            تسجيل الخروج
          </button>
        </div>
      </div>
    </div>
  );
}
