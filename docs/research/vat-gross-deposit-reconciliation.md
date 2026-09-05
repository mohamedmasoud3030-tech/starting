# 0095 Design — VAT Gross-Deposit Reconciliation & Cutover Parity (Contract §16/§17)

Tranche: fix the Stage-2 gross-deposit invariant for VAT-registered orgs.
Status: IMPLEMENTED (this file is the pre-code implementation contract).

## 1. Reality Gate (verified 2026-09-05)

- `origin/main` = `58f97e8e5b53148b708faf6314f232653dcf6dc3`; local tree clean.
- 95 migrations; highest = `20260904170000_0094_accounting_read_models.sql`.
- Fresh search of **every ref** (`main`, `feat/ai-operations-assistant`, all
  `pr/*` refs): no `0095`+ migration exists anywhere. `0095` is proven free.
- Open PRs: none. No parallel financial implementation on any branch.

## 2. Problem statement and contract basis

Contract `docs/research/accounting-posting-contract.md`:

- **§17** — "Deposits gross = max(P_gross − I_gross, 0)" (invoiced) and
  "max(P_gross − Q_gross, 0)" (CLOSED unbilled); the reconciliation equation
  is `outstanding = (AR + Contract Asset) − Deposits` with deposits **gross**,
  and "Exact: … outstanding commercial vs accounting (AR+Contract
  Asset−Deposits) exact."
- **§16** (line 74) — cutover openings "keep opening AR gross and opening
  Deposit gross as gross amounts" (opening deposits are posted GROSS because
  historical payments have no VAT snapshot).
- Merged `docs/research/operator-accounting-read-models.md` §12 explicitly
  deferred the decision: "A future tranche should decide whether
  reconciliation uses gross (adding deposit VAT back) or net…". The contract
  answers **gross**. This tranche is that deferred tranche.

The ledger itself is sound: for a VAT org a deposit posts `Dr Treasury gross /
Cr 2000 net / Cr 2150 VAT` and the books balance. Only three READ surfaces
mis-read the deposit liability by ignoring the VAT component held in `2150`.

## 3. Lifecycle proof (VAT org, 5% rate, derived from 0086/0087 posting code)

Event E, quotation gross 2100 / net 2000 / VAT 100, uninvoiced.

1. **Payment** `record_customer_payment(E, 1050)` (0086): `_customer_gross_vat`
   splits gross → net 1000, VAT 50 (from the ACCEPTED quotation snapshot).
2. **VAT split** lives in the same journal entry, no separate document.
3. **Ledger posting** (one entry, `source_type='CUSTOMER_PAYMENT'`, event-scoped):
   `Dr Treasury 1050 / Cr 2000 1000 / Cr 2150 50`.
   - Gross customer deposit = Cr 2000 + Cr 2150 (payment-source) = 1050.
   - VAT liability = Cr 2150 = 50 (tax point at receipt, Oman VAT).
   - Net customer balance = Cr 2000 = 1000.
4. **Customer balance**: operational `amount_paid` = 1050 gross; ledger net
   deposit = `−raw(2000)` = 1000; ledger gross deposit = 1000 + 50 = 1050.
5. **Reconciliation (§17)** must compare 1050 vs 1050. 0093 compares 1050 vs
   1000 → false `DIFFERENCE` of exactly the deposit VAT. **Defect.**
6. **Void** `void_customer_payment` (0086): builds the swapped reversal entry,
   `source_type='CUSTOMER_PAYMENT_VOID'`, same event_id, `is_reversal=true`:
   `Dr 2000 1000 / Dr 2150 50 / Cr Treasury 1050`. Journal-state sum over
   `source_type IN ('CUSTOMER_PAYMENT','CUSTOMER_PAYMENT_VOID')` on 2150 =
   +50 − 50 = 0; `−raw(2000)` = 0. Gross deposit back to 0. Any formula that
   counts only `CUSTOMER_PAYMENT` lines overstates gross by 50 after a void.
7. **Opening cutover (§16)**: first commit with an empty ledger posts the full
   gross to 2000 (correct per §16 line 74). **Late cutover** (ledger already
   holds the deposit): 0093 computes gap = gross_op − (−raw 2000) = 1050 −
   1000 = 50 and credits an EXTRA 50 to 2000 → deposit liability becomes
   1050 (in 2000) + 50 (still in 2150) = double-counted VAT. **Defect.**
8. **Read models**: 0094 `accounting_customer_positions.customer_deposits_gross`
   = `−raw(2000) + Σ(2150, source_type='CUSTOMER_PAYMENT')` — the void's
   Dr 2150 (source `CUSTOMER_PAYMENT_VOID`) is not subtracted → shows 50 gross
   deposit after a full void. **Defect (void case).**

