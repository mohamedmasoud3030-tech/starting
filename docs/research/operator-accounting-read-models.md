# 0094 Design — Operator Accounting Read Models / Reporting (Contract Stage 3)

Status: **IMPLEMENTED in this PR** (`20260904170000_0094_accounting_read_models.sql` +
`supabase/tests/accounting_read_models.test.sql`). Re-verified against the merged financial
core on 2026-09-05.

## 1. Reality Gate (re-verified 2026-09-05, post-merge)

| Item | Observed |
| --- | --- |
| Branch | `arena/01a071f5-starting` (this PR), rebased onto post-merge `main` |
| PR #44 | **MERGED** as `ce8b21d4b8cadf1cdea533a3250b79f762551f32`; CI run `33972079848` green on head `4486891` (`supabase/postgres:15.8.1.085`) |
| Migrations 0084–0093 | present on `main` (verified file-by-file after merge) |
| 0094 | implemented here, on top of the merged main |

**Correction to the earlier draft:** the previous version of this document stated the contract
has "no section literally titled Stage 3". That was wrong — re-reading the actual contract,
§20 (Compatibility Strategy) explicitly defines **Stage 1–4**, and **Stage 3** names exactly
this tranche: *"Introduce accounting-specific read models: account_balance, account_raw_balance,
journal_history, treasury_balances, ar_aging, ap_aging, customer_statement enhanced with
allocation, supplier_statement, staff_payable, contract_asset aging, etc., gated by
cost.visibility/finance.manage."* Stage 3 is therefore an **explicit contract requirement**,
not a derivation. This tranche implements a deterministic first subset of Stage 3 (the six
functions below); the remaining named surfaces (ar_aging, ap_aging, contract_asset aging,
accounting-enhanced statements) are documented future work, not invented requirements.

## 2. Contract Reading

Source: `docs/research/accounting-posting-contract.md` (1006 lines, present on `main`).

The contract has **no section literally titled "Stage 3" or "operator accounting read models"**.
Reporting requirements are distributed:

| Contract locus | Requirement relevant to this tranche |
| --- | --- |
| §3 | accrual basis; "cash basis reporting as derived projection" |
| §5 (line 168) | future accounting read models expose commercial_value, commercial_pre_vat, recognized_revenue, invoiced_amount_gross/net, vat_amount, collected_amount_gross, customer_deposits_net/gross, accounts_receivable_gross, unbilled_receivable_gross — **additive, `event_finance_summaries.accepted_revenue` is not redefined** |
| §10 / line 269 | treasury accounts are child chart accounts of CASH 1000 / BANK 1010 "for reporting" |
| §14 (line 388) | `event_id` denormalized on journal headers for profitability reporting |
| §17 | reconciliation: outstanding = AR + Contract Asset − Deposits; payroll net; VAT |
| §21 | raw vs normalized balance sign convention (canonical for every report) |
| §23 / §24 | capability-gated accounting reads: `cost.visibility`, `payroll.read` |
| §16 | opening cutover must not replay historical P&L; opening equity 3000 |

**Scope honesty (kept from the earlier draft):** within Stage 3, the contract names the
*surface list* and the *capability gates*, but does not fix column sets, period semantics, or
pagination for trial balance / journal history. Those details below remain **derived** from
§14 (event_id denormalization), §21 (sign convention), §5 line 168 (field vocabulary) and the
merged 0084–0093 patterns, and are labeled as derivations. The six-function subset itself is
contract-explicit Stage 3 material; everything not listed in §6 is deferred, not dropped.

## 3. Existing Financial Surfaces (do not recreate)

Authoritative posting/read primitives already shipped in 0084–0093:

