# 21 — Architecture decision: how staff join the office

**Status:** Accepted 2026-08-19  
**Owner product inputs:** one office only; owner invites staff; no open offices.  
**This file locks the technical default.** It does not implement the feature.

## Decision

**Attach an existing login to the office by email.**  
The owner does not send product emails. The staff member creates a normal
login first, then the owner adds that email to مشاريع جودة الإنطلاقة.

Supporting rules:

1. **No Auth Admin invite API** (`inviteUserByEmail`) and no `service_role` /
   secret key in the browser or in this SPA.
2. **No new backend / Edge Function / email vendor** for joining.
3. **Deactivate membership** (`INACTIVE`). Do not delete the row.
4. **First office bootstrap stays** via existing `create_organization`.
5. **Staff happy path is wait-for-invite**, not “create another office”.
6. When this is implemented, membership writes go through a **server command**
   (SECURITY DEFINER RPC) that looks up `auth.users` by email. The browser
   never reads `auth.users` and never receives a secret key.

## Options evaluated

| Option | Fit | Reject reason |
| --- | --- | --- |
| **A. Attach existing user by email (chosen)** | Matches one-office + invite-staff. Uses current memberships table and OWNER-only rule. | Staff must create a login first (one extra step). |
| B. Supabase `inviteUserByEmail` | Official invite email. | Admin API requires the project **secret key on a trusted server**. Official docs forbid putting that key in a browser. This repo has **no custom backend**. Adding Edge Functions + email templates + redirect allowlists is new operational burden and cost. |
| C. Owner creates users with Admin API | One-step for owner. | Same secret-key problem. Owner would set other people’s passwords. |
| D. Invite tokens / magic links in-app | Slightly nicer UX. | Extra tables, expiry, lost-link support. Still no email unless we add a vendor. Not the smallest version. |
| E. Dashboard-only add user | Zero code. | Non-technical owner cannot operate the dashboard as the daily path. |

Official constraint verified 2026-08-19 from
[Supabase Auth Users — Inviting users](https://supabase.com/docs/guides/auth/users):
inviting a user is an **admin action**, must use the **secret key** in a
**trusted server** (or the Dashboard). The secret key bypasses RLS and must
never ship in a client.

## Why this fits the current project

- Memberships already exist (`organization_memberships`, statuses include
  `ACTIVE` / `INACTIVE` / `INVITED`).
- Security doc already says membership management is **OWNER only**.
- RLS already has `memberships_write_owner`.
- Auth is email + password only. Signup page already creates a login.
- Money, RLS, and event logic stay untouched.
- Reversible: a later migration can add email invites if the owner pays for
  and approves a server-side secret-key path.

## Important tradeoff

The manager must **create a login first**, then the owner adds the email.  
There is no automatic invitation email from the product.

## Change this default only when

- The owner approves a **paid/hosted backend or Edge Function** that can hold
  the Supabase secret key, **and**
- They want the product itself to send invitation email, **and**
- They accept email-template and redirect-URL operations.

Until then, do not add a backend just to send an invite.

## Implementation notes (for a later coding task — not done here)

- New forward-only migration. Do not edit applied migrations.
- Commands such as `add_organization_member(org, email, role)` and
  `set_membership_status(org, user, ACTIVE|INACTIVE)`.
- Lookup email inside the function (`auth.users`); return a stable Arabic
  error if no login exists (`USER_NOT_FOUND`) or already a member.
- Owner cannot deactivate the last OWNER.
- Do not put email uniqueness leaks into a public page; this command is
  OWNER-only on an already authenticated session.
- `create_organization`: keep for the first owner; invited staff must not be
  guided to create a second company.
- pgTAP + UI tests required. `database.types.ts` only via generator.
- No demo users. No hardcoded credentials.
