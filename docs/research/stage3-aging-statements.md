# 0096 Design — Stage 3 Read Models: AR/AP/Contract-Asset Aging + Supplier & Customer Statements

Tranche: close the remaining explicitly-named Contract §20 Stage 3 surfaces.
Status: IMPLEMENTED (this file is the pre-code implementation contract).

## 1. Reality Gate (delta, verified 2026-09-05)

- `origin/main` = `44258464a4b59e54478cde2ceb9a473a63d9bc02` (0095 merged); tree clean.
- 96 migrations; tail = `20260905180000_0095_vat_gross_deposit_reconciliation.sql`.
- Fresh search of every ref: no `0096`+ anywhere. Open PRs: 0. Remote branches:
  `main`, `feat/ai-operations-assistant` (untouched — parallel UI session).
- No other branch/session is implementing Stage 3 read models (no collision).

## 2. Contract gate — exact §20 Stage 3 wording

> **Stage 3:** Introduce accounting-specific read models: account_balance,
> account_raw_balance, journal_history, treasury_balances, **ar_aging**,
> **ap_aging**, **customer_statement enhanced with allocation**,
> **supplier_statement**, staff_payable, **contract_asset aging**, etc.,
> gated by cost.visibility/finance.manage.

Already on main (do NOT recreate): `account_raw_balance`/`account_balance`/
`account_balance_at_time` (0084), `treasury_account_balances`/`treasury_statement`
(0085), `accounting_journal_history`/`accounting_payroll_positions`/
`accounting_customer_positions`/`accounting_supplier_positions`/
`accounting_trial_balance`/`accounting_cutover_status` (0094), reconciliation +
cutover (0093/0095). Remaining named surfaces = this tranche: **ar_aging,
ap_aging, contract_asset aging, supplier_statement, customer_statement
enhanced with allocation**.

§20 also binds: "Office documents (customer_statement, etc) continue using
existing functions until accounting-enhanced versions proven" and "New
accounting fields added as new columns or new views, not renaming old."
Therefore the existing **0080 `customer_statement(org, customer)` (commercial
CHARGE/PAYMENT document) stays untouched**; the accounting surface is a NEW
function `accounting_customer_statement`.

## 3. Existing-surface audit (reuse, do not duplicate)

- `_ledger_event_raw(org, event, account)` (0093) — canonical per-event raw
  ledger balance. Reused for AR (1100) and contract asset (1120).
- `_supplier_ap_position(org, supplier)` (0093) — canonical per-supplier AP
  balance incl. `OPENING_BALANCE` attribution (source-document joins on
  `supplier_invoices`/`supplier_payments` + `source_id = supplier`). Reused
  verbatim for AP aging balance AND as the attribution predicate for the
  supplier statement (same EXISTS joins — no second attribution formula).
- `_ledger_event_deposit_vat` (0095), `accounting_customer_positions`
  outstanding semantics (0094): `outstanding = AR_raw + CA_raw + dep_raw`,
  negative = net customer prepayment (0094 documented). The customer
  statement's running balance reuses this exact identity — no new formula.
- `customer_payment_allocations` (0087: payment_id, invoice_id, gross/net/vat
  amounts) — the authoritative allocation record named by §17; used as the
  "enhanced with allocation" detail (it IS the allocation truth; not financial
  re-derivation).
- Pagination precedent: `accounting_journal_history(org, from, to,
  source_type, event_id, limit 100, offset 0)` (0094).
- `journal_entries` carries entry_number, entry_date, event_at, source_type,
  source_id, event_id, is_reversal, reversal_of, memo, created_at — all
  statement needs are ledger-native; operational tables appear only as
  document labels/dates (0094 §5 architecture).

## 4. Design matrix

| Surface | Contract | Source of truth (financial) | Labels/docs | Security | Tests |
|---|---|---|---|---|---|
| `accounting_ar_aging(org, as_of)` | §20 ar_aging | ledger 1100 raw per event via `_ledger_event_raw` (gross incl. VAT per §5/0095) | events/customers; invoices not needed (origin = journal) | cost.visibility | VAT/non-VAT, settle→row gone, void, bucket boundary via as_of, empty, isolation, auth |
| `accounting_ap_aging(org, as_of)` | §20 ap_aging | `_supplier_ap_position` (canonical) | suppliers | cost.visibility | invoice→balance, partial pay, void, cutover opening, buckets, isolation, auth |
| `accounting_contract_asset_aging(org, as_of)` | §20 contract_asset aging | ledger 1120 raw per event (gross, Option B §4) | events/customers | cost.visibility | CLOSED-unbilled recognition, invoice reclass→row gone, empty, auth |
| `accounting_supplier_statement(org, supplier, from, to, limit, offset)` | §20 supplier_statement | 2200 lines of supplier-attributed entries (`_supplier_ap_position` predicate) | supplier_invoices.invoice_number/invoice_date; supplier_payments.reference/payment_date; events | cost.visibility | running balance over invoice/payment/void, ordering, window, pagination, isolation, auth |
| `accounting_customer_statement(org, customer?, event?, from, to, limit, offset)` | §20 customer_statement enhanced with allocation | event-scoped customer-family journal entries; impact/running on 1100+1120+2000 raw (= 0094/0095 outstanding identity) | invoices.invoice_number; customer_payments.reference; customers/events | cost.visibility | full lifecycle, allocations jsonb (gross/net/vat + invoice), voids, prepayment negative running, pagination, ordering, isolation, auth |

