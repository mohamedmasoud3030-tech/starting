import { describe, expect, it } from "vitest";
import type { EventRow } from "@/features/events/events.api";
import { buildMonthGrid, eventLocalDay, groupEventsByDay } from "./calendarModel";

function ev(id: string, startAt: string, over: Partial<EventRow> = {}): EventRow {
  return {
    id,
    organization_id: "org",
    customer_id: "c",
    event_number: "EV-1",
    title: "مناسبة",
    event_type: "OTHER",
    start_at: startAt,
    end_at: "2026-08-20T22:00:00+04:00",
    guest_count: 10,
    venue_name: "قاعة",
    location_details: null,
    contact_name: null,
    contact_phone: null,
    notes: null,
    status: "CONFIRMED",
    cancellation_reason: null,
    accepted_quotation_id: null,
    created_at: "",
    ...over,
  };
}

describe("calendarModel", () => {
  it("converts an event timestamp to a Muscat local day", () => {
    // 2026-08-20T16:00+04:00 = 2026-08-20 in Muscat.
    const d = eventLocalDay(ev("e1", "2026-08-20T16:00:00+04:00"));
    expect(d).toEqual({ year: 2026, month: 8, day: 20 });
  });

  it("groups events by day", () => {
    const map = groupEventsByDay([
      ev("e1", "2026-08-20T10:00:00+04:00"),
      ev("e2", "2026-08-20T14:00:00+04:00"),
      ev("e3", "2026-08-21T10:00:00+04:00"),
    ]);
    expect(map.get("2026-08-20")).toHaveLength(2);
    expect(map.get("2026-08-21")).toHaveLength(1);
  });

  it("builds a month grid with the right day count", () => {
    const map = groupEventsByDay([ev("e1", "2026-08-20T10:00:00+04:00")]);
    const weeks = buildMonthGrid(2026, 8, map);
    const inMonthCells = weeks.flat().filter((c) => c.inMonth);
    expect(inMonthCells).toHaveLength(31); // August
    // Every week has 7 columns.
    for (const week of weeks) expect(week).toHaveLength(7);
    // The event lands on day 20.
    const day20 = weeks.flat().find((c) => c.day === 20)!;
    expect(day20.events).toHaveLength(1);
  });
});
