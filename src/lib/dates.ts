/**
 * Oman operational date helpers.
 *
 * The business operates in Asia/Muscat (UTC+4). `new Date().toISOString()`
 * yields the UTC day, which is YESTERDAY between 00:00 and 04:00 local time —
 * exactly the hours a hospitality crew closes out an evening event. Every
 * "today" default the operator sees must therefore be computed in the
 * operational time zone, matching the server side (today_attendance_gaps and
 * friends already evaluate 'Asia/Muscat' in SQL).
 */

export const OPERATIONAL_TIME_ZONE = "Asia/Muscat";

/** Today's date (YYYY-MM-DD) in the Oman operational time zone. */
export function todayInMuscat(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Muscat-pinned wall-clock helpers (defect D17).
 *
 * The business operates in Asia/Muscat (UTC+4, no DST). `datetime-local`
 * inputs are interpreted by the browser in the DEVICE's timezone, so an
 * operator working outside Oman would previously save shifted event times.
 * These helpers pin the entered wall clock to the operational timezone in
 * both directions.
 */

const MUSCAT_OFFSET_MINUTES = 4 * 60;

/**
 * Interpret a `datetime-local` value ("YYYY-MM-DDTHH:mm") as an Asia/Muscat
 * wall-clock time and return the exact ISO instant with the +04:00 offset.
 * Returns null for unparsable input so callers can fall back to the raw
 * value instead of inventing a time.
 */
export function muscatWallClockToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 4,
    Number(minute),
  );
  return new Date(utc).toISOString();
}

/**
 * Format an ISO instant as the wall clock an operator sees in Muscat
 * ("YYYY-MM-DDTHH:mm") for a `datetime-local` input.
 */
export function isoToMuscatWallClock(iso: string): string {
  const date = new Date(iso);
  const muscatMs = date.getTime() + MUSCAT_OFFSET_MINUTES * 60_000;
  const d = new Date(muscatMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