All five are read-only, share one security pattern, one identity set, and no
write path — **one coherent atomic Stage-3 tranche, one migration**. No split
justified: there is no dependency ordering among them and the shared helpers
already exist.

## 5. Exact specifications

### 5.1 `accounting_ar_aging(p_org_id uuid, p_as_of date default current_date)`
Rows (per event with positive AR): `event_id, event_number, customer_id,
customer_name, ar_gross, ar_origin_date, age_days, aging_bucket`.
- `ar_gross = _ledger_event_raw(org, event, '1100')`; keep rows `> 0` only.
- `ar_origin_date = min(entry_date)` over the event's non-reversal entries
  touching 1100 with `source_type IN ('INVOICE','OPENING_BALANCE')`.
- `age_days = p_as_of − ar_origin_date`;
  bucket: `<=30 CURRENT`, `<=60 DAYS_31_60`, `<=90 DAYS_61_90`, else `OVER_90`
  (documented derivation; contract names the surface, not bucket edges).
- Order: `age_days DESC NULLS LAST, event_number`. No pagination (bounded by
  event count; matches 0094 position lists).
- Deposit-only or CLOSED-unbilled events never appear (no 1100 lines) — AR
  does not exist before invoicing (§5 contract).

### 5.2 `accounting_ap_aging(p_org_id uuid, p_as_of date default current_date)`
Rows (per supplier with positive AP): `supplier_id, supplier_name, ap_balance,
ap_origin_date, age_days, aging_bucket`.
- `ap_balance = _supplier_ap_position(org, supplier)` (reuse; includes
  OPENING_BALANCE); keep `> 0` only.
- `ap_origin_date = min(entry_date)` over non-reversal supplier-attributed
  entries touching 2200 with `source_type IN ('SUPPLIER_INVOICE',
  'OPENING_BALANCE')`; attribution = the exact `_supplier_ap_position`
  predicate.
- Same buckets; order `age_days DESC NULLS LAST, supplier_name`.

### 5.3 `accounting_contract_asset_aging(p_org_id uuid, p_as_of date default current_date)`
Rows (per event with positive CA): `event_id, event_number, customer_id,
customer_name, contract_asset_gross, recognition_date, age_days, aging_bucket`.
- `contract_asset_gross = _ledger_event_raw(org, event, '1120')` (gross incl.
  VAT per §4 Option B); keep `> 0` only.
- `recognition_date = min(entry_date)` over the event's non-reversal entries
  touching 1120 with `source_type IN ('UNBILLED_RECOGNITION','OPENING_BALANCE')`.
- Invoicing reclassifies CA→AR (CONTRACT_ASSET_RECLASSIFICATION credits 1120)
  → row disappears from journal state alone; no lifecycle special-casing.
- Same buckets/ordering as AR aging.

### 5.4 `accounting_supplier_statement(p_org_id uuid, p_supplier_id uuid, p_from date default null, p_to date default null, p_limit int default 100, p_offset int default 0)`
Rows (chronological AP activity for one supplier): `entry_date, created_at,
entry_number, source_type, is_reversal, document_number, document_date,
event_id, event_number, ap_debit, ap_credit, running_balance, memo`.
- Entries = `_supplier_ap_position` attribution predicate (SUPPLIER_INVOICE/_VOID
  via supplier_invoices.supplier_id; SUPPLIER_PAYMENT/_VOID via
  supplier_payments.supplier_id; OPENING_BALANCE with source_id = supplier);
  `ap_debit/ap_credit` = that entry's 2200 line sums.
- `running_balance = Σ(ap_credit − ap_debit)` over the fully-ordered set
  (window BEFORE pagination) → credit-normal AP running balance.
- Labels: invoice_number/invoice_date or payment reference/payment_date;
  event label when the document is event-scoped.
- Window filter on `entry_date`; order `entry_date, created_at,
  entry_number` (org-unique → deterministic); LIMIT/OFFSET after the window.
  Supplier not in org → zero rows.

