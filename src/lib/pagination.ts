import { useEffect, useState } from "react";

/**
 * Shared 0-based pagination primitives for real paged list views (defect D21).
 * Rows are fetched with PostgREST `range(from, to)` plus `count: "exact"`;
 * pages replace the earlier "load more" accumulation windows.
 */

/** PostgREST range for a 0-based page (inclusive bounds). */
export function pageRange(page: number, pageSize: number): [number, number] {
  const from = Math.max(0, page) * pageSize;
  return [from, from + pageSize - 1];
}

/** Number of pages for an exact total, or null when the total is unknown. */
export function totalPagesFor(
  total: number | null,
  pageSize: number,
): number | null {
  if (total == null) return null;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamp a 0-based page to the valid range when the total is known. */
export function clampPage(page: number, totalPages: number | null): number {
  if (totalPages == null) return Math.max(0, page);
  return Math.min(Math.max(0, page), totalPages - 1);
}

/**
 * Page state for one list. The page resets to 0 whenever the organization
 * changes so a stale page number can never leak into another tenant's list.
 */
export function usePagedList(orgId: string | null) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [orgId]);
  return { page, setPage };
}
