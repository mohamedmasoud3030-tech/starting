import { useParams } from "@tanstack/react-router";
import { useAuth } from "@/app/authContext";
import { useQuotation } from "./quotes.api";
import { QuotationEditor } from "./QuotationEditor";
import { QuotationReview } from "./QuotationReview";

/**
 * Route shim for /quotes, /quotes/new and /quotes/$quoteId.
 * A DRAFT quote opens the editable workspace; anything issued opens the
 * immutable review page (accept → convert to Event).
 */
export function QuotePage() {
  const { quoteId } = useParams({ strict: false });
  const { currentOrganization, canManageCommercial } = useAuth();
  const orgId = currentOrganization?.id ?? null;

  const quote = useQuotation(orgId, quoteId ?? "");

  if (!quoteId) {
    return <QuotationEditor />;
  }
  if (quote.isLoading) return <p>جارٍ التحميل…</p>;
  if (!quote.data) return <p>تعذر العثور على عرض السعر.</p>;
  if (quote.data.status === "DRAFT") {
    return canManageCommercial ? <QuotationEditor draftId={quoteId} /> : null;
  }
  return <QuotationReview quoteId={quoteId} />;
}
