/**
 * Operational host-planning guidance.
 *
 * One host serves approximately 15 guests. This is FRONTEND guidance only —
 * never a contractual rule, never a backend constraint, never a wage input.
 */

export const GUESTS_PER_HOST = 15;

/** ceil(guestCount / 15). Zero / unknown guest counts yield 0, not a fake 1. */
export function recommendedHostCount(guestCount: number | null | undefined): number {
  if (guestCount == null || !Number.isFinite(guestCount) || guestCount <= 0) {
    return 0;
  }
  return Math.ceil(guestCount / GUESTS_PER_HOST);
}

export type StaffingCoverage = "UNKNOWN" | "BELOW" | "ADEQUATE";

export interface StaffingPlan {
  guestCount: number | null;
  recommended: number | null;
  assigned: number | null;
  coverage: StaffingCoverage;
  shortfall: number | null;
}

/**
 * Compare assigned hosts to the approximate recommendation.
 * Unknown inputs stay unknown — never coerced to a confident zero coverage.
 */
export function staffingPlan(input: {
  guestCount: number | null | undefined;
  assigned: number | null | undefined;
}): StaffingPlan {
  const guestCount =
    input.guestCount == null || !Number.isFinite(input.guestCount)
      ? null
      : input.guestCount;
  const assigned =
    input.assigned == null || !Number.isFinite(input.assigned) ? null : input.assigned;
  const recommended = guestCount == null ? null : recommendedHostCount(guestCount);

  if (recommended == null || assigned == null) {
    return {
      guestCount,
      recommended,
      assigned,
      coverage: "UNKNOWN",
      shortfall: null,
    };
  }

  if (assigned < recommended) {
    return {
      guestCount,
      recommended,
      assigned,
      coverage: "BELOW",
      shortfall: recommended - assigned,
    };
  }

  return {
    guestCount,
    recommended,
    assigned,
    coverage: "ADEQUATE",
    shortfall: 0,
  };
}

export function staffingCoverageLabel(plan: StaffingPlan): string | null {
  if (plan.coverage === "UNKNOWN") return null;
  if (plan.coverage === "BELOW") {
    const n = plan.shortfall ?? 0;
    return n === 1 ? "أقل من المقترح بمضيف" : `أقل من المقترح بمضيفين`;
  }
  return "التغطية مناسبة تقريبًا";
}
