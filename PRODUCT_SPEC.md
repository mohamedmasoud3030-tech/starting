# PRODUCT_SPEC.md — Implemented Product Specification

> Reconstructed 2026-08-17 from actual code, migrations, tests, and runtime
> checks — not from marketing claims. Every item is labeled:
> **[V]** implemented and verified by automated tests or direct execution ·
> **[I]** implemented and verified by code inspection only ·
> **[P]** planned/documented in `docs/architecture/06-roadmap.md` but not built ·
> **[M]** missing (no implementation found) · **[U]** unknown intent (needs owner).

---

## 1. Product purpose and scope

Hospitality operations management for event-service offices in the Sultanate of
Oman. The product turns a customer request into a delivered, closed, profitable
**event**: request → quotation → confirmation → preparation → dispatch →
execution → return → close-out with actual profit. **[V]**

**Primary persona [V]:** the office owner (50+, low-tech). Simplicity, large
typography, clear buttons, large touch targets and Arabic-first RTL are product
requirements, not visual preferences (`AGENTS.md`, `docs/architecture/01`).

**Explicit non-goals [V]:** no full ERP accounting, no payroll system, no CRM
automation, no AI assistant, no marketing tool, no microservices, no event
sourcing, no generic workflow engine, no payment gateway, no email sending, no
push notifications, no offline write queue.

## 2. Roles and permissions

Roles (`app_role` enum) **[V]**: `OWNER`, `MANAGER`, `SUPERVISOR`, `WAREHOUSE`,
`ACCOUNTANT`. Membership is per organization: one user may hold different roles
in different organizations. **[V]**

| Capability | OWNER | MANAGER | ACCOUNTANT | SUPERVISOR | WAREHOUSE |
| --- | --- | --- | --- | --- | --- |
| See selling prices | ✅ | ✅ | ✅ | ✅ | ✅ |
| See cost prices / internal notes / margins | ✅ | ✅ | ✅ | ❌ | ❌ |
| Commercial setup (catalog/packages) write | ✅ | ✅ | ❌ | ❌ | ❌ |
| Customers write | ✅ | ✅ | ❌* | ✅ | ❌ |
| Procurement (suppliers/orders/receiving) | ✅ | ✅ | read-only | ❌ | ❌ |
| Payments record/void | ✅ | ✅ | ✅ | ❌ | ❌ |
| Invoices issue/void | ✅ | ✅ | ✅ | ❌ | ❌ |
| Attendance record/void | ✅ | ✅ | ❌ | ✅ | ❌ |
| Advances & payouts (host payroll) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Warehouse dispatch/return | ✅ | ✅ | ❌ | ✅ | ✅ |
| Warehouse final reconciliation | ✅ | ✅ | ❌ | ❌ | ❌ |
| Consumable movements (issue/return/consume/waste) | ✅ | ✅ | ❌ | ✅ | ✅ |
| Consumable adjustments (count correction) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Membership management | ✅ | ❌ | ❌ | ❌ | ❌ |
| Audit log read | ✅ | ✅ | ❌ | ❌ | ❌ |

\* The database customer-write policy lists OWNER/MANAGER/SUPERVISOR (ACCOUNTANT
not included); `CUSTOMER_WRITE_ROLES` in `src/lib/domain.ts` matches. **[V]**

**Enforcement [V]:** capabilities are enforced in PostgreSQL (RLS policies,
`SECURITY DEFINER` commands checking `has_org_role`), with `can_read_cost`
filtering inside cost-bearing read models. The UI hides surfaces per role but is
never the security boundary. Inactive organizations block all reads/writes even
with an active membership. **[V — pgTAP `rls_isolation.test.sql`]**

## 3. Feature inventory by domain

### 3.1 Identity & account lifecycle
- Supabase email/password auth, no demo login path, no fake users. **[V]**
- `profiles` row auto-created on auth sign-up (trigger `handle_new_user`). **[I]**
- Organization creation command `create_organization` exists; since migration
  0056 it is **not executable by browser roles** (owner/migration-only). **[V]**
- Multi-organization switching with role-per-organization display. **[V]**
- Logout button in header + mobile drawer. **[V]**
- **[M]** No UI for self-service sign-up, org creation, member invitations, or
  membership management. Account provisioning is an operational process today.
  **[U]** Whether self-service signup is intended (Supabase `enable_signup`) is
  an owner decision — see `PROJECT_STATUS.md`.

### 3.2 Operational dashboard (`/home`) **[V]**
Today's events in `Asia/Muscat`, per-event readiness (staff shortage, equipment
shortage), low-stock alerts, attendance-gap alerts, WhatsApp event reminder
share (operational data only — no prices), and owner attention voice summary.
Failed readiness is surfaced as "readiness unavailable", never treated as ready.

### 3.3 Events **[V]**
- Lifecycle `DRAFT → QUOTED → CONFIRMED → PREPARING → DISPATCHED →
  IN_PROGRESS → RETURNING → CLOSED`, plus `CANCELLED`; transitions are explicit
  server commands with audit trail (`event_status_history`).
