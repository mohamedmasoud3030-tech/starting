# PRODUCT_PRD.md — Owner-approved product definition

> Status: owner answers captured 2026-08-19. This document is the
> implementation contract for the **smallest version that can prove value**.
> It does **not** authorize a rebuild, a new tech stack, or extra modules.
>
> Product vs tenant: the **product** is a hospitality-operations tool.
> The **first tenant** is مشاريع جودة الإنطلاقة (hospitality division only).
> Never present the product as the company.

## Owner decisions (source of truth)

| Decision | Owner choice |
| --- | --- |
| First user | One office only: مشاريع جودة الإنطلاقة |
| First 30-day win | Full path: quote → execute → profit |
| Day-1 people | Owner + one manager/supervisor |
| Current work style | WhatsApp + paper |
| New accounts | Owner invites staff only (not open offices) |
| Pricing style | Free / custom pricing. No fixed package rules on day 1 |

## Contradiction handled

The office historically used four paper packages and a Nizwa transport rule.
The owner **explicitly chose free pricing** for launch. Therefore:

- Do **not** hard-code the four offers, guest bands, or Nizwa transport fees.
- Do **not** delete the existing optional package templates.
- Package apply stays **optional**. The primary quote path is custom lines.
- If the owner later wants the paper offers, they enter them as editable data.

---

## 1. Value proposition

نحوّل طلب الضيافة من واتساب وورق إلى عرض رسمي، مناسبة تُنفَّذ، ومبلغ ربح واضح بعد الإغلاق — لمكتب مشاريع جودة الإنطلاقة.

One sentence (English, for agents): *Replace WhatsApp-and-paper hospitality jobs with one official quote, one executed event, and a real profit number after close-out, for a single Omani office.*

## 2. Target users and jobs-to-be-done

| User | Job to be done |
| --- | --- |
| Owner (يعقوب / مكتب مشاريع جودة الإنطلاقة), 50+, Arabic-first | Know what was promised, what was done, what was collected, and what was left as profit — without chasing papers. |
| Manager or supervisor (one person on day 1) | Turn an accepted quote into a prepared event: people, items, and day-of execution notes. |
| Customer (external, not a login user) | Receive a clear official quote and pay against it. They do **not** use the app. |
| Later: warehouse / accountant / extra hosts | Not day-1 users. Do not design the first launch around them. |

Out of audience for this version: other company divisions, other hospitality offices, the public, and self-serve SaaS customers.

## 3. Pain points and expected outcomes

**Pains today**

- Jobs live in WhatsApp threads and paper quotes; nothing is the single record.
- Price, team, and money are remembered, not closed.
- After the event, the owner cannot see profit without reconstructing the job.
- Adding a second person (manager) has no in-app way to join the same office.

**Expected outcomes (30 days)**

- One real customer job exists only in the system as: quote → accepted → event → collection → expenses → closed → profit.
- The customer received an official quote (print/PDF/share), not only a chat message.
- Owner and one manager can both see the same job.
- Paper/WhatsApp may still be used to *talk* to the customer; they are no longer the books.

## 4. Assumptions requiring validation

1. The owner and one manager will complete **one live job** in the system, not only demo data.
2. Custom line pricing is enough for the first real quotes (packages not required).
3. The manager can work in Arabic on a phone or laptop without training docs.
4. Profit is meaningful only if someone records **payments and expenses** on that job.
5. Staff invitation by email (no email-gateway product) is acceptable: the person creates a login, then the owner attaches them to the office.
6. Production hosting and the live database are available when the owner approves launch (not assumed done).
7. Customers will accept a printed/PDF quote in place of a handwritten paper quote.

## 5. MVP scope

### In scope (prove value)

1. One tenant: مشاريع جودة الإنطلاقة.
2. Owner account + invite/add **one** manager or supervisor.
3. Customers (name + phone at minimum).
4. Custom quotation: guest count, location/notes, free lines, totals in OMR (3 decimals), issue, accept, convert to event.
5. Official quote document the customer can see/print (office identity from settings, not hardcoded).
6. Event workspace for that job: status path from confirmed → prepare → execute → return → close.
7. Enough operations for **that one job**: assign people if needed, note equipment/materials if used, or skip unused tabs.
8. Record customer payments and simple event expenses.
9. Close the event and show: promised revenue ≠ collected ≠ profit.
10. Daily home for “what is on today”.
11. Arabic RTL, large type, short navigation for Owner + Manager.

### Out of scope (do not build now)