| Surface | Migration | Nature |
| --- | --- | --- |
| `chart_of_accounts`, `journal_entries`, `journal_lines` | 0084 | tables, RLS on, **all grants revoked from anon/authenticated** |
| `internal_post_journal`, `reverse_journal_entry`, `assert_journal_balanced`, immutability guards | 0084 | posting core — **out of scope** |
| `account_raw_balance`, `account_balance`, `account_balance_at_time` | 0084 | per-account read, gated `cost.visibility` |
| `treasury_accounts`, `treasury_account_balance(s)`, `treasury_statement`, `set_treasury_opening_balance` | 0085 | treasury read models already exist, gated `cost.visibility` |
| `record_/void_customer_payment`, `_customer_gross_vat` | 0086 | AR/deposit posting |
| `customer_payment_allocations`, `create_event_invoice`, `_post_close_revenue`, `void_invoice`, `_event_account_balance`, `_event_unallocated_deposits_gross`, `_chart_id` | 0087 | AR/revenue |
| `record_/void_event_expense`, `_resolve_expense_treasury` | 0088 / 0091 | expense |
| `_staff_payroll_position`, advances, host payouts | 0089 / 0093 | payroll position (payable, receivable) |
| `supplier_invoices/_lines/payments/allocations`, `_supplier_ap_position`, `_supplier_invoice_ap` | 0090 | AP |
| `staff_advance_settlements`, `_staff_advance_remaining` | 0092 | advance settlement |
| `_ledger_raw`, `_ledger_event_raw`, `preview_opening_cutover`, `commit_opening_cutover`, `accounting_reconciliation`, `organization_settings.accounting_cutover_at/_by/_vat_payable` | 0093 | cutover + reconciliation |

Existing indexes on the hot path:
`journal_entries (organization_id, entry_date, id)`, `(organization_id, event_id)`,
`(organization_id, source_type, source_id)`;
`journal_lines (entry_id, id)`, `(organization_id, entry_id, account_id)`,
`(organization_id, account_id, entry_date, id)`;
plus `chart_of_accounts (organization_id, is_active, account_type, code)`.

Capability model: `has_permission(org, key)` with text keys validated in 0079
(`cost.visibility`, `payroll.read`, `payroll.pay`, `finance.manage`, …). **No new capability key
is required or proposed.**

## 4. Gap Analysis — what 0094 must add

| Required surface | Already exists? | Gap |
| --- | --- | --- |
| Treasury position | **yes** — `treasury_account_balances`, `treasury_statement` | none. Reuse. Do not re-implement. |
| Reconciliation | **yes** — `accounting_reconciliation` (CUSTOMER / EVENT / TREASURY / STAFF / SUPPLIER dimensions) | none. Expose as-is; 0093 policy unchanged. |
| Payroll position | partial — `_staff_payroll_position` is a **private helper** (per-staff, `_`-prefixed, not client-granted) | needs a gated org-wide list wrapper |
| Supplier AP position | partial — `_supplier_ap_position` private, per-supplier | needs a gated org-wide list wrapper |
| Customer / AR position | partial — `_event_account_balance`, `_event_unallocated_deposits_gross` private, per-event | needs a gated per-event/org list wrapper exposing the §5 line-168 field vocabulary |
| Cutover status | data exists on `organization_settings` | needs a gated read (no client grant path today) |
| Trial balance | **no** | new |
| Journal history | **no** | new |

## 5. Proposed Architecture

**All eight surfaces are read-only `SECURITY DEFINER` SQL/PLPGSQL functions. No views, no
materialized views, no new tables.**

Rationale:
- `journal_entries` / `journal_lines` have RLS enabled with **zero permissive policies and all
  grants revoked**. A plain `SELECT` view would be unreadable by `authenticated`, and a
  `security_invoker=false` view would bypass `has_permission` — breaking §23. Every existing read
  model in 0084/0085/0093 is already a gated `SECURITY DEFINER` function; matching that is the
  simplest architecture and the only one consistent with the established pattern.
- No materialized view: it would be a **second copy of financial state** and would need refresh
  policy, invalidation on posting, and staleness semantics. Forbidden by the tranche rules and
  unnecessary — the aggregate volumes are per-org and index-supported.
- No application-side aggregation: cross-organization leakage risk and duplicated accounting
  arithmetic in TypeScript.