- Event workspace with 12 tabs: ملخص (overview), التسعير (pricing), الفريق
  (team), المعدات (equipment), المخزن (warehouse), المواد (consumables),
  المشتريات (procurement), المدفوعات (payments), الفواتير (invoices),
  الحضور (attendance), الأجور (payroll), السجل (history).
- Tab visibility: المدفوعات/الفواتير/المشتريات require cost-reading roles;
  الأجور requires payroll roles. **[V]**
- Create-event dialog: customer (active only), title, type, guests ≥ 1, start,
  end, venue — all required. **[I]**

### 3.4 Quotations (quotes) **[V]**
- Canonical aggregate `quotations` + `quotation_lines`.
  Lifecycle `DRAFT → ISSUED → ACCEPTED → CONVERTED`, plus `SUPERSEDED`
  (event revision) and `CANCELLED` (drafts).
- 3-step editor (تفاصيل → خدمات → مراجعة): prospect or existing customer,
  guest count, package application (snapshot expansion), custom lines.
- Atomic draft persistence (`persist_quotation_draft`) with idempotency; numbers
  `QT-…` allocated only at issue; server-computed totals; issued quotations are
  immutable snapshots; accept → convert creates one `CONFIRMED` event and copies
  lines as operational snapshots (idempotent, race-safe).
- Unsaved-edit guard: navigation/beforeunload blocking + visible "unsaved
  changes" indicator. **[V]**
- [P] Automatic draft saving is deferred (defect D22).

### 3.5 Catalog & packages **[V]**
- Catalog items: 8 item types, 7 pricing methods, separate cost and selling
  prices, ACTIVE/INACTIVE (no client delete), Arabic/English names, optional
  category, sort order.
- Packages: reusable templates (`packages` + `package_items`); applied to a
  quotation/event as owned snapshot lines; template edits never restate history.
- Commercial setup is OWNER/MANAGER only.

### 3.6 Reusable equipment (S4A) **[V]**
Time-based reservations against `equipment_capacity`; append-only movement
ledger (dispatch, return good/damaged/lost); damage/loss valued at catalog cost
snapshot; final per-event reconciliation (OWNER/MANAGER) with
`dispatched = returned + damaged + lost`; cancelled events keep outstanding
stock accountable; lock order Event → Reservation → Capacity prevents races.

### 3.7 Consumable stock (S4B) **[V]**
Separate append-only quantity ledger `consumable_movements` (receive, issue,
return, consume, event waste, warehouse waste, audited adjustment); warehouse
balance and event custody are derived and **cannot go negative** (enforced by
commands + structural triggers); per-event reconciliation; low-stock indicator.

### 3.8 Procurement (S5) **[V]**
Suppliers (ACTIVE/INACTIVE, no delete), purchase orders `PO-YYYY-NNNNN` with
lifecycle `DRAFT → APPROVED → SENT → CONFIRMED → PARTIALLY_RECEIVED →
RECEIVED` / `CANCELLED`; negotiated cost snapshots; partial receiving; receiving
integrates with S4B movements; all S5 writes OWNER/MANAGER; read models visible
to cost roles only; procurement surfaces hidden from non-cost roles. **[V]**

### 3.9 Customer payments & event economics (S6) **[V]**
Append-only `customer_payments` (6 payment methods, RECORDED/VOIDED with reason);
accepted quotation is the revenue authority; committed/delivered cost from
procurement summaries; derived paid/outstanding/gross margin; financial
visibility cost-role-only at the data boundary.

### 3.10 Invoices (S9 part 1) **[V]**
`invoices` + `invoice_installments` (DEPOSIT/INSTALLMENT/FINAL with
PENDING/PAID/CANCELLED); created from an accepted quotation + event
(`create_event_invoice`); paid/remaining derived from the payments ledger;
issue/void by OWNER/MANAGER/ACCOUNTANT.

### 3.11 Staff & attendance (S9 part 2) **[V]**
Staff roster (6 staff types); event assignments with overlap checks; attendance
per (event, staff, date, shift MORNING/EVENING) with live statuses
PRESENT/LATE/PARTIAL/ABSENT and non-destructive VOIDED; earned amount computed
from hours/rate (PER_HOUR) or fixed rate (PER_DAY/PER_EVENT/MANUAL) in exact
3-decimal OMR; host-level advances and payouts ledgers with void; per-event and
global payroll summaries; dashboard attendance-gap alerts.

### 3.12 Owner voice ("اسمع الصفحة") **[V]**
One-button Arabic narration of page summaries via browser `speechSynthesis`.
Deterministic builders (no LLM, no network TTS, DOM never read), 3 speeds,
voice preference ar-OM → Gulf Arabic → any Arabic; summaries respect the role's
cost visibility (never speaks cost to non-cost roles); no auto-speech, no
aria-live announcements.

