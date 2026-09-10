# PAGE_CONTENT_ARCHITECTURE.md

> Phase 2 deliverable. Decides what each page should display, in what
> hierarchy, and for whom, based on the user's actual task. Companion to
> `INTERFACE_ROUTE_INVENTORY.md` (what exists) and
> `DATA_DISPLAY_DECISIONS.md` (which pattern). Content that does not support a
> real decision is treated as noise regardless of whether the current build
> shows it.

## 0. Content-hierarchy method used

1. Name the single **primary question** the person lands with.
2. The **required content** must be enough to answer it and act in place.
3. Everything else is **supporting** (progressively disclosed / lower region).
4. One **primary action** per page; a small set of **secondary** ones; only
   genuine destructive actions, each behind a safeguard.
5. States are prescribed per pattern (see `DATA_DISPLAY_DECISIONS.md`).

Two meta-decisions (owner persona is a 50+ operator; RTL Arabic-first):
- **Fewer, larger, clearer actions beat dense menus.**
- **Cost/finance surfaces are shown to cost roles only** (server truth), so a
  page's required content legitimately differs by role — that is correct, not
  a gap.

---

## 1. Matrix (all routes)

Legend — Primary Action (PA), Secondary (2A), Destructive (D). States listed
only where non-default. Data sources abbreviated per inventory.

