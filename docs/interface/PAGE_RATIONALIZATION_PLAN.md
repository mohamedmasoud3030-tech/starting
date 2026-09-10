# PAGE_RATIONALIZATION_PLAN.md

> Phase 3 deliverable. Decides for every route whether it should **Keep,
> Merge, Split, Move, Replace, Remove, or Redirect**, with evidence, role/user
> impact, technical dependencies, migration risk and verification.
>
> Governing rule (per mandate): a working capability/route is **never removed
> permanently** until its replacement and compatibility path exist and are
> verified. Everything here below that says "Merge"/"Move" is therefore a
> **forward plan with a compatibility layer**, not an immediate deletion.

## 0. Context that shapes the plan

- The app is genuinely **event-centric** and its top-level routes already map
  to real tasks (verified against code + runtime evidence). There is little
  task duplication at the route level; the tension is **operational framing
  overlap** between `/home`, `/operations` and `/calendar`, and **navigation
  density** for the 50+ owner persona.
- Server is authoritative for roles. Route visibility = capability-filtered
  nav + server gate. So "move admin under settings" is safe **only** if server
  gating stays as-is.

## 1. Decision table

### KEEP (as-is, single coherent purpose)
| Route | Why keep | Evidence | Roles | Risk |
| --- | --- | --- | --- | --- |
| `/login` `/signup` `/forgot-password` | Auth must remain distinct | routes.tsx, auth flows | public | — |
| `/home` | Distinct *today-ops* triage (readiness+collection) | HomePage projection | ALL | — |
| `/events` `/events/$eventId` | Core domain center | EventWorkspace 13 tabs | ALL per-tab | — |
| `/quotes` `/quotes/new` `/quotes/$quoteId` | Sales pipeline & wizard | quotes feature | commercial | — |
| `/catalog` `/packages` | Commercial setup | catalog/packages | ALL read / comm write | — |
| `/customers` `/customers/$customerId` | Directory + relationship detail | customers feature | ALL | — |
| `/procurement` `/procurement/restaurants` | Cost-role ops | procurement/restaurants | cost roles | — |
| `/consumables` | Stock ledger | consumables | ALL (adj OWNER/MGR) | — |
| `/staff` `/staff/$staffId` | Team + per-member HR file | staff feature | ALL (payroll.read) | — |
| `/reports` `/accounting` `/integrity` `/search` | Distinct analysis/query tasks | intelligence/accounting | per role | — |
| `/calendar` | Date-scoped browsing distinct from `/home` | CalendarPage | ALL | — |

### MERGE (surface overlap; unify framing, keep destinations via redirect)
| Routes | Evidence / why | Decision | Impact | Deps | Risk | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| `/home` + `/operations` | `/home` (today cards+readiness+alerts+collection) and `/operations` (active events grouped today/tomorrow/not-ready/dispatch-return) both answer "what needs ops attention today"; the readiness model is shared. Kept as two routes today because `/home` is the owner's daily dashboard and `/operations` the supervisor's deeper schedule board. | **Phase-2 candidate:** keep `/home` as the landing triage; convert `/operations` into the dedicated "schedule & readiness" board and de-emphasize /home's redundant lower sections if they duplicate it. Do **not** merge blindly — confirm persona usage first. | Low (nav clarity) | command-center `?tab=` & readiness unchanged | Low | Owner review of nav grouping |

### SPLIT (reduce a heavy surface)
| Surface | Evidence / why | Decision | Impact | Deps | Risk | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| `/events/$eventId` — 13 peer tabs | One detail page carries 13 peer tabs (ملخص، التسعير، الفريق، المعدات، المخزن، المواد، المشتريات، المدفوعات، الفواتير، المالية، الحضور، الأجور، السجل). For a 50+ operator this is cognitive overload even with the command center. | **Candidate (later, high-care):** group tabs into 3 labeled segments in the tab strip — التشغيل (التسعير/الفريق/المعدات/المخزن/المواد/المشتريات)، المالية (المدفوعات/الفواتير/المالية)، السجلات (الحضور/الأجور/السجل) with ملخص pinned. Deep links `?tab=` map to a segment+tab and resolve to a valid tab (already enforced). Pure presentation; no data/route change. | Medium (clarity↑) | WorkspaceTabs + resolveActiveTab + readinessTab mapping | Medium — touches product center | Unit tests for tab mapping + manual journey on all roles |

### MOVE (place under the correct owner of the task)
| Route | Evidence / why | Decision | Impact | Deps | Risk | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| Membership/team admin currently inside `/settings` | Ownership: membership management is OWNER-only (`TeamPanel` inside SettingsPage). It is a rare admin task, not daily work. | Keep inside `/settings` (settings is the "النظام" area, gated) — it is already correctly segregated from normal nav. Only action: ensure it never surfaces in non-OWNER nav (verify `TeamPanel` guarded by OWNER, not just hidden). | Low | server OWNER-only | Low | Confirm `team.api` write is OWNER-gated; nav doesn't advertise it |

### REPLACE (component/pattern level — see Phases 5 & 6; no route-level replacement identified)
No full route needs replacing; the replace/merge items are at the display and
shared-component level (raw enum leaks replaced by canonical labels = M-01).

### REMOVE (verified obsolete — none proposed in this cycle)
Every current route maps to a real task; **none is scheduled for removal** in
this milestone cycle. Historical removals already done in earlier migrations
(screen-reader, demo login, leaves register) are outside UI architecture.

### REDIRECT (compatibility for any future move)
- `?tab=` deep links from dashboards must keep resolving (add a compatibility
  map only if tabs are ever renamed). None needed now because no tab is renamed.
- If `/operations` is reframed, `/home`'s operational links already target
  `/events/$eventId?...`; no redirect is needed today.

## 2. Doc drift (not product routes)
`PRODUCT_SPEC.md` §4 route table and §3.3 list 12 workspace tabs and an older
route set, while the code ships 13 tabs and newer routes (`/calendar`,
`/operations`, `/accounting`, `/integrity`, `/search`, `/staff/$staffId`,
`/procurement/restaurants`). This is documentation drift, not a product
defect. Correcting docs is part of the migration housekeeping (doc-only,
zero risk).

## 3. Owner-only decisions this plan needs (none for routine work)
No change here alters market/purpose/pricing/regulated behavior/production. The
nav-density and tab-grouping changes are reversible presentation decisions made
by the architect, staged after live verification.
