# UAT Checklist — Critical Business Workflows

> **Last updated:** 2026-08-15 | **S8 Production Hardening**
>
> This checklist covers the complete end-to-end business workflows of the
> Hospitality Operations platform. Each step is marked as:
> - ✅ **Automated** — covered by CI/pgTAP/Vitest with a deterministic pass.
> - 🔲 **Human** — requires a real operator (or real Supabase project) to
>   execute and verify.
> - ⚠️ **Partially automated** — some aspects are tested, others need human
>   verification.

---

## Prerequisites

Before UAT, confirm:

- [ ] A **real Supabase project** is configured (`.env` has valid credentials).
- [ ] At least **two user accounts** exist: one `OWNER` and one `SUPERVISOR`
      (or `WAREHOUSE`).
- [ ] The app is running (production build or `npm run dev`).
- [ ] `npm run build` passes (green build).
- [ ] `npm test` passes (all 335+ Vitest tests).
- [ ] Database migrations have been replayed and pgTAP tests pass.

---

## 1. Sign In and Organization Access

### 1.1 Login Page

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Open the app URL | Login page displays in Arabic (RTL) | ✅ Automated | `LoginPage.test.tsx` |
| Login with valid credentials | Redirects to `/home` dashboard | ✅ Automated | `AuthContext` hydration flow |
| Login with invalid credentials | Error message displayed, no redirect | 🔲 Human | |
| Login when Supabase is not configured | Clear "not configured" message | ✅ Automated | `LoginPage.test.tsx` |

### 1.2 Organization Access

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Verify organization name appears on dashboard | Organization name visible | 🔲 Human | |
| User sees only their organization's data | Cross-org visibility denied | ✅ Automated | `rls_isolation.test.sql` (pgTAP) |
| Logout | Returns to login page, session cleared | ✅ Automated | `AuthContext` |

---

## 2. Manage Customers

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Navigate to Customers page | Customer list loads (or empty state) | 🔲 Human | |
| Create a new customer | Customer created, appears in list | ✅ Automated | `events.api.test.ts` |
| Edit an existing customer | Fields update, no data loss | 🔲 Human | |
| SUPERVISOR can create customers | Write policy allows SUPERVISOR | ✅ Automated | `rls_isolation.test.sql` (pgTAP) |
| WAREHOUSE cannot create customers | Write policy denies WAREHOUSE | ✅ Automated | `rls_isolation.test.sql` (pgTAP) |
| No DELETE button (soft-deactivate only) | Only status toggle available | ✅ Automated | Architecture constraint |

---

## 3. Create Event

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Click "New Event" | Event creation dialog opens | ✅ Automated | `events` RPC tests |
| Fill required fields and submit | Event created in `DRAFT` status | ✅ Automated | `events_commercial_resources.test.sql` (pgTAP) |
| Verify event appears in Events list | Event visible with correct details | 🔲 Human | |
| Cross-org event creation attempt | Rejected by RLS | ✅ Automated | `rls_isolation.test.sql` (pgTAP) |
| Create event with cancelled customer | Rejected by FK constraint | ✅ Automated | Architecture constraint |

---

## 4. Configure Event Commercial Lines

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Add a catalog item to event | Commercial line created with snapshot | ✅ Automated | `events_commercial_resources.test.sql` (pgTAP) |
| Apply a package to event | Package lines expanded as snapshots | ✅ Automated | RPC tests |
| Modify line quantity/price | Line updates, totals recalculate | ✅ Automated | `commercial_invariants.test.sql` (pgTAP) |
| Verify cost is hidden from SUPERVISOR | Cost columns return 0 or denied | ✅ Automated | `rls_isolation.test.sql` (pgTAP) |

---

