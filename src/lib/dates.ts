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
