/**
 * Assistant identity — the persona the operator speaks to.
 *
 * Kept in one place so the assistant's name, role and short scope read
 * consistently everywhere (launcher, empty state, spoken intro, edge
 * function system prompt). Nothing here is logic; it is display metadata
 * only.
 */

/** The friendly name the operator sees and hears. */
export const ASSISTANT_NAME = "لينا";

/**
 * One-line role framing, shown next to the name in the launcher and used as
 * the persona core in the edge function prompt.
 */
export const ASSISTANT_ROLE = "مساعدتك في عمليات الضيافة";

/** What the assistant actually helps with (short, non-technical). */
export const ASSISTANT_SCOPE =
  "أساعدك في مناسباتك وحجوزاتك والموردين وأهم تنبيهات اليوم.";

/** The product/application that hosts the assistant. */
export const ASSISTANT_PRODUCT = "نظام إدارة الضيافة والمناسبات";

/** Attribution line rendered beneath the assistant panel (no personal names). */
export function buildAssistantAttribution(): string {
  return `مساعد ${ASSISTANT_NAME} — ${ASSISTANT_PRODUCT}`;
}
