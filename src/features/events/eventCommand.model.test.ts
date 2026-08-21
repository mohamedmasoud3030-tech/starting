import { describe, expect, it } from "vitest";
import { staffingPlan } from "@/lib/staffing";
import {
  buildAttentionItems,
  buildNextActions,
  equipmentLifecycleLabel,
} from "./eventCommand.model";
import type { RosterCounts } from "@/features/staff/attendanceRoster.model";

const roster = (overrides: Partial<RosterCounts> = {}): RosterCounts => ({
  total: 10,
  arrived: 8,
  present: 8,
  checkedOut: 0,
  notArrived: 2,
  ...overrides,
});

describe("equipmentLifecycleLabel", () => {
  it("maps existing warehouse quantities to مطلوب / خرج / عاد", () => {
    expect(
      equipmentLifecycleLabel({ remainingToDispatch: 4, dispatched: 0, outstanding: 0 }),
    ).toBe("مطلوب");
    expect(
      equipmentLifecycleLabel({ remainingToDispatch: 0, dispatched: 4, outstanding: 4 }),
    ).toBe("خرج");
    expect(
      equipmentLifecycleLabel({ remainingToDispatch: 0, dispatched: 4, outstanding: 0 }),
    ).toBe("عاد");
  });
});

describe("buildNextActions", () => {
  it("asks to assign hosts on a confirmed event with an empty roster", () => {
    const actions = buildNextActions({
      status: "CONFIRMED",
      assignedCount: 0,
      roster: roster({ total: 0, arrived: 0, present: 0, notArrived: 0 }),
      outstandingMilli: 0,
      warehouseOutstanding: 0,
      financiallyClosed: false,
      canCommercial: true,
      canFinance: true,
      canAttendance: true,
      hasAcceptedQuote: true,
    });
    expect(actions[0]).toMatchObject({ id: "assign", primary: true, tab: "الفريق" });
  });

  it("prioritises arrival photos while preparing", () => {
    const actions = buildNextActions({
      status: "PREPARING",
      assignedCount: 10,
      roster: roster(),
      outstandingMilli: 0,
      warehouseOutstanding: 0,
      financiallyClosed: false,
      canCommercial: true,
      canFinance: true,
      canAttendance: true,
      hasAcceptedQuote: true,
    });
    expect(actions[0]).toMatchObject({ id: "checkin", tab: "الحضور", primary: true });
  });

  it("prioritises checkout photos after the team returns", () => {
    const actions = buildNextActions({
      status: "RETURNING",
      assignedCount: 10,
      roster: roster({ present: 4, arrived: 10, notArrived: 0, checkedOut: 6 }),
      outstandingMilli: 0,
      warehouseOutstanding: 0,
      financiallyClosed: false,
      canCommercial: true,
      canFinance: true,
      canAttendance: true,
      hasAcceptedQuote: true,
    });
    expect(actions[0]).toMatchObject({ id: "checkout", tab: "الحضور" });
  });
});

describe("buildAttentionItems", () => {
  it("does not scare a confirmed event that simply has not started yet", () => {
    const items = buildAttentionItems({
      status: "CONFIRMED",
      roster: roster({ notArrived: 10, arrived: 0, present: 0 }),
      staffing: staffingPlan({ guestCount: 150, assigned: 12 }),
      outstandingMilli: 0,
      warehouseOutstanding: 0,
      warehouseDamaged: 0,
      warehouseLost: 0,
      readinessIncomplete: false,
      financiallyClosed: false,
      canFinance: true,
    });
    expect(items.find((i) => i.id === "hosts-missing")).toBeUndefined();
  });

  it("surfaces hosts still inside after return and a staffing shortfall", () => {
    const items = buildAttentionItems({
      status: "RETURNING",
      roster: roster({ present: 3, arrived: 10, notArrived: 0, checkedOut: 7 }),
      staffing: staffingPlan({ guestCount: 150, assigned: 8 }),
      outstandingMilli: 5000,
      warehouseOutstanding: 2,
      warehouseDamaged: 1,
      warehouseLost: 0,
      readinessIncomplete: false,
      financiallyClosed: false,
      canFinance: true,
    });
    expect(items.map((i) => i.id)).toEqual(
      expect.arrayContaining(["still-in", "staffing-short", "unpaid", "eq-out", "eq-damage"]),
    );
  });
});
