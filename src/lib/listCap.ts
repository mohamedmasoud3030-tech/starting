/**
 * List-size honesty guard.
 *
 * PostgREST caps a response at `max_rows` (configured as 1000 in
 * `supabase/config.toml`). The list screens fetch the full organization
 * dataset in one request and filter client-side, so an organization that
 * grows past the cap would silently lose its oldest/newest rows and the
 * owner would make operational decisions on an incomplete list.
 *
 * Every capped list therefore fetches `count: "exact"` together with the rows
 * and surfaces `listIsTruncated()` as an explicit Arabic warning instead of
 * presenting a partial list as the whole truth. Full pagination is tracked as
 * a follow-up (D21 in PROJECT_DEFECTS.md).
 */

export const LIST_PAGE_CAP = 1000;

/**
 * True when the fetched page hit the cap AND the organization actually has
 * more rows than were returned. `total` is null when the count could not be
 * determined — the caller then treats the list as authoritative for that
 * request and shows no warning rather than a false alarm.
 */
export function listIsTruncated(
  dataLength: number,
  total: number | null | undefined,
): boolean {
  return (
    typeof total === "number" &&
    dataLength >= LIST_PAGE_CAP &&
    total > dataLength
  );
}
