import { supabase } from "@/lib/supabase";
import type {
  AssistantRequest,
  AssistantResponse,
} from "./assistant-types";

/**
 * Client wrapper for the «لينا» edge function (three actions).
 *
 * The client only packages narrow, read-only payloads and hands back the
 * structured answer / audio. The edge function owns authentication, the
 * knowledge base, the model call and the cloud voice; the client never holds
 * a provider key.
 */

/**
 * Turn the SDK's opaque "Edge Function returned a non-2xx status code" into
 * the Arabic reason the function actually sent (401 session, 422 bad input,
 * 504 provider timeout…). The function always answers JSON `{error:{message}}`.
 */
async function describeInvokeError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    const status = ctx.status;
    try {
      const body = (await ctx.clone().json()) as { error?: { message?: string } };
      if (body?.error?.message) return body.error.message;
    } catch {
      /* not JSON */
    }
    if (status === 401) return "انتهت الجلسة — سجّل الدخول من جديد.";
    if (status === 429) return "المساعد مشغول الآن — حاول بعد دقيقة.";
    if (status >= 500) return "المساعد غير متاح مؤقتاً — حاول بعد قليل.";
  }
  const msg = (error as { message?: unknown })?.message;
  if (typeof msg === "string" && msg && !/non-2xx|Failed to send/i.test(msg)) return msg;
  return "تعذر الوصول إلى المساعد الآن.";
}

async function invokeAssistant(body: unknown): Promise<unknown> {
  // Make sure the JWT we send is fresh: a token that expired while the tab
  // was in the background makes the function answer 401.
  try {
    await supabase.auth?.getSession?.();
  } catch {
    /* offline — let invoke report it */
  }
  const { data, error } = await supabase.functions.invoke("ai-assistant", {
    body: body as Record<string, unknown>,
  });
  if (error) {
    throw new Error(await describeInvokeError(error));
  }
  return data;
}

/** Chat action — text conversation grounded in the ops context + KB. */
export async function requestAssistant(
  request: AssistantRequest,
): Promise<AssistantResponse> {
  const payload = (await invokeAssistant({
    action: "chat",
    context: request.context,
    history: request.history,
    prompt: request.prompt,
  })) as AssistantResponse | null;

  if (!payload || typeof payload.reply !== "string") {
    throw new Error("عاد المساعد برد غير صالح.");
  }
  return {
    reply: payload.reply,
    grounded: payload.grounded === true,
    caveats: Array.isArray(payload.caveats) ? payload.caveats : [],
    meta: {
      source: payload.meta?.source ?? "fallback",
      degraded: payload.meta?.degraded === true,
      live: payload.meta?.live === true,
    },
  };
}

/** Transcribe action — voice message → Arabic text via the provider. */
export async function transcribeVoice(
  audioB64: string,
  mimeType: string,
): Promise<string> {
  const payload = (await invokeAssistant({
    action: "transcribe",
    audioB64,
    mimeType,
  })) as { text?: string } | null;
  if (!payload || typeof payload.text !== "string" || payload.text.length === 0) {
    throw new Error("تعذّر فهم التسجيل الصوتي.");
  }
  return payload.text;
}

export type SpeakOutcome =
  | { kind: "ok"; audioB64: string; mimeType: string }
  | { kind: "quota" } // Gemini daily TTS quota exhausted — retry later.
  | { kind: "failed" }; // Transient provider outage — retry shortly.

/**
 * Speak action — Arabic text → feminine cloud voice WAV clip.
 *
 * Never throws for provider-level failures: the caller needs to know whether
 * the daily voice quota is spent (→ use the local device voice for a while)
 * or the provider is briefly down (→ quick retry).
 */
export async function synthesizeSpeech(text: string): Promise<SpeakOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke("ai-assistant", {
      body: { action: "speak", text },
    });
    const payload = (data ?? error) as {
      audioB64?: string;
      mimeType?: string;
      error?: { code?: string; retryAfterSeconds?: number };
    } | null;
    if (payload?.audioB64) {
      return { kind: "ok", audioB64: payload.audioB64, mimeType: payload.mimeType ?? "audio/wav" };
    }
    const code = payload?.error?.code;
    if (code === "SPEAK_QUOTA") return { kind: "quota" };
    return { kind: "failed" };
  } catch {
    // Network-level failure (offline / function cold-start timeout): treat as
    // a transient outage and let the caller fall back to the device voice.
    return { kind: "failed" };
  }
}
