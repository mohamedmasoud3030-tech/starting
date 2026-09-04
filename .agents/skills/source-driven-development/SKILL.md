---
name: source-driven-development
description: "Repository-grounded, source-verified development for Starting. Use when implementation or review depends on changing external libraries, frameworks, CLIs, PostgreSQL/Supabase behavior, browser APIs, or technical standards."
---

# Source-Driven Development

Use current repository facts and authoritative sources before choosing an implementation pattern.

## Core workflow

1. Read the relevant repository contract before researching externally:
   - `AGENTS.md`
   - `ARCHITECTURE.md`
   - `package.json` and the lockfile
   - the affected code, tests, migrations, and feature documentation
2. Identify the exact installed version or runtime behavior that matters.
3. Verify uncertain or version-sensitive behavior against the official documentation, release notes, source repository, or governing standard.
4. Prefer an established repository pattern when it is compatible with the verified current behavior.
5. Record a material source/version dependency in the implementation plan or review when another engineer would otherwise have to rediscover it.

## Source priority

Use this order unless the task gives a stronger authority:

1. Repository contracts and executable behavior.
2. Official documentation for the exact technology/version.
3. Official source code, changelogs, specifications, or standards.
4. High-quality secondary sources only when primary sources do not answer the question.

Do not treat model memory, blog snippets, marketplace prompts, or copied patterns as authoritative for fast-moving technology.

## Starting-specific rules

- The current application stack is React 19, TypeScript, Vite, TanStack Router/Query, Supabase Auth/PostgREST, PostgreSQL, Vitest, pgTAP, and oxlint.
- Do not introduce or plan around NestJS, Drizzle, Better Auth, Nx, or any other stack merely because a generic skill recommends it. Those technologies are not current repository dependencies.
- The database is the current business-rule authority. Do not invent a custom backend boundary unless an explicit architecture decision changes that contract.
- Never infer financial, tenancy, authorization, migration, or lifecycle behavior from framework defaults when the repository already defines a stricter contract.

## When external verification is unavailable

- Do not guess a new API or upgrade path.
- Prefer the existing repository pattern if it is demonstrably working.
- State the unresolved assumption in the plan or review.
- Avoid widening the change until the assumption can be verified.

## Completion check

Before finalizing a source-sensitive change, be able to answer:

- Which repository contract governs the change?
- Which exact dependency/runtime version is relevant?
- Which authoritative source confirmed the chosen behavior?
- Did the change avoid importing assumptions from a stack this repository does not use?
