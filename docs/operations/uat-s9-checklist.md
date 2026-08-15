# S9 Human UAT Checklist — Attendance, Payroll, Invoicing & Owner Attention

> **Purpose:** complement the automated S9 evidence with operator-facing acceptance.
> **Rule:** a human item is not considered passed because CI is green. Execute these
> steps against the dedicated Hospitality staging/production candidate with real
> roles and representative data.

## Prerequisites

- [ ] Dedicated Hospitality Supabase staging/production-candidate project exists.
- [ ] Dedicated deployed Hospitality web/PWA URL exists.
- [ ] OWNER and at least one operational staff user can sign in.
- [ ] A test customer, accepted quotation, event, and active staff assignment exist.
- [ ] Test event dates/times use the Oman business timezone.
- [ ] Browser/device under test is recorded in the UAT evidence.

## 1. Staff attendance

| Step | Expected result | Evidence |
| --- | --- | --- |
| Open an event with an active staff assignment | Assigned host appears in the attendance/payroll area | Screenshot + event ID |
| Record PRESENT attendance with valid shift/times | Attendance is saved once and the earned amount shown matches the configured rate | Screenshot + attendance ID |
| Retry the same operator action after a transient/reload scenario | No duplicate attendance row or duplicate earnings appear | Before/after screenshot |
| Try to record the same live business slot again | UI surfaces a clear conflict; no duplicate live slot is created | Screenshot |
| Record ABSENT | No worked-time values are accepted for the absent fact | Screenshot |
| Void a recorded attendance fact with reason | Original history remains visible/traceable and the live state is voided | Screenshot + reason |
| Record the corrected replacement | Corrected fact becomes the live operational truth without deleting history | Screenshot |

## 2. Host payroll, advances and payouts

| Step | Expected result | Evidence |
| --- | --- | --- |
| Open one event's payroll view | Only that event's earnings and event-linked payouts affect the event summary | Screenshot |
| Record a global staff advance | Advance appears in the staff-level ledger, not repeated once per event | Screenshot + staff ID |
| View the same host across two events | The global advance is still counted exactly once in the global balance | Screenshots from both views |
| Record an event-linked payout | Event view and staff global view reflect it once | Screenshot |
| Record a global payout | Staff global view reflects it; unrelated event summaries do not acquire the payout | Screenshot |
| Compare displayed OMR values | All monetary values show three decimal places and agree with the server-derived totals | Screenshot + manual calculation |

## 3. Invoice authority and lifecycle

| Step | Expected result | Evidence |
| --- | --- | --- |
| Open invoicing for an event with an accepted quotation | Invoice total is sourced from the accepted quotation, not editable to an arbitrary value | Screenshot + quotation ID |
| Create the invoice | One live ISSUED invoice is created for the event | Screenshot + invoice ID |
| Retry the same create action | The same logical invoice is returned; no duplicate live invoice is created | Screenshot |
| Attempt another different live invoice for the same event | Operation is rejected while the current invoice remains live | Screenshot |
| Void/cancel the live invoice with a valid reason | Historical invoice remains traceable and is no longer treated as live | Screenshot |
| Create a replacement after cancellation | Replacement becomes the single live invoice and old history remains visible | Screenshot |

## 4. Installments and collection presentation

| Step | Expected result | Evidence |
| --- | --- | --- |
| View a live installment plan | Due items and statuses are understandable in Arabic and totals reconcile to the invoice contract | Screenshot |
| Cancel/void the governing invoice/plan | Cancelled installments read as CANCELLED, never PAID or PENDING | Screenshot |
| Compare invoice/collection screens with event payment history | The operator can distinguish invoice obligation from actually recorded customer payments | Screenshot |

## 5. Owner attention

| Step | Expected result | Evidence |
| --- | --- | --- |
| Open the owner/dashboard attention area with a deliberately incomplete event | Missing readiness/attendance/stock attention item is surfaced | Screenshot |
| Resolve the underlying operational issue and refresh | Resolved attention item disappears or changes state based on server truth | Before/after screenshot |
| Use the owner voice/read-out control where supported | Spoken/visible summary matches current operational facts and reveals no unauthorized financial detail to a role that should not see it | Device recording/screenshot |

## 6. Role and privacy checks

| Step | Expected result | Evidence |
| --- | --- | --- |
| Sign in as OWNER/financially authorized role | Payroll/invoice details required by that role are visible | Screenshot |
| Sign in as an operational role without finance access | Restricted payroll/invoice/cost details are not exposed through UI navigation or direct URL | Screenshot |
| Refresh and deep-link to `/staff` and an event workspace | Auth guard and SPA routing behave correctly | Screenshot |
| Sign out and revisit a protected deep link | User is returned to login and protected data is not rendered | Screenshot |

## 7. Mobile/PWA acceptance

Run at least once on the actual phone/browser that will be used operationally:

- [ ] Install/open the PWA and launch from the home-screen icon.
- [ ] `/home`, `/events`, `/staff`, and event workspace load after a fresh launch.
- [ ] Attendance controls are usable without horizontal clipping.
- [ ] Invoice/payroll numeric values remain legible at mobile width.
- [ ] A page refresh on a deep SPA route does not return a host 404.
- [ ] WhatsApp handoff opens the correct app/browser flow on the real device.
- [ ] No stale financial or operational page is shown after sign-out.

## 8. Acceptance record

Record for the launch candidate:

- deployed URL / deployment ID;
- database project/ref used;
- Git commit SHA;
- UAT date/time;
- tester/operator name;
- device/browser versions;
- failed items and linked fixes;
- final OWNER sign-off.

**Launch rule:** any failed financial-integrity, tenant-isolation, auth/privacy,
attendance-duplication, invoice-authority, or backup/recovery item is a hard stop.
Cosmetic findings may be triaged separately only if they do not impair operation or
misrepresent business/financial truth.
