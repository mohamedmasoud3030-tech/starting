# BRAND_IDENTITY.md — Commercial & Operational Reference (Masharie Jiwdat Alantalaqah)

> Owner-supplied reference for the real business using this product. This file
> is the durable source of truth for **who the product serves** and **what the
> real business flow is**. It must stay accurate and must **not** be confused
> with the product's own identity (the product is a multi-tenant system; the
> business is one tenant using it).
>
> **Status:** owner dictated this content as text (2026-08-18). The two source
> letterhead photos (`IMG_2934.jpeg`, `IMG_2935.jpeg`) were described by the
> owner; this session cannot read images, so every figure below is the
> owner's transcription and is treated as authoritative.

---

## 1. Entity identity (do not confuse with product name)

| Field | Value |
| --- | --- |
| Official Arabic name (logo & documents) | مشاريع جودة الإنطلاقة |
| English name printed under the logo | MASHARIE JIWDAT ALANTALAQH |
| Owner | يعقوب الخصيبي (given earlier by the owner; not on the paper) |
| Division covered by these documents | قسم خدمات الضيافة وتنظيم الحفلات |

**Important framing the owner insists on:**

- The core entity is **مشاريع جودة الإنطلاقة** — it is NOT named "نظام إدارة
  الضيافة", and hospitality is **not** its only activity.
- Hospitality & event organization is **one division/activity** of the entity.
- Therefore the product must never be presented as "the company". The company
  is the tenant; the product is its tool.

---

## 2. Letterhead data (as printed on the paper)

| Field | Value | Notes |
| --- | --- | --- |
| GSM / نقال | 98203088 | |
| GSM / نقال | 92120205 | |
| Postal code / الرمز البريدي | 611 | |
| Country / الدولة | سلطنة عمان | |
| C.R. / السجل التجاري (س.ت) | 1466316 | |
| P.O. Box / ص.ب | *(field exists, no number shown)* | **Do NOT invent a value.** |
| Date / التاريخ | *(field at top)* | filled per document |

- No street address was given. **Do not invent one.**

---

## 3. Visual identity (legacy, simple & formal — not to be copied literally)

- Primary color: **royal / strong dark blue**.
- Background: **white**.
- A **double blue frame** surrounds the document.
- Company name sits inside a **banner/ribbon-like shape**; Arabic name large,
  English name beneath it.
- Contact details in the header in **both Arabic and English**.
- Documents carry a **circular blue official stamp**.
- Space for a **manager signature** and a **hospitality officer signature**.
- Style is traditional/formal — appropriate for quotations, contracts, and
  customer-facing documents.

Owner's intent: **not** to copy the old design verbatim, but to evolve it into
clean, professional official documents that keep the entity's character.

---

## 4. What the two papers represent (domain reference)

They are a **package/offer system** for hospitality services and event
organization. A service is primarily priced from:

1. Number of guests (المعازيم)
2. Number of hosts (المضيفين)
3. Number of service lanes (مسارات الخدمة)
4. Number of coffee dallahs (دلال القهوة)
5. Number of supervisors (المشرفين)
6. Hospitality supplies (مستلزمات الضيافة)
7. Event location relative to **Nizwa** (نزوى)

> Insight: this validates the product's existing `packages` concept (editable
> templates applied as snapshots) as the right model — quotations should be
> built from **editable packages**, not typed from scratch each time.

### The four legacy offers (recorded exactly as written — do NOT "correct")

Common inclusions across all offers: VIP glass cups (فناجين زجاجية VIP), paper
cups (فناجين قرطاسية), wet & dry tissues (كلينكس/مناديل مرطبة وجافة),
hospitality utensils (أواني وأدوات الضيافة), small & large trash bags (أكياس
نفايات صغيرة وكبيرة).

| Offer | Guest range (max) | Service lanes | Hosts | Golden dallahs | Price |
| --- | --- | --- | --- | --- | --- |
| 1 | 10–100 | 1 | 5 + 1 supervisor | 5 (special coffee) | 140 OMR |
| 2 | 100–200 | 2 | 10 + 1 supervisor | 10 (special coffee) | 230 OMR |
| 3 | 200–350 | 3 | 15 + 1 service supervisor | 15 (special coffee) | 310 OMR |
| 4 | 300–550 | 4 | 20 + 2 supervisors | 20–25 (special coffee) | 400 OMR |

### Transport / location rule

> "هذه العروض في حدود نزوى فقط، أما خارج نزوى فيضاف عليها النقل حسب الموقع."

- Base prices apply **within Nizwa only**.
- Outside Nizwa, a **transport/relocation fee is added per location**.
- No fixed amount is assumed — transport is a per-location variable.

### Overlap caveat (owner-flagged)

Guest ranges overlap as printed: 10–100, 100–200, 200–350, 300–550 (notably
offer 3 and 4 overlap between 300 and 350). Keep this **as the legacy pricing
state**. Do **not** convert these boundaries into strict code business rules
until a new pricing method is deliberately decided.

---

## 5. Real business flow (reference for architecture & product decisions)

```
عميل (Customer)
  → مناسبة/فعالية (Event)
  → موقع (Location)
  → عدد ضيوف (Guest count)
  → اختيار باقة أو تسعير مخصص (Package or custom pricing)
  → احتياجات عمالة ومعدات (Staff & equipment needs)
  → عرض سعر (Quotation)
  → موافقة العميل (Acceptance)
  → تجهيز المناسبة (Preparation)
  → تنفيذ (Execution)
  → تحصيل (Collection)
  → مصروفات وربحية (Expenses & profitability)
```

### Data fields the business may need (future reference — NOT to add now)

Customer, event, event date/time, location, guest count, event type, package,
host count, supervisors, service lanes, hospitality supplies, coffee dallahs,
extra services/add-ons, transport fees, discounts/additions, final price,
deposit (عربون), remaining amount, quote status, booking/event status, actual
expenses, actual profitability.

> These are domain facts to respect when making architecture/product decisions.
> They are **not** a scope expansion for the current phase.

---

## 6. Product identity policy (owner's stated preference)

- **Product/system** = hospitality & events business-management system
  (current UI name: "نظام إدارة الضيافة").
- **Tenant using it** = مشاريع جودة الإنطلاقة.
- The tenant identity must appear **clearly** inside the app and on quotations,
  invoices, documents and print output — professionally branded.
- Identity data should live in **organization settings**, not as hard-coded
  strings scattered in code. Fields that belong there (future): name, logo,
  phone numbers, C.R., postal code, address, signature data, identity colors.

### Current implementation status

- Tenant name already surfaces automatically from `organizations.name` /
  `display_name` (see `src/components/layout/AppShell.tsx`).
- Owner name already surfaces from `profiles.full_name` (see
  `src/features/home/HomePage.tsx`).
- **Gap (future, not now):** the `organizations` table has no logo, phone,
  C.R., postal-code, address, signature, or color fields, and official
  documents (quotations/invoices) do not yet carry a branded letterhead. This
  is recorded as future work; the owner has explicitly deferred it.

---

## 7. Hard constraints (owner instructions)

1. **Do not enter data that does not exist** — no P.O. Box number, no street
   address, no invented figures.
2. **Do not turn the legacy prices/boundaries into hard-coded constants** in
   code without a real need; they are editable business data.
3. **Do not expand the current scope** just because the business nature was
   explained. This document informs decisions; it does not authorize new
   features.
4. When official documents are designed (future), quotations and invoices must
   carry the **مشاريع جودة الإنطلاقة** identity professionally.

---

*No code or schema changes were made from this reference in this session. This
is a documentation/reference update only.*
