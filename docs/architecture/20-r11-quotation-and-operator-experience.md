# R11 — Canonical quotation and operator experience

## Delivered architecture

R11 removes the product split between “Quick Quote” and “Quotation”. The route family `/quotes`, `/quotes/new`, and `/quotes/$quoteId` now reads and writes only `quotations` and `quotation_lines`.

### Lifecycle

```text
DRAFT → ISSUED → ACCEPTED → CONVERTED
  └──────→ CANCELLED
ISSUED → SUPERSEDED (existing event-first revision rule)
```

A draft supports prospect details or an existing customer link, optional event facts, quote-owned lines, exact selling/cost snapshots, package provenance, save/reopen, and cancellation. It has no official number. `save_quotation_draft` replaces the header and complete line collection in one database transaction; both Save Draft and Issue use this shared persistence path. Full replacement is restricted to a locked `DRAFT`, so new/edited/deleted lines cannot be partially persisted or duplicated by retry. Issue is an explicit confirmed transition that locks the quote, validates/recomputes lines, allocates the document number, snapshots totals, and makes commercial facts immutable.

Acceptance and conversion are separate transactional commands. Conversion creates one customer only when needed, creates one confirmed Event, copies commercial lines to the Event, and records audit/replay state. The converted quotation remains the revenue authority for invoices and payments.

### Package snapshot rule

Applying a package expands its current catalog/package composition into quotation-owned lines. Source IDs remain provenance only. Draft and issued lines do not subscribe to later package or catalog changes. Re-applying the same package is rejected unless the operator deliberately resets/rebuilds the draft.

### Money authority

The browser uses integer milli-OMR helpers only for responsive previews. PostgreSQL computes persisted line selling/cost totals and aggregate selling/cost/profit with exact numeric arithmetic. Issue recomputes everything again under lock. Customer-facing projections expose no cost to unauthorized roles; expected cost columns are `NULL` unless `can_read_cost` is true.

### Replay and concurrency

R10 `command_idempotency` remains the only physical replay register and now includes the `QUOTATIONS` namespace. Create, issue, accept, and conversion use canonical request fingerprints. Quote row locks serialize competing lifecycle transitions; the unique converted Event relationship is a second structural guard. `scripts/native-db/quotation_concurrency.mjs` provides the separate-session issue/conversion race proof.

### Security

All canonical writes are RPC-only. Functions are `SECURITY DEFINER`, pin an empty `search_path`, qualify objects, and verify `can_manage_commercial`. Draft read models require that commercial role; issued customer snapshots retain organization-member visibility without exposing costs. The raw replay register remains inaccessible.

## Data migration

The forward migration:

1. maps every legacy workspace to its linked issued quotation or creates a canonical draft with the same UUID;
2. enriches linked issued rows with prospect/event metadata;
3. copies every unissued draft line;
4. compares source/mapped aggregate and line counts and aborts on mismatch;
5. removes legacy RPCs, tables, and enum only after assertions pass.

There are no compatibility views: frontend callers, tests, commands, and documentation move together. Production is intentionally not migrated from this development checkout. Independent authorized review recorded zero rows in all three legacy Quick Quote relations and both canonical quotation relations, with production history ending at `20260816004050 / 0049`; backup and forward-migration review remain deployment gates.

## Operator experience

- Quotation list: one lifecycle, Arabic status filters, search, exact totals, and a single create action.
- Draft editor: focused three-part flow, package/custom lines, exact preview, save/reopen, safe cancellation, and an explicit immutable-issue confirmation showing the final total.
- Quotation review: customer/event snapshots, line commitments, total, acceptance, and conversion in one hierarchy.
- Events: responsive list/table hybrid with customer, schedule, venue, guests, consistent semantic state, search, and useful lifecycle filters.
- Dashboard and grouped navigation remain workflow-based from R10; no placeholder finance/admin section was added.
- Existing real Event invoice/payment, procurement, warehouse, consumable, attendance, and payroll workspaces remain integrated rather than duplicated.

## Intentionally deferred

- No standalone finance route was added: invoices and payments remain on Event workspace because that is the complete existing backend/user contract.
- Discount and tax fields were not invented; the current approved commercial schema defines neither rule.
- Production migration execution and production legacy row counts require authorized Supabase project access and are not performed by this repository change.
