import { describe, expect, it } from "vitest";
import { rangeForFilter } from "./intelligence.api";

describe("rangeForFilter (E8 — Muscat-safe time ranges)", () => {
  it("today is a single UTC day window", () => {
    const r = rangeForFilter("today");
    const from = new Date(r.from);
    const to = new Date(r.to);
    expect(to.getTime() - from.getTime()).toBe(86_400_000);
  });

  it("week spans 7 days ending at today's UTC boundary", () => {
    const r = rangeForFilter("week");
    expect(new Date(r.to).getTime() - new Date(r.from).getTime()).toBe(7 * 86_400_000);
  });

  it("month starts at the 1st of the current UTC month", () => {
    const r = rangeForFilter("month");
    const from = new Date(r.from);
    expect(from.getUTCDate()).toBe(1);
  });

  it("all spans a wide window", () => {
    const r = rangeForFilter("all");
    expect(new Date(r.to).getTime()).toBeGreaterThan(new Date(r.from).getTime());
  });
});
