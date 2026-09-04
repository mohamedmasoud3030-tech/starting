import { useCallback, useState } from "react";
import { callRpc } from "@/lib/rpc";
import { requestAssistant } from "./assistant-api";
import { buildOperationsContext } from "./operations-context";
import type {
  AssistantCapabilityProfile,
  AssistantChatMessage,
  AssistantResponse,
} from "./assistant-types";

/** Inputs the launcher resolves from auth + router; the hook stays pure. */
export interface UseAssistantInput {
  orgId: string;
  orgName: string;
  roleLabel: string;
  capabilities: AssistantCapabilityProfile;
  surface: string | null;
  /** Injectable boundaries (tests) — default to the real client. */
  buildContext?: typeof buildOperationsContext;
  send?: typeof requestAssistant;
}

export interface UseAssistantState {
  messages: AssistantChatMessage[];
  loading: boolean;
  error: string | null;
  /** The first (greeting) assistant turn, if any. */
  greeting: string | null;
  sendPrompt: (prompt: string) => Promise<void>;
  reset: () => void;
}

/**
 * Conversation state for the operations assistant.
 *
 * On each send the hook re-gathers the operations snapshot through
 * `buildOperationsContext`, so figures always reflect the current
 * organization and the caller's role, then hands the model a trimmed history
 * so the request stays small. Errors surface to the UI instead of throwing.
 */
export function useAssistant(input: UseAssistantInput): UseAssistantState {
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildContext = input.buildContext ?? buildOperationsContext;
  const send = input.send ?? requestAssistant;

  const sendPrompt = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || loading) return;

      setError(null);
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setLoading(true);

      try {
        const context = await buildContext({
          orgId: input.orgId,
          orgName: input.orgName,
          roleLabel: input.roleLabel,
          capabilities: input.capabilities,
          surface: input.surface,
          callRpc: (name, args) => callRpc(name, args),
        });

        const conversation = messages.filter(
          (m) => m.role === "user" || m.role === "assistant",
        );

        const response: AssistantResponse = await send({
          context,
          history: conversation.slice(-6),
          prompt: trimmed,
        });

        const reply: AssistantChatMessage = {
          role: "assistant",
          content: response.reply,
        };
        setMessages((prev) => [...prev, reply]);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "تعذر إرسال السؤال الآن.",
        );
      } finally {
        setLoading(false);
      }
    },
    [
      buildContext,
      send,
      input.orgId,
      input.orgName,
      input.roleLabel,
      input.surface,
      input.capabilities,
      messages,
      loading,
    ],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
    setLoading(false);
  }, []);

  return {
    messages,
    loading,
    error,
    greeting: null,
    sendPrompt,
    reset,
  };
}