### 5.5 `accounting_customer_statement(p_org_id uuid, p_customer_id uuid default null, p_event_id uuid default null, p_from date default null, p_to date default null, p_limit int default 100, p_offset int default 0)`
Rows (chronological customer-side activity, event-scoped): `entry_date,
created_at, entry_number, source_type, is_reversal, event_id, event_number,
customer_id, customer_name, document_number, impact_on_outstanding,
running_outstanding, allocations jsonb, memo`.
- Entries = event-scoped (`event_id IS NOT NULL`) entries with `source_type IN
  ('CUSTOMER_PAYMENT','CUSTOMER_PAYMENT_VOID','CUSTOMER_DEPOSIT_APPLIED',
  'CUSTOMER_DEPOSIT_RELEASED','INVOICE','INVOICE_VOID','REVENUE_RECOGNITION',
  'UNBILLED_RECOGNITION','CONTRACT_ASSET_RECLASSIFICATION','REVENUE_REVERSAL',
  'OPENING_BALANCE')`. Payroll/supplier/treasury openings carry no event_id →
  excluded by construction.
- Scope: event (validated to org), or customer (via events.customer_id), or
  org-wide; if both provided they intersect. Unknown event/customer → empty.
- `impact_on_outstanding = Σ(debit − credit)` of the entry's lines on 1100 +
  1120 + 2000 — the exact 0094 `outstanding_ar` / 0093 reconciliation
  `outstanding` identity; negative = net prepayment (0094 documented).
- `running_outstanding = Σ impact` over the fully-ordered scope (window before
  pagination).
- `document_number`: invoices.invoice_number (source_id → invoice) for
  INVOICE-family, customer_payments.reference for payment-family.
- `allocations` (the §20 enhancement): for entries whose source_id matches
  `customer_payment_allocations.payment_id` OR `.invoice_id`, JSON array of
  `{payment_reference, invoice_number, gross_amount, net_amount, vat_amount}`
  from the authoritative allocation table; else NULL.
- Order `entry_date, created_at, entry_number` (entry_number is org-unique →
  fully deterministic); window on entry_date; LIMIT/OFFSET after the window.

### Common security contract (0094 pattern, unchanged)
plpgsql, `STABLE`, `SECURITY DEFINER`, `SET search_path = ''`, fully
qualified refs, first statement `if not public.has_permission(p_org_id,
'cost.visibility') then raise exception 'NOT_AUTHORIZED' using errcode =
'42501'`, `ensure_system_chart` before `_chart_id` use, org filter on BOTH
header and line tables everywhere, `revoke all from public, anon` + `grant
execute to authenticated`, deterministic ORDER BY, no dynamic SQL, no new
tables/indexes/grants/capabilities.

## 6. Test matrix (`supabase/tests/stage3_aging_statements.test.sql`)

VAT org (5%): E1 deposit→invoice→settle, E2 deposit→CLOSED-unbilled, E3
deposit→void, pagination event; non-VAT org regression; supplier with service
PO→invoice→payment→void; cutover-opened AP; outsider user.
- AR aging: appears after invoice (gross incl. VAT), gone after settle;
  bucket boundary via `p_as_of` (+45d → DAYS_31_60, +100d → OVER_90); absent
  for deposit-only and CLOSED-unbilled events; empty org → 0 rows.
- AP aging: invoice balance, partial payment, payment void restores, bucket
  boundary, cutover OPENING_BALANCE row, gone when settled.
- CA aging: appears at CLOSED recognition (gross incl. remaining VAT), gone
  after invoice reclassification.
- Supplier statement: chronological rows, running balance ends at AP balance,
  window filter, pagination determinism, cross-org supplier → 0 rows.
- Customer statement: row sequence & impacts (−net deposit, +AR creation,
  0 allocation, −settlement), running ends 0; allocations jsonb carries
  gross/net/vat + invoice number; void rows restore running; prepayment
  running negative; per-customer scope excludes other customers; pagination.
- Security: NOT_AUTHORIZED for non-member on all five; direct
  `journal_lines` SELECT under authenticated returns 0 rows (RLS intact).
- Trial balance zero after each lifecycle (invariant).

Pre-implementation run against main proves the surfaces are absent
(undefined-function failures = the missing-surface evidence).

## 7. Non-scope

- Stage 4 replacements of operational derivations (§20: only after proven
  equivalence AND product need) — not this tranche.
- 0080 `customer_statement`/`host_statement`/`treasury_statement` untouched.
- No accounting UI, no frontend changes (parallel UI session not disturbed).
- Bank statement import/matching (§10 future), §19 closure snapshots, §21
  pgTAP invariant triggers — explicitly future.
- No new posting primitives; read-only migration.

## 8. Migration

- Number `0096` — proven free on every ref (see §1).
- File `supabase/migrations/20260905190000_0096_stage3_aging_statements.sql`:
  five new `SECURITY DEFINER` functions + revoke/grant block. No ALTERs.
- Types: five additive entries in `src/lib/database.types.ts`, regenerated via
  the byte-exact `scripts/native-db` replica (never hand-patched).
- PG15 CI is the authoritative gate; local PG18 harness supplementary.
