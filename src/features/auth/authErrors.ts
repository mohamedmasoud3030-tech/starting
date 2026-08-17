/**
 * Translate the common Supabase Auth failures into clear Arabic for the
 * owner. Anything unrecognized falls back to a generic message — the raw
 * English backend text is never shown on the login screen.
 */
export function authLoginErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid email or password") ||
    normalized.includes("invalid_credentials")
  ) {
    return "بيانات الدخول غير صحيحة. تحقق من البريد وكلمة المرور.";
  }
  if (normalized.includes("email not confirmed")) {
    return "لم يتم تأكيد البريد الإلكتروني بعد. تحقق من بريدك أو تواصل مع المالك.";
  }
  if (
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("429")
  ) {
    return "محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.";
  }
  if (normalized.includes("network") || normalized.includes("fetch")) {
    return "تعذر الوصول إلى الخدمة. تحقق من اتصال الإنترنت ثم أعد المحاولة.";
  }
  return "تعذّر تسجيل الدخول. تحقق من البيانات وأعد المحاولة.";
}
