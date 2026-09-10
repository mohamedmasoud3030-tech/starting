# SHARED_COMPONENT_ARCHITECTURE.md

> Phase 5 deliverable. Inventories the current UI/library, classifies each
> component (KEEP/IMPROVE/MERGE/SPLIT/REPLACE/REMOVE-AFTER-MIGRATION) and
> defines the canonical responsibilities, variants and states.

## 1. Current inventory
- **UI kit (`src/components/ui/`):** Badge, Button, Card, Dialog, Input,
  Select, Textarea, Label, Field, Skeleton, Spinner, Toast(+context),
  AsyncState, EmptyState, ErrorState, LoadingState, PageHeader, SectionHeader,
  StatCard, QuantityStat, SegmentedControl, PaginationBar, TruncationNotice,
  Can, ConfirmPanel, VoidReasonPanel, JobPath, ThemeToggle, fieldContext,
  toastContext.
- **Layout (`src/components/layout/`):** AppShell, DesktopSidebar, MobileNav,
  navConfig, OrganizationSwitcher, OfflineBanner.
- **Money:** `src/components/MoneyInput.tsx` (exact OMR 3-dec input).
- **Domain documents (`components/documents/`) and print documents** live under
  features but reuse the same shell/identity.

The app already centralizes the **hard, high-risk controls** (MoneyInput,
Dialog, ConfirmPanel, VoidReasonPanel, PaginationBar) and the **layout shell**
with role-filtered nav. It deliberately does **not** over-abstract: buttons,
inputs and cards are thin primitives, which is the correct bias.

## 2. Classification

### LAYOUT
| Component | Class | Notes / canonical rules |
| --- | --- | --- |
| AppShell | KEEP | Right RTL shell; role-filtered nav; org switcher; offline banner |
| DesktopSidebar | IMPROVE | See nav-density recommendation (Phase 3): fewer groups for the owner persona; keep capability filter |
| MobileNav | KEEP | Bottom bar (3 primaries + More) + grouped drawer; RTL; safe-area aware |
| OrganizationSwitcher | KEEP | Multi-org switch w/ per-role label |
| OfflineBanner | KEEP | Informational only (no offline writes) |
| PageHeader | KEEP | Canonical page title + description + actions (title/desc/actions) |
| SectionHeader | KEEP | For sub-sections |

