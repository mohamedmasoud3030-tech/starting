---
name: security-threat-model
description: "Threat-model and security-review Starting changes that affect authentication, authorization, RLS, capabilities, SECURITY DEFINER RPCs, tenant boundaries, financial actions, secrets, auditability, or deployment trust boundaries."
---

# Security Threat Model

Build a repository-specific threat model from evidence, not a generic checklist.

## Scope first

Identify:

1. protected assets;
2. actors and attacker capabilities;
3. trust boundaries;
4. entry points and privileged operations;
5. existing controls;
6. changed assumptions introduced by the task.

Read `AGENTS.md`, `ARCHITECTURE.md`, the relevant RPC/RLS/migration code, and security tests before concluding that a control exists.

## Mandatory Starting boundaries

Evaluate the applicable boundaries:

- organization isolation and cross-org references;
- active membership and active organization enforcement;
- capability/role checks at the database boundary;
- cost and financial-data separation;
- direct table-write or RPC bypass routes;
- SECURITY DEFINER ownership, pinned `search_path`, grants/revokes, and caller-controlled identifiers;
- command idempotency and replay;
- stable locking for concurrency-sensitive mutations;
- append-only/auditable financial and inventory history;
- secrets and public `VITE_*` exposure;
- raw backend error leakage, XSS/HTML injection, and unsafe browser rendering;
- cache clearing and organization-switch isolation;
- production-only controls versus mocked/local behavior.

## Abuse-path format

For each credible material threat, document:

**Asset → entry point → attacker prerequisite → abuse path → impact → existing control → gap → mitigation → verification**

Prefer a small number of concrete abuse paths over a long generic list.

## Evidence standard

A documented intention is not proof. Prefer:

- RLS/grant definitions;
- SECURITY DEFINER function bodies;
- composite FKs/check constraints;
- executable permission tests;
- cross-tenant pgTAP cases;
- frontend integration tests for cache/session boundaries;
- CI/deployment configuration for header and secret claims.

## Security change rules

- Do not solve server-side authorization with UI hiding.
- Do not broaden grants to make a test pass.
- Do not trust a caller-supplied organization ID without re-deriving authorization.
- Do not expose internal audit or idempotency primitives to browser roles.
- Do not add a new privileged RPC without explicit capability and tenant checks.
- Do not weaken an isolation test without an explicit contract change.

## Output

Return:

1. scope and assets;
2. trust-boundary diagram in text when it adds clarity;
3. prioritized abuse paths;
4. mitigations mapped to code/tests;
5. residual risks or environment-only verification items.

If no new material threat is introduced, state the boundaries reviewed and the evidence supporting that conclusion.
