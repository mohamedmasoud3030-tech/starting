/**
 * Canonical readiness LABEL + TONE vocabulary.
 *
 * The `event_readiness` RPC is the single source of truth for whether an event
 * can be executed. Its status was translated into a short Arabic badge label in
 * more than one screen, so this module owns that one vocabulary.
 *
 * Deliberately NOT unified here:
 *  - `screenSummary.readinessSentence` — spoken owner-voice register, its own
 *    grammar and Arabic-digit formatting, covered by its own tests;
 *  - `eventWorkspace.readinessText` — the workspace banner sentence;
 *  - `operationalDashboard.readinessDetail` — the alert detail line.
 * Those are different registers, not duplication, and collapsing them would
 * change user-visible output.
 *
 * Pure: no React, no data access.
 */

export type ReadinessTone = "success" | "warning" | "danger" | "neutral";

/**
 * Short Arabic label for a readiness status, including the unknown case
 * (readiness could not be established), which must never read as "ready".
 */
export function readinessLabel(status: string | null | undefined): string {
  switch (status) {
    case "READY":
      return "جاهزة";
    case "STAFF_MISSING":
      return "نقص في الفريق";
    case "EQUIPMENT_SHORTAGE":
      return "نقص معدات";
    case "MULTIPLE_ISSUES":
      return "تحتاج تدخل";
    default:
      return "الجاهزية غير متاحة";
  }
}

/**
 * Presentation tone for a readiness status.
 *
 * Unknown readiness is NEVER `success`: an event whose readiness could not be
 * established must not look confirmed-ready to an operator.
 */
export function readinessTone(status: string | null | undefined): ReadinessTone {
  switch (status) {
    case "READY":
      return "success";
    case "MULTIPLE_ISSUES":
      return "danger";
    case "STAFF_MISSING":
    case "EQUIPMENT_SHORTAGE":
      return "warning";
    default:
      return "neutral";
  }
}
