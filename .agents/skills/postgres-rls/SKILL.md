---
name: postgres-rls
description: "Design, implement, or review Starting PostgreSQL/Supabase migrations, RLS, SECURITY DEFINER RPCs, schema constraints, indexes, concurrency, idempotency, and pgTAP tests with project-specific tenant and financial integrity rules."
---

# PostgreSQL and RLS

Use PostgreSQL as the current business-rule authority without importing generic Supabase assumptions that conflict with this repository.

## Before changing SQL

1. Read `AGENTS.md`, `ARCHITECTURE.md`, and the relevant data/domain document.
2. Inspect the latest migration and all later migrations that touch the same object.
3. Inspect existing RPC, RLS, audit, idempotency, capability, and concurrency patterns before inventing a new one.
4. Apply `source-driven-development` when PostgreSQL/Supabase behavior is version-sensitive or uncertain.

## Migration rules

- Applied migrations are immutable.
- Add a new ordered migration for every new schema or behavior change.
- Make replay from an empty database succeed.
- Keep data backfills deterministic and explicit.
- Do not hide incompatible history by editing old files.
- Do not hand-edit generated TypeScript database types.

## Tenant and privilege rules

For every new or changed business object, evaluate:

- organization ownership on the row;
- composite FK/constraint protection against cross-org references where applicable;
- RLS enabled and policies scoped to active membership/organization;
- exact table/view/function grants;
- sensitive writes through approved RPC boundaries;
- SECURITY DEFINER functions with controlled `search_path`;
- authorization re-derived server-side rather than trusting UI or caller claims;
- cost/payroll/financial read capability separation.

Avoid duplicating authorization rules in several inconsistent helpers.

## Transaction integrity

For stateful or financial commands:

- use the repository idempotency pattern;
- fingerprint payloads where replay ambiguity is dangerous;
- lock rows in a stable order when concurrent mutation can conflict;
- keep audit writes internal;
- prefer reversals/append-only history over destructive mutation for ledgers;
- enforce critical invariants structurally when PostgreSQL can enforce them.

## Performance discipline

- Index FK and high-value filter/join columns when evidence shows the access path requires it.
- Evaluate RLS predicates as query-plan participants, not just security text.
- Use `EXPLAIN`/query evidence for meaningful optimization work.
- Avoid speculative indexes and broad denormalization without a measured need.
- Preserve simple operational behavior at the project's current scale unless a verified bottleneck exists.

## Required database tests

Select applicable proofs:

- authorized success;
- unauthorized denial;
- cross-organization denial;
- inactive organization/membership denial;
- direct-write bypass denial;
- function grant/revoke correctness;
- invariant/check/FK enforcement;
- idempotent replay and conflicting replay;
- reversal/immutability rules;
- concurrency race proof;
- exact OMR financial behavior;
- migration replay from empty;
- pgTAP coverage for the governing contract.

Run the project's native/Supabase verification path documented in `PROJECT_COMMANDS.md` and regenerate types through the official command when schema output changes.

## Accounting boundary

When implementing ledger, treasury, customer balances, procurement/expense posting, payroll posting, or financial closure, read `docs/research/accounting-posting-contract.md` first. Do not invent accounting policy inside a migration.
