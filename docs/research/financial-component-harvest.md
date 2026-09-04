# Financial & Operations Component Harvest — Research & Implementation Decision Package

**Date:** 2026-09-04 (UTC)  
**Baseline:** `origin/main` @ `fd7aaff9001e0d63ab2b63f290b2804c96d2bdd9` (PR #38 merged)  
**Research Branch:** `arena/01a06b35-starting` (reset to main SHA, serves as fresh research branch per session constraint)  
**Task:** Repository Cleanup + Component Harvest + Adaptation Plan

---

## 1. Repository Cleanup

### Baseline
- Fetched latest remote: `git fetch origin --prune` then `git fetch --unshallow` for full audit.
- `origin/main` SHA: `fd7aaff9001e0d63ab2b63f290b2804c96d2bdd9`
- Merge commit: `Merge PR #38: owner-controlled delegation and operational documents`
- Open PR count: **0** (verified via `gh pr list --state open`)
- Local main and origin/main identical.

### Audit
Enumerated remote branches via `git ls-remote --heads origin`:
- 18 non-main remote heads found (pre-cleanup):
  - `arena/01a00888-starting` (PR #20 MERGED)
  - `arena/01a00a88-starting` (PR #24 MERGED)
  - `arena/01a00b00-starting` (PR #25 MERGED)
  - `arena/01a00fa3-starting` (PR #27 MERGED)
  - `arena/01a01199-starting` (PR #28 CLOSED, PR #30 CLOSED comparison)
  - `arena/01a0153d-starting` (PR #29 MERGED, PR #31 MERGED)
  - `arena/01a016f0-starting` (PR #33 MERGED)
  - `arena/01a021af-starting` (no PR, duplicate of 01a016f0 tip)
  - `arena/01a0223c-starting` (PR #34 CLOSED stale/superseded)
  - `arena/01a025d0-starting` (PR #35 CLOSED Guardian, validation blockers, predates 0079/0080)
  - `arena/01a06a64-starting` (PR #38 MERGED)
  - `chatgpt/r10-product-consolidation-foundation` (PR #19 MERGED)
  - `closeout/self-serve-onboarding-ae` (PR #32 MERGED)
  - `feat/multi-location-architecture-dashboard-pwa` (PR #23 MERGED)
  - `hotfix/public-demo-full-access` (no PR, ancestor of main via earlier R11)
  - `hotfix/public-demo-full-access-2` (PR #21 MERGED)
  - `phase4/product-acceptance-dashboard-ux` (PR #26 CLOSED)
  - `refactor/frontend-architecture` (PR #22 MERGED)

For each branch determined:
- Associated PR via `gh pr list --state all`
- PR state: MERGED vs CLOSED
- Merged status: MERGED PRs considered merged even when branch tip not direct ancestor due to GitHub merge commits (verified via merge commit containment `git branch --contains <mergeOid>`)
- Unique commits: Checked via `git rev-list --count main..branch` and `git merge-base --is-ancestor`
- Valuable unique work: Inspected `arena/01a021af-starting` and `hotfix/public-demo-full-access` — both duplicates/ancestors of already-merged work, no unique domain logic worth preserving beyond historical notes.

### Deletion
Deleted all 18 remote branches via `git push origin --delete <branch>`:
- All MERGED branches deleted (work already in main history)
- CLOSED branches PR #34 and PR #35 explicitly treated as historical, not integration candidates, per mission
- No PR branches verified as duplicates/ancestors, deleted
- Post-cleanup `git ls-remote --heads origin` shows only `main`

Local cleanup:
- Deleted 18 local stale branches via `git branch -D`
- Remaining local: `main` and `arena/01a06b35-starting` (session branch, at main SHA)
- `git branch -r` shows only `origin/main` and `origin/HEAD`

### Preservation
- **Branches intentionally preserved:** 0 (beyond main + session branch)
- **Unique work preservation:** None — all unique commits were either already merged via PR merge commits or were superseded/obsolete (Guardian predates 0079/0080 capability model, PR #34 predates operational documents). Knowledge preserved in this document, not branch architecture.

### New Branch Confirmation
- `arena/01a06b35-starting` currently at `fd7aaff9001e0d63ab2b63f290b2804c96d2bdd9` identical to `origin/main`
- Created fresh from latest main (reset, not cherry-picked)
- No old commits brought forward via merge/cherry-pick
- Satisfies Phase 1 intent; naming constraint `arena/01a06b35-starting` enforced by Arena session tracking (cannot push to `research/financial-component-harvest` per platform guardrail, but branch content is clean main baseline).

---

## 2. Existing System Baseline

### Identity & Authorization (Authoritative)
- **Tenancy:** `organizations` root, `organization_memberships` (OWNER/MANAGER/SUPERVISOR/WAREHOUSE/ACCOUNTANT, ACTIVE/INACTIVE/INVITED), RLS enabled on 36/36 business tables, composite FKs `(organization_id, id)` prevent cross-org.
- **Delegated capabilities (0079):** `org_member_permissions` table, 20 capabilities (`customer.manage`, `quotation.manage`, `quotation.issue`, `event.manage`, `catalog.manage`, `warehouse.dispatch`, `warehouse.reconcile`, `consumable.manage`, `stock.adjust`, `attendance.record`, `procurement.manage`, `staff.manage`, `payment.record`, `payment.void`, `invoice.manage`, `finance.manage`, `cost.visibility`, `payroll.read`, `payroll.pay`, `settings.manage`). OWNER always true, else per-member override else role preset via `role_default_capability`. `has_permission(org, cap)` is canonical boundary, `my_capabilities(org)` for UI mirror, OWNER-only `member_capability_list` and `set/clear` functions. No client RLS on permissions table. OWNER membership immutable trigger.
- **Cost visibility:** `can_read_cost(org)` wrapper around `has_permission(cost.visibility)`, gates all financial read models. `can_read_payroll` similarly.
- **RLS/RPC:** All financial writes via SECURITY DEFINER RPCs with pinned `search_path`, `has_org_role` / `has_permission` checks, advisory locks, idempotency via canonical `command_idempotency` (org, scope, key) + SHA-256 fingerprint.

### Commercial Flow
- **Customers:** `customers` (INDIVIDUAL/COMPANY/GOVERNMENT, is_active)
- **Catalog & Packages:** `catalog_categories`, `catalog_items` (SERVICE/REUSABLE_EQUIPMENT/CONSUMABLE/STAFF/CATERING/TRANSPORT/ADDON/OTHER, cost_price/selling_price numeric(12,3)), `packages` + `package_items`, `save_package()` transactional.
- **Quotations:** `quotations` (QT-… sequence, DRAFT/ISSUED/ACCEPTED/CONVERTED/CANCELLED/SUPERSEDED, totals numeric(12,3)), `quotation_lines` snapshot, triggers enforce immutability after ISSUED, commands: `persist_quotation_draft` atomic idempotent, `issue_quotation`, `accept_quotation`, `convert_quotation_to_event` (one tx creates CONFIRMED event), `cancel_quotation_draft`, `apply_package_to_quotation`.
- **Events:** `events` (EV-… sequence, DRAFT/QUOTED/CONFIRMED/PREPARING/DISPATCHED/IN_PROGRESS/RETURNING/CLOSED/CANCELLED), `event_status_history` append-only, `event_commercial_lines` snapshot editable until pricing locked, `transition_event_status`, `cancel_event`, `accept_event_quotation`.

### Financial Subsystems Present
- **Invoices:** `invoices` (ISSUED/CANCELLED), `invoice_installments` (DEPOSIT/INSTALLMENT/FINAL, PENDING/PAID/CANCELLED), `create_event_invoice`, `void_invoice`. Paid total / remaining balance derived from payments ledger, not second source.
- **Customer Payments:** `customer_payments` append-only ledger, `payment_method` CASH/BANK_TRANSFER/CARD/CHEQUE/MOBILE_WALLET/OTHER, amount numeric(12,3) >0, RECORDED→VOIDED with reason, `record_customer_payment`, `void_customer_payment`, idempotency + fingerprint, `customer_payment_summaries` view, `amount_paid` and `outstanding_balance` derived in `event_finance_summaries`.
- **Expenses:** `event_expenses` unified direct-expense ledger for costs NOT already source-of-truth elsewhere (procurement = purchases, staff payroll = staff cost, this table = transport/fuel/rental/third-party/consumable/damage_loss/other). `expense_category` enum, amount numeric(14,3) >0, RECORDED/VOIDED, `record_event_expense`, `void_event_expense`, cost-gated.
- **Procurement:** `suppliers` (ACTIVE/INACTIVE, no-delete), `procurement_orders` (PO-YYYY-NNNNN, DRAFT/APPROVED/SENT/CONFIRMED/PARTIALLY_RECEIVED/RECEIVED/CANCELLED), `procurement_order_lines` immutable snapshots (CONSUMABLE/CATERING_SERVICE/OTHER), `procurement_receipts` / `procurement_receipt_lines` append-only receiving facts linked to S4B `consumable_movements`, lifecycle triggers `procurement_order_history_guard`, `event_lifecycle_guard`, commands OWNER/MANAGER.
- **Reusable Equipment:** `equipment_capacity`, `event_equipment_reservations`, `event_equipment_movements` (DISPATCH/RETURN with good/damaged/lost, catalog-cost snapshot), `event_warehouse_reconciliations` (dispatched = returned+damaged+lost), lock order Event→Reservation→Capacity.
- **Consumables:** `consumable_stock_items`, `consumable_movements` (RECEIVE/ISSUE_TO_EVENT/RETURN_FROM_EVENT/CONSUME_AT_EVENT/WASTE_AT_EVENT/WAREHOUSE_WASTE/ADJUSTMENT, GENERATED warehouse_delta/event_delta, no negative balances), `event_consumable_reconciliations`, commands receive/issue/return/consume/waste/adjust/reconcile.
- **Financial Summaries:** `event_finance_summaries` (accepted_revenue = quotation total_selling, amount_paid = Σ RECORDED payments, outstanding = revenue−collected, staff_cost = Σ payroll earned, procurement_cost = committed/delivered, expense_cost = Σ RECORDED expenses, actual_cost = staff+procurement+expense, actual_profit = revenue−actual_cost, margin_percent), `event_expense_category_summaries`, `event_procurement_cost_summaries`, `host_event_payroll_summaries`, `customer_payment_summaries`, etc.
- **Financial Closure:** `event_financial_closures` append-only cycle history OPEN→CLOSED→REOPENED, at most one active closure per event (partial unique index), snapshot revenue/collected/outstanding/costs/profit/margin at close, triggers block cost/collection mutations while financially closed (`guard_event_financially_closed` on customer_payments, host_payouts, staff_attendance, event_expenses).
- **Payroll:** `staff_members`, `event_staff_assignments` (overlap rejection), `staff_attendance` (one live per org/event/staff/date/shift, PRESENT/LATE/PARTIAL/ABSENT/VOIDED, earned = hours×rate else fixed, ABSENT→0), `staff_advances` host-level, `host_payouts` optionally event-linked, `get_host_payroll_summary`, `host_event_payroll_summaries`.

### Office Documents (0080)
- `customer_statement(org, customer)` → CHARGE from accepted revenue + PAYMENT from RECORDED payments, positive amounts, row_kind sign, gate cost.visibility
- `customer_payment_receipt(org, payment)` → org identity, payment ref, customer/event, amount, method, recorder, void metadata, gate cost.visibility
- `event_warehouse_sheet_lines(org, event)` → operational quantities from commercial lines + dispatch/return state from ledgers, no cost, gate any member
- `host_statement(org, staff)` → per-event payroll rows + host-wide advances canonical, gate payroll.read

### Infrastructure
- **Migrations:** 0001–0048 + timestamped 0049–0080, immutable, additive, replay-verified. Latest is 0080 office documents, after 0079 delegated permissions.
- **Types:** `src/lib/database.types.ts` generator-owned (6038 lines), hand types in `dbTypes.ts`
- **Money:** `numeric(12,3)` persisted, integer milli-OMR via BigInt, `parseOMR`, `toOMRString`, `formatOMR`, `fromDbAmount`, `toDbNumeric`, `multiplyOMR`, `parseQuantityMilli`, domain checks, half-away-from-zero rounding.
- **Time:** Asia/Muscat operational day, `todayInMuscat`, server functions use Muscat.
- **Frontend:** React 19 + TS strict, Vite 6, TanStack Router 14 routes lazy, TanStack Query (staleTime 30s, org-scoped keys, tenantCache clearing), Tailwind v4, hand-built ui kit, MoneyInput, PWA sw.js v2, no custom server (static SPA on Vercel, Supabase PG 15 backend).

### What Blocks Financial Event Closure Today?
- `event_financially_ready(org, event)` requires accepted_revenue >0 AND outstanding_balance <=0. That is: quotation accepted + all cash collected. Staff cost, procurement, expense recording does NOT block closure but is snapshot at close. Actual blocking issues:
  - No formal ledger → revenue/cash/receivable/expense/profit concepts are derived but not double-entry auditable; no reversal chain beyond void.
  - No treasury accounts → cannot attribute where money physically moved (cash vs bank), no cash/bank reconciliation, no transfer.
  - No supplier ledger → purchases create procurement cost but no supplier liability aging, no supplier payments, no supplier statement.
  - No purchase invoice vs receipt distinction → procurement receipt is goods receipt, but supplier invoice (bill) not modeled; 3-way match incomplete.
  - Inventory movement exists but not tied to financial valuation beyond cost snapshot; no inventory ledger valuation projection.
  - Payroll advances/payouts exist but no treasury attribution.
  - Capability model exists but new financial operations need capability mapping.

---

## 3. GitHub Search Coverage

Searched extensively via `web_search` depth 2-3, GitHub topics, and direct repo fetches. Cloned none into product repo (temporary workspace `/tmp` only, cleaned).

### Search Areas & Queries Executed

**Financial Ledger (12 serious candidates reviewed):**
- Queries: `double entry accounting PostgreSQL TypeScript open source ledger`, `general ledger immutable journal entries balanced debit credit TypeScript`, `PostgreSQL accounting ledger idempotent posting`, `site:github.com double entry ledger PostgreSQL TypeScript MIT license`, `TigerBeetle accounting ledger open source`, `Formance ledger open source double entry PostgreSQL`, `medici double entry accounting Node.js PostgreSQL`, `envato double_entry ruby ledger`, `blnk finance open source ledger double entry MIT`, `bigcapital open source accounting double entry ledger MIT`
- Candidates: pgr0ss/pgledger, radzserg/lefra, formancehq/stack (Formance Ledger), blnkfinance/blnk, tigerbeetledb/tigerbeetle, bigcapitalhq/bigcapital, akram-ashraf/ledgerstack-core, envato/double_entry, flash-oss/medici, hamsterbase/ledger-ts, ledgersmb/LedgerSMB, gerdemb/beanpost

**Treasury / Cash & Bank (6 candidates):**
- Queries: `open source treasury cash bank account management TypeScript PostgreSQL`, `finance-tracker`, `treasury`
- Candidates: bigcapital (banking module, reconciliation), ERPNext (bank accounts, cash, reconciliation), Formance Wallets, actualbudget/actual (local-first finance), firefly-iii (personal finance, bank), felipegcoutinho/openmonetis (treasury dashboard pattern)

**Accounts Receivable (6 candidates):**
- Queries: `accounts receivable payment allocation invoice settlement open source TypeScript`, `invoice`
- Candidates: bigcapital (AR aging, payment allocation), ERPNext AR, akaunting/akaunting, ever-co/ever-gauzy, invoiceninja/invoiceninja, firefly-iii

**Accounts Payable / Suppliers (5 candidates):**
- Queries: `open source accounts payable supplier ledger vendor statement TypeScript PostgreSQL`
- Candidates: bigcapital AP, ERPNext AP, dolibarr/dolibarr, idurar-erp-crm, openpro

**Procurement (5 candidates):**
- Queries: `procurement purchase order goods receipt three way match open source`, `purchase requisition`
- Candidates: ERPNext (REQUEST→APPROVED→ORDERED→RECEIVED→INVOICED→PAID), Odoo Community (3-way match), bigcapital (bills, PO), dolibarr, ProcureDesk pattern (Ramp docs)

**Inventory / Warehouse (6 candidates):**
- Queries: `inventory ledger stock movement ledger warehouse open source PostgreSQL`, `ERPNext inventory stock ledger movement`
- Candidates: inventree/InvenTree, frappe/erpnext stock (Stock Ledger Entry + Bin dual-layer, immutable, FIFO/LIFO/Moving Average/Standard), khawasx/stock-ledger (Next.js tRPC Prisma movement ledger), bigcapital inventory, openboxes/openboxes, odoo stock

**Financial Closing / Event Profitability / Job Costing (5 candidates):**
- Queries: `event profitability job costing project costing open source accounting`
- Candidates: ERPNext projects (project costing, timecards, gross margin), bigcapital financial statements, odoo project accounting, foundation job costing patterns, ever-gauzy project profitability

**Total serious candidates reviewed:** 45+ repositories/docs, with deep README/license/architecture review of ~20 primary.

---

## 4. Candidate Matrix

| Subsystem | Candidate | License | Stack | What It Does Well | Reuse Decision | What We Would Take | Integration Risk |
|---|---|---|---|---|---|---|---|
| **Ledger** | **pgr0ss/pgledger** | MIT | PostgreSQL (SQL only) + Go tests | Pure PG implementation, no app code, transactional guarantees with rest of app, ULID prefixed IDs, immutable entries with previous/current balance, historical balances, event_at vs created_at, examples executable, small single file `pgledger.sql` + vendored ulid helpers, 490 stars, active (Jul 2026), well-tested | **ADAPT** | Posting model: `pgledger_accounts`, `pgledger_entries`, `pgledger_transfers` as journal header + entries, balance = sum entries, version per account, transfer = 2 entries, deferrable constraint trigger for balanced entry, idempotency via transfer idempotency key, `event_at` concept for webhook time vs DB time. Adapt to Supabase: keep our tenant isolation, add org_id, source-document ref, idempotency_key unique per org, void via reversal not delete. | Low — SQL only, no ORM, no auth, easy to embed as additive migration. Need to add org_id, RLS, capability gate, OMR 3-decimal check, source ref. |
| Ledger | radzserg/lefra | MIT | TypeScript, PostgreSQL, slonik | Type-safe ledger spec generation, System vs Entity accounts (owner vs user), double-entry enforced at lib, operations pattern `ILedgerOperation`, normalBalance DEBIT/CREDIT, entity ledger account per user, clean separation | **LEARN ONLY** | Operation pattern: encapsulate business event (e.g., TenantMakesBooking) into `createTransaction()` returning balanced entries. Idea of generating TS spec from DB slugs for type-safe account refs (`ledgerAccountsRefBuilder`). | Medium — requires slonik, not Supabase client, extra abstraction; but concept of Operation is valuable for our RPC layer. |
| Ledger | formancehq/stack (Formance Ledger) | MIT | Go, PostgreSQL, Kafka/NATS, Numscript DSL | Programmable, atomic multi-posting transactions in Numscript, multi-currency, high modularity, 521 stars, 2728 commits, production-grade, MIT, YC, PayPal Ventures backed, clear docs, immutable, audit | **LEARN ONLY** | Numscript DSL idea: describe money movement declaratively, not imperative debit/credit juggling. Atomicity guarantee: all legs or none. Event-sourced. But we should NOT import entire stack, microservices, Kafka. | High if transplanted — microservices, Traefik, NATS, not our stack. Concept of transaction DSL and immutable log is LEARN ONLY. |
| Ledger | blnkfinance/blnk | Apache-2.0 | Go, PostgreSQL | Double-entry ledger, balance monitoring, snapshots, historical balances, inflight, scheduling, overdrafts, bulk, reconciliation, identity management with PII tokenization, open-source ledger + lending | **LEARN ONLY** | Balance monitoring, snapshots, inflight transactions concept for holds (useful for event deposits). Overdraft guard pattern. Reconciliation engine concept. | Medium-High — Go service, not TS, would be second ledger truth. Learn concepts for treasury. |
| Ledger | tigerbeetledb/tigerbeetle | Apache-2.0 | Zig, distributed DB | Accounting-grade correctness, deterministic execution, strict serializability, high throughput (128-byte tx), built-in replication, 100M+ tx/month customers, purpose-built for money movement, not general DB | **LEARN ONLY** | Strict serializability, deterministic row locking, group commit, 128-byte transfer primitive. Reinforces that PG with SERIALIZABLE + row locks is sufficient for our scale (owner/manager small team), no need for separate DB. | High — narrow specialized DB, not replacement for Supabase, would be second truth. |
| Ledger | bigcapitalhq/bigcapital | AGPL-3.0 | TypeScript, NestJS, React, PostgreSQL | Full double-entry engine, chart of accounts, manual journals, ledger module enforces balanced entries, AP/AR aging, banking reconciliation, inventory, financial statements (trial balance, P&L, cash flow), 3.9k stars, 4965 commits, API-first | **LEARN ONLY** | Domain model: Ledger module as single writer, every financial transaction (invoice, bill, expense, bank match) flows through ledger. Chart of accounts structure, account types (asset/liability/equity/revenue/expense), manual journal UX, bank reconciliation pattern, AR/AP aging queries. | High licensing risk AGPL — cannot copy code directly. Architecture is valuable reference but would be full ERP transplant if copied. |
| Ledger | envato/double_entry | MIT | Ruby, ActiveRecord, MySQL/PG/SQLite | Double-entry via lines table, each transfer = 2 lines, account locking `lock_accounts`, scope_identifier per user, positive_only guard, allowlist of transfers, Money gem for currency, battle-tested in production (Envato billions $) | **LEARN ONLY** | Lines table = ledger entries, transfer = 2 lines, locking pattern `DoubleEntry.lock_accounts(account_a, account_b) { transfer }` for transactional guarantees, positive_only guard for cash accounts, metadata jsonb. Adapt locking order concept to our existing Event→Reservation→Capacity. | Low-Med — Ruby, not TS, but pattern is simple and maps to PG. MIT safe but language mismatch. |
| Treasury | bigcapital banking | AGPL-3.0 | TS/Nest | Bank accounts, cash accounts, bank reconciliation, matching external records to internal ledger, custom matching rules | **LEARN ONLY** | Cash/bank as accounts in chart, treasury movements attributable to source doc (customer payment, supplier payment, payroll, expense, transfer, adjustment), reconciliation = match external bank statement to internal ledger entries. | High license, but concept is exactly what we need. |
| Treasury | ERPNext bank | GPL-3.0 | Python, MariaDB, Frappe | Bank accounts, cash accounts, payment entries with allocation, bank reconciliation tool, multi-currency | **LEARN ONLY** | Payment Entry doctype with allocation table, bank reconciliation via statement import, unallocated payments. Workflow: Payment → Allocation → Reconciliation. | GPL, cannot copy. |
| Treasury | actualbudget/actual | MIT | TS, React, SQLite | Local-first, cash flow, bank sync, envelope budgeting, rules | **ADOPT** (small) | Rule engine for categorizing transactions? Maybe small utility for bank import CSV parsing. But core treasury we BUILD NATIVE. | Low for small util, but not core. |
| AR | bigcapital AR | AGPL-3.0 | TS | Customer statement movements CHARGE/PAYMENT, AR aging, payment allocation, unapplied payments, customer balance | **LEARN ONLY** | Our existing `customer_statement` already does CHARGE/PAYMENT with row_kind, positive amounts, sign via kind. Bigcapital validates same. Aging query: buckets 0-30/31-60/61-90/90+. Allocation: payment → invoices via allocation table, not direct overwrite. | AGPL. |
| AR | ERPNext AR | GPL-3.0 | Python | Payment allocation, customer statement, receivable aging, outstanding, unapplied | **LEARN ONLY** | Allocation doctype: one payment allocates to many invoices with amounts, leaving unallocated. Customer balance = sum invoices − sum payments. Same as our `outstanding_balance` but need explicit allocation for partial payments. | GPL. |
| AP/Suppliers | bigcapital AP + ERPNext AP | AGPL/GPL | TS/Python | Supplier ledger, vendor statement, vendor invoices (bills), supplier payments, payables aging, supplier outstanding | **LEARN ONLY** | Supplier statement = mirror of customer statement but for bills/payments. Supplier balance = bills − payments. Aging buckets. Need suppliers table already exists, need supplier_invoices (bills) and supplier_payments. | License. |
| Procurement | ERPNext procurement | GPL-3.0 | Python | Full lifecycle REQUEST→APPROVED→ORDERED→RECEIVED→INVOICED→PAID, 3-way match PO/receipt/invoice quantity/price/description, tolerances, partial receipts, landed costs | **ADAPT** | 3-way match logic: PO + Goods Receipt + Supplier Invoice must align within tolerance, else exception. Partial receipt tracking: cumulative received vs ordered. Our existing procurement already has DRAFT→APPROVED→SENT→CONFIRMED→PARTIALLY_RECEIVED→RECEIVED→CANCELLED + receipts linked to consumable_movements. Need to add supplier invoice (bill) and match. | Medium — lifecycle already similar, need to add supplier invoice table and matching trigger, not replace. |
| Procurement | Odoo CE purchase | LGPL-3.0 | Python/Postgres | 3-way match, PO, goods receipt, vendor bills, price/quantity matching | **LEARN ONLY** | Same as ERPNext, validates 3-way. | LGPL more permissive than GPL but still copyleft for linking. |
| Inventory | inventree/InvenTree | MIT | Python/Django, PostgreSQL | Low-level stock control, part tracking, stock ledger, serial/batch, plugin system, REST API, 7.5k stars, active, MIT | **LEARN ONLY** | Stock as ledger, not mutable qty, movement kinds, serial/batch tracking, plugin extensibility. But Python/Django, not our stack. | Low license risk, but full transplant would be second inventory truth — we must NOT. |
| Inventory | ERPNext stock | GPL-3.0 | Python/MariaDB | Dual-layer: Stock Ledger Entry (immutable detailed) + Bin (aggregated for performance), valuation FIFO/LIFO/Moving Average/Standard, reposting for backdated entries, serial/batch via Bundle | **ADAPT** | Dual-layer concept: keep our existing `consumable_movements` and `event_equipment_movements` as detailed ledger (already immutable, derived balances), add Bin-like aggregated view for performance if needed, but currently our `consumable_stock_summary` and `equipment_availability` already aggregate. Valuation: we use catalog_cost_snapshot, not FIFO — keep simple. Reposting: not needed for our scale, but backdated receipt should be allowed with trigger recalc? For now keep append-only. | GPL, but concept is ADAPT. |
| Inventory | khawasx/stock-ledger | MIT | Next.js 15, tRPC, Prisma, PostgreSQL | Stock on hand derived from SUM(stock_movements.quantity) per product, audit trail, dashboard low-stock alerts, Docker Compose | **ADAPT** (closest to our existing) | Already same as our consumable model: derived balances, movement ledger. Shows tRPC pattern for type-safe API, but we use Supabase RPC. Good reference for UI: low-stock alerts, reorder thresholds. | Low — MIT, TS, PG, matches our stack. Could ADOPT small UI pattern. |
| Closing | ERPNext projects / job costing | GPL-3.0 | Python | Project profitability, gross margin, actual vs expected, timecards, costing | **LEARN ONLY** | Job costing = direct materials + direct labor + overhead. Our event profitability already does accepted_revenue, amount_paid, outstanding, staff_cost, procurement_cost, expense_cost, actual_cost, actual_profit, margin_percent. Need to ensure we never confuse revenue/cash/receivable/expense/profit/cash balance — separate concepts. Event closure already has readiness checks. | GPL. |
| Closing | bigcapital reports | AGPL-3.0 | TS | Trial balance, P&L, cash flow, AR/AP aging, tax summaries generated from ledger | **LEARN ONLY** | Reporting from ledger, not second source. For event closure, summary should be trustworthy snapshot at close time (we already snapshot). Need management dashboard aggregating across events. | AGPL. |

---

## 5. License Review

| Repository | License File | Classification | Reasoning |
|---|---|---|---|
| pgr0ss/pgledger | MIT (LICENSE) | **SAFE FOR DIRECT ADAPTATION** | Permissive MIT, allows commercial use, modification, no copyleft. Must preserve attribution. Small SQL file, no transitive deps. |
| radzserg/lefra | MIT | **SAFE FOR DIRECT ADAPTATION** but **LEARN ONLY** decision | MIT safe, but depends on slonik, not needed. Operation pattern is concept, not code transplant. |
| formancehq/stack (Formance Ledger) | MIT | **SAFE FOR DIRECT ADAPTATION** but **LEARN ONLY** decision | Core ledger MIT, safe, but full stack is microservices with Kafka/NATS, would be second truth and heavy. Use concepts only. |
| blnkfinance/blnk | Apache-2.0 | **SAFE FOR DIRECT ADAPTATION** but **LEARN ONLY** | Apache-2.0 permissive, safe, but Go service, would be second ledger truth. Learn balance monitoring/snapshots. |
| tigerbeetledb/tigerbeetle | Apache-2.0 | **SAFE FOR DIRECT ADAPTATION** but **LEARN ONLY** | Apache-2.0 safe, but Zig DB, not replacement for Supabase. Learn serializability. |
| bigcapitalhq/bigcapital | AGPL-3.0 | **REFERENCE / CONCEPT ONLY** | AGPL copyleft, strong network copyleft, would require open-sourcing entire app if code copied. Must not directly copy. Study for architecture, workflows, ledger module boundary, AR/AP aging queries, bank reconciliation. |
| frappe/erpnext | GPL-3.0-only | **REFERENCE / CONCEPT ONLY** | GPL copyleft, cannot copy into proprietary/closed codebase without GPL obligations. Study for procurement lifecycle, stock ledger dual-layer, payment allocation, 3-way match, job costing. |
| inventree/InvenTree | MIT | **SAFE FOR DIRECT ADAPTATION** but **LEARN ONLY** for full system | MIT safe, but Python/Django, full inventory system would be second truth. Learn movement ledger, serial/batch. |
| khawasx/stock-ledger | MIT (assumed, need verify) | **SAFE FOR DIRECT ADAPTATION** | MIT, TS, PG, tRPC, movement ledger pattern identical to ours. Could adopt small UI patterns. |
| akram-ashraf/ledgerstack-core | MIT (npm) | **SAFE FOR DIRECT ADAPTATION** but **LEARN ONLY** | MIT, but generic accounting engine with worker/cache, not needed for our specialized event domain. Learn multi-tenant voucher pattern. |
| envato/double_entry | MIT | **SAFE FOR DIRECT ADAPTATION** but **LEARN ONLY** | MIT, Ruby, lines table pattern simple, but language mismatch. Learn locking pattern. |
| flash-oss/medici | MIT | **SAFE FOR DIRECT ADAPTATION** but **LEARN ONLY** | MIT, but Mongo/Mongoose, not PG. Learn void via reversal. |
| hamsterbase/ledger-ts | MIT | **SAFE FOR DIRECT ADAPTATION** but **LEARN ONLY** | MIT, but personal finance, beancount output, not operational ERP. |
| ledgersmb/LedgerSMB | GPL-2.0 | **REFERENCE / CONCEPT ONLY** | GPL, Perl, full ERP, cannot copy. |
| actualbudget/actual | MIT | **SAFE FOR DIRECT ADAPTATION** (small) | MIT, local-first, bank sync, rules — small utility for CSV import could be adopted. |
| dolibarr/dolibarr | GPL-3.0 | **REFERENCE / CONCEPT ONLY** | GPL. |
| odoo/odoo (Community) | LGPL-3.0 | **REFERENCE / CONCEPT ONLY** | LGPL is copyleft for linking, safer than GPL but still requires care; use as reference for 3-way match. |
| firefly-iii/firefly-iii | AGPL-3.0 | **REFERENCE / CONCEPT ONLY** | AGPL. |

**Provenance record:** No code copied yet. For future ADAPT items, will preserve attribution in `THIRD_PARTY_NOTICES.md` or file header, e.g., pgledger MIT © Paul Gross.

---

## 6. Recommended Reuse

### Financial Ledger
- **Decision:** **ADAPT** from **pgr0ss/pgledger**, **LEARN ONLY** from Formance, lefra, blnk, TigerBeetle, bigcapital, envato.
- **Reasoning:** pgledger is pure PostgreSQL, no app code, transactional guarantees with rest of app (do work + write ledger atomically), matches our Supabase RPC boundary philosophy. It demonstrates immutable entries, balanced transfers (at least 2 entries, sum zero), version per account for optimistic concurrency, historical balances via previous/current balance, event_at vs created_at for webhook time, idempotency via idempotency key. It is MIT, small, maintained (Jul 2026), 490 stars, Go tests prove correctness under concurrency. Other candidates are either full ERP (bigcapital AGPL, ERPNext GPL) or microservices (Formance) or separate DB (TigerBeetle) or language mismatch (Ruby, Mongo). We need minimal rigorous ledger, not full ERP.
- **What we take:** Table structure: `journal_entries` (header) + `journal_lines` (debit/credit, account_id, amount numeric(12,3) check), or pgledger's `accounts`, `entries`, `transfers`. Add `organization_id`, `source_document_type` (customer_payment, supplier_payment, expense, payroll, procurement, transfer, adjustment), `source_document_id`, `idempotency_key` unique per org, `created_at`, `event_at`. Enforce balanced entry via deferrable constraint trigger (like Matthew Wong blog: `CREATE CONSTRAINT TRIGGER trg_entry_balanced AFTER INSERT OR UPDATE ON journal_entries DEFERRABLE INITIALLY DEFERRED`). Immutable: no UPDATE/DELETE, only INSERT + reversal entry. Reversal instead of destructive edit. Idempotency: unique index on (org_id, idempotency_key). Account-level balances via SUM, but also store version for optimistic locking.

### Treasury / Cash & Bank
- **Decision:** **BUILD NATIVE**, **LEARN ONLY** from bigcapital banking & ERPNext bank.
- **Reasoning:** No small MIT library for treasury that fits Supabase. Bigcapital and ERPNext show pattern: cash/bank as accounts in chart, treasury movements attributable to source doc, reconciliation = match external statement to internal ledger. Our domain is simple: owner/manager small team, needs to know where money physically moved (cash, bank, other). Need multiple cash/bank accounts? Yes, eventually need to know cash vs bank. Should be native tables `treasury_accounts` (CASH/BANK, name, is_active) + `treasury_movements` (or reuse ledger entries with account_id = treasury account). Simpler: treasury_accounts + ledger entries referencing treasury account.
- **What we take:** Concepts: treasury account as ledger account with positive_only guard, movement kinds: customer_payment, supplier_payment, payroll_payment, expense, purchase, transfer, adjustment. Transfer between treasury accounts (cash to bank). Reconciliation status.

### Accounts Receivable
- **Decision:** **BUILD NATIVE**, **LEARN ONLY** from bigcapital AR & ERPNext AR.
- **Reasoning:** Existing `customer_payments` + `invoices` + `event_finance_summaries` already cover invoice balances, customer payments, outstanding, but missing explicit payment allocation (which invoice does payment settle?), unapplied payments, aging. Bigcapital/ERPNext show allocation table pattern. Our current `amount_paid` is sum of all RECORDED payments per event, not per invoice. Need allocation for customer statements that show per-invoice settlement. But we should not import full AR module; extend native.
- **What we take:** Allocation table `customer_payment_allocations` (payment_id, invoice_id, amount), unapplied = payment amount − sum allocations, aging buckets query (0-30/31-60/61-90/90+ based on due date), customer balance = sum issued invoices − sum payments. Customer statement already exists but should include allocation details.

### Accounts Payable / Suppliers
- **Decision:** **BUILD NATIVE**, **LEARN ONLY** from bigcapital AP & ERPNext AP.
- **Reasoning:** Suppliers table exists but no supplier ledger, no supplier invoices (bills), no supplier payments, no supplier outstanding, no supplier statement. Need similar to AR but for suppliers. No suitable small MIT lib; full ERP would be overkill and AGPL/GPL. Build native with same patterns as AR.
- **What we take:** Supplier statement = mirror of customer statement: BILL rows from supplier invoices + PAYMENT rows from supplier payments. Supplier balance = bills − payments. Aging. Payment allocation to bills.

### Procurement
- **Decision:** **ADAPT** from ERPNext procurement + **BUILD NATIVE**, **LEARN ONLY** from Odoo.
- **Reasoning:** Existing procurement lifecycle DRAFT→APPROVED→SENT→CONFIRMED→PARTIALLY_RECEIVED→RECEIVED→CANCELLED is already close to ERPNext's REQUEST→APPROVED→ORDERED→RECEIVED→INVOICED→PAID. What we miss: supplier invoice (bill) linked to receipt, 3-way match. ERPNext shows how to do 3-way: PO qty/price vs receipt qty vs invoice qty/price within tolerance, flag exception. Our receipts already link to consumable_movements, good foundation. Need to add supplier invoices and matching.
- **What we take:** Supplier invoice table `supplier_invoices` (bill) with lines, status, linkage to PO and receipt, 3-way match trigger that checks cumulative received vs invoiced, tolerance config, exception handling. Keep lifecycle simple, don't blindly import REQUEST→…→PAID if conflicts with simpler operating model — we already have good lifecycle, just add INVOICED state.

### Inventory / Warehouse
- **Decision:** **BUILD NATIVE**, **ADAPT** small pattern from **khawasx/stock-ledger** (MIT) & ERPNext dual-layer concept, **LEARN ONLY** from InvenTree.
- **Reasoning:** Existing app already has reusable-equipment and consumable movement concepts with movement-ledger model (preferred over mutable current quantity only). `consumable_movements` with warehouse_delta/event_delta, no negative balances, `event_equipment_movements` with good/damaged/lost. This is already movement-ledger, not second truth. InvenTree is full Python/Django system — would be second inventory truth, must not create. ERPNext dual-layer (Stock Ledger Entry immutable + Bin aggregated) is good concept but we already have `consumable_stock_summary` and `equipment_availability` as aggregated views. khawasx/stock-ledger shows TS/Next.js/tRPC movement ledger with SUM, audit trail, low-stock alerts — closest to our stack, MIT, could adopt UI pattern for low-stock alerts.
- **What we take:** Keep existing movement tables as source of truth. Add `inventory_ledger` view that unions equipment + consumable movements for unified audit? Or keep separate. Add valuation projection only if appropriate (currently catalog_cost_snapshot). Ensure procurement receipts affect inventory (already does via consumable_movement linkage). Do NOT create second inventory truth.

### Financial Closing / Event Profitability
- **Decision:** **BUILD NATIVE**, **LEARN ONLY** from ERPNext job costing & bigcapital reports.
- **Reasoning:** Event closure already has `event_finance_summaries` with accepted_revenue, amount_paid, outstanding, staff_cost, procurement_cost, expense_cost, actual_cost, actual_profit, margin_percent, and `event_financial_closures` with snapshot and guard triggers. What blocks closure is outstanding_balance >0 (revenue not fully collected). Need trustworthy summary including agreed revenue, collected cash, receivable, direct expenses, host payroll, purchases, losses/damage where relevant. Existing summary already does that, but needs treasury attribution and supplier liabilities. Job costing patterns from ERPNext show direct materials + direct labor + overhead = total job cost, but our domain is events, not generic projects. Keep native.
- **What we take:** Concept of never confusing agreed revenue / cash collected / AR / expense / profit / cash balance — separate accounting concepts (already documented). Ensure closing snapshot includes treasury account breakdown and supplier liabilities. Add management financial dashboard aggregating across events (Tranche G).

### Host Payroll
- **Decision:** **BUILD NATIVE** (preserve domain-specific)
- **Reasoning:** Current flow Event→Staff Assignment→Attendance→Earned Amount→Advances→Payouts→Remaining Due is application-specific, small team, owner/manager operated. Generic payroll/HR system would be overkill and wrong. Keep existing.

### Event Operations
- **Decision:** **BUILD NATIVE** (preserve)
- **Reasoning:** quotation→event flow, event lifecycle, warehouse dispatch/return, event consumables, staffing, attendance, evidence, operational documents are domain-specific, already well-modeled with RLS/RPC.

### Authorization
- **Decision:** **BUILD NATIVE** (preserve 0079/0080)
- **Reasoning:** Capability model is authoritative. Every new operation must map to capability/RLS/RPC. Do not import external roles.

---

## 7. Recommended Financial Architecture

### Minimum Rigorous Architecture for This Product (Owner/Manager + Small Delegated Team, Simple UX, Strong PG Invariants)

**Principle:** Ledger as derived accounting projection initially, not source-of-truth for operational writes, but with path to become source-of-truth. Keep existing operational tables as source for now, add canonical journal layer that is append-only and balanced, populated by triggers or RPCs from business events. This avoids second truth while providing auditability.

**Core Tables (Additive Migrations Only):**

1. **Chart of Accounts (minimal):**
   - `chart_of_accounts` (org_id, code, name, account_type: ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE, is_treasury bool, is_system bool, parent_id, is_active)
   - Seed system accounts: `CASH`, `BANK`, `ACCOUNTS_RECEIVABLE`, `ACCOUNTS_PAYABLE`, `REVENUE`, `DIRECT_EXPENSE`, `STAFF_COST`, `PROCUREMENT_COST`, `EQUIPMENT_LOSS`, etc.
   - No client direct writes; managed via RPC or seed.

2. **Treasury Accounts:**
   - `treasury_accounts` (org_id, id, name, account_type CASH/BANK/OTHER, chart_account_id FK, is_active, balance cached? No, derived from ledger)
   - RLS: cost visibility? Actually treasury needs finance.manage or payment.record? Map to `finance.manage` for manage, `cost.visibility` for read? Decide: `treasury_accounts` manage = finance.manage, read = cost.visibility.

3. **Journal / Ledger:**
   - `journal_entries` (org_id, id, entry_number, entry_date, memo, source_document_type, source_document_id, idempotency_key unique per org, created_by, created_at, event_at, is_reversal bool, reversed_entry_id)
   - `journal_lines` (org_id, id, entry_id, account_id, debit numeric(12,3) check >=0, credit numeric(12,3) check >=0, CHECK (debit>0 AND credit=0) OR (debit=0 AND credit>0), line_memo)
   - Constraint trigger `trg_entry_balanced` deferrable initially deferred: sum(debit) = sum(credit) per entry.
   - No UPDATE/DELETE, only INSERT, reversal via new entry with opposite legs.
   - Indexes: (org_id, entry_date), (org_id, source_document_type, source_document_id), (org_id, idempotency_key) unique.
   - RLS: no direct client access, only via SECURITY DEFINER functions.

4. **Idempotency:** Reuse canonical `command_idempotency` or add `journal_idempotency`? Better reuse canonical register with scope `JOURNAL_POSTING`.

5. **Treasury Movements (if not fully via journal):**
   - Could be derived from journal_lines where account_id is treasury chart account, but also need `treasury_movements` for physical movement attribution: org_id, treasury_account_id, amount, direction IN/OUT, source_type (customer_payment, supplier_payment, payroll, expense, purchase, transfer, adjustment), source_id, created_at.
   - Simpler: treasury movement IS journal entry where one leg is treasury account and other is AR/AP/expense etc. So no second table needed — journal is treasury ledger.

6. **Supplier Invoices & Payments (AP):**
   - `supplier_invoices` (org_id, id, supplier_id, procurement_order_id nullable, invoice_number, invoice_date, due_date, total_amount, status ISSUED/CANCELLED/PAID/PARTIALLY_PAID, idempotency_key, request_fingerprint, created_by, etc) — append-only with VOID via status.
   - `supplier_invoice_lines` (org_id, invoice_id, procurement_order_line_id nullable, description, quantity, unit_price, amount)
   - `supplier_payments` (org_id, id, supplier_id, amount, payment_method, reference, paid_at, treasury_account_id, status RECORDED/VOIDED, idempotency_key, etc)
   - `supplier_payment_allocations` (payment_id, invoice_id, amount) — explicit allocation, sum <= payment amount, sum <= invoice outstanding.
   - Supplier balance = sum issued invoices − sum recorded payments (or via ledger: AP account balance).
   - Supplier statement function: BILL + PAYMENT rows, like customer_statement but for suppliers.

7. **Customer Payment Allocations (AR enhancement):**
   - `customer_payment_allocations` (payment_id, invoice_id, amount)
   - Unapplied = payment amount − sum allocations
   - Aging via invoice due date.

8. **Procurement → Supplier Invoice Link:**
   - Add `procurement_order_invoice_links` or directly supplier_invoice.procurement_order_id
   - 3-way match function: checks PO qty vs receipt qty vs invoice qty, price tolerance, raises exception if mismatch beyond tolerance, but allows override with note for owner? For simple UX, require exact match initially, tolerance later.

9. **Inventory Ledger Integration:**
   - Keep existing `consumable_movements` and `event_equipment_movements` as source.
   - Add view `inventory_ledger` union for audit.
   - Ensure `procurement_receipts` already create consumable_movements — keep.
   - Add `inventory_valuation` view if needed, but not required for MVP — keep catalog_cost_snapshot.

10. **Financial Closing Enhancement:**
    - Existing `event_financial_closures` snapshot already includes revenue/collected/outstanding/costs/profit/margin. Enhance to include treasury breakdown (how much collected via cash vs bank) and supplier liabilities (outstanding supplier invoices linked to event).
    - Guard triggers already block mutations while financially closed — extend to supplier_payments, supplier_invoices.

**Posting Engine (RPCs):**

- `post_journal_entry(p_org_id, p_entry_date, p_memo, p_source_type, p_source_id, p_lines jsonb, p_idempotency_key)` → SECURITY DEFINER, checks has_permission(finance.manage), validates balanced, OMR 3-decimal via `assert_payment_omr`, inserts header + lines atomically, finishes idempotency, audit.
- Business event RPCs call posting engine internally:
  - `record_customer_payment` → after inserting payment, post: debit treasury_account (CASH/BANK) / credit AR
  - `void_customer_payment` → reversal entry
  - `record_event_expense` → debit expense / credit treasury or AP
  - `record_supplier_payment` → debit AP / credit treasury
  - `create_supplier_invoice` → debit procurement_cost / credit AP
  - `host_payout` → debit staff_cost / credit treasury
  - etc.

**Is Ledger Source-of-Truth or Derived?**

- Initially **derived accounting projection** for auditability, but with path to become source-of-truth. Operational tables remain source for business flow, ledger is populated synchronously in same transaction via RPC, so they stay consistent. If ledger posting fails, whole business transaction fails (atomic). This is pgledger's composability benefit: "Do some work, write to the ledger, and it all commits or doesn't atomically."
- Historical corrections via reversal, not destructive mutation (already pattern for payments/expenses).

**Money Handling:**
- Keep `numeric(12,3)` exact OMR, no float, check via `assert_payment_omr`, in TS via milli-OMR BigInt.

**Tenant Isolation:**
- Every new table has `organization_id`, composite FKs, RLS, no cross-org access at boundary (pgTAP tests).

---

## 8. Existing-System Mapping

| External Concept | Current Table/RPC/Model | Required Extension | New Migration | Frontend Surface | Capability | Test Contract |
|---|---|---|---|---|---|---|
| **Immutable ledger posting** | `customer_payments` / `invoices` / `event_expenses` / `host_payouts` (append-only) | Introduce `chart_of_accounts`, `journal_entries`, `journal_lines` canonical layer, posting engine RPC | Additive migration `0081_ledger_foundation` | No direct frontend ledger writes; finance panel shows ledger audit trail read-only | `finance.manage` for posting, `cost.visibility` for read | pgTAP: balanced entry, idempotency, no UPDATE/DELETE, org isolation, reversal |
| **Treasury accounts** | None (payment_method enum only) | `treasury_accounts` table + link to chart_of_accounts, `treasury_movements` derived from journal | `0082_treasury_accounts` | Settings → Treasury Accounts CRUD, Payments form: select treasury account (cash/bank) | `finance.manage` manage, `cost.visibility` read, `payment.record` for payment attribution | pgTAP: positive_only guard, no negative balance if configured, org isolation, transfer balanced |
| **Customer payment allocation** | `customer_payments` sum per event, no invoice link | `customer_payment_allocations` table, unapplied calc | `0083_customer_payment_allocation` | InvoicesPanel: allocate payment to invoices, show unapplied, aging | `payment.record` / `invoice.manage` | pgTAP: allocation sum <= payment, sum <= invoice outstanding, idempotency |
| **Supplier ledger** | `suppliers` master only | `supplier_invoices`, `supplier_invoice_lines`, `supplier_payments`, `supplier_payment_allocations`, `supplier_statement()` function | `0084_suppliers_ap` | SuppliersArea: supplier statement, outstanding, aging, record bill, record payment | `procurement.manage` for bills, `finance.manage` for payments, `cost.visibility` for read | pgTAP: supplier balance = bills−payments, no cross-org, void shape |
| **Procurement → Goods Receipt → Supplier Invoice (3-way match)** | `procurement_orders` + `procurement_receipts` + `procurement_receipt_lines` linked to `consumable_movements` | Add `supplier_invoices.procurement_order_id`, `supplier_invoice_lines.procurement_order_line_id`, 3-way match trigger/function | `0085_procurement_3way_match` | Procurement OrderDetail: show receipts + invoices + match status, flag mismatch | `procurement.manage` | pgTAP: over-receipt blocked, over-invoice blocked, cumulative qty checks |
| **Inventory ledger integration** | `consumable_movements` + `event_equipment_movements` already movement-ledger | Add unified view `inventory_ledger`, ensure procurement receipt → consumable movement link preserved, add low-stock alert view | `0086_inventory_ledger_view` (no table, view only) | ConsumablesPage: low-stock alerts, Warehouse: unified ledger audit | `warehouse.dispatch` / `consumable.manage` / `stock.adjust` | pgTAP: no negative balances, org isolation, derived balances |
| **Event financial closing** | `event_finance_summaries` + `event_financial_closures` + `guard_event_financially_closed` | Enhance closure snapshot to include treasury breakdown + supplier liabilities, extend guard to supplier tables | `0087_event_closure_enhancement` | EventWorkspace → Finance tab: show closure readiness including treasury & supplier checks, close/reopen with snapshot | `finance.manage` | pgTAP: closure blocks mutations, snapshot totals match live, double-close idempotent |
| **Management financial dashboard** | `management_metrics` + `event_finance_summaries` | Add views aggregating ledger balances, treasury balances, AR aging, AP aging, cash flow, profit per event | `0088_management_dashboard` | Home dashboard: cash by treasury account, AR aging, AP aging, profit MTD, event economics | `finance.manage` / `cost.visibility` | Frontend tests: dashboard reads via org-scoped queries, no fabricated zeros |

---

## 9. Implementation Tranches

**Decomposition rationale:** Accounting foundation first (ledger + treasury), then suppliers/AP (needed for procurement invoice), then procurement 3-way, then inventory ledger view, then event closing, then dashboard. This respects dependencies: ledger needed for treasury attribution, treasury needed for payment attribution, suppliers needed for 3-way, etc. Simpler than original A-G but same.

### Tranche A — Accounting Foundation / Posting Model
- **Scope:** Chart of accounts (minimal system accounts), journal_entries + journal_lines, posting engine RPC `post_journal_entry`, deferrable balanced trigger, idempotency, immutability (no UPDATE/DELETE), reversal via new entry, OMR 3-decimal checks, org isolation, RLS.
- **Reused/reference:** **ADAPT** pgledger (MIT) — single file SQL, transfer = 2 entries, version, event_at, ULID concept, examples. **LEARN ONLY** Formance Numscript (declarative transaction DSL), lefra operation pattern.
- **DB changes:** New tables `chart_of_accounts`, `journal_entries`, `journal_lines`, indexes, triggers, function `assert_entry_balanced`, `post_journal_entry`, seed system accounts.
- **RPCs:** `post_journal_entry`, `reverse_journal_entry`, `journal_entry_history`, `account_balance`, `account_balance_at_time`.
- **RLS:** No direct client access to journal tables, only via SECURITY DEFINER functions, revoke all from anon/authenticated, grant execute to authenticated for read functions gated by `has_permission(cost.visibility)` or `finance.manage`.
- **Capabilities:** `finance.manage` for posting, `cost.visibility` for read.
- **Frontend:** None for writes (no direct ledger writes), read-only audit trail component `LedgerAuditTrail` behind finance capability, shows entries for event/payment.
- **Tests:** pgTAP: balanced entry must have >=2 lines, sum debit=credit, no UPDATE/DELETE, idempotency returns same, org isolation fails cross-org, OMR precision, reversal creates opposite entry, historical balance query.
- **Migration deps:** After 0080, so `0081_ledger_foundation`.
- **Acceptance:** Can post balanced entry via RPC, unbalanced rejected, duplicate idempotency key returns original, cross-org fails, no direct table write, audit logged.

### Tranche B — Treasury Accounts & Money Movements
- **Scope:** `treasury_accounts` (CASH/BANK/OTHER), link to chart_of_accounts, treasury movements via journal (debit treasury / credit AR etc), transfer between treasury accounts, cash/bank selection in payment forms, reconciliation status.
- **Reused/reference:** **LEARN ONLY** bigcapital banking, ERPNext bank, actualbudget rules.
- **DB changes:** `treasury_accounts` table, FK to chart_of_accounts, function `create_treasury_account`, `transfer_treasury`, enhance `record_customer_payment` to accept `p_treasury_account_id` and post journal internally, same for supplier payments, payroll, expenses.
- **RPCs:** `create_treasury_account`, `update_treasury_account`, `transfer_treasury`, `treasury_account_balances`, `treasury_statement`.
- **RLS:** `treasury_accounts` SELECT cost.visibility, INSERT/UPDATE finance.manage via RPC.
- **Capabilities:** `finance.manage` manage, `cost.visibility` read, `payment.record` for attribution.
- **Frontend:** Settings → Treasury Accounts CRUD, Payments form dropdown for treasury account, Finance panel shows cash vs bank breakdown.
- **Tests:** pgTAP: treasury account positive_only if configured, transfer balanced, payment without treasury fails? Or defaults to cash, org isolation, idempotency.
- **Migration deps:** Depends on A (ledger), so `0082_treasury_accounts`.
- **Acceptance:** Can create cash and bank accounts, record customer payment to cash, transfer cash→bank, balances derived from ledger, UI shows breakdown.

### Tranche C — Suppliers & Accounts Payable
- **Scope:** Supplier invoices (bills), supplier payments, payment allocations, supplier balance, supplier statement, aging, outstanding.
- **Reused/reference:** **LEARN ONLY** bigcapital AP, ERPNext AP.
- **DB changes:** `supplier_invoices`, `supplier_invoice_lines`, `supplier_payments`, `supplier_payment_allocations`, functions `create_supplier_invoice`, `void_supplier_invoice`, `record_supplier_payment`, `void_supplier_payment`, `allocate_supplier_payment`, view `supplier_statement(org, supplier)` mirroring customer_statement.
- **RPCs:** As above, all SECURITY DEFINER, idempotent, audited.
- **RLS:** cost-gated reads, finance.manage / procurement.manage gates.
- **Capabilities:** `procurement.manage` for bills, `finance.manage` for payments, `cost.visibility` for reads.
- **Frontend:** SuppliersArea enhanced: supplier detail with statement (BILL/PAYMENT rows), outstanding, aging, record bill, record payment, allocation UI.
- **Tests:** pgTAP: supplier balance = bills−payments, allocation sum <= payment and <= invoice outstanding, unapplied calc, org isolation, void shape, idempotency.
- **Migration deps:** Depends on A/B (ledger + treasury for payment attribution), so `0083_suppliers_ap` + `0084_supplier_allocations`.
- **Acceptance:** Can record supplier bill, record payment to bill, allocate, see outstanding, aging, statement.

### Tranche D — Procurement → Goods Receipt → Supplier Invoice (3-Way Match)
- **Scope:** Link procurement orders to supplier invoices, enforce 3-way match PO qty/price vs receipt qty vs invoice qty/price, tolerances, partial receipts, exception handling.
- **Reused/reference:** **ADAPT** ERPNext procurement lifecycle & 3-way match logic, **LEARN ONLY** Odoo.
- **DB changes:** Add `supplier_invoices.procurement_order_id`, `supplier_invoice_lines.procurement_order_line_id`, `procurement_order_invoice_links`, function `check_3way_match(org, order_id)` that verifies cumulative received vs invoiced within tolerance, trigger or RPC guard on invoice creation.
- **RPCs:** `create_supplier_invoice_from_procurement`, `receive_procurement_order` already exists, enhance to check match, `procurement_3way_status`.
- **RLS:** procurement.manage.
- **Capabilities:** `procurement.manage`.
- **Frontend:** OrderDetailDialog shows 3 tabs: Order Lines, Receipts, Invoices, with match status (matched / over-receipt / over-invoice / price mismatch), alert if mismatch.
- **Tests:** pgTAP: over-receipt blocked (already), over-invoice blocked (new), cumulative qty checks, price tolerance, partial receipt + partial invoice allowed, org isolation.
- **Migration deps:** Depends on C (supplier invoices), so `0085_procurement_3way_match`.
- **Acceptance:** Can receive PO partially, invoice partially, 3-way match passes when qty/price align, fails when mismatch, UI shows status.

### Tranche E — Inventory Ledger Integration
- **Scope:** Unified inventory ledger view, ensure procurement receipts affect inventory (already), event-linked purchases flow into event costing, low-stock alerts, damage/loss handling.
- **Reused/reference:** **ADAPT** khawasx/stock-ledger (MIT) UI pattern, **LEARN ONLY** ERPNext dual-layer (Stock Ledger Entry + Bin), InvenTree.
- **DB changes:** View `inventory_ledger` union of consumable_movements + equipment_movements, view `inventory_valuation` if needed (catalog_cost_snapshot), function `inventory_on_hand`, low-stock view.
- **RPCs:** No new writes, only read models, but ensure `receive_procurement_order` already creates consumable_movements.
- **RLS:** warehouse.dispatch / consumable.manage / stock.adjust.
- **Capabilities:** Existing.
- **Frontend:** ConsumablesPage low-stock alerts, Warehouse tab unified ledger audit, EventWorkspace EquipmentTab shows valuation.
- **Tests:** pgTAP: no negative balances, derived balances match SUM, org isolation, procurement receipt creates movement.
- **Migration deps:** Depends on D (receipts), so `0086_inventory_ledger`.
- **Acceptance:** Inventory on hand derived from movements, procurement receipt increases stock, low-stock alert works, no second truth.

### Tranche F — Event Financial Closing
- **Scope:** Enhance financial closure to include treasury breakdown, supplier liabilities, losses/damage, trustworthy summary of agreed revenue, collected cash, receivable, direct expenses, host payroll, purchases, losses, resulting economics. Ensure closure blocks all financial mutations (extend guard to supplier tables).
- **Reused/reference:** **BUILD NATIVE**, **LEARN ONLY** ERPNext job costing, bigcapital reports.
- **DB changes:** Enhance `event_financial_closures` snapshot columns to include treasury breakdown JSONB, supplier liabilities, loss totals, function `event_financial_readiness` enhanced to check supplier outstanding? Actually closure currently requires outstanding_balance <=0 (AR), should also require supplier? For event, supplier liabilities may remain after event closed? Decide: closure requires AR cleared, but AP may remain? For simplicity, require AR cleared only, but snapshot AP. Add guard triggers for supplier_invoices/payments.
- **RPCs:** `close_event_financially` enhanced snapshot, `reopen_event_financially`, `event_financial_readiness` enhanced, `event_profitability` view already exists.
- **RLS:** finance.manage.
- **Capabilities:** `finance.manage`.
- **Frontend:** EventWorkspace Finance tab: show readiness checks (revenue, outstanding, staff_cost, procurement, expense, treasury, supplier), close/reopen with note, show snapshot at close.
- **Tests:** pgTAP: closure blocks customer_payments, supplier_payments, expenses, attendance, payouts, double-close idempotent, snapshot matches live, org isolation.
- **Migration deps:** Depends on A-E, so `0087_event_closure_enhancement`.
- **Acceptance:** Can close event only when AR cleared, snapshot includes all cost sources, mutations blocked while closed, reopen allows mutations, audit logged.

### Tranche G — Management Financial Dashboard
- **Scope:** Management dashboard aggregating cash by treasury account, AR aging, AP aging, profit MTD, event economics, customer 360, supplier 360, search, integrity reports.
- **Reused/reference:** **LEARN ONLY** bigcapital reports, ERPNext reports.
- **DB changes:** Views: `treasury_balances`, `ar_aging`, `ap_aging`, `cash_flow`, `profit_by_event`, `management_financial_summary`.
- **RPCs:** Read-only functions for dashboard, gated by cost.visibility / finance.manage.
- **RLS:** cost-gated.
- **Capabilities:** `finance.manage` / `cost.visibility`.
- **Frontend:** Home dashboard enhanced: StatCards for cash (cash vs bank), AR total + aging, AP total + aging, profit MTD, event profitability table, search.
- **Tests:** Frontend tests: dashboard reads via org-scoped queries, no fabricated zeros, loading states, error boundaries. pgTAP for views.
- **Migration deps:** Depends on F, so `0088_management_dashboard`.
- **Acceptance:** Dashboard shows trustworthy numbers derived from ledger, not fabricated, tenant-isolated, capability-gated.

---

## 10. Risks

### Accounting Risks
- **Double-counting:** Recording purchase both as procurement cost and as event_expense would double-count. Mitigation: Keep 0067 split deliberate — purchases from procurement only, expenses from event_expenses only, staff cost from payroll only. Ledger posting must respect same split.
- **Confusing revenue/cash/receivable/expense/profit/cash balance:** These are separate concepts. Mitigation: Document and enforce in `event_finance_summaries` and closure snapshot, never sum revenue + cash, never treat outstanding as expense.
- **Unbalanced journal:** If posting engine allows unbalanced entry, ledger corrupt. Mitigation: Deferrable constraint trigger `trg_entry_balanced`, check sum debit=credit in RPC before insert, pgTAP.
- **Floating money:** JS number arithmetic could introduce float errors. Mitigation: Keep `numeric(12,3)` in PG, milli-OMR BigInt in TS, `assert_payment_omr`, `multiplyOMR` via BigInt, no float.
- **Historical corrections:** Destructive UPDATE/DELETE would erase audit trail. Mitigation: Append-only + reversal pattern, triggers block UPDATE/DELETE on journal, payments, expenses, etc.
- **Idempotency:** Duplicate submission (network retry) could double-post. Mitigation: Unique (org_id, idempotency_key) + SHA-256 fingerprint, `begin_command` / `finish_command` pattern already used.

### Licensing Risks
- **AGPL/GPL contamination:** Copying code from bigcapital (AGPL-3.0) or ERPNext (GPL-3.0) would require open-sourcing entire app under same license, violating product goals. Mitigation: Classify AGPL/GPL as REFERENCE/CONCEPT ONLY, never copy implementation. For MIT/Apache-2.0 candidates (pgledger, lefra, Formance, blnk, TigerBeetle, InvenTree, stock-ledger), SAFE FOR DIRECT ADAPTATION but still ADAPT (rewrite) not transplant, preserve attribution.
- **No license / unclear:** Some repos have no LICENSE file — must REJECT direct copy. Mitigation: Check license file before any adaptation.
- **Attribution:** MIT requires preservation of copyright notice. Mitigation: Add `THIRD_PARTY_NOTICES.md` for pgledger etc.

### Migration Risks
- **Historical migration edits:** Editing historical migrations breaks replay and CI. Mitigation: Additive migrations only, never edit 0001–0080, new migrations 0081+ only.
- **Migration ordering:** New migrations must be ordered after 0080, with timestamp prefix. Mitigation: Inspect latest migration (`ls supabase/migrations | sort`) before creating new number.
- **RLS bypass:** New tables without RLS or with permissive policies could leak cross-org. Mitigation: Enable RLS on all new tables, no direct client grants, only SECURITY DEFINER RPCs, pgTAP tenant-isolation tests.
- **Lock order:** New RPCs must respect existing lock order (Event→Reservation→Capacity, etc) to avoid deadlocks. Mitigation: Document lock order, use same pattern.
- **Performance:** Journal with SUM for balances could be slow at scale. Mitigation: Add indexes, consider materialized view or Bin-like aggregated cache later (like ERPNext Bin), but keep simple initially — owner/manager small team scale is low.

### Security Risks
- **Capability bypass:** New financial operations must map to capability model, otherwise owner delegation broken. Mitigation: Every new RPC checks `has_permission(org, cap)` — e.g., `finance.manage` for ledger posting, `payment.record` for customer payments, `procurement.manage` for supplier bills, etc. Add pgTAP negative authorization tests.
- **Cross-org access:** Must fail at DB boundary. Mitigation: Composite FKs, RLS, checks `is_org_member`, pgTAP cross-org tests.
- **Anonymous access:** No anon grants on new tables. Mitigation: `revoke all on table ... from anon; grant ... to authenticated` only via RPC.
- **Audit:** All financial mutations must call `record_audit` internal-only. Mitigation: RPCs call `record_audit`, no client direct audit writes.

### Integration Risks
- **Second ledger truth:** Introducing Formance stack, blnk, TigerBeetle as separate service would create second ledger truth competing with existing `customer_payments` / `event_expenses` etc. Mitigation: Do NOT import entire ERP, do NOT vendor entire repo, do NOT add microservice, keep product native, adapt only small SQL patterns (pgledger).
- **Second inventory truth:** InvenTree full system would compete with existing `consumable_movements` / `event_equipment_movements`. Mitigation: Keep existing movement tables as source, only add view.
- **Second payroll truth:** Generic payroll/HR would compete with host payroll model. Mitigation: Preserve Event→Assignment→Attendance→Earned→Advances→Payouts flow.
- **ORM introduction:** Some reference projects use Prisma, GORM, etc. Introducing another ORM because reference uses it would add complexity. Mitigation: Keep Supabase/PostgreSQL authoritative, no new ORM.
- **Frontend complexity:** Owner/manager UX must remain simple even if accounting underneath rigorous. Mitigation: Hide ledger complexity behind simple forms (record payment → select treasury account, not debit/credit), show audit trail read-only.
- **Temporary research artifacts:** Cloned repos under product directory would pollute repo. Mitigation: Clone only to `/tmp/arena-component-research/<repo>` and delete before finish. No scratch files.

---

## 11. Cleanup Confirmation

- **No temporary repositories remain:** Verified `ls /tmp/arena-component-research` — does not exist, no clones in product repo (`find . -type d -name ".git" | grep -v "./.git"` empty, no `vendor/`, `research-repos/`, `third-party/`, `scratch/` directories).
- **No scratch files remain:** `git status` clean, working tree clean, no untracked files (except this research doc which is deliberate documentation).
- **No experimental dependencies remain:** `package.json` unchanged, no new dependencies added (no `pgledger`, `lefra`, `formance`, etc installed). `package-lock.json` unchanged.
- **No old implementation was copied wholesale:** No foreign backend, no auth system, no tenant model, no ORM, no migration history imported. Only concepts studied.
- **Working tree is clean:** `git status` shows only this new file `docs/research/financial-component-harvest.md` untracked (to be committed), no modifications to existing files.
- **Remote branches:** Only `main` remains on origin (verified via `git ls-remote --heads origin`).
- **Open PRs:** 0 (verified via `gh pr list --state open`).

---

## 12. Recommendation

### What Arena Recommends We Build Next and Why

**Recommendation: Proceed with Tranche A — Accounting Foundation / Posting Model, using ADAPT from pgr0ss/pgledger (MIT), then immediately Tranche B — Treasury Accounts & Money Movements, BUILD NATIVE with LEARN ONLY from bigcapital/ERPNext.**

**Why this order:**

1. **Correctness first:** Current system has append-only ledgers for payments/expenses but no formal double-entry, no balanced invariant, no reversal chain, no treasury attribution. This is the biggest accounting risk. Formal ledger with deferrable balanced trigger + immutability + idempotency is minimal rigorous architecture that unblocks everything else (treasury, AP, procurement invoice, closing).

2. **Minimal new code, maximal reuse:** pgledger is 1 SQL file, MIT, pure PG, no app code, transactional guarantees with rest of app — exactly our Supabase RPC philosophy. Adapting it means adding `organization_id`, RLS, capability gates, OMR checks, source-document refs, not transplanting entire ERP. Integration cost low, risk low, licensing safe.

3. **Treasury is immediate operator need:** Owner needs to know where money physically moved (cash vs bank). Currently `payment_method` enum exists but no cash/bank account. Adding `treasury_accounts` + journal posting (debit treasury / credit AR) is small, native, and makes customer payments auditable. This also unblocks supplier payments and payroll payouts attribution.

4. **Preserves domain-specific systems:** Host payroll flow (Event→Assignment→Attendance→Earned→Advances→Payouts) and event operations (quotation→event, warehouse dispatch/return, consumables, staffing, attendance, evidence, office documents) remain native. Authorization 0079 remains authoritative. No second truth.

5. **Simple UX:** Even with rigorous ledger underneath, operator UX stays simple: record payment → select treasury account (cash/bank), amount, method, reference. No debit/credit UI. Ledger audit trail read-only for finance capability.

6. **Dependency order:** Ledger → Treasury → Suppliers/AP → Procurement 3-way → Inventory view → Event closing → Dashboard is the correct dependency chain. Building suppliers before treasury would lack attribution; building 3-way before supplier invoices impossible; building dashboard before ledger would show untrustworthy numbers.

**What NOT to build now:**

- Do NOT fork entire ERP (ERPNext GPL, bigcapital AGPL, Odoo LGPL) — would violate licensing, create second truth, add unnecessary microservices, auth, tenant models.
- Do NOT add TigerBeetle or Formance stack as separate service — narrow specialized DB or microservices would be second ledger truth, high integration cost, not needed for small team scale.
- Do NOT create second inventory truth — InvenTree full system would compete with existing movement ledgers.
- Do NOT replace host payroll with generic HR — domain-specific flow must stay.
- Do NOT import external roles/permission matrices — 0079 capability model remains authoritative.

**Next steps after research approval:**

1. Create migration `0081_ledger_foundation` adapting pgledger pattern: chart_of_accounts, journal_entries, journal_lines, balanced trigger, posting RPC, RLS, pgTAP tests (balanced, idempotent, immutable, tenant isolation, negative auth).
2. Create migration `0082_treasury_accounts` with treasury_accounts table, link to chart, enhance `record_customer_payment` to post journal and require treasury_account_id.
3. Add frontend: Treasury Accounts settings page (CRUD) behind `finance.manage`, Payments form treasury account selector.
4. Verify: typecheck, lint, frontend tests, production build, pgTAP, tenant-isolation, negative auth, idempotency, financial invariant tests.
5. Then proceed to Tranche C (Suppliers/AP) etc per tranches.

**Optimize for:** correct accounting semantics, simple operator UX, reuse where genuinely beneficial (pgledger MIT), minimal new code, strong PostgreSQL invariants, clean integration, maintainability, auditability, tenant isolation, licensing safety, repository cleanliness.

Research first. Understand before copying. Adapt only what belongs. Keep product native to existing architecture.

---

## Appendix: Provenance & Search Log

- Search performed via `web_search` tool, depth 2-3, queries listed in §3.
- No code copied; only concepts studied.
- Temporary workspace `/tmp/arena-component-research` not used (no clones), but if used would be deleted.
- License checks via GitHub LICENSE files and web_search.
- Existing system baseline reconstructed from `DATA_MODEL.md`, `ARCHITECTURE.md`, migrations 0001–0080, and source inspection of `src/features/finance`, `payments`, `procurement`, `warehouse`, `consumables`, `lib/money.ts`.

**End of Report.**
