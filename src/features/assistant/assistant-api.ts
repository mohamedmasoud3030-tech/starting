import { supabase } from "@/lib/supabase";
import type {
  AssistantRequest,
  AssistantResponse,
} from "./assistant-types";

/**
 * Client wrapper for the assistant edge function.
 *
 * The client's only job is to send the read-only context snapshot plus the
 * conversation, and hand back the structured answer. The edge function owns
 * authentication, the knowledge base and the model call; the client never
 * holds a provider key.
 */
export async function requestAssistant(
  request: AssistantRequest,
): Promise<AssistantResponse> {
  const { data, error } = await supabase.functions.invoke("ai-assistant", {
    body: request,
  });

  if (error) {
    throw new Error(
      typeof error.message === "string" && error.message.length > 0
        ? error.message
        : "تعذر الوصول إلى المساعد الآن.",
    );
  }

  const payload = data as AssistantResponse | null;
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