- Other company activities beyond hospitality.
- Selling the product to other offices / public self-serve tenants.
- Hard-coded legacy packages or Nizwa transport rules.
- Warehouse worker and accountant as day-1 roles.
- Email/SMS/WhatsApp automation, payment gateway, maps, CRM, full payroll, full accounting/GL.
- File attachments, digital stamps, extra document templates.
- AI assistant, marketing, analytics suite, offline write queue.
- Pagination UX polish, autosave polish, audit retention policy — unless they block the first live job.
- Replacing or rewriting working quote/event/finance modules.

### Already built (do not rebuild)

The repository already implements the commercial and operational path (quotes, events, catalog, optional packages, warehouse, consumables, procurement, payments, invoices, staff, settings, calendar, reports). MVP work is **policy, invitation, simplification, and one live cycle** — not a greenfield app.

## 6. User roles and permissions

Day-1 **used** roles: `OWNER`, `MANAGER` (or `SUPERVISOR` if the second person must not see cost).

| Action | OWNER | MANAGER | SUPERVISOR | WAREHOUSE | ACCOUNTANT |
| --- | --- | --- | --- | --- | --- |
| Invite / add / deactivate staff | Yes | No | No | No | No |
| Organization identity settings | Yes | Read | No | No | No |
| Customers write | Yes | Yes | Yes | No | No |
| Quotes write / issue / accept / convert | Yes | Yes | No | No | No |
| Event operate (prepare / dispatch / close) | Yes | Yes | Yes | Limited | No |
| See selling prices | Yes | Yes | Yes | Yes | Yes |
| See cost, expenses, profit | Yes | Yes | No | No | Yes |
| Record payments / invoices | Yes | Yes | No | No | Yes |
| Catalog / packages edit | Yes | Yes | No | No | No |

Rules:

- UI hiding is not authorization. Database remains the authority.
- Recommended day-1 second user: **MANAGER** so they can quote and see profit with the owner.
- Use SUPERVISOR only if the owner does not want that person to see cost.
- WAREHOUSE and ACCOUNTANT stay in the model but are **Later**.

## 7. Core user journeys

### J1 — Open the office (once)

1. Owner signs in (or creates the first account).
2. Owner creates the single organization: مشاريع جودة الإنطلاقة.
3. Owner fills identity settings used on documents (name, phones, C.R. 1466316, postal code 611, country Oman). Do not invent missing address/PO Box.
4. Owner adds the manager by email + role.

### J2 — Invite the manager

1. Manager creates a login with their email (no public “new office” success path).
2. Owner adds that email to the office as MANAGER (or SUPERVISOR).
3. Manager signs in and sees only this office.
4. Failure: unknown email, already a member, or non-owner trying to add someone — Arabic explanation, no silent success.

### J3 — Quote a job from WhatsApp/paper

1. Owner/manager creates or reuses a customer (name + phone).
2. Creates a quote: event type, date/time, place, guest count, free-text service lines and prices.
3. Saves draft, reviews totals in OMR, issues an official quote.
4. Shares/prints the quote to the customer (WhatsApp share of the document is enough; no WhatsApp API).
5. On approval: mark accepted, convert to a confirmed event. Quote snapshot must not change later.

### J4 — Execute the event

1. Open the event workspace (the job’s home).
2. Prepare what this job actually needs (team and/or equipment and/or materials). Unused areas stay unused — do not force every tab.
3. Move status forward only when allowed. Blocked moves explain why in Arabic.
4. Day-of: home screen shows today’s job.

### J5 — Collect, spend, close, see profit

1. Record payments against the accepted quote/event.
2. Record actual extra expenses for the job (do not double-count purchase orders if those were used).
3. Close operationally, then close financially.
4. Owner sees three different numbers: agreed price, collected cash, profit.
5. After financial close, money-changing edits are blocked.

## 8. Functional requirements and acceptance criteria

### FR1 — Single office first

- **AC1.** A completed first-time owner lands in one organization they created.
- **AC2.** Launch policy is invite-only membership. Random public users must not become a second hospitality company inside this product as part of the MVP success story.
- **AC3.** The UI never claims the product *is* مشاريع جودة الإنطلاقة.

### FR2 — Owner invites staff

- **AC1.** OWNER can add a person by email and role (`MANAGER` or `SUPERVISOR` on day 1).
- **AC2.** Only an existing login with that email can be attached; if no login exists, the owner sees a clear Arabic next step: “ask them to create a login first, then add them”.
- **AC3.** OWNER can deactivate a membership. Deactivated users lose access immediately.
- **AC4.** Non-owners cannot add or change memberships.
- **AC5.** No demo users, no shared password account, no hardcoded logins.

### FR3 — Custom quotation is the default path

