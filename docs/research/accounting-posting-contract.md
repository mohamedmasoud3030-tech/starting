# A0 — Accounting Posting Contract & Cutover Policy

**Date:** 2026-09-04 UTC  
**Baseline:** `origin/main` @ `fd7aaff9001e0d63ab2b63f290b2804c96d2bdd9` (PR #38 merged)  
**Active Branch:** `arena/01a06b35-starting` @ `b37ee34` (research doc from prior phase, no app code)  
**Previous Research:** `docs/research/financial-component-harvest.md` — approved in principle, PostgreSQL-native ledger adapted from pgr0ss/pgledger MIT  
**Scope:** Architecture-contract only, no migrations, no SQL, no frontend, no types, no tests, no deps.

---

## 1. Repository Verification

- **main SHA:** `fd7aaff9001e0d63ab2b63f290b2804c96d2bdd9` verified via `git rev-parse origin/main` → `Merge PR #38: owner-controlled delegation and operational documents`
- **Active branch:** `arena/01a06b35-starting` @ `b37ee34f96305a9f2550473aebda9543516aea78` — ahead of main by 1 commit (research doc), no application code changes, working tree clean. `git branch -vv` shows only `main` and this branch locally; `git branch -r` shows only `origin/main` + `origin/HEAD` before push, plus this branch after.
- **Open PR count:** 0 — `gh pr list --state open` empty. PRs 1-38 MERGED or CLOSED.
- **Branch cleanliness:** Prior session deleted 18 stale remote branches (arena, ChatGPT, feature, hotfix, closeout, phase, refactor). `git ls-remote --heads origin` shows only `main` + this arena branch now.
- **No implementation started:** No migration 0081, no journal tables, no new RPCs, no enums, no TS types, no React components, no tests, no deps. `supabase/migrations` latest `20260904000100_0080_office_documents.sql`. `src/lib/database.types.ts` unchanged, generator-owned. `git status` clean.

## 2. Current Accounting Reality

- **Commercial value:** `event_finance_summaries.accepted_revenue` = `quotations.total_selling` from accepted quotation snapshot. Contracted commercial value, not accounting revenue. Feeds customer 360, event workspace, financial closure, management metrics, office documents, tests. Must remain backward compatible.
- **Invoice:** `invoices` (ISSUED/CANCELLED, INV-…), `total_amount` numeric(14,3), VAT snapshot fields, `quotation_id`, `event_id`. `invoice_installments` (DEPOSIT/INSTALLMENT/FINAL, PENDING/PAID/CANCELLED). `create_event_invoice` builds formal invoice from accepted quotation total; schedule sum must equal total exact 3dp. Currently enforces at most one ISSUED invoice per event (`INVOICE_ALREADY_EXISTS`). Payments remain in S6 ledger; installment PAID state DERIVED from customer_payments ledger (cumulative paid vs scheduled), no second money source. Invoices can be created before service (only checks event not CANCELLED). `void_invoice` cancels installments + invoice with reason, non-destructive.
- **Collection:** `customer_payments` append-only ledger, amount numeric(12,3) >0, payment_method CASH/BANK_TRANSFER/CARD/CHEQUE/MOBILE_WALLET/OTHER, reference, paid_at, status RECORDED→VOIDED with reason, recorded_by, idempotency_key unique per org, request_fingerprint SHA-256, advisory lock on (org,key). `record_customer_payment` idempotent, checks has_permission payment.record, org ACTIVE, event not CANCELLED, amount>0 via `assert_payment_omr`. `void_customer_payment` similar payment.void. Balance derived: `amount_paid` = Σ RECORDED payments per event, `outstanding_balance` = accepted_revenue − amount_paid in `event_finance_summaries`. Payments are event-linked, not invoice-allocated. Pre-invoice payments allowed. No treasury account attribution yet.
- **Outstanding:** `event_finance_summaries.outstanding_balance` = accepted_revenue − amount_paid. `invoice_summaries` paid_total/remaining_balance derived from payments ledger. `customer_statement(org,customer)` CHARGE rows from accepted revenue + PAYMENT rows from RECORDED payments, positive amounts, sign via row_kind, gate cost.visibility.
- **Costs:** Unified actual profitability: staff_cost = Σ payroll earned (host/supervisor), procurement_cost = active committed/delivered from `event_procurement_cost_summaries`, expense_cost = Σ RECORDED event_expenses, actual_cost = staff+procurement+expense, actual_profit = revenue−actual_cost, margin_percent. Anti-double-counting: PURCHASE → procurement orders (committed/delivered) NOT event_expenses, STAFF → payroll earned NOT event_expenses, else (transport/fuel/rental/third-party/consumable/damage/loss/other) → event_expenses.
- **Payroll:** `staff_members`, `event_staff_assignments` per-event overlap rejection ACTIVE/RELEASED/CANCELLED, `staff_attendance` one live per org/event/staff/date/shift PRESENT/LATE/PARTIAL/ABSENT/VOIDED, earned = hours×rate or fixed, ABSENT→0. `staff_advances` host-level event-independent VOID, `host_payouts` optionally event-linked VOID, `host_payout_allocations` multi-event (0076), `host_event_payroll_summaries` view, `get_host_payroll_summary` host-wide includes advances_total (per-event view carries 0 for advances by design, host_statement injects host-wide). Flow: Event→Assignment→Attendance→Earned→Advances→Payouts→Remaining Due.
- **Procurement:** `suppliers` ACTIVE/INACTIVE no-delete, `procurement_orders` PO-YYYY-NNNNN DRAFT→APPROVED→SENT→CONFIRMED→PARTIALLY_RECEIVED→RECEIVED→CANCELLED, snapshots frozen at approval, history guard + event_lifecycle_guard, `procurement_order_lines` immutable negotiated snapshots (CONSUMABLE/CATERING_SERVICE/OTHER), `procurement_receipts`/`receipt_lines` append-only linking to S4B consumable_movements, partial vs full derived from cumulative qty. OWNER/MANAGER. No supplier invoices/AP yet.
- **Closure:** `event_financial_closures` append-only cycle OPEN→CLOSED→REOPENED→CLOSED AGAIN, each row episode, reopen sets reopened_at/by/reason never erases previous close, current closed iff row with reopened_at IS NULL, partial unique index one active per event. `close_event_financially` atomic idempotent snapshot revenue_at_close, collected_at_close, outstanding_at_close, costs_at_close, profit_at_close, margin_at_close. `reopen_event_financially` explicit reason. Readiness `event_financially_ready` requires accepted_revenue>0 AND outstanding_balance<=0. D8 guard `guard_event_financially_closed` BEFORE triggers on customer_payments, host_payouts, staff_attendance, event_expenses blocks every cost/collection mutation while financially closed.
- **VAT:** Migration 0077 optional VAT per organization, snapshotted onto issued quotation/invoice at issue time, never recalculated. Org settings vat_registered bool, vat_percent numeric(12,3) default 5.000, vat_registration_number. Quotation/invoice have pre_vat_total, vat_registered, vat_percent, vat_amount, vat_registration_number. Money rule: total = pre_vat + round(pre_vat×vat_percent/100,3). VAT-disabled orgs snapshot 0. Totals VAT-inclusive when registered.

## 3. Accounting Basis Decision

**Chosen basis: Accrual basis with Customer Deposits + Deferred Revenue + AR/AP/Payroll Payable, cash basis reporting as derived projection.**

Why:
- Product can receive customer money before formal invoice exists. Naive Dr Treasury Cr AR for every payment would create negative AR artifact or invent receivable. Need Customer Deposits liability for unapplied cash.
- Invoices can be issued before service completion (only checks not CANCELLED). If invoice creates AR + revenue immediately, revenue recognized before service delivered, violating accrual and conflating commercial commitment with earned revenue.
- Event economics already distinguishes accepted commercial value (contract) from cash collected and outstanding. Accounting must preserve separation and add recognized vs deferred distinction.
- Payroll: attendance-earned compensation considered event cost before payout (staff_cost derived from attendance, not payouts). Accrual: cost recognized when work performed, not when cash paid.
- Procurement: PO is commitment not liability, receipt operational not yet liability, supplier invoice creates AP liability. Accrual.
- Owner/manager small team needs simple UX but rigorous underneath: cash vs accrual both derivable from same ledger if we have Deposits, Deferred, AR, AP, Payroll Payable.

Therefore:
- Commercial commitment (accepted quotation) = NO JOURNAL ENTRY, reporting only.
- Cash received before invoice = liability Customer Deposits, not revenue, not negative AR.
- Invoice issued before service = AR + Deferred Revenue liability.
- Service earned = Deferred Revenue → Revenue.
- Cash after invoice = Treasury + AR settlement.
- Costs recognized when incurred (attendance, expense, supplier invoice) not when paid.
- Treasury balances derived from journal, not payment_method enum.
- Cash basis reports remain possible as derived views: cash collected = Treasury debits from customer payments, etc.

## 4. Revenue Recognition Contract

**Recognition point: Transition of event to CLOSED (operationally closed).**

Candidates:
- IN_PROGRESS: event happening, equipment not yet returned, consumables not reconciled, damage/loss unknown, staff attendance may still be recorded. Recognizing while ongoing = early, before substantially complete.
- RETURNING: service completed, equipment returning, but warehouse reconciliation (dispatched = returned+damaged+lost) and consumable reconciliation (final per-event) may still be pending. CLOSED requires those reconciliations (readiness blocks CLOSED while outstanding equipment). So RETURNING not yet authoritative done.
- CLOSED: authoritative product definition of done. Existing readiness model: warehouse reconciliation, consumable reconciliation, staffing, etc. must be ok to allow CLOSED. At CLOSED, service delivered, losses/damages known, staff attendance finalized, procurement delivered. Represents earned revenue per product lifecycle.
- Financial close: independent business event that freezes economics and requires AR settled. Should NOT be revenue recognition point, because then financial close would both recognize and freeze, conflating concepts. Revenue should already be recognized before financial close, so closure snapshot can include recognized revenue. Also financial close requires outstanding_balance<=0, which is AR settlement, not earning.

**Why CLOSED:** Existing authoritative operational completion, not financial artifact. When event economics final except AP settlement that may remain. Matches owner mental model: event done → revenue earned.

**Postings:**
- Accepted quotation (commercial commitment): NO JOURNAL ENTRY. Continues feeding event commercial/economic reporting (accepted_revenue).
- Customer pays before invoice: Dr Treasury (specific treasury account) Cr Customer Deposits / Customer Advances (liability). Source CUSTOMER_PAYMENT, Event Link event_id, Customer Link customer_id. Not revenue, not negative AR.
- Invoice issued before service completion (typical): Dr Accounts Receivable Cr Deferred / Unearned Revenue (liability). Source INVOICE, Event Link event_id, Invoice Link invoice_id. Amount = total_amount VAT-inclusive.
- Deposit applied to invoice (when deposit exists): Dr Customer Deposits Cr Accounts Receivable. Source CUSTOMER_DEPOSIT_APPLIED, Event Link, Invoice Link, Payment Link. Reduces AR, reduces Deposits liability. Allocation, not new cash.
- Customer pays after invoice: Dr Treasury Cr Accounts Receivable. Source CUSTOMER_PAYMENT, Event Link, Invoice Link via allocation.
- Event/service becomes earned at CLOSED: Dr Deferred Revenue Cr Event Revenue (revenue). Source REVENUE_RECOGNITION, Event Link event_id. Amount = recognized portion (full event value at CLOSED). If partial recognition needed later (multi-day), could be staged, but for A0 full at CLOSED.
- If invoice issued after service already earned (event already CLOSED): Dr AR Cr Event Revenue directly (no deferred).
- Reversal if event cancelled after invoice but before recognition: Dr Deferred Revenue Cr AR (void invoice) + if deposit exists refund handling separate.

**Deferred Revenue vs Customer Deposits distinction:**
- Customer Deposits = unapplied cash received before invoice (liability for future service or refund). From cash.
- Deferred Revenue = invoiced but not yet earned (liability for service owed). From AR.
- Both liabilities, different source: Deposits from cash, Deferred from AR.

## 5. Customer Deposits, AR, Invoice & Allocation Contract

**Invoice semantics — 9 questions answered:**

1. **What does invoice issuance create accounting-wise?** Before service CLOSED: Dr AR (total_amount) Cr Deferred Revenue (liability). After service CLOSED: Dr AR Cr Event Revenue directly. Installments do NOT create separate AR entries; entire invoice AR on issue.
2. **When can invoice be issued relative to service?** Allowed before service completion (current check only event not CANCELLED). Accounting handles both cases via Deferred vs Revenue. No new restriction, but recognition deferred until CLOSED.
3. **Can customer money exist without invoice?** Yes, pre-invoice payments allowed. They create Dr Treasury Cr Customer Deposits, not negative AR, not revenue.
4. **How many invoices per event?** Currently at most one ISSUED invoice per event enforced INVOICE_ALREADY_EXISTS. Design allocation table to allow multiple invoices per event in future (payment→many invoices), but for A0/A1 keep one-per-event guard, document future multi-invoice compatibility.
5. **How do installments affect AR?** Installments are schedule for due dates and for deriving PAID status from payments ledger (cumulative paid vs scheduled). Entire invoice AR on issue, not per installment. Future AR aging could use installment due dates, but accounting AR is full invoice.
6. **How to void invoice?** `void_invoice` preconditions: invoice ISSUED, reason>=3, has_permission invoice.manage, no payment allocation OR allocation reversed atomically in same transaction. Accounting reversal: Dr Deferred (if not yet recognized) OR Dr Revenue (if recognized) Cr AR full amount. If allocations existed, reverse allocations: create second journal Dr AR Cr Customer Deposits for allocated amount (payment becomes unapplied deposit again) OR Dr AR Cr Customer Deposits for deposit allocations. Block void if payment allocated unless reclassify to deposit with warning.
7. **What happens to allocated payments on void?** Allocated payments become unapplied deposits again via reversal journals: Invoice creation Dr AR 100 Cr Deferred 100, Payment after invoice Dr Treasury 100 Cr AR 100 (AR 0). Void invoice: reverse invoice Dr Deferred 100 Cr AR 100 (AR -100), reclassify payment as deposit Dr AR 100 Cr Customer Deposits 100 (AR 0, Deposits 100 Cr, Treasury 100 Dr). Net: Treasury 100 Dr, Deposits 100 Cr, no AR, no Deferred. Cash remains as deposit liability.
8. **What is unapplied customer deposit?** Payment amount − sum allocations remains Customer Deposits liability until allocated to invoice or refunded. Customer balance: Deposits liability increases when payment before invoice, decreases when allocated.
9. **How to handle VAT on invoice?** VAT snapshot from org settings at issue (0077). total_amount VAT-inclusive when registered. For A0/A1 VAT accounting OUT OF SCOPE beyond snapshot (see §22). Future split: Dr AR Cr Revenue pre-VAT + VAT Payable. For now revenue = total inclusive, document boundary.

**Lifecycle:**
1. Quotation accepted → commercial commitment only, no journal. `accepted_revenue` derived.
2. Customer pays before invoice → Dr Treasury Cr Customer Deposits. Payment row RECORDED + journal. Deposits liability increases, AR 0, outstanding commercial = accepted_revenue − amount_paid but accounting AR=0, Deposits=amount.
3. Invoice issued: Dr AR Cr Deferred. If Customer Deposits exists for that customer/event, allocate: Dr Customer Deposits Cr AR up to min(deposits, AR). Allocation journal CUSTOMER_DEPOSIT_APPLIED. After allocation, AR outstanding = total − allocated, Deposits remaining = deposits − allocated.
4. Customer pays after invoice: Payment row + journal Dr Treasury Cr AR. Auto-allocate when only one invoice per event up to its outstanding. If multiple invoices future, require explicit operator selection. Unapplied portion remains Customer Deposits (remainder Dr Treasury Cr Customer Deposits).
5. **Payment allocation invariants — table `customer_payment_allocations` (payment_id, invoice_id, amount, organization_id):**
   - allocation total per payment ≤ payment amount
   - allocation total per invoice ≤ invoice outstanding (total − sum allocations − void adjustments)
   - one payment may allocate to multiple invoices if future product allows (for now one event one invoice, but design for multiple)
   - unapplied payment = payment amount − sum allocations remains Customer Deposits liability
   - voiding a payment reverses its allocations atomically (same transaction)
   - cross-organization allocation impossible (composite FK org_id, check)
   - allocation occurs automatically when only one invoice exists for event (simple UX), else explicit operator selection in UI.

**Compatibility:** Keep `event_finance_summaries.accepted_revenue` as commercial_value for backward compat, not redefined. Future accounting read models add new fields: commercial_value (existing), recognized_revenue (ledger, at CLOSED), invoiced_amount, collected_amount, customer_deposits, accounts_receivable. Existing frontend consuming accepted_revenue continues working.

## 6. Payroll Accrual & Staff Advance Contract

**Do not post payroll cost only when money paid.** Existing product considers attendance-earned compensation event cost before payout. Staff_cost is Σ earned, not payouts. Accrual model required.

**Posting model finalized:**

- **Earnings become payable when attendance becomes authoritative:** At attendance creation with status PRESENT/LATE/PARTIAL (not ABSENT, not VOIDED). Earned_amount calculated (hours×rate or fixed). Posting: Dr Staff Cost (expense) Cr Payroll Payable (liability). Source HOST_EARNING, Event Link event_id, Staff Link staff_member_id, Attendance Link attendance_id. Amount = earned_amount.
- **Attendance void/correction:** When attendance voided (VOIDED status with reason) or corrected via void + new record, reversal: Dr Payroll Payable Cr Staff Cost for original earned_amount. If corrected with new earned amount, new posting as above. Non-destructive, original remains VOIDED, reversal references original.
- **Host payout:** Dr Payroll Payable Cr Treasury (specific treasury account). Source HOST_PAYOUT, Event Link (if event-linked) or null if host-wide multi-event, Staff Link, Payout Link. Amount = payout amount. Settles liability, not create expense again. If multi-event with allocations `host_payout_allocations`, one payout may settle multiple events: one journal Dr Payroll Payable (total) Cr Treasury (total), but allocations table shows per-event breakdown for reporting.
- **Staff advance:** Dr Staff Advance Receivable / Asset (asset) Cr Treasury. Source STAFF_ADVANCE, Staff Link, Advance Link. Amount = advance amount. Host-wide model: advances host-level event-independent, but accounting advance asset per staff member.
- **Advance settlement against earned payroll:** Dr Payroll Payable Cr Staff Advance (asset). Source STAFF_ADVANCE_SETTLEMENT, Staff Link, Advance Link. Reduces payable liability and reduces advance asset. If advance not yet settled, remains asset, payroll payable remains liability.
- **Host-wide advance mapping:** Advance asset per staff, not per event. When payroll payable per event, settlement of host-wide advance against specific event's payable should allocate advance to that event: Dr Payroll Payable (event) Cr Staff Advance (host-wide). Matches payout allocation pattern.
- **Do not create second payroll truth:** Operational flow Event→Assignment→Attendance→Earned→Advances→Payouts→Remaining Due remains authoritative. Ledger postings derived synchronously in same transaction as operational writes, not separate source.
- **Void paths:** Advance Void Dr Treasury Cr Staff Advance Asset, Payout Void Dr Treasury Cr Payroll Payable (if supported), both via reversal.

## 7. Expense Contract

**Cash-paid expense:** Dr Appropriate Expense (Direct Event Expense) Cr Treasury (specific treasury account). Source EVENT_EXPENSE, Event Link event_id, Expense Link expense_id. Amount = expense amount. Category (TRANSPORT/FUEL/RENTAL/THIRD_PARTY/CONSUMABLE/DAMAGE_LOSS/OTHER) stored in source doc, not necessarily separate chart accounts for MVP, but could map to sub-accounts later. For A0, one expense account 5200 Direct Event Expenses, category for reporting breakdown via source doc.

**Expense incurred but not yet paid:** Determine whether product needs Dr Expense Cr AP/Accrued Liability. Currently event_expenses has payment_method, payee, reference, but no AP. For minimum rigorous model, keep cash-paid only initially (A0/A1). Document future boundary: if supplier bill for expense (e.g., transport company invoice), then use supplier invoice path Dr Expense Cr AP, then payment Dr AP Cr Treasury. So expense accrued = supplier invoice path.

**Preserve anti-double-counting rule:** staff_cost, procurement_cost, event_expenses are separate cost sources. Procurement purchase must never also appear as generic event_expense. Enforce via documentation and potentially check in RPC: if procurement_order_id linked, reject generic expense? For A0, document rule and add future check.

**Void expense:** `void_event_expense` non-destructive VOID with reason. Accounting reversal: Dr Treasury Cr Expense (if cash-paid) OR Dr AP Cr Expense (if accrued). Source EVENT_EXPENSE_VOID, references original.

## 8. Supplier / Procurement / AP Contract

**Current:** Supplier→Procurement Order→Receipt, but no formal supplier invoice/AP settlement.

**Future accounting contract:**

- **Purchase order:** NO JOURNAL ENTRY — commitment, not yet liability. PO is commercial commitment only, like accepted quotation. Feeds procurement cost summaries (committed cost) but not ledger.
- **Goods/service receipt:** NO JOURNAL ENTRY initially, remains operational only until supplier invoice. For consumable purchases, receipt creates operational inventory via `consumable_movements` RECEIVE (existing), but no accounting inventory asset yet (if inventory asset deferred). For direct event cost (CATERING_SERVICE, OTHER), receipt is proof of delivery, not yet liability. Accounting liability arises at supplier invoice. Future boundary: If inventory asset accounting adopted, receipt would be Dr Inventory Asset Cr GRNI (Goods Received Not Invoiced) liability, then supplier invoice Dr GRNI Cr AP, clearing GRNI. Document future.
- **Supplier invoice (bill):** Direct event cost: Dr Procurement / Event Cost (expense) Cr Accounts Payable (liability). For inventory purchases, if inventory accounting introduced: Dr Inventory Asset Cr AP. Do not introduce inventory asset accounting prematurely unless justified — deferred, keep procurement cost as expense for now. So for A0/A1/B/C, supplier invoice for direct event cost = Dr Procurement Cost (5100) Cr AP (2200). Source SUPPLIER_INVOICE, Supplier Link, Procurement Order Link, Event Link if event-linked.
- **Supplier invoice void:** Dr AP Cr Procurement Cost (reversal), Source SUPPLIER_INVOICE_VOID, references original.
- **Supplier payment:** Dr Accounts Payable Cr Treasury (specific treasury account). Source SUPPLIER_PAYMENT, Supplier Link, Treasury Link. Amount = payment amount. Allocation to invoices via `supplier_payment_allocations` similar to customer.
- **Supplier payment void:** Dr Treasury Cr AP (reversal).
- **Three-way match:** PO ↔ Receipt ↔ Invoice affects accounting eligibility. Minimal: For CONSUMABLE line_kind, receipt required before invoice can be posted (must have at least partial receipt qty >= invoice qty). For CATERING_SERVICE and OTHER, receipt optional (service may be invoiced without formal receipt). Price tolerance: for A0, require exact price match (invoice unit_price == PO unit_price) within 0.001 OMR, else exception flagged for owner override with note. Quantity tolerance: invoice qty ≤ received qty and ≤ ordered qty, else exception. Accounting eligibility: supplier invoice posting allowed only if 3-way match passes OR owner overrides with explicit reason (maker-checker). Do not design full enterprise procurement with inspection, landed costs, etc.

**Simple UX:** Procurement order detail shows match status: Matched, Over-receipt, Over-invoice, Price mismatch. Owner can override mismatch with note.

## 9. Inventory Accounting Boundary

**Existing operational movement ledgers:** `consumable_movements` (RECEIVE, ISSUE_TO_EVENT, RETURN_FROM_EVENT, CONSUME_AT_EVENT, WASTE_AT_EVENT, WAREHOUSE_WASTE, ADJUSTMENT) with warehouse_delta/event_delta, no negative balances, balances derived; `event_equipment_movements` DISPATCH/RETURN good/damaged/lost with catalog-cost snapshot. Operational, not accounting asset valuation.

**Decision: Option 1 — Keep inventory purely operational initially and continue using procurement/event costing.**

Evaluation:
- Business need: events catering, not retail. Stock is consumables (food, disposables) and reusable equipment (chairs, tables). Reusable equipment has capacity pool, not fixed asset depreciation. Consumables expensed when consumed at event (CONSUME_AT_EVENT), not when purchased. Procurement cost already counted as event cost via committed/delivered cost in `event_finance_summaries`. Introducing inventory asset accounting would require: purchase Dr Inventory Asset Cr AP, then consumption Dr Expense Cr Inventory Asset, plus valuation FIFO/LIFO/Moving Average/Standard. Adds complexity for owner/manager small team, not justified yet.
- Correctness: Current procurement cost + event_expenses + staff_cost = actual_cost financially correct for event profitability without inventory asset. Operational movement ledgers provide audit trail, no need second truth.
- Simplicity: Owner should not manage accounting complexity manually.

**Therefore for Tranche A/B/C/D, inventory remains operational.** Do NOT create another inventory truth. Do NOT introduce inventory asset accounting prematurely.

**Future boundary explicitly documented:**
- If business needs inventory asset value (balance sheet), introduce:
  - `inventory_asset` account (1200)
  - GRNI account (2400) for goods received not invoiced
  - Receipt posting: Dr Inventory Asset Cr GRNI
  - Supplier invoice posting: Dr GRNI Cr AP (if inventory purchase) OR Dr Procurement Cost Cr AP (if direct event cost)
  - Consumption posting: Dr Direct Event Expense (or Procurement Cost) Cr Inventory Asset when CONSUME_AT_EVENT
  - Waste posting: Dr Waste Expense Cr Inventory Asset
  - Adjustment posting: Dr/Cr Inventory Asset Cr/Dr Adjustment account
  - Valuation: keep catalog_cost_snapshot for simplicity, not FIFO/LIFO unless needed.
- Until then, procurement receipt remains operational only, supplier invoice creates expense directly.
- **Equipment damage/loss:** Remain operational valuation only until fixed asset accounting exists. Future: Dr Loss Expense Cr Equipment Asset. For A0/A1, damage/loss stays in event_expenses or operational reconciliation, no asset journal. Deferred.

## 10. Treasury Contract

**Treasury accounts independent from payment method:** payment_method = CASH/BANK_TRANSFER/CARD/CHEQUE/MOBILE_WALLET/OTHER is how payment was made (channel). treasury_account = Main Cashbox / Bank Muscat / Bank NBO / Petty Cash / etc. is where money physically sits (balance). Payment method must never be used as treasury balance. Payment can be via BANK_TRANSFER method but land in Main Cashbox? Actually BANK_TRANSFER should land in BANK account, but allow explicit selection.

**Minimum treasury account model:**
- Table `treasury_accounts`: org_id FK, id PK, name text, type enum CASH/BANK/OTHER, chart_account_id FK to chart_of_accounts (1000 CASH or 1010 BANK or 1020 OTHER), is_active bool default true, opening_balance numeric(12,3) default 0? Opening balance via journal, not column, but could have column for display. created_by, created_at, updated_at.
- Each treasury account is sub-account of system CASH/BANK chart account for reporting. System chart has CASH (1000) and BANK (1010) as parent, treasury_accounts are child accounts with code 1001,1002 etc. For A0, define system accounts 1000 Cash, 1010 Bank, treasury_accounts are operational accounts that have chart_account_id.
- Balances derived entirely from journal lines: Treasury Balance = sum debits − sum credits for that chart account. No cached balance column (or cached for performance but derived authoritative).
- **Negative cash allowed? No.** Cash (physical cashbox) cannot go negative — positive_only guard. Enforce via trigger or RPC check: before posting credit to CASH account that would make balance negative, reject with `TREASURY_NEGATIVE_CASH_NOT_ALLOWED`.
- Bank accounts may go negative? For minimum rigorous, **disallow negative initially** for both CASH and BANK, to prevent errors. Allow overdraft config later via `allow_negative` bool on treasury_accounts. For A0, disallow negative for all treasury accounts.
- **Transfer semantics:** `treasury_transfer` RPC: p_org_id, p_from_treasury_id, p_to_treasury_id, p_amount, p_note, p_idempotency_key. Posting: Dr destination treasury chart account Cr source treasury chart account, same amount, same entry_date, source TREASURY_TRANSFER, event_id null (or optional). Idempotent, audited, capability finance.manage. Advisory lock on (org, from_id, to_id, idempotency_key) to prevent double transfer.
- **Opening balance semantics:** via opening balance journal using Equity Opening Balance account (3000). For each treasury account, create opening balance entry: Dr Treasury (amount) Cr Opening Balance Equity (if positive opening) OR Dr Opening Balance Equity Cr Treasury (if negative? but negative not allowed). Opening balances created at cutover date via `OPENING_BALANCE` source.
- **Account deactivation:** cannot deactivate if balance !=0 (must transfer out first) or if has movements? For simplicity: cannot deactivate if balance !=0, else allowed, is_active false, no new postings to inactive account (RPC checks is_active).
- **Reconciliation:** For A0/A1, reconciliation OUT OF SCOPE. Later: bank statement import, matching rules, reconciliation status.
- **Payment method vs treasury mapping guidance (UX hint, not hard rule):** CASH method → default CASH type treasury account, BANK_TRANSFER → BANK type, CARD/CHEQUE/MOBILE_WALLET/OTHER → operator selects explicitly, but allow override always.

## 11. Minimum Chart of Accounts

**System accounts protected and automatically created per organization via seed in migration 0081. Owner should not manage complexity manually; system accounts is_active true, is_system true, no client direct writes.**

**Assets (1000-1999):**
- 1000 **Cash / Treasury** — parent for CASH type treasury accounts, Asset, DEBIT normal. System, protected.
- 1001+ **Treasury Cash Sub-accounts** — e.g., 1001 Main Cashbox, 1002 Petty Cash — child of 1000, DEBIT normal, each treasury_accounts row maps to one. Created via RPC.
- 1010 **Bank / Treasury** — parent for BANK type treasury accounts, Asset, DEBIT normal. System.
- 1011+ **Treasury Bank Sub-accounts** — e.g., 1011 Bank Muscat, 1012 Bank NBO — child of 1010.
- 1020 **Other Treasury** — parent for OTHER type, Asset, DEBIT normal.
- 1100 **Accounts Receivable** — AR from customer invoices, Asset, DEBIT normal. System.
- 1150 **Staff Advances** — Staff Advance Receivable / Asset, Asset, DEBIT normal. System.
- 1200 **Inventory Asset** — placeholder, Asset, DEBIT normal, **DEFERRED** for now (not used in A0/A1/B/C). Future inventory valuation if adopted.
- 1300 **Equipment Asset** — placeholder, Asset, DEBIT normal, **DEFERRED** (fixed asset). Future equipment asset, damage/loss reserve. Deferred.

**Liabilities (2000-2999):**
- 2000 **Customer Deposits / Advances** — unapplied customer payments, Liability, CREDIT normal. System.
- 2100 **Deferred / Unearned Revenue** — invoiced but not yet earned, Liability, CREDIT normal. System.
- 2200 **Accounts Payable** — supplier bills, Liability, CREDIT normal. System.
- 2300 **Payroll Payable** — earned but not yet paid staff, Liability, CREDIT normal. System.
- 2400 **GRNI / Accrued Purchases** — Goods Received Not Invoiced, Liability, CREDIT normal, **DEFERRED** for future inventory asset accounting.

**Equity (3000-3999):**
- 3000 **Opening Balance Equity** — for cutover opening balances, Equity, CREDIT normal. System, protected.
- 3100 **Retained Earnings / Current Year Earnings** — placeholder, Equity, CREDIT normal, DEFERRED.

**Revenue (4000-4999):**
- 4000 **Event Revenue** — earned event revenue, Revenue, CREDIT normal. System. VAT-inclusive total for A0/A1, future split pre-VAT + VAT Payable.

**Expenses (5000-5999):**
- 5000 **Staff Cost** — host/supervisor payroll cost, Expense, DEBIT normal. System.
- 5100 **Procurement / Materials Cost** — purchases, Expense, DEBIT normal. System.
- 5200 **Direct Event Expenses** — transport/fuel/rental/third-party/consumable/other, Expense, DEBIT normal. System. Category breakdown via source doc, not sub-accounts for MVP.
- 5300 **Damage / Loss Expense** — equipment damage/loss, Expense, DEBIT normal, **DEFERRED** until fixed asset accounting exists, else part of 5200.

**Notes:** Do not build huge enterprise chart. System accounts auto-created. Each treasury_accounts row creates child chart account under 1000/1010/1020 with code auto-generated. Equity Opening Balance needed for cutover. Minimum complete for posting contract: 1000,1010,1100,1150,2000,2100,2200,2300,3000,4000,5000,5100,5200 = 13 active system accounts for A1. Placeholders deferred but documented.

## 12. Posting Security Boundary

**Mandatory: Do not expose unrestricted generic client RPC post_journal_entry(lines jsonb) behind only finance.manage.** That would allow client to bypass business-domain rules (e.g., create revenue without service, negative AR).

**Generic posting primitive INTERNAL DATABASE PRIMITIVE called only by authoritative business RPCs.**

- Internal primitive: `internal_post_journal(p_org_id, p_entry_date, p_event_at, p_memo, p_source_type, p_source_id, p_lines jsonb, p_idempotency_key, p_fingerprint, p_created_by)` — SECURITY DEFINER, not granted to authenticated, only callable by other SECURITY DEFINER functions (via search_path and revoke). Validates balanced, OMR precision, org isolation, accounts same org, source doc same org, at least two lines, no zero, no both debit+credit, inserts header+lines, no audit itself (caller audits).
- External business commands remain security surface, each uses its own current capability (existing exact capabilities where business operation already has one, not broad super-capability):

| Operation | Capability | Existing RPC / Future RPC |
|---|---|---|
| Record customer payment | payment.record | record_customer_payment (existing enhanced) |
| Void customer payment | payment.void | void_customer_payment (existing enhanced) |
| Invoice operations | invoice.manage | create_event_invoice (existing enhanced), void_invoice (existing enhanced) |
| Event expense | finance.manage | record_event_expense (existing enhanced), void_event_expense |
| Staff advance | payroll.pay | record_staff_advance (existing enhanced) |
| Host payout | payroll.pay | record_host_payout_multi (existing enhanced) |
| Supplier invoice / bill | procurement.manage | create_supplier_invoice (future), void_supplier_invoice |
| Supplier payment | finance.manage | record_supplier_payment (future), void_supplier_payment |
| Treasury account admin | finance.manage | create_treasury_account, update_treasury_account |
| Treasury transfer | finance.manage | treasury_transfer |
| Ledger read | cost.visibility | account_balance, journal_history, etc. |
| Manual journal if ever | explicit future decision, not now | manual_journal_entry (future, separate explicit RPC, not arbitrary) |

Do not collapse permissions into broad accounting super-capability. If manual journal entries ever required, separate explicit feature and RPC with maker-checker, not arbitrary access to internal posting engine.

**Implementation:** Revoke all on internal_post_journal from public, anon, authenticated. Grant execute only to authenticated? Actually internal primitive should have no grants to authenticated, only SECURITY DEFINER functions can call it because they run as owner. So revoke all from public, anon, authenticated, and do not grant. Business RPCs are SECURITY DEFINER and call internal primitive.

## 13. Journal Invariants

Exact DB invariants before implementation:

- **Posted journal headers immutable:** BEFORE UPDATE OR DELETE trigger on journal_entries raises JOURNAL_IMMUTABLE. No direct UPDATE/DELETE.
- **Journal lines immutable:** BEFORE UPDATE OR DELETE trigger on journal_lines raises JOURNAL_LINE_IMMUTABLE.
- **No destructive correction:** Corrections via reversal only, never UPDATE/DELETE.
- **Reversal creates new opposite journal:** reversal_of column FK to journal_entries id being reversed, new entry opposite debit/credit per line, same total, is_reversal true, memo indicates reversal.
- **Reversal references original:** reversal_of NOT NULL for reversal entries, original must exist same org, original not already reversed (unique index on reversal_of where reversal_of IS NOT NULL prevents double reversal unless documented chain allowed). For A0, entry may be reversed only once unless documented chain, enforced via partial unique index `UNIQUE (organization_id, reversal_of) WHERE reversal_of IS NOT NULL`.
- **Debit total = credit total:** Deferrable constraint trigger `trg_entry_balanced` AFTER INSERT OR UPDATE ON journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced() sums lines and raises if imbalance !=0.
- **Each journal has at least two lines:** Check in internal_post_journal: jsonb_array_length(p_lines) >=2 else raise JOURNAL_MIN_TWO_LINES.
- **No line has both debit and credit:** CHECK ((debit>0 AND credit=0) OR (debit=0 AND credit>0)) on journal_lines.
- **No zero-value line:** CHECK (debit>0 OR credit>0) and CHECK amount >0, plus assert_payment_omr.
- **Exact OMR 3-decimal precision:** All amounts numeric(12,3) or numeric(14,3) validated via `assert_payment_omr` (amount>0, scale 3). No float.
- **All accounts belong to same organization:** FK (organization_id, account_id) to chart_of_accounts org_id, plus trigger checks all lines same org as header.
- **Source document belongs to same organization:** FK or check that source doc's organization_id = journal's organization_id. For each source_type, lookup source table's org_id and compare.
- **Business RPC + journal posting occur in one PostgreSQL transaction:** Business RPC (e.g., record_customer_payment) does operational insert + internal_post_journal in same PL/pgSQL function, no separate transactions. If journal fails, whole tx fails.
- **If journal posting fails, business mutation fails too:** Due to same transaction.
- **Replaying idempotent business command does not create another journal:** Idempotency via canonical command_idempotency (org, scope, key) + fingerprint. begin_command checks existing, if found returns original payload without new journal. finish_command stores result. Unique index (org_id, idempotency_key) on journal_entries also prevents duplicate.

**Required columns and semantics:**
- id uuid PK default gen_random_uuid()
- organization_id uuid FK organizations, mandatory, tenant isolation.
- entry_number text unique per org e.g., JE-YYYY-NNNNN via document_sequences, for audit.
- entry_date date or timestamptz — accounting date, business date (paid_at, invoice_date, attendance date). Used for period reporting. Mandatory.
- event_at timestamptz nullable — when real-world event occurred if different from created_at (webhook time), from pgledger concept. For payment event_at = paid_at, invoice event_at = issued_at, attendance event_at = attendance date. Allows historical querying by event time vs DB time.
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
- Lines: id, org_id, entry_id FK, account_id FK chart_of_accounts, debit numeric(12,3) default 0, credit default 0, line_memo nullable, created_at.

## 14. Source Document Taxonomy

Stable taxonomy, avoid free-form. Use check constraint or enum `journal_source_type`.

Approved source types for A0/A1/B/C/D:

- `CUSTOMER_PAYMENT` — customer payment recorded
- `CUSTOMER_PAYMENT_VOID` — payment voided
- `CUSTOMER_DEPOSIT_APPLIED` — deposit allocated to invoice (auto or explicit)
- `CUSTOMER_DEPOSIT_RELEASED` — deposit released (reversal of applied)
- `INVOICE` — invoice issued
- `INVOICE_VOID` — invoice voided
- `REVENUE_RECOGNITION` — deferred → revenue at CLOSED
- `REVENUE_REVERSAL` — revenue reversal if event cancelled after recognition
- `EVENT_EXPENSE` — event expense paid immediately
- `EVENT_EXPENSE_VOID` — expense voided
- `HOST_EARNING` — attendance earning (staff cost accrual)
- `HOST_EARNING_VOID` — attendance void/correction reversal
- `HOST_PAYOUT` — host payout (payroll payable settlement)
- `HOST_PAYOUT_VOID` — payout void if supported
- `STAFF_ADVANCE` — staff advance asset creation
- `STAFF_ADVANCE_VOID` — advance void
- `STAFF_ADVANCE_SETTLEMENT` — advance settled against payroll payable
- `SUPPLIER_INVOICE` — supplier invoice (bill) creates AP
- `SUPPLIER_INVOICE_VOID` — supplier invoice void
- `SUPPLIER_PAYMENT` — supplier payment settles AP
- `SUPPLIER_PAYMENT_VOID` — supplier payment void
- `TREASURY_TRANSFER` — transfer between treasury accounts
- `OPENING_BALANCE` — opening balance at cutover
- `ADJUSTMENT` — manual adjustment if ever allowed (future)

Avoid free-form strings, use validated check. One source document may create multiple journals? Prefer deterministic 1-business-event → 1-accounting-event. For example, customer payment before invoice = 1 journal (Treasury→Deposits). Customer payment after invoice = 1 journal (Treasury→AR). Invoice issued + deposit allocation = 2 journals in same transaction: one for invoice (AR→Deferred), one for deposit allocation (Deposits→AR) triggered by same business event. Document that one business event may create multiple journals when allocation involved, but prefer 1:1 when possible.

**Event linkage:** journal entry org_id mandatory + event_id nullable for profitability + source_type/source_id, other entities via source doc joins, lines only account_id. Every event-related journal must have event_id populated for profitability reporting.

## 15. Posting Matrix

| Business Event | Preconditions | Debit | Credit | Source Document | Event Link | Reversal Event | Capability | Existing RPC / Future RPC |
|---|---|---|---|---|---|---|---|---|
| Quotation accepted | Quotation ISSUED, event not CANCELLED, quotation.manage | NO JOURNAL ENTRY | NO JOURNAL ENTRY | — | event_id | — | quotation.manage | accept_quotation (existing) |
| Invoice issued (before service) | Event not CANCELLED, has accepted_quotation_id, no existing ISSUED invoice (one per event now), total_amount>0, installments sum=total, invoice.manage | Accounts Receivable (1100) | Deferred Revenue (2100) | INVOICE | event_id, invoice_id | INVOICE_VOID | invoice.manage | create_event_invoice (existing enhanced) |
| Invoice issued (after service CLOSED) | Same + event CLOSED | Accounts Receivable | Event Revenue (4000) | INVOICE | event_id, invoice_id | INVOICE_VOID | invoice.manage | create_event_invoice |
| Invoice voided | Invoice ISSUED, reason>=3, invoice.manage, no payment allocation OR allocation reversed atomically | Deferred Revenue (if not yet recognized) OR Event Revenue (if recognized) | Accounts Receivable | INVOICE_VOID | event_id, invoice_id | — | invoice.manage | void_invoice (existing enhanced) |
| Customer payment before invoice | Event not CANCELLED, amount>0, payment.record, treasury_account_id exists active | Treasury (1000/1010 child) | Customer Deposits (2000) | CUSTOMER_PAYMENT | event_id, payment_id, customer_id | CUSTOMER_PAYMENT_VOID | payment.record | record_customer_payment (existing enhanced) |
| Customer payment after invoice | Same + invoice exists, outstanding>0, allocation auto if single invoice | Treasury | Accounts Receivable | CUSTOMER_PAYMENT | event_id, payment_id, invoice_id via allocation | CUSTOMER_PAYMENT_VOID | payment.record | record_customer_payment |
| Customer deposit applied to invoice | Invoice exists, Customer Deposits balance>0 for customer, invoice.manage | Customer Deposits | Accounts Receivable | CUSTOMER_DEPOSIT_APPLIED | event_id, invoice_id, payment_id (deposit source) | CUSTOMER_DEPOSIT_RELEASED | invoice.manage | create_event_invoice (auto allocation) or allocate_customer_deposit (future) |
| Customer payment voided | Payment RECORDED, reason>=3, payment.void | Customer Deposits (if payment was before invoice) OR Accounts Receivable (if payment was after invoice) | Treasury | CUSTOMER_PAYMENT_VOID | event_id, payment_id | — | payment.void | void_customer_payment (existing enhanced) |
| Revenue recognized at CLOSED | Event status transitions to CLOSED, Deferred Revenue balance>0 for event, event.manage | Deferred Revenue | Event Revenue | REVENUE_RECOGNITION | event_id | REVENUE_REVERSAL | event.manage (system) | transition_event_status (existing enhanced) |
| Event expense paid immediately | Event not CANCELLED, not financially closed, amount>0, finance.manage, treasury_account_id active | Direct Event Expense (5200) | Treasury | EVENT_EXPENSE | event_id, expense_id | EVENT_EXPENSE_VOID | finance.manage | record_event_expense (existing enhanced) |
| Event expense accrued (future) | Event not closed, supplier bill for expense, procurement.manage | Direct Event Expense | Accounts Payable | SUPPLIER_INVOICE (for expense) | event_id, supplier_invoice_id | SUPPLIER_INVOICE_VOID | procurement.manage | create_supplier_invoice (future) |
| Attendance earning (payroll accrual) | Assignment ACTIVE, attendance not VOIDED, status PRESENT/LATE/PARTIAL, earned_amount>0, attendance.record | Staff Cost (5000) | Payroll Payable (2300) | HOST_EARNING | event_id, staff_member_id, attendance_id | HOST_EARNING_VOID | attendance.record | record_attendance (existing enhanced) |
| Attendance void/correction | Attendance exists not already VOIDED, reason>=3, attendance.record or staff.manage | Payroll Payable | Staff Cost | HOST_EARNING_VOID | event_id, staff_member_id, attendance_id | — | attendance.record | void_attendance (existing) |
| Staff advance | Staff member exists, amount>0, payroll.pay, treasury_account_id active | Staff Advances Asset (1150) | Treasury | STAFF_ADVANCE | staff_member_id, advance_id | STAFF_ADVANCE_VOID | payroll.pay | record_staff_advance (existing enhanced) |
| Staff advance void | Advance RECORDED, reason, payroll.pay | Treasury | Staff Advances Asset | STAFF_ADVANCE_VOID | staff_member_id, advance_id | — | payroll.pay | void_staff_advance (future) |
| Advance settlement against payroll | Payroll Payable exists for staff, Advance Asset exists, payroll.pay | Payroll Payable | Staff Advances Asset | STAFF_ADVANCE_SETTLEMENT | staff_member_id, advance_id, event_id optional | reverse settlement | payroll.pay | settle_staff_advance (future) |
| Host payout | Payroll Payable exists, amount>0, treasury_account_id active, payroll.pay, event not financially closed for cost creation but settlement allowed (see §18) | Payroll Payable | Treasury | HOST_PAYOUT | event_id nullable (if multi-event), staff_member_id, payout_id | HOST_PAYOUT_VOID | payroll.pay | record_host_payout_multi (existing enhanced) |
| Host payout void | Payout RECORDED, reason, payroll.pay | Treasury | Payroll Payable | HOST_PAYOUT_VOID | staff_member_id, payout_id | — | payroll.pay | void_host_payout (existing) |
| Purchase order | Supplier exists, lines>0, procurement.manage | NO JOURNAL ENTRY | NO JOURNAL ENTRY | — | procurement_order_id, event_id optional | — | procurement.manage | create_procurement_order (existing) |
| Goods receipt | PO CONFIRMED/PARTIALLY_RECEIVED, qty>0, warehouse.dispatch or procurement.manage | NO JOURNAL ENTRY (operational only) — future if inventory asset: Dr Inventory Asset Cr GRNI | NO JOURNAL ENTRY | — | procurement_order_id, receipt_id | — | procurement.manage / warehouse.dispatch | receive_procurement_order (existing) |
| Supplier invoice (direct event cost) | PO exists, receipt exists for CONSUMABLE (if required), qty<=received and <=ordered, price exact match or owner override, procurement.manage | Procurement Cost (5100) | Accounts Payable (2200) | SUPPLIER_INVOICE | procurement_order_id, supplier_id, event_id optional, invoice_id | SUPPLIER_INVOICE_VOID | procurement.manage | create_supplier_invoice (future) |
| Supplier invoice void | Invoice ISSUED, reason, procurement.manage, no payment allocation or allocation reversed | Accounts Payable | Procurement Cost | SUPPLIER_INVOICE_VOID | supplier_id, invoice_id | — | procurement.manage | void_supplier_invoice (future) |
| Supplier payment | AP balance>0, amount>0, treasury_account_id active, finance.manage | Accounts Payable | Treasury | SUPPLIER_PAYMENT | supplier_id, payment_id, invoice_id via allocation | SUPPLIER_PAYMENT_VOID | finance.manage | record_supplier_payment (future) |
| Supplier payment void | Payment RECORDED, reason, finance.manage | Treasury | Accounts Payable | SUPPLIER_PAYMENT_VOID | supplier_id, payment_id | — | finance.manage | void_supplier_payment (future) |
| Treasury transfer | From and to treasury accounts exist active same org, amount>0, from balance>=amount (no negative), finance.manage | Destination Treasury (e.g., 1011 Bank) | Source Treasury (e.g., 1001 Cash) | TREASURY_TRANSFER | from_treasury_id, to_treasury_id | reverse transfer | finance.manage | treasury_transfer (future) |
| Equipment loss (damage/lost) | Warehouse reconciliation shows damaged/lost qty>0, valuation>0, event CLOSED, warehouse.reconcile | Damage/Loss Expense (5300 or 5200) | Equipment Asset (1300) — DEFERRED until asset exists, else NO JOURNAL ENTRY operational only | — (deferred) or EVENT_EXPENSE if operational | event_id, equipment_capacity_id | — | warehouse.reconcile | reconcile_event_warehouse (existing) — no journal now, future |
| Consumable waste | Waste movement WAREHOUSE_WASTE or WASTE_AT_EVENT, qty>0, consumable.manage or stock.adjust | Direct Event Expense or Waste Expense | Inventory Asset (if adopted) else NO JOURNAL ENTRY operational only | — (deferred) | event_id optional, stock_item_id | — | consumable.manage | waste_consumable_stock (existing) |
| Opening balance at cutover | Cutover date chosen, finance.manage, org owner | Treasury / AR / Staff Advances / Inventory (if adopted) | Opening Balance Equity (3000) OR reverse | OPENING_BALANCE | org_id, treasury_id etc | reverse opening | finance.manage | opening_balance_journal (future internal) |

If intentionally NO JOURNAL ENTRY, stated explicitly above.

## 16. Historical Cutover Policy

**Context:** Application already has historical customer_payments, invoices, event_expenses, procurement, attendance earnings, staff_advances, host_payouts, event_financial_closures before ledger exists.

**Strategies evaluated:**

**Strategy A — Deterministic Historical Backfill:** Generate accounting journals from existing canonical historical facts. Requirements: deterministic, idempotent, reconcilable, no invented facts, all totals reconcile to current read models, safe to rerun, no duplicate journals, clear rules for historical records lacking treasury-account attribution.

Pros: full audit trail in ledger, all history in one place. Cons: historical payments lack treasury_account_id, so would need to invent treasury account (e.g., default to Main Cashbox) violating no invented facts. Also historical records may have no fingerprint, need to generate deterministic idempotency keys from existing ids.

**Strategy B — Cutover with Opening Balances:** Choose cutover timestamp/date. Historical business facts remain in existing ledgers (customer_payments, etc). Create opening balances for treasury, AR, customer deposits, AP, payroll payable, staff advances, other required accounts. New business activity posts to journal from cutover forward. Must clearly prevent dashboards from pretending pre-cutover journal history exists (e.g., ledger queries filter entry_date >= cutover).

Pros: no invented facts, safe to rerun, no need to guess treasury attribution for old records, existing read models remain canonical for pre-cutover period. Cons: ledger does not contain full history, need two sources for historical reporting until backfill optionally done later.

**Strategy C — Conditional Strategy:** If real production database contains no material financial history, full clean ledger start may be possible (opening balances zero). If meaningful production history, choose backfill or opening balances. If production data cannot be inspected safely in this session, do not guess. Instead define recommended default, define exact preflight query/report needed before implementation, define what result selects Backfill vs Opening Balance.

**Required decision: One recommended cutover policy, not unresolved.**

**Recommendation: Strategy B — Cutover with Opening Balances as default, with conditional check via preflight.**

Why:
- Historical records lack treasury_account_id, so backfill would require inventing treasury account, violating no invented facts and reconcilability.
- Existing operational tables already have idempotency and audit, and are canonical for pre-cutover period. Ledger as projection can start from cutover forward with opening balances snapshot.
- Safer, idempotent, no duplicate, clear rules.
- If production has no material history (counts zero), opening balances zero = clean start, equivalent to Strategy C clean start.
- Only if treasury attribution can be reconstructed (owner confirms all historical payments were cash, etc.) and owner explicitly approves, then backfill could be considered, but default is opening balances.

**Preflight query/report needed before implementation (to be run on production replica, not in this session):**

```sql
-- Preflight for cutover decision
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
  (SELECT COUNT(*) FROM event_financial_closures WHERE reopened_at IS NULL) AS active_closures_count;
```

**Decision logic:**
- If all counts =0 and sums =0 → no material financial history → clean start, opening balances zero, cutover date = now, ledger starts empty.
- If counts >0 but treasury attribution missing → Opening Balances (default): cutover timestamp = now (or start of current month Asia/Muscat), owner inputs opening treasury balances per treasury account (Main Cashbox 1000 OMR, Bank Muscat 5000 OMR) via UI, system creates opening journals Dr Treasury Cr Opening Balance Equity. System calculates AR as sum issued invoices − sum allocated payments at cutover, Deposits as sum unapplied payments, Payroll Payable as sum earned − sum payouts, Staff Advances as sum advances, Deferred as sum invoices where event not yet CLOSED, Opening Balance Equity balancing figure.
- If owner can reconstruct treasury attribution for historical payments and explicitly approves backfill, then Backfill deterministic idempotent safe to rerun: for each historical payment, idempotency_key = deterministic UUID v5 from payment id, fingerprint = SHA-256 canonical payload, treasury_account_id = owner-provided default, journal Dr Treasury Cr Customer Deposits or AR based on whether invoice existed at payment time (check invoice created_at vs payment paid_at). Must be idempotent safe to rerun, no duplicate, totals reconcile within 0.001 OMR.

**Default:** Opening Balances with owner-provided treasury opening balances, system-calculated AR/Deposits/Payroll Payable/Advances/Deferred from existing tables at cutover timestamp.

**Prevent dashboards pretending pre-cutover journal history exists:** Ledger queries filter entry_date >= cutover_date, dashboard shows note "Accounting ledger starts from <cutover_date>, historical totals from operational ledgers". Or flag is_opening_balance and hide pre-cutover.

**Existing closure snapshots and historical records:** Do not rewrite historical `event_financial_closures` rows. Historical closures remain authoritative snapshots for pre-ledger periods. If backfilling, reconciliation requirement: backfilled ledger totals at closure time must match closure snapshot revenue/collected/outstanding/costs/profit/margin within 0.001 OMR tolerance, else flag mismatch. If opening balances, historical closures remain as is, new closures after cutover will have ledger-backed snapshots.

**Opening balances required for:** Treasury (per treasury account) — owner-provided, not derived, via opening balance journal Dr Treasury Cr Opening Balance Equity; AR — system-calculated sum issued invoices − allocated payments; Customer Deposits — sum unapplied customer payments; AP — 0 initially (no supplier invoices); Payroll Payable — sum earned − payouts; Staff Advances — sum advances RECORDED; Deferred Revenue — sum invoices where event not yet CLOSED; Opening Balance Equity — balancing figure.

## 17. Reconciliation Contract

Before implementation, define how we will prove new ledger agrees with existing product truths.

**Stage 1:** Existing business tables remain canonical domain facts. Ledger posts synchronously in same transaction.

**Stage 2:** Reconcile ledger totals against existing views:

- Customer payments: Σ journal_lines where account = Treasury and source_type = CUSTOMER_PAYMENT per org must equal Σ customer_payments RECORDED amount per org (exact, 0.001 tolerance). Treasury breakdown per treasury account must sum to total.
- Customer outstanding: Existing outstanding_balance = accepted_revenue − amount_paid. Accounting AR outstanding = Σ AR debits − Σ AR credits per event. These represent different concepts intentionally: commercial outstanding vs accounting AR outstanding. For reconciliation, commercial outstanding should equal accounting (Customer Deposits + AR + Deferred?) Documented in §21 equations.
- Invoice outstanding: invoice_summaries remaining_balance derived from payments ledger. Accounting AR outstanding per invoice = invoice total − sum allocations. Should reconcile exactly if allocation logic matches existing derivation (single invoice per event).
- Event expenses: Σ event_expenses RECORDED per event must equal Σ journal_lines where account = Direct Event Expense and source_type = EVENT_EXPENSE per event, exact.
- Staff earned amount: Σ staff_attendance earned_amount non-VOIDED per event must equal Σ journal_lines where account = Staff Cost and source_type = HOST_EARNING per event, exact.
- Staff payouts: Σ host_payouts RECORDED per staff must equal Σ journal_lines where account = Payroll Payable debit and source_type = HOST_PAYOUT, exact.
- Staff advances: Σ staff_advances RECORDED per staff must equal Σ journal_lines where account = Staff Advances Asset debit, exact.
- Procurement costs: event_procurement_cost_summaries active_committed_cost / delivered_cost derived from procurement orders. Accounting Procurement Cost = Σ supplier_invoices (future) for event. For now before supplier invoices, procurement cost remains operational only, no ledger yet. Reconciliation: procurement cost operational vs accounting 0 until supplier invoices introduced, then exact when supplier invoices represent procurement cost.
- Event profitability: event_finance_summaries accepted_revenue, amount_paid, outstanding, staff_cost, procurement_cost, expense_cost, actual_cost, actual_profit, margin_percent. Accounting recognized_revenue may differ from accepted_revenue until CLOSED. At CLOSED, recognized_revenue should equal accepted_revenue (if full). Actual_cost accounting = staff_cost + procurement_cost (from supplier invoices when available, else from procurement orders) + expense_cost should reconcile exactly to existing actual_cost if supplier invoices not yet introduced, else procurement_cost may differ.

**Which values reconcile exactly vs intentionally different:**
- Exact: customer payments total, event expenses total, staff earned total, staff payouts total, staff advances total, invoice total, treasury total if opening balances correct.
- Intentionally different: accepted_revenue (commercial) vs recognized_revenue (accounting) until CLOSED, outstanding commercial vs AR outstanding until invoice issued, procurement committed cost vs invoiced cost until supplier invoices.

**Reconciliation reports to build in Stage 2:**
- reconciliation_customer_payments(org) — operational vs ledger
- reconciliation_event_expenses(org)
- reconciliation_staff_earnings(org)
- reconciliation_invoices(org)
- reconciliation_treasury(org) — treasury balances derived vs expected from opening + movements
- reconciliation_closure_snapshots(org) — old closures vs ledger at closure time

## 18. Financial Closure Contract

**Current financial closure requires customer outstanding to be settled (outstanding_balance<=0).**

**Default proposed rule validated against domain:**

- Customer AR readiness may block event financial close. Yes, existing event_financially_ready requires accepted_revenue>0 AND outstanding_balance<=0. Remain, but also require deferred revenue=0 (revenue recognized). So add check recognized_revenue = accepted_revenue? Or deferred=0.
- Supplier AP does NOT block close. Event may be complete while supplier invoice due later. Supplier payments may be later. So AP does not block close. Outstanding supplier liability snapshotted and reported.
- Unrecognized/deferred event revenue must be recognized before close: Yes, require revenue recognized (event status CLOSED, so deferred=0) before financial close. So financial close preconditions: event status CLOSED (operationally closed) + accepted_revenue>0 + outstanding_balance<=0 + deferred_revenue=0.
- Payroll earning must be finalized: Attendance finalization? Existing staff_cost check in event_financial_readiness is informational, not blocking. For closure, payroll earning should be finalized? If no staff assigned, staff_cost 0 ok. If staff assigned but attendance not recorded, should block? For A0, keep staff_cost informational not blocking, but snapshot it.
- Unresolved warehouse/consumable reconciliation already blocks lifecycle close: Yes, existing readiness model blocks operational CLOSED if warehouse outstanding >0 or consumable not reconciled. Since financial close requires CLOSED, then warehouse/consumable already resolved.
- Which accounting mutations become blocked after financial close: Currently guard blocks customer_payments, host_payouts, staff_attendance, event_expenses. Extend to supplier_invoices linked to event (cost creation) and event_expenses, staff_attendance, customer_payments (collection). Which liabilities may still be paid after event close? Paying previously recognized supplier/payroll liability later may still be legitimate. Do not prevent settlement of valid liabilities after event is closed.

**Proposed blocking after financial close:**

- Blocked (cost creation, revenue, collection that changes economics):
  - record_customer_payment for that event
  - create_event_invoice / void_invoice for that event
  - record_event_expense / void_event_expense for that event
  - record_attendance / void_attendance for that event
  - create_supplier_invoice linked to that event
  - advance settlement linked to closed event (if changes payable? Actually settlement is liability settlement, should be allowed, see below)

- Allowed (liability settlement of previously recognized amounts):
  - record_supplier_payment settling AP that was recognized before close (supplier invoice already existed before close)
  - record_host_payout settling Payroll Payable recognized before close (attendance already existed before close)
  - treasury_transfer not linked to event allowed
  - advance settlement for closed event if payable existed before close (liability settlement)

**Implementation:** guard_event_financially_closed() currently blocks INSERT/UPDATE/DELETE on customer_payments, host_payouts, staff_attendance, event_expenses. For new tables, add similar triggers but with distinction: for supplier_invoices, block INSERT if event has active closure (cost creation). For supplier_payments and host_payouts, allow if corresponding invoice/payable existed before closure (check created_at < closure closed_at). Requires storing payable creation time and checking.

For A0, document distinction, and for A1 foundation, keep existing guard as is (blocks all), but for future tranches, implement nuanced guard.

**Default rule summary:**
- Customer AR readiness blocks financial close (outstanding must be 0)
- Supplier AP does NOT block close, but snapshotted and reported
- Deferred revenue must be 0 (revenue recognized) before close
- Warehouse/consumable reconciliation already blocks operational CLOSED, thus indirectly blocks financial close if we require CLOSED
- After financial close, cost creation blocked, liability settlement of pre-close recognized amounts allowed (supplier payments, host payouts, advance settlements)

## 19. Existing Closure Snapshots and Historical Records

- Do not rewrite historical closure rows. event_financial_closures is append-only cycle history, not boolean. Each row closure episode, reopen sets reopened_at/by/reason never erases previous close. Current financially closed iff row with reopened_at IS NULL, partial unique index ensures at most one active per event.
- Historical closures remain authoritative snapshots for pre-ledger periods. They capture revenue_at_close, collected_at_close, outstanding_at_close, costs_at_close, profit_at_close, margin_at_close from event_finance_summaries at close time.
- If backfilling: Reconciliation requirement — backfilled ledger totals at closure time (entry_date <= closed_at) must match closure snapshot within 0.001 OMR tolerance for revenue, collected, outstanding, costs, profit, margin. If mismatch, flag and require owner review. Backfill must be deterministic and idempotent, safe to rerun, no duplicate journals (unique org+idempotency_key).
- If opening balances (recommended): Historical closures remain as is, no reconciliation needed for pre-cutover. New closures after cutover will have enhanced snapshot including treasury breakdown and supplier liabilities, and will be ledger-backed (snapshot from ledger balances at close time).

## 20. Compatibility Strategy

**Ledger must initially be accounting projection integrated transactionally with existing business facts, not immediate destructive replacement for every existing read model.**

**Stage 1:** Existing business tables remain canonical domain facts (customer_payments, invoices, event_expenses, staff_attendance, staff_advances, host_payouts, procurement_orders, etc). Ledger posts synchronously in same transaction via internal_post_journal called by business RPCs. If ledger posting fails, business mutation fails too (atomic). Existing views (event_finance_summaries, etc) remain unchanged.

**Stage 2:** Reconcile ledger totals against existing views via reconciliation reports (see §17). Prove exact match for payments, expenses, earnings, payouts, advances, invoices, treasury.

**Stage 3:** Introduce accounting-specific read models: account_balance, journal_history, treasury_balances, ar_aging, ap_aging, customer_statement enhanced with allocation, supplier_statement, staff_payable, etc., gated by cost.visibility/finance.manage.

**Stage 4:** Only replace existing financial derivations when equivalence proven and product semantics require it. For example, event_finance_summaries.accepted_revenue remains commercial_value for backward compatibility, but new field recognized_revenue from ledger could be added. Do not rewrite event_finance_summaries in Tranche A unless strictly necessary. Keep backward compatibility for customer 360, event workspace, financial closure, management metrics, office documents, tests.

**Explicit compatibility contract:**
- event_finance_summaries.accepted_revenue remains commercial value (accepted quotation total_selling), not redefined as accounting recognized revenue. For backward compat, keep name, but document as commercial_value.
- Future accounting read models require separate fields: commercial_value (existing accepted_revenue), recognized_revenue (from ledger, at CLOSED), invoiced_amount (from invoices), collected_amount (from payments), customer_deposits (from Customer Deposits liability), accounts_receivable (from AR).
- Existing frontend that consumes accepted_revenue continues working unchanged.
- New accounting fields added as new columns or new views, not renaming old.
- Office documents (customer_statement, etc) continue using existing functions until accounting-enhanced versions proven.
- Tests that pin existing behavior remain green.

## 21. Required Account Balance Equations

Define accounting equations system must be able to prove via pgTAP invariants:

- **Treasury Balance (per treasury account):** Treasury Balance = Opening Treasury (from OPENING_BALANCE journals) + Σ Treasury Debits (customer payments, supplier payment voids, etc) − Σ Treasury Credits (event expenses, host payouts, staff advances, supplier payments, treasury transfers out). Equation: `treasury_balance = opening + debits − credits`. Must never go negative for CASH (and initially for BANK) if positive_only guard.
- **Customer AR:** Customer AR (per customer, per event, per invoice) = Invoiced AR (Σ INVOICE journals Dr AR) − Payment Allocations (Σ CUSTOMER_PAYMENT and CUSTOMER_DEPOSIT_APPLIED journals Cr AR) − Credit/Reversal Adjustments (Σ INVOICE_VOID and CUSTOMER_PAYMENT_VOID reclassifications). Unapplied payments remain Customer Deposits, not negative AR. Invariant: AR balance >=0 per invoice, per customer, per org. No negative AR artifacts.
- **Customer Deposits:** Customer Deposits (per customer) = Unapplied Customer Payments (Σ CUSTOMER_PAYMENT before invoice Dr Treasury Cr Deposits) + Σ payment voids that become deposits + Σ invoice voids that reclassify allocated payments to deposits − Σ deposit allocations to AR (CUSTOMER_DEPOSIT_APPLIED). Equation: `deposits = unapplied_payments`. Invariant: Deposits >=0.
- **Deferred Revenue:** Deferred Revenue (per event) = Invoiced amount where service not yet earned (Σ INVOICE Dr AR Cr Deferred) − Recognized amount (Σ REVENUE_RECOGNITION Dr Deferred Cr Revenue). At CLOSED, Deferred should be 0. Invariant: Deferred >=0.
- **Event Revenue:** Recognized Revenue (per event) = Σ REVENUE_RECOGNITION Cr Revenue. At CLOSED, should equal commercial_value (accepted_revenue) if full recognition, else partial.
- **Payroll Payable:** Payroll Payable (per staff, per event) = Earned Payroll (Σ HOST_EARNING Dr Staff Cost Cr Payable) − Settled Advances (Σ STAFF_ADVANCE_SETTLEMENT Dr Payable Cr Advance) − Payouts (Σ HOST_PAYOUT Dr Payable Cr Treasury). Equation: `payable = earned − advances_settled − payouts`. Invariant: Payable can be >=0? Could be negative if overpaid? For simplicity, allow negative with warning but preferably >=0.
- **Staff Advances Asset:** Staff Advances (per staff) = Advances issued (Σ STAFF_ADVANCE Dr Advance Cr Treasury) − Advances settled (Σ SETTLEMENT Dr Payable Cr Advance) − Advance voids. Equation: `advances = issued − settled`. Invariant: >=0.
- **Supplier AP:** Supplier AP (per supplier, per event, per invoice) = Supplier Invoices (Σ SUPPLIER_INVOICE Dr Cost Cr AP) − Supplier Payments (Σ SUPPLIER_PAYMENT Dr AP Cr Treasury) − Reversals. Equation: `ap = invoices − payments`. Invariant: AP >=0 per invoice.
- **Procurement Cost:** Procurement Cost (per event) = Σ SUPPLIER_INVOICE Dr Procurement Cost (if direct event cost) OR from operational procurement cost summaries until supplier invoices introduced. Should reconcile.
- **Event Expense:** Event Expense (per event) = Σ EVENT_EXPENSE Dr Expense Cr Treasury, exact match to event_expenses table.
- **Accounting Equation:** Assets (Treasury + AR + Staff Advances + Inventory if adopted) = Liabilities (Customer Deposits + Deferred Revenue + AP + Payroll Payable + GRNI) + Equity (Opening Balance Equity + Retained Earnings) + (Revenue − Expenses). For trial balance, sum debits = sum credits across all journals per org.

These become future pgTAP invariants: trial balance zero, no negative AR, no negative Deposits, no negative Cash, etc.

## 22. Tax / VAT Boundary

**Existing VAT contract:** Migration 0077 optional VAT per organization, snapshotted onto issued quotation/invoice at issue time, never recalculated. Org settings vat_registered bool, vat_percent numeric(12,3) default 5.000, vat_registration_number. Quotation/invoice have pre_vat_total, vat_registered, vat_percent, vat_amount, vat_registration_number. Money rule: total = pre_vat + round(pre_vat×vat_percent/100,3). For VAT-registered org, total_selling and total_amount become VAT-INCLUSIVE final total.

**Decision: VAT / tax accounting is OUT OF SCOPE for A0/A1.**

Why:
- Current VAT is snapshot for document display, not double-entry tax liability. No tax accounts, no input tax, no tax payment.
- Introducing tax accounting prematurely would add complexity: invoice tax liability, input tax from supplier invoices, tax payment, tax reports.
- For A0/A1, keep revenue as VAT-inclusive total (existing behavior) and document future attachment point.

**Future attachment where tax would attach:**
- Invoice tax liability: When invoice issued for VAT-registered org, split total into pre-VAT revenue and VAT amount: Dr AR (total) Cr Revenue (pre_vat) Cr VAT Payable (vat_amount) — VAT Payable liability.
- Input tax: When supplier invoice for VAT-registered supplier, split: Dr Cost (pre_vat) Dr VAT Receivable (input tax) Cr AP (total) — VAT Receivable asset.
- Tax payment: Dr VAT Payable Cr Treasury (pay output tax to authority) and Dr Treasury? Actually VAT Receivable vs Payable net: Dr VAT Payable Cr VAT Receivable Cr Treasury for net payment, or separate.
- Tax reports: VAT summary per period.

**Do not silently build tax architecture from assumptions.** Explicitly state out of scope.

## 23. Capability Contract

Do not automatically create new capabilities. Prefer existing exact capabilities where business operation already has one.

| Operation | Candidate Capability | Existing? | Justification |
|---|---|---|---|
| Record customer payment | payment.record | Existing (0079) | Already used for record_customer_payment, keep |
| Void customer payment | payment.void | Existing | Already used |
| Invoice operations (create/void) | invoice.manage | Existing | Already used for create_event_invoice, void_invoice |
| Event expense (record/void) | finance.manage | Existing | Already used for record_event_expense, finance.manage is for financial operations |
| Staff advance (record/void) | payroll.pay | Existing | Payroll.pay for payroll payments, advances are payroll related, keep |
| Host payout (record/void) | payroll.pay | Existing | Already payroll.pay |
| Attendance earning (record/void) | attendance.record | Existing | Attendance.record for recording attendance, earning derived, keep |
| Supplier invoice / procurement bill (create/void) | procurement.manage | Existing | Procurement.manage for procurement orders, supplier invoices are procurement bills, keep |
| Supplier payment (record/void) | finance.manage | Existing | Finance.manage for financial operations, supplier payments are treasury out, keep |
| Treasury account administration (create/update/deactivate) | finance.manage | Existing | Finance.manage for treasury management |
| Treasury transfer | finance.manage | Existing | Finance.manage for treasury transfers |
| Ledger read (account balance, journal history, treasury balances, AR/AP aging) | cost.visibility | Existing | Cost.visibility for financial reads, already gates event_finance_summaries, customer_payment_summaries, etc. |
| Manual journal if ever added | finance.manage + maker-checker explicit future decision | Future | If manual journal ever required, separate explicit RPC with finance.manage + maybe settings.manage for maker-checker, not now. |

**No genuinely new capability required for A0/A1/B/C.** Existing 20 capabilities cover all future accounting actions. settings.manage remains OWNER-exclusive, not needed for accounting. finance.manage is broadest financial capability already (OWNER/MANAGER/ACCOUNTANT). Do not create accounting super-capability.

If in future manual journal needed, evaluate whether new capability journal.manage required, but for now out of scope.

## 24. A1 Boundary

After finishing A0, define exactly what A1 — Ledger Foundation is allowed to implement.

**A1 should include only:**

- Minimum system chart-of-accounts structure (active accounts: 1000 Cash, 1010 Bank, 1100 AR, 1150 Staff Advances, 2000 Customer Deposits, 2100 Deferred Revenue, 2200 AP, 2300 Payroll Payable, 3000 Opening Balance Equity, 4000 Event Revenue, 5000 Staff Cost, 5100 Procurement Cost, 5200 Direct Event Expenses) — 13 active system accounts, placeholders deferred but documented.
- Journal header table `journal_entries` with columns id, organization_id, entry_number (via document_sequences), entry_date, event_at, created_at, source_type (check taxonomy), source_id, idempotency_key unique per org, request_fingerprint, created_by, reversal_of, is_reversal, memo, event_id nullable.
- Journal lines table `journal_lines` with id, organization_id, entry_id FK, account_id FK, debit, credit, line_memo, created_at, checks no both debit+credit, no zero, amount>0, OMR precision.
- Balancing invariant: deferrable constraint trigger `trg_entry_balanced` after insert/update on journal_entries, function `assert_entry_balanced` sums lines.
- Immutability: triggers on journal_entries and journal_lines BEFORE UPDATE/DELETE raise exception, no destructive correction.
- Reversal primitive: function `reverse_journal_entry(p_org_id, p_entry_id, p_reason, p_idempotency_key)` that creates new opposite journal with reversal_of = original, is_reversal true, same total, audit.
- Internal posting primitive: `internal_post_journal(...)` SECURITY DEFINER no grants to authenticated, called only by other SECURITY DEFINER functions, validates balanced, OMR, org isolation, accounts same org, source doc same org, at least two lines.
- Account balance read model: function `account_balance(p_org_id, p_account_id)` returns balance = sum debits − sum credits (or sum credits − debits depending on normal balance), and `account_balance_at_time(p_org_id, p_account_id, p_at_time)` for historical, and `journal_history(p_org_id, p_account_id, ...)` for ledger.
- Source-document contract: check constraint on source_type in approved taxonomy (enum or check), source_id mandatory.
- Tenant isolation: every new table has organization_id, composite FKs, RLS enabled, no direct client grants, only SECURITY DEFINER functions, revoke all from anon/authenticated, grant execute to authenticated for read functions gated by has_permission.
- Capability-gated accounting reads: read functions check has_permission(cost.visibility) or payroll.read etc.
- Idempotency support: unique index (organization_id, idempotency_key) on journal_entries, request_fingerprint, begin/finish pattern via canonical command_idempotency or new journal_idempotency table, advisory lock.
- Tests: pgTAP for invariants, but not implemented in A0 (only listed as acceptance tests for A1).

**A1 should NOT automatically integrate every business RPC.** Business integration should happen incrementally after foundation verification.

**Safest split proposed:**

- A0 — Accounting Contract (this doc)
- A1 — Ledger Foundation (chart, journal header/lines, balancing, immutability, reversal, internal posting, balance read model, source taxonomy, tenant isolation, capability-gated reads, idempotency, tests)
- B — Treasury Accounts (treasury_accounts table, transfer, opening balances, integration with payments)
- A2 — Customer AR / Deposits / Invoice Integration (customer_payment_allocations, enhanced record_customer_payment to post journal, create_event_invoice to post journal, deposit applied, revenue recognition at CLOSED)
- A3 — Payroll Accrual Integration (attendance earning → Staff Cost/Payroll Payable, advance, payout, settlement)
- C — Supplier AP (supplier_invoices, supplier_payments, allocations, statement, aging)
- D — Procurement 3-Way Match (link PO/receipt/invoice, match check)
- E — Inventory Ledger View (unified view, low-stock alerts)
- F — Event Financial Closing Enhancement (enhanced snapshot with treasury/AP, nuanced guard)
- G — Management Financial Dashboard (treasury balances, AR/AP aging, cash flow, profit)

Order A1 → B → A2 → A3 → C → D → E → F → G respects dependencies: ledger foundation first, treasury needed for payment attribution, customer AR needs treasury, payroll needs treasury, supplier AP needs treasury, 3-way needs supplier invoices, etc. Change split if repo analysis justifies better dependency order, but this respects dependencies.

## 25. No Implementation in This Session & Deliverable Quality

**Binding: Do not create 0081 migration, journal tables, new RPCs, new enums, new TS types, new React components, new tests, new dependencies. Do not modify application behavior. Allowed repository change: `docs/research/accounting-posting-contract.md` only. Update previous research doc only if factual correction necessary. No production DB mutation. No Supabase remote migration. No Vercel deployment changes. No PR.**

Compliance: Only this file created, no other files modified, no migrations, no SQL functions, no frontend code, no generated types, no dependencies, no tests. Previous research doc untouched.

**Required Deliverable — This Document Contains Exact Sections 1-25:**

1 Repository Verification, 2 Current Accounting Reality, 3 Accounting Basis Decision, 4 Revenue Recognition Contract, 5 Customer Deposits AR Invoice & Allocation Contract, 6 Payroll Accrual & Staff Advance Contract, 7 Expense Contract, 8 Supplier Procurement AP Contract, 9 Inventory Accounting Boundary, 10 Treasury Contract, 11 Minimum Chart of Accounts, 12 Posting Security Boundary, 13 Journal Invariants, 14 Source Document Taxonomy, 15 Posting Matrix, 16 Historical Cutover Policy, 17 Reconciliation Contract, 18 Financial Closure Contract, 19 Existing Closure Snapshots and Historical Records, 20 Compatibility Strategy, 21 Required Account Balance Equations, 22 Tax VAT Boundary, 23 Capability Contract, 24 A1 Boundary, 25 No Implementation & Deliverable Quality.

**Quality Standard:** This A0 contract makes it possible for different engineer in completely new session to implement A1 without inventing accounting policy. It defines when revenue earned (CLOSED), what happens to pre-invoice payments (Dr Treasury Cr Customer Deposits), when payroll cost arises (attendance creation PRESENT/LATE/PARTIAL), how advances work (Dr Advance Asset Cr Treasury, settlement Dr Payable Cr Advance), when AP arises (supplier invoice, not PO/receipt), what financial close means (customer AR must be settled, supplier AP does NOT block, deferred must be 0, cost creation blocked after close but liability settlement allowed), how old records enter ledger (cutover with opening balances default, preflight query defined), which RPC allowed to post what (internal_post_journal internal only, business RPCs external surface with existing capabilities), which capability authorizes action (payment.record, payment.void, invoice.manage, finance.manage, payroll.pay, attendance.record, procurement.manage, cost.visibility), how reversal works (new opposite journal with reversal_of reference, only once, immutable).

Optimized for correct accounting semantics, minimal operator complexity, explicit business-event postings, no negative AR artifacts, no double counting, no second source of truth, append-only financial history, tenant isolation, idempotency, backward compatibility, clean cutover, simple future implementation.

We are ready to begin A1 — Ledger Foundation with minimum system chart, journal header/lines, balancing invariant, immutability, reversal primitive, internal posting primitive, account balance read model, source-document taxonomy, tenant isolation, capability-gated reads, idempotency support, and tests, without yet integrating every business RPC. Cutover policy is opening balances default with preflight, VAT out of scope, treasury CASH positive_only, no negative cash, transfer semantics defined, chart minimal 13 active system accounts.

A1 READY
