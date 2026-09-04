# AGENT_HANDOFF.md — Context for the Next AI Agent

> This file is intentionally evergreen. Do not store volatile branch SHAs, open-PR
> counts, migration totals, or test totals here. Recompute those facts from the
> current repository and GitHub state at the start of each task.

## Start here

1. Read `AGENTS.md`; its engineering rules are non-negotiable.
2. Load the relevant project Skill from `.agents/skills/` when the task matches
   its description.
3. Read the current `README.md` and the smallest relevant architecture/domain
   document.
4. Inspect the current branch, open PRs, changed files, implementation, and tests
   before planning or editing.
5. Treat dated status/review documents as historical evidence unless you
   re-confirm their claims against the current repository.

## What the project is

Starting is an Arabic-first RTL hospitality-operations application for Omani
event-service offices. The Event is the operational center of the product.

The current repository stack is React 19 + TypeScript + Vite + TanStack
Router/Query on the client, with Supabase Auth/PostgREST and PostgreSQL for the
data/business-rule boundary. There is no custom application server in the
current architecture.

Do not introduce NestJS, Drizzle, Better Auth, Nx, or another stack merely
because an external generic skill uses it. Technology changes require an
explicit architecture decision and repository adoption.

## Hard invariants

- OMR is exact to 3 decimals; browser arithmetic follows `src/lib/money.ts`.
- Applied migrations are immutable; schema changes use a new migration.
- Never hand-edit `src/lib/database.types.ts`.
- Tenant isolation and authorization are enforced at the database boundary.
- Sensitive writes use the repository's approved RPC/security patterns.
- Audit/idempotency internals stay internal.
- No fake production data, demo login paths, placeholder security, or invented
  statistics.
- Arabic RTL, accessibility, and simple operator UX are product requirements.
- Cleanup is part of implementation: do not leave obsolete code, tests,
  temporary harnesses, duplicate contracts, or stale agent instructions.

## Agent Skills

Canonical project Skills live in `.agents/skills/`:

- `source-driven-development`
- `implementation-planning`
- `implementation`
- `code-review`
- `security-threat-model`
- `postgres-rls`

Use progressive disclosure: read only the Skill that matches the current task,
then follow its links to existing repository contracts instead of loading every
document.

## Verification commands

Frontend/application gates:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke:production
```

Database work must also follow the current authoritative replay, pgTAP,
concurrency, backup/restore, and generated-type checks documented in
`PROJECT_COMMANDS.md` and CI. Never claim a database gate passed unless it was
actually executed or current CI evidence proves it.

## Accounting work

For ledger, treasury, customer balances, procurement/expense posting, payroll
posting, or financial closure, read
`docs/research/accounting-posting-contract.md` before implementation. Do not
invent accounting policy inside code or migrations.

## Production boundary

Do not perform production Supabase/Vercel mutations, destructive data actions,
paid-plan changes, or public deployment unless the task explicitly authorizes
them.
