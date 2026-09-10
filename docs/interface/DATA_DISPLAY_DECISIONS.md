# DATA_DISPLAY_DECISIONS.md

> Phase 4 deliverable. The chosen display pattern and rationale for every
> dataset/page, with the transformation strategy and state rules. Uses the
> task-first vocabulary (list / cards / table / detail / timeline / stats).

## 0. Decision heuristics applied (from the mandate)

- **Cards** where each item has a visual identity/summary/status and users
  browse rather than compare many columns.
- **List/table rows** where users scan many items or compare stable columns.
- **Table** only where comparison/density/sort/filter matters; on mobile pick a
  deliberate strategy rather than a squeezed table.
- **Detail/key-value** for inspecting one record.
- **Timeline** for chronological change.
- **Stats** only where the figure answers a real threshold/decision.
- Each pattern gets its responsive transformation, states, and interaction
  rules.

## 1. Per-page pattern decisions

| Page/Dataset | Chosen pattern | Why (task) | Responsive strategy | Density/sort/filter/search/pagination | States |
| --- | --- | --- | --- | --- | --- |
| `/home` metrics | **Stat strip** | Real threshold questions (how many need attention / low-stock / gaps) drive triage | 1-col→2→5 | N/A | skeleton |
| `/home` today events | **Cards** | Each event is a decision (identity+time+readiness+blockers+actions) — not a comparable fixed-column record | grid 1→2→3 | sort = by need then start; no density | skeleton/empty/truncated |
| `/home` collections/closures/alerts | **List rows** (compact) | Single-line actionable rows with amount/badge | full-width rows | N/A | skeleton/empty |
| `/events` list | **Table-ish list** → row list | Users scan + compare schedule + filter/sort; dense but not cell-heavy | Desktop 4-col header; **mobile → stacked row list** (priority fields + status moved in) | sort upcoming/chrono, filter ACTIVE/UPCOMING/CLOSED/ALL, search, real pagination | loading/empty/no-results/error |
| `/events/$eventId` summary | **Detail hub + command center** | One record, many concerns | sections stack | N/A | loading/missing/error |
| event tab: ملخص/التسعير/الفريق… | **Key-value + ledger/tab panels** | Inspect + act per concern | panels reflow | N/A | per-panel empty |
| event tab: السجل / attendance / payroll | **Timeline / ledger list** | Chronological & settlement meaning | stacked | N/A | empty |
| `/quotes` | **Cards** | Browse prospects/quotes with status & totals | 1→2 | search + lifecycle filter | empty/no-results |
| `/quotes/$id`, `/quotes/new` | **Wizard (3 steps)** | Compose-review-then-issue | steps stack | N/A | unsaved-guard/validation |
| `/catalog` | **Cards** | Browse sellable items w/ visual identity + type | 1→2→3 | filter chips + search + pagination | empty/pagination |
| `/packages` | **Cards** | Browse reusable templates | 1→2 | N/A | empty |
| `/customers` | **Cards** | Browse contacts (name+type+phone identity), phone-first on site | 1→2→3 | pagination | empty |
| `/customers/$id` | **Detail key-value sections** | Inspect one relationship + statement | 2-col→stack | N/A | loading/error/missing |
| `/operations` | **Grouped card/row board** | Today/tomorrow/not-ready/dispatch-return groups | sections stack | N/A | loading/empty |
| `/calendar` | **Calendar grid + day list** | Date-scoped browsing | month grid (day cell) → day list | view month/day | loading/error/empty-day |
| `/procurement` | **Cards + dialogs** | Suppliers & order lifecycle management | 2-col | order feed | permission-denied/empty |
| `/consumables` | **Stock list rows + ledger** | Balances & movement ledger | rows | N/A | empty |
| `/staff` | **Roster list → detail** | Team scanning + per-member file | stacks | search/pagination | loading/empty |
| `/staff/$id` | **Detail key-value** | Member HR file | 2-col→stack | N/A | loading |
| `/dashboard` | **Attention list + KPI + grouped key-value** | Owner "what needs me & where is money" | KPI 2→4; sections stack | period control | loading/empty |
| `/reports` | **Tables** (comparison) | Compare events/packages/customers on revenue/margin | **horizontal containment** (comparison essential) + wide scroll on mobile | period control | loading/empty |
| `/accounting` | **Tables + statements** | Aging/customer/supplier | horizontal where comparison | period | loading |
| `/integrity` | **Alert list** | Read-only anomaly detection | stacks | N/A | loading/empty |
| `/search` | **Grouped results list** | Find a record → open it | single column | type≥2 chars | no-results |

## 2. Why these over alternatives (explicit)
- Events **not** rendered as plain cards on `/events` because users compare
  many dates/venues/statuses; a desktop table header gives column context while
  the mobile transformation keeps a single usable column (never a 4-column
  squeeze).
- Customers **not** a table: at a glance the needed facts are few (name/type/
  phone), and on a phone in the field cards/tappable are better than a dense
  row. Edit is a low-frequency action kept in a dialog.
- `/reports` **must** be tables: it is pure comparison of stable numeric
  columns (revenue/collected/outstanding/cost/profit/margin). Squeezing it to
  cards would destroy the comparison the page exists for; it uses horizontal
  containment instead.
- No decorative charts anywhere: no KPI/trend/chart communicates a decision
  the raw tables/stat cards do not already make clearer.
- `customer_payments`, `attendance`, `history`, `warehouse` ledgers are
  **append-only chronological** — represented as **ledger/timeline lists**, not
  editable grids, because their meaning is sequence + non-destructive void.

## 3. Canonical enum/status presentation (M-01, done)
All lifecycle/enum values render through **canonical Arabic labels + tone**
(single source in `@/lib/arabic`; workspace re-exports it). This removes raw
English leaks in reports/reservations and duplicate drifting maps.
- Event status: `EVENT_STATUS_ARABIC` + `EVENT_STATUS_TONES`.
- Equipment reservation status: Arabic badge (ACTIVE/RELEASED/CANCELLED) — M-01.
- Warehouse summary: `WAREHOUSE_STATUS_LABELS`/`TONES` already canonical.
- **Open for a later milestone:** canonicalize the remaining enums the same way
  (quotation, invoice/installment, payment method, procurement order, supplier,
  contract, meal-booking, staff type, membership) so no raw code ever renders
  in Arabic UI. This is the same single-source pattern, expanded.

## 4. Cross-pattern state rules (adopted project-wide)
- Loading mirrors final geometry (skeletons), never a jarring spinner swap.
- Empty and "no-results" are distinct messages with a correct CTA.
- Permission-denied is an in-page surface (see `/procurement`), not a silent
  empty.
- Error allows retry; operational-readiness errors surface "readiness
  unavailable", never fabricated "ready".
- Truncation (PostgREST cap) is called out in Arabic, never silent.
