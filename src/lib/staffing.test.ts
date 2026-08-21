import { describe, expect, it } from "vitest";
import {
  recommendedHostCount,
  staffingCoverageLabel,
  staffingPlan,
} from "./staffing";

describe("recommendedHostCount", () => {
  it("uses ceil(guestCount / 15)", () => {
    expect(recommendedHostCount(30)).toBe(2);
    expect(recommendedHostCount(75)).toBe(5);
    expect(recommendedHostCount(150)).toBe(10);
    expect(recommendedHostCount(300)).toBe(20);
    expect(recommendedHostCount(600)).toBe(40);
    expect(recommendedHostCount(1)).toBe(1);
    expect(recommendedHostCount(15)).toBe(1);
    expect(recommendedHostCount(16)).toBe(2);
  });

  it("does not invent a recommendation from unknown or empty guest counts", () => {
    expect(recommendedHostCount(null)).toBe(0);
    expect(recommendedHostCount(undefined)).toBe(0);
    expect(recommendedHostCount(0)).toBe(0);
    expect(recommendedHostCount(-4)).toBe(0);
    expect(recommendedHostCount(Number.NaN)).toBe(0);
  });
});

describe("staffingPlan", () => {
  it("flags below-recommendation coverage without blocking", () => {
    const plan = staffingPlan({ guestCount: 150, assigned: 8 });
    expect(plan.recommended).toBe(10);
    expect(plan.assigned).toBe(8);
    expect(plan.coverage).toBe("BELOW");
    expect(plan.shortfall).toBe(2);
    expect(staffingCoverageLabel(plan)).toBe("أقل من المقترح بمضيفين");
  });

  it("treats equal or above as adequate", () => {
    expect(staffingPlan({ guestCount: 150, assigned: 10 }).coverage).toBe("ADEQUATE");
    expect(staffingPlan({ guestCount: 150, assigned: 12 }).coverage).toBe("ADEQUATE");
    expect(
      staffingCoverageLabel(staffingPlan({ guestCount: 150, assigned: 10 })),
    ).toBe("التغطية مناسبة تقريبًا");
  });

  it("keeps unknown assigned/guest counts unknown (not a fake zero coverage)", () => {
    expect(staffingPlan({ guestCount: 150, assigned: null }).coverage).toBe("UNKNOWN");
    expect(staffingPlan({ guestCount: null, assigned: 4 }).coverage).toBe("UNKNOWN");
    expect(staffingCoverageLabel(staffingPlan({ guestCount: 150, assigned: null }))).toBeNull();
  });
});