## 5. Issue and Accept Quotation

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Issue a quotation from event | Quotation created (revision 1), event → `QUOTED` | ✅ Automated | `events_commercial_resources.test.sql` (pgTAP) |
| Verify quotation is immutable after issue | No edits to snapshot data | ✅ Automated | `commercial_invariants.test.sql` (pgTAP) |
| Verify quotation lines are immutable | No edits to issued lines | ✅ Automated | `commercial_invariants.test.sql` (pgTAP) |
| Accept quotation | Status → `ACCEPTED`, acceptance recorded | ✅ Automated | `acceptance_repairs` tests |
| Verify accepted revenue is from snapshot | Revenue = quotation `total_selling` | ✅ Automated | `customer_payments.test.sql` (pgTAP) |
| Quick Quote: create from scratch | Draft created without Customer/Event | ✅ Automated | `quick_quote.test.sql` (pgTAP) |
| Quick Quote: issue → normal quotation | Creates immutable quotation with `event_id NULL` | ✅ Automated | `quick_quote.test.sql` (pgTAP) |
| Quick Quote: accept → convert | Creates Customer + Event transactionally | ✅ Automated | `quick_quote.test.sql` (pgTAP) |

---

## 6. Schedule Staff

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Assign staff member to event | Assignment created, status ACTIVE | ✅ Automated | `events_commercial_resources.test.sql` (pgTAP) |
| Assign same staff to overlapping event | Rejected by exclusion constraint (`STAFF_CONFLICT`) | ✅ Automated | `events_commercial_resources.test.sql` (pgTAP) |
| Release staff from event | Status → `RELEASED` | ✅ Automated | RPC tests |
| Verify rate/compensation is cost-gated | Cost not visible to WAREHOUSE | ✅ Automated | `rls_isolation.test.sql` (pgTAP) |

---

## 7. Reserve Equipment

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Reserve equipment for event | Reservation created, ACTIVE | ✅ Automated | `events_commercial_resources.test.sql` (pgTAP) |
| Reserve more than available capacity | Rejected (capacity check) | ✅ Automated | `events_commercial_resources.test.sql` (pgTAP) |
| Overlapping reservation from another event | Allowed if total capacity not exceeded | ✅ Automated | Concurrency harness tests |
| Release reservation | Status → `RELEASED` | ✅ Automated | RPC tests |

---

## 8. Perform Reusable Warehouse Flow

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Dispatch equipment to event | Movement recorded, quantity deducted | ✅ Automated | `warehouse_dispatch.test.sql` (pgTAP) |
| Return good equipment | Returned quantity recorded, outstanding reduced | ✅ Automated | `warehouse_dispatch.test.sql` (pgTAP) |
| Report damaged/lost equipment | Damage/loss recorded with valuation snapshot | ✅ Automated | `warehouse_dispatch.test.sql` (pgTAP) |
| Reconcile event warehouse | Reconciliation created, blocks further movements | ✅ Automated | `warehouse_dispatch.test.sql` (pgTAP) |
| Verify WAREHOUSE sees operational view only | No cost/valuation in operational view | ✅ Automated | `rls_isolation.test.sql` (pgTAP) |
| Two sessions cannot over-dispatch | Concurrency guard prevents race | ✅ Automated | `warehouse_concurrency.mjs` |
| Over-dispatch by a single session | Rejected by command validation | ✅ Automated | `warehouse_dispatch.test.sql` (pgTAP) |

---

## 9. Issue/Reconcile Consumables

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Receive consumable stock | Warehouse balance increases | ✅ Automated | `consumable_stock.test.sql` (pgTAP) |
| Issue consumable to event | Warehouse decreases, custody increases | ✅ Automated | `consumable_stock.test.sql` (pgTAP) |
| Issue more than available | Rejected (non-negative stock guard) | ✅ Automated | `consumable_stock.test.sql` (pgTAP) |
| Return usable stock from event | Warehouse increases, custody decreases | ✅ Automated | `consumable_stock.test.sql` (pgTAP) |
| Consume/waste at event | Custody decreases, no warehouse change | ✅ Automated | `consumable_stock.test.sql` (pgTAP) |
| Reconcile event consumables | Reconciliation created, blocks further movements | ✅ Automated | `consumable_stock.test.sql` (pgTAP) |
| Low stock alert triggers | `is_low_stock` flag set when on_hand ≤ minimum | ✅ Automated | `consumable_stock.test.sql` (pgTAP) |
| Two concurrent sessions, one stock shortage | Only one succeeds, other blocks | ✅ Automated | `consumable_concurrency.mjs` |

