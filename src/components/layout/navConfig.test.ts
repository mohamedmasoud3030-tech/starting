import { describe, expect, it } from "vitest";
import {
  MOBILE_PRIMARY_TARGETS,
  NAV_GROUPS,
  visibleNavGroups,
  type NavTarget,
} from "./navConfig";

// Every top-level app route that is meant to be reachable from navigation.
// Detail/wizard routes (/events/$eventId, /customers/$customerId,
// /quotes/new, /quotes/$quoteId, /staff/$staffId) are intentionally NOT here —
// they are reached from their parent index or via deep links, not from the
// sidebar.
const ALL_EXPECTED_TARGETS: readonly NavTarget[] = [
  "/home",
  "/dashboard",
  "/events",
  "/calendar",
  "/operations",
  "/quotes",
  "/customers",
  "/packages",
  "/catalog",
  "/consumables",
  "/procurement",
  "/procurement/restaurants",
  "/staff",
  "/reports",
  "/accounting",
  "/integrity",
  "/search",
  "/settings",
];

function flatTargets(groups: ReturnType<typeof visibleNavGroups>): NavTarget[] {
  return groups.flatMap((g) => g.items.map((i) => i.to));
}

describe("navConfig", () => {
  it("declares every expected nav target exactly once", () => {
    const declared = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to));
    expect(new Set(declared).size).toBe(declared.length); // no duplicates
    expect(declared.sort()).toEqual([...ALL_EXPECTED_TARGETS].sort());
  });

  it("keeps every mobile primary inside the full navigation set", () => {
    const declared = new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to)));
    for (const target of MOBILE_PRIMARY_TARGETS) {
      expect(declared.has(target), `${target} in full nav`).toBe(true);
    }
  });

  it("shows everything to an owner (all capabilities)", () => {
    const all = visibleNavGroups(true, true, true, true);
    expect(flatTargets(all).sort()).toEqual([...ALL_EXPECTED_TARGETS].sort());
  });

  it("hides commercial/financial/payroll-only pages from a bare warehouse role", () => {
    // WAREHOUSE: no quotation.manage/issue, no cost.visibility, no payroll.read.
    const warehouse = visibleNavGroups(false, false, false, false);
    const targets = flatTargets(warehouse);
    // Operational + shared pages remain.
    for (const keep of ["/home", "/events", "/calendar", "/operations", "/customers"]) {
      expect(targets).toContain(keep);
    }
    // Everything requiring a role is gone.
    for (const hidden of [
      "/quotes",
      "/dashboard",
      "/reports",
      "/accounting",
      "/integrity",
      "/procurement",
      "/procurement/restaurants",
      "/staff",
    ]) {
      expect(targets, `${hidden} hidden from warehouse`).not.toContain(hidden);
    }
  });

  it("shows financial pages to an accountant and commercial pages to a manager, but not payroll", () => {
    // Accountant: cost.visibility yes, commercial no, payroll no.
    const accountant = visibleNavGroups(false, false, true, false);
    const aTargets = flatTargets(accountant);
    expect(aTargets).toContain("/reports");
    expect(aTargets).toContain("/accounting");
    expect(aTargets).toContain("/integrity");
    expect(aTargets).toContain("/procurement");
    expect(aTargets).not.toContain("/quotes");
    expect(aTargets).not.toContain("/staff");

    // Manager: commercial yes, cost yes, payroll no.
    const manager = visibleNavGroups(true, true, true, false);
    const mTargets = flatTargets(manager);
    expect(mTargets).toContain("/quotes");
    expect(mTargets).not.toContain("/staff");
  });

  it("shows the team/HR page only to payroll readers", () => {
    const withPayroll = visibleNavGroups(true, true, true, true);
    expect(flatTargets(withPayroll)).toContain("/staff");
    const without = visibleNavGroups(true, true, true, false);
    expect(flatTargets(without)).not.toContain("/staff");
  });

  it("drops empty groups so no section header shows without items", () => {
    const limited = visibleNavGroups(false, false, false, false);
    for (const group of limited) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });
});