Invoiced events: allocation (0087) moves NET only (`Dr 2000 net / Cr 1100
net`, `CUSTOMER_DEPOSIT_APPLIED`); the advance VAT stays in 2150 and is
absorbed into the invoice VAT via `remaining_vat = greatest(I_vat − alloc_vat,
0)` under source `INVOICE`. After full allocation `raw(2000) = 0`, so the
`outstanding` branch formula `AR_raw + CA_raw + dep_raw` is exact for the
contract's worked cases (proved by example: advance 1050 → invoice 2100 →
settle 1050 ⇒ AR 0, 2000 0, outstanding 0 ✓). CLOSED-unbilled recognition
posts `Dr 1120 (Q_net + remaining VAT) / Cr 4000 net / Cr 2150 remaining`,
so CA absorbs the remaining VAT and `CA_raw + dep_raw` equals commercial
outstanding without any depVAT addition — the `outstanding` branch must NOT
add deposit VAT (double count).

## 4. Surface comparison

| Surface | Current formula | Contract semantics | Correct? | Why |
|---|---|---|---|---|
| 0087 `_event_unallocated_deposits_gross` | operational Σ RECORDED payments − Σ allocations.gross | operational remaining gross | ✓ | Operational truth driving allocation; payments are gross by construction; not a ledger comparison |
| 0093 reconciliation `deposits` metric | `−raw(2000)` | gross deposit (§17) | ✗ VAT orgs | omits deposit VAT in 2150 → false DIFFERENCE = deposit VAT |
| 0093 cutover deposit gap | `gross_op − (−raw(2000))` | opening gross minus already-posted GROSS ledger (§16) | ✗ late cutover, VAT orgs | ledger side net-only → extra opening = deposit VAT (double-counted vs 2150) |
| 0093 cutover, first commit, empty ledger | posts full gross to 2000 | §16 line 74 gross opening | ✓ | unchanged |
| 0094 `customer_deposits_gross` | `−raw(2000) + Σ(2150, src='CUSTOMER_PAYMENT')` | net + deposit VAT (its §6.3 doc) | ✗ after voids | void Dr 2150 (src `CUSTOMER_PAYMENT_VOID`) not subtracted → phantom gross deposit |

## 5. Void / partial-application semantics (mandatory proof)

Correct source of truth = **current journal state**, not payment status:
every RECORDED payment has exactly one non-reversal `CUSTOMER_PAYMENT` entry;
every VOIDED payment has exactly one `CUSTOMER_PAYMENT_VOID` reversal with
swapped debits/credits (0086 builds the reversal from the original lines).
Therefore `Σ(credit − debit)` over 2150 lines with `source_type IN
('CUSTOMER_PAYMENT','CUSTOMER_PAYMENT_VOID')` equals the live deposit VAT:

- normal VAT deposit 1050 → +50 ✓
- fully voided deposit → +50 − 50 = 0 (no overstatement) ✓
- multiple deposits, one voided → sum of the survivors ✓
- partial application (invoiced) → deposit VAT stays in 2150, but net leaves
  2000 via allocation; the invariant is only applied where deposits can still
  exist (uninvoiced contexts), see §6. Overpayment-beyond-invoice leaves the
  contract's worked semantics (0087 clamps remaining VAT at 0) — documented
  limitation, unchanged by this tranche.

## 6. Decision — Option C: one canonical private helper

Create exactly one derivation; all consumers use it. No per-surface formulas.

```sql
create or replace function public._ledger_event_deposit_vat(
  p_org_id uuid, p_event_id uuid
) returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(l.credit - l.debit), 0)
    from public.journal_lines l
    join public.journal_entries e
      on e.organization_id = l.organization_id and e.id = l.entry_id
   where l.organization_id = p_org_id
     and e.event_id = p_event_id
     and e.source_type in ('CUSTOMER_PAYMENT','CUSTOMER_PAYMENT_VOID')
     and l.account_id = (select c.id from public.chart_of_accounts c
                          where c.organization_id = p_org_id
                            and c.code = '2150');
$$;
```

Returns the event-scoped **credit-normal** net deposit VAT (≥ 0 in valid
states). Non-VAT orgs: no such lines → 0 → behavior bit-identical.

Private `_` helpers DO appear in `src/lib/database.types.ts` (verified:
`_ledger_event_raw`, `_opening_customer_positions`, `_staff_payroll_position`
are present), so the new helper is an additive types change; regenerate via
`scripts/native-db/verify_local.mjs --fix-types` (byte-exact pg-meta replica).
No public signature changes anywhere.