- Every function reads **only** `journal_entries`/`journal_lines`/`chart_of_accounts` for financial
  figures. Operational tables appear only as **labels** (customer/staff/supplier/event names) or
  inside `accounting_reconciliation`, where operational-vs-ledger comparison is the stated purpose.

## 6. Read Models (exact specification)

Common: first argument `p_org_id uuid`; first statement is
`if not public.has_permission(p_org_id, '<cap>') then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;`
Every function is `stable`, `set search_path = ''`, `revoke all from public, anon`,
`grant execute to authenticated`.

### 6.1 `accounting_trial_balance(p_org_id, p_from date default null, p_to date default null)`
Returns `account_id, code, name, account_type, normal_balance, debit_total, credit_total, raw_balance, balance`.

- Source of truth: `journal_lines` joined to `chart_of_accounts`; `journal_lines.entry_date` used
  directly (denormalized in 0084) so no join to `journal_entries` is needed for filtering.
- Filters: `l.organization_id = p_org_id`, `entry_date >= p_from` when non-null, `<= p_to` when non-null.
- `raw_balance = sum(debit) - sum(credit)`; `balance = raw_balance` for DEBIT-normal else `-raw_balance` (§21).
- Reversals: reversal journals are **ordinary lines** and are included; they cancel the original.
  No filtering by `is_reversal` — filtering would unbalance the report.
- Opening journals: `source_type = 'OPENING_BALANCE'`, dated at cutover. Included whenever the date
  window covers them. Because 0093 posts opening positions against 3000 Opening Balance Equity and
  never into 4000/5xxx, a period trial balance shows opening equity, **not** replayed P&L.
- Zero balances: accounts with no lines are excluded (`join`, not `left join`) unless
  `p_include_empty` is later needed — deliberately omitted now.
- Ordering: `order by code`.
- Capability: `cost.visibility`.
- **Invariant:** `sum(debit_total) = sum(credit_total)` for any window, because every entry is
  balanced at `entry_date` granularity and all lines of an entry share one `entry_date`.
- Index support: `journal_lines (organization_id, account_id, entry_date, id)` — existing, sufficient.

### 6.2 `accounting_journal_history(p_org_id, p_from, p_to, p_source_type default null, p_event_id default null, p_limit int default 100, p_offset int default 0)`
Returns one row per **line**: `entry_id, entry_number, entry_date, event_at, source_type, source_id,
memo, is_reversal, reversal_of, reversed_by, event_id, account_id, account_code, account_name,
debit, credit, line_memo`.

- `reversed_by` via `left join journal_entries r on r.reversal_of = e.id` (unique index
  `journal_entries_single_reversal_idx` guarantees at most one).
- Dimensions available today: `event_id` on the header, plus `source_type`/`source_id`.
  **There is no generic dimension table** — customer/staff/supplier attribution is resolved by
  joining `source_id` against the source document, exactly as `_staff_payroll_position` and
  `_supplier_ap_position` do. Reporting must not invent a dimension column.
- Ordering: `entry_date desc, created_at desc, entry_number desc, l.id` — total and deterministic.
- Pagination: keyset would be preferable; `limit/offset` is acceptable at expected volumes and is
  what the ordering above makes deterministic.
- Immutability: read-only function; 0084 triggers already reject UPDATE/DELETE.
- Capability: `cost.visibility`.
- Index support: `journal_entries (organization_id, entry_date, id)` and
  `journal_lines (organization_id, entry_id, account_id)` — existing, sufficient.

### 6.3 `accounting_customer_positions(p_org_id, p_event_id default null)`
Per event: `event_id, event_number, customer_id, customer_name, event_status,
commercial_value, commercial_pre_vat, recognized_revenue, invoiced_amount_gross, vat_amount,
collected_amount_gross, customer_deposits_gross, accounts_receivable_gross, unbilled_receivable_gross,
outstanding_ar`.

- Field names taken verbatim from contract §5 line 168.
- Ledger-derived: AR from 1100, contract asset from 1120, deposits from 2000, revenue 4000,
  VAT 2150 — all via `_ledger_event_raw` (0093) so post-cutover and opening journals are both counted.