- **AC1.** A quote can be issued with only custom lines (zero packages).
- **AC2.** Each line has description, quantity, unit price; total is exact OMR 3 decimals.
- **AC3.** Guest count ≥ 1; event time and place are captured.
- **AC4.** Issued quotes are immutable snapshots. Catalog/package edits later do not rewrite history.
- **AC5.** Package apply, if visible, is optional and never required to issue.

### FR4 — Official customer document

- **AC1.** Issued quote shows tenant identity from settings (Arabic name, phones if entered, C.R. if entered).
- **AC2.** Missing optional fields are omitted. No invented PO Box or street address.
- **AC3.** Owner/manager can print or export the quote for the customer.

### FR5 — Convert quote to event

- **AC1.** Accept + convert creates one confirmed event with copied snapshot lines.
- **AC2.** Repeating convert does not create a second event.
- **AC3.** Event remains the operational home for the job.

### FR6 — Execute and close

- **AC1.** Allowed status path is visible; illegal jumps are rejected with Arabic reason.
- **AC2.** Owner/manager can close the job after execution.
- **AC3.** Home lists today’s events in Asia/Muscat.

### FR7 — Money and profit

- **AC1.** Payments are append-only; void keeps history.
- **AC2.** Expenses can be recorded on the event without requiring procurement.
- **AC3.** Profit view shows revenue, collected, costs/expenses, and profit as separate figures.
- **AC4.** After financial close, revenue/cost-changing writes are blocked.
- **AC5.** SUPERVISOR (if used) cannot read cost or profit.

### FR8 — Language and simplicity

- **AC1.** Entire owner/manager path is Arabic RTL.
- **AC2.** Primary actions are large, labeled in Arabic, and do one thing.
- **AC3.** No fake buttons, placeholder pages, or invented statistics.

## 9. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Security | Organization isolation at the data boundary. Role checks in the database. No demo login. Cost data not only hidden in UI. |
| Performance | Phone-usable lists for one office’s real volume (dozens of jobs, not thousands). |
| Accessibility | Large type, high contrast, visible focus, labels on every field, usable touch targets. |
| Privacy | Customer phone/name stay inside the tenant. Voice/read-aloud must not send business data to an external AI. No cost spoken to roles who cannot see cost. |
| PWA | App may install and open offline; **no** offline writes. Online required to save. |
| Localization | Arabic first. `dir=rtl` `lang=ar`. OMR with 3 decimals. Asia/Muscat operational day. English names only where the owner typed them (documents). |

## 10. Edge cases and failure states

| Case | Required behavior |
| --- | --- |
| System not configured | Login shows “النظام غير مهيأ بعد”. No crash. |
| Wrong password / unconfirmed email / rate limit | Arabic message. No English raw provider text. |
| Invite email has no account | Explain that the person must create a login first. |
| Invite email already a member | Explain; do not create a duplicate. |
| Staff user tries to create another office | Reject or keep out of the MVP path; owner’s office remains the only launch tenant. |
| Quote with no lines | Cannot issue. |
| Invalid money (negative, >3 decimals, over range) | Reject at input and at save. |
| Convert twice | Second attempt is a no-op or a clear “already converted”. |
| Close while money/ops rules fail | Block with the specific reason (unreturned items, etc.). |
| Financially closed event | Further payment/expense/price edits fail clearly. |
| Inactive organization | No reads/writes even if membership row exists. |
| Unsaved quote edits | Warn before leaving. |
| Package list empty | Custom lines still work. |
| Manager without cost role (SUPERVISOR) | No cost, no profit, no procurement money. |
| Offline | Can open shell; cannot pretend a save succeeded. |

## 11. Success metrics (first 30 days)

A launch is **successful** only if all of the following are true on real work:

1. **1 complete live job** in the system (not sample data): issued quote → accepted → executed → at least one payment → close → profit visible.
2. **2 people** (owner + manager/supervisor) signed in to the same office.
3. **0 second companies** created as a side effect of public signup.
4. The customer-facing quote used **office identity**, not a blank/generic header.
5. Owner can answer without WhatsApp archaeology: *what did we promise, what did we collect, what did we keep?*

Vanity metrics (page views, number of unused modules, other offices signed up) do **not** count.

## 12. Prioritized backlog

### Must (prove the first live job)

- Keep the existing quote → event → payment → expense → close → profit path working.
- Owner can add/deactivate the second user by email + role.
- Custom quote without packages is the obvious path.
- Official quote document uses organization settings.
- Arabic failure states for auth, invite, issue, convert, and close.
- Launch as **one office**, invite-only membership.

### Should (if it blocks daily use)

