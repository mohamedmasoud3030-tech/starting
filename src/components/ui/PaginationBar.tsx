import { Button } from "@/components/ui/Button";
import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationBarProps = {
  /** 0-based current page. */
  page: number;
  pageSize: number;
  /** Total page count, or null while the exact total is still unknown. */
  totalPages: number | null;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  isFetching: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /** Number of rows currently loaded on this page. */
  rowsCount: number;
  /** Exact organization total, or null while unknown. */
  total: number | null;
};

/**
 * Arabic-first page navigation for paged list views (defect D21).
 * RTL semantics: «السابق» navigates rightwards, «التالي» leftwards.
 * Hidden until the exact total proves there is more than one page.
 */
export function PaginationBar({
  page,
  pageSize,
  totalPages,
  hasPreviousPage,
  hasNextPage,
  isFetching,
  onPrevious,
  onNext,
  rowsCount,
  total,
}: PaginationBarProps) {
  if (totalPages == null || totalPages <= 1) return null;

  const fromRow = page * pageSize + 1;
  const toRow = fromRow + rowsCount - 1;

  return (
    <nav
      aria-label="التنقل بين الصفحات"
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm font-semibold text-slate-500">
        عرض {fromRow}–{toRow} من {total ?? "…"}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="lg"
          onClick={onPrevious}
          disabled={!hasPreviousPage || isFetching}
          className="min-h-12 px-5"
        >
          <ChevronRight className="h-5 w-5" />
          السابق
        </Button>
        <span className="min-w-24 text-center text-base font-bold text-slate-700">
          صفحة {page + 1} من {totalPages}
        </span>
        <Button
          variant="secondary"
          size="lg"
          onClick={onNext}
          disabled={!hasNextPage || isFetching}
          className="min-h-12 px-5"
        >
          التالي
          <ChevronLeft className="h-5 w-5" />
        </Button>
      </div>
    </nav>
  );
}
