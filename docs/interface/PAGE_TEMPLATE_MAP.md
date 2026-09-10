# PAGE_TEMPLATE_MAP.md

> Phase 7 deliverable. A small set of reusable page templates and the
> route→template mapping. Templates are based on real routes, not invented.

## 1. The template set

### T1 Overview / Dashboard
- **Use:** a landing that must answer "what needs me now?" with a scannable
  metric/attention structure.
- **Regions:** PageHeader (title/desc) → metric strip (optional, only real
  decisions) → decision cards/rows (each an action/deep-link) → secondary
  lists → shortcuts.
- **Primary content pattern:** cards (decisions) + compact list rows.
- **Responsive:** metric grid 1→2→4/5; card grid 1→2→3.
- **States:** per-block skeleton; partial-load banner; empty; truncation.
- **Do NOT use:** for creating a record, for a single-record detail, or as an
  excuse to add decorative stats.
- **Routes:** `/home` (T1), `/dashboard` (T1 + attention list + grouped K/V).

### T2 Index / List Management
- **Use:** browse many comparable records and open/act on them.
- **Regions:** PageHeader + primary create action → FilterBar (search + filter
  + sort) → data rows/cards → pagination.
- **Primary content pattern:** desktop table-ish list or cards grid per
  Phase 4; always with an explicit mobile transformation.
- **Responsive:** table→stacked-row-list; cards 1→2→3.
- **States:** loading/empty/no-results/error/pagination/truncation.
- **Do NOT use:** for browsing a single aggregate's internals.
- **Routes:** `/events` (T2-table), `/quotes` (T2-cards), `/catalog` (T2-cards),
  `/packages` (T2-cards), `/customers` (T2-cards), `/consumables` (T2-rows),
  `/staff` (T2-rows), `/procurement` (T2-cards+dialogs).

### T3 Record Detail
- **Use:** inspect and act on one record.
- **Regions:** PageHeader (identity + status) → key facts → grouped key/value
  sections → related/history/ledger → contextual actions (print/edit).
- **Primary content pattern:** key-value sections + ledger/timeline lists.
- **Responsive:** 2-col section grid → stack.
- **States:** loading/error/missing (distinct)/per-section empty.
- **Routes:** `/customers/$customerId` (T3), `/staff/$staffId` (T3).

### T4 Create/Edit Form (wizard or single)
- **Use:** capture a new or edited record with validation.
- **Regions:** header → steps or grouped fields → FormActions (sticky).
- **Responsive:** grids collapse to one column.
- **States:** validation/unsaved-guard/submit-lock/success/failure-preserves-input.
- **Routes:** create/edit dialogs across T2/T3 (not full pages), plus
  `/quotes/new`, `/quotes/$quoteId` as a full 3-step wizard.

### T5 Settings
- **Use:** infrequent org/account configuration; role-gated actions.
- **Regions:** sectioned page (org identity/settings; team) with save actions.
- **Responsive:** sections stack.
- **Route:** `/settings`.

### T6 Authentication / Onboarding
- **Use:** unauthenticated entry + first-use.
- **Regions:** centered single card; large targets; Arabic errors.
- **Routes:** `/login`, `/signup`, `/forgot-password`; OnboardingPage in-flow.

### T7 Admin / Operations (read-only integrity + audit)
- **Use:** surfaces that reveal anomalies/audit without offering destructive
  fixes.
- **Regions:** header + read-only alert/list with links to source.
- **Routes:** `/integrity`.

### T8 Operational hubs (custom, justified)
- **Use:** the app is event-centric; `/events/$eventId` and `/operations`,
  `/calendar` do not fit a generic dashboard/card template.
- `/events/$eventId` = **T8a detail-hub:** PageHeader identity + command
  center + segmented tab strip (13 concerns) + per-tab panels.
- `/operations` = **T8b schedule/readiness board:** grouped by horizon.
- `/calendar` = **T8c calendar:** month grid + day list.
- `/reports`, `/accounting` = **T8d report tables:** period control + data
  tables with horizontal containment.
- `/search` = **T8e query results:** grouped results.

## 2. Route → template map
| Route | Template | Justification |
| --- | --- | --- |
| `/home` | T1 | Today-ops dashboard |
| `/dashboard` | T1 (finance) | Owner command + grouped metrics |
| `/events` | T2 | List management |
| `/events/$eventId` | T8a | Detail hub (event-centric) |
| `/quotes` | T2 | List |
| `/quotes/new` `/quotes/$id` | T4 | Wizard |
| `/catalog` `/packages` | T2 | List |
| `/customers` | T2 | List |
| `/customers/$customerId` | T3 | Detail |
| `/operations` | T8b | Schedule board |
| `/calendar` | T8c | Calendar |
| `/procurement` `/procurement/restaurants` | T2 | List |
| `/consumables` | T2 | List/ledger |
| `/staff` | T2 | Roster list |
| `/staff/$staffId` | T3 | Detail |
| `/settings` | T5 | Settings |
| `/reports` `/accounting` | T8d | Report tables |
| `/integrity` | T7 | Integrity list |
| `/search` | T8e | Query results |
| auth routes | T6 | Auth |

> No page is forced into a dashboard/card template that does not fit its task
> (per mandate). Custom hubs T8a–T8e are explicitly justified.
