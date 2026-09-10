# INTERFACE_ROUTE_INVENTORY.md

> Phase 1 deliverable. Maps every meaningful route, view, role, journey and
> interface state in the product. Grounded in `src/routes.tsx`,
> `src/components/layout/navConfig.ts`, the lazy route table in
> `src/routes.lazy.tsx`, the feature screens under `src/features/**`, and
> verified behavior in `PRODUCT_SPEC.md`/`PROJECT_STATUS.md`. Compiled by
> direct source + runtime-evidence inspection on 2026-09-09.

## 1. Roles and capabilities (server-authoritative)

| Role | Meaning | Key boundaries used by the interface |
| --- | --- | --- |
| `OWNER` | Office owner (primary persona, 50+) | Everything; the only role for membership + audit retention |
| `MANAGER` | Senior operator | Everything except membership management |
| `ACCOUNTANT` | Financial role | Cost + finance read/write; no commercial setup, no procurement write |
| `SUPERVISOR` | Field/ops lead | Ops + attendance + warehouse dispatch/return + customer write; **no cost visibility** |
| `WAREHOUSE` | Storekeeper | Warehouse dispatch/return + consumables issue/return; **no cost visibility, no finance** |

Server enforces every boundary (RLS + security-definer commands). The UI hides
nav and surfaces per role for clarity but is never the security boundary.

The capability model (`src/lib/capabilities.ts`) is the presentation truth:
`quotation.manage`, `quotation.issue`, `cost.visibility`, `payroll.read`,
`event.manage`, `finance.manage`, `payment.record`, `payment.void`,
`invoice.manage`, `warehouse.dispatch`, `attendance.record`, `customer.write`.

## 2. Navigation model (AppShell)

- **Desktop/tablet (≥md):** persistent right-side RTL sidebar, grouped into
  role-filtered groups. Currently 8 groups (`الرئيسية`, `المناسبات`,
  `المبيعات والعملاء`, `التشغيل والمخزن`, `المشتريات`, `الفريق`,
  `الإدارة والتحليل`, `النظام`).
- **Mobile (<md):** bottom quick bar with 3 role-permitted primary targets
  (`/home`, `/events`, `/customers`) + a "المزيد" slide-up drawer that lists
  all grouped nav items in 2-column grids, plus logout.

## 3. Route-by-route inventory

Legend — **Roles:** O=OWNER, M=MANAGER, A=ACCOUNTANT, S=SUPERVISOR, W=WAREHOUSE,
ALL=all members. **Pattern** uses the vocabulary in Phase 4.

### 3.1 Authentication (public, outside AppShell)

| Route | Page | Allowed | Purpose | Primary task | Current content/actions | Data source | Display | Mobile/Desktop | Confirmed problems |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/login` | تسجيل الدخول | public | Sign in to an org | Enter email/password → enter | Email, password, show/hide, submit; "not configured" state without `.env`; Arabic errors (rate-limit, unconfirmed) | Supabase Auth | Centered single card | Full-width card, large targets | None found |
| `/signup` | إنشاء حساب | public (owner policy: provisioning ops; see §4) | Create an account | Fill name/email/password → verify | Profile fields + password confirm | Supabase Auth | Single card | Single column | Self-signup gating is an **owner policy** (not UI) |
| `/forgot-password` | استعادة كلمة المرور | public | Reset password | Email → send reset | Email + submit | Auth | Single card | Single column | None |
| `/` | redirect | public | Land on the app | — | Throws redirect → `/home` | — | — | — | Fine |

There is **no** `/onboarding` route; `OnboardingPage` renders inside the auth
flow after sign-in for an org-less new user (first-use experience), not a
top-level destination.

### 3.2 Operational home

| Route | Page | Roles | Purpose | Primary question | Content/actions | Data source | Pattern | Responsive | Problems |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/home` | لوحة متابعة اليوم | ALL | Today's operational dashboard | What is happening today and what needs my attention? | 5 KPI stat cards (today/ready/attention/attendance-gap/low-stock); **cards** per today event with readiness badge + per-blocker deep-link chip + WhatsApp share; separate finance-gated "needs collection" and closure-gated "ready to close" row lists; alerts list; 3 admin shortcuts; first-steps card for a new org | `useOperationalDashboard` (server projections `event_readiness_batch`, metrics) | Stat cards + event cards + compact list rows | Cards 1→2→3 cols; stat 1→5; list rows reflow | N+1 readiness fan-out (D19) noted at scale; otherwise strong. Readiness & finance separation is correct |

