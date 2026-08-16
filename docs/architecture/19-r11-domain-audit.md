# R11 — Quotation/domain duplication audit

Status: implementation dependency map (baseline `2b25359b107a7a0668592289930a67baa0227975`)

## Method and scope

The audit traced all repository migrations, public relations, foreign keys, triggers, RLS policies, RPCs, generated types, frontend queries/mutations, pgTAP tests, concurrency harnesses, routes, navigation, and architecture documents. Production project access was not available in this checkout (the Supabase CLI has no access token); consequently no production query or migration is run by R11. The forward migration migrates every matching row transactionally and verifies the migrated counts before any legacy table is dropped.

## Classification

| Area | Classification | Evidence / decision |
|---|---|---|
| `quick_quotes` + `quotations` | **Duplicate aggregate truth** | A draft starts in `quick_quotes`, then issuance copies identity/event fields into `quotations`, links both rows, and mirrors lifecycle state back into `quick_quotes`. `QuotesPage`, `QuotePage`, `QuickQuoteWorkspace`, and `QuoteReviewPage` must understand both identities. Consolidate into `quotations`. |
| `quick_quote_lines` + `quotation_lines` | **Duplicate commercial line truth** | Issuance copies every draft line. The two schemas differ only because the quick path omitted cost/source snapshots. Make `quotation_lines` mutable only while its parent is `DRAFT`, then immutable. |
| `quick_quote_applied_packages` | **Compatibility/workspace marker, not business truth** | It only prevents applying a package twice. Canonical `quotation_lines.source_package_id` can express the same fact while preserving line-level package provenance. Package application is a snapshot; package edits never mutate quote lines. |
| `quotations` for event-first and prospect-first flows | **Intentional variants of one aggregate** | `event_id` is nullable already. Both flows issue the same immutable commercial document and use the same document sequence. Keep one lifecycle and preserve `issue_event_quotation` compatibility. |
| `catalog_items`, `equipment_capacity`, `consumable_stock_items` | **Intentional separate concepts** | Master commercial definition/default prices, reusable temporal capacity, and consumable stock profile are different facts. No merge. UI terminology should communicate the relationship. |
| `packages` + `package_items` | **Intentional templates** | Package rows are reusable composition templates, never historical commercial truth. Applying to a draft expands snapshot lines. |
| `events` + `event_commercial_lines` | **Intentional operational aggregate** | Event lines are editable operational commitments and remain distinct from accepted quotation snapshots. Conversion copies quote snapshots deterministically into event lines. |
| invoices/installments/payments | **Intentional separate financial facts** | Invoice schedule, append-only collections, and accepted quotation revenue authority are not duplicates. Existing event panels expose real contracts; no speculative ledger is added. |
| procurement and staff/payroll | **Intentional operational domains** | Dedicated append-only/command-protected facts with existing concurrency proofs. No schema merge. |
| replay tables | **Compatibility only** | R10 made `command_idempotency` canonical. Three old names are read-only views. R11 extends the canonical scope; it does not recreate replay tables. |

## Quotation dependency map before R11

### Relations and constraints

- `quick_quotes` owns prospect/event draft fields, a `quotation_id` FK, unique create key, and mirrored status.
- `quick_quote_lines` cascades from the workspace and stores selling-only draft snapshots.
- `quick_quote_applied_packages` references workspace and package.
- `quotations` is referenced by `events.accepted_quotation_id`, `invoices.quotation_id`, and its own conversion FK metadata.
- `quotation_lines` references `quotations`; an unconditional trigger prevents update/delete.
- `events` is also referenced by quotation `event_id` and `converted_event_id`; conversion therefore has a circular relationship handled transactionally.

### RLS and grants

- Legacy draft relations have RLS and commercial-manager-only read policies after migration `0018`; writes are RPC-only.
- Canonical quote/cost tables have cost-reader RLS; customer projections expose selling snapshots to organization members.
- All legacy commands are `SECURITY DEFINER`, use an empty `search_path`, and check `can_manage_commercial`.
- The unconditional line immutability trigger must become parent-state-aware so only drafts can be edited.

### RPC reads/writes

Legacy-only commands: `create_quick_quote`, `save_quick_quote_line`, `delete_quick_quote_line`, `reset_quick_quote_lines`, `apply_package_to_quick_quote`, `issue_quick_quote`, `accept_quick_quote`, `convert_quick_quote`, `discard_quick_quote`.

Event-first commands: `issue_event_quotation` and `accept_event_quotation` write canonical snapshots and event status/history. Invoice creation and event finance read the accepted canonical quotation. R11 retains these contracts while moving prospect-first actions to canonical `create_quotation_draft`, `save_quotation_line`, `reset_quotation_lines`, `apply_package_to_quotation`, `issue_quotation`, `accept_quotation`, `convert_quotation_to_event`, and `cancel_quotation_draft`.

### Frontend and tests

- `quotes.api.ts` reads both systems and maps totals between them.
- `/quotes/new` and `/quotes/$quoteId` are already one route family, but implementation names and data identity remain “Quick Quote”.
- Two React suites and two pgTAP suites directly reference legacy objects/RPCs.
- No other frontend feature reads legacy relations. Invoices/payments and event finance consume canonical quotation/event contracts.

## Implemented R11 rules

1. `quotations` is the only quotation aggregate: `DRAFT -> ISSUED -> ACCEPTED -> CONVERTED`, with `CANCELLED` and existing event-revision `SUPERSEDED` terminal states.
2. A draft may have a prospect or an existing `customer_id`; prospect snapshots remain on the aggregate.
3. Draft line totals and aggregate totals are authored by PostgreSQL exact numeric arithmetic. Client totals are previews.
4. Package application snapshots catalog description, type, unit, selling price, expected cost, and source IDs into quote lines. Drafts do not auto-refresh when package/catalog data changes.
5. Issue locks the row, validates it, recomputes all line and aggregate totals, allocates the official number, and makes commercial fields immutable.
6. Acceptance and conversion lock the same row. Conversion reuses only one unambiguous exact active phone match, otherwise creates a customer; it copies quote lines to event commercial lines and prevents a second event structurally and by row lock.
7. Command replay uses R10 `command_idempotency` under the `QUOTATIONS` scope. Same key/payload replays; a conflicting fingerprint fails.
8. Legacy rows are migrated in-place: linked issued workspaces enrich their canonical quote; unissued workspaces become canonical rows using the workspace UUID; draft lines are copied; count assertions run before legacy tables are dropped.
9. No compatibility views are retained because the frontend, tests, and RPC callers migrate in the same release. Keeping writable-looking legacy names would prolong the duplicate model.

## Production safety boundary

R11 does **not** apply its migration to production. Before production deployment an operator with authorized Supabase access must record counts for `quick_quotes`, `quick_quote_lines`, and `quick_quote_applied_packages`, take the normal backup, and review the migration report. The migration itself is data-preserving for non-zero counts and aborts atomically on a count mismatch; this is safer than assuming the known R10 zero replay counts imply zero quotation data.
