# 09 — Quick Quote (عرض سعر سريع): fast pre-booking commercial workflow

> **Decision:** Quick Quote is a **fast pre-booking commercial workflow** for the
> owner/manager. It produces a normal, immutable `quotations` revision from
> minimal prospect data — **no permanent Customer and no Event are required to
> quote**, and neither is ever created until the owner explicitly converts an
> ACCEPTED quotation. It is the "اعمل عرض سعر" path: the owner never has to
> understand the Catalog/Package/Customer/Event/Quotation distinction during
> an initial inquiry.

## Why it exists

A large percentage of inquiries never become confirmed Events. Forcing the
old path (Customer → Event → pricing → quotation) burns the owner's patience
and leaves either premature Customer records or abandoned flows. Quick Quote
lets him capture an inquiry and issue a binding commercial offer in minutes.

## What it is NOT

- **Not a second pricing engine.** Line totals reuse `public.commercial_total()`
  (the same numeric, 3-decimal, half-away-from-zero function the event flow
  uses); the client mirrors it exactly in `quoteMath.ts` for the live preview.
- **Not a duplicate quotation system.** Issuing a Quick Quote **is** a row in
  `public.quotations` + `public.quotation_lines` — the existing immutable
  snapshot system. An issued Quick Quote is indistinguishable from an
  event quotation except `event_id IS NULL` and selling-only costs.
- **Not an AI assistant / not a scraper.** No LLM, no DOM scraping, no network
  TTS beyond the existing Owner Voice engine.

## Data model (migration `0017_quick_quote.sql`)

```
quick_quotes                  # EDITABLE pre-event workspace aggregate (prospect snapshot)
  id, organization_id, quotation_id (set at issue), quotation_number,
  status (DRAFT|ISSUED|ACCEPTED|CONVERTED|DISCARDED),
  prospect_name (required), prospect_phone, prospect_whatsapp, prospect_company,
  event_title, event_type, start_at, end_at, guest_count, venue_name, notes,
  idempotency_key (unique per org), created_by, created_at, updated_at

quick_quote_lines             # draft lines (selling-only, NO cost columns)
  description, item_type, unit, pricing_method, quantity,
  unit_selling_price, total_selling (via commercial_total), is_custom, sort_order

quick_quote_applied_packages  # PK (org, quick_quote_id, package_id) → no double-apply
```

`quotations` adjustments (backwards compatible):
- `event_id` **nullable** — a quotation may exist before any Event.
- `guest_count_snapshot` / `start_at_snapshot` / `end_at_snapshot` /
  `venue_snapshot` **nullable** — "optional date/guests" is first-class.
- New columns: `customer_id` (resolved at convert), `converted_event_id`
  (unique — the idempotency guard), `converted_at`.
- `protect_quotation_snapshot()` rewritten to still forbid ANY change to
  snapshot/line data while allowing only `status/accepted_by/accepted_at/
  customer_id/converted_event_id/converted_at` on ISSUED/ACCEPTED rows.

## RPC/server commands (SECURITY DEFINER, empty `search_path`, `can_manage_commercial` gate)

| Command | Purpose |
| --- | --- |
| `create_quick_quote` | create the prospect/event draft (idempotent by key) |
| `save_quick_quote_line` | upsert one draft line (PER_GUEST requires known guests) |
| `delete_quick_quote_line` | remove one draft line |
| `reset_quick_quote_lines` | replace all draft lines (safe resume/retry) |
| `apply_package_to_quick_quote` | apply an ACTIVE package as selling-only snapshot lines |
| `issue_quick_quote` | draft → **normal immutable quotation** (revision 1, `event_id NULL`, QT-number) |
| `accept_quick_quote` | ISSUED → ACCEPTED (+ `accepted_by/at`) |
| `convert_quick_quote` | ACCEPTED → **Customer + Event** transactionally, idempotently |
| `discard_quick_quote` | delete an abandoned DRAFT (never creates Customer/Event) |

## Quotation reuse strategy

Issuing copies the draft lines into `quotation_lines` with
`expected_unit_cost = 0` (Quick Quotes carry **no internal cost model** —
customer-facing quotations never expose cost/profit; `quotations_customer`
view has no cost columns). After issue the quotation is fully immutable:
the snapshot trigger + the `quotation_lines` immutability trigger still
apply. Later catalog/package edits can never rewrite issued history.
Quick Quote totals on the issued row are selling-only
(`total_expected_cost = total_expected_profit = 0`), documented as "not
modeled" rather than "zero cost".

## Customer/Event conversion behavior

`convert_quick_quote` runs in ONE transaction and:

1. Requires status `ACCEPTED` (an un-accepted quote cannot convert).
2. Idempotency: if `converted_event_id` is already set, returns that Event —
   retries never create a second Event.