### 3.13 PWA **[V]**
Installable manifest (Arabic, RTL, standalone, 192/512 icons, shortcuts) and a
service worker that (a) pre-caches the app shell for offline open, (b) caches
only same-origin static script/style/font/image assets, (c) never intercepts
Supabase traffic, non-GET requests, or cross-origin requests, (d) updates via
skipWaiting + single reload. Offline banner is informational only; no offline
writes.

## 4. Routes and screens

| Route | Screen | Role visibility | Notes |
| --- | --- | --- | --- |
| `/` | redirect → `/home` | — | |
| `/login` | Sign in | public | "not configured" state without `.env`; Arabic errors |
| `/home` | Operational dashboard | all members | truncation warning when event list hits cap |
| `/events` | Events list | all members | search + status filter + create dialog |
| `/events/$eventId` | Event workspace | all members (tabs per role) | 12 tabs, readiness banner, history |
| `/quotes` | Quotations list | commercial roles | draft + issued states |
| `/quotes/new` | New quotation editor | commercial roles | 3 steps + unsaved-edit guard |
| `/quotes/$quoteId` | Editor (DRAFT) / Review (ISSUED+) | commercial roles | accept → convert flow |
| `/customers` | Customers | all members | write per customer-write roles |
| `/catalog` | Catalog | all members (write = commercial roles) | cost fields only for cost roles |
| `/packages` | Package templates | commercial roles (nav-gated) | |
| `/consumables` | Consumable stock | all members (adjust = OWNER/MANAGER) | |
| `/procurement` | Suppliers & orders | cost roles only | non-cost roles see a clear message |
| `/staff` | Hosts, attendance, payroll | all members (payroll = cost roles) | |

All routes are lazy-loaded (`src/routes.lazy.tsx`). **[V]**

## 5. Critical user journeys (verified from code paths and tests)

1. **Sign in → dashboard [V]:** `/login` → `signInWithPassword` → hydrate
   profile + active memberships → AppShell → `/home` loads today's dashboard.
   Failure paths: unconfigured project notice, Arabic auth errors, rate-limit
   and unconfirmed-email messages.
2. **Create event [I]:** `/events` → dialog (required fields) → `create_event`
   RPC → list refresh → workspace.
3. **Quote → event [V]:** `/quotes/new` → fill steps → save draft (atomic) →
   issue (`QT-…`) → accept → convert → `CONFIRMED` event with snapshot lines.
   Idempotency and double-conversion protection are pgTAP + concurrency proven.
4. **Warehouse round-trip [V]:** reserve capacity → dispatch → return
   good/damaged/lost → final reconcile; concurrency harness-proven.
5. **Consumable flow [V]:** receive stock → issue to event → return/consume/
   waste → reconcile; negative-balance prevention proven.
6. **Procurement flow [V]:** supplier → order draft → approve → send → confirm
   → receive (partial) → S4B stock movement; lifecycle guards proven.
7. **Payment & invoice [V]:** record payment → invoice issue with installments
   → derived paid/remaining; void paths non-destructive.
8. **Attendance & payroll [V]:** assign host → record attendance per shift →
   earned = hours × rate → advance/payout ledgers → payroll summary.
9. **Logout [V]:** header button and mobile drawer end the session and clear
   the tenant cache.

## 6. Validation, edge cases and known limitations

- **Money:** OMR `numeric(12,3)` everywhere; browser math in integer milli-OMR
  with BigInt multiplication; half-away-from-zero rounding; UI input enforces
  the same domain; >3 decimals rejected; negatives rejected at commands. **[V]**
- **Time:** operational "today" is `Asia/Muscat` in both SQL and UI. **[V]**
  **[U/D17]** `datetime-local` inputs use the operator device's timezone — Muscat
  pinning for the event form is deferred pending a product decision.
- **List caps:** list screens fetch up to PostgREST `max_rows` (1000); explicit
  Arabic truncation warnings are shown when a cap is hit. **[V]** Full
  pagination is pending (defect D21).
- **Drafts:** unsaved-edit guard exists; autosave pending (D22).
- **Audit retention:** no retention policy for `audit_events` (D20, deferred).
- **WhatsApp:** manual share links only; no scheduling, no official API.
- **Offline:** app opens offline; data reads require connectivity; no offline
  mutation queue (deliberate).
- **Voice:** real-device audio quality untested (mocked SpeechSynthesis tests
  only).

## 7. Product ambiguities requiring owner decisions

1. **Self-service signup** (Supabase `enable_signup`, `create_organization`
   access) — provisioning is currently an operational process.
2. **Public demo mode** (migrations 0054/0055) remains installed in the schema;
   removal from production is an owner decision (defect D2).
3. **List pagination UX** (D21) and **quote autosave** (D22) — style decisions.
4. **Event date/time entry timezone** (D17).

> Where this document conflicts with older files under `docs/`, this document
> and the executable checks win; the older docs were corrected where they were
> drift (see commit `6ad93fb`).
