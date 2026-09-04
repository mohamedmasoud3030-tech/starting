# A0 — Accounting Posting Contract & Cutover Policy (Corrected)

**Date:** 2026-09-04 UTC (Corrected 2026-09-04)  
**Baseline:** `origin/main` @ `fd7aaff9001e0d63ab2b63f290b2804c96d2bdd9` (PR #38 merged)  
**Active Branch:** `arena/01a06b35-starting` @ `af23a05` → corrected  
**Previous Research:** `docs/research/financial-component-harvest.md` + prior A0 @ af23a05  
**Scope:** Architecture-contract only, no migrations, no SQL, no frontend, no types, no tests, no deps.  
**Corrections:** Five material gaps resolved: CLOSED without invoice, VAT cannot be revenue, opening AR/deposits determinism, payroll cutover double-count, balanced journal trigger boundary.

---

## 1. Repository Verification

- **main SHA:** `fd7aaff9001e0d63ab2b63f290b2804c96d2bdd9` verified `git rev-parse origin/main` → Merge PR #38
- **Active branch:** `arena/01a06b35-starting` @ `af23a05` (A0 prior version with 25 sections, ends A1 READY not approved), ahead of main by 2 commits (harvest + prior A0). Working tree clean before correction.
- **Open PR count:** 0 — `gh pr list --state open` empty. `git branch -vv` shows only `main` and this branch locally; `git branch -r` shows `origin/main` + `origin/HEAD` + this branch.
- **Remote branch list:** Only `main` + `arena/01a06b35-starting` after prior cleanup of 18 stale branches. No extra research branches.
- **Working tree state:** Clean, only this file modified. No 0081 migration, no journal tables, no new RPCs, no enums, no TS types, no React components, no tests, no deps. `supabase/migrations` latest `20260904000100_0080_office_documents.sql`.
- **Continuation:** Continue on existing A0 branch, no new branch needed. Preserve both research documents.

## 2. Current Accounting Reality

**Commercial value:** `event_finance_summaries.accepted_revenue` = `quotations.total_selling` (VAT-inclusive when registered) from accepted quotation snapshot. Contracted commercial value, not accounting revenue. Feeds customer 360, event workspace, financial closure, management metrics, office documents, tests. Must remain backward compatible as `commercial_value`.

**Invoice:** `invoices` (ISSUED/CANCELLED, INV-…), `total_amount` numeric(14,3) VAT-inclusive, `pre_vat_total`, `vat_registered`, `vat_percent`, `vat_amount`, `vat_registration_number` snapshot from org settings at issue, `quotation_id`, `event_id`, `due_at`. `invoice_installments` (DEPOSIT/INSTALLMENT/FINAL, PENDING/PAID/CANCELLED, seq, due_date, amount). `create_event_invoice` builds formal invoice from accepted quotation total; schedule sum must equal total exact 3dp. Currently enforces at most one ISSUED invoice per event (`INVOICE_ALREADY_EXISTS`). Payments remain in S6 ledger; installment PAID state DERIVED from customer_payments ledger (cumulative paid vs scheduled), no second money source. Invoices can be created before service (only checks event not CANCELLED). `void_invoice` cancels installments + invoice with reason, non-destructive, no check for allocated payments yet.

**Collection:** `customer_payments` append-only ledger, amount numeric(12,3) >0 gross inclusive, payment_method CASH/BANK_TRANSFER/CARD/CHEQUE/MOBILE_WALLET/OTHER, reference, notes, paid_at, status RECORDED→VOIDED with reason, recorded_by, idempotency_key unique per org, request_fingerprint SHA-256, advisory lock on (org,key). `record_customer_payment` idempotent, checks has_permission payment.record, org ACTIVE, event not CANCELLED, amount>0 via `assert_payment_omr`, requires accepted_quotation_id. `void_customer_payment` similar payment.void. Balance derived: `amount_paid` = Σ RECORDED payments per event, `outstanding_balance` = accepted_revenue − amount_paid in `event_finance_summaries`. Payments are event-linked, not invoice-allocated. Pre-invoice payments allowed. No treasury account attribution yet. No VAT split on payments historically.

**Outstanding:** `event_finance_summaries.outstanding_balance` = accepted_revenue − amount_paid. `invoice_summaries` paid_total/remaining_balance derived from payments ledger. `customer_statement(org,customer)` CHARGE rows from accepted revenue + PAYMENT rows from RECORDED payments, positive amounts, sign via row_kind, gate cost.visibility.

**Costs:** Unified actual profitability: staff_cost = Σ payroll earned (host/supervisor) from `staff_attendance` non-VOIDED, procurement_cost = active committed/delivered from `event_procurement_cost_summaries`, expense_cost = Σ RECORDED event_expenses, actual_cost = staff+procurement+expense, actual_profit = revenue−actual_cost, margin_percent. Anti-double-counting: PURCHASE → procurement orders NOT event_expenses, STAFF → payroll earned NOT event_expenses, else → event_expenses.

**Payroll authoritative semantics (pinned from `get_host_payroll_summary` and `host_event_payroll_summaries` 0076 + 0079):**

```sql
-- per-event view host_event_payroll_summaries:
earned_total = sum(earned_amount) filter (status <> VOIDED)
advances_total = 0 (per-event view carries 0 by design)
payouts_total = sum(host_payouts direct) + sum(host_payout_allocations) where status RECORDED
due_total = earned_total
paid_total = payouts_total (per-event)
late_total = earned_total - payouts_total (per-event)

-- host-wide get_host_payroll_summary(p_org, p_staff, p_event null):
earned = sum(earned_amount) filter (status <> VOIDED and (p_event null or event_id = p_event))
advances = if p_event null then sum(staff_advances amount where status RECORDED) else 0
payouts = sum(host_payouts direct) + sum(allocations) where status RECORDED and (p_event null or event_id = p_event)
due_total = earned
paid_total = advances + payouts
late_total = earned - advances - payouts = N
```

So host-wide outstanding position is exactly N = E - A - P. Negative late_total means overpayment (advances+payouts exceed earnings). Current system allows negative late_total (overpayment) as data, not blocked. `host_statement` uses same rollup.

**Procurement:** `suppliers` ACTIVE/INACTIVE no-delete, `procurement_orders` PO-YYYY-NNNNN DRAFT→APPROVED→SENT→CONFIRMED→PARTIALLY_RECEIVED→RECEIVED→CANCELLED, snapshots frozen at approval, history guard + event_lifecycle_guard, `procurement_order_lines` immutable snapshots (CONSUMABLE/CATERING_SERVICE/OTHER), `procurement_receipts`/`receipt_lines` append-only linking to S4B consumable_movements, partial vs full derived. OWNER/MANAGER. No supplier invoices/AP yet.

**Closure:** `event_financial_closures` append-only cycle OPEN→CLOSED→REOPENED, each row episode, reopen sets reopened_at/by/reason never erases previous close, current closed iff reopened_at IS NULL, partial unique index one active per event. `close_event_financially` atomic idempotent snapshot revenue_at_close, collected_at_close, outstanding_at_close, costs_at_close, profit_at_close, margin_at_close. `reopen_event_financially` reason required. Readiness `event_financially_ready` requires accepted_revenue>0 AND outstanding_balance<=0. `event_financial_readiness` checklist revenue, outstanding, staff_cost. D8 guard `guard_event_financially_closed` BEFORE triggers on customer_payments, host_payouts, staff_attendance, event_expenses blocks every cost/collection mutation while financially closed — database not UI is boundary.

**VAT:** Migration 0077 optional VAT per organization, snapshotted onto issued quotation/invoice at issue time, never recalculated. Org settings vat_registered bool default false, vat_percent numeric(12,3) default 5.000, vat_registration_number text. Quotation/invoice have pre_vat_total, vat_registered, vat_percent, vat_amount, vat_registration_number. Money rule: total = pre_vat + round(pre_vat×vat_percent/100,3). For VAT-registered org, total_selling and total_amount become VAT-INCLUSIVE final total. VAT-disabled orgs snapshot 0. No VAT split on customer_payments historically, no VAT Payable account yet.

**Office Documents 0080:** `customer_statement`, `customer_payment_receipt`, `event_warehouse_sheet_lines`, `host_statement` — cost-gated or payroll.read gated.

**Capabilities 0079:** 20 capabilities, OWNER always true, else per-member override else role preset via `role_default_capability`. `has_permission(org, cap)` canonical, `my_capabilities(org)` mirror, OWNER-only member_capability_list and set/clear. `can_read_cost(org)` wrapper around has_permission(cost.visibility).

## 3. Accounting Basis Decision

**Chosen basis: Accrual basis with Customer Deposits + Deferred Revenue + Unbilled Receivable/Contract Asset + AR/AP/Payroll Payable + VAT Payable, cash basis reporting as derived projection.**

Why accrual: same as prior A0, plus VAT requires tax point tracking, and CLOSED without invoice requires Contract Asset.

Therefore:
- Commercial commitment (accepted quotation) = NO JOURNAL ENTRY, reporting only, remains `accepted_revenue` as commercial_value.
- Cash received before invoice = liability Customer Deposits net + VAT Payable VAT (if VAT-registered), not revenue, not negative AR. Tax point at receipt per Oman law.
- Invoice issued before service = AR gross + Deferred net + VAT Payable (remaining VAT not yet recognized on advances) — see §22 VAT contract.
- Service earned = Deferred → Revenue (net only, never VAT) OR Unbilled → Revenue if no invoice.
- Cash after invoice = Treasury + AR settlement, no new VAT (VAT already due at earlier of invoice/payment).
- Costs recognized when incurred (attendance, expense, supplier invoice) not when paid.
- Treasury balances derived from journal, not payment_method enum.
- Opening balances under Strategy B do NOT replay historical P&L into current period; historical earned revenue/expenses/payroll/procurement remain in historical operational reports, opening Equity balances assets vs liabilities for cutover position.

## 4. Revenue Recognition Contract (Corrected for CLOSED without Invoice)

**Recognition point: Transition of event to CLOSED (operationally closed).**

Candidates evaluated same as prior: IN_PROGRESS early, RETURNING intermediate (warehouse/consumable reconciliation pending), CLOSED authoritative done, financial close must NOT be recognition point (freezes economics, requires AR settled, revenue should already be recognized before close).

**Why CLOSED:** Existing authoritative operational completion. When event economics final except AP settlement that may remain. Matches owner mental model.

**Problem corrected:** Current application does NOT require invoice to exist before CLOSED. Therefore event can become earned while Deferred Revenue =0 and Invoice = none. Prior A0 defined revenue recognition as Dr Deferred Cr Revenue only, leaving debit side undefined for no-invoice case.

**Required Decision: Two legitimate approaches evaluated:**

**Option A — Require Invoice Before CLOSED:** Change event readiness so event cannot transition to CLOSED until active invoice exists. Accounting simpler: Invoice before CLOSED Dr AR Cr Deferred, CLOSED Dr Deferred Cr Revenue. But this changes operating workflow, forces administrative work purely for accounting, requires readiness change in `transition_event_status` and `event_financial_readiness`, breaks current operator flow where CLOSED is operational done, not administrative invoicing. For small team, owner should not be forced to create invoice to close operationally.

**Option B — Introduce Contract Asset / Unbilled Receivable 1120:** Allow operational CLOSED without invoice. Introduce system account 1120 Unbilled Receivable / Contract Asset (Asset, DEBIT normal). For completed event with no invoice: Dr Unbilled Receivable Cr Event Revenue (net) + VAT Payable (VAT) if VAT-registered. When invoice later issued: Dr AR Cr Unbilled Receivable (reclassification, no new revenue, no new VAT if VAT already recognized at CLOSED).

**Decision: Option B — Contract Asset, preserves current operator workflow, avoids forced admin work, remains mathematically correct, least special-case behavior.**

**Why Option B preferred:**
- Preserves current operator workflow: CLOSED is operational, invoice is commercial, they remain independent.
- Avoids forced administrative work purely for accounting.
- Mathematically correct: Unbilled Receivable is standard IFRS 15 Contract Asset for earned but not yet billed.
- Least special-case: One additional asset account, same revenue recognition logic, later invoice is deterministic reclassification.
- If Invoice-before-CLOSED were selected, would require future business readiness change: `transition_event_status` to check active invoice exists, `event_financial_readiness` to include invoice check, and would block operational CLOSED for purely accounting reasons — not appropriate for current product.

**If Contract Asset selected, updates required (done in this corrected doc):**
- Chart of accounts: add 1120 Unbilled Receivable / Contract Asset, Asset DEBIT normal, active.
- Posting matrix: add CLOSED without invoice, later invoice after CLOSED, deposit handling with Contract Asset.
- Source taxonomy: add `CONTRACT_ASSET`? Actually revenue recognition already covers, but add `UNBILLED_RECOGNITION` and `UNBILLED_RECLASSIFICATION` if needed, or reuse `REVENUE_RECOGNITION` and `INVOICE` with reclassification semantics. For clarity, add `REVENUE_RECOGNITION` (deferred→revenue) and `UNBILLED_RECOGNITION` (unbilled→revenue) and `INVOICE_RECLASSIFICATION`? For minimal taxonomy, keep `REVENUE_RECOGNITION` for both deferred and unbilled recognition, and `INVOICE` for AR creation, with condition distinguishing. For explicitness, add `CONTRACT_ASSET_RECOGNITION` and `CONTRACT_ASSET_RECLASSIFICATION` source types.
- Balance equations: add Contract Asset equation.
- Cutover policy: define opening Contract Asset for CLOSED/unbilled events.
- Reconciliation contract: include Contract Asset.
- A1 schema boundary: include 1120 account.

**Postings with Contract Asset (final):**

- Accepted quotation: NO JOURNAL ENTRY.
- Customer pays before invoice (deposit) — VAT-registered: Dr Treasury gross Cr Customer Deposits net Cr VAT Payable VAT (see §22). Non-VAT: Dr Treasury gross Cr Customer Deposits gross (net=gross).
- Invoice issued before service (no prior deposit, non-VAT): Dr AR gross Cr Deferred net (gross=net). VAT-registered: Dr AR gross Cr Deferred net Cr VAT Payable VAT (full VAT).
- Invoice issued before service with prior deposit (VAT-registered example gross 2100 net 2000 VAT 100, deposit gross 1050 net 1000 VAT 50 already recognized): Invoice AR = net total + remaining VAT = 2000 + (100-50)=2050, Deferred net 2000, VAT Payable 50 additional. Balanced. Then deposit allocation Dr Deposits net 1000 Cr AR 1000 (net portion). Final AR 1050 = remaining net 1000 + remaining VAT 50.
- Deposit applied to invoice: Dr Customer Deposits net Cr AR net (or gross? See VAT contract for exact). For non-VAT, Dr Deposits gross Cr AR gross. For VAT-registered, Dr Deposits net Cr AR net (VAT already in VAT Payable, not in AR net? Actually AR in this corrected model for VAT case is gross? Need consistent: For VAT-registered, AR should be gross inclusive? Let's define AR as gross inclusive always, but deposit allocation logic uses net+VAT handling as defined in §22. For simplicity in this section, non-VAT case: Dr Deposits Cr AR.
- Customer pays after invoice: Dr Treasury gross Cr AR gross (non-VAT) or Dr Treasury gross Cr AR gross (VAT case, no new VAT).
- Event CLOSED with invoice exists (deferred exists): Dr Deferred net Cr Event Revenue net. No VAT movement (VAT already recognized at invoice or deposit).
- Event CLOSED without invoice, no deposit, non-VAT: Dr Unbilled Receivable (1120) gross (=net) Cr Event Revenue net.
- Event CLOSED without invoice, no deposit, VAT-registered: Dr Unbilled Receivable gross (net+VAT) Cr Event Revenue net Cr VAT Payable VAT. Example: net 2000 VAT 100 gross 2100: Dr Unbilled 2100 Cr Revenue 2000 Cr VAT 100.
- Event CLOSED without invoice, with deposit (VAT-registered example): Advance 1050 (1000 net +50 VAT) already: Treasury 1050 Dr, Deposits 1000 Cr, VAT 50 Cr. At CLOSED total net 2000 VAT 100: Need to recognize remaining revenue 2000 total, but 1000 already covered by deposits. So Dr Deposits net 1000 Cr Revenue net 1000 (for advance portion), Dr Unbilled gross 1050 (1000 net +50 VAT remaining) Cr Revenue net 1000 Cr VAT 50 (remaining). Final: Treasury 1050, Unbilled 1050, Revenue 2000, VAT 100. Balanced.
- Later invoice after CLOSED without invoice (no deposit): Dr AR gross 2100 Cr Unbilled gross 2100. No new revenue, no new VAT (VAT already recognized at CLOSED).
- Later invoice after CLOSED with deposit (example above): After CLOSED we have Unbilled 1050, Treasury 1050, Revenue 2000, VAT 100. Invoice for full 2100 gross: Should reclassify remaining Unbilled to AR: Dr AR gross 1050 Cr Unbilled gross 1050. Final: Treasury 1050, AR 1050, Revenue 2000, VAT 100. No new revenue/VAT.
- Revenue recognized = consideration excluding VAT for VAT-registered orgs, full consideration for non-VAT orgs. VAT must not move into Event Revenue.

**Deferred vs Contract Asset vs Deposits distinction:**
- Customer Deposits = unapplied cash received before invoice, liability for future service or refund, net amount (VAT separate).
- Deferred Revenue = invoiced but not yet earned, liability for service owed, net amount.
- Unbilled Receivable / Contract Asset = earned but not yet invoiced, asset, gross (net+VAT) or net+VAT separate? Define as gross inclusive for simplicity, representing amount to be invoiced.

## 5. Customer Deposits, AR, Invoice & Allocation Contract (Corrected with VAT)

**Invoice semantics — 9 questions answered with VAT correction:**

1. **What does invoice issuance create accounting-wise?** Before CLOSED, non-VAT: Dr AR gross Cr Deferred net (gross=net). VAT-registered: Dr AR gross (net+VAT) Cr Deferred net Cr VAT Payable VAT, but if deposits exist with VAT already recognized, VAT portion is remaining VAT only (total VAT - VAT already recognized on deposits), AR = net total + remaining VAT. After CLOSED (no deferred): non-VAT Dr AR gross Cr Revenue net (or Dr Unbilled reclassification), VAT-registered Dr AR gross (remaining) Cr Revenue net? Actually revenue already recognized at CLOSED, so invoice after CLOSED is reclassification Dr AR Cr Unbilled, no revenue, no VAT.
2. **When can invoice be issued relative to service?** Allowed before service completion (current check only event not CANCELLED). Accounting handles both cases via Deferred vs Revenue vs Unbilled. No new restriction.
3. **Can customer money exist without invoice?** Yes, pre-invoice payments allowed. They create Dr Treasury gross Cr Customer Deposits net Cr VAT Payable VAT (if VAT-registered) per Oman tax point, not negative AR, not revenue.
4. **How many invoices per event?** Currently at most one ISSUED invoice per event enforced INVOICE_ALREADY_EXISTS. Design allocation table to allow multiple invoices per event in future (payment→many invoices), but for A0/A1 keep one-per-event guard, document future multi-invoice compatibility.
5. **How do installments affect AR?** Installments are schedule for due dates and for deriving PAID status from payments ledger (cumulative paid vs scheduled). Entire invoice AR on issue, not per installment. Future AR aging could use installment due dates, but accounting AR is full invoice (or remaining portion if deposits exist).
6. **How to void invoice?** `void_invoice` preconditions: invoice ISSUED, reason>=3, invoice.manage, no payment allocation OR allocation reversed atomically in same transaction. Accounting reversal: If invoice was before CLOSED (deferred exists): Dr Deferred net Cr AR gross? Actually need to reverse net and VAT: Dr Deferred net Cr AR net? For VAT-registered, need to reverse VAT Payable as well: Dr Deferred net + Dr VAT Payable VAT? Let's define exact: Void invoice before CLOSED, non-VAT: Dr Deferred Cr AR. VAT-registered: Dr Deferred net Dr VAT Payable VAT Cr AR gross. If invoice was after CLOSED (revenue already recognized via Unbilled or Deferred→Revenue), voiding requires revenue reversal and VAT reversal and AR reversal and Unbilled restoration. Define in posting matrix.
7. **What happens to allocated payments on void?** Allocated payments become unapplied deposits again via reversal journals: For non-VAT, Dr AR Cr Deposits. For VAT-registered, need to restore deposits net and VAT handling: If payment was deposit applied, original allocation Dr Deposits net Cr AR net, void invoice restores Dr AR net Cr Deposits net. If payment was after invoice (Treasury→AR), void invoice should reclassify payment as deposit: Dr AR gross Cr Deposits net Cr VAT Payable VAT? Actually need to define exact in matrix to avoid orphaned VAT.
8. **What is unapplied customer deposit?** Payment amount gross − sum allocations gross? For non-VAT, gross=net. For VAT-registered, unapplied deposit net = gross deposit net − sum allocations net, VAT portion already in VAT Payable. Customer balance: Deposits liability increases when payment before invoice, decreases when allocated.
9. **How to handle VAT on invoice?** VAT snapshot from org settings at issue (0077) pre_vat_total, vat_amount, vat_percent. total_amount VAT-inclusive when registered. Accounting must distinguish net consideration and VAT liability. VAT collected from customers is NOT business revenue. At invoice, VAT Payable recognized for remaining VAT not yet recognized on advances. Prevent VAT that was already recognized on advance from being recognized again.

**Lifecycle with VAT (summary):**

1. Quotation accepted → NO JOURNAL ENTRY. `accepted_revenue` derived.
2. Customer pays before invoice (deposit) — non-VAT: Dr Treasury gross Cr Customer Deposits gross. VAT-registered: Dr Treasury gross Cr Customer Deposits net Cr VAT Payable VAT, where VAT = round(gross * vat_percent / (100+vat_percent),3) and net = gross - VAT, using org vat_percent snapshot at receipt time (or invoice VAT percent if exists? Use org setting at receipt). Tax point at receipt per Oman law.
3. Invoice issued (before CLOSED, no prior deposit) — non-VAT: Dr AR gross Cr Deferred net. VAT-registered: Dr AR gross (net+VAT) Cr Deferred net Cr VAT Payable VAT (full VAT).
4. Invoice issued (before CLOSED, with prior deposit) — VAT-registered: Let total net = I_net, total VAT = I_vat, advance VAT already recognized = VAT portion of deposits (sum of VAT from deposit receipts). Remaining VAT = total VAT - advance VAT. AR = total net + remaining VAT. Posting: Dr AR (total net + remaining VAT) Cr Deferred net (total net) Cr VAT Payable remaining VAT. Then allocation: Dr Deposits net (sum) Cr AR net (sum) [net portion only]. For non-VAT: AR = total gross, Deferred = total gross, allocation Dr Deposits gross Cr AR gross.
5. Customer pays after invoice — non-VAT and VAT-registered: Dr Treasury gross Cr AR gross, no new VAT (VAT already due at earlier of invoice/payment per Oman law).
6. Deposit applied to invoice — non-VAT: Dr Deposits gross Cr AR gross. VAT-registered: Dr Deposits net Cr AR net (VAT already in VAT Payable, AR includes remaining VAT only).
7. **Payment allocation invariants — table `customer_payment_allocations` (payment_id, invoice_id, amount, organization_id, is_vat_adjusted bool):**
   - allocation total per payment ≤ payment gross amount (or net for VAT case, define exact)
   - allocation total per invoice ≤ invoice outstanding gross (or net)
   - one payment may allocate to multiple invoices if future product allows (for now one event one invoice, but design for multiple)
   - unapplied payment gross = payment gross − sum allocations gross remains Customer Deposits gross (or net for VAT case)
   - voiding a payment reverses its allocations atomically (same transaction) and reverses VAT Payable if payment was deposit
   - cross-organization allocation impossible (composite FK org_id, check)
   - allocation occurs automatically when only one invoice exists for event (simple UX), else explicit operator selection.
   - For VAT-registered, allocation amount is net amount, VAT portion tracked separately via VAT Payable, not duplicated.

**Compatibility:** Keep `event_finance_summaries.accepted_revenue` as commercial_value (VAT-inclusive) for backward compat, not redefined. Future accounting read models add new fields: commercial_value (existing accepted_revenue), commercial_pre_vat (pre_vat_total), recognized_revenue (ledger, net, at CLOSED), invoiced_amount_gross, invoiced_amount_net, vat_amount, collected_amount_gross, customer_deposits_net, customer_deposits_gross, accounts_receivable_gross, unbilled_receivable_gross.

## 6. Payroll Accrual & Staff Advance Contract (Corrected)

**Do not post payroll cost only when money paid.** Existing product considers attendance-earned compensation event cost before payout.

**Posting model for future activity after cutover (preferred):**

- **Earnings become payable when attendance becomes authoritative:** At attendance creation with status PRESENT/LATE/PARTIAL (not ABSENT, not VOIDED). Earned_amount calculated (hours×rate or fixed). Posting: Dr Staff Cost (5000) Cr Payroll Payable (2300). Source HOST_EARNING, Event Link event_id, Staff Link staff_member_id, Attendance Link attendance_id. Amount = earned_amount.
- **Attendance void/correction:** When attendance voided (VOIDED status with reason) or corrected via void + new record, reversal: Dr Payroll Payable Cr Staff Cost for original earned_amount. New posting as above. Non-destructive.
- **Host payout (future):** Dr Payroll Payable Cr Treasury (specific treasury account). Source HOST_PAYOUT, Event Link (if event-linked) or null if host-wide multi-event, Staff Link, Payout Link. Amount = payout amount. Settles liability, not create expense again. If multi-event with allocations `host_payout_allocations`, one payout may settle multiple events: one journal Dr Payroll Payable (total) Cr Treasury (total), allocations table shows per-event breakdown for reporting. If payout amount X exceeds current Payroll Payable Y, excess becomes Staff Receivable: Dr Payroll Payable Y Cr Treasury Y + Dr Staff Receivable (X-Y) Cr Treasury (X-Y). See overpayment policy.
- **Staff advance (future):** Dr Staff Advances & Receivables Asset (1150) Cr Treasury. Source STAFF_ADVANCE, Staff Link, Advance Link. Amount = advance amount. Host-wide model: advance asset per staff member.
- **Advance settlement (future):** Dr Payroll Payable Cr Staff Advances & Receivables Asset (1150). Source STAFF_ADVANCE_SETTLEMENT, Staff Link, Advance Link. Reduces payable liability and reduces advance asset. If advance not yet settled, remains asset, payroll payable remains liability.
- **Host-wide advance mapping:** Advance asset per staff, not per event. When payroll payable per event, settlement of host-wide advance against specific event's payable should allocate advance to that event: Dr Payroll Payable (event) Cr Staff Advance (host-wide).
- **Do not create second payroll truth:** Operational flow Event→Assignment→Attendance→Earned→Advances→Payouts→Remaining Due remains authoritative. Ledger postings derived synchronously in same transaction as operational writes.
- **Void paths:** Advance Void Dr Treasury Cr Staff Advance Asset, Payout Void Dr Treasury Cr Payroll Payable (if supported) + reverse receivable if overpayment case, both via reversal.

**Historical cutover accounting (one-time deterministic transformation) — Correction Four:**

Inspect current `get_host_payroll_summary` and `host_event_payroll_summaries` and `host_statement` and pin exact historical semantics:

- E = historical earned amount = sum(earned_amount) filter (status <> VOIDED) before cutover, per staff (or per org for opening)
- A = historical recorded advances = sum(staff_advances amount where status RECORDED) before cutover, per staff
- P = historical recorded payouts = sum(host_payouts direct + allocations) where status RECORDED before cutover, per staff
- N = E - A - P = late_total (can be negative)

Current system calculates outstanding position approximately as earned - advances - payouts (host-wide). Opening ledger must reproduce existing host position exactly.

**Opening representation (mathematically consistent, no double-count):**

If N >= 0:
- Opening Payroll Payable = N
- Opening Staff Receivable / Advance Asset = 0
- Historical advances are considered already economically applied against historical earnings to extent necessary to reproduce current system. This is acceptable as one-time deterministic cutover transformation because old system did not have explicit advance-settlement facts.

If N < 0:
- Do NOT create negative Payroll Payable liability.
- Instead represent excess payment/advance as asset receivable from staff:
- Opening Payroll Payable = 0
- Opening Staff Receivable / Advance Asset = abs(N) = A + P - E

This preserves current net position exactly: Old system late_total = N, new system net position = Payroll Payable - Staff Receivable = N (if N>=0, payable N, receivable 0 => net N; if N<0, payable 0, receivable abs(N) => net -abs(N)=N). So exact reproduction.

**Account rename:** Evaluate whether account 1150 should be renamed from Staff Advances to Staff Advances & Receivables or whether separate accounts justified. Prefer minimal chart complexity: rename 1150 to **Staff Advances & Receivables**, Asset DEBIT normal, purpose broader (advances issued + overpayments). No need for separate receivable account for A1. Document purpose.

**Future vs Historical distinction:**
- For new activity after cutover, preferred future model remains: Advance issued Dr Staff Advance Asset Cr Treasury, Attendance earning Dr Staff Cost Cr Payroll Payable, Advance settlement Dr Payroll Payable Cr Staff Advance Asset, Payout Dr Payroll Payable Cr Treasury (with overpayment excess Dr Staff Receivable Cr Treasury).
- Historical opening balances may net past advances because old system did not have explicit advance-settlement facts. This is acceptable if documented as one-time deterministic cutover transformation.

**Host Overpayment Policy (exact rule, no "preferably"):**

- Invariants: **payroll_payable >=0 MUST**, **staff_receivable >=0 MUST** (where staff_receivable is part of 1150 Staff Advances & Receivables asset, which is >=0). **MUST NOT** create negative Payroll Payable liability. **MUST NOT** create negative Staff Receivable asset.
- Future behavior when new payout would exceed currently available Payroll Payable: Choose **excess becomes Staff Receivable asset** (not hard block). Reason: preserves owner flexibility for small team, matches historical overpayment handling where negative late_total becomes receivable, allows advance-like overpayment.
- Exact posting for payout X, current payable Y, current receivable Z:
  - If X <= Y: Dr Payroll Payable X Cr Treasury X. New payable = Y - X, receivable unchanged Z.
  - If X > Y: Dr Payroll Payable Y Cr Treasury Y (payable becomes 0) + Dr Staff Receivable (X - Y) Cr Treasury (X - Y) (receivable becomes Z + (X-Y)). Total Treasury credit X.
- Alternative considered: hard block overpayment — rejected because would require owner to create advance first, extra steps, not matching current system that allows overpayment.
- Document exact rule in A0, enforce via RPC check: before payout, read current payable balance, if X > Y, allow but create receivable portion, audit note overpayment.

## 7. Expense Contract

**Cash-paid expense:** Dr Direct Event Expense (5200) Cr Treasury (specific treasury account). Source EVENT_EXPENSE, Event Link event_id, Expense Link expense_id. Amount = expense amount net (for VAT-registered, expense may have input VAT? For A0/A1, input VAT deferred, treat expense as net, input VAT handling future). Category (TRANSPORT/FUEL/RENTAL/THIRD_PARTY/CONSUMABLE/DAMAGE_LOSS/OTHER) stored in source doc, not separate chart accounts for MVP.

**Expense incurred but not yet paid:** For minimum rigorous model, keep cash-paid only initially (A0/A1). Document future boundary: if supplier bill for expense (e.g., transport company invoice), then use supplier invoice path Dr Expense Cr AP, then payment Dr AP Cr Treasury. So expense accrued = supplier invoice path. Input VAT for expenses deferred to future supplier accounting.

**Preserve anti-double-counting rule:** staff_cost, procurement_cost, event_expenses are separate cost sources. Procurement purchase must never also appear as generic event_expense.

**Void expense:** `void_event_expense` non-destructive VOID with reason. Accounting reversal: Dr Treasury Cr Expense (if cash-paid) OR Dr AP Cr Expense (if accrued). Source EVENT_EXPENSE_VOID, references original.

## 8. Supplier / Procurement / AP Contract

**Current:** Supplier→Procurement Order→Receipt, but no formal supplier invoice/AP settlement.

**Future accounting contract:**

- **Purchase order:** NO JOURNAL ENTRY — commitment, not yet liability.
- **Goods/service receipt:** NO JOURNAL ENTRY initially, remains operational only until supplier invoice. For consumable purchases, receipt creates operational inventory via `consumable_movements` RECEIVE, but no accounting inventory asset yet (deferred). For direct event cost, receipt is proof of delivery, not yet liability. Accounting liability arises at supplier invoice. Future boundary: If inventory asset accounting adopted, receipt would be Dr Inventory Asset Cr GRNI liability, then supplier invoice Dr GRNI Cr AP.
- **Supplier invoice (bill):** Direct event cost: Dr Procurement / Event Cost (5100) Cr Accounts Payable (2200). For inventory purchases, if inventory accounting introduced: Dr Inventory Asset Cr AP. Do not introduce inventory asset accounting prematurely. So for A0/A1/B/C, supplier invoice for direct event cost = Dr Procurement Cost Cr AP. Source SUPPLIER_INVOICE, Supplier Link, Procurement Order Link, Event Link if event-linked. For VAT-registered supplier, input VAT handling deferred but reserve account 1155 Input VAT / VAT Receivable placeholder.
- **Supplier invoice void:** Dr AP Cr Procurement Cost (reversal).
- **Supplier payment:** Dr AP Cr Treasury. Source SUPPLIER_PAYMENT.
- **Supplier payment void:** Dr Treasury Cr AP.
- **Three-way match:** PO ↔ Receipt ↔ Invoice. Minimal: For CONSUMABLE line_kind, receipt required before invoice can be posted (must have at least partial receipt qty >= invoice qty). For CATERING_SERVICE and OTHER, receipt optional. Price tolerance: for A0, require exact price match within 0.001 OMR, else exception flagged for owner override with note. Quantity tolerance: invoice qty ≤ received qty and ≤ ordered qty, else exception. Accounting eligibility: supplier invoice posting allowed only if 3-way match passes OR owner overrides with explicit reason.

## 9. Inventory Accounting Boundary

**Existing operational movement ledgers:** `consumable_movements` (RECEIVE, ISSUE_TO_EVENT, RETURN_FROM_EVENT, CONSUME_AT_EVENT, WASTE_AT_EVENT, WAREHOUSE_WASTE, ADJUSTMENT) with warehouse_delta/event_delta, no negative balances, balances derived; `event_equipment_movements` DISPATCH/RETURN good/damaged/lost with catalog-cost snapshot. Operational, not accounting asset valuation.

**Decision: Option 1 — Keep inventory purely operational initially and continue using procurement/event costing.**

**Therefore for Tranche A/B/C/D, inventory remains operational.** Do NOT create another inventory truth. Do NOT introduce inventory asset accounting prematurely.

**Future boundary:** If inventory asset value needed, introduce inventory_asset account 1200, GRNI account 2400, receipt posting Dr Inventory Asset Cr GRNI, supplier invoice Dr GRNI Cr AP (if inventory purchase) OR Dr Procurement Cost Cr AP (if direct event cost), consumption Dr Direct Event Expense Cr Inventory Asset when CONSUME_AT_EVENT, waste Dr Waste Expense Cr Inventory Asset, adjustment Dr/Cr Inventory Asset Cr/Dr Adjustment account, valuation keep catalog_cost_snapshot for simplicity.

**Equipment damage/loss:** Remain operational valuation only until fixed asset accounting exists. Future: Dr Loss Expense Cr Equipment Asset. For A0/A1, damage/loss stays in event_expenses or operational reconciliation, no asset journal. Deferred.

## 10. Treasury Contract

**Treasury accounts independent from payment method:** payment_method is channel, treasury_account is where money physically sits. Must never use payment_method as treasury balance.

**Minimum treasury account model:**
- Table `treasury_accounts`: org_id FK, id PK, name text, type enum CASH/BANK/OTHER, chart_account_id FK to chart_of_accounts (1000/1010/1020), is_active bool default true, created_by, created_at, updated_at.
- Each treasury account is sub-account of system CASH/BANK chart account for reporting. System chart has CASH (1000) and BANK (1010) as parent, treasury_accounts are child accounts with code 1001,1002 etc.
- Balances derived entirely from journal lines: Treasury Balance = sum debits − sum credits for that chart account. No cached balance column (or cached for performance but derived authoritative).
- **Negative cash allowed? No.** Cash (physical cashbox) cannot go negative — positive_only guard. Enforce via trigger or RPC check: before posting credit to CASH account that would make balance negative, reject `TREASURY_NEGATIVE_CASH_NOT_ALLOWED`.
- Bank accounts may go negative? For minimum rigorous, **disallow negative initially** for both CASH and BANK, to prevent errors. Allow overdraft config later via `allow_negative` bool.
- **Transfer semantics:** `treasury_transfer` RPC: p_org_id, p_from_treasury_id, p_to_treasury_id, p_amount, p_note, p_idempotency_key. Posting: Dr destination treasury chart account Cr source treasury chart account, same amount, same entry_date, source TREASURY_TRANSFER, event_id null. Idempotent, audited, capability finance.manage. Advisory lock on (org, from_id, to_id, idempotency_key).
- **Opening balance semantics:** via opening balance journal using Equity Opening Balance account (3000). For each treasury account, create opening balance entry: Dr Treasury (amount) Cr Opening Balance Equity (if positive opening). Opening balances created at cutover date via `OPENING_BALANCE` source. Treasury opening must be owner-provided, not derived.
- **Account deactivation:** cannot deactivate if balance !=0 (must transfer out first), else allowed, is_active false, no new postings to inactive account.
- **Reconciliation:** For A0/A1, reconciliation OUT OF SCOPE. Later: bank statement import, matching rules.

## 11. Minimum Chart of Accounts (Corrected)

**System accounts protected and automatically created per organization via seed in migration 0081. Owner should not manage complexity manually; system accounts is_active true, is_system true, no client direct writes.**

**Assets (1000-1999):**
- 1000 **Cash / Treasury** — parent for CASH type treasury accounts, Asset, DEBIT normal, System, active, purpose: physical cashboxes. MUST have >=0 balance.
- 1001+ **Treasury Cash Sub-accounts** — e.g., 1001 Main Cashbox, 1002 Petty Cash — child of 1000, DEBIT normal, each treasury_accounts row maps to one. Created via RPC. Active.
- 1010 **Bank / Treasury** — parent for BANK type treasury accounts, Asset, DEBIT normal, System, active.
- 1011+ **Treasury Bank Sub-accounts** — e.g., 1011 Bank Muscat — child of 1010.
- 1020 **Other Treasury** — parent for OTHER type, Asset, DEBIT normal, active.
- 1100 **Accounts Receivable** — AR from customer invoices, Asset, DEBIT normal, System, active, purpose: amounts owed by customers, gross inclusive (net+VAT). MUST >=0 per invoice, per customer, per org. MUST NOT be negative (no negative AR artifact).
- 1120 **Unbilled Receivable / Contract Asset** — earned but not yet invoiced, Asset, DEBIT normal, System, active, purpose: CLOSED event without invoice, represents amount to be invoiced (gross inclusive for VAT-registered: net+VAT, for non-VAT gross=net). MUST >=0. Added for Correction One.
- 1150 **Staff Advances & Receivables** — Staff Advance Receivable / Asset + overpayment receivable, Asset, DEBIT normal, System, active, purpose: advances to hosts + excess payouts over earnings (receivable). Renamed from Staff Advances to broader. MUST >=0. Holds opening Staff Receivable from overpayment.
- 1155 **Input VAT / VAT Receivable** — placeholder, Asset, DEBIT normal, System, DEFERRED for future supplier accounting, purpose: input VAT from supplier invoices. Reserve, not active in A1.
- 1200 **Inventory Asset** — placeholder, Asset, DEBIT normal, DEFERRED.
- 1300 **Equipment Asset** — placeholder, Asset, DEBIT normal, DEFERRED.

**Liabilities (2000-2999):**
- 2000 **Customer Deposits / Advances** — unapplied customer payments, Liability, CREDIT normal, System, active, purpose: cash received before invoice, net amount for VAT-registered (VAT separate), gross for non-VAT. MUST >=0.
- 2100 **Deferred / Unearned Revenue** — invoiced but not yet earned, Liability, CREDIT normal, System, active, purpose: AR created but service not yet CLOSED, net amount (VAT separate). MUST >=0. At CLOSED, MUST be 0.
- 2150 **VAT Payable / Output VAT** — VAT collected from customers, Liability, CREDIT normal, System, active, purpose: output VAT obligation per Oman tax point rules. MUST >=0. Added for Correction Two. For non-VAT orgs, balance 0.
- 2200 **Accounts Payable** — supplier bills, Liability, CREDIT normal, System, active, purpose: amounts owed to suppliers. MUST >=0 per invoice.
- 2300 **Payroll Payable** — earned but not yet paid staff, Liability, CREDIT normal, System, active, purpose: attendance-earned compensation payable. MUST >=0 (see overpayment policy). MUST NOT be negative.
- 2400 **GRNI / Accrued Purchases** — Goods Received Not Invoiced, Liability, CREDIT normal, DEFERRED.

**Equity (3000-3999):**
- 3000 **Opening Balance Equity** — for cutover opening balances, Equity, CREDIT normal (or DEBIT/CREDIT depending), System, active, purpose: offset opening balances for treasury, AR, deposits, contract asset, AP, payroll payable, advances, VAT Payable. MUST balance opening assets vs liabilities. Historical P&L not replayed into current-period revenue/expense under Strategy B.
- 3100 **Retained Earnings / Current Year Earnings** — placeholder, Equity, CREDIT normal, DEFERRED.

**Revenue (4000-4999):**
- 4000 **Event Revenue** — earned event revenue, Revenue, CREDIT normal, System, active, purpose: recognized when event CLOSED, net amount only (excluding VAT) for VAT-registered orgs, full amount for non-VAT orgs. VAT must NEVER enter Event Revenue. MUST be net.

**Expenses (5000-5999):**
- 5000 **Staff Cost** — host/supervisor payroll cost, Expense, DEBIT normal, System, active.
- 5100 **Procurement / Materials Cost** — purchases, Expense, DEBIT normal, System, active.
- 5200 **Direct Event Expenses** — transport/fuel/rental/third-party/consumable/other, Expense, DEBIT normal, System, active. Category breakdown via source doc, not sub-accounts for MVP.
- 5300 **Damage / Loss Expense** — equipment damage/loss, Expense, DEBIT normal, DEFERRED until fixed asset accounting exists, else part of 5200.

**Notes:** Do not build huge enterprise chart. System accounts auto-created. Each treasury_accounts row creates child chart account under 1000/1010/1020 with code auto-generated. Equity Opening Balance needed for cutover. Minimum active for corrected A1: 1000,1010,1100,1120,1150,2000,2100,2150,2200,2300,3000,4000,5000,5100,5200 = 15 active system accounts. Placeholders deferred but documented: 1020,1155,1200,1300,2400,3100,5300.

## 12. Posting Security Boundary

**Mandatory: Do not expose unrestricted generic client RPC post_journal_entry(lines jsonb) behind only finance.manage.**

**Generic posting primitive INTERNAL DATABASE PRIMITIVE called only by authoritative business RPCs.**

- Internal primitive: `internal_post_journal(p_org_id, p_entry_date, p_event_at, p_memo, p_source_type, p_source_id, p_lines jsonb, p_idempotency_key, p_fingerprint, p_created_by)` — SECURITY DEFINER, not granted to authenticated, only callable by other SECURITY DEFINER functions (via search_path and revoke). Validates balanced, OMR precision, org isolation, accounts same org, source doc same org, at least two lines, no zero, no both debit+credit, inactive account check, inserts header+lines atomically, no audit itself (caller audits).
- External business commands remain security surface, each uses its own current capability (existing exact capabilities where business operation already has one):

| Operation | Capability | Existing RPC / Future RPC |
|---|---|---|
| Record customer payment | payment.record | record_customer_payment (existing enhanced to post journal internally in A2) |
| Void customer payment | payment.void | void_customer_payment (existing enhanced in A2) |
| Invoice operations | invoice.manage | create_event_invoice (existing enhanced in A2), void_invoice (existing enhanced) |
| Event expense | finance.manage | record_event_expense (existing enhanced in A2) |
| Staff advance | payroll.pay | record_staff_advance (existing enhanced in A3) |
| Host payout | payroll.pay | record_host_payout_multi (existing enhanced in A3) |
| Supplier invoice / bill | procurement.manage | create_supplier_invoice (future C), void_supplier_invoice |
| Supplier payment | finance.manage | record_supplier_payment (future C) |
| Treasury account admin | finance.manage | create_treasury_account, update_treasury_account (B) |
| Treasury transfer | finance.manage | treasury_transfer (B) |
| Ledger read | cost.visibility | account_balance, journal_history, etc. (A1) |
| Manual journal if ever | explicit future decision, not now | manual_journal_entry (future, separate explicit RPC) |

Do not collapse permissions into broad accounting super-capability. If manual journal entries ever required, separate explicit feature and RPC with maker-checker.

**Implementation:** Revoke all on internal_post_journal from public, anon, authenticated. No grants to authenticated. Business RPCs are SECURITY DEFINER and call internal primitive.

## 13. Journal Invariants (Corrected for Balance Enforcement)

**Exact DB invariants before implementation:**

- **Posted journal headers immutable:** BEFORE UPDATE OR DELETE trigger on journal_entries raises JOURNAL_IMMUTABLE. No direct UPDATE/DELETE.
- **Journal lines immutable:** BEFORE UPDATE OR DELETE trigger on journal_lines raises JOURNAL_LINE_IMMUTABLE. No direct UPDATE/DELETE.
- **No destructive correction:** Corrections via reversal only, never UPDATE/DELETE.
- **Reversal creates new opposite journal:** reversal_of column FK to journal_entries id being reversed, new entry opposite debit/credit per line, same total, is_reversal true, memo indicates reversal. reversal_of NOT NULL for reversal entries, original must exist same org, original not already reversed (partial unique index UNIQUE (organization_id, reversal_of) WHERE reversal_of IS NOT NULL prevents double reversal unless documented chain allowed). For A0, entry may be reversed only once unless documented chain.
- **Debit total = credit total — CORRECTED ENFORCEMENT:** Imbalance is created by inserting/changing journal_lines, not journal_entries. Therefore database invariant must be attached to actual mutation boundary:
  - **Step 1:** insert immutable journal header.
  - **Step 2:** insert all journal lines inside `internal_post_journal` in same transaction.
  - **Step 3:** `internal_post_journal` explicitly validates balance before returning: SELECT SUM(debit), SUM(credit) FROM lines, raise `JOURNAL_UNBALANCED` if not equal.
  - **Step 4:** Additionally install **DEFERRABLE CONSTRAINT TRIGGER on journal_lines** (not on journal_entries) so invariant revalidated at transaction end: `CREATE CONSTRAINT TRIGGER trg_journal_lines_balanced AFTER INSERT ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced()`. Function `assert_journal_balanced()` checks parent journal of every inserted line: SELECT SUM(debit), SUM(credit) FROM journal_lines WHERE entry_id = NEW.entry_id, raises if imbalance. This ensures database itself guarantees SUM(debits)=SUM(credits) for every posted journal entry, even if implementation details later change.
  - **Step 5:** Trigger checks parent journal of every inserted line, not just NEW row.
  - **Step 6:** Direct line access remains unavailable to application clients (revoke all from anon/authenticated, no grants).
  - Because journal lines are immutable after posting, UPDATE/DELETE should normally be blocked by immutability trigger, but balancing invariant must remain valid even if implementation details later change, so balancing trigger remains on lines.
- **Each journal has at least two lines — CORRECTED ENFORCEMENT LOCATION:** Keep invariant journal must contain >=2 lines, but define where enforced: internal posting primitive MUST reject fewer than two lines, zero amount, both debit and credit same line, neither debit nor credit, non-OMR precision, account from another organization, inactive posting account, unbalanced totals. Additionally, DEFERRABLE CONSTRAINT TRIGGER on journal_lines can also enforce count >=2 at transaction end by checking COUNT(*) per entry_id >=2.
- **No line has both debit and credit:** CHECK ((debit>0 AND credit=0) OR (debit=0 AND credit>0)) on journal_lines.
- **No zero-value line:** CHECK (debit>0 OR credit>0) and CHECK amount >0, plus assert_payment_omr.
- **Exact OMR 3-decimal precision:** All amounts numeric(12,3) or numeric(14,3) validated via `assert_payment_omr` (amount>0, scale 3). No float. Enforced in internal_post_journal before insert.
- **All accounts belong to same organization:** FK (organization_id, account_id) to chart_of_accounts org_id, plus check in internal_post_journal all lines same org as header.
- **Account must be active posting account:** Check is_active true and is_system? Actually system accounts active, treasury sub-accounts active. Reject inactive account with `ACCOUNT_INACTIVE`.
- **Source document belongs to same organization:** Check source doc's organization_id = journal's organization_id.
- **Business RPC + journal posting occur in one PostgreSQL transaction:** Business RPC does operational insert + internal_post_journal in same PL/pgSQL function, no separate transactions. If journal fails, whole tx fails.
- **If journal posting fails, business mutation fails too:** Due to same transaction.
- **Replaying idempotent business command does not create another journal:** Idempotency via canonical command_idempotency (org, scope, key) + fingerprint. begin_command checks existing, if found returns original payload without new journal. finish_command stores result. Unique index (org_id, idempotency_key) on journal_entries also prevents duplicate.

**Required columns and semantics:**
- id uuid PK default gen_random_uuid()
- organization_id uuid FK organizations, mandatory, tenant isolation.
- entry_number text unique per org e.g., JE-YYYY-NNNNN via document_sequences, for audit.
- entry_date date — accounting date, business date (paid_at, invoice_date, attendance date, CLOSED date). Used for period reporting. Mandatory.
- event_at timestamptz nullable — when real-world event occurred if different from created_at (webhook time), from pgledger concept. For payment event_at = paid_at, invoice event_at = issued_at, attendance event_at = attendance date, revenue recognition event_at = CLOSED date. Allows historical querying by event time vs DB time.
- created_at timestamptz default now() — DB insert time, immutable.
- source_type text check in approved taxonomy, mandatory.
- source_id uuid mandatory, generic not FK to single table, but check org via function.
- idempotency_key uuid mandatory, unique per org (partial unique index org_id, idempotency_key).
- request_fingerprint text mandatory length 64 SHA-256 of canonical payload, for payload mismatch detection.
- created_by uuid FK auth.users, mandatory.
- reversal_of uuid nullable FK to journal_entries id, for reversal chain.
- is_reversal bool default false, true if reversal.
- memo text nullable, description.
- event_id uuid nullable FK events org_id, for event profitability reporting (denormalized minimal for performance).
- Lines: id, org_id, entry_id FK, account_id FK chart_of_accounts, debit numeric(12,3) default 0, credit default 0, line_memo nullable, created_at, CHECKs as above.

## 14. Source Document Taxonomy (Corrected)

Stable taxonomy, avoid free-form. Use check constraint or enum `journal_source_type`.

Approved source types for corrected A0/A1/B/A2/A3/C/D:

- `CUSTOMER_PAYMENT` — customer payment recorded (before or after invoice, gross)
- `CUSTOMER_PAYMENT_VOID` — payment voided (reverses Treasury, Deposits net, VAT Payable VAT if deposit)
- `CUSTOMER_DEPOSIT_APPLIED` — deposit net allocated to invoice net (auto or explicit)
- `CUSTOMER_DEPOSIT_RELEASED` — deposit released (reversal of applied)
- `INVOICE` — invoice issued (AR creation, Deferred net, VAT Payable remaining VAT)
- `INVOICE_VOID` — invoice voided (reverses AR, Deferred/Revenue, VAT Payable, restores deposits)
- `REVENUE_RECOGNITION` — deferred revenue → revenue at CLOSED (Dr Deferred Cr Revenue, net only)
- `UNBILLED_RECOGNITION` — contract asset recognition at CLOSED without invoice (Dr Unbilled gross Cr Revenue net Cr VAT Payable VAT) — Correction One
- `CONTRACT_ASSET_RECLASSIFICATION` — invoice after CLOSED reclassifies Unbilled to AR (Dr AR Cr Unbilled, no revenue, no VAT)
- `REVENUE_REVERSAL` — revenue reversal if event cancelled after recognition
- `EVENT_EXPENSE` — event expense paid immediately (Dr Expense Cr Treasury)
- `EVENT_EXPENSE_VOID` — expense voided
- `HOST_EARNING` — attendance earning (Dr Staff Cost Cr Payroll Payable)
- `HOST_EARNING_VOID` — attendance void/correction reversal
- `HOST_PAYOUT` — host payout (Dr Payroll Payable Cr Treasury, plus Dr Staff Receivable Cr Treasury if overpayment)
- `HOST_PAYOUT_VOID` — payout void if supported
- `STAFF_ADVANCE` — staff advance asset creation (Dr Staff Advances & Receivables Cr Treasury)
- `STAFF_ADVANCE_VOID` — advance void
- `STAFF_ADVANCE_SETTLEMENT` — advance settled against payroll payable (Dr Payroll Payable Cr Staff Advances & Receivables)
- `STAFF_RECEIVABLE_RECOGNITION` — overpayment excess becomes receivable (Dr Staff Receivable Cr Treasury) — part of HOST_PAYOUT
- `SUPPLIER_INVOICE` — supplier invoice (bill) creates AP (Dr Cost Cr AP)
- `SUPPLIER_INVOICE_VOID` — supplier invoice void
- `SUPPLIER_PAYMENT` — supplier payment settles AP (Dr AP Cr Treasury)
- `SUPPLIER_PAYMENT_VOID` — supplier payment void
- `TREASURY_TRANSFER` — transfer between treasury accounts (Dr Dest Cr Source)
- `OPENING_BALANCE` — opening balance at cutover (Dr Treasury/AR/Contract Asset/Staff Receivable Cr Opening Equity, or Dr Opening Equity Cr Deposits/Deferred/VAT/AP/Payroll Payable)
- `ADJUSTMENT` — manual adjustment if ever allowed (future)

Avoid free-form strings, use validated check. One business event may create multiple journals when allocation involved (e.g., invoice + deposit allocation), but prefer deterministic 1-business-event → 1-accounting-event when possible, and when multiple, they occur in same transaction.

**Event linkage:** journal entry org_id mandatory + event_id nullable for profitability + source_type/source_id, other entities via source doc joins, lines only account_id. Every event-related journal must have event_id populated for profitability reporting.

## 15. Posting Matrix (Corrected with VAT + Contract Asset + Deterministic)

| Business Event | Preconditions | Debit | Credit | Source Document | Event Link | Reversal Event | Capability | Existing RPC / Future RPC | VAT Handling |
|---|---|---|---|---|---|---|---|---|---|
| Quotation accepted | Quotation ISSUED, event not CANCELLED, quotation.manage | NO JOURNAL ENTRY | NO JOURNAL ENTRY | — | event_id | — | quotation.manage | accept_quotation (existing) | No VAT |
| Invoice issued (before CLOSED, no prior deposit, non-VAT) | Event not CANCELLED, has accepted_quotation_id, no existing ISSUED invoice (one per event now), total_amount>0, installments sum=total, invoice.manage | Accounts Receivable 1100 gross | Deferred Revenue 2100 net (gross=net) | INVOICE | event_id, invoice_id | INVOICE_VOID | invoice.manage | create_event_invoice (existing, enhanced in A2) | No VAT |
| Invoice issued (before CLOSED, no prior deposit, VAT-registered) | Same + org vat_registered true, pre_vat_total, vat_amount snapshot | Accounts Receivable 1100 gross (net+VAT) | Deferred Revenue 2100 net + VAT Payable 2150 VAT (full VAT) | INVOICE | event_id, invoice_id | INVOICE_VOID | invoice.manage | create_event_invoice (A2) | Dr AR gross (net+VAT) Cr Deferred net Cr VAT Payable VAT, balanced |
| Invoice issued (before CLOSED, with prior deposit, non-VAT) | Event not CANCELLED, invoice not exists, deposit exists P_gross, invoice.manage | Accounts Receivable 1100 gross (total) | Deferred Revenue 2100 net (total) | INVOICE | event_id, invoice_id | INVOICE_VOID | invoice.manage | create_event_invoice (A2) | No VAT, then allocation Dr Deposits gross Cr AR gross for min(P,I) |
| Invoice issued (before CLOSED, with prior deposit, VAT-registered) | Same + vat_registered, advance VAT already recognized = sum VAT from deposit receipts | Accounts Receivable 1100 = total net + remaining VAT (total VAT - advance VAT) | Deferred Revenue 2100 net (total net) + VAT Payable 2150 remaining VAT (total VAT - advance VAT) | INVOICE | event_id, invoice_id | INVOICE_VOID | invoice.manage | create_event_invoice (A2) | Remaining VAT only, prevents duplication. Example: total net 2000 VAT 100, advance net 1000 VAT 50 already, remaining VAT 50, AR = 2000+50=2050, Deferred 2000, VAT 50. Balanced. |
| Customer deposit applied to invoice (non-VAT) | Invoice exists, Customer Deposits balance>0, invoice.manage | Customer Deposits 2000 gross | Accounts Receivable 1100 gross | CUSTOMER_DEPOSIT_APPLIED | event_id, invoice_id, payment_id | CUSTOMER_DEPOSIT_RELEASED | invoice.manage | allocate_customer_deposit (future) | No VAT |
| Customer deposit applied to invoice (VAT-registered) | Invoice exists, Deposits net>0, invoice.manage | Customer Deposits 2000 net | Accounts Receivable 1100 net (net portion only, VAT already in VAT Payable) | CUSTOMER_DEPOSIT_APPLIED | event_id, invoice_id, payment_id | CUSTOMER_DEPOSIT_RELEASED | invoice.manage | allocate_customer_deposit | Net only, VAT stays in VAT Payable |
| Customer payment before invoice (deposit, non-VAT) | Event not CANCELLED, amount>0 gross, payment.record, treasury_account_id exists active (future B) | Treasury 1000/1010 child gross | Customer Deposits 2000 gross | CUSTOMER_PAYMENT | event_id, payment_id, customer_id | CUSTOMER_PAYMENT_VOID | payment.record | record_customer_payment (existing, enhanced in A2) | No VAT, tax point at receipt but no VAT for non-registered |
| Customer payment before invoice (deposit, VAT-registered) | Same + org vat_registered true | Treasury 1000/1010 gross | Customer Deposits 2000 net + VAT Payable 2150 VAT | CUSTOMER_PAYMENT | event_id, payment_id, customer_id | CUSTOMER_PAYMENT_VOID | payment.record | record_customer_payment (A2) | VAT split: VAT = round(gross * vat_percent / (100+vat_percent),3), net = gross - VAT. Tax point at receipt per Oman VAT Law Art 26. |
| Customer payment after invoice (non-VAT and VAT-registered) | Event not CANCELLED, invoice exists, outstanding>0, payment.record, treasury_account_id active | Treasury gross | Accounts Receivable gross | CUSTOMER_PAYMENT | event_id, payment_id, invoice_id via allocation | CUSTOMER_PAYMENT_VOID | payment.record | record_customer_payment (A2) | No new VAT, VAT already due at earlier of invoice/payment per Oman law Art 26. |
| Customer payment voided (deposit, non-VAT) | Payment RECORDED, reason>=3, payment.void | Customer Deposits gross | Treasury gross | CUSTOMER_PAYMENT_VOID | event_id, payment_id | — | payment.void | void_customer_payment (A2) | No VAT |
| Customer payment voided (deposit, VAT-registered) | Payment RECORDED was deposit, reason>=3, payment.void | Customer Deposits net + VAT Payable VAT | Treasury gross | CUSTOMER_PAYMENT_VOID | event_id, payment_id | — | payment.void | void_customer_payment (A2) | Dr Deposits net Dr VAT Payable VAT Cr Treasury gross, reverses original. Prevents orphaned VAT. |
| Customer payment voided (after invoice) | Payment RECORDED was after invoice, reason>=3, payment.void | Accounts Receivable gross | Treasury gross | CUSTOMER_PAYMENT_VOID | event_id, payment_id | — | payment.void | void_customer_payment (A2) | No VAT reversal (VAT already in VAT Payable from invoice), payment becomes unapplied? Actually after invoice payment void should reclassify as deposit? For simplicity, void after invoice payment = Dr AR Cr Treasury, AR increases, no deposit created. If invoice still exists, AR outstanding increases. |
| Revenue recognized at CLOSED with invoice exists (deferred exists, non-VAT) | Event status transitions to CLOSED, Deferred balance>0 for event, event.manage | Deferred Revenue 2100 net | Event Revenue 4000 net | REVENUE_RECOGNITION | event_id | REVENUE_REVERSAL | event.manage (system) | transition_event_status (existing, enhanced in A2) | No VAT, VAT already in VAT Payable |
| Revenue recognized at CLOSED with invoice exists (VAT-registered) | Same + vat_registered | Deferred Revenue 2100 net | Event Revenue 4000 net | REVENUE_RECOGNITION | event_id | REVENUE_REVERSAL | event.manage | transition_event_status (A2) | VAT stays in VAT Payable, revenue = net only, VAT never enters revenue |
| Revenue recognized at CLOSED without invoice, no deposit, non-VAT | Event CLOSED, no active invoice, event not CANCELLED, has accepted_quotation_id, commercial total Q_gross, event.manage | Unbilled Receivable 1120 gross (net) | Event Revenue 4000 net | UNBILLED_RECOGNITION | event_id | REVENUE_REVERSAL | event.manage | transition_event_status (A2) | No VAT |
| Revenue recognized at CLOSED without invoice, no deposit, VAT-registered | Same + vat_registered, Q_net, Q_vat from quotation snapshot | Unbilled Receivable 1120 gross (net+VAT) | Event Revenue 4000 net + VAT Payable 2150 VAT | UNBILLED_RECOGNITION | event_id | REVENUE_REVERSAL | event.manage | transition_event_status (A2) | Tax point at completion per Oman law Art 26, VAT due at CLOSED even without invoice. Dr Unbilled gross Cr Revenue net Cr VAT Payable VAT, balanced. |
| Revenue recognized at CLOSED without invoice, with deposit, non-VAT | Event CLOSED, no invoice, deposit P_gross exists | Customer Deposits 2000 gross + Unbilled Receivable 1120 gross (remaining) | Event Revenue 4000 net (total) | UNBILLED_RECOGNITION + DEPOSIT_APPLIED combined? Actually two journals in same tx: Dr Deposits gross Cr Revenue gross? Let's define deterministic: Dr Deposits gross Cr Revenue gross (for advance portion) + Dr Unbilled gross (remaining) Cr Revenue gross (remaining) | UNBILLED_RECOGNITION | event_id | REVENUE_REVERSAL | event.manage | transition_event_status (A2) | No VAT |
| Revenue recognized at CLOSED without invoice, with deposit, VAT-registered | Same + vat_registered, advance net 1000 VAT 50 already, total net 2000 VAT 100 | Customer Deposits 2000 net Cr Revenue net 1000 + Unbilled Receivable 1120 gross 1050 (1000 net+50 VAT) Cr Revenue net 1000 Cr VAT Payable 50 | Event Revenue net total 2000, VAT Payable remaining 50 | UNBILLED_RECOGNITION | event_id | REVENUE_REVERSAL | event.manage | transition_event_status (A2) | Dr Deposits net 1000 Cr Revenue net 1000 + Dr Unbilled gross 1050 Cr Revenue net 1000 Cr VAT 50. Final: Treasury 1050, Unbilled 1050, Revenue 2000, VAT 100. |
| Later invoice after CLOSED without invoice, no deposit, non-VAT | Event CLOSED, Unbilled exists, invoice issued for full, invoice.manage | Accounts Receivable 1100 gross | Unbilled Receivable 1120 gross | CONTRACT_ASSET_RECLASSIFICATION | event_id, invoice_id | INVOICE_VOID | invoice.manage | create_event_invoice (A2) | No new revenue, no new VAT, reclassification only |
| Later invoice after CLOSED without invoice, no deposit, VAT-registered | Same + vat_registered, Unbilled gross 2100 (2000 net+100 VAT) | Accounts Receivable 1100 gross 2100 | Unbilled Receivable 1120 gross 2100 | CONTRACT_ASSET_RECLASSIFICATION | event_id, invoice_id | INVOICE_VOID | invoice.manage | create_event_invoice (A2) | No new revenue, no new VAT, VAT already recognized at CLOSED |
| Later invoice after CLOSED without invoice, with deposit, non-VAT | Event CLOSED with deposit, Unbilled remaining, Treasury exists, invoice full | Accounts Receivable 1100 gross (remaining) | Unbilled Receivable 1120 gross (remaining) | CONTRACT_ASSET_RECLASSIFICATION | event_id, invoice_id | INVOICE_VOID | invoice.manage | create_event_invoice (A2) | No new revenue, no new VAT, AR = remaining |
| Later invoice after CLOSED without invoice, with deposit, VAT-registered | Same + vat_registered, Unbilled 1050 remaining, Treasury 1050, Revenue 2000, VAT 100 | Accounts Receivable 1100 gross 1050 | Unbilled Receivable 1120 gross 1050 | CONTRACT_ASSET_RECLASSIFICATION | event_id, invoice_id | INVOICE_VOID | invoice.manage | create_event_invoice (A2) | No new revenue, no new VAT |
| Invoice voided before CLOSED, non-VAT | Invoice ISSUED, reason>=3, invoice.manage, no payment allocation OR allocation reversed atomically | Deferred Revenue 2100 | Accounts Receivable 1100 | INVOICE_VOID | event_id, invoice_id | — | invoice.manage | void_invoice (A2) | No VAT |
| Invoice voided before CLOSED, VAT-registered, no deposit | Invoice ISSUED with VAT, reason, invoice.manage | Deferred Revenue 2100 net + VAT Payable 2150 VAT | Accounts Receivable 1100 gross | INVOICE_VOID | event_id, invoice_id | — | invoice.manage | void_invoice (A2) | Dr Deferred net Dr VAT Payable VAT Cr AR gross, prevents orphaned VAT |
| Invoice voided before CLOSED, VAT-registered, with deposit allocation | Invoice ISSUED, deposit allocated net, reason | Deferred net + VAT Payable VAT + AR net? Actually need to reverse invoice and restore deposits: Dr Deferred net Dr VAT Payable VAT Cr AR gross (full) + Dr AR net Cr Deposits net (restore) | INVOICE_VOID + CUSTOMER_DEPOSIT_RELEASED | event_id, invoice_id | — | invoice.manage | void_invoice (A2) | Two journals in same tx: reverse invoice, then Dr AR net Cr Deposits net to restore deposit. Final: Treasury gross, Deposits net, VAT Payable VAT (if deposit VAT remains) ??? Need exact in implementation but deterministic |
| Event expense paid immediately | Event not CANCELLED, not financially closed, amount>0, finance.manage, treasury_account_id active | Direct Event Expense 5200 net | Treasury gross | EVENT_EXPENSE | event_id, expense_id | EVENT_EXPENSE_VOID | finance.manage | record_event_expense (existing enhanced in A2) | Input VAT deferred |
| Attendance earning (payroll accrual) | Assignment ACTIVE, attendance not VOIDED, status PRESENT/LATE/PARTIAL, earned_amount>0, attendance.record | Staff Cost 5000 | Payroll Payable 2300 | HOST_EARNING | event_id, staff_member_id, attendance_id | HOST_EARNING_VOID | attendance.record | record_attendance (existing enhanced in A3) | No VAT |
| Attendance void/correction | Attendance exists not already VOIDED, reason>=3, attendance.record | Payroll Payable 2300 | Staff Cost 5000 | HOST_EARNING_VOID | event_id, staff_member_id, attendance_id | — | attendance.record | void_attendance (existing) | No VAT |
| Staff advance (future) | Staff member exists, amount>0, payroll.pay, treasury_account_id active | Staff Advances & Receivables 1150 | Treasury | STAFF_ADVANCE | staff_member_id, advance_id | STAFF_ADVANCE_VOID | payroll.pay | record_staff_advance (existing enhanced in A3) | No VAT |
| Staff advance void | Advance RECORDED, reason, payroll.pay | Treasury | Staff Advances & Receivables 1150 | STAFF_ADVANCE_VOID | staff_member_id, advance_id | — | payroll.pay | void_staff_advance | No VAT |
| Advance settlement against payroll | Payroll Payable exists for staff, Advance Asset exists, payroll.pay | Payroll Payable 2300 | Staff Advances & Receivables 1150 | STAFF_ADVANCE_SETTLEMENT | staff_member_id, advance_id, event_id optional | reverse settlement | payroll.pay | settle_staff_advance (future) | No VAT |
| Host payout (future, payable sufficient) | Payroll Payable exists, amount X <= payable Y, treasury_account_id active, payroll.pay | Payroll Payable 2300 X | Treasury X | HOST_PAYOUT | event_id nullable, staff_member_id, payout_id | HOST_PAYOUT_VOID | payroll.pay | record_host_payout_multi (existing enhanced in A3) | No VAT |
| Host payout (future, overpayment excess becomes receivable) | Payroll Payable Y, payout X > Y, payroll.pay | Payroll Payable 2300 Y + Staff Advances & Receivables 1150 (X-Y) | Treasury X | HOST_PAYOUT + STAFF_RECEIVABLE_RECOGNITION | event_id nullable, staff_member_id, payout_id | HOST_PAYOUT_VOID | payroll.pay | record_host_payout_multi (A3) | Excess becomes receivable asset, MUST NOT create negative payable. Invariant payroll_payable>=0, staff_receivable>=0 |
| Host payout void | Payout RECORDED, reason, payroll.pay | Treasury X | Payroll Payable Y + Staff Advances & Receivables (X-Y) if overpayment case | HOST_PAYOUT_VOID | staff_member_id, payout_id | — | payroll.pay | void_host_payout | No VAT |
| Purchase order | Supplier exists, lines>0, procurement.manage | NO JOURNAL ENTRY | NO JOURNAL ENTRY | — | procurement_order_id, event_id optional | — | procurement.manage | create_procurement_order (existing) | No VAT |
| Goods receipt | PO CONFIRMED/PARTIALLY_RECEIVED, qty>0, warehouse.dispatch or procurement.manage | NO JOURNAL ENTRY (operational only) — future if inventory asset: Dr Inventory Asset Cr GRNI | NO JOURNAL ENTRY | — | procurement_order_id, receipt_id | — | procurement.manage / warehouse.dispatch | receive_procurement_order (existing) | No VAT |
| Supplier invoice (direct event cost) | PO exists, receipt exists for CONSUMABLE (if required), qty<=received and <=ordered, price exact match or owner override, procurement.manage | Procurement Cost 5100 net | Accounts Payable 2200 gross (or net+VAT if input VAT tracked) | SUPPLIER_INVOICE | procurement_order_id, supplier_id, event_id optional, invoice_id | SUPPLIER_INVOICE_VOID | procurement.manage | create_supplier_invoice (future C) | Input VAT deferred, reserve 1155 |
| Supplier invoice void | Invoice ISSUED, reason, procurement.manage, no payment allocation or allocation reversed | Accounts Payable 2200 | Procurement Cost 5100 | SUPPLIER_INVOICE_VOID | supplier_id, invoice_id | — | procurement.manage | void_supplier_invoice (future) | No VAT |
| Supplier payment | AP balance>0, amount>0, treasury_account_id active, finance.manage | Accounts Payable 2200 | Treasury | SUPPLIER_PAYMENT | supplier_id, payment_id, invoice_id via allocation | SUPPLIER_PAYMENT_VOID | finance.manage | record_supplier_payment (future C) | No VAT |
| Supplier payment void | Payment RECORDED, reason, finance.manage | Treasury | Accounts Payable 2200 | SUPPLIER_PAYMENT_VOID | supplier_id, payment_id | — | finance.manage | void_supplier_payment (future) | No VAT |
| Treasury transfer | From and to treasury accounts exist active same org, amount>0, from balance>=amount (no negative), finance.manage | Destination Treasury (e.g., 1011 Bank) | Source Treasury (e.g., 1001 Cash) | TREASURY_TRANSFER | from_treasury_id, to_treasury_id | reverse transfer | finance.manage | treasury_transfer (future B) | No VAT |
| Equipment loss (damage/lost) | Warehouse reconciliation shows damaged/lost qty>0, valuation>0, event CLOSED, warehouse.reconcile | Damage/Loss Expense 5300 or 5200 | Equipment Asset 1300 — DEFERRED until asset exists, else NO JOURNAL ENTRY operational only | — (deferred) or EVENT_EXPENSE if operational | event_id, equipment_capacity_id | — | warehouse.reconcile | reconcile_event_warehouse (existing) — no journal now, future | No VAT |
| Consumable waste | Waste movement WAREHOUSE_WASTE or WASTE_AT_EVENT, qty>0, consumable.manage or stock.adjust | Direct Event Expense or Waste Expense | Inventory Asset (if adopted) else NO JOURNAL ENTRY operational only | — (deferred) | event_id optional, stock_item_id | — | consumable.manage | waste_consumable_stock (existing) | No VAT |
| Opening balance at cutover | Cutover date chosen, finance.manage, org owner | Treasury / AR / Unbilled Receivable / Staff Advances & Receivables | Opening Balance Equity 3000 OR reverse: Opening Equity Dr Deposits/Deferred/VAT/AP/Payroll Payable | OPENING_BALANCE | org_id, treasury_id etc | reverse opening | finance.manage | opening_balance_journal (future B internal) | Treasury owner-provided, AR/deposits/contract asset deterministic, VAT Payable owner-provided, payroll payable/receivable deterministic net, AP zero unless legacy, Opening Equity balancing, historical P&L not replayed |

If intentionally NO JOURNAL ENTRY, stated explicitly.

## 16. Historical Cutover Policy (Corrected with Deterministic Algorithm)

**Context:** Application already has historical customer_payments, invoices, event_expenses, procurement, attendance earnings, staff_advances, host_payouts, event_financial_closures before ledger exists. No customer_payment_allocations table yet, payments are event-linked.

**Strategies evaluated:**

**Strategy A — Deterministic Historical Backfill:** Generate accounting journals from existing canonical historical facts. Requirements: deterministic, idempotent, reconcilable, no invented facts, all totals reconcile to current read models, safe to rerun, no duplicate journals, clear rules for historical records lacking treasury-account attribution. Pros: full audit trail in ledger. Cons: historical payments lack treasury_account_id, so would need to invent treasury account violating no invented facts. Also historical payments lack VAT split and fingerprint.

**Strategy B — Cutover with Opening Balances:** Choose cutover timestamp/date. Historical business facts remain in existing ledgers. Create opening balances for treasury, AR, customer deposits, contract asset, deferred revenue, VAT Payable, AP, payroll payable, staff advances & receivables, other required accounts. New business activity posts to journal from cutover forward. Must clearly prevent dashboards from pretending pre-cutover journal history exists (ledger queries filter entry_date >= cutover). Pros: no invented facts, safe to rerun, no need to guess treasury attribution, existing read models remain canonical for pre-cutover period. Cons: ledger does not contain full history, need two sources for historical reporting until backfill optionally done later.

**Strategy C — Conditional Strategy:** If real production database contains no material financial history, full clean ledger start may be possible (opening balances zero). If meaningful production history, choose backfill or opening balances. Define recommended default, define exact preflight query/report needed before implementation, define what result selects Backfill vs Opening Balance.

**Required decision: One recommended cutover policy, not unresolved.**

**Recommendation: Strategy B — Cutover with Opening Balances as default, with conditional check via preflight, corrected to be executable from currently existing canonical data (no allocation table dependency).**

Why: Historical records lack treasury_account_id and VAT split, so backfill would require inventing facts violating no invented facts. Existing operational tables already have idempotency and audit, canonical for pre-cutover. Safer, idempotent, no duplicate. If production has no material history (counts zero), opening balances zero = clean start, equivalent to Strategy C clean start. Only if treasury attribution can be reconstructed and owner explicitly approves, backfill could be considered, but default is opening balances.

**Preflight query/report needed before implementation (to be run on production replica, not in this session):**

```sql
-- Preflight for cutover decision (existing canonical data only)
SELECT
  (SELECT COUNT(*) FROM customer_payments WHERE status='RECORDED') AS customer_payments_count,
  (SELECT COALESCE(SUM(amount),0) FROM customer_payments WHERE status='RECORDED') AS customer_payments_sum,
  (SELECT COUNT(*) FROM invoices WHERE status='ISSUED') AS invoices_count,
  (SELECT COALESCE(SUM(total_amount),0) FROM invoices WHERE status='ISSUED') AS invoices_sum,
  (SELECT COUNT(*) FROM event_expenses WHERE status='RECORDED') AS expenses_count,
  (SELECT COALESCE(SUM(amount),0) FROM event_expenses WHERE status='RECORDED') AS expenses_sum,
  (SELECT COUNT(*) FROM staff_attendance WHERE status<>'VOIDED') AS attendance_count,
  (SELECT COALESCE(SUM(earned_amount),0) FROM staff_attendance WHERE status<>'VOIDED') AS earned_sum,
  (SELECT COUNT(*) FROM staff_advances WHERE status='RECORDED') AS advances_count,
  (SELECT COALESCE(SUM(amount),0) FROM staff_advances WHERE status='RECORDED') AS advances_sum,
  (SELECT COUNT(*) FROM host_payouts WHERE status='RECORDED') AS payouts_count,
  (SELECT COALESCE(SUM(amount),0) FROM host_payouts WHERE status='RECORDED') AS payouts_sum,
  (SELECT COUNT(*) FROM procurement_orders WHERE status<>'DRAFT' AND status<>'CANCELLED') AS procurement_count,
  (SELECT COUNT(*) FROM event_financial_closures WHERE reopened_at IS NULL) AS active_closures_count,
  (SELECT COUNT(*) FROM events WHERE status='CLOSED') AS closed_events_count,
  (SELECT COUNT(*) FROM events WHERE status='CLOSED' AND id NOT IN (SELECT event_id FROM invoices WHERE status='ISSUED')) AS closed_without_invoice_count,
  (SELECT COUNT(*) FROM organization_settings WHERE vat_registered=true) AS vat_registered_orgs;
```

**Decision logic:**
- If all counts =0 and sums =0 → no material financial history → clean start, opening balances zero, cutover date = now, ledger starts empty.
- If counts >0 but treasury attribution missing → Opening Balances (default).
- If owner can reconstruct treasury attribution for historical payments and explicitly approves backfill, then Backfill deterministic idempotent safe to rerun could be considered, but must still handle VAT and Contract Asset.

**Default:** Opening Balances with owner-provided treasury opening balances and owner/accountant-provided VAT Payable opening, system-calculated AR/Deposits/Contract Asset/Deferred/Payroll Payable/Staff Receivable from existing tables at cutover timestamp.

**Prevent dashboards pretending pre-cutover journal history exists:** Ledger queries filter entry_date >= cutover_date, dashboard shows note "Accounting ledger starts from <cutover_date>, historical totals from operational ledgers". Or flag is_opening_balance.

**Opening balances required for and deterministic formulas (Correction Three + Four):**

**Customer Cutover Algorithm — deterministic using existing canonical records only, no fake allocations:**

For each event as of cutover timestamp, let:

- I_gross = active ISSUED invoice total_amount (VAT-inclusive) if exists and event not CANCELLED and invoice not CANCELLED, else NULL
- I_net = invoice pre_vat_total if I exists, else NULL
- I_vat = invoice vat_amount if I exists, else NULL
- P_gross = total RECORDED customer payments for event where paid_at < cutover and status RECORDED (gross)
- Q_gross = accepted_revenue (or quotation total_selling) gross for event if accepted_quotation_id exists and event not CANCELLED, else 0
- Q_net = quotation pre_vat_total if exists, else Q_gross
- Q_vat = quotation vat_amount if exists, else 0
- Event status = DRAFT/QUOTED/CONFIRMED/PREPARING/DISPATCHED/IN_PROGRESS/RETURNING/CLOSED/CANCELLED

**Case 1 — Active invoice exists (I_gross NOT NULL):**

Let historically_applied_gross = min(P_gross, I_gross) — deterministic historical allocation baseline, not per-payment allocation history.
Opening AR gross = max(I_gross - P_gross, 0)
Opening Customer Deposit gross = max(P_gross - I_gross, 0)

For VAT-registered orgs, split gross into net and VAT for opening VAT Payable handling:
- Opening AR net = opening_AR_gross * (I_net / I_gross) if I_gross>0 else 0, or more precisely opening_AR_gross - VAT portion. For simplicity, opening AR net = max(I_net - (P_gross * I_net / I_gross), 0) if using proportional, but to avoid inventing VAT split for payments without snapshot, we will keep opening AR gross and opening Deposit gross as gross amounts, and opening VAT Payable owner-provided. For non-VAT orgs, gross=net.

Deterministic, no fake per-payment allocations.

**Case 2 — No active invoice and event not CLOSED (status != CLOSED, != CANCELLED):**

All historical received cash remains customer deposit, no AR, no revenue.

Opening AR gross = 0
Opening Customer Deposit gross = P_gross
Opening Deferred = 0
Opening Contract Asset =0
No accounting revenue.

**Case 3 — Event CLOSED but no invoice (Contract Asset case):**

Resolve consistently with Correction One (Contract Asset 1120).

Let Q_gross = accepted_revenue gross (or quotation total_selling) for CLOSED event.
Let P_gross = sum RECORDED payments for event before cutover.

Opening Contract Asset gross = max(Q_gross - P_gross, 0) — remaining unbilled amount to be invoiced.
Opening Customer Deposit gross = max(P_gross - Q_gross, 0) — overpayment remains deposit (or refund liability).
Opening AR gross =0 (no invoice)
Opening Deferred =0 (no invoice, service already earned)
Historical earned revenue Q_gross remains in historical operational reports, NOT recreated as current-period P&L. Opening Contract Asset represents asset, Opening Equity balances it. Do not contaminate post-cutover current-year performance with opening historical activity.

If VAT-registered, Q_net and Q_vat from quotation snapshot, P_gross split into net and VAT via proportional? But for opening, keep gross and owner-provided VAT Payable. Contract Asset gross = net+VAT.

**Case 4 — Cancelled / voided documents:**

Explicitly define exclusion:

- CANCELLED invoice: status CANCELLED → I_gross = NULL (excluded, does not contribute to opening AR)
- VOIDED payment: status VOIDED → excluded from P_gross (only RECORDED counts)
- CANCELLED event: status CANCELLED → Q_gross =0, P_gross excluded? Actually payments for cancelled event should be excluded or treated as deposit refund? For simplicity, cancelled events contribute 0 to opening AR/Contract Asset/Deferred, and their payments if RECORDED and not refunded remain as Customer Deposit gross (liability to refund) unless owner says refunded. Document as: CANCELLED event → opening AR 0, Contract Asset 0, Deferred 0, Customer Deposit = P_gross (if payments exist, remains liability to refund).

Only canonical live financial facts should contribute: invoices ISSUED, payments RECORDED, events not CANCELLED (except deposit for cancelled events remains liability).

**Historical Allocation Boundary:**

Do NOT retroactively create fake customer_payment_allocations rows pretending operator historically allocated payments when they did not. At cutover:

- Derive deterministic opening accounting balances using formulas above (min/max), preserve old operational history unchanged.
- After cutover, future allocations become explicit accounting facts via `customer_payment_allocations` table (to be created in A2).

Document distinction: Opening position only needs deterministic cutover state, not per-payment invoice allocation history.

**Payroll Cutover Algorithm — deterministic net host position (Correction Four):**

For each staff member (or per org for opening), as of cutover timestamp:

E = sum(earned_amount) filter (status <> VOIDED) where attendance date < cutover (or created_at < cutover)
A = sum(staff_advances amount where status RECORDED and advance date < cutover)
P = sum(host_payouts direct + allocations) where status RECORDED and payout date < cutover
N = E - A - P = late_total (can be negative)

Opening:

If N >=0:
- Opening Payroll Payable = N
- Opening Staff Advances & Receivables =0

If N <0:
- Opening Payroll Payable =0
- Opening Staff Advances & Receivables = abs(N) = A + P - E

Historical advances considered already economically applied to extent necessary to reproduce current system. One-time deterministic cutover transformation.

For per-event opening payroll payable, use host_event_payroll_summaries logic: earned_total per event, payouts_total per event (direct+allocations), advances_total 0 per-event view. So per-event opening payable = max(earned_total - payouts_total, 0) and per-event opening receivable = max(payouts_total - earned_total, 0) ??? But host-wide advances are not per-event. For simplicity, opening payroll payable per event = max(earned - payouts, 0), and host-wide opening receivable includes advances + overpayments. Document exact.

**Treasury Opening:**

Source current tables: NONE (existing payments lack treasury_account_id). Therefore treasury opening balances MUST be owner-provided per treasury account (e.g., Main Cashbox 1000 OMR, Bank Muscat 5000 OMR) via UI, not derived. System creates opening journals Dr Treasury Cr Opening Balance Equity for each account.

**Deferred Revenue Opening:**

Source: invoices where status ISSUED and event status != CLOSED and event not CANCELLED. For each such invoice, deferred net = I_net (full net) for VAT-registered, or I_gross for non-VAT. Sum per org = opening Deferred Revenue.

**Contract Asset Opening:**

Source: events where status CLOSED and no active invoice and not CANCELLED. For each, Contract Asset gross = max(Q_gross - P_gross, 0) as defined in Case 3. Sum per org = opening Contract Asset.

**VAT Payable Opening:**

Source: NOT safely derivable from existing history alone because historical payments lack VAT snapshot and tax point not tracked. Therefore owner/accountant MUST provide opening VAT Payable via preflight review of historical VAT returns. For non-VAT orgs, 0. For VAT-registered orgs, if owner cannot provide, MUST require tax cutover review before A2. Never invent tax balance. Document as required production-input.

**AP Opening:**

Zero before supplier-invoice subsystem unless real legacy AP exists (none currently). So opening AP 0.

**Opening Equity:**

Balancing amount: Opening Equity = (Treasury + AR + Contract Asset + Staff Advances & Receivables) - (Customer Deposits + Deferred + VAT Payable + AP + Payroll Payable). Historical P&L (earned revenue, expenses, payroll cost, procurement cost) remain in historical operational reports rather than being recreated as current-period P&L under Strategy B. Opening Equity represents net financial position at cutover, not current-year profit.

**Existing closure snapshots:** Do not rewrite historical `event_financial_closures` rows. Historical closures remain authoritative snapshots for pre-ledger periods. If backfilling, reconciliation required within 0.001 OMR tolerance. If opening balances, historical closures remain as is, new closures after cutover ledger-backed.

## 17. Reconciliation Contract (Corrected)

Before implementation, define how we will prove new ledger agrees with existing product truths.

**Stage 1:** Existing business tables remain canonical domain facts. Ledger posts synchronously in same transaction.

**Stage 2:** Reconcile ledger totals against existing views:

- Customer payments gross: Σ journal_lines where account = Treasury and source_type = CUSTOMER_PAYMENT per org must equal Σ customer_payments RECORDED amount per org (exact, 0.001 tolerance). Treasury breakdown per treasury account must sum to total after cutover (before cutover, treasury not tracked, so only post-cutover reconciles).
- Customer outstanding commercial vs accounting AR + Contract Asset + Deposits: Existing outstanding_balance = accepted_revenue − amount_paid (commercial). Accounting: For events with invoice, AR gross = max(I_gross - P_gross,0), Deposits gross = max(P_gross - I_gross,0). For CLOSED without invoice, Contract Asset gross = max(Q_gross - P_gross,0), Deposits gross = max(P_gross - Q_gross,0). Commercial outstanding should equal accounting AR + Contract Asset - Deposits? Let's verify: Q_gross = accepted_revenue. If invoice exists I_gross = Q_gross typically, then AR = max(Q-P,0), Deposit = max(P-Q,0), Contract Asset 0, so AR - Deposit = Q-P = outstanding. If CLOSED without invoice, Contract Asset = max(Q-P,0), Deposit = max(P-Q,0), AR 0, so Contract Asset - Deposit = Q-P = outstanding. So equation: outstanding = (AR + Contract Asset) - Deposits. Should reconcile exactly.
- Invoice outstanding: invoice_summaries remaining_balance derived from payments ledger. Accounting AR outstanding per invoice = invoice total − sum allocations (deterministic min/max at cutover, explicit allocations after). Should reconcile exactly if allocation logic matches existing derivation (single invoice per event).
- Event expenses: Σ event_expenses RECORDED per event must equal Σ journal_lines where account = Direct Event Expense and source_type = EVENT_EXPENSE per event, exact.
- Staff earned amount: Σ staff_attendance earned_amount non-VOIDED per event must equal Σ journal_lines where account = Staff Cost and source_type = HOST_EARNING per event, exact (post-cutover, plus opening balances).
- Staff payouts: Σ host_payouts RECORDED per staff must equal Σ journal_lines where account = Payroll Payable debit and source_type = HOST_PAYOUT (plus receivable portion for overpayments), exact.
- Staff advances: Σ staff_advances RECORDED per staff must equal Σ journal_lines where account = Staff Advances & Receivables Asset debit for advance portion, exact, but note cutover netting: opening Staff Receivable = abs(N) includes advances+overpayments, so historical advances considered already applied.
- Procurement costs: event_procurement_cost_summaries active_committed_cost / delivered_cost derived from procurement orders. Accounting Procurement Cost = Σ supplier_invoices (future) for event. For now before supplier invoices, procurement cost remains operational only, no ledger yet.
- Event profitability: event_finance_summaries accepted_revenue, amount_paid, outstanding, staff_cost, procurement_cost, expense_cost, actual_cost, actual_profit, margin_percent. Accounting recognized_revenue net may differ from accepted_revenue gross until CLOSED and VAT handling, but at CLOSED, recognized_revenue net should equal pre_vat_total (if VAT-registered) or accepted_revenue (if non-VAT). Actual_cost accounting = staff_cost + procurement_cost (from supplier invoices when available, else from procurement orders) + expense_cost should reconcile exactly to existing actual_cost if supplier invoices not yet introduced.

**Which values reconcile exactly vs intentionally different:**
- Exact: customer payments total (post-cutover), event expenses total, staff earned total, staff payouts total (with receivable handling), invoice total, treasury total if opening correct, outstanding commercial vs accounting (AR+Contract Asset-Deposits) exact.
- Intentionally different: accepted_revenue gross (commercial VAT-inclusive) vs recognized_revenue net (accounting net) for VAT-registered orgs until CLOSED, procurement committed cost vs invoiced cost until supplier invoices.

**Reconciliation reports to build in Stage 2:**
- reconciliation_customer_payments(org) — operational vs ledger
- reconciliation_customer_outstanding(org) — commercial outstanding vs AR+Contract Asset-Deposits
- reconciliation_event_expenses(org)
- reconciliation_staff_earnings(org)
- reconciliation_staff_payable_receivable(org) — E,A,P,N vs opening payable/receivable
- reconciliation_invoices(org)
- reconciliation_treasury(org) — treasury balances derived vs expected from opening + movements
- reconciliation_contract_asset(org) — Q-P vs Contract Asset
- reconciliation_closure_snapshots(org) — old closures vs ledger at closure time
- reconciliation_vat_payable(org) — owner-provided opening vs derived VAT from new transactions post-cutover

## 18. Financial Closure Contract (Rechecked)

**Current financial closure requires customer outstanding to be settled (outstanding_balance<=0).**

**Default proposed rule validated against domain:**

- **May block event financial close:**
  - Operational event must be CLOSED (status CLOSED)
  - Commercial customer outstanding must satisfy existing rule: accepted_revenue>0 AND outstanding_balance<=0 (or accounting equivalent (AR+Contract Asset)-Deposits <=0)
  - Accounting revenue recognition must have completed: Deferred Revenue MUST be 0 for event, Contract Asset MUST be 0 or reclassified to AR? Actually if event CLOSED without invoice, Contract Asset exists, revenue recognized, but AR not yet created. Should financial close require invoice? For customer AR readiness, if Contract Asset exists (earned but not invoiced), does that block financial close? Existing rule requires outstanding_balance<=0, which for CLOSED without invoice and no payments would be outstanding = Q_gross >0, so would block close. But if payments cover full Q_gross, outstanding 0, Contract Asset 0, Deposits 0? Let's think: CLOSED without invoice, no payments: Q_gross=2100, P=0, Contract Asset=2100, outstanding=2100, so would block close (since outstanding>0). That's correct, because customer hasn't paid. If CLOSED without invoice, with full payment 2100: Q=2100 P=2100, Contract Asset 0, Deposit 0, outstanding 0, so would allow close even without invoice? Should financial close require invoice? For customer AR readiness, if no invoice, but payment received, outstanding 0, should allow close? Probably yes, because commercial outstanding satisfied. Accounting revenue recognition completed (Contract Asset→Revenue done). So financial close may be allowed without invoice if outstanding 0 and revenue recognized. Document as: financial close requires (AR+Contract Asset)-Deposits <=0 and revenue recognized (Deferred=0 and (Contract Asset=0 or reclassified? Actually Contract Asset is asset, not liability, so if Contract Asset>0, that means earned but not invoiced and not paid? That would be outstanding? Let's define: financial close requires no unresolved customer accounting state that would make closure snapshot invalid: AR outstanding MUST be 0, Contract Asset MUST be 0 (all earned amounts invoiced or paid? Actually if CLOSED without invoice but fully paid, Contract Asset 0, so ok. If CLOSED without invoice and not paid, Contract Asset>0, that is unresolved customer accounting state (earned but not invoiced and not paid), should block close? Existing commercial outstanding would block anyway (outstanding>0). So Contract Asset>0 implies outstanding>0, so blocked. If CLOSED without invoice and fully paid, Contract Asset 0, outstanding 0, allow close. So invoice not strictly required for close if fully paid, but if partially paid, Contract Asset>0 blocks.

  - No unresolved customer accounting state that would make closure snapshot invalid: AR MUST be 0, Contract Asset MUST be 0, Customer Deposits MUST be 0? Actually deposits after CLOSED should be 0 if revenue recognized? If deposit exists and revenue recognized, deposits should have been reclassified to revenue at CLOSED (Dr Deposits Cr Revenue). So after CLOSED, deposits should be 0. So financial close requires Deposits 0 as well.

- **Must NOT automatically block financial close:**
  - Unpaid supplier AP — MUST NOT block, liability may settle after event completion.
  - Unpaid Payroll Payable — MUST NOT block, liability may settle after event completion.

Those are liabilities and may settle after event completion.

**Liability Settlement After Close — deterministic future rule:**

Paying an already recognized liability after financial close MUST remain allowed:

- supplier payment (Dr AP Cr Treasury) provided underlying supplier invoice existed before financial close (check supplier_invoice.created_at < closure.closed_at and supplier_invoice.event_id = closed event, or supplier_invoice linked to event via procurement order)
- host payout (Dr Payroll Payable Cr Treasury, plus receivable portion if overpayment) provided underlying earning/attendance existed before financial close (check staff_attendance.created_at < closure.closed_at and attendance.event_id = closed event)
- staff advance settlement (Dr Payroll Payable Cr Staff Advances & Receivables) provided underlying payable/advance existed before close

Do NOT rely solely on created_at if better immutable source relation exists. For supplier invoices, use procurement_order_id linkage and invoice created_at. For payroll, use attendance date and payout allocation event_id. Document how future code can prove settlement does not create new event economics: settlement must reference existing payable/earning/invoice that existed before close, not create new cost. New cost creation (new attendance, new expense, new supplier invoice linked to closed event) MUST be blocked.

**Implementation:** guard_event_financially_closed() currently blocks INSERT/UPDATE/DELETE on customer_payments, host_payouts, staff_attendance, event_expenses. For new tables, add similar triggers but with distinction: for supplier_invoices, block INSERT if event has active closure (cost creation). For supplier_payments and host_payouts and staff_advance_settlement, allow if corresponding invoice/payable existed before closure (check created_at < closure closed_at). Requires storing payable creation time and checking.

For A0, document distinction, and for A1 foundation, keep existing guard as is (blocks all), but for future tranches, implement nuanced guard.

**Default rule summary:**
- Customer AR readiness blocks financial close: (AR+Contract Asset)-Deposits MUST be 0, Deferred MUST be 0, Contract Asset MUST be 0 (which implies outstanding 0)
- Supplier AP does NOT block close, but snapshotted and reported
- Payroll Payable does NOT block close, but snapshotted
- Deferred revenue MUST be 0 (revenue recognized) before close
- Warehouse/consumable reconciliation already blocks operational CLOSED, thus indirectly blocks financial close if we require CLOSED
- After financial close, cost creation blocked (customer payments, invoices, expenses, attendance, supplier invoices linked to event), liability settlement of pre-close recognized amounts allowed (supplier payments, host payouts, advance settlements) provided underlying payable/earning/invoice existed before close.

## 19. Existing Closure Snapshots and Historical Records

- Do NOT rewrite historical closure rows. event_financial_closures is append-only cycle history, not boolean. Each row closure episode, reopen sets reopened_at/by/reason never erases previous close. Current financially closed iff row with reopened_at IS NULL, partial unique index ensures at most one active per event.
- Historical closures remain authoritative snapshots for pre-ledger periods. They capture revenue_at_close, collected_at_close, outstanding_at_close, costs_at_close, profit_at_close, margin_at_close from event_finance_summaries at close time.
- If backfilling: Reconciliation requirement — backfilled ledger totals at closure time (entry_date <= closed_at) must match closure snapshot within 0.001 OMR tolerance for revenue, collected, outstanding, costs, profit, margin. If mismatch, flag and require owner review. Backfill must be deterministic and idempotent, safe to rerun, no duplicate journals (unique org+idempotency_key).
- If opening balances (recommended): Historical closures remain as is, no reconciliation needed for pre-cutover. New closures after cutover will have enhanced snapshot including treasury breakdown, supplier liabilities, contract asset, VAT Payable, and will be ledger-backed (snapshot from ledger balances at close time).

## 20. Compatibility Strategy

**Ledger must initially be accounting projection integrated transactionally with existing business facts, not immediate destructive replacement for every existing read model.**

**Stage 1:** Existing business tables remain canonical domain facts (customer_payments, invoices, event_expenses, staff_attendance, staff_advances, host_payouts, procurement_orders, etc). Ledger posts synchronously in same transaction via internal_post_journal called by business RPCs. If ledger posting fails, business mutation fails too (atomic). Existing views (event_finance_summaries, etc) remain unchanged.

**Stage 2:** Reconcile ledger totals against existing views via reconciliation reports (see §17). Prove exact match for payments, expenses, earnings, payouts, advances, invoices, treasury, outstanding, contract asset.

**Stage 3:** Introduce accounting-specific read models: account_balance, account_raw_balance, journal_history, treasury_balances, ar_aging, ap_aging, customer_statement enhanced with allocation, supplier_statement, staff_payable, contract_asset aging, etc., gated by cost.visibility/finance.manage.

**Stage 4:** Only replace existing financial derivations when equivalence proven and product semantics require it. For example, event_finance_summaries.accepted_revenue remains commercial_value (VAT-inclusive) for backward compatibility, but new field recognized_revenue (net) from ledger could be added. Do not rewrite event_finance_summaries in Tranche A unless strictly necessary. Keep backward compatibility for customer 360, event workspace, financial closure, management metrics, office documents, tests.

**Explicit compatibility contract:**
- event_finance_summaries.accepted_revenue remains commercial value (accepted quotation total_selling VAT-inclusive), not redefined as accounting recognized revenue. For backward compat, keep name, but document as commercial_value.
- Future accounting read models require separate fields: commercial_value (existing accepted_revenue), commercial_pre_vat (pre_vat_total), recognized_revenue (from ledger, net, at CLOSED), invoiced_amount_gross, invoiced_amount_net, vat_amount, collected_amount_gross, customer_deposits_net/gross, accounts_receivable_gross, unbilled_receivable_gross, vat_payable.
- Existing frontend that consumes accepted_revenue continues working unchanged.
- New accounting fields added as new columns or new views, not renaming old.
- Office documents (customer_statement, etc) continue using existing functions until accounting-enhanced versions proven.
- Tests that pin existing behavior remain green.

## 21. Required Account Balance Equations (Corrected with MUST semantics)

Define accounting equations system MUST be able to prove via pgTAP invariants:

- **Treasury Balance (per treasury account):** Treasury Balance = Opening Treasury (from OPENING_BALANCE journals) + Σ Treasury Debits (customer payments, supplier payment voids, etc) − Σ Treasury Credits (event expenses, host payouts, staff advances, supplier payments, treasury transfers out). Equation: `treasury_balance = opening + debits − credits`. **MUST** never go negative for CASH (and initially for BANK) if positive_only guard. **MUST** be derived from journal lines, no cached balance column authoritative.

- **Customer AR (per customer, per event, per invoice):** Customer AR gross = Invoiced AR gross (Σ INVOICE journals Dr AR gross) − Payment Allocations gross/net (Σ CUSTOMER_PAYMENT after invoice and CUSTOMER_DEPOSIT_APPLIED journals Cr AR) − Credit/Reversal Adjustments (Σ INVOICE_VOID and CUSTOMER_PAYMENT_VOID reclassifications). Unapplied payments remain Customer Deposits, not negative AR. Invariant: **AR balance MUST be >=0** per invoice, per customer, per org. **MUST NOT** be negative (no negative AR artifact). For VAT-registered, AR gross includes VAT, AR net = AR gross - VAT portion, but AR gross invariant >=0.

- **Contract Asset / Unbilled Receivable (per event):** Contract Asset gross = Earned but not invoiced (Σ UNBILLED_RECOGNITION Dr Unbilled gross) − Reclassified to AR (Σ CONTRACT_ASSET_RECLASSIFICATION Cr Unbilled gross) − Reversals. Invariant: **Contract Asset MUST be >=0**. **MUST** be 0 after invoice reclassification. At CLOSED without invoice, Contract Asset = max(Q_gross - P_gross, 0).

- **Customer Deposits (per customer, per event):** Customer Deposits net (VAT-registered) or gross (non-VAT) = Unapplied Customer Payments gross/net (Σ CUSTOMER_PAYMENT before invoice Dr Treasury Cr Deposits) + Σ payment voids that become deposits + Σ invoice voids that reclassify allocated payments to deposits − Σ deposit allocations to AR (CUSTOMER_DEPOSIT_APPLIED) − Σ deposits reclassified to Revenue at CLOSED (Dr Deposits Cr Revenue). Equation: `deposits = unapplied_payments + overpayments - applied - recognized`. Invariant: **Deposits MUST be >=0**. **MUST NOT** be negative. After CLOSED, Deposits MUST be 0 (all recognized to revenue).

- **Deferred Revenue (per event):** Deferred Revenue net = Invoiced net amount where service not yet earned (Σ INVOICE Dr AR Cr Deferred net) − Recognized amount (Σ REVENUE_RECOGNITION Dr Deferred Cr Revenue net). At CLOSED, **Deferred MUST be 0**. Invariant: **Deferred MUST be >=0**.

- **VAT Payable (per org):** VAT Payable = Output VAT from customer deposits (Σ CUSTOMER_PAYMENT before invoice Cr VAT Payable VAT) + Output VAT from invoices (Σ INVOICE Cr VAT Payable remaining VAT) + Output VAT from unbilled recognition (Σ UNBILLED_RECOGNITION Cr VAT Payable VAT) − VAT reversals from voids/refunds (Σ INVOICE_VOID Dr VAT Payable VAT, Σ CUSTOMER_PAYMENT_VOID Dr VAT Payable VAT). Equation: `vat_payable = vat_on_deposits + vat_on_invoices + vat_on_unbilled - vat_reversals`. Invariant: **VAT Payable MUST be >=0**. **MUST NOT** be negative. **MUST NOT** enter Event Revenue. **MUST** be recognized at tax point per Oman law (earlier of payment/invoice/completion). Opening VAT Payable MUST be owner/accountant provided, never invented.

- **Event Revenue (per event):** Recognized Revenue net = Σ REVENUE_RECOGNITION Cr Revenue net + Σ UNBILLED_RECOGNITION Cr Revenue net (portion from deposits and unbilled). At CLOSED, **recognized_revenue net MUST equal pre_vat_total** (if VAT-registered) or **accepted_revenue** (if non-VAT) for full recognition. Invariant: **Revenue MUST be net only, MUST NOT include VAT**. For VAT-registered orgs, revenue = consideration excluding VAT. For non-VAT orgs, revenue = full consideration.

- **Payroll Payable (per staff, per event, per org):** Payroll Payable = Earned Payroll (Σ HOST_EARNING Dr Staff Cost Cr Payable) − Settled Advances (Σ STAFF_ADVANCE_SETTLEMENT Dr Payable Cr Advance) − Payouts (Σ HOST_PAYOUT Dr Payable Cr Treasury, up to payable balance). Equation: `payable = earned − advances_settled − payouts_capped`. Invariant: **Payroll Payable MUST be >=0**. **MUST NOT** be negative. Future payout exceeding payable creates Staff Receivable, not negative payable.

- **Staff Advances & Receivables Asset (per staff):** Staff Advances & Receivables = Advances issued (Σ STAFF_ADVANCE Dr Advance Cr Treasury) − Advances settled (Σ SETTLEMENT Dr Payable Cr Advance) + Overpayment receivable (Σ HOST_PAYOUT excess Dr Receivable Cr Treasury) − Advance voids − Receivable settlements. Equation: `advances_receivable = issued − settled + overpayment_excess`. Invariant: **MUST be >=0**. Represents asset receivable from staff.

- **Supplier AP (per supplier, per event, per invoice):** Supplier AP = Supplier Invoices (Σ SUPPLIER_INVOICE Dr Cost Cr AP) − Supplier Payments (Σ SUPPLIER_PAYMENT Dr AP Cr Treasury) − Reversals. Equation: `ap = invoices − payments`. Invariant: **AP MUST be >=0** per invoice.

- **Procurement Cost (per event):** Procurement Cost = Σ SUPPLIER_INVOICE Dr Procurement Cost (if direct event cost) OR from operational procurement cost summaries until supplier invoices introduced. Should reconcile.

- **Event Expense (per event):** Event Expense = Σ EVENT_EXPENSE Dr Expense Cr Treasury, exact match to event_expenses table.

- **Accounting Equation (Trial Balance):** For every org, SUM(debits) MUST equal SUM(credits) across all journal_entries. Assets (Treasury + AR + Unbilled Receivable + Staff Advances & Receivables + Inventory if adopted) = Liabilities (Customer Deposits + Deferred Revenue + VAT Payable + AP + Payroll Payable + GRNI) + Equity (Opening Balance Equity + Retained Earnings) + (Revenue − Expenses). For trial balance, sum debits = sum credits. **MUST** hold at all times, enforced by DEFERRABLE CONSTRAINT TRIGGER on journal_lines.

These become future pgTAP invariants: trial balance zero, no negative AR, no negative Deposits, no negative Cash, no negative Contract Asset, no negative Deferred, no negative VAT Payable, no negative Payroll Payable, no negative Staff Receivable, no negative AP, VAT never in Revenue, etc.

## 22. Tax / VAT Boundary (Corrected with Oman VAT Research)

**Existing VAT contract:** Migration 0077 optional VAT per organization, snapshotted onto issued quotation/invoice at issue time, never recalculated. Org settings vat_registered bool default false, vat_percent numeric(12,3) default 5.000, vat_registration_number text. Quotation/invoice have pre_vat_total, vat_registered, vat_percent, vat_amount, vat_registration_number. Money rule: total = pre_vat + round(pre_vat×vat_percent/100,3). For VAT-registered org, total_selling and total_amount become VAT-INCLUSIVE final total. VAT-disabled orgs snapshot 0.

**Prior A0 said VAT accounting deferred and temporarily treats VAT-inclusive totals as accounting Revenue. That is NOT acceptable for formal accounting ledger. VAT collected from customers is NOT business revenue. Corrected.**

**Mandatory Oman VAT Research — Primary Official Sources:**

Primary authority: **Oman Tax Authority (OTA) — taxoman.gov.om / tms.taxoman.gov.om**

Sources relied upon (titles):

- **Sultanate of Oman Tax Authority Value Added Tax Law** (VAT Law PDF, taxoman.gov.om portal, Articles 26, 27, 30)
- **VAT Executive Regulations** (Executive Regulations PDF, taxoman.gov.om)
- **VAT Taxpayer Guide Real Estate Version 1 - August 2021** (tms.taxoman.gov.om) — Section 9.3 Tax Due Date, 11.1 Date of supply
- **VAT Taxpayer Guide Financial Services Sector April 2022 - English** (tms.taxoman.gov.om) — Section 7.1 Tax Due Date, 7.2 Charging VAT, 7.3 Issuing invoices
- **VAT Taxpayer Guide Health Care** (tms.taxoman.gov.om) — Section 6.2 Identifying Tax Due Date
- **VAT Taxpayer Guide Related Persons Version 1 June 2023** (tms.taxoman.gov.om) — Section 4.3.3 Date of Supply
- **Information Sheet - Oman Tax Authority** (tms.taxoman.gov.om portal) — Place of supply, issuing invoices, output tax
- **VAT Taxpayer Guide VAT Return Filing** (tms.taxoman.gov.om) — VAT return payment/refund

**Rules summarized (not long copied):**

- **Tax point for one-off supply of goods/services (Article 26 VAT Law):** Tax due date is earliest of: (1) date of supply (generally date service completed or goods put at possession of customer), (2) date tax invoice is issued by supplier, (3) date of partial or full receipt of consideration to extent of amount received. From guides: "date of supply (generally the date on which the service is completed or date goods are put at the possession of the customer) / invoice is issued / payment made by customer, within limits of payment (for example a deposit unless it is a refundable security deposit)."
- **Receipt of customer deposit:** Requires VAT charged on deposit amount unless deposit is refundable security deposit. From Financial Services Guide: "This means that a receipt of a customer deposit will require VAT to be charged on the deposit amount, unless the deposit is a refundable security deposit."
- **Tax point when invoice is issued:** If invoice issued before completion or payment, VAT becomes due on earlier date of invoicing rather than completion. Article 30: When person issues invoice recording amount of Tax, Tax due on issuance date.
- **Tax point when advance/customer payment is received:** VAT due on date payment made, to extent of payment. For partial advance payments, VAT due on amount received at receipt date. Article 26: "Date of partial or full receipt of the Consideration and to the extent of the received amount."
- **Continuous supplies with periodic payments/consecutive invoices (Article 27):** Tax due on supplies which entail issuance of invoices or payment in successive manner, on date payment specified in invoice or date of payment, whichever earlier, and at least once every 12 consecutive months. If 12 months passes with none, supply deemed at 12 months expiry. From Real Estate Guide 9.3.2.
- **Treatment of credit/cancellation/refund:** Credit note must adjust output VAT, invoice recording tax triggers tax due, reversal via credit note. From Law and guides.
- **Output VAT obligation timing:** VAT return must include supplies where date of supply within tax period, payment of net tax due by due date of return (30th day following end of tax period). VAT account is audit trail between records and VAT return.
- **Issuance deadline:** Tax invoice must be issued no later than 15 days after event triggering obligation (supply, receipt of advance, month-end for summary invoice). From invoice requirements guide.
- **Taxable value:** Value of consideration without tax, includes all expenses charged, fees, taxes except VAT. From Article 31.

**VAT Posting Contract — Corrected (must distinguish gross customer amount, net service consideration, output VAT liability):**

**Minimum chart addition:**

- **2150 VAT Payable / Output VAT** — system liability account, CREDIT normal, active, purpose: output VAT obligation per Oman tax point rules. MUST >=0. For non-VAT orgs balance 0.
- **Reserve 1155 Input VAT / VAT Receivable** — Asset DEBIT normal, DEFERRED for future supplier accounting, purpose: input VAT from supplier invoices. Not active in A1, but reserve so A1 schema does not make correct VAT integration impossible.

**Customer Advance / Deposit — VAT-registered orgs:**

If Oman VAT rules establish VAT tax point when advance received (they do per Article 26), then customer advance cannot simply be Dr Treasury gross Cr Customer Deposits gross.

Define correct split:

Let gross = amount received (VAT-inclusive)
Let vat_percent = org vat_percent snapshot at receipt time (from organization_settings vat_percent, or from invoice if exists? Use org setting at receipt for advances before invoice, snapshot stored in payment? For A0, define snapshot from org settings at receipt, stored as payment vat_percent? For future A2, payment should snapshot vat_percent like invoice. For now define rule from existing VAT snapshot model and official Oman rules.)

Allocation rule from existing VAT snapshot model: total = pre_vat + round(pre_vat×percent/100,3). To derive net and VAT from gross inclusive, use:

VAT = round(gross × vat_percent / (100 + vat_percent), 3)
Net = gross - VAT

This is mathematically consistent with existing model (for 5% example, gross 1050 → VAT 50, net 1000) and prevents duplication. Use half-away-from-zero rounding to 3 decimals via `assert_payment_omr` logic.

Posting for VAT-registered advance:

Dr Treasury (1000/1010 child) gross
Cr Customer Deposits 2000 net
Cr VAT Payable 2150 VAT

For non-VAT orgs: Dr Treasury gross Cr Customer Deposits gross (net=gross).

Partial payments: same split applied to each partial advance amount.

**Invoice — VAT-registered orgs:**

For VAT-registered organizations, invoice accounting cannot simply be Dr AR Cr Deferred using VAT-inclusive total. Must distinguish net consideration and VAT.

Define:

Let I_net = invoice pre_vat_total (snapshot)
Let I_vat = invoice vat_amount (snapshot)
Let I_gross = I_net + I_vat = total_amount

Let advance VAT already recognized = sum of VAT portions from deposit receipts for that event before invoice (from Customer Deposits VAT tracking). Let advance net already recognized = sum of net portions from deposits.

Remaining VAT = I_vat - advance VAT already recognized
Remaining net for AR? For AR creation, need to avoid duplication:

If no prior deposits:
- Dr AR gross I_gross
- Cr Deferred net I_net
- Cr VAT Payable I_vat

If prior deposits exist:
- Let advance VAT = sum VAT from deposits for event
- Let advance net = sum net from deposits
- Remaining VAT = I_vat - advance VAT
- AR for invoice = I_net + Remaining VAT = I_gross - advance VAT? Actually I_gross = I_net + I_vat, so I_gross - advance VAT = I_net + (I_vat - advance VAT) = I_net + Remaining VAT = AR to create for invoice (since advance VAT already recognized, AR should be total net + remaining VAT).
- Posting: Dr AR (I_net + Remaining VAT) Cr Deferred net I_net Cr VAT Payable Remaining VAT
- Then allocation: Dr Customer Deposits net advance net Cr AR net advance net (net portion only)

This prevents VAT that was already recognized on advance from being recognized again on invoice issuance. VAT total after invoice = advance VAT + remaining VAT = I_vat, correct.

Example: total net 2000 VAT 100 gross 2100, advance gross 1050 net 1000 VAT 50 already. Remaining VAT 50. AR = 2000+50=2050. Posting: Dr AR 2050 Cr Deferred 2000 Cr VAT 50. Then allocation Dr Deposits net 1000 Cr AR net 1000 → AR becomes 1050 = remaining net 1000 + remaining VAT 50, which equals remaining amount due gross? Actually remaining due gross should be 1050 (1000 net+50 VAT), matches.

If invoice issued before any deposits, remaining VAT = full VAT, AR = full gross.

**Revenue Recognition — VAT-registered:**

At CLOSED, only net earned service amount becomes Event Revenue. VAT must not move into Event Revenue.

Define:

For non-VAT orgs: recognized revenue = full consideration (gross=net)
For VAT-registered orgs: recognized revenue = consideration excluding VAT = pre_vat_total / net amount.

Postings:

- If invoice exists (deferred exists): Dr Deferred net Cr Event Revenue net (VAT stays in VAT Payable)
- If no invoice (unbilled exists): Dr Unbilled gross (net+VAT) Cr Event Revenue net Cr VAT Payable VAT (if VAT not yet recognized) OR Dr Unbilled gross (remaining) Cr Revenue net + VAT remaining if deposits exist (see §15 matrix).

**Cancellation / Void / Refund — VAT reversal semantics to avoid duplicated VAT liability, orphaned VAT, revenue reversal without tax reversal, customer deposit mismatch:**

- Void customer payment that was deposit (VAT-registered): Dr Customer Deposits net Dr VAT Payable VAT Cr Treasury gross — reverses original, removes VAT liability, removes deposit liability, returns cash.
- Void customer payment that was after invoice (AR settlement): Dr AR gross Cr Treasury gross — no VAT reversal (VAT already in VAT Payable from invoice), AR increases, no deposit created.
- Void invoice before CLOSED, no deposit: Dr Deferred net Dr VAT Payable VAT Cr AR gross — reverses invoice, removes VAT liability, removes deferred, removes AR.
- Void invoice before CLOSED, with deposit allocation: Two journals in same transaction: (1) Dr Deferred net Dr VAT Payable remaining VAT Cr AR (invoice AR) to reverse invoice, (2) Dr AR net Cr Customer Deposits net to restore deposit (net). Final: Treasury gross, Deposits net, VAT Payable VAT (deposit VAT remains), no AR, no Deferred. No orphaned VAT.
- Void invoice after CLOSED (revenue already recognized): Need revenue reversal: Dr Event Revenue net Dr VAT Payable VAT? Actually VAT already recognized, should reverse? If invoice voided after CLOSED, revenue was already recognized from deferred or unbilled. Voiding invoice after revenue recognition should reverse revenue and VAT and AR and restore Unbilled or Deferred? Define: If CLOSED with invoice, revenue recognized via Dr Deferred Cr Revenue. Void invoice after CLOSED: Dr Revenue net Dr VAT Payable VAT Cr AR gross (if no deposit) + Dr AR? Actually need to restore Deferred? No, service already done, revenue recognized, voiding invoice should reverse AR and VAT and Revenue and create Unbilled? Let's define deterministic: Void invoice after CLOSED with no deposit: Dr Event Revenue net Dr VAT Payable VAT Cr AR gross, and Dr Unbilled gross Cr? No, if service done and invoice voided, earned amount becomes unbilled again: Dr Unbilled gross Cr? Actually after CLOSED without invoice we had Unbilled. After invoice after CLOSED we had AR. Voiding invoice after CLOSED should reclassify AR back to Unbilled: Dr Unbilled gross Cr AR gross, plus revenue reversal? Wait revenue already recognized, should remain? If invoice voided after revenue recognized, revenue should remain recognized (service done), but AR should become Unbilled again (earned but not invoiced). So void invoice after CLOSED should be Dr Unbilled gross Cr AR gross, no revenue reversal, no VAT reversal (VAT already due at CLOSED). But if invoice voided before CLOSED, revenue not yet recognized, so reverse deferred and VAT.

Simplify for A0: Define void invoice semantics sufficiently to avoid duplicated VAT liability, orphaned VAT, revenue reversal without tax reversal, customer deposit mismatch, but do not build full tax reporting subsystem yet. For A0, state that void invoice before CLOSED reverses Deferred and VAT Payable and AR, and restores deposits. Void invoice after CLOSED reclassifies AR to Unbilled, no revenue/VAT reversal (since VAT due at CLOSED per tax point). If refund of deposit after CLOSED, need credit note adjusting VAT.

Document exact conditions in posting matrix.

**Do not build full tax reporting subsystem yet, but A0 must define enough tax behavior that A2 cannot accidentally post accounting-invalid customer transactions.**

## 23. Capability Contract

Do not automatically create new capabilities. Prefer existing exact capabilities where business operation already has one.

| Operation | Candidate Capability | Existing? | Justification |
|---|---|---|---|
| Record customer payment (including VAT split) | payment.record | Existing (0079) | Already used for record_customer_payment, keep, enhanced in A2 to handle VAT split |
| Void customer payment | payment.void | Existing | Already used |
| Invoice operations (create/void) | invoice.manage | Existing | Already used for create_event_invoice, void_invoice, enhanced in A2 to handle VAT remaining |
| Event expense (record/void) | finance.manage | Existing | Already used for record_event_expense |
| Staff advance (record/void) | payroll.pay | Existing | Payroll.pay for payroll payments |
| Host payout (record/void) | payroll.pay | Existing | Already payroll.pay, enhanced in A3 to handle overpayment receivable |
| Attendance earning (record/void) | attendance.record | Existing | Attendance.record for recording attendance |
| Supplier invoice / procurement bill (create/void) | procurement.manage | Existing | Procurement.manage for procurement orders |
| Supplier payment (record/void) | finance.manage | Existing | Finance.manage for financial operations |
| Treasury account administration (create/update/deactivate) | finance.manage | Existing | Finance.manage for treasury management |
| Treasury transfer | finance.manage | Existing | Finance.manage for treasury transfers |
| Ledger read (account balance, raw balance, journal history, treasury balances, AR/AP aging, contract asset) | cost.visibility | Existing | Cost.visibility for financial reads, already gates event_finance_summaries |
| Manual journal if ever added | finance.manage + maker-checker explicit future decision | Future | If manual journal ever required, separate explicit RPC |

**No genuinely new capability required for A0/A1/B/A2/A3/C.** Existing 20 capabilities cover all future accounting actions. settings.manage remains OWNER-exclusive, not needed for accounting. finance.manage is broadest financial capability already (OWNER/MANAGER/ACCOUNTANT). Do not create accounting super-capability.

If in future manual journal needed, evaluate whether new capability journal.manage required, but for now out of scope.

## 24. A1 Boundary (Corrected)

After correcting A0, redefine A1 precisely.

**A1 should remain infrastructure only, no business RPC integration yet:**

- chart_of_accounts table with system accounts including corrected minimum: 1000 Cash/Treasury, 1010 Bank/Treasury, 1020 Other Treasury (active), 1100 Accounts Receivable, 1120 Unbilled Receivable / Contract Asset (active, Correction One), 1150 Staff Advances & Receivables (active, renamed, Correction Four), 1155 Input VAT / VAT Receivable placeholder deferred, 2000 Customer Deposits, 2100 Deferred Revenue, 2150 VAT Payable (active, Correction Two), 2200 Accounts Payable, 2300 Payroll Payable, 2400 GRNI deferred, 3000 Opening Balance Equity, 3100 Retained Earnings deferred, 4000 Event Revenue (net only), 5000 Staff Cost, 5100 Procurement Cost, 5200 Direct Event Expenses, 5300 Damage/Loss deferred, plus treasury sub-accounts 1001+,1011+.

- journal_entries table with columns id, organization_id, entry_number (via document_sequences), entry_date, event_at, created_at, source_type (check taxonomy including new types UNBILLED_RECOGNITION, CONTRACT_ASSET_RECLASSIFICATION, STAFF_RECEIVABLE_RECOGNITION), source_id, idempotency_key unique per org, request_fingerprint, created_by, reversal_of, is_reversal, memo, event_id nullable.

- journal_lines table with id, organization_id, entry_id FK, account_id FK, debit, credit, line_memo, created_at, CHECKs no both debit+credit, no zero, amount>0 OMR precision, account same org, account active.

- **Journal invariants corrected:** Balancing invariant enforced via DEFERRABLE CONSTRAINT TRIGGER on journal_lines (not journal_entries), plus explicit validation in internal_post_journal. Immutability triggers on both tables BEFORE UPDATE/DELETE raise exception. Minimum two-line invariant enforced in internal_post_journal and via trigger. No zero-value line, no both debit+credit, OMR precision, cross-org account fails, inactive account fails.

- **Internal posting primitive:** `internal_post_journal(...)` SECURITY DEFINER no grants to authenticated, called only by other SECURITY DEFINER functions, validates balanced, OMR, org isolation, accounts same org, source doc same org, at least two lines, inactive account check.

- **Reversal primitive:** `reverse_journal_entry(p_org_id, p_entry_id, p_reason, p_idempotency_key)` that creates new opposite journal with reversal_of = original, is_reversal true, same total, audit, and enforces unique reversal_of (only once).

- **Account balance read models corrected for sign convention:** 
  - Raw Ledger Balance always raw_balance = SUM(debit) - SUM(credit), never changes based on account type.
  - Normalized / Display Balance: if normal_balance = DEBIT: display_balance = raw_balance, if normal_balance = CREDIT: display_balance = -raw_balance. Positive normal balances for assets/expenses on debit side, liabilities/equity/revenue on credit side.
  - Functions: `account_raw_balance(org, account_id)` returns debit_total, credit_total, raw_balance; `account_balance(org, account_id)` returns normalized balance (display), normal_balance, plus raw; or one function returning debit_total, credit_total, raw_balance, normal_balance, balance. Document names precisely. Historical balance-at-time function `account_balance_at_time(org, account_id, at_time)` using event_at or entry_date.

- **Source taxonomy:** check constraint on source_type in approved taxonomy including new types for Contract Asset.

- **Tenant isolation:** every new table has organization_id, composite FKs, RLS enabled, no direct client grants, only SECURITY DEFINER functions, revoke all from anon/authenticated, grant execute to authenticated for read functions gated by has_permission.

- **Capability-gated accounting reads:** read functions check has_permission(cost.visibility) or payroll.read etc.

- **Idempotency support:** unique index (organization_id, idempotency_key) on journal_entries, request_fingerprint, begin/finish pattern via canonical command_idempotency or new journal_idempotency table, advisory lock, same key + same fingerprint returns same journal, same key + different fingerprint fails, concurrency cannot duplicate.

- **Tests:** pgTAP/concurrency tests for journal correctness, immutability, idempotency, tenant isolation, capability, balance APIs (see §28 A1 Acceptance Contract).

**A1 Must Not Yet Modify (unless explicitly justified by foundation requirements):**

- record_customer_payment
- void_customer_payment
- create_event_invoice
- void_invoice
- transition_event_status
- record_staff_attendance
- void_staff_attendance
- record_staff_advance
- void_staff_advance
- record_host_payout_multi
- record_event_expense
- void_event_expense
- procurement
- financial closure
- frontend

Business posting integration belongs to later tranches (B, A2, A3, C, etc). A1 remains infrastructure only, tax-neutral, does not post business transactions, but chart/schema must not make correct VAT integration impossible (hence 2150 VAT Payable and 1120 Contract Asset included in A1 minimum chart).

## 25. No Implementation in This Session & Deliverable Quality (Corrected)

**Binding: Do not create 0081 migration, journal tables, new RPCs, new enums, new TS types, new React components, new tests, new dependencies. Do not modify application behavior. Allowed repository change: `docs/research/accounting-posting-contract.md` only. Update previous research doc only if factual correction necessary (none needed beyond this file). No production DB mutation. No Supabase remote migration. No Vercel deployment changes. No PR.**

Compliance: Only this file corrected, no other files modified, no migrations, no SQL functions, no frontend code, no generated types, no dependencies, no tests. Previous research doc `financial-component-harvest.md` untouched (no factual correction needed, but VAT and Contract Asset now supersede prior VAT out-of-scope statement).

**Required Deliverable — This Document Contains Exact Sections 1-25 Corrected:**

1 Repository Verification (updated), 2 Current Accounting Reality (payroll semantics pinned), 3 Accounting Basis Decision (accrual + Contract Asset + VAT Payable, opening equity not replaying P&L), 4 Revenue Recognition Contract (Option B Contract Asset chosen, why, postings with VAT), 5 Customer Deposits AR Invoice & Allocation Contract (VAT split, advance VAT, remaining VAT, 9 questions answered), 6 Payroll Accrual & Staff Advance Contract (future model + historical cutover N formula + overpayment policy exact), 7 Expense Contract, 8 Supplier Procurement AP Contract, 9 Inventory Accounting Boundary, 10 Treasury Contract, 11 Minimum Chart of Accounts (15 active including 1120,1150 renamed,2150), 12 Posting Security Boundary, 13 Journal Invariants (corrected trigger on journal_lines, min two-line enforcement location), 14 Source Document Taxonomy (new types for Contract Asset), 15 Posting Matrix (corrected deterministic with VAT + Contract Asset, no ambiguous X or Y), 16 Historical Cutover Policy (deterministic algorithm from existing canonical data, no allocation table dependency, opening AR/deposits/contract asset/deferred/VAT Payable owner-provided/payroll net), 17 Reconciliation Contract (outstanding = AR+Contract Asset-Deposits, payroll net, VAT), 18 Financial Closure Contract (may block: CLOSED, outstanding 0, revenue recognized, no unresolved customer state; must NOT block AP/Payroll Payable; liability settlement after close allowed if underlying existed before close), 19 Existing Closure Snapshots, 20 Compatibility Strategy, 21 Required Account Balance Equations (MUST/MUST NOT, raw vs normalized, Contract Asset, VAT Payable, payroll non-negative), 22 Tax VAT Boundary (Oman VAT research with official sources, VAT Payable 2150, advance split, invoice remaining VAT, revenue net, void semantics), 23 Capability Contract, 24 A1 Boundary (infrastructure only, includes VAT Payable and Contract Asset so A2 not blocked, no business RPC integration), 25 No Implementation & Deliverable Quality.

**Quality Standard (corrected):** This A0 contract makes it possible for different engineer in completely new session to implement A1 without inventing accounting policy. It defines when revenue earned (CLOSED, with Contract Asset 1120 if no invoice), what happens to pre-invoice payments (Dr Treasury gross Cr Deposits net Cr VAT Payable VAT per Oman tax point), how to avoid duplicate VAT on invoice (remaining VAT only), when payroll cost arises (attendance PRESENT/LATE/PARTIAL), how advances work (Dr Advance Asset Cr Treasury, settlement Dr Payable Cr Advance, overpayment excess becomes receivable, payroll_payable>=0 MUST, staff_receivable>=0 MUST), when AP arises (supplier invoice, not PO/receipt), what financial close means (customer AR+Contract Asset-Deposits must be 0, Deferred 0, revenue recognized, AP/Payroll Payable does NOT block, cost creation blocked after close but liability settlement of pre-close recognized amounts allowed if underlying existed before close), how old records enter ledger (Strategy B Opening Balances default, deterministic formulas from existing canonical data only: AR = max(I-P,0), Deposit = max(P-I,0), Contract Asset = max(Q-P,0) for CLOSED without invoice, Deferred = I_net for not CLOSED with invoice, VAT Payable owner-provided never invented, Payroll Payable = max(N,0), Staff Receivable = max(-N,0), Treasury owner-provided, Opening Equity balancing, historical P&L not replayed), which RPC allowed to post what (internal_post_journal internal only, business RPCs external surface with existing capabilities), which capability authorizes action, how reversal works (new opposite journal with reversal_of reference, only once, immutable), journal balance invariant enforced at journal_lines mutation boundary via DEFERRABLE CONSTRAINT TRIGGER, account balance sign convention canonical raw = SUM(debit)-SUM(credit), normalized = raw if DEBIT normal else -raw.

Optimized for correct accounting semantics, minimal operator complexity, explicit business-event postings, no negative AR artifacts, no double counting, no second source of truth, append-only financial history, tenant isolation, idempotency, backward compatibility, clean cutover, simple future implementation, Oman VAT compliance.

We are ready to begin A1 — Ledger Foundation with corrected minimum system chart (including 1120 Unbilled Receivable / Contract Asset and 2150 VAT Payable and 1150 Staff Advances & Receivables renamed), journal header/lines, balancing invariant on journal_lines, immutability, reversal primitive, internal posting primitive, account balance read models with raw and normalized sign exact, source-document taxonomy, tenant isolation, capability-gated reads, idempotency support, and pgTAP tests, without yet integrating business RPCs. Cutover policy is opening balances default executable from existing canonical data, VAT Payable owner-provided, treasury owner-provided, payroll net reproduction exact, opening equity balancing without contaminating post-cutover P&L.

A1 READY
