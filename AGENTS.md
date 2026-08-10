# Bridge contributor instructions

Bridge is a TypeScript/pnpm monorepo for a shared decision and specification control plane used by AI agents.

## Before changing code

1. Read `README.md` for setup and the fresh-project workflow.
2. Read `docs/working-context.md` for the current product decisions, implementation state, and known boundaries.
3. Read the relevant sections of `docs/technical-architecture.md` and `docs/mvp-backlog.md` before changing an API, domain rule, migration, adapter, or worker behavior.

## Non-negotiable scope boundaries

- The product owner reopened authentication and organization scope on 2026-08-10. Keep identity changes inside the approved OIDC/membership backlog slices; do not silently expand into enterprise federation/provisioning or claim production readiness before the remaining scope, RLS, audit, and deployment controls are complete.
- MCP is optional. Every important workflow must continue to work through the REST API, CLI, repository snapshots, or web UI when MCP is not approved.
- Human approval remains distinct from agent recommendation. Agents may create questions, assumptions, drafts, and run records; only the existing human policy boundary may accept decisions or approve specifications.
- Do not store secrets, tokens, raw transcripts, private reasoning, or customer data in the repository or documentation.

## Architecture rules

- Keep the dependency direction `transport/UI -> application -> domain`; infrastructure implements repository and integration boundaries.
- REST is the canonical business boundary. CLI and MCP must use application/API contracts rather than writing directly to PostgreSQL.
- Schema changes require a forward-only Drizzle migration, matching metadata, mapper/repository updates, and regression coverage.
- Preserve tenant/project access checks and version/idempotency semantics when extending commands.
- Preserve unrelated user instruction content when changing agent adapters; use the existing managed-block merge pattern.

## Validation

Use Node.js 24+ and pnpm 11+.

```bash
pnpm install
pnpm check
```

The PostgreSQL integration test runs only when `BRIDGE_TEST_DATABASE_URL` points to an isolated database. Do not point it at a shared or production database.

When a change affects product behavior, update `docs/working-context.md`, add or adjust tests, and record any remaining limitation in the appropriate backlog section.

Keep changes focused, avoid unrelated formatting churn, and explain migration or policy trade-offs in the pull request.
