import type { EventRow } from "@/features/events/events.api";

/**
 * Pure calendar helpers: grouping events by local day (Asia/Muscat) and
 * building a month grid. No React, no data access.
 */

export const CALENDAR_TZ = "Asia/Muscat";

/** A local (Muscat) calendar day, in the operator's local year/month/day. */
export interface LocalDay {
  year: number;
  month: number; // 1..12
  day: number;
}

/** Convert an event start timestamp to a Muscat local day. */
export function eventLocalDay(event: EventRow): LocalDay {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CALENDAR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(event.start_at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Group events into a Map keyed by "YYYY-MM-DD". */
export function groupEventsByDay(events: EventRow[]): Map<string, EventRow[]> {
  const map = new Map<string, EventRow[]>();
  for (const ev of events) {
    const d = eventLocalDay(ev);
    const key = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    const bucket = map.get(key) ?? [];
    bucket.push(ev);
    map.set(key, bucket);
  }
  return map;
}

export interface CalendarCell {
  key: string;
  day: number;
  inMonth: boolean;
  events: EventRow[];
}

/** Build a 6×7 grid (weeks starting Sunday) for a given year/month. */
export function buildMonthGrid(
  year: number,
  month: number,
  eventsByDay: Map<string, EventRow[]>,
): CalendarCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startOffset = first.getUTCDay(); // Sunday = 0
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: CalendarCell[] = [];

  // Leading days from the previous month (blank).
  for (let i = 0; i < startOffset; i++) {
    cells.push({ key: `lead-${i}`, day: 0, inMonth: false, events: [] });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({
      key,
      day: d,
      inMonth: true,
      events: eventsByDay.get(key) ?? [],
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, day: 0, inMonth: false, events: [] });
  }

  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

export function monthLabel(year: number, month: number): string {
  return `${AR_MONTHS[month - 1]} ${year}`;
}
