import { useParams } from "@tanstack/react-router";
import { useAuth } from "@/app/AuthContext";
import { useQuickQuote } from "./quotes.api";
import { QuickQuoteWorkspace } from "./QuickQuoteWorkspace";
import { QuoteReviewPage } from "./QuoteReviewPage";

/**
 * Route shim for /quotes, /quotes/new and /quotes/$quoteId.
 * A DRAFT quote opens the editable workspace; anything issued opens the
 * immutable review page (accept → convert to Event).
 */
export function QuotePage() {
  const { quoteId } = useParams({ strict: false });
  const { currentOrganization, canManageCommercial } = useAuth();
  const orgId = currentOrganization?.id ?? null;

  const quote = useQuickQuote(orgId, quoteId ?? "");

  if (!quoteId) {
    return <QuickQuoteWorkspace />;
  }
  if (quote.isLoading) return <p>جارٍ التحميل…</p>;
  if (!quote.data) return <p>تعذر العثور على عرض السعر.</p>;
  if (quote.data.status === "DRAFT") {
    return canManageCommercial ? <QuickQuoteWorkspace draftId={quoteId} /> : null;
  }
  return <QuoteReviewPage quoteId={quoteId} />;
}
