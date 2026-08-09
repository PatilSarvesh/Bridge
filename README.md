# Bridge

Bridge is a shared decision and specification control plane for teams working with AI agents.

## Workspace

```text
apps/api       REST API
apps/mcp       MCP server
apps/web       Human review application
apps/worker    Background worker
apps/cli       Repository and operator CLI
packages/*     Shared contracts, domain, and application services
```

## Development

The repository requires Node.js 24+ and pnpm 11+.

```bash
pnpm install
pnpm check
pnpm dev
```

`pnpm dev` starts the API and web application with the dependency-free in-memory demo. `pnpm dev:all` also starts MCP and the worker and therefore requires the durable PostgreSQL configuration described below.

The vertical slice uses fixed local principals. Organization onboarding and authentication are intentionally not implemented. They remain outside the active build scope until explicitly reconsidered.

For contributors and coding agents, start with [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/working-context.md`](docs/working-context.md). Root [`AGENTS.md`](AGENTS.md) is also referenced by [`CLAUDE.md`](CLAUDE.md) so Claude-based contributors receive the same architecture and scope constraints. Every push and pull request runs typecheck, tests, production builds, and the isolated PostgreSQL check through GitHub Actions.

By default the API uses a seeded in-memory repository. To preserve agent-run metadata, assumptions, questions, accepted decisions, specifications, context snapshots, continuation locators, audit events, in-app notifications, and their transactional delivery intents across API restarts, provide a PostgreSQL database:

```bash
export DATABASE_URL=postgresql://bridge:bridge@127.0.0.1:5432/bridge
pnpm db:migrate
pnpm dev:api
```

Migrations are explicit; API startup does not modify the schema. With `DATABASE_URL` set, the same fixed demo project and sample records are seeded idempotently into PostgreSQL. The standalone MCP server requires this durable mode so MCP writes and the web/API read the same canonical state. Without `DATABASE_URL`, the API/web and CLI path remains dependency-free and resets when the API restarts.

The PostgreSQL adapter uses the same application repository contract as the in-memory implementation. Run registration/status changes, assumption lifecycle/provenance, decision acceptance/lifecycle transitions, question creation, response proposals, specification publication/approval, context snapshots, idempotency records, notifications, outbox intents, and their audit events are committed atomically. Aggregate reads used by runs, assumptions, decisions, approvals, and outbox claims take row locks inside those transactions. The worker's delivery handler is injectable; external email/team adapters are not enabled yet.

Run the live persistence integration test only against an isolated database:

```bash
export BRIDGE_TEST_DATABASE_URL=postgresql://bridge:bridge@127.0.0.1:5432/bridge_test
pnpm --filter @bridge/database test
```

The test is skipped when `BRIDGE_TEST_DATABASE_URL` is absent. Bridge does not bundle or start PostgreSQL for you.

For the human review flow, start the API and web app in separate terminals:

```bash
pnpm dev:api
pnpm dev:web
```

Then open `http://127.0.0.1:3000`. The API seeds one blocking architecture question and the web app acts as the configured decision owner. Local development identities are passed with `x-bridge-principal-id` and are only intended for the prototype.

## How agents use Bridge

Bridge is a shared service, not an SDK that must be embedded into every agent or application. A team runs the Bridge API and chooses the thinnest adapter its environment permits:

- Install the `bridge` CLI package when agents have terminal and API access. A tagged GitHub Release can provide a globally installable, checksummed tarball without requiring an npm organization.
- Check the generated `.bridge/agent-instructions.md` into each repository so supported agents follow the same workflow.
- Configure the optional MCP endpoint when the organization approves MCP.
- Let an operator or CI job run `bridge sync` and `bridge spec pull` when the agent itself cannot access the network.
- Use the web UI and manually relay structured records when no agent-side integration is approved.

The prototype packages an installable CLI tarball with `pnpm cli:pack`; `pnpm check` now installs and executes that artifact under a temporary global prefix. The tagged release workflow and operator steps are documented in [`docs/distribution.md`](docs/distribution.md). Public or organization-registry publication remains a later owner decision. No authentication or organization onboarding is being added in this phase.

After a repository is initialized, use the adapter-only command when changing clients or regenerating the managed instruction block without registering another project:

```bash
pnpm exec bridge install --client claude_code
pnpm exec bridge install --client cursor --dry-run
```

`bridge install` never calls project registration, preserves unrelated instruction content, and leaves the previous client file untouched when switching adapters.

## Fresh-project acceptance test

Start the Bridge API and UI from this repository in separate terminals:

```bash
pnpm dev:api
pnpm dev:web
```

Build the local CLI package once:

```bash
pnpm cli:pack
```

The package is written to `dist/bridge-cli-0.1.0.tgz`. For a local test, create the new repository and install that tarball as a development tool:

```bash
mkdir hospital-management-system
cd hospital-management-system
git init
pnpm init
pnpm add --save-dev /absolute/path/to/Bridge/dist/bridge-cli-0.1.0.tgz
pnpm exec bridge init \
  --name "Hospital Management System" \
  --client codex \
  --api-url http://127.0.0.1:4000

# Preview the same registration and adapter changes without mutating anything
pnpm exec bridge init --dry-run

# Verify the configured project, API, and generated instructions
pnpm exec bridge doctor
```

If MCP is approved and the shared PostgreSQL-backed MCP service is running, add `--mcp-url http://127.0.0.1:4100/mcp` to the initial `bridge init` command. Do not run two initializations; use `bridge init --force --mcp-url ...` only when intentionally updating existing Bridge-owned configuration.

Initialization registers a distinct project, writes `.bridge/project.yaml` and the Bridge workflow files, and safely creates or updates Codex's root `AGENTS.md` using a Bridge-owned marked block. Existing unrelated `AGENTS.md` content is preserved. Claude Code, Cursor, and Copilot instruction paths are also supported with `--client claude_code`, `cursor`, or `copilot`.

Open Codex in the new repository and give it the ordinary prompt:

```text
Build a Hospital Management System.
```

The repository instructions require the agent to start a Bridge run, retrieve context, route meaningful shared-authority questions through Bridge, and publish a PRD, ADR, API contract, and test plan. Open `http://127.0.0.1:3000` and select **Hospital Management System** to inspect its questions and specifications.

When the agent reaches the human boundary, verify the observable result from the new repository:

```bash
pnpm exec bridge conformance --task "Build a Hospital Management System."
```

Pass means Bridge found a matching task run, a linked context snapshot, at least one complete agent-created blocking question, all four agent-created specification types, matching run provenance, and a run that is waiting for a human or has validly completed. The command exits `10` with named failed checks when evidence is incomplete. Add `--run-id <id>` to target a particular session. If unrelated application dependency policies prevent pnpm from executing an already installed package, use `./node_modules/.bin/bridge` for the same commands without reinstalling dependencies.

This is an instruction-driven adapter, not a universal interception of every vendor's native prompt UI. Meaningful business, architecture, QA, data, privacy, security, and operational questions are in scope; private reasoning, raw transcripts, and trivial implementation chatter are not. MCP is optional: omit `--mcp-url` for the CLI/instruction-only path, or configure it to let `bridge doctor` verify an MCP `initialize` response.

On each question detail page, human contributors can add an answer with an optional selected option and rationale, or post a version-checked clarification comment/reply. Bridge keeps those responses and threads visible to the configured decision owner, who alone can accept the authoritative answer and create the Decision. The current prototype UI uses the fixed local `usr_architect` browser identity; the REST policy still distinguishes contributor discussion from owner acceptance.

On the **Decisions** page, the decision owner, a configured project decision owner, or a project administrator can supersede, expire, or revoke an active decision with a rationale. Supersession selects another active decision in the same category and exact scope. Bridge preserves the original answer, records lifecycle provenance, removes retired decisions from default agent context, and reports directly linked specifications, assumptions, runs, and work items that may need review.

On the **Specifications** page, configured reviewers and project administrators can add formal comments or request changes on the current immutable version. A change request blocks approval of that exact version; the author must publish a new version that addresses the feedback. The previous approved version, if any, remains the agent-facing authority until the replacement version is approved.

Agents can target a question to role names with `intendedOwnerRoles` in the structured question payload, for example `['QA Lead']`, `['Business Analyst']`, or `['Security Reviewer']`. Bridge normalizes those names and permits a matching human role to accept the decision. This is a fixed-principal policy seam for the prototype, not organization role administration.

For local policy testing, the web UI exposes a **Reviewing as** selector backed by `GET /v1/principals`. Switching to QA Lead or Business Analyst reloads the project-scoped views under that fixed human principal and makes role-based acceptance easy to exercise. It is deliberately a reviewer-context switcher, not authentication.

The UI separates **My Inbox** from shared **Questions**. The inbox is personalized by direct owner, assigned role, project-admin fallback, and protected-review role, with State, Risk, Category, and Role filters; the shared Questions view remains available to every authorized project participant so contributors can read and propose responses.

The **Notifications** view is a project-scoped human feed for question assignments, proposed responses, clarification comments, protected reviews, accepted decisions, decision lifecycle changes, and specification review-feedback/approval events. Clicking a notification marks it read and opens the related Bridge area; **Mark all read** updates the current project's unread state. Agents are intentionally denied this human-only feed.

The **Decisions**, **Assumptions**, and **Agent Runs** views expose durable authority and provenance outside the originating agent session. Decisions include governed human lifecycle actions and direct impact counts; assumption resolution and run lifecycle mutations remain explicit CLI/API operations in the prototype.

Protected questions also have a separate security-review step. A configured security reviewer records an approval or rejection with rationale, then the routed owner can finalize the decision only after an approval exists.

## CLI-only agent integration

Bridge does not require MCP. For an already registered project, initialize repository-owned configuration directly by ID:

```bash
pnpm --filter @bridge/cli dev -- init prj_payments \
  --api-url http://127.0.0.1:4000 \
  --repository payments-api
```

This creates `.bridge/project.yaml`, reusable agent instructions, an example structured question, and an example reversible assumption. An agent with terminal access can then use the complete run and decision handoff:

```bash
# Start a metadata-only run. Save the returned run ID and resumeContextKey
# in the agent/operator session, not in committed repository files.
pnpm --filter @bridge/cli dev -- run start \
  --task "implement transfer retries" \
  --client codex \
  --capability cli \
  --component transfers

# Retrieve approved context and link its snapshot to the run
pnpm --filter @bridge/cli dev -- context \
  --task "implement transfer retries" \
  --run-id <run-id> \
  --component transfers

# For low-risk reversible uncertainty, edit the generated example and record it.
# Non-human assumptions require runId and expire after seven days by default.
pnpm --filter @bridge/cli dev -- assumption add \
  --file .bridge/assumption.example.json

# Inspect current assumptions. Only a human decision owner/admin may resolve one.
pnpm --filter @bridge/cli dev -- assumption list
pnpm --filter @bridge/cli dev -- assumption get <assumption-id>

# Check unresolved questions and active accepted decisions before interrupting the team.
pnpm --filter @bridge/cli dev -- question matches \
  --file .bridge/question.example.json

# Submit a structured question whose JSON includes the returned runId
pnpm --filter @bridge/cli dev -- ask --file .bridge/question.example.json

# Poll for an accepted human answer
pnpm --filter @bridge/cli dev -- wait qst_example --timeout 60

# A human operator can inspect the routed inbox using a fixed local principal.
BRIDGE_PRINCIPAL_ID=usr_architect pnpm --filter @bridge/cli dev -- inbox --output human

# Inspect the durable handoff. It reports accepted decision IDs and blockers.
pnpm --filter @bridge/cli dev -- run continue <run-id> \
  --resume-key <resume-context-key>

# In a later agent session, start a linked continuation after blockers resolve.
pnpm --filter @bridge/cli dev -- run start \
  --task "continue transfer retry implementation" \
  --client codex \
  --capability cli \
  --continues <prior-run-id> \
  --resume-key <resume-context-key>

# Materialize approved context for agents without outbound network access
pnpm --filter @bridge/cli dev -- sync \
  --task "implement transfer retries" \
  --run-id <run-id>

# Publish an immutable specification version for human review
pnpm --filter @bridge/cli dev -- spec publish \
  --file docs/transfer-retry-policy.md \
  --title "Transfer retry policy" \
  --type adr \
  --run-id <run-id> \
  --component transfers

# Pull only human-approved specification versions into the repository
pnpm --filter @bridge/cli dev -- spec pull

# Read the current run version, then report a terminal outcome.
pnpm --filter @bridge/cli dev -- run get <run-id>
pnpm --filter @bridge/cli dev -- run report <run-id> \
  --status completed \
  --version <current-version> \
  --summary "Implemented the accepted retry policy"
```

`bridge question matches` returns deterministic exact or related candidates. Creating a policy-equivalent exact match reuses the existing unresolved question or active accepted decision and links it to the new run; related matches are suggestions only and are never auto-merged. The response field `submissionDisposition` tells the caller whether Bridge created, replayed, or reused the question.

`bridge sync` writes current context and provenance to `.bridge/context.md`, `.bridge/context.json`, `.bridge/decisions.json`, `.bridge/assumptions.json`, `.bridge/questions.json`, `.bridge/specifications.json`, and `.bridge/sync-metadata.json`. The questions snapshot contains unresolved questions so offline agents can avoid repeating them. Active assumptions are clearly labeled as temporary and lower-authority than accepted decisions; confirmed assumptions remain distinct from formal decisions. Rejected, expired, and superseded assumptions are not exported as current agent context. `bridge spec pull` writes approved Markdown bodies plus a checksum manifest under `.bridge/specs/`. Draft and in-review specification bodies are never exported as approved repository context. Successful command output defaults to stable JSON for agents and CI; human operators can add `--output human`. Errors remain JSON with stable exit codes in both modes so automation can react deterministically.

A blocking question atomically changes its linked run to `waiting_for_human`. Accepting the answer does not silently restart an agent session. `run continue` reports whether work can continue and which decisions were accepted; a later session explicitly creates a new linked run. The resume-context key is an opaque locator, not an authorization credential—project access is still required—and the current unauthenticated prototype must not be exposed as a production service.

The remote HTTP MCP endpoint runs at `http://127.0.0.1:4100/mcp`. It intentionally refuses to start without `DATABASE_URL`; otherwise a separate MCP process would silently write to state that the API/web cannot see.

```bash
export DATABASE_URL=postgresql://bridge:bridge@127.0.0.1:5432/bridge
pnpm db:migrate
pnpm dev:api
# In another terminal, with the same DATABASE_URL:
pnpm dev:mcp
```

The MCP server exposes run registration/continuation, assumption recording/retrieval, context retrieval, decision search, question-match/reuse workflows, filtered reviewer-inbox reads, protected-review state reads, and specification publishing/retrieval tools. Its local agent identity is `agt_codex`; only human principals can resolve assumptions, accept decisions, approve specification versions, or read the in-app notification feed. Notifications remain available through the REST API and web UI even when MCP is not approved.

## Product documentation

- [Product requirements](./docs/bridge-prd.md)
- [Pilot decisions](./docs/pilot-decisions.md)
- [Technical architecture](./docs/technical-architecture.md)
- [MVP backlog](./docs/mvp-backlog.md)

## License

Bridge is licensed under the [Apache License 2.0](./LICENSE).
