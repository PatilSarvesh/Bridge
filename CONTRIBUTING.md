# Contributing to Bridge

Thanks for helping build Bridge. The project is currently a functional prototype: the core question/specification workflow is implemented, while authentication, organization onboarding, production identity, and enterprise integrations are intentionally deferred.

## Local setup

Requirements:

- Node.js 24 or newer
- pnpm 11 (`corepack enable` can activate the version declared by the repository)

If you use nvm, `nvm use` reads the repository's `.nvmrc` and selects Node 24.

```bash
pnpm install
pnpm check
```

For the local UI, run the API and web app in separate terminals:

```bash
pnpm dev:api
pnpm dev:web
```

The API uses seeded in-memory state unless `DATABASE_URL` is set. For durable local development, copy `.env.example`, provide an isolated PostgreSQL database, run `pnpm db:migrate`, and then start the API.

The standalone MCP process is optional. When enabled, it requires `DATABASE_URL` and must point to the same migrated database as the API so agent writes are visible in the web UI.

The PostgreSQL integration test is opt-in:

```bash
BRIDGE_TEST_DATABASE_URL=postgresql://bridge:bridge@127.0.0.1:5432/bridge_test \
  pnpm --filter @bridge/database test
```

Never use a shared or production database for tests.

## How to make a change

1. Read `docs/working-context.md` and the relevant architecture/backlog sections.
2. Keep changes inside the existing package boundaries. The API/application/domain contracts are the source of truth; CLI, MCP, and web are adapters.
3. Add regression tests for changed behavior.
4. For database changes, add a forward-only Drizzle migration and update schema, mappers, repositories, metadata, and tests together.
5. Preserve the explicit no-authentication/no-organization-onboarding boundary and MCP-independent operation.
6. Update the living context and backlog when behavior, decisions, validation, or limitations change.
7. Run `pnpm check` before opening a pull request.

## Pull requests

Describe:

- What changed and why.
- Which API, CLI, MCP, UI, database, or worker contracts changed.
- Tests run and whether the optional PostgreSQL test was enabled.
- Any migration or rollout steps.
- Known limitations and follow-up work.

Do not commit `.env` files, credentials, tokens, generated build output, local databases, or customer data. Keep unrelated user instruction content intact when changing agent adapter files.
