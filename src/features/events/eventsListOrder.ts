/**
 * Events list ordering (defect D30). The execution-schedule screen defaults
 * to "upcoming first": future events by soonest date, then past events by
 * most recent — so today's and next events are never buried under history.
 * "CHRONO" keeps plain ascending date order.
 */
export type EventListSortMode = "UPCOMING" | "CHRONO";

export interface SortableEventRow {
  start_at: string;
}

export function orderEvents<T extends SortableEventRow>(
  rows: ReadonlyArray<T>,
  mode: EventListSortMode,
  now: number = Date.now(),
): T[] {
  const copy = [...rows];
  const time = (row: T) => new Date(row.start_at).getTime();
  if (mode === "UPCOMING") {
    const upcoming = copy.filter((e) => time(e) >= now);
    const past = copy.filter((e) => time(e) < now);
    upcoming.sort((a, b) => time(a) - time(b));
    past.sort((a, b) => time(b) - time(a));
    return [...upcoming, ...past];
  }
  return copy.sort((a, b) => time(a) - time(b));
}
