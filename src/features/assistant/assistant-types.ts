/**
 * Shared types for the operations assistant.
 *
 * The boundary is intentionally narrow: the client builds a small,
 * read-only snapshot of the operator's current organization and sends it to
 * the edge function, which adds the hospitality knowledge base and asks the
 * model for a short Arabic answer. The client never computes business
 * figures itself.
 */

/** A single turn in the conversation. `assistant` replies and `user` asks. */
export interface AssistantChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Capability hints the client sends so the model never reaches for figures
 * the caller is not allowed to read. The server remains the security
 * boundary; these only steer the prompt.
 */
export interface AssistantCapabilityProfile {
  canReadCost: boolean;
  canReadPayroll: boolean;
  canManageCommercial: boolean;
}

/** The read-only context snapshot the client gathers for the request. */
export interface AssistantContextPayload {
  orgId: string;
  orgName: string;
  roleLabel: string;
  capabilities: AssistantCapabilityProfile;
  /** Figures from management_metrics (may be partially hidden by RLS). */
  metrics: Record<string, unknown> | null;
  /** Active management alerts. */
  alerts: unknown[] | null;
  /** Today's collections / closure candidates, when readable. */
  today: Record<string, unknown> | null;
  /** Client-reported surface the caller is currently looking at. */
  surface: string | null;
}

/** What the client sends to the edge function. */
export interface AssistantRequest {
  context: AssistantContextPayload;
  /** Recent conversation (trimmed). */
  history: AssistantChatMessage[];
  prompt: string;
}

/** The edge function's structured answer. */
export interface AssistantResponse {
  reply: string;
  grounded: boolean;
  caveats: string[];
  meta: {
    source: "deterministic" | "model" | "fallback";
    degraded: boolean;
  };
}