- Hide or de-emphasize empty package/catalog chrome so free pricing feels first.
- Membership list on settings: who is in the office and their role.
- Prevent or clearly dead-end “create another office” for invited staff.
- One-screen “job status” so the 50+ owner does not hunt through unused tabs.

### Could (after the first live job)

- Enter the four paper offers as **editable** packages (data, not code).
- Optional transport line for jobs outside Nizwa (typed amount, not a formula).
- Warehouse and accountant logins.
- List pagination, quote autosave, attachments.

### Later (explicitly not now)

- Other company divisions.
- Multi-office sales / public SaaS onboarding.
- WhatsApp API, payment gateway, email campaigns.
- Full accounting, payroll, CRM, AI, maps, digital signature, file vault.
- Changing event datetime timezone behavior (device vs Muscat) until a new owner decision.

## 13. Major risks and cheapest validation

| Risk | Why it matters | Cheapest validation |
| --- | --- | --- |
| Too many screens for a 50+ owner | They abandon it and return to paper | Sit with owner and complete **one** job; if a tab is unused, leave it unused |
| Invite missing, so manager never joins | Day-1 team fails | Add one real manager email on a staging/live project |
| Public signup creates stray offices | Contradicts “our office only” | Try signing up a dummy email; confirm they cannot become a second tenant without the owner |
| Free pricing, no costs entered | “Profit” is a lie | On the first job, require at least payments + any real expense (even 0.000 if none) |
| Paper packages still used outside the system | Two books again | After job 1, ask: did any price come from the paper sheet? If yes, enter it as a line, not as code |
| Production not actually live | Nothing to use | Owner-approved hosting checklist only — do not fake a launch |
| WhatsApp remains the real quote | System is a copy, not the book | Success metric: customer received the system quote |

## 14. Compact implementation PRD (for a coding agent)

### Goal

Enable **one Omani hospitality office** to run **one real job** from custom quote to closed profit, with **owner + one invited manager**, without rebuilding the app and without opening the product to other companies.

### Non-negotiable rules

- Arabic RTL first. OMR `numeric(12,3)` / integer milli-OMR. No float money.
- Snapshots: issued quotes and historical events never restated by later catalog edits.
- Event is the operational center.
- RLS + server commands are the security boundary.
- No demo login, no hardcoded users, no client DELETE of master data.
- New schema changes = new migration only. Never edit applied migrations.
- Do not hard-code legacy prices, guest bands, or Nizwa transport.
- Do not invent missing brand fields (no fake address / PO Box).
- Do not add email/SMS providers, payment gateways, or new major systems.

### Build / do not build

| Do | Do not |
| --- | --- |
| Add OWNER-only membership attach + deactivate by email + role | Rebuild quotes, events, finance, warehouse |
| Make custom lines the default quote path | Require packages |
| Keep packages optional if already present | Encode the four paper offers |
| Use organization settings on quote documents | Hard-code الشركة as the product name |
| Arabic empty/error states on invite and quote issue | English raw errors |
| Treat invited staff as members of the existing office | Let staff create a new tenant as the happy path |
| Leave unused operational tabs unused | Force warehouse/procurement/payroll on job 1 |

### Default implementation choices (no owner menu)

- Second user role default: `MANAGER`.
- **Locked join method (2026-08-19):** attach an **existing** login by email via a server command. Staff create a login first; the owner adds that email. No Auth Admin invite, no secret key in the browser, no new email vendor. Details: `docs/architecture/21-staff-join-decision.md`.
- If the email has no login, tell the owner (Arabic) to have them sign up first.
- Signup page may remain for creating logins; **organization creation is not the staff happy path**.
- Deactivate memberships (`INACTIVE`); do not delete them.
- Money: existing money helpers only.
- Documents: existing document shell / print path.
- Time: Asia/Muscat for “today”.

### Acceptance of the whole MVP

A reviewer can:

1. Create owner + office.
2. Create a second login and have the owner attach it.
3. Create a customer and issue a **package-free** quote.
4. Print/open the official quote with tenant identity.
5. Accept, convert, move the event, record a payment and an expense, close, and see profit.
6. Confirm a non-member cannot see that office’s data.
7. Confirm typecheck, lint, tests, and build still pass.

### Owner gates (do not do without asking)

- Production Supabase/Vercel/domain/DNS.
- Paid plans.
- Deleting real data.
- Opening signup to other offices.
- Changing the product to cover non-hospitality company activities.

---

*End of contract. Next coding work should implement only Must items that are still missing (primarily staff attach/deactivate and invite-only membership policy), then stop for a real job rehearsal.*