| Route | Page Goal | Role | Primary Question | Required Content | Supporting Content | PA | 2A | D | States | Data | Pattern | Mobile | Desktop | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/home` | Today's ops triage | ALL | What needs attention today? | today events w/ readiness + blockers; alerts | collections/closures (role), low-stock, attendance gaps | Open event center | WhatsApp share; jump to lists | none | loading/empty/error/truncated | server projections | cards 1→2→3 | stat row 1→5 + cards | Operator can see today's risk and deep-link to resolve in ≤2 taps |
| `/events` | Event management | ALL | Which event, when, and its center | number/title/customer/start/venue/guests/status | search, filters | Open workspace (row) | New event; change view | (close/cancel lives in center) | loading/empty/no-results/error | list(table-ish) | stacks to rows | 4-col table | Row tap opens the right event; filters/sort act instantly |
| `/events/$eventId` | One event end-to-end | ALL per-tab | What does this event still need? | header facts + readiness command center | 13 expert tabs | Act on command-center blocker | switch tab; print sheets | cancel/status transitions (gated) | loading/missing/error | hub + tabs | tabs scroll, panels stack | command center + tabs | Each role sees only its tabs; blocker → resolves in the correct tab |
| `/quotes` | Quote pipeline | commercial | Which quote next? | quote, customer, lifecycle, totals | search/filter | open/edit quote | new quote | cancel draft (dialog) | empty/no-results/loading | cards | 1→2 cols | cards/rows | see & act on the actionable quote |
| `/quotes/new` `/quotes/$quoteId` | Compose/issue a quote | commercial | What services at what price? | details → services → review | cost snapshots, package apply | Save draft / Issue | apply package; accept | (revision cancels old quote) | unsaved-guard/validation | wizard | stacked | 3 steps | draft persists atomically; issued quote immutable |
| `/catalog` | Sellable catalog | ALL read, comm write | What can I sell & price? | name/type/sell-price (+cost for cost roles) | category, availability | add item | edit | ACTIVE/INACTIVE (no delete) | loading/empty/pagination | cards | 1→3 | 1→3 | add/edit gated; cost hidden to non-cost |
| `/packages` | Quote templates | commercial | Which template to reuse | name, items, indicative price | usage | new package | edit | INACTIVE (no delete) | empty | cards | stacks | 2-col | templates apply as snapshots |
| `/customers` | Customer directory | ALL (write per role) | Who & how to reach | name/type/phone/whatsapp | notes | new customer | edit | none (no delete) | pagination | cards | 1→3 | 1→3 | create/edit role-gated; dup-phone guarded |
| `/customers/$id` | Customer standing | ALL | What is this client's standing? | identity, contacts, financial position (role) | event history | print statement | edit; open event | none | loading/error/missing | key-value blocks | stacks | 2-col | role-gated money; statement prints from data |
| `/operations` | Schedule/readiness board | ALL | Today/tomorrow, not ready, dispatch/return | grouped active events + readiness | counts | open event | (jump to /events) | none | loading/empty | grouped cards | stacks | grouped rows | fills the "today + near queue" ops role |
| `/procurement` | Suppliers & orders | cost roles | What to order/receive? | suppliers, PO lifecycle | receive status | open/approve/order | receive | cancel order | permission-denied (non-cost) | cards+dialogs | stacks | 2-col | non-cost sees clear message; writes gated |
| `/procurement/restaurants` | Contracted restaurants | cost roles | Which contract/booking? | restaurant, contract, meal bookings | finance values | new contract/booking | manage | — | permission | cards/list | stacks | — | accurate PENDING/CONFIRMED/SERVED |
| `/consumables` | Consumable stock | ALL (adj OWNER/MGR) | What's in stock & low? | balances, low-stock | ledger, movements | issue/receive | adjust (role) | — | empty/no-ledger | list rows | stacks | — | balances can't go negative |
| `/staff` | Team & HR roster | ALL (HR payroll.read) | Who is on the team? | name, role, contact, status | HR extras | open member file | add member | none | loading/empty | list | stacks | table | member file reachable; HR/payroll gated |
| `/staff/$id` | Member HR file | payroll/HR read | This member's engagement & finance | identity, contract, expiries, attendance, finance | history | open event/attendance | print | — | loading | key-value | stacks | 2-col | hosts treated as per-event, no leave register |
| `/settings` | Org identity/team | ALL (actions per role) | Org settings & members | org identity/settings, members | — | save | manage team (OWNER) | — | loading | settings sections | stacks | sections | membership OWNER-only |
| `/calendar` | Calendar view | ALL | What's on this date? | month/day grid + events | readiness chips | select day / open event | — | — | loading/error | calendar grid | month/day | month grid | day list | open event from day |
| `/dashboard` | Owner command | cost roles | Attention & money today | attention queue + KPIs + grouped metrics | top packages | open source record | change period | — | loading/empty | alert list+KPI | KPI 2→4 | KPI 4 + grouped | every figure links to source |
| `/reports` | Financial reporting | cost roles | Real revenue/profit/margin by what? | revenue/profit tables; customers/packages | period | open event/customer | change period | — | loading/empty | tables | horizontal scroll | full tables | Arabic statuses; exact OMR |
| `/accounting` | Ledger/statements | cost roles | What do statements & aging say? | aging, customer/supplier statements | drill | print/open | period | — | loading | tables/statements | scroll | full | posting-contract aligned |
| `/integrity` | Data-integrity | cost roles | Impossible states? | read-only anomaly list | severity | open source | — | none (no auto-fix) | loading/empty | alert list | stacks | list | anomalies explainable, no auto-fix |
| `/search` | Global search | ALL | Where is that record? | grouped results | — | open destination | — | — | empty/no-results | grouped results | single col | grouped | opens correct workspace |

## 2. Deep-dives (the three highest-traffic pages)

### 2.1 `/home` — Today operations
- **Why:** the morning "what's happening & what needs me" decision.
- **Required:** today events each with time, status, readiness and its blockers
  (each blocker links to the tab that resolves it); an operational alert list.
- **Supporting (role-disclosed):** "needs collection" (finance/payment roles),
  "ready to close" (manage/closure roles), low-stock + attendance-gap alerts,
  admin shortcuts, first-steps for a brand-new org.
- **Hierarchy:** metrics strip (scannable) → today events (the decisions) →
  alerts → shortcuts. Money is deliberately **separate** from operational
  readiness so readiness is never conflated with collection.
- **Primary action:** open the event command center. **Secondary:** WhatsApp
  share (operational only). **No destructive action.**
- **States:** skeleton per block; a partial-load failure shows an explicit
  banner rather than silently treating readiness as ready; truncation notice.

### 2.2 `/events/$eventId` — Event center
- **Why:** all execution for one event lives here; the whole product is
  event-centric.
- **Required:** identity header (number, title, dates, venue, status) + a
  command center on ملخص that states "what is still needed" with one-tap
  paths into the exact tab.
- **Hierarchy of tabs (by persona frequency):** ملخص (decision) → التسعير /
  الفريق / المعدات / المخزن / المواد (preparation) → المدفوعات / الفواتير /
  المالية (finance, cost role) → الحضور / الأجور → السجل. 13 peer tabs is
  heavier than ideal for the persona (see Phase 3 candidate); the command
  center softens this by steering actions.
- **Primary action:** resolve the highest blocker. **2A:** print operational
  sheets (work order/team/warehouse/prep/return — no money). **Destructive:**
  status transitions & cancellation — server commands with audit; never
  client delete.
- **States:** loading, event-not-found, error, per-tab empty/ledger states.

### 2.3 `/quotes/new` — Quote composition
- **Why:** transforms a prospect's request into an accepted, revenue-authority
  quotation that becomes a confirmed event.
- **Required:** 3 ordered steps (تفاصيل → خدمات → مراجعة). Step 1 needs
  customer/guests/type/venue; Step 2 needs the priced service snapshot (or
  custom lines); Step 3 is a **review of the totals before issue**.
- **Primary action:** Save draft while composing; **Issue** (`QT-…`, finalizes
  immutable snapshot) once complete. **2A:** accept → convert to a CONFIRMED
  event (race-safe, idempotent).
- **Destructive:** cancelling a draft (dialog explains no customer/event is
  created). **Safeguard:** unsaved-edit guard on navigation/beforeunload.
- **States:** pending persist, validation errors, issue error, unsaved-changes
  indicator.

## 3. Information the pages must not over-emphasize
- Raw DB enums and internal codes (English) must never be the displayed value
  — mapped through canonical Arabic labels (UI-1/UI-2/UI-3 fixed in M-01).
- Financial/cost figures on non-cost surfaces are **not** UI-hidden "soft"
  values to decorate — they are excluded at the data boundary.
- No decorative charts or KPIs are added anywhere unless they answer a stated
  decision (per mandate). The current dashboards only carry decision figures.
