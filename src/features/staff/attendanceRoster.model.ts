/**
 * Supervisor-controlled event attendance roster (frontend derivation only).
 *
 * Visual states map existing canonical attendance rows:
 *   لم يصل → no recorded check-in
 *   حضر   → recorded check-in, no check-out (open punch)
 *   خرج   → recorded check-in and check-out
 *
 * No new database statuses. Wages stay server-authoritative.
 */

import { isOpenPunch, type AttendanceSummary } from "./staff.api";

export type RosterVisualStatus = "NOT_ARRIVED" | "ARRIVED" | "CHECKED_OUT";

export const ROSTER_STATUS_LABELS: Record<RosterVisualStatus, string> = {
  NOT_ARRIVED: "لم يصل",
  ARRIVED: "حضر",
  CHECKED_OUT: "خرج",
};

export const ROSTER_FILTERS = ["ALL", "NOT_ARRIVED", "ARRIVED", "CHECKED_OUT"] as const;
export type RosterFilter = (typeof ROSTER_FILTERS)[number];

export const ROSTER_FILTER_LABELS: Record<RosterFilter, string> = {
  ALL: "الكل",
  NOT_ARRIVED: "لم يصل",
  ARRIVED: "حضر",
  CHECKED_OUT: "خرج",
};

export function rosterVisualStatus(
  row:
    | Pick<AttendanceSummary, "recordStatus" | "checkIn" | "checkOut" | "status">
    | undefined
    | null,
): RosterVisualStatus {
  if (!row || row.recordStatus !== "RECORDED" || row.status === "ABSENT" || !row.checkIn) {
    return "NOT_ARRIVED";
  }
  if (row.checkOut) return "CHECKED_OUT";
  return "ARRIVED";
}

/**
 * Pick the attendance row that drives the roster visual state for one host.
 * Prefer an open punch (currently inside), else the latest recorded row.
 */
export function pickAttendanceForRoster(
  rows: ReadonlyArray<AttendanceSummary>,
  staffMemberId: string,
): AttendanceSummary | undefined {
  const mine = rows.filter(
    (row) => row.staffMemberId === staffMemberId && row.recordStatus === "RECORDED",
  );
  const open = mine.find((row) => isOpenPunch(row));
  if (open) return open;
  return [...mine].sort((a, b) => {
    const aKey = a.checkIn ?? a.createdAt;
    const bKey = b.checkIn ?? b.createdAt;
    return bKey.localeCompare(aKey);
  })[0];
}

export interface RosterCounts {
  total: number;
  /** Anyone with a recorded check-in (حضر + خرج). */
  arrived: number;
  /** Currently inside (open punch). */
  present: number;
  checkedOut: number;
  notArrived: number;
}

export function rosterCounts(statuses: ReadonlyArray<RosterVisualStatus>): RosterCounts {
  let present = 0;
  let checkedOut = 0;
  let notArrived = 0;
  for (const status of statuses) {
    if (status === "ARRIVED") present += 1;
    else if (status === "CHECKED_OUT") checkedOut += 1;
    else notArrived += 1;
  }
  return {
    total: statuses.length,
    arrived: present + checkedOut,
    present,
    checkedOut,
    notArrived,
  };
}

export function matchesRosterFilter(
  status: RosterVisualStatus,
  filter: RosterFilter,
): boolean {
  return filter === "ALL" || filter === status;
}

export function matchesHostSearch(name: string, query: string): boolean {
  const term = query.trim().toLocaleLowerCase("ar");
  if (!term) return true;
  return name.toLocaleLowerCase("ar").includes(term);
}

export function formatRosterTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ar-OM", {
    timeZone: "Asia/Muscat",
    hour: "2-digit",
    minute: "2-digit",
  });
}
