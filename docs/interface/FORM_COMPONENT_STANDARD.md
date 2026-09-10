# FORM_COMPONENT_STANDARD.md

> Phase 6 deliverable. Standard for field necessity, ordering, grouping,
> control types, labels/hints/units, required-vs-optional, defaults,
> validation, and every recoverable/interrupted state. Migrate shared
> field/form-action patterns before page-by-page fixes.

## 1. Cross-cutting money rule (binding, from AGENTS.md)
OMR is exact to 3 decimals. The UI must never send or display a value the DB
rejects:
- Use `MoneyInput` (exact OMR 3-dec, milli-OMR/BigInt arithmetic).
- Do **not** let a user enter >3 decimals (domain rejects negatives too).
- Cost and selling prices are separate concepts and both configurable; a
  catalog price change must never restate past event/quote snapshots.

## 2. Shared form-action + field pattern (target)
Extract and use a consistent **FormActions** block and **Field** contract so
behavior is identical app-wide rather than copied per dialog:
- `Field` renders `<label>` + `required` marker + hint + inline error +
  control, with stable `htmlFor`/id and `aria-describedby`.
- **FormActions:** cancel (secondary) + submit (primary, `type=submit`),
  submit disabled while pending, sticky on mobile within the visible area,
  Arabic RTL. Provides duplicate-submission prevention.
- **Server/client split:** client validates shape & money range; the
  server/command is the authority. Inline field errors for recoverable input;
  a summary error banner for command failures (role="alert").

## 3. Form-by-form field decisions (high-traffic forms)

### Create event (dialog, `/events`)
Fields in order: العميل (Select of active customers) → عنوان المناسبة →
نوع المناسبة (placeholder زفاف/مؤتمر…) → عدد الضيوف (number ≥1) → البداية →
النهاية (datetime) → الموقع → جهة الاتصال (اسم) → هاتف (tel). Notes last.
- Gate: no active customers → blocking inline notice with link to `/customers`
  (present).
- Client required: customer/title/type/guests/start/end/venue.
- Duplicate-submit: disable while pending; idempotency key per dialog session.

### Customer dialog
Fields: الاسم (required, inline name error) → هاتف/واتساب (tel, LTR) →
نوع العميل (Select) → ملاحظات.
- **Duplicate-phone guard** on create (server-ish, verified present) — keep.

### Catalog item / package dialog
Name (+Arabic), type, pricing method, separate cost & selling price (cost
revealed by role), category, sort, ACTIVE/INACTIVE. No client DELETE.

### Staff member dialog & member file
Identity/contact, engagement (role), document expiry dates (civil-ID/health),
IBAN etc. Team are **hosts** — no leave/absence fields (verified removal 0102).

### Quote editor (3-step)
- Step 1 تفاصيل: prospect-or-customer, guests, type, package apply.
- Step 2 خدمات: snapshot expansion from package (per-event lines), custom
  lines; cost/price exact.
- Step 3 مراجعة: read-only totals before issue.
- Guard: unsaved-edit (navigation + beforeunload). Atomic draft persistence;
  number `QT-…` only at issue.

## 4. Every state a form must handle
- **Loading / draft / unsaved-change:** indicator + block on nav/beforeunload
  (quote editor; extend pattern to other long forms if they gain drafts).
- **Recoverable failure:** preserve entered input and show inline error; do
  not clear fields.
- **Duplicate submission:** button disabled while pending + idempotency key on
  commands.
- **Validation:** client shape/range; inline errors; command-level summary.
- **Success:** toast (Arabic) then close/navigate.
- **Cancellation:** explicit cancel closes without submitting.
- **Timeout / offline / expired-session:** no offline write queue (deliberate);
  offline banner informational; expired session routes to login via AuthGate.

## 5. Mobile specifics
- Action buttons reachable without virtual-keyboard occlusion (sticky footer
  action bar); autocomplete/`inputMode` set (tel for phones, number for counts,
  none for OMR via MoneyInput); `datetime-local` uses device timezone — the
  product deferred a Muscat pin (D17), so keep as-is and do not silently shift
  times.
- Two-column desktop grids collapse to one column on mobile; long dialogs use
  full-width Dialog.

## 6. Migration order (shared-first)
1. Standardize `FormActions` + submit-lock (shared) — used by all dialogs.
2. `Field` error/hint contract (already thin; verify consistency).
3. Apply to create-event, customer, catalog/package, staff dialogs.
4. Quote editor guards already present; keep.
> Status: foundations enumerated; field-level app sweep is a **later**
> milestone (P2) and is documented here so fixes are not duplicated page by
> page.