### ACTIONS & NAV
| Component | Class | Notes |
| --- | --- | --- |
| Button | KEEP | primary/secondary/outline + size; min touch target |
| IconButton | MERGE | Prefer labeled Button or Button with icon; keep icon-only only in dialogs/headers with aria-label |
| ActionMenu / row actions | IMPROVE | Standardize row-action menu pattern where rows grow >1 action (see EventsPage row + edit) |
| Link | KEEP | TanStack Link typed to routes |
| Tabs / SegmentedControl | KEEP | Use SegmentedControl for ≤5 short options; WorkspaceTabs for event tab strip |
| PaginationBar | KEEP | Arabic-first, large targets |
| Breadcrumbs | not present | Add only inside deep detail (customer file / quote / event) if useful; not required |
| FilterBar | MERGE/ADD | Events/Catalog/Quotes each hand-roll search+filter chips; extract a shared FilterBar (search input + chip group) to remove duplication — candidate foundation (Phase 8 #4) |

### FORMS
| Component | Class | Notes |
| --- | --- | --- |
| Field / Label / Input / Textarea / Select | KEEP | Thin primitives; Field carries label+required+hint+error |
| MoneyInput | KEEP | Exact OMR 3-dec, milli-OMR arithmetic; do not reimplement |
| FormActions | IMPROVE | Standard sticky footer actions (cancel/submit) + duplicate-submit lock; currently duplicated in dialogs |
| ValidationSummary | IMPROVE | Inline field errors exist; add a top-level summary for long forms only if needed |
| Dialog | KEEP | Radix; used for create/edit + confirm/void |
| Drawer/Sheet | not present | Mobile detail/edit can use Dialog (full-width) — no new drawer needed |

### DATA DISPLAY
| Component | Class | Notes |
| --- | --- | --- |
| Card / Badge / StatCard / QuantityStat | KEEP | Thin primitives |
| **StatusLabel (canonical enum)** | **ADD (M-01 seed)** | Single source label+tone for lifecycle enums; events done; extend to all enums |
| List / ListItem | IMPROVE | Standardize row-list (table-to-list) item presentational parts |
| DataTable | IMPROVE | Reports/accounting hand-roll tables; add a thin shared DataTable only for sorting/empty/scroll consistency if reused >2 places |
| KeyValue / DetailField | ADD | customer file + member file duplicate key/value dl blocks; extract a shared detail-list presentational component |
| Avatar / Timeline | IMPROVE / KEEP | EventTimeline exists in workspace; Attendance/history ledgers are lists |
| Skeleton / EmptyState / ErrorState / LoadingState / AsyncState | KEEP | Well-typed; single canonical state API |

### FEEDBACK & OVERLAYS
| Component | Class | Notes |
| --- | --- | --- |
| Alert / Banner / Toast | KEEP | Toast + inline error + offline banner |
| ConfirmPanel / VoidReasonPanel | KEEP | Destructive safeguards require explicit reason |
| Dialog / Popover / Tooltip | KEEP | Radix dialog; use tooltips sparingly (Arabic RTL) |
| **PermissionState** | ADD/centralize | `/procurement` uses an inline message; make a shared PermissionState(requiredCapability) for consistency across gated pages |
| OfflineState | KEEP (banner) | Informational |

## 3. Canonical contract for the highest-leverage items

### Button
Responsibility: one visible action.
- Variants: primary (default), secondary, outline, danger-ghost. Sizes: sm / md(=default, min-h ~44) / lg.
- States: idle/hover/focus-visible/active/disabled/loading(spinner+disabled).
- Rules: full-row on mobile inside form actions; never icon-only without aria-label; never two "primary" on one dialog (one submit primary).

### StatusLabel (data display) — canonical enum presentation
Responsibility: map a server enum to a stable Arabic label + optional Badge tone.
- Contract: `{ label, tone }` from a **single canonical map per enum** in `@/lib` (no per-page copies).
- States: known enum → badge; unknown → keep raw only as defensive fallback (shouldn't happen).
- RTL: text is Arabic-native.
- Tests: coverage map (M-01 added for event status).

### PermissionState
Responsibility: explain *why* a gated surface is empty to an authorized-but-not-capable member.
- Contract: `requiredCapability`, optional `onRequestAccess`/CTA.
- Rule: this is UX only; the server remains the boundary.

### FilterBar (extract from duplicates)
Responsibility: one reusable search + segmented filter + sort + count bar.
- Rule: not a giant prop box — a title/slot for controls; pages still own their filtering logic.

### DetailField / KeyValueList
Responsibility: label+value rows grouped into sections for record detail.
- Contract: `<dl>` semantics, RTL, optional `mono` for OMR/numbers, tooltip help optional.
- Migrates CustomerDetail + StaffProfile duplicated `<dl>` markup.

## 4. Migration priority & deprecation
| Component | Priority | Consumers to migrate | Deprecation plan |
| --- | --- | --- | --- |
| StatusLabel canonical (events) | DONE (M-01) | events/home/calendar/workspace/reports/consumables reservations | parallel maps removed |
| StatusLabel extended (all enums) | P1 | quote/invoice/payment/procurement/contract/meal/staff/membership | remove local maps after each |
| FilterBar | P1 | Events → Catalog → Quotes | keep local until all 3 move |
| DetailField / KeyValueList | P1 | CustomerDetail → StaffProfile | remove local `<dl>` after |
| PermissionState | P1 | Procurement → future gated pages | centralize inline message |
| WorkspaceTabs grouping | P2 | EventWorkspace | compatibility `?tab=` map |
| DataTable (thin) | P2 | Reports → Accounting | only if >2 tables want shared sort |

> Rule: no generic mega-component; no premature abstraction. Each item above is
> justified by ≥2 real duplicated usages or a real consistency defect.
