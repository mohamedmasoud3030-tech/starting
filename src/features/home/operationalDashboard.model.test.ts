import { describe, expect, it } from "vitest";
import {
  buildEventWhatsAppUrl,
  buildOperationalDashboard,
  isNewWorkspace,
  normalizeWhatsAppPhone,
  settledCount,
} from "./operationalDashboard.model";

const now = new Date("2026-08-15T10:00:00.000Z");

/** Canonical server readiness payloads (0082 vocabulary). */
const READY: import("@/features/events/operationalReadiness").OperationalReadiness = {
  status: "READY",
  reasons: [],
  staff_required: 0,
  staff_assigned: 0,
  staff_missing: 0,
  equipment_shortage: 0,
  consumables_shortage: 0,
  procurement_pending: 0,
};

const SHORT_STAFF: import("@/features/events/operationalReadiness").OperationalReadiness = {
  status: "NOT_READY",
  reasons: ["STAFF_SHORTAGE"],
  staff_required: 20,
  staff_assigned: 18,
  staff_missing: 2,
  equipment_shortage: 0,
  consumables_shortage: 0,
  procurement_pending: 0,
};

function event(overrides: Partial<{
  id: string;
  event_number: string;
  title: string;
  start_at: string;
  status: string;
  venue_name: string;
  guest_count: number;
  contact_phone: string | null;
}> = {}) {
  return {
    id: "event-1",
    event_number: "EV-2026-00125",
    title: "ضيافة المساء",
    start_at: "2026-08-15T15:00:00.000Z",
    status: "CONFIRMED",
    venue_name: "قاعة الريان",
    guest_count: 120,
    contact_phone: "+968 9123 4567",
    ...overrides,
  };
}

describe("buildOperationalDashboard", () => {
  it("keeps only today's non-cancelled events and builds real operational alerts", () => {
    const result = buildOperationalDashboard({
      now,
      events: [
        event(),
        event({ id: "event-2", title: "مناسبة جاهزة", start_at: "2026-08-15T07:00:00.000Z" }),
        event({ id: "event-3", status: "CANCELLED" }),
        event({ id: "event-4", start_at: "2026-08-16T15:00:00.000Z" }),
      ],
      readinessByEventId: {
        "event-1": SHORT_STAFF,
        "event-2": READY,
      },
      stockLines: [
        { stockItemId: "stock-1", itemName: "ماء", isTrackingActive: true, isLowStock: true },
        { stockItemId: "stock-2", itemName: "قهوة", isTrackingActive: true, isLowStock: false },
      ],
    });

    // Deterministic Today order: blockers first (NOT_READY), then start time —
    // the LATER event with a staff shortage still leads the day's agenda.
    expect(result.todayEvents.map((item) => item.id)).toEqual(["event-1", "event-2"]);
    expect(result.readyCount).toBe(1);
    expect(result.eventAttentionCount).toBe(1);
    expect(result.lowStockCount).toBe(1);
    expect(result.alerts).toHaveLength(2);
    expect(result.alerts[0]).toMatchObject({ kind: "EVENT", eventId: "event-1" });
    // Alert detail is built from the canonical reason + its counts (18/20).
    expect(
      "detail" in (result.alerts[0] ?? {}) ? (result.alerts[0] as { detail: string }).detail : "",
    ).toContain("المطلوب 20 / المسند 18 — ينقص 2");
    expect(result.alerts[1]).toMatchObject({ kind: "STOCK", title: "مخزون منخفض — ماء" });
  });

  it("surfaces unknown readiness instead of silently treating it as ready", () => {
    const result = buildOperationalDashboard({
      now,
      events: [event()],
      readinessByEventId: {},
      stockLines: [],
    });

    expect(result.readyCount).toBe(0);
    expect(result.eventAttentionCount).toBe(1);
    expect(result.alerts[0]).toMatchObject({
      kind: "EVENT",
      title: "ضيافة المساء — الجاهزية غير متاحة",
    });
  });
});

describe("WhatsApp sharing", () => {
  it("normalizes Oman local and international numbers", () => {
    expect(normalizeWhatsAppPhone("9123 4567")).toBe("96891234567");
    expect(normalizeWhatsAppPhone("+968 9123 4567")).toBe("96891234567");
    expect(normalizeWhatsAppPhone("00968 9123 4567")).toBe("96891234567");
    expect(normalizeWhatsAppPhone("123")).toBeNull();
  });

  it("creates a prefilled WhatsApp URL without financial information", () => {
    const url = buildEventWhatsAppUrl(event());
    expect(url).toContain("https://wa.me/96891234567?text=");
    const decoded = decodeURIComponent(url ?? "");
    expect(decoded).toContain("ضيافة المساء");
    expect(decoded).toContain("قاعة الريان");
    expect(decoded).toContain("120");
    expect(decoded).not.toContain("ريال");
  });

  it("returns null when no valid contact number exists", () => {
    expect(buildEventWhatsAppUrl(event({ contact_phone: null }))).toBeNull();
  });
});

describe("isNewWorkspace — first-minutes onboarding gate", () => {
  it("is true only when both reads settle to empty", () => {
    expect(
      isNewWorkspace({
        eventsLoaded: true,
        eventCount: 0,
        customersLoaded: true,
        customerCount: 0,
      }),
    ).toBe(true);
  });

  it("is false while either read is unresolved (no false onboarding flash)", () => {
    expect(
      isNewWorkspace({
        eventsLoaded: false,
        eventCount: null,
        customersLoaded: true,
        customerCount: 0,
      }),
    ).toBe(false);
    expect(
      isNewWorkspace({
        eventsLoaded: true,
        eventCount: 0,
        customersLoaded: true,
        customerCount: null,
      }),
    ).toBe(false);
  });

  it("is false when any data already exists", () => {
    expect(
      isNewWorkspace({
        eventsLoaded: true,
        eventCount: 3,
        customersLoaded: true,
        customerCount: 0,
      }),
    ).toBe(false);
    expect(
      isNewWorkspace({
        eventsLoaded: true,
        eventCount: 0,
        customersLoaded: true,
        customerCount: 1,
      }),
    ).toBe(false);
  });
});

describe("settledCount — no fabricated statistics", () => {
  it("reports null (rendered as —) while the source has not settled", () => {
    // A dashboard must not claim "0 events need attention" before it knows.
    expect(settledCount(false, undefined)).toBeNull();
    expect(settledCount(false, 7)).toBeNull();
  });

  it("reports a real zero once the source has settled", () => {
    expect(settledCount(true, 0)).toBe(0);
    expect(settledCount(true, undefined)).toBe(0);
  });

  it("passes through a settled non-zero count", () => {
    expect(settledCount(true, 3)).toBe(3);
  });
});


