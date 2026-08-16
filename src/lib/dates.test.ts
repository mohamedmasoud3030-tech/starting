import { describe, expect, it } from "vitest";
import { todayInMuscat } from "./dates";

describe("todayInMuscat", () => {
  it("returns the Muscat calendar day, not the UTC day, after UTC midnight", () => {
    // 2026-08-15 22:30 UTC = 2026-08-16 02:30 in Muscat (UTC+4).
    // The old `new Date().toISOString().slice(0, 10)` defaults produced
    // 2026-08-15 here — yesterday for the operator closing out an evening
    // event — while the server (today_attendance_gaps) already evaluated
    // Asia/Muscat.
    expect(todayInMuscat(new Date("2026-08-15T22:30:00.000Z"))).toBe(
      "2026-08-16",
    );
  });

  it("matches the UTC day when both calendars agree", () => {
    expect(todayInMuscat(new Date("2026-08-15T10:00:00.000Z"))).toBe(
      "2026-08-15",
    );
  });

  it("formats as YYYY-MM-DD (valid date-input value)", () => {
    expect(todayInMuscat(new Date("2026-01-05T12:00:00.000Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});