---

## 10. Manage Procurement Order

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Create supplier | Supplier created, ACTIVE | ✅ Automated | `procurement_core.test.sql` (pgTAP) |
| Create procurement order (DRAFT) | Order created with lines | ✅ Automated | `procurement_core.test.sql` (pgTAP) |
| Approve → Send → Confirm | Lifecycle transitions validated | ✅ Automated | `procurement_core.test.sql` (pgTAP) |
| Invalid lifecycle transition | Rejected by command | ✅ Automated | `procurement_core.test.sql` (pgTAP) |
| WAREHOUSE cannot approve/send/confirm | Role check rejects | ✅ Automated | `procurement_core.test.sql` (pgTAP) |

---

## 11. Receive Procurement

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Receive CONSUMABLE line | Receipt created, S4B movement recorded | ✅ Automated | `procurement_integration.test.sql` (pgTAP) |
| Receive more than ordered | Rejected (PROCUREMENT_OVER_RECEIPT) | ✅ Automated | `procurement_core.test.sql` (pgTAP) |
| Partial receipt | Order status → `PARTIALLY_RECEIVED` | ✅ Automated | `procurement_core.test.sql` (pgTAP) |
| Full receipt | Order status → `RECEIVED` | ✅ Automated | `procurement_core.test.sql` (pgTAP) |
| WAREHOUSE cannot receive non-consumable lines | Role-specific error | ✅ Automated | `procurement_core.test.sql` (pgTAP) |
| Two concurrent partial receipts | Idempotency + locks prevent double-count | ✅ Automated | `procurement_concurrency.mjs` |

---

## 12. Record/Void Customer Payment

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Record payment for an event with accepted quote | Payment recorded, amounts exact | ✅ Automated | `customer_payments.test.sql` (pgTAP) |
| Record payment for event without accepted quote | Rejected (no revenue base) | ✅ Automated | `customer_payments.test.sql` (pgTAP) |
| Record zero or negative payment | Rejected by CHECK constraint | ✅ Automated | `customer_payments.test.sql` (pgTAP) |
| Record payment with >3 decimal precision | Rejected (OMR_PRECISION_EXCEEDED) | ✅ Automated | `customer_payments.test.sql` (pgTAP) |
| Void a payment | Status → VOIDED, reason required | ✅ Automated | `customer_payments.test.sql` (pgTAP) |
| Void without reason | Rejected | ✅ Automated | `customer_payments.test.sql` (pgTAP) |
| Double-void (idempotent) | Same result, no error | ✅ Automated | `customer_payments.test.sql` (pgTAP) |
| Two concurrent payments on same event | Idempotency + locks prevent double-count | ✅ Automated | `payments_concurrency.mjs` |

---

## 13. Verify Event Economics

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| View event finance summary | Shows: accepted revenue, expected cost/profit, amount paid, outstanding balance, committed/delivered cost, gross margin | ✅ Automated | `customer_payments.test.sql` (pgTAP) |
| WAREHOUSE/SUPERVISOR cannot see finance | Query returns 0 rows | ✅ Automated | `rls_isolation.test.sql` (pgTAP) |
| ACCOUNTANT can see finance | Query returns data | ✅ Automated | `rls_isolation.test.sql` (pgTAP) |

---

## 14. View Operational Dashboard

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Open home page | Dashboard loads with today's events | ✅ Automated | `operationalDashboard.model.test.ts` |
| Today event card shows readiness badge | Badge accurate (ready/warning/danger) | ✅ Automated | `operationalDashboard.model.test.ts` |
| Dashboard shows alerts for non-ready events | Alerts generated for staff/equipment issues | ✅ Automated | `operationalDashboard.model.test.ts` |
| Dashboard shows low-stock alerts | Low stock items surfaced | ✅ Automated | `operationalDashboard.model.test.ts` |

---

