import { describe, expect, it } from "vitest";
import { orderEvents } from "./eventsListOrder";

function row(id: string, iso: string) {
  return { id, start_at: iso };
}

const NOW_MS = new Date("2026-08-20T00:00:00+04:00").getTime();

describe("orderEvents (D30)", () => {
  it("puts upcoming events first by soonest, then past by most recent", () => {
    const rows = [
      row("oldest", "2026-01-01T10:00:00+04:00"),
      row("soon", "2026-08-20T12:00:00+04:00"),
      row("later", "2026-09-01T10:00:00+04:00"),
      row("recentPast", "2026-08-19T12:00:00+04:00"),
    ];
    const ordered = orderEvents(rows, "UPCOMING", NOW_MS);
    expect(ordered.map((r) => r.id)).toEqual([
      "soon",
      "later",
      "recentPast",
      "oldest",
    ]);
  });

  it("keeps plain ascending date order in CHRONO mode", () => {
    const rows = [
      row("b", "2026-09-01T10:00:00+04:00"),
      row("a", "2026-01-01T10:00:00+04:00"),
    ];
    expect(orderEvents(rows, "CHRONO").map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const rows = [
      row("b", "2026-09-01T10:00:00+04:00"),
      row("a", "2026-01-01T10:00:00+04:00"),
    ];
    orderEvents(rows, "UPCOMING");
    expect(rows[0]!.id).toBe("b");
  });

  it("handles an empty list", () => {
    expect(orderEvents([], "UPCOMING")).toEqual([]);
  });

  });