- `commercial_value` / `commercial_pre_vat` come from `event_finance_summaries` and are labelled
  **operational/commercial**, never summed into the accounting figures.
- `outstanding_ar = AR_raw + CA_raw + deposits_raw` — the §17 identity, same arithmetic
  `accounting_reconciliation` uses. Deposits are **not** collapsed into AR; they are a separate column.
- Voided payments/invoices: already neutralised by their `*_VOID` reversal journals; no extra filter.
- Partial payments: naturally represented — deposits/AR move by the posted amount only.
- Ordering: `event_number`. Capability: `cost.visibility`.

### 6.4 `accounting_supplier_positions(p_org_id)`
`supplier_id, supplier_name, ap_balance, open_invoice_count, last_posting_date`.
Thin gated wrapper over the existing `_supplier_ap_position` (2200 credit-normal, includes
`OPENING_BALANCE` where `source_id = supplier_id`). Invoice counts read `supplier_invoices`
(0090, authoritative document table). **No new supplier balance state.**
Zero balances retained (a supplier at 0 is a meaningful "settled" row). Capability: `cost.visibility`.

### 6.5 `accounting_payroll_positions(p_org_id)`
`staff_member_id, staff_name, payable, receivable, net_position, advances_outstanding`.
Wrapper over existing `_staff_payroll_position` (2300 payable / 1150 receivable) plus
`sum(_staff_advance_remaining)` over `staff_advances` with `status='RECORDED'` (0092).
**No new payroll ledger.** Capability: **`payroll.read`** — 0079 Part C explicitly re-gated payroll
read models from `cost.visibility` to `payroll.read`; this tranche must follow that precedent.

### 6.6 Treasury position — **reuse `treasury_account_balances` / `treasury_statement` (0085)**
No new object. No cached balance. 0085 opening policy untouched.

### 6.7 `accounting_cutover_status(p_org_id)`
`committed boolean, cutover_at timestamptz, cutover_by uuid, vat_payable numeric,
opening_journal_count int, opening_entities jsonb`.
Reads `organization_settings` and counts `journal_entries where source_type='OPENING_BALANCE'`,
grouping `source_id` by resolved kind. Strictly read-only — it cannot preview or commit.
Capability: `cost.visibility`.

### 6.8 Reconciliation — **reuse `accounting_reconciliation` (0093)**
No new object, no policy change. Verified dimensions today: `CUSTOMER` (metric `outstanding` for
CLOSED/invoiced events, metric `deposits` for uninvoiced open events — the §16 case-2 treatment),
`EVENT` (expenses), `TREASURY`, `STAFF` (net position), `SUPPLIER` (AP). VAT is owner-provided at
cutover and is **not** a reconciliation dimension — that is 0093 policy and stays.

## 7. Capability Mapping

| Surface | Capability | Justification |
| --- | --- | --- |
| trial balance, journal history, customer, supplier, cutover status | `cost.visibility` | matches 0084/0085/0093 accounting reads |
| payroll positions | `payroll.read` | 0079 Part C precedent |
| treasury, reconciliation | `cost.visibility` (already enforced) | unchanged |

No new capability key. No RLS policy changes — the tables stay unreadable directly; the
`SECURITY DEFINER` + `has_permission` + `p_org_id` filter triple is the isolation boundary, and
every query filters `organization_id = p_org_id` on **both** header and line tables.

## 8. Performance

No new indexes proposed. Every filter/sort above is covered by indexes listed in §3. Adding an
index before a measured plan on real volumes would be speculative.

## 9. Test Plan (`supabase/tests/accounting_read_models.test.sql`, pgTAP)

