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

async function invokeAssistant(body: unknown): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("ai-assistant", {
    body: body as Record<string, unknown>,
  });
  if (error) {
    throw new Error(
      typeof error.message === "string" && error.message.length > 0
        ? error.message
        : "تعذر الوصول إلى المساعد الآن.",
    );
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

/** Speak action — Arabic text → feminine cloud voice WAV clip. */
export async function synthesizeSpeech(text: string): Promise<{
  audioB64: string;
  mimeType: string;
}> {
  const payload = (await invokeAssistant({
    action: "speak",
    text,
  })) as { audioB64?: string; mimeType?: string } | null;
  if (!payload?.audioB64) throw new Error("خدمة الصوت غير متاحة الآن.");
  return { audioB64: payload.audioB64, mimeType: payload.mimeType ?? "audio/wav" };
}