### 3.3 Events (the operational center)

| Route | Page | Roles | Purpose | Primary question | Content/actions | Data source | Pattern | Responsive | Problems |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/events` | كل المناسبات | ALL | Browse/manage events | Which event and when, and open its center | Search (number/title/venue/customer), sort (upcoming/chrono), status filter, pagination; **row-list** (table-like on desktop) with row→workspace; create-event dialog (gated on active customers) | `events.api` | Hybrid list/table (desktop) → single-column list (mobile) | Header row hidden <md; columns stack into list rows; status badge moves under the fold | Row itself is a full-width `<button>` (good touch target); pagination present. See D21 resolution |
| `/events/$eventId` | مركز القيادة + مركز المناسبة | ALL (tabs per role) | One event end-to-end | What does this event still need, and where do I act? | Header (number, dates, venue, status) → **command center** (server readiness + blocker shortcuts) on ملخص → **13 tabs**: ملخص, التسعير, الفريق, المعدات, المخزن, المواد, المشتريات, المدفوعات, الفواتير, المالية, الحضور, الأجور, السجل | `event_readiness_batch` + per-tab projections | Detail hub with command center + segmented tabs | Tabs horizontal-scroll on mobile (see problem); panels reflow | **13 peer tabs** is heavy for the simplicity persona; some tab groups are financial/ops. Grouping or progressive disclosure is a candidate (Phase 3), but risky because deep links use `?tab=` |

### 3.4 Sales — quotations

| Route | Page | Roles | Purpose | Primary question | Content/actions | Data source | Pattern | Responsive | Problems |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/quotes` | عروض الأسعار | commercial (quotation.manage/issue) | Pipeline of quotes | Which quote needs action next? | Search + lifecycle filter; draft → issue → accept; quote cards grid; "new quote" → `/quotes/new`; cancel-draft dialog | `quotes.api` | Cards grid (browse) 1→2 cols | Reflows | None found |
| `/quotes/new` | إنشاء عرض سعر | commercial | Compose a quote | What services at what price? | 3-step editor: تفاصيل (customer/guests/package/venue) → خدمات (snapshot expansion + custom lines) → مراجعة; atomic draft persistence + unsaved-edit guard | `quotes.api` + catalog/packages | Multi-step wizard (stepper) | Stacked steps on mobile | Autosave deferred (D22) — out of UI-architecture scope |
| `/quotes/$quoteId` | عرض سعر (تعديل/مراجعة) | commercial | Review or edit one quote | Is this quote correct before issue/accept/convert | DRAFT → editor; ISSUED+ → read-only review + accept → convert creates CONFIRMED event | `quotes.api` | Same editor / review | Reflow | None found |

### 3.5 Commercial setup

| Route | Page | Roles | Purpose | Primary question | Content/actions | Data source | Pattern | Responsive | Problems |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/catalog` | دليل الخدمات والمواد | ALL read; write = commercial | Catalog of sellable items | What can I sell and at what price? | Paginated **cards**; search + type/category filter chips; cost fields revealed only for cost roles; item dialog (add/edit, ACTIVE/INACTIVE, no delete) | `catalog.api` | Cards grid 1→2→3 + dialog form | Reflow | None found |
| `/packages` | الباقات | commercial (nav-gated) | Reusable quote templates | Which template to reuse | Cards grid of package templates; package dialog with items; ACTIVE/INACTIVE | `packages.api` | Cards grid | Reflow | None found |

### 3.6 Customers

| Route | Page | Roles | Purpose | Primary question | Content/actions | Data source | Pattern | Responsive | Problems |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/customers` | العملاء | ALL (write = customer-write roles) | Directory of customers | Who is this client and how to reach them | Paginated **cards** (name, type badge, phone/whatsapp, edit); create/edit dialog; duplicate-phone guard | `customers.api` | Cards grid 1→2→3 | Reflow | Mobile bottom bar includes /customers — good for phone lookup on site |
| `/customers/$customerId` | ملف عميل | ALL | One customer's relationship | What is this customer's standing? | Key/value blocks: العلاقة (type, contacts), التاريخ التجاري (events/quotes), financial relationship summary (cost-gated) + 2x2 stat grid; print account-statement dialog | `customer_360` | Detail key-value + grouped sections | Two-column section grid stacks on mobile | None found |

