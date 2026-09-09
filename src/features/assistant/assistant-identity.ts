/**
 * Assistant identity — the persona the operator speaks to.
 *
 * Kept in one place so the assistant's name, scope and attribution read
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
export const ASSISTANT_ROLE = "الشريك التشغيلي لمالك مكتب الضيافة";

/** What the assistant actually helps with (short, non-technical). */
export const ASSISTANT_SCOPE =
  "ملخص عمليات اليوم، جاهزية المناسبات، التحصيل المتبقي، الموردون والمشتريات، والتنبيهات التي تستحق انتباهك أولاً.";

/** The product/application that hosts the assistant. */
export const ASSISTANT_PRODUCT = "ضيافة — عمليات الضيافة والمناسبات";

/** The platform/studio the assistant experience ships from (attribution). */
export const ASSISTANT_PLATFORM = "Lena World";

/** The developer/builder credited at the bottom of the panel. */
export const ASSISTANT_DEVELOPER = "محمد مسعود";

/** Attribution line rendered beneath the assistant panel. */
export function buildAssistantAttribution(): string {
  return `مساعد ${ASSISTANT_NAME} من ${ASSISTANT_PLATFORM} — تطوير ${ASSISTANT_DEVELOPER}`;
}
