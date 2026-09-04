---
name: code-review
description: "Perform evidence-based independent review of Starting changes. Use for pull requests, branch diffs, pre-merge audits, or post-implementation review; select specialist review lenses based on the actual change and keep review separate from fixes."
---

# Code Review

Review the change independently before proposing fixes.

## Step 1: Establish the change

Inspect:

- diff and changed files;
- governing contracts in `AGENTS.md` and domain docs;
- tests added/changed;
- migrations and generated artifacts;
- the implementation plan or acceptance criteria when present.

Do not review from a summary alone when the code is available.

## Step 2: Select review lenses

Use only relevant lenses, in parallel conceptually when useful:

- **Correctness** — state transitions, edge cases, error handling, stale state, invariants.
- **Security** — auth, capabilities, secrets, trust boundaries, tenant isolation.
- **Database** — RLS, grants, SECURITY DEFINER, FKs, locks, indexes, idempotency, migration replay.
- **Accounting/Money** — exact OMR, debit/credit semantics, reversals, reconciliation, financial lifecycle.
- **Frontend/UX** — Arabic RTL, accessibility, loading/error truthfulness, responsive behavior.
- **Testing/CI** — whether tests prove the behavior and whether repository gates cover regressions.

Activate `security-threat-model` or `postgres-rls` when those domains are material.

## Step 3: Report findings

Every material finding must include:

- severity: blocker / high / medium / low;
- confidence: high / medium / low;
- evidence: path plus the concrete behavior or contract violated;
- impact: what can fail or leak;
- fix class: code, test, migration, contract, or follow-up decision.

Separate verified defects from suggestions. Do not inflate style preferences into defects.

## Step 4: Deduplicate and prioritize

Merge overlapping findings that share one root cause. Put correctness, security, tenant isolation, financial integrity, data loss, and migration safety ahead of cosmetic concerns.

A review with no material findings should say so and still state what was checked.

## Separation of duties

Review is not repair.

- Do not silently modify code while performing an independent review.
- If the user asks for fixes after review, start a separate implementation pass using `implementation`.
- Re-review the resulting diff rather than assuming the fixes are correct.

## Blocking conditions

Treat these as merge blockers when introduced by the change:

- cross-organization data exposure or mutation;
- client-side authorization used as the only authorization;
- secret exposure;
- incorrect persisted financial arithmetic;
- destructive or rewritten migration history;
- unbalanced/duplicated accounting posting;
- broken idempotency on sensitive commands;
- tests that pass by weakening or deleting the governing assertion without a contract change.