### Changed consumers (CREATE OR REPLACE, identical signatures)

1. **`accounting_reconciliation`** — `deposits` branch (uninvoiced events
   only): `ledger_balance = −_ledger_event_raw(2000) +
   _ledger_event_deposit_vat(...)`. The `outstanding` branch is untouched
   (proven exact in §3; adding depVAT there would double count).
2. **`preview_opening_cutover`** (commit calls preview — untouched) —
   `v_dep_led = −_ledger_event_raw(2000)`; plus the helper **iff** the
   operational opening branch used gross-deposit semantics, i.e. the event is
   `CANCELLED` OR has no `ISSUED` invoice (mirrors `_opening_customer_positions`
   CASE logic exactly: CANCELLED → P_gross; invoiced → max(P−I,0); else gross).
3. **`accounting_customer_positions`** (0094) — replace the inline gross
   expression with the helper. Fixes the void overstatement; uninvoiced
   semantics identical; invoiced values unchanged (absorbed advance VAT still
   shown, as in 0094 — removing it would need the operational allocations
   table, which 0094 §5 architecture forbids for financial figures).

## 7. Security properties (unchanged model)

- Helper: `SECURITY DEFINER`, `stable`, `search_path=''`, `revoke all from
  public, anon, authenticated` (internal only, matches `_ledger_event_raw`).
- Redefined functions keep their existing gates: `cost.visibility`
  (reconciliation) / `cost.visibility or finance.manage` (preview) /
  `cost.visibility` (positions); `NOT_AUTHORIZED` errcode 42501; EXECUTE only
  to `authenticated`; no new tables, no RLS changes, no client ledger grants.
- Read-only tranche except cutover gap arithmetic (preview is read-only;
  commit path logic unchanged apart from the corrected preview).

## 8. Regression matrix (`supabase/tests/vat_gross_deposit_reconciliation.test.sql`)

F = fails on current main (proof of defect), P = passes before and after
(regression guard).

1. [F] VAT deposit 1050 → reconciliation `deposits` row: 1050/1050 MATCHED.
2. [F] positions: deposits_net 1000, deposits_gross 1050.
3. [F] full void → row 0/0 MATCHED; positions gross 0 (void correctness).
4. [F] two deposits, void one → gross = survivor only.
5. [F] late cutover with posted uninvoiced deposit → commit posts NO deposit
   opening; 2000 stays net; reconciliation MATCHED after commit.
6. [P] fresh cutover, pre-ledger gross payment (no journals) → opening posts
   GROSS to 2000 (§16), reconciliation MATCHED after commit.
7. [P] invoiced lifecycle: deposit → invoice → settle → `outstanding` MATCHED
   0 (guards against depVAT over-addition in the invoiced branch).
8. [P] CLOSED-unbilled with deposit → recognition → `outstanding` MATCHED
   (CA absorbs remaining VAT; no double count).
9. [P] non-VAT org deposit → MATCHED, gross = net (behavior unchanged).
10. [P] cross-org isolation + NOT_AUTHORIZED (no membership) on reconciliation
    and preview; one-shot cutover commit still rejected on repeat.

Trial-balance-zero assertions after each posting batch (journal invariant).

## 9. Non-scope / limitations (documented, unchanged)

- Overpaid-invoiced events (P_gross > I_gross): residual deposit VAT after
  allocation is outside the contract's worked examples (0087 clamps remaining
  VAT at 0). `outstanding`-branch behavior unchanged for them.
- Cutover run after a full on-ledger event lifecycle can produce negative
  "correction" gaps by 0093 design (preview/preflight is the review gate);
  unchanged here.
- Remaining §17 named reports (customer-payments total, invoices,
  closure_snapshots, vat_payable), §19 ledger-backed closure snapshots, and
  remaining Stage-3 surfaces (ar/ap aging, statements, contract-asset aging)
  are separate follow-up tranches.
- `feat/ai-operations-assistant` untouched.

## 10. Migration

- Number: `0095` (proven free on every ref; see §1).
- File: `supabase/migrations/20260905180000_0095_vat_gross_deposit_reconciliation.sql`.
- Content: one new private helper + three `CREATE OR REPLACE` redefinitions
  (bodies copied verbatim from 0093/0094 with only the surgical formula
  changes) + revoke/grant block. No ALTERs, no data changes.
- PG15 authoritative via CI (`postgres:15.8.1.085`); local PG18 harness is
  supplementary evidence only.