Trial balance: (1) `sum(debit)=sum(credit)` on a populated org; (2) per-account aggregation vs
`account_balance`; (3) opening cutover appears as 3000 equity with 4000/5xxx untouched;
(4) a reversal nets the pair to zero; (5) `p_from`/`p_to` boundaries inclusive.
Journal history: source_type/source_id/entry_number completeness; `event_id` present on
event-linked journals; `reversed_by` populated after `reverse_journal_entry`; UPDATE through the
function's result is impossible (function returns a set, tables still reject direct DML);
deterministic ordering under equal `entry_date`.
AR: deposit-only event reports deposits and zero AR; invoiced event reports AR gross; partial
payment reduces AR by the paid amount only; deposits never folded into AR; VAT split visible.
AP: invoice raises `ap_balance`; payment reduces it; void nets to zero.
Payroll: attendance→payable, advance→receivable, settlement→both reduced, `net_position` matches
`accounting_reconciliation` STAFF row.
Treasury: `treasury_account_balances` equals trial-balance rows for the same chart accounts;
opening balance present; assert no second treasury balance store exists.
Cutover: uncommitted org → `committed=false`; after `commit_opening_cutover` → stamp, count,
per-entity source ids; calling the status function never changes `accounting_cutover_at`.
Reconciliation: all five dimensions returned; a deliberate operational/ledger gap shows
`DIFFERENCE`; uninvoiced open event uses the `deposits` metric.
Security: second org sees none of org-1's rows; member without `cost.visibility` gets
`NOT_AUTHORIZED`; member with `cost.visibility` but not `payroll.read` is refused payroll
positions; `select` directly on `journal_lines` as `authenticated` is denied.

## 10. Migration Plan (executed as implemented)

- Number: **0094**, filename `supabase/migrations/20260904170000_0094_accounting_read_models.sql`
  (next timestamp after 0093's `20260904160000`).
- Objects, in order: `accounting_trial_balance` → `accounting_journal_history` →
  `accounting_customer_positions` → `accounting_supplier_positions` →
  `accounting_payroll_positions` → `accounting_cutover_status`; then the
  `revoke ... from public, anon` / `grant execute ... to authenticated` block.
- Dependencies: 0084 (tables, sign convention), 0085 (treasury), 0087 (`_chart_id`),
  0090 (`_supplier_ap_position`), 0092 (`_staff_advance_remaining`),
  0093 (`_ledger_event_raw`, `_staff_payroll_position`, cutover columns). All must be applied first.
- Rollback: `drop function` on the six new names only. No data, no schema change, no backfill —
  the tranche is additive and reversible.
- Files likely to change: the migration, `supabase/tests/accounting_read_models.test.sql`, and
  (optionally, a later tranche) `src/features/finance/finance.api.ts` for the client bindings.

## 11. Blockers — status at implementation time

1. **Base-branch sequencing — RESOLVED.** PR #44 merged (`ce8b21d`); 0084–0093 verified on
   `main`; this branch was re-created from the merged main.
2. **Contract silence (soft) — PARTIALLY RESOLVED.** Stage 3 itself is explicit (§20); the
   column-level choices remain documented derivations (see §2).
3. **Dimensions.** No generic dimension model exists; attribution is by `source_type`/`source_id`
   joins and `event_id`. If the contract later demands cost centres or departments, that is a
   schema tranche, not a reporting tranche.

## 12. Known 0093 edge case observed during re-verification (out of scope here)

`accounting_reconciliation` CUSTOMER rows and `commit_opening_cutover` customer gaps compare
**operational gross** deposits (`Σ customer_payments RECORDED`) against the **ledger net**
deposit balance (`−raw(2000)`). For VAT-registered orgs, deposit VAT lives in `2150`, so an
open uninvoiced event with a VAT deposit shows a 0093-era reconciliation `DIFFERENCE` equal to
the deposit VAT, and cutover would post a matching extra deposit opening. Non-VAT orgs are
unaffected (all 0093 tests are non-VAT). 0094 does not change 0093 policy; it exposes both
`customer_deposits_net` (ledger 2000) and `customer_deposits_gross` (net + deposit VAT), which
makes the two views comparable. A future tranche should decide whether reconciliation uses
gross (adding deposit VAT back) or net (netting operational deposits) for VAT orgs.
