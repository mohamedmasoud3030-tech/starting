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
  const { user, createOrganization, logout } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
