---
name: implementation-planning
description: "Create deterministic, repository-grounded implementation plans for Starting features, refactors, architecture changes, financial tranches, security work, or infrastructure changes before execution."
---

# Implementation Planning

Turn a requested change into an executable plan without inventing repository state.

## Repository gate

Read only what is needed, but establish these facts before planning:

1. `AGENTS.md` and the relevant architecture/domain document.
2. Current implementation, tests, public APIs/RPCs, and affected migrations.
3. `README.md` for the latest repository-verified snapshot, then verify volatile facts directly.
4. Treat dated `PROJECT_STATUS.md` / `PROJECT_DEFECTS.md` entries as historical evidence unless re-confirmed against current code and GitHub state.
5. Current branch/open-PR state when concurrent work could overlap.
6. `docs/research/accounting-posting-contract.md` for accounting or posting work.

If a decision depends on changing external technology, apply `source-driven-development` before selecting the pattern.

## Plan structure

Produce a plan that makes another engineer able to execute without re-designing the task:

1. **Goal and non-goals** — exact behavior to add/change and what stays untouched.
2. **Current evidence** — files, functions, tables, tests, or contracts that establish the baseline.
3. **Architecture decision gate** — only when a material trade-off exists:
   - context;
   - viable options;
   - chosen option;
   - why alternatives were rejected;
   - consequences and rollback constraints.
4. **Change map** — concrete files/surfaces expected to change.
5. **Execution phases** — dependency-ordered, each with observable completion criteria.
6. **Security and data-integrity checks** — tenancy, capabilities, money, idempotency, lifecycle, migration safety as applicable.
7. **Test plan** — targeted proof first, then repository gates.
8. **Cleanup plan** — obsolete code, tests, temporary files, duplicate contracts, stale imports, and superseded documentation to remove or update.
9. **Acceptance contract** — concise pass/fail criteria.

## Planning rules

- Respect an explicit user-specified sequence or tranche boundary. Do not reorder work because a generic workflow prefers database-first, frontend-first, or architecture-first delivery.
- Prefer the smallest complete vertical change that preserves current contracts.
- Do not add a new dependency, table, capability, service, or abstraction without a demonstrated need.
- Do not hand-wave generated artifacts. State who owns them and how they are regenerated.
- Applied migrations are immutable; a plan that edits migration history is invalid.
- Planning-only tasks must not change production behavior.

## Accounting work

For treasury, balances, expenses/procurement, payroll, ledger, or financial closure:

- Treat the accounting posting contract as authoritative unless the user explicitly changes policy.
- Separate accounting-policy decisions from implementation mechanics.
- Require exact OMR semantics, idempotency, reversals, tenant isolation, capability gates, and reconciliation acceptance tests where relevant.
- Do not silently broaden a tranche into unrelated accounting subsystems.

## Final quality check

A valid plan has no "implement appropriately", "handle edge cases", or equivalent placeholders for material behavior. Every risky boundary must have a concrete rule or an explicit unresolved decision.
