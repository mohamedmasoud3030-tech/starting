import { describe, expect, it } from "vitest";
import {
  canManageCommercialFor,
  canReadCostFor,
  canWriteCustomersFor,
  selectCurrentMembership,
} from "./authRoles";

describe("organization-scoped role resolution", () => {
  it("OWNER is a commercial manager", () => {
    expect(canManageCommercialFor("OWNER")).toBe(true);
    expect(canReadCostFor("OWNER")).toBe(true);
  });

  it("MANAGER is a commercial manager", () => {
    expect(canManageCommercialFor("MANAGER")).toBe(true);
    expect(canReadCostFor("MANAGER")).toBe(true);
  });

  it("ACCOUNTANT can read cost but NOT manage commercial config", () => {
    expect(canManageCommercialFor("ACCOUNTANT")).toBe(false);
    expect(canReadCostFor("ACCOUNTANT")).toBe(true);
  });

  it("SUPERVISOR and WAREHOUSE get no commercial or cost access", () => {
    for (const role of ["SUPERVISOR", "WAREHOUSE"] as const) {
      expect(canManageCommercialFor(role)).toBe(false);
      expect(canReadCostFor(role)).toBe(false);
    }
  });

  it("null role grants nothing", () => {
    expect(canManageCommercialFor(null)).toBe(false);
    expect(canReadCostFor(null)).toBe(false);
  });

  it("customer write: OWNER/MANAGER/SUPERVISOR only", () => {
    expect(canWriteCustomersFor("OWNER")).toBe(true);
    expect(canWriteCustomersFor("MANAGER")).toBe(true);
    expect(canWriteCustomersFor("SUPERVISOR")).toBe(true);
    expect(canWriteCustomersFor("WAREHOUSE")).toBe(false);
    expect(canWriteCustomersFor("ACCOUNTANT")).toBe(false);
  });

  it("derives permission from the CURRENT org only (OWNER in B, SUPERVISOR in A)", () => {
    const memberships = [
      { membership: { role: "OWNER" as const }, organization: { name: "Org B" } },
      {
        membership: { role: "SUPERVISOR" as const },
        organization: { name: "Org A" },
      },
    ];
    // Deterministic selection: "Org A" sorts before "Org B" (Arabic locale).
    const current = selectCurrentMembership(memberships);
    expect(current?.organization.name).toBe("Org A");
    // Current org is A where the user is SUPERVISOR → no commercial controls.
    expect(canManageCommercialFor(current?.membership.role ?? null)).toBe(false);
    expect(canReadCostFor(current?.membership.role ?? null)).toBe(false);
  });

  it("selects nothing for an empty membership list", () => {
    expect(selectCurrentMembership([])).toBeNull();
  });
});