### 3.7 Operations, procurement, warehouse, stock

| Route | Page | Roles | Purpose | Primary question | Content/actions | Data source | Pattern | Responsive | Problems |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/operations` | لوحة التشغيل | ALL | Daily ops grouped by horizon | Today, tomorrow, what's not ready, dispatch/return queue | Groups of events from live list + batch readiness; open event | `events.api` + `event_readiness_batch` | Grouped cards/rows | Stacks | Duplicates some `/home` & `/calendar` framing (Phase 3 — reduce overlap or make it the deep "schedule readiness" board) |
| `/procurement` | الموردون وأوامر الشراء | cost roles only | Suppliers + purchase orders | What must I order/receive? | Suppliers area (ACTIVE/INACTIVE) + orders feed (lifecycle), order cards, create/receive/approve dialogs; non-cost roles see a clear permission message | `procurement.api` | Cards + dialogs; permission state | Reflow | Non-cost roles get a **permission-denied** surface (correct pattern) |
| `/procurement/restaurants` | المطاعم المتعاقدة | cost roles only | Contracted restaurants + meal bookings | Which restaurant is contracted and its meal bookings? | Contract list + PENDING/CONFIRMED/SERVED/CANCELLED meal bookings; financial values exact | `restaurants.*` | Cards/lists | Reflow | None found |
| `/consumables` | مخزون المواد | ALL (adjust = OWNER/MANAGER) | Consumable stock balances | What is in stock and what is low? | Stock list rows/`TrackNewItem`; ledger with receive/issue/waste/adjust; low-stock surfaced | `consumables.api` | List rows + cards | Reflow | Inventory list shows raw reservation/lifecycle statuses in places (fixed for reservations in milestone M-01) |
| `/warehouse` (in-event) | المعدات/المخزن (workspace tabs) | per warehouse capability | Dispatch/return/reconcile reusable equipment | What equipment is out and is it reconciled? | `WarehousePanel` reservation ledger, dispatch/return (good/damaged/lost), reconcile; print sheets | `warehouse.*` | Detail panel + ledger | Panels | Reservation status leaked raw English — **fixed (M-01)** |

### 3.8 Staff & HR (team)

| Route | Page | Roles | Purpose | Primary question | Content/actions | Data source | Pattern | Responsive | Problems |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/staff` | الفريق والموارد البشرية | ALL (HR/payroll = payroll.read) | Team roster + member files | Who is on the team? | Roster rows → per-member file; staff-member dialog; HR fields (hire/birth/job/dept/emergency/IBAN/contract, id/health expiries) | `staff.api` | List/table | Reflow | Attendance & payroll intentionally live **inside the event lifecycle**, not here (correct per 0102) |
| `/staff/$staffId` | الملف الشخصي للعضو | payroll/HR read | Full per-member file | This member's engagement, contracts, expiries, event attendance & finance | Key-value HR file + engagement/contract + attendance history + host finance; per domain the team are **hosts**, no leave register | `staff.api` | Detail key-value + sections | Stacks | None found |

### 3.9 Management / analysis (owner & finance)

