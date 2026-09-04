---
name: implementation
description: "Execute approved Starting changes with repository-first discipline, prove-it testing, minimal diffs, cleanup, and full quality gates. Use for feature, bug-fix, refactor, SQL, frontend, or cross-layer implementation work."
---

# Implementation

Implement the requested scope completely while preserving repository invariants.

## Before editing

1. Read `AGENTS.md`.
2. Read the relevant implementation plan or authoritative domain contract, if one exists.
3. Inspect the current code and tests for the affected behavior.
4. Confirm current branch/PR overlap before changing shared surfaces.
5. Apply `source-driven-development` for any version-sensitive external API or tool behavior.
6. If SQL, RLS, RPCs, indexes, migrations, or pgTAP are involved, also apply `postgres-rls`.
7. If auth, capabilities, cross-tenant access, sensitive financial actions, secrets, or trust boundaries change, also apply `security-threat-model`.

## Execution discipline

- Make the smallest coherent change that satisfies the acceptance contract.
- Reuse current repository patterns before creating abstractions.
- Do not change unrelated behavior "while here".
- Do not add dependencies unless the task demonstrates that existing tools are insufficient.
- Do not edit `src/lib/database.types.ts` manually.
- Do not edit applied migrations; create the next migration when schema behavior must change.
- Keep OMR arithmetic exact and consistent with `src/lib/money.ts`.
- Keep authorization at the data/server boundary; UI role checks are presentation only.
- Preserve organization isolation and composite ownership constraints.
- Never create fake production data, placeholder security, silent fallbacks, or nonfunctional UI.

## Prove-It pattern

For a confirmed bug:

1. Add or identify a test that demonstrates the defect.
2. Run it and verify it fails for the expected reason.
3. Apply the minimum fix.
4. Run the same test and verify it passes.
5. Add adjacent regression coverage only where it protects a real boundary.

For new behavior, write acceptance tests at the narrowest stable contract before or alongside implementation.

## Cleanup is part of the change

Before finishing:

- remove obsolete code paths made unreachable by the change;
- remove superseded tests instead of keeping contradictory expectations;
- remove temporary scripts, fixtures, debug output, generated scratch files, and abandoned experiments;
- remove dead imports/exports and duplicate helpers;
- update or delete documentation/contracts that became false;
- do not leave parallel "old" and "new" implementations unless compatibility explicitly requires both.

Never delete immutable migration history or audit history as "cleanup".

## Verification

Run targeted checks during development, then the relevant full gates:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke:production
```

When database behavior changes, additionally run the repository's authoritative database replay/tests and relevant concurrency proofs, then regenerate database types through the documented generator and verify no drift.

Do not claim a gate passed unless it was actually executed or backed by current CI evidence.

## Completion report

Report:

- what changed;
- what was deliberately left unchanged;
- tests/gates actually executed and their results;
- cleanup performed;
- any remaining verified risk or external environment item.