3. **Customer resolution (safe, never merges):**
   - Prospect phone empty → create a new Customer.
   - Exactly **one** active Customer matches the phone exactly → reuse it.
   - **Two or more** matches (ambiguous) → create a NEW Customer (no silent
     merge by name; the mission's "ambiguous matches handled safely").
4. Event creation uses snapshot data with optional overrides
   (`p_start_at/p_end_at/p_venue_name/p_guest_count/p_event_title`); missing
   required fields raise clear errors (`EVENT_DATE_REQUIRED`, `VENUE_REQUIRED`,
   `GUEST_COUNT_REQUIRED`). The Event is created `CONFIRMED`, linked to the
   accepted quotation, with a history row `QUICK_QUOTE_CONVERTED`.
5. Quick-quote status → `CONVERTED`; audit rows appended (internal-only).

The quotation snapshot is **never rewritten** by conversion or by later
Customer edits — the invariant "an issued quotation preserves the
customer/prospect identity and commercial values exactly as they were at
issuance" is enforced by the immutable snapshot trigger.

## Owner UX (single focused page)

- **`/quotes`** — list with status badges (مسودة/صادر/معتمد/محوّل) + totals.
- **`/quotes/new`** — ONE page, three numbered sections:
  1. **بيانات بسيطة** — name (required), phone, WhatsApp, company, optional
     date/time/venue/guests/notes.
  2. **الخدمات والسعر** — package apply (client-side expansion → snapshot
     lines) + custom line form + live exact total + **حاسبة سريعة** (pure
     scratch calculator that creates no records).
  3. **مراجعة وإرسال** — review + «إصدار عرض السعر».
- **`/quotes/:id`** — DRAFT → same workspace (resume/edit); ISSUED → immutable
  review page with «اعتماد العرض»; ACCEPTED → «تأكيد الحجز / تحويل إلى
  مناسبة» (one dialog, prefilled from snapshots, navigates to the new Event).
- Nothing is persisted until the owner acts: the workspace is client-side
  until «إصدار عرض السعر» (create + save lines + issue), so an abandoned
  inquiry creates **no** Customer/Event/quotation.
- Nav entry «عروض الأسعار» is shown only to OWNER/MANAGER
  (`canManageCommercial`); pages render a permission notice otherwise.

## Owner Voice integration

`buildQuickQuoteVoiceSummary` in `screenSummary.ts` produces the review
summary deterministically — e.g. "عرض السعر الإجمالي ٨٥٠ ريال. عدد الضيوف
١٢٠. العرض لم يتم اعتماده بعد." No cost/profit ever (Quick Quotes carry no
cost model); returns `null` (no button) when there is no total. No automatic
speech; the OwnerVoiceButton on the review page is press-only.

## Security review

- Org-scoped: every command checks `can_manage_commercial(p_org_id)`
  (OWNER/MANAGER in the CURRENT org); RLS allows org members to read
  `quick_quotes`/`quick_quote_lines` (no cost columns exist on them).
- No direct table writes: `revoke all` on the new tables except `select` for
  authenticated; all mutations are RPC-only.
- Cost separation preserved: `quotations` (base) remains cost-gated; the UI
  reads issued quotes through `quotations_customer` (no cost/profit columns).
- Cross-org conversion/issue/accept rejected (tested).
- No sensitive data in logs; audit events carry bounded metadata only.
- Money: DB `numeric(12,3)` authoritative; client preview via milli-OMR +
  BigInt (`quoteMath.ts` mirrors `commercial_total` exactly).

## Test coverage

**Database (`supabase/tests/quick_quote.test.sql`, 52 pgTAP assertions)** —
created without permanent Customer; idempotent create; abandoned draft
creates no Customer/Event; exact OMR totals; package apply + double-apply
guard; issue → `event_id NULL`, snapshots preserved, lines copied, cost 0;
immutability of snapshot + lines; issue/accept/convert idempotent retries;
conversion reuses Customer on unambiguous phone match; ambiguous match never
merges; unknown date/guests supported; convert overrides; `EVENT_DATE_REQUIRED`;
cross-org and role rejection; cost-free customer view.

**Frontend (20 tests)** — exact client money math mirroring the DB; one-page
3-section flow; no records on mount; live total client-side; package
expansion client-side; issue sequence create→save→issue without
Customer/Event; PER_GUEST-without-guests warning; review snapshot rendering;
Owner Voice present with no auto speech; accept RPC; convert dialog prefilled
→ navigate to Event; actions hidden for non-commercial roles.

> The DB suite is authored in the official `supabase test db` harness style
> but was **not executed in this environment** (no PostgreSQL/Docker available
> in the sandbox). It must run in the official Supabase environment before the
> PR is un-drafted; the frontend suite ran locally.

## Known limitations (V1)

- Quick Quotes carry no internal cost model (`expected cost/profit = 0`).
- Draft resume re-persists lines wholesale (reset + save) — no per-line
  diffing; package re-application on a resumed draft is not exposed.
- Customer matching is exact-phone only; no fuzzy/normalized matching yet.
- PER_GUEST lines require a known guest count at save time (clear error).
- No pagination on the quotes list.