| Route | Page | Roles | Purpose | Primary question | Content/actions | Data source | Pattern | Responsive | Problems |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/dashboard` | لوحة الإدارة | cost roles (financial) | Owner command center | What needs my attention and where is the money? | Attention queue (server alerts, severity) + 4 KPI + grouped metrics (التشغيل/المبيعات/المالية cost-gated); every figure is a link into source records | `management_metrics`, `management_alerts` | Dashboard: alert list + KPI + grouped key-value tables | KPI 2→4; sections stack | Well-scoped; overlaps with `/home` attention framing but is financial+strategic while `/home` is today-ops |
| `/reports` | التقارير | cost roles (financial) | Financial reporting | What is the real revenue/profit/margin and by what? | Period segmented control; **tables**: revenue & profit by event; package usage vs profit; top customers; wide tables scroll horizontally on mobile | `report_events`, `report_packages`, `report_customers` | Data tables (comparison) with horizontal containment | Horizontal scroll on mobile (comparison essential) | **Raw English event status leaked in the event table — fixed (M-01)** |
| `/accounting` | المحاسبة | cost roles (financial) | Ledger/treasury/statements | What do the customer/supplier statements and aging say? | Aging + customer statement + supplier statement sections | accounting projections | Tables + statements | Horizontal scroll where comparison needed | Aligns with accounting-posting contract |
| `/integrity` | مركز السلامة | cost roles | Data-integrity anomalies | Are there impossible states? | Read-only list of discovered anomalies → links; no auto-fix | integrity read model | Alert list | Stacks | Correct — read-only, explainable |
| `/search` | البحث | ALL | Global search | Where is that record? | Search box → grouped results (customer/event/quote/invoice) opening the right destination | `useGlobalSearch` | Results grouped by entity | Single column list | None found |

### 3.10 Settings & account

| Route | Page | Roles | Purpose | Primary question | Content/actions | Data source | Pattern | Responsive | Problems |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/settings` | إعدادات المنشأة | ALL (actions per role) | Org identity, settings, team | Org settings and who is a member | Org identity/settings sections; **team panel** (membership management — OWNER only writes) | `settings.api`, `team.api` | Settings sections + team list | Reflow | Team/membership is currently nested inside Settings. See Phase 3 recommendation (membership as an OWNER admin concern; acceptable here but verify it never appears in normal-user nav) |

## 4. Journey map (primary/secondary)

1. **Sign in → today dashboard (primary):** `/login` → hydrate profile + active memberships → AppShell → `/home`.
2. **Prospect → quote → confirmed event (primary sales):** `/quotes/new` → steps → draft → issue `QT-…` → accept → convert → `/events/$eventId` CONFIRMED.
3. **Event execution round-trip (primary ops):** workspace tabs: pricing snapshot → team assignment → equipment reserve/dispatch → consumables → attendance → (return/reconcile) → financial close.
4. **Procurement (secondary):** supplier → PO draft → approve/send → confirm → receive → stock.
5. **Collection & finance (secondary):** payments → invoices → statements → close financially.
6. **Member/HR care (secondary):** `/staff` roster → `/staff/$staffId` file.
7. **Review/analysis (tertiary, finance):** `/dashboard`, `/reports`, `/accounting`, `/integrity`.

## 5. Interface states observed across routes

- **Loading:** per-screen skeletons (dashboard cards, list rows), `LoadingState`, spinner inside dialogs.
- **Empty / no-results:** `EmptyState` with correct CTA (e.g., events empty → "start from a quote"; catalog empty → add item). No-results distinguished from empty (search/filter) on events/catalog/quotes.
- **Error / retry:** `ErrorState` + `InlineError`; readiness failures rendered as "readiness unavailable", never treated as ready.
- **Permission:** nav filtering + in-page permission message on `/procurement` for non-cost roles; tabs filtered per role.
- **Offline:** informational banner only (no offline writes, deliberate).
- **Expired session / unauth:** AuthGate routes to login; error boundary present.
- **Truncation cap:** explicit Arabic truncation notices where the 1000-row/PostgREST cap is hit.

## 6. Confirmed interface defects/leaks found (evidence)

| # | Where | Problem | Severity | Status |
| --- | --- | --- | --- | --- |
| UI-1 | `/reports` event table | Raw English lifecycle status (`e.status`) rendered to the Arabic operator | Low (Arabic-first consistency) | **Fixed (M-01)** |
| UI-2 | Event workspace المعدات reservations | Raw reservation enum (`ACTIVE/RELEASED/CANCELLED`) rendered | Low | **Fixed (M-01)** |
| UI-3 | `lib/arabic` vs `eventWorkspace.model` + `EventsPage` | Three parallel event-status Arabic maps drifted (QUOTED: مسعّرة vs تم التسعير) | Low (duplication) | **Fixed (M-01): one canonical source** |
| UI-4 | `docs/` + `PRODUCT_SPEC` route table | Docs list 12 workspace tabs while code has 13; docs route table missing newer routes (`/calendar`, `/operations`, `/accounting`, `/integrity`, `/search`, `/staff/$staffId`, `/procurement/restaurants`) | Low (doc drift) | Not code; flagged in this inventory |

> Phase 2–8 treat the below as open architecture recommendations; the highest
> value structural re-orgs are gated on live-data verification and are listed
> in `INTERFACE_MIGRATION_PLAN.md` as later milestones.