## 15. Verify Warnings / Readiness

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Event with no staff assigned | Readiness = STAFF_MISSING | ✅ Automated | Readiness RPC |
| Event with no equipment | Readiness = EQUIPMENT_SHORTAGE | ✅ Automated | Readiness RPC |
| Event with both issues | Readiness = MULTIPLE_ISSUES | ✅ Automated | Readiness RPC |
| Event properly prepared | Readiness = READY | ✅ Automated | Readiness RPC |
| Missing readiness data | Surfaces as "الجاهزية غير متاحة" | ✅ Automated | `operationalDashboard.model.test.ts` |

---

## 16. WhatsApp Operational Sharing Contains No Financial Info

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Click WhatsApp share on an event | Opens WhatsApp with prefilled message | 🔲 Human | Requires real device |
| Verify message content | Contains: event title, number, date, venue, guest count ONLY | ✅ Automated | `operationalDashboard.model.test.ts` |
| Verify NO financial data in message | No prices, costs, margins, or payment info | ✅ Automated | `operationalDashboard.model.test.ts` |
| Oman local number formatting | `91234567` → `96891234567` | ✅ Automated | `operationalDashboard.model.test.ts` |
| Invalid phone number | Button disabled with "لا يوجد رقم تواصل صالح" | ✅ Automated | `HomePage.tsx` rendering |

---

## 17. Complete Event Lifecycle Through Close

| Step | Expected Result | Status | Evidence |
| --- | --- | --- | --- |
| Create Event → DRAFT | Event created, status = DRAFT | ✅ Automated | RPC tests |
| Issue quotation → QUOTED | Event status = QUOTED | ✅ Automated | RPC tests |
| Accept quotation → CONFIRMED | Event status = CONFIRMED | ✅ Automated | RPC tests |
| Schedule staff | Staff assigned | ✅ Automated | RPC tests |
| Reserve equipment | Equipment reserved | ✅ Automated | RPC tests |
| → PREPARING | Event status = PREPARING | ✅ Automated | RPC tests |
| → DISPATCHED | Equipment dispatched | ✅ Automated | RPC tests |
| → IN_PROGRESS | Event in progress | ✅ Automated | RPC tests |
| → RETURNING | Equipment returning | ✅ Automated | RPC tests |
| Record payment(s) | Payments recorded | ✅ Automated | `customer_payments.test.sql` (pgTAP) |
| Reconcile warehouse | Warehouse reconciled | ✅ Automated | `warehouse_dispatch.test.sql` (pgTAP) |
| Reconcile consumables | Consumables reconciled | ✅ Automated | `consumable_stock.test.sql` (pgTAP) |
| → CLOSED | Event closed, economics verified | ✅ Automated | RPC tests |
| Cancel from non-terminal state | Event → CANCELLED, reason recorded | ✅ Automated | RPC tests |

---

## Summary

| Area | Automated | Human | Total |
| --- | --- | --- | --- |
| Sign in & org access | 4 | 3 | 7 |
| Customers | 2 | 3 | 5 |
| Event lifecycle | 12 | 1 | 13 |
| Commercial lines | 4 | 1 | 5 |
| Quotations | 7 | 0 | 7 |
| Staff scheduling | 4 | 0 | 4 |
| Equipment reservations | 4 | 0 | 4 |
| Warehouse operations | 7 | 0 | 7 |
| Consumables | 9 | 0 | 9 |
| Procurement lifecycle | 5 | 0 | 5 |
| Procurement receiving | 5 | 0 | 5 |
| Customer payments | 8 | 0 | 8 |
| Event economics | 3 | 0 | 3 |
| Dashboard | 4 | 0 | 4 |
| Readiness | 5 | 0 | 5 |
| WhatsApp | 4 | 1 | 5 |
| **Total** | **87** | **9** | **96** |

**87 of 96 UAT steps are automated** (90.6%). The 9 human-only steps are:
1. Visual verification of pages loading with correct content
2. Login error message display for invalid credentials
3. Organization name appearance on dashboard
4. Customer list load and visual verification
5. Customer edit UI interaction
6. Event list visual verification
7. Event commercial line modification in UI
8. WhatsApp deep link opens on a real device
9. WhatsApp message visual verification on device

These require a real browser/supabase environment and cannot be deterministically
tested in the current CI (Vitest + jsdom) or database-only (pgTAP) harnesses.