import { describe, expect, it } from "vitest";
import {
  defaultMuscatShift,
  isoToMuscatWallClock,
  muscatHour,
  muscatWallClockToIso,
  todayInMuscat,
} from "./dates";

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

describe("defaultMuscatShift", () => {
  it("is MORNING before 16:00 Muscat and EVENING at or after 16:00", () => {
    // 11:00 UTC = 15:00 Muscat.
    expect(muscatHour(new Date("2026-08-19T11:00:00.000Z"))).toBe(15);
    expect(defaultMuscatShift(new Date("2026-08-19T11:00:00.000Z"))).toBe("MORNING");
    // 12:00 UTC = 16:00 Muscat.
    expect(defaultMuscatShift(new Date("2026-08-19T12:00:00.000Z"))).toBe("EVENING");
  });
});

describe("Muscat wall-clock pinning (D17)", () => {
  it("interprets a wall-clock input as Asia/Muscat (+04:00)", () => {
    const iso = muscatWallClockToIso("2026-08-20T16:30");
    expect(iso).toBe("2026-08-20T12:30:00.000Z");
  });

  it("round-trips the same wall clock on any device", () => {
    const iso = muscatWallClockToIso("2026-08-20T00:15");
    expect(isoToMuscatWallClock(iso!)).toBe("2026-08-20T00:15");
  });

  it("returns null for malformed input instead of inventing a time", () => {
    expect(muscatWallClockToIso("not-a-date")).toBeNull();
    expect(muscatWallClockToIso("")).toBeNull();
  });
});
