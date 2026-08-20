# Bridge — Living Working Context

| Field | Value |
|---|---|
| Purpose | Durable handoff context for future implementation sessions and context compaction |
| Status | Active; update after every meaningful product decision or implementation slice |
| Last updated | 2026-08-20, Asia/Kolkata |
| Product | Bridge |
| Workspace | Canonical local GitHub clone: `/Users/patilsarvesh/Repos/Bridge`; original reviewed build workspace: `/Users/patilsarvesh/Documents/ChatGPT/Bridge` |
| Current implementation phase | OIDC web/API authentication with durable human sign-in/logout audit events, interactive CLI PKCE, versioned audited organization/project member administration, versioned project role/team/ownership configuration, versioned limited risk/routing/protected-action policy with immutable safety floors, explainable owner/reviewer question routing with administrator-only versioned reassignment, a due-aware personalized inbox with URL-persisted filters and server-derived action authority, governed human question collaboration with related links, mentions, revision history, clarification, and controlled reopen, completed assumption confirmation/decision-linking and scheduled expiry notification, revocable scoped service identities, permission-restricted audit browsing/export, coarse REST/MCP bearer capabilities, MCP protected-resource metadata, bounded MCP session/tool telemetry, REST-canonical project repository records with administrator web/CLI management, interactive authorized-project selection and API-validated repository initialization, project-scoped Codex/Claude MCP configuration generation, shared high-confidence secret blocking, forced RLS on the core tenant data plane, security-definer bootstrap-directory lookups, repeatable PostgreSQL role/grant reconciliation, a project-scoped pilot support view with persisted bounded adapter diagnostics, a Slack Incoming Webhook notification handler, and a deployable maintenance-role outbox worker complement the governed decision/specification MVP; failed/unknown authentication attribution, endpoint-specific tool scopes, MCP-side token issuance, provider-backed invitations, enterprise provisioning, richer connector diagnostics, provider-backed repository validation/synchronization, live Slack workspace/deployment validation, and other live integrations remain pending |
| Security posture | Production-shaped OIDC verification, membership enforcement, durable success/logout audit events for trusted human web sessions, revocable noninteractive credentials, coarse non-human REST/MCP capability checks, pre-persistence high-confidence credential detection, transaction-scoped forced RLS, bounded security-definer bootstrap lookups, fail-closed role/grant reconciliation, permission-restricted pilot support diagnostics, and secret-safe Slack delivery receipts are implemented for web/API, CLI, and optionally authenticated MCP use, but the product is not fully production-secure until failed/unknown authentication handling, endpoint-specific scopes, broader DLP, deployment, and live provider/database/audit validation are complete |

## 1. How to use and maintain this file

This is the canonical short-to-medium-term handoff document for Bridge. Read it before continuing implementation after a long pause, context compaction, or a new agent session.

Update this file whenever any of the following changes:

- The founder makes or overrides a product decision.
- A workflow becomes implemented, removed, or materially redesigned.
- A command, REST endpoint, MCP tool, entity, or policy changes.
- Validation results change.
- The next implementation slice changes.
- A new limitation or risk is discovered.

Do not store secrets, credentials, raw agent conversations, hidden reasoning, access tokens, or customer data here. Record decisions and outcomes, not private chain-of-thought.

When this document conflicts with an explicit newer user instruction, follow the user instruction and then update this document.

## 2. Founder direction and collaboration style

The founder originated the product concept and delegated ordinary product and architecture decisions to Codex. Codex should continue autonomously, make reasonable scoped decisions, and explain meaningful trade-offs.

Current explicit founder directives:

1. Build Bridge as a shared place for agent questions, accepted answers, decisions, and specifications.
2. Authentication and organization scope was explicitly reopened on 2026-08-10; implement it in controlled, testable slices.
3. Preserve the fixed-principal path only as an explicit development mode, never as production authentication.
4. MCP must be optional because some organizations do not approve MCP.
5. Provide CLI and repository-file workflows for organizations where agents cannot use MCP or initiate network requests.
6. Only humans may accept decisions or approve specification versions.
7. The founder requested a UI refresh on 2026-08-16 after finding the first pilot dashboard too clustered and dated. The active direction is a minimal workbench: warm neutral surfaces with a restrained teal action accent, grouped Work / Knowledge / Admin navigation, calmer spacing, and progressive disclosure for filters, discussion, review, comparison, and history. Each screen should foreground one primary task and keep secondary context available without presenting it all at once. This is a visual information-architecture change only; existing approval boundaries and workflows remain unchanged.
8. Maintain this file as durable context for future sessions.
9. The MVP acceptance test is a fresh repository where the user initializes Bridge, gives an agent a normal build request, and then sees that repository's structured questions and generated specifications in the Bridge UI without manually editing Bridge JSON or prompting each Bridge command.

The founder's 2026-08-10 request supersedes the earlier authentication/onboarding prohibition. The selected Auth0/OIDC design is active, while enterprise provisioning and unrelated identity expansion still require their own scoped tasks.

## 3. Product concept

### 3.1 Problem

Coding and knowledge-work agents such as Codex, Claude Code, Cursor, and Copilot encounter product, business-analysis, architecture, QA, data, security, and operational questions while implementing work.

Today:

- The person operating the agent may not own the decision.
- The operator often selects the agent’s default recommendation without understanding the trade-off.
- Questions and answers remain trapped inside one private session.
- Other team members cannot see what was asked or answered.
- Agent-generated plans and specifications are also session-local.
- Future agents repeat questions because previous decisions are not discoverable.
- Agent recommendations can be mistaken for organizational approval.

### 3.2 Solution

Bridge is a shared decision and specification control plane for teams using AI agents.

Agents can:

- Register a metadata-only unit of work and receive a durable continuation locator.
- Retrieve previously approved project context before beginning consequential work.
- Search existing decisions.
- Find exact and related unresolved questions or active accepted decisions before interrupting the team again.
- Record low-risk reversible assumptions with confidence, reversal cost, expiry, scope, and run provenance.
- Raise structured questions with options, trade-offs, recommendations, scope, risk, and intended owners.
- Publish typed Markdown specifications for human review.
- Link retrieved context, questions, and specification versions to their source run.
- Resolve blockers and start an explicitly linked continuation run in a later session.
- Retrieve accepted answers and approved specification versions in later runs.

Humans can:

- See questions outside private agent sessions.
- Receive project-scoped in-app notifications when assignments, discussion, reviews, decisions, or specification changes need attention.
- Discuss proposed answers.
- Accept one answer with an explicit rationale.
- Review and approve a specific immutable specification version.
- Confirm, reject, expire, or supersede assumptions with a rationale.
- See provenance, ownership, scope, and review state.

Bridge stores durable project knowledge rather than complete agent transcripts.

### 3.4 Founder-defined MVP acceptance journey

The decisive MVP test is:

1. The founder creates a new source-code folder, such as `hospital-management-system`.
2. The founder runs one Bridge initialization command in that folder.
3. Initialization registers a distinct Bridge project and installs or generates the client-recognized repository instructions needed by the selected agent.
4. In a normal agent chat, the founder asks: “Build a Hospital Management System.” No Bridge-specific sequence should need to be dictated in that prompt.
5. The agent starts a Bridge run and retrieves project context automatically as part of its repository instructions.
6. Every meaningful question requiring business, architecture, QA, data, security, or other human authority is submitted to Bridge with intended owners, options, recommendation, risk, scope, and run provenance. Native agent clarification prompts must not silently bypass this workflow.
7. Generated PRDs, ADRs, API contracts, and test plans are published as immutable Bridge specification versions with run provenance.
8. The Bridge UI is scoped to the newly registered Hospital Management System project and displays its questions and specifications for human review.
9. Accepted answers and approved specification versions become context for the current continuation and later agent sessions.
10. MCP remains optional; the complete acceptance journey must work through the CLI/repository adapter.

“All questions” means all structured questions that require shared human knowledge or authority. Bridge must not capture private chain-of-thought, raw transcripts, or inconsequential implementation chatter.

Current status against this journey: the infrastructure path and the first real Codex-first path pass end to end. `bridge init --name` registers a distinct project, writes repository configuration, safely merges a client-recognized instruction block, and the packaged CLI drives run/question/specification creation without MCP. The web UI lists registered projects and scopes questions and specifications to the selected project. A packaged simulation produced one protected question and all four specification types, and a separate independent Codex CLI session given only the ordinary Hospital prompt produced the same observable governed records and stopped at `waiting_for_human`. Claude Code remains the second-client validation. Bridge cannot universally intercept a vendor's private/native clarification UI when that vendor provides no enforcement hook. Organization administrators can now create short-lived, scoped service identities for CI/unattended agents through REST; the raw token is returned once and only its hash is persisted.

### 3.3 Product boundary

Bridge is not:

- A full agent chat-history store.
- A chain-of-thought or hidden-reasoning archive.
- A replacement for source control or issue tracking.
- An autonomous approver.
- Dependent on MCP.
- Fully production-secure merely because the first OIDC/membership foundation exists.

## 4. Approved product decisions

### 4.1 Positioning and pilot

- Product name: **Bridge** for the private pilot.
- Initial customer profile: software organizations with approximately 10–250 contributors using multiple coding agents and making cross-role decisions.
- Initial commercial model: free design-partner pilot for roughly two to five organizations in exchange for workflow feedback and non-confidential learnings.
- Initial agent focus: Codex first, Claude Code second, while keeping the core vendor-neutral.
- Session promise: durable continuation through shared context, not universal automatic resumption of the exact prior agent session.
- Deployment decision recorded in product docs: hosted pilot, while interfaces preserve a possible future dedicated/self-hosted deployment.

### 4.2 Human authority

- Agents and CI principals cannot accept decisions.
- Agents and CI principals cannot approve specification versions.
- Human decision owners or project administrators accept ordinary decisions.
- A decision owner, configured project decision owner, or project administrator may supersede, expire, or revoke an active decision with an optimistic version and rationale.
- Protected decisions require the appropriate human reviewer role.
- Human approval always requires a rationale.
- An agent recommendation is advisory and must be labeled accordingly.

### 4.3 Protected categories

The prototype elevates these categories to protected behavior:

- Security
- Privacy
- Authentication
- Legal
- Production deletion

Protected questions:

- Are always blocking.
- Cannot define an automatic fallback.
- Require a human security reviewer in the current vertical slice.

The full policy matrix in `docs/pilot-decisions.md` also covers authorization, secrets, regulated data, irreversible migrations, breaking public APIs, security exceptions, compliance interpretation, and recurring infrastructure spend.

### 4.4 Review defaults

- Ordinary active decisions: review after 180 days.
- Protected decisions: review after 90 days.
- Low-risk assumptions: default expiry of 7 days and hard maximum of 30 days.

### 4.5 Specifications

First-class specification types:

1. Product requirements document (`prd`)
2. Architecture decision record (`adr`)
3. API contract (`api_contract`)
4. Test plan (`test_plan`)

Specification rules:

- Markdown bodies are immutable per version.
- Each version receives a SHA-256 content hash.
- “Latest version” and “currently approved version” are separate concepts.
- Publishing a newer draft must not hide the previously approved version from agent context.
- Approving a newer version supersedes the previously approved version.
- Only the currently approved version participates in agent context and repository export.
- Draft and in-review bodies must never be represented as approved context.
- Configured human reviewers may append formal comments or request changes on the current version.
- A change request permanently blocks approval of that exact immutable version; the author must publish a new version with a clean review history.

### 4.6 Data minimization

- Do not capture raw agent sessions by default.
- Do not store private chain-of-thought.
- Do not retain repository source code in Bridge during the MVP.
- Store structured questions, rationales, decisions, specifications, provenance, run metadata, and external links.

## 5. Integration modes

MCP is one adapter, not the core product.

### 5.1 MCP mode

An approved agent client calls remote HTTP MCP tools directly.

```text
Agent -> Bridge MCP gateway -> Bridge application service -> repository
```

### 5.2 CLI mode

An agent with terminal access executes `bridge` commands. The CLI calls the same REST API and receives the same policy enforcement as MCP.

```text
Agent -> Bridge CLI -> Bridge REST API -> Bridge application service -> repository
```

### 5.3 Repository-sync mode

For agents that cannot make outbound requests, an approved operator or CI process runs `bridge sync` and `bridge spec pull`. The agent reads ordinary repository files afterward.

Generated files contain provenance, snapshot IDs, approval information, freshness timestamps, and content hashes. Local edits do not create Bridge approval.

### 5.4 Manual mode

If no automated integration is permitted, humans can use the web UI and manually exchange structured questions and approved answers with the agent.

## 6. Selected technical architecture

### 6.1 Monorepo

- Language: TypeScript
- Package manager: pnpm 11
- Task orchestration: Turborepo
- Node requirement: Node.js 24+
- Validation: TypeScript, Vitest, production builds

### 6.2 Application stack

| Concern | Current decision |
|---|---|
| Web | Next.js 16 with React 19 |
| REST API | Fastify 5 |
| MCP | TypeScript MCP SDK over Streamable HTTP |
| CLI | Node.js/TypeScript executable package |
| Contracts | Zod schemas |
| Default repository | Seeded in-memory implementation when `DATABASE_URL` is absent |
| Durable repository | PostgreSQL with Drizzle ORM and Postgres.js when `DATABASE_URL` is present |
| Queue | Typed transactional outbox claim/lease/retry cycle implemented; pg-boss or a scheduled worker runtime remains a deployment choice |
| Object storage | S3 planned for large/binary artifacts, not implemented |
| Search | Deterministic ranking now; PostgreSQL text/trigram planned |
| Authentication | OIDC web sessions, API bearer verification, interactive CLI public-client PKCE, revocable scoped service credentials, and optional standalone MCP bearer validation implemented; endpoint-specific tool scopes and MCP-side token issuance remain |
| Organization onboarding | Durable organizations/memberships, protected first-admin bootstrap, and versioned member/project-access administration UI implemented; provider invitations and enterprise provisioning remain |

### 6.3 Architectural rules

- REST is the canonical external business boundary.
- MCP and CLI call application services through approved adapters; they do not write directly to storage.
- Domain policy is transport-independent.
- Server-side policy overrides agent-provided risk classification.
- Approved records contain provenance and stable IDs.
- Agent runs store structured metadata and record IDs, never raw conversations or hidden reasoning.
- Multi-record application workflows execute through a repository transaction boundary.
- PostgreSQL workflows use serializable transactions and aggregate-root row locks for concurrency-sensitive run, decision, and approval commands.
- Database migrations are explicit and never run implicitly during API startup.
- External effects beyond the current notification delivery intent should use the transactional outbox.
- No vector database until measured retrieval quality requires it.

## 7. Repository structure

```text
apps/
  api/           Fastify REST API and API integration tests
  cli/           MCP-independent agent/operator CLI
  mcp/           Remote HTTP MCP server and MCP integration tests
  web/           Human decision and specification review UI
  worker/        Background review-reminder and outbox delivery cycle

packages/
  contracts/     Zod request/response contracts and shared types
  domain/        Entities, policy checks, and domain errors
  application/   BridgeService and BridgeRepository interface
  database/      Drizzle schema, reviewed migrations, PostgreSQL repository, mapping/integration tests
  test-support/  Fixed local principals, project, and demo fixtures

docs/
  bridge-prd.md
  technical-architecture.md
  mvp-backlog.md
  pilot-decisions.md
  working-context.md
```

## 8. Current prototype identities and fixtures

Production-shaped OIDC login and administrator-managed membership now exist. The fixed principals below remain development-only fixtures and are not production identities.

Fixed local project:

- Project ID: `prj_payments`
- Organization ID carried by domain records: `org_acme`
- Project name: Payments Platform

Fixed local principals:

| ID | Type | Purpose |
|---|---|---|
| `agt_codex` | Agent | Creates questions, retrieves context, publishes specification drafts |
| `usr_architect` | Human | Project admin, architecture owner, security reviewer, decision/specification approver |
| `usr_qa_lead` | Human | QA Lead / QA decision owner fixture |
| `usr_business_analyst` | Human | Business Analyst / BA decision owner fixture |
| `usr_contributor` | Human | Contributor without decision-owner authority |
| `usr_outsider` | Human fixture | Different organization used for isolation-policy tests |

In development mode the API receives these fixtures through `x-bridge-principal-id`. OIDC mode ignores that header and resolves the verified subject through durable memberships.

## 9. Implemented domain model

### 9.1 Questions

A question contains:

- Stable ID
- Organization and project IDs
- Optional run ID
- Title, type, and category
- Context and why-it-matters explanation
- Risk, reversibility, and blocking state
- Intended owner IDs
- Options and trade-offs
- Optional recommendation
- Optional fallback, prohibited for protected questions
- Scope: repository, component, branch, environment, and work item
- Optional typed related links for repositories, work items, branches, artifacts, runs, or external references
- Creator identity/type
- Status
- Responses, threaded clarification comments, protected reviews, and human mention/revision metadata
- Accepted response and decision references
- Optimistic version number

Question statuses:

- `open`
- `in_discussion`
- `accepted`
- `duplicate`
- `cancelled`
- `expired`

Human discussion edits preserve the previous response or comment in append-only revision history. Only the original human author can edit an unresolved discussion record; question owners can request clarification, and owners/project administrators can reopen only cancelled or expired questions. Accepted decisions retain their separate lifecycle and are not reopened by this discussion command.

### 9.2 Decisions

An accepted human answer creates a durable Decision containing:

- Decision ID
- Source question and accepted response IDs
- Approved answer and rationale
- Category and scope
- Human owner ID
- Active lifecycle state
- Created time and review date
- Lifecycle version
- Optional retirement rationale, human actor, timestamp, and same-project replacement link

Only active decisions participate in context retrieval. Human browsing is active-only by default, with explicit lifecycle history plus category, owner, created-time, and exact-scope filtering.

### 9.3 Specifications/artifacts

An Artifact is the logical specification and contains:

- Artifact ID
- Organization and project IDs
- Title and one of the four supported types
- Scope
- Reviewer IDs
- Creator identity/type
- Latest version ID (`currentVersionId`)
- Currently approved version ID (`approvedVersionId`, optional)
- Immutable version history

An ArtifactVersion contains:

- Version ID and artifact ID
- Sequential version number
- Summary
- Markdown body
- SHA-256 content hash
- Cited decision IDs
- Optional source run ID
- Status
- Creator and created time
- Optional human approver, approval rationale, and approval time

Artifact version statuses:

- `draft`
- `in_review`
- `approved`
- `superseded`

### 9.4 Notifications

A Notification is a durable human-only pointer to a project event. It contains:

- Notification and organization/project IDs
- Recipient principal ID
- Type, title, and body
- Target type and target ID
- Created time and optional read time

The current event types cover question assignments, proposed responses, clarification comments, protected-question reviews, accepted decisions, decision lifecycle changes, assumption expiry, specification review requests/feedback, and specification approvals. Notifications are created in the same application transaction as the originating state change and are scoped again at read/mark-read time.

Each notification also creates a `notification.created` outbox event. The notification is the human read model; the outbox record is the retryable downstream-delivery intent.

### 9.5 Context snapshots

Context retrieval:

- Filters to active decisions and currently approved specification versions.
- Applies category filtering.
- Scores explicit scope matches.
- Scores task-token matches.
- Returns approved items with source URLs and timestamps.
- Persists a context snapshot ID, optional source run ID, and audit event.

### 9.6 Agent runs and durable continuation

An AgentRun contains metadata only:

- Run, organization, project, and agent identity/type
- Client: `codex`, `claude_code`, `cursor`, `copilot`, `custom`, or `unknown`
- Capability: `instructions`, `cli`, `mcp`, `hooks`, or `orchestrated`
- Concise task summary and scope
- Status, start/update/end timestamps, and optimistic version
- Linked context snapshot, assumption, question, and artifact-version IDs
- External links and result links
- Optional completion/failure summary
- Optional preceding run ID for an explicit continuation

Run statuses:

- `running`
- `waiting_for_human`
- `completed`
- `failed`
- `cancelled`

Starting a run returns a random opaque `resumeContextKey`. The key is stored separately from the public run record and is never returned by ordinary get/list operations. It is a locator, not authentication: the caller must still establish identity and project access. It is stored as a value rather than a hash so an identical idempotent start request can replay the original registration response; hardening this locator remains separate from OIDC authentication.

A linked blocking question atomically moves a running run to `waiting_for_human`. Human acceptance does not auto-resume an agent. Resolving the continuation returns accepted decision IDs and remaining blockers. When every blocker is resolved, a later session starts a new run using both `continuesRunId` and the prior locator. The original waiting run remains historical; Bridge does not claim that the exact vendor session restarted.

Run state uses an explicit `expectedVersion`. Terminal states are immutable. A run cannot return to `running` or report `completed` while a linked blocking question remains unresolved. Failed or cancelled runs may retain unresolved blockers because they do not claim successful task completion.

Bridge intentionally does not store raw prompts, raw outputs, full chat history, or hidden reasoning in a run.

### 9.7 Assumptions

An Assumption contains:

- Stable ID and organization/project scope
- Required source run ID for non-human creators; optional run for manual human entry
- Statement, rationale, category, and low risk
- Confidence: `low`, `medium`, or `high`
- Required reversibility and explicit reversal cost
- Repository/component/branch/environment/work-item scope
- Optional source links
- Creator identity/type and timestamps
- Expiry, lifecycle status, and optimistic version
- Optional human resolution identity/rationale/time
- Optional confirmed decision or superseding assumption link

Statuses:

- `active`
- `confirmed`
- `rejected`
- `expired`
- `superseded`

Policy is deliberately narrow:

- Only low-risk and reversible uncertainty is assumption-eligible.
- Security, privacy, authentication, legal, and production-deletion categories are always blocked and require a human question/decision path.
- Default expiry is seven days; the maximum is 30 days from creation.
- An exact-scope premise that duplicates or is a direct textual negation of an active decision is rejected with the decision ID.
- Agents may record but cannot resolve assumptions.
- Only a configured decision owner or project administrator may confirm, reject, manually expire, or supersede one.
- Confirmed assumptions remain visibly distinct from formal accepted decisions.
- Due active assumptions are durably marked expired when read through assumption/context queries and by the maintenance-role worker. The scheduled cycle is idempotent and creates `assumption_expired` notifications for project decision owners and the assumption creator.

Context ranking gives approved decisions/specifications the highest weight, human-confirmed assumptions a lower weight, and active temporary assumptions the lowest authority weight. Rejected, expired, and superseded assumptions are excluded.

### 9.8 Audit events

Both repository implementations record events for:

- Question creation
- Response proposal
- Decision acceptance
- Decision supersession, expiry, and revocation
- Context retrieval
- Specification version publication
- Specification review comment and change request
- Specification version approval
- Run start and status transition
- Continuation resolution
- Assumption recording, resolution, and automatic expiry

## 10. Implemented application policies

- Cross-project and cross-organization access is denied by application policy.
- Run creation is idempotent and limited to agent, CI, or integration principals.
- Assumption recording is idempotent; non-human assumptions require a non-terminal source run.
- Assumptions must be low-risk, reversible, non-protected, and expire within 30 days.
- Exact-scope decision duplication/direct-negation checks prevent approved context from being downgraded or contradicted by assumptions.
- Assumption resolution is human-only, owner/admin-only, rationale-required, and version-checked. Confirmation can link an existing active same-project decision or explicitly create an authoritative decision whose provenance is the confirmed assumption.
- Structured question creation is idempotent.
- Exact normalized, policy-equivalent questions in the same scope reuse an unresolved question or active accepted decision and link it to the submitting run.
- Related question matches use deterministic token overlap and are advisory only; they are never auto-merged.
- Specification publication is idempotent.
- Reusing an idempotency key with different content returns a conflict.
- Agents cannot propose human answers.
- Agents cannot accept decisions.
- Agents cannot approve specification versions.
- Only configured decision owners/project administrators accept decisions.
- Only the decision owner, configured project decision owner, or project administrator can retire an active decision; every transition is version-checked and rationale-required.
- A superseding decision must be active in the same project, category, and exact scope, and retired decisions are excluded from context.
- Only configured specification reviewers/project administrators approve specification versions.
- Only configured specification reviewers/project administrators append formal specification feedback; a requested change blocks approval of that version.
- Only the latest specification version can be approved.
- Approval of a new version supersedes the old approved version.
- A cited decision must belong to the same project.
- Protected questions cannot automatically fall back.
- Context snapshots, assumptions, questions, and specification versions may be linked only by the run principal or a human project administrator and cannot be attached to a terminal run.
- Linking a blocking question moves its run to `waiting_for_human` in the same transaction.
- Run status updates require the current expected version; terminal states cannot transition again.
- An unresolved blocking question prevents both resuming and successfully completing the run.
- Continuation requires project access, a matching opaque locator, and no unresolved blocking question.
- Human acceptance is authoritative but does not implicitly restart a vendor agent session.
- Run creation/provenance/status, assumption creation/resolution/expiry, question creation, response proposal, decision acceptance/lifecycle transition, specification publication/approval, context snapshots, idempotency records, and their audit events are atomic.
- The in-memory transaction implementation rolls back failed workflows and serializes concurrent transactions for behavioral parity.
- The PostgreSQL implementation uses serializable transactions and locks run, question, and artifact roots during concurrency-sensitive commands.
- A concurrent loser for a newly claimed idempotency key rolls back instead of leaving an unreferenced aggregate.

## 11. Implemented REST API

Health:

- `GET /health`

Projects:

- `POST /v1/projects`
- `GET /v1/projects`
- `GET /v1/projects/:projectId`

Reviewer context:

- `GET /v1/principals` (same-organization fixed human summaries for the local reviewer switcher)

Context and decisions:

- `GET /v1/projects/:projectId/context`
- `GET /v1/projects/:projectId/decisions` (active by default; supports explicit history/status plus category, owner, creation-time, and exact-scope filters)
- `POST /v1/decisions/:decisionId/lifecycle`
- `POST /v1/decisions/:decisionId/supersede`
- `POST /v1/decisions/:decisionId/expire`
- `POST /v1/decisions/:decisionId/revoke`

Agent runs:

- `POST /v1/projects/:projectId/runs`
- `GET /v1/projects/:projectId/runs`
- `GET /v1/runs/:runId`
- `PATCH /v1/runs/:runId`
- `POST /v1/runs/:runId/continuation`

Assumptions:

- `POST /v1/projects/:projectId/assumptions`
- `GET /v1/projects/:projectId/assumptions`
- `GET /v1/assumptions/:assumptionId`
- `POST /v1/assumptions/:assumptionId/resolve`

Questions:

- `POST /v1/projects/:projectId/questions`
- `POST /v1/projects/:projectId/questions/matches`
- `GET /v1/projects/:projectId/questions`
- `GET /v1/projects/:projectId/inbox` (questions requiring the selected human's authority)
- `GET /v1/questions/:questionId`
- `POST /v1/questions/:questionId/responses`
- `POST /v1/questions/:questionId/comments` (threaded clarification comment)
- `PATCH /v1/questions/:questionId/responses/:responseId` (original-human correction with revision history)
- `PATCH /v1/questions/:questionId/comments/:commentId` (original-human correction with revision history)
- `POST /v1/questions/:questionId/clarification` (owner clarification request)
- `POST /v1/questions/:questionId/reopen` (owner/admin reopen of cancelled or expired discussion)
- `POST /v1/questions/:questionId/reviews` (separate protected security review)
- `POST /v1/questions/:questionId/accept`

Notifications (human-only):

- `GET /v1/notifications?projectId=&unreadOnly=`
- `POST /v1/notifications/:notificationId/read`
- `POST /v1/notifications/read-all`

Delivery operations (human project administrators only):

- `GET /v1/admin/projects/:projectId/outbox?status=&type=&limit=`
- `POST /v1/admin/outbox/:eventId/replay` with the last observed `expectedAttempts`

Audit operations:

- `GET /v1/admin/projects/:projectId/audit` (human project administrators; exact metadata filters and bounded offset pagination)
- `POST /v1/admin/projects/:projectId/audit/export` (bounded JSON/CSV; export is audited)
- `GET /v1/admin/organization/audit` (human organization administrators)
- `POST /v1/admin/organization/audit/export` (bounded JSON/CSV; export is audited)

Specifications:

- `POST /v1/projects/:projectId/artifacts`
- `GET /v1/projects/:projectId/artifacts`
- `GET /v1/artifacts/:artifactId`
- `GET /v1/artifacts/:artifactId/diff?fromVersionId=&toVersionId=`
- `POST /v1/artifact-versions/:versionId/reviews`
- `POST /v1/artifact-versions/:versionId/approve`

Development mode resolves fixed local principals using `x-bridge-principal-id`. OIDC mode ignores that header, accepts an encrypted browser session or bearer access token, and resolves organization/project authority from durable active memberships.

## 12. Implemented MCP tools

Run tools:

- `bridge_start_run`
- `bridge_report_run`
- `bridge_get_run`
- `bridge_get_continuation`

Assumption tools:

- `bridge_record_assumption`
- `bridge_get_assumption`
- `bridge_list_assumptions`

Decision and question tools:

- `bridge_get_context`
- `bridge_search_decisions`
- `bridge_find_question_matches`
- `bridge_create_question`
- `bridge_get_question`
- `bridge_list_pending`
- `bridge_list_inbox` (filtered reviewer inbox for the current principal)

Specification tools:

- `bridge_publish_artifact`
- `bridge_get_artifact`
- `bridge_list_artifacts`

Ordinary agent MCP tools intentionally do not include assumption resolution, decision acceptance, or specification approval.

MCP server local endpoint:

```text
http://127.0.0.1:4100/mcp
```

The standalone MCP process requires `DATABASE_URL` and must use the same migrated PostgreSQL database as the API. It refuses to start without that configuration so MCP writes cannot disappear into process-local state that the web UI cannot read. MCP remains optional; the API, CLI, repository snapshots, and web workflow still run without it.

## 13. Implemented CLI

Commands:

```text
bridge init [project-id] [--name <project-name>] [--client <client>] [--mcp-url <url>] [--dry-run]
bridge install [--client <client>] [--dry-run]
bridge doctor
bridge inbox [project-id] [--status <status>] [--risk <risk>] [--category <category>] [--role <role>]
bridge run start [project-id] --task <description>
bridge run get <run-id>
bridge run list [project-id]
bridge run continue <run-id> --resume-key <key>
bridge run report <run-id> --status <status> --version <number>
bridge context [project-id] --task <description> [--run-id <id>]
bridge ask [project-id] --file <question.json|->
bridge question matches [project-id] --file <question.json|->
bridge question get <question-id>
bridge wait <question-id>
bridge pending [project-id]
bridge assumption add [project-id] --file <assumption.json|->
bridge assumption get <assumption-id>
bridge assumption list [project-id]
bridge assumption resolve <assumption-id> --status <status> --version <number> --rationale <text>
bridge sync [project-id] [--run-id <id>]
bridge spec publish [project-id] --file <spec.md> --title <title> --type <type> [--run-id <id>]
bridge spec get <artifact-id>
bridge spec pull [project-id]
```

`bridge init` creates:

```text
.bridge/project.yaml
.bridge/agent-instructions.md
.bridge/question.example.json
.bridge/assumption.example.json
```

It also safely creates or updates the selected client's native repository instruction file using a Bridge-owned marked block:

- Codex: `AGENTS.md`
- Claude Code: `CLAUDE.md`
- Cursor: `.cursor/rules/bridge.mdc`
- Copilot: `.github/copilot-instructions.md`

Unrelated existing content is preserved. `bridge init --name` uses the fixed local project-admin principal to register the project; this is a prototype seam, not organization onboarding or authentication. The CLI can be packaged locally with `pnpm cli:pack`, producing `dist/bridge-cli-0.1.0.tgz`.

The generated instructions tell agents to start a run, link context/questions/specifications through `runId`, stop on blocking work, resolve the durable continuation, and report a terminal outcome. The returned resume-context key must remain in the agent/operator session or an approved secret-capable store and must not be committed into `.bridge/` files. `bridge init --dry-run` previews registration and every Bridge-owned/native adapter file change without mutating API or repository state. `--mcp-url <url>` is optional and records an approved absolute HTTP(S) endpoint in `.bridge/project.yaml`; for Codex and Claude Code it also plans a project-scoped vendor MCP configuration with no credentials. `BRIDGE_MCP_URL` can override the endpoint for diagnostics only. `bridge doctor` checks API reachability, project mapping, generated instructions, native adapter markers, and performs an MCP JSON-RPC `initialize` probe only when an endpoint is configured. MCP absence remains a valid CLI/instruction-only mode; hooks remain unconfigured.
`bridge install --client <client>` activates or switches the native adapter for an existing `.bridge/project.yaml` without registering another project. It safely preserves unrelated content, updates only the managed Bridge block, and supports `--dry-run` for a no-mutation preview.

`bridge sync` creates approved repository context:

```text
.bridge/context.md
.bridge/context.json
.bridge/decisions.json
.bridge/assumptions.json
.bridge/questions.json
.bridge/specifications.json
.bridge/sync-metadata.json
```

`bridge spec pull` creates:

```text
.bridge/specs/*.md
.bridge/specs/manifest.json
```

The specification manifest contains artifact ID, version ID, version number, approval identity/time, content SHA-256, and local file path.

Only active/confirmed assumptions and approved specifications are synchronized or pulled as current agent context. Active assumptions retain an explicit temporary authority label and expiry. The question snapshot contains only unresolved questions so offline agents can check current interruptions before creating another one.

Stable CLI exit codes:

| Code | Meaning |
|---:|---|
| 0 | Success |
| 2 | Invalid input |
| 3 | Missing/invalid repository configuration |
| 4 | Connection/server failure |
| 10 | Answer still pending after bounded wait |
| 11 | Forbidden/policy denial |
| 12 | Record not found |
| 13 | Conflict |
| 20 | Unexpected internal error |

CLI errors are machine-readable JSON.

## 14. Implemented web UI

The local web application provides:

- Registered-project loading and project selection.
- Project-scoped question and specification refresh.
- Personalized question inbox plus the shared project question list.
- Question detail with context and impact.
- Options and trade-offs.
- Clearly labeled agent recommendation.
- Role-aware assignment labels for questions (for example, QA Lead or Business Analyst).
- Shared team discussion: proposed answers, rationale, selected option, author, and timestamp.
- Threaded clarification comments with parent links, author, timestamp, and optimistic version checks.
- Typed related-work links, human mention displays, original-author edit controls, and expandable response/comment revision history.
- Server-authorized clarification-request and cancelled/expired discussion-reopen controls; accepted decisions remain authoritative through their separate lifecycle.
- A response form for human contributors before final owner acceptance.
- Required human acceptance rationale.
- Protected-question security review history and review form.
- Accepted-decision state.
- Accepted-decision list/detail with rationale, authority, review date, lifecycle provenance, source-question navigation, and owner-authorized supersede/expire/revoke controls.
- Potentially affected specification, assumption, run, and work-item counts after a decision lifecycle change.
- Assumption list/detail with status, risk, confidence, expiry, reversal cost, resolution, and source-run navigation.
- Agent-run list/detail with provenance, lifecycle state, linked-record counts, outcome, and source-question navigation.
- Specifications navigation and pending count.
- Specification detail, immutable Markdown body, reviewer metadata, and version history.
- Authorized comparison of any two immutable versions with safe added/removed line rendering, provenance, and bounded large-document behavior.
- Append-only formal review comments and request-changes controls for authorized specification reviewers.
- A visible changes-requested state that directs the author to publish a new immutable version.
- Required human approval rationale.
- Approved specification state.
- Project-scoped notification feed with unread count, individual mark-read, and mark-all-read controls.

The UI defaults to the fixed human principal `usr_architect` and exposes a local **Reviewing as** selector for the same-organization human fixtures. Decision lifecycle changes and assumption resolution now use the same application authority path from the web UI. Agent-run lifecycle mutations intentionally remain API/CLI operations; the web runs view is read-only.

The founder has additional UI feedback that will be addressed later.

## 15. Current validation state

Full validation command:

```bash
pnpm check
```

Current validation result after interactive CLI authentication:

- Type-check: passed across all twelve workspace packages.
- Tests: 177 tests passed across the application, API, CLI, MCP, worker, auth, database, domain, observability, and test-support packages; the three-test opt-in live PostgreSQL integration file was skipped because `BRIDGE_TEST_DATABASE_URL` is absent.
- Durable authentication coverage: trusted human web callbacks and cookie-backed logout append organization audit events, while non-human web principals are rejected before a browser session is established.
- Production builds: passed across all twelve workspace build tasks.
- Next.js production build and static prerender: passed.
- PostgreSQL schema, repository adapter, and domain mappers compile.
- Migration structure tests verify the reviewed deferred, tenant-consistency, single-approved-version, run-lifecycle, assumption-policy/lifecycle/scope, decision-lifecycle/replacement-scope/version, artifact-review-array, legacy/correlation backfills, audit-subject (including outbox replay), role-owner, question-review/comment arrays, notification tenancy/types, outbox state/attempts, correlation format/indexes, and email-delivery scope/result/hash constraints.
- In-memory failure-injection tests verify rollback for run-linked assumption/question creation, decision acceptance, specification publication, and specification approval.
- Packaged in-memory API startup and `GET /health` smoke test passed.
- Packaged run start -> linked context snapshot -> version-checked completion smoke test passed.
- Packaged run start -> assumption record -> temporary context -> human confirmation -> confirmed context smoke test passed.
- Packaged question create -> exact match -> existing-question reuse smoke test passed.
- REST question workflow test: passed.
- REST run/start/block/continuation/accept/ready workflow test: passed.
- REST assumption create/agent-denial/human-confirm/context workflow test: passed.
- REST question matching and exact-reuse workflow test: passed.
- MCP decision carry-forward and durable continuation test: passed.
- MCP assumption record/get/context workflow test: passed.
- MCP exact question-match lookup test: passed.
- MCP filtered reviewer-inbox routing test: passed; protected review state is visible without exposing human approval commands to ordinary agent principals.
- REST/application threaded clarification test: passed; human comments are version-checked, parent-linked, and agent-authorship is rejected.
- REST/application question-collaboration test: passed; human mentions are project-member validated, response/comment edits preserve revision history, related links round-trip, clarification/reopen authority is enforced, and collaboration audits/notifications are emitted.
- REST/application notification test: passed; assignment and clarification events create durable human notifications, agents are denied the feed, and scoped individual/all read state is enforced.
- Browser verification: a human posted a root clarification, replied to it, and saw the question move to `in_discussion` with both thread entries visible.
- CLI repository initialization/question/wait/sync and run lifecycle tests: passed.
- CLI assumption add/get/resolve/sync workflow test: passed.
- CLI question-match lookup and unresolved-question repository export test: passed.
- Specification publish/human approve/context test: passed.
- Specification version supersession test: passed.
- CLI specification publish/pull test: passed.
- Packaged live smoke test passed for specification publish -> human approve -> approved Markdown pull.
- Fresh-project application/API registration, idempotent replay, access-policy, and project-list tests: passed.
- Packaged CLI initialization from a local tarball, safe `AGENTS.md` preservation, and idempotent managed-block regeneration: passed.
- Fresh Hospital Management System acceptance simulation passed: project registration -> run -> protected question -> PRD/ADR/API contract/test plan -> project-scoped API reads.
- Real independent Codex CLI conformance passed from a fresh repository using only the ordinary prompt `Build a Hospital Management System.` and no MCP. The resulting run linked a context snapshot, one protected role-routed question, a reversible assumption, and PRD/ADR/API-contract/test-plan versions, then entered `waiting_for_human`.
- The real-agent run exposed and drove fixes for two adapter defects: packaged execution through pnpm symlinks now resolves the real entrypoint, and generated instructions document the direct repository binary fallback when unrelated dependency install policy blocks `pnpm exec`.
- `bridge conformance --task [--run-id]` now emits named observable checks and exit code `10` when a task-linked run, context, routed question, specification set, provenance links, or human boundary is incomplete. It intentionally cannot observe vendor-private clarification UI.
- CLI success output now defaults to stable JSON but supports `--output human` across commands; errors remain machine-readable JSON with the existing stable exit codes in either mode.
- In-app browser verification passed for project selection, the Hospital question, and all four Hospital specifications.
- REST response-proposal regression passed: a contributor can add an answer before the configured owner accepts the decision.
- In-app browser verification passed for the team discussion card, response author/rationale, and response form.
- Role-routing regression passed: a QA Lead role can accept a QA-owned question while an ordinary contributor is denied.
- Prototype reviewer-switcher browser verification passed: the UI lists same-organization fixed human principals, switches from Sarvesh Patil to QA Lead, reloads project-scoped data, and updates the visible role/identity summary.
- Personalized-inbox browser verification passed: Architect sees the seeded question in **My Inbox**, QA Lead sees an empty routed inbox, and the same question remains visible in shared **Questions**.
- Inbox-filter browser verification passed: filtering by **In discussion** produces a routed empty state, clearing filters restores the inbox, and shared **Questions** remains unchanged.
- Protected-review browser verification passed: a security reviewer recorded an approval, the review history rendered, and the routed QA owner retained the final acceptance action.
- In-app notification browser verification passed: the human reviewer saw the seeded assignment, opened it from the Notifications view, and the unread state changed to Read.
- Transactional-outbox application, mapper/migration, and worker-cycle tests passed: each notification creates a pending delivery intent, claims acquire a lease and increment attempts, successful handlers complete events, and repeated failures become dead letters.
- Outbox-operations application/API tests passed: only project administrators can inspect delivery state, metrics report status/failure/ready/lease/age data, stale replay requests conflict, cross-tenant IDs remain hidden, successful replay retains the event ID, and the reset plus audit record commit atomically.
- Project support regressions passed: operator-only support reads now include active assumptions due within seven days and runs waiting for human input with remaining blocker counts, while assumption statements and run task summaries remain excluded from the support payload.
- Provider-neutral email tests passed: all five essential template families render bounded plain text, subjects resist header injection, immediate sends use stable idempotency keys, duplicate completed delivery is skipped, ordinary muted/digest choices are recorded, protected-review mail bypasses muting, addresses are never persisted, and provider errors are redacted before retry/dead-letter storage.
- CLI bootstrap diagnostics passed: dry-run registration leaves API/files untouched, while doctor verifies the mapped project and generated client instructions.
- Optional MCP CLI diagnostics passed: `bridge init --mcp-url` records the endpoint, `bridge doctor` verifies an MCP `initialize` response when available, and an unavailable endpoint fails transparently without changing the CLI-only fallback.
- Adapter installation diagnostics passed: `bridge install` switches the selected native instruction adapter without project registration, preserves unrelated content, and leaves the repository untouched during `--dry-run`.
- Release-hardening browser verification passed for Decisions, Assumptions, and Agent Runs navigation, empty/detail states, run query deep links, question acceptance, and immediate visibility of the newly accepted Decision.
- GitHub Actions CI run `31265758794` passed on initial commit `efe10f3` in 1 minute 2 seconds, including the isolated PostgreSQL integration path.
- All TypeScript package builds and the Next.js production build passed after the role-aware, reviewer-switcher, personalized-inbox, inbox-filter, protected-review, transactional-outbox, and CLI-diagnostics slices.

The temporary smoke-test directory and server processes were cleaned up afterward.

## 16. How to run the prototype

Install and validate:

```bash
pnpm install
pnpm check
```

Start the API and web UI in separate terminals:

```bash
pnpm dev:api
pnpm dev:web
```

Open:

```text
http://127.0.0.1:3000
```

Optional durable PostgreSQL mode:

```bash
export DATABASE_URL=postgresql://bridge:bridge@127.0.0.1:5432/bridge
pnpm db:migrate
pnpm dev:api
```

API startup does not run migrations. Without `DATABASE_URL`, the seeded in-memory demo remains the default.

Optional MCP server:

```bash
export DATABASE_URL=postgresql://bridge:bridge@127.0.0.1:5432/bridge
pnpm db:migrate
# Start the API with this same DATABASE_URL, then in another terminal:
pnpm dev:mcp
```

Fresh-project CLI packaging and initialization:

```bash
pnpm cli:pack
# Install dist/bridge-cli-0.1.0.tgz globally or as a tool in the new repository.
bridge init --name "Hospital Management System" \
  --client codex \
  --api-url http://127.0.0.1:4000 \
  --repository hospital-management-system
```

See `README.md` for run, continuation, assumption, question, context, synchronization, and specification command examples.

## 17. Current limitations

### 17.1 Persistence

Durable persistence is implemented but opt-in. Without `DATABASE_URL`, the API uses `InMemoryBridgeRepository` and state is lost when it restarts. With `DATABASE_URL`, it uses `PostgresBridgeRepository` after an operator runs the explicit migration.

No local PostgreSQL, Docker, or Podman runtime exists in the current workspace, so the live reconnect integration test has not run here. It runs only when `BRIDGE_TEST_DATABASE_URL` points to an isolated PostgreSQL database.

### 17.2 Transactions and concurrency

Application workflows now use a repository transaction boundary. The in-memory implementation serializes transactions and restores snapshots on failure. The PostgreSQL implementation uses serializable transactions and row locks for run/assumption/question/artifact aggregate roots.

Run status and assumption resolution changes have explicit `expectedVersion` inputs. Question acceptance and specification approval still rely on PostgreSQL isolation, row locks, unique constraints, and state rechecks rather than a client-provided version.

### 17.3 Security

- OIDC web/API authentication and encrypted bounded sessions, interactive CLI PKCE, and optional standalone MCP bearer validation are implemented; MCP-side authorization-server/token issuance is not.
- Durable organization/project membership, protected first-admin bootstrap, versioned member administration, project-role assignment, and organization audit events are implemented.
- Endpoint-specific OAuth scopes, failed/unknown authentication attribution, provider-side refresh/revocation administration, and deployment-provider validation remain incomplete; trusted human web sign-in/logout audit events are durable, while RLS is implemented for the core tenant data plane but still needs live deployment evidence.
- Fixed local principals remain development-only.
- Application organization/project checks are active for both identity modes, but this is not yet complete production tenant security.

### 17.4 Not yet implemented

- Live email/team provider installations, scheduled worker deployment, digest batching, jitter, and time-series delivery telemetry/alerts.
- Automatic vendor-session resume adapters; current continuation is explicit/manual.
- Agent-run lifecycle mutation controls in the web UI; the corresponding run list/detail view remains read-only in the current prototype.
- Hosted worker role provisioning and live PostgreSQL verification for scheduled assumption expiry; the application cycle and bounded worker schedule are implemented locally.
- Hashed or encrypted-at-rest continuation locators; the current prototype stores them as values for exact idempotent replay.
- A live recipient directory/preferences store, SES sender, digest scheduler, and production Slack workspace/runtime; provider-neutral email/Slack contracts and preference outcomes are implemented.
- GitHub integration.
- Live Slack/SES workspace/provider validation and deployment wiring.
- PostgreSQL full-text/trigram question search; the current pilot matcher uses deterministic normalized token overlap over project questions.
- Semantic duplicate detection; related matches are suggestions only and exact policy-equivalent matches are the only automatic reuse path.
- Configurable specification reviewer/team routing or multi-reviewer quorum; append-only comments and request-changes are implemented.
- Binary attachments or S3 storage.
- Execution of the first tagged GitHub CLI release and any public/organization-registry publication; the checksummed release workflow, global tarball install path, and local package smoke test are implemented.
- Claude Code and later-client independent conformance runs; Codex-first observable conformance now passes.
- A vendor hook or other enforceable signal for private/native clarification prompts; the current guard can verify Bridge outcomes but cannot observe UI that a vendor does not expose.
- Automated browser regression tests; the current Hospital acceptance view was verified interactively in the in-app browser.

## 18. Git and workspace state

The repository began empty except for `.git`. The reviewed source is now tracked from the canonical local clone at `/Users/patilsarvesh/Repos/Bridge`, whose `origin` is `https://github.com/PatilSarvesh/Bridge.git` on `main`.

Generated build outputs, dependencies, Turbo cache, Next cache, and the local pnpm store are ignored.

Always inspect the current Git status and remote state rather than assuming a later commit or push has completed. Preserve unrelated user work if the worktree changes in a future session.

## 19. Visual prototype

An earlier interactive UI concept exists outside the repository at:

```text
/Users/patilsarvesh/.codex/visualizations/2026/08/07/019fdc64-0e41-7a71-acae-282bd9b7180c/bridge-pilot-ui.html
```

The implemented Next.js UI follows the same calm enterprise direction but has evolved to include specification review.

## 20. Implemented PostgreSQL persistence slice

Implemented:

1. `packages/database` with pinned `drizzle-orm` 0.45.2, `drizzle-kit` 0.31.10, and Postgres.js 3.4.9.
2. Typed schema for projects, agent runs, continuation locators, assumptions, questions, question responses, decisions, artifacts, immutable versions, context snapshots, audit events, and idempotency records.
3. Generated Drizzle migrations augmented with reviewed SQL constraints for tenant consistency, aggregate references, JSON shapes, hashes, approval metadata, positive versions, one approved version per artifact, run lifecycle, assumption policy/lifecycle, legacy question-run backfill, notification tenancy, and outbox status/type/attempt handling.
4. `PostgresBridgeRepository` behind the existing application interface.
5. A generic repository transaction boundary used by every current multi-record workflow.
6. Row locks for run, assumption, question, and artifact roots during transactional mutations.
7. Transaction-safe idempotency collision behavior.
8. API selection: PostgreSQL when `DATABASE_URL` exists, seeded in-memory storage otherwise.
9. Explicit `db:generate` and `db:migrate` scripts; API startup never migrates automatically.
10. Pure mapper/migration tests and an opt-in live reconnect integration test.
11. An additive project-registration audit migration that permits `project` audit subjects without changing existing project storage.
12. This original persistence slice introduced no authentication; that historical boundary was later superseded by the explicitly reopened identity slice in section 20.34.
13. Notifications enqueue a typed transactional outbox event in the same repository transaction; the worker exposes a claim/lease/retry/dead-letter cycle for downstream delivery handlers.

Environment facts remain:

- No `psql`, local `postgres`, Docker, or Podman executable is available.
- Machine architecture is Apple Silicon (`arm64`).
- Therefore live PostgreSQL migration/reconnect behavior is not yet verified in this workspace; do not claim that gate has passed.

### 20.1 Remaining persistence follow-up

1. Run `BRIDGE_TEST_DATABASE_URL=<isolated-url> pnpm --filter @bridge/database test` against real PostgreSQL.
2. Add row-level security only when production identity/tenant context is explicitly brought into scope; do not infer authorization from the current fixed header.
3. Wire the provider-neutral email and Slack handlers to approved production senders/directories after live PostgreSQL validation; add digest scheduling, jitter, and telemetry export around the implemented receipts/operator controls.
4. Extend explicit expected-version request fields beyond runs and assumptions if pilots demonstrate a need beyond current row locking and state checks.

### 20.2 Implemented agent-run and continuation slice

Implemented:

1. Shared Zod contracts and domain types for run clients, capabilities, statuses, start/report requests, and continuation queries.
2. Metadata-only `AgentRun` aggregates with optimistic versions and links to context snapshots, assumptions, questions, and specification versions.
3. Idempotent run start that replays the same run and locator for the same principal/key/request.
4. Random opaque continuation locators stored outside ordinary run records.
5. Atomic provenance linking from context retrieval, assumption recording, question creation, and specification publication.
6. Automatic `running` to `waiting_for_human` transition when a linked blocking question is created.
7. Manual continuation resolution that returns accepted decision IDs, unresolved blockers, and an explicit next-step instruction without auto-restarting a vendor session.
8. Explicit linked child-run creation after every blocking question is accepted.
9. Version-checked run state transitions and policy prevention of resume/completion while blockers remain.
10. Five REST routes, four MCP tools, and five CLI commands for the run lifecycle.
11. PostgreSQL run/locator tables, scope/lifecycle constraints, legacy question-run backfill, and audit support.
12. End-to-end application, REST, MCP, CLI, mapper/migration, and conditional live-database coverage.

Deliberate boundaries:

- No raw prompts, model outputs, transcripts, repository code, or hidden reasoning are stored.
- The locator does not grant access and is not a replacement for future authentication.
- Human acceptance does not auto-resume work; adapters for vendor-specific automatic continuation remain future work.
- The web UI does not yet expose run views.
- Existing persisted demo artifacts retain their historical idempotency request shape during upgrade; legacy question run IDs are preserved through migration when possible.

### 20.3 Implemented assumption lifecycle slice

Implemented:

1. Shared contracts and domain types for confidence, status, record, and human resolution operations.
2. Idempotent low-risk/reversible assumption creation with seven-day default and 30-day maximum expiry.
3. Mandatory source-run provenance for non-human creators and atomic run linkage.
4. Protected-category, risk, reversibility, expiry, project, and non-terminal-run enforcement.
5. Deterministic exact-scope checks that reject premises matching or directly negating active decisions.
6. Version-checked human-owner/admin confirmation, rejection, manual expiry, and supersession with required rationale.
7. Optional confirmation links to an active same-project decision and supersession links to a current same-project assumption.
8. Lazy durable expiry on authoritative assumption/context reads plus a pure worker expiry-selection policy.
9. Context ranking and provenance with `approved`, `confirmed`, and `assumption` authority labels.
10. Current-only repository export in `.bridge/assumptions.json`; rejected, expired, and superseded records are excluded.
11. Four REST routes, three MCP tools, and four CLI assumption commands.
12. PostgreSQL table/enums/idempotency kind, run-link column, tenant/run/decision/supersession foreign keys, and database policy/lifecycle constraints.
13. Application, rollback, REST, MCP, CLI, mapper/migration, worker-policy, and conditional live-database coverage.

Deliberate boundaries:

- Confirmation is a human-reviewed assumption state, not silently fabricated as a formal Decision. It may link an existing active Decision.
- Semantic contradiction detection is not claimed; the current check recognizes exact normalized duplicates and direct textual negations only.
- Scheduled expiry processing and proactive notification delivery await a scheduled worker runtime and external adapters; the durable outbox and claim/retry cycle now exist. Reads still prevent overdue assumptions from entering agent context.
- Artifact versions do not yet carry explicit cited-assumption IDs.
- Assumption web screens are deferred with the founder's broader UI feedback.

### 20.4 Implemented duplicate-question prevention slice

Implemented:

1. A read-only match query over unresolved questions and accepted questions whose decisions remain active.
2. Unicode-normalized exact comparison for title, context, category, type, and scope.
3. Deterministic related ranking from title/context token overlap plus category, type, and exact-scope signals.
4. Conservative 40-point related-candidate threshold and bounded result count.
5. Automatic reuse only when the normalized question and scope match and risk, reversibility, and blocking policy are also equal.
6. Exact unresolved reuse links the existing question to the new run and moves that run to `waiting_for_human` when appropriate.
7. Exact accepted reuse links the existing active decision path to the new run without creating another interruption.
8. Explicit `created`, `idempotent_replay`, `reused_pending`, and `reused_accepted` submission dispositions.
9. Audited `question.reused` events and atomic idempotency/run linkage inside the existing repository transaction.
10. REST `questions/matches`, MCP `bridge_find_question_matches`, and CLI `question matches` adapters over the same service behavior.
11. `.bridge/questions.json` export of unresolved questions plus a pending count in sync metadata for agents without MCP or outbound access.
12. Application, REST, MCP, and CLI regression coverage, including cross-run pending and accepted reuse.

Deliberate boundaries:

- Related results are hints; Bridge never merges them automatically.
- This is deterministic lexical matching, not a claim of semantic equivalence.
- The pilot implementation scans project questions in the repository service. PostgreSQL full-text/trigram indexes and scale evaluation remain future work.
- An exact accepted match is reused only while its Decision is active. Expired, revoked, or superseded decisions do not suppress a new question.
- Intentionally reopening an unchanged active decision should use a future decision-review/supersession workflow rather than fabricating a duplicate question.
- That duplicate-prevention slice required no UI change; the later fresh-project slice adds only the functional project selector while broader founder UI feedback remains deferred.

### 20.5 Implemented fresh-project bootstrap acceptance slice

Implemented:

1. Idempotent fixed-principal project registration plus project list/detail application and REST operations.
2. Same-organization all-project access for the fixed prototype principals, while cross-organization access remains denied.
3. `bridge init --name <name> --client <client>` registration without requiring a pre-seeded project ID.
4. Safe managed-block creation/update for Codex `AGENTS.md`, Claude Code `CLAUDE.md`, Cursor rules, and Copilot instructions while preserving unrelated content.
5. Generated instructions that require run/context preflight, shared-authority question routing, blocking handoff, and greenfield PRD/ADR/API contract/test-plan publication.
6. A locally installable `bridge` CLI tarball built with `pnpm cli:pack`.
7. Dynamic project loading and selection in the web UI, with project-scoped question and specification views.
8. Application, REST, CLI, production-build, packaged-process, and browser acceptance evidence.
9. A fresh Hospital Management System simulation with one protected privacy question and four in-review specifications visible under the distinct registered project.
10. An observable `bridge conformance` command covering task/run matching, context retrieval, complete question routing, run linkage, all four greenfield specification types, specification provenance, and the human boundary.
11. A real independent Codex CLI run from a separately initialized repository. The ordinary Hospital Management System prompt first failed the new guard because no question had been routed; the agent corrected the omission, submitted a protected question to privacy/security/hospital-operations roles, and the final guard passed with the run in `waiting_for_human`.
12. Packaged CLI entrypoint resolution through pnpm's symlinked binary, with a regression test and a direct `./node_modules/.bin/bridge` fallback for environments whose package-manager policy blocks execution while application dependencies are changing.

Deliberate boundaries:

- Project registration uses the existing fixed development principal; it is not organization onboarding or authentication.
- MCP is not required for this path.
- Repository instructions are the Codex-first activation mechanism. Bridge does not claim hard interception of unsupported vendor-native clarification prompts.
- The packaged simulation proves Bridge mechanics and UI visibility, while the independent Codex run proves observable instruction adherence for one Codex CLI/version/environment. Claude Code and other vendor clients still require their own runs.
- Observable conformance cannot prove that no unexposed vendor-native clarification UI was used; Bridge still does not claim universal interception.
- Broader UI design feedback remains deferred; only the functional project selector needed by acceptance was added.

### 20.6 Implemented shared question discussion slice

Implemented:

1. The project question payload now exposes immutable proposed responses with author, answer, rationale, selected option, and timestamp.
2. The web question detail renders all responses in one discussion section before final acceptance.
3. Human contributors can submit a free-form answer or associate it with one of the agent's original options.
4. The configured decision owner still performs the authoritative acceptance and creates the Decision; adding a response never grants approval authority.
5. The API regression proves a contributor response changes the question to `in_discussion`, remains visible to the owner, and can then be accepted.
6. Browser verification confirms the discussion card and response form render against the running API.

Deliberate boundaries:

- The current prototype UI uses the fixed `usr_architect` browser principal; the REST policy already distinguishes human contributors and decision owners.
- The initial slice intentionally used append-only responses and comments; governed corrections and mentions now live in section 20.59. Deletion and notification preferences remain future work.
- Agent principals cannot submit human responses; agent recommendations remain separate from human discussion and acceptance.

### 20.7 Implemented role-aware question routing slice

Implemented:

1. Question creation accepts normalized `intendedOwnerRoles` such as `QA Lead`, `Business Analyst`, `Architect`, or `Security Reviewer`.
2. Questions persist canonical `ownerRoles` alongside explicit owner IDs; role-only questions do not silently fall back to the project default owner.
3. Human acceptance policy allows a principal whose configured role matches an assigned question role, while preserving project-admin override and protected-category security review checks.
4. REST, MCP, CLI, and web question representations expose the resolved owner roles.
5. PostgreSQL migration `0004_role_aware_questions.sql` adds the durable `owner_roles` JSON array and shape constraint with a backward-compatible empty default.
6. Fixed prototype fixtures include QA Lead and Business Analyst principals for policy testing; this does not add authentication or onboarding.
7. API regression coverage proves QA Lead acceptance and contributor denial for a role-owned question.

Deliberate boundaries:

- Role names are a lightweight policy seam, not a production directory or organization role-management system.
- The prototype does not yet provide a UI for configuring project role memberships; role configuration remains fixed in development fixtures.
- Notification preferences remain future work; configurable route explanations and question reassignment were completed in section 20.56, and due-aware filtering was completed in section 20.57.

### 20.8 Implemented prototype reviewer switcher slice

Implemented:

1. `GET /v1/principals` exposes same-organization human principal summaries (ID, display name, and roles) from the fixed development fixture.
2. The web UI adds a **Reviewing as** selector for Sarvesh Patil, QA Lead, Business Analyst, and other fixed human principals returned by the API.
3. Project, question, specification, response, acceptance, and approval requests use the selected local principal header, so role policy can be exercised without pretending to provide authentication.
4. The UI updates the identity footer and role summary after switching reviewers; browser verification covered the default Architect view and a QA Lead switch.

Deliberate boundaries:

- This is a local testing/reviewer-context switcher, not authentication, session management, organization onboarding, or a production directory.
- The API only returns human principals in the current principal's organization; fixed fixture membership and permissions remain development-only.
- Saved/URL-persisted filters and administrator-managed role membership remain future work; OIDC identity propagation is now implemented separately.

### 20.9 Implemented personalized reviewer inbox slice

Implemented:

1. `GET /v1/projects/:projectId/inbox` returns open and in-discussion questions routed to the selected human by direct owner ID, assigned role, project-admin fallback, or protected-review role.
2. Inbox items include routing reasons and a `canAccept` flag, so the UI can distinguish actionable authority from shared review-only visibility.
3. Inbox ordering prioritizes protected risk, then other risk levels, blocking questions, active discussion, and newest creation time.
4. The web UI separates **My Inbox** from the shared **Questions** view; changing the reviewer updates the personalized count and list without hiding shared project questions.
5. Application/API regressions cover direct, role, admin, protected-review, contributor-denial, and shared-list behavior.

Deliberate boundaries:

- Filters by state, category, risk, and assigned role were implemented in this slice; optional question due dates and due-state filtering were completed later in section 20.57.
- Protected review is represented as a routing reason, but the prototype still has no separate multi-person review/approval command.
- Notification preferences remain future work; real OIDC identity propagation and explainable routing/reassignment were completed in later slices.

### 20.10 Implemented inbox filter slice

Implemented:

1. The inbox query contract validates `status`, `risk`, `category`, and assigned `role` filters at the API boundary.
2. The application applies filters after project/authority routing, so a contributor cannot use filter parameters to discover questions outside their authorized inbox.
3. The web UI exposes State, Risk, Category, and Role selectors plus a clear-filters action; the shared Questions view is deliberately not filtered by these controls.
4. API regressions cover valid role/category combinations and invalid risk rejection; browser verification covers empty filtered state and restoration after clearing.

Deliberate boundaries:

- Due dates and URL-persisted filter state were completed later in section 20.57; server-stored personal views and one cross-project aggregate remain outside the controlled MVP slice.
- Notification preferences and separate multi-reviewer actions remain future work; real identity propagation and question reassignment were completed in later slices.

### 20.11 Implemented protected-question review slice

Implemented:

1. Protected questions now carry append-only `QuestionReview` records with reviewer identity, security-reviewer role, outcome, rationale, timestamp, and question version.
2. `POST /v1/questions/:questionId/reviews` requires a human security reviewer, an expected question version, and an explicit approved/rejected outcome.
3. A separate approved security review allows the routed owner to accept a protected question; a rejected or missing review keeps a non-security owner blocked.
4. The web question detail shows security-review history and provides the review form only to a configured security reviewer.
5. PostgreSQL migration `0005_question_reviews.sql` persists review history in the question aggregate and extends the JSON shape constraint.
6. Application/API regressions cover contributor denial, separate approval, duplicate reviewer prevention, rejected review blocking, and final owner acceptance.

Deliberate boundaries:

- This is a single required security-review role seam; configurable quorum, multiple required roles, administrative override, and review reassignment remain future work.
- Reviews are append-only and one review per fixed reviewer; editing, withdrawal, notification preferences, and a dedicated review object history screen remain future work.

### 20.12 Implemented MCP reviewer-inbox read slice

Implemented:

1. `bridge_list_inbox` exposes the application-level personalized inbox through MCP with the same validated state, risk, category, and assigned-role filters as REST.
2. The tool returns routed inbox reasons, `canAccept`, responses, and protected-review history for the current principal, so a human-capable MCP session can inspect the same review state as the web UI.
3. Ordinary agent principals receive no human-authority inbox items, and MCP still exposes no human acceptance or security-review command.
4. MCP regression coverage verifies role/risk filtering and that a protected QA-owned question remains visible with `canAccept: false` until a security review is recorded.

Deliberate boundaries:

- MCP remains optional and organization approval is still required; CLI/repository snapshots remain the fallback for disconnected environments.
- Human actions continue through the web/API authority boundary; delegated human MCP actions and inbox pagination remain future work. The notification feed is intentionally REST/web-only so MCP approval is never required.

### 20.13 Implemented threaded clarification comments slice

Implemented:

1. Questions now persist append-only `QuestionComment` records with author identity, body, timestamp, and an optional parent comment ID.
2. `POST /v1/questions/:questionId/comments` requires a human principal, the current question version, and a valid same-question parent when replying.
3. A comment moves an open question into `in_discussion`, increments the question version, and emits a dedicated audit event; resolved questions reject new comments.
4. The web question detail renders clarification threads and supports replies while preserving the separate proposed-answer and acceptance flow.
5. PostgreSQL migration `0006_question_comments.sql` persists comments in the question aggregate and extends the JSON shape constraint.
6. Application/API regressions cover agent denial, stale-version conflicts, invalid parents, root comments, replies, and durable retrieval.

Deliberate boundaries:

- Comments are append-only with no edit/delete window, mentions, owner-requested reopen, or due-date escalation yet. Durable notification records now cover the main assignment/discussion/review events; preferences, mentions, and escalation policies remain future work.
- Thread rendering is intentionally a compact parent/reply view; pagination and deeply nested conversation navigation remain future work.

### 20.14 Implemented durable in-app notifications slice

Implemented:

1. Notifications are first-class durable records with recipient, project, event type, target pointer, created time, and optional read time.
2. The application emits notifications in the same transaction as question assignments, proposed responses, clarification comments, protected-question reviews, accepted decisions, specification review requests, and specification approvals.
3. `GET /v1/notifications` is human-only and supports project and unread filters; individual and project-scoped mark-all read commands enforce organization, recipient, and project access.
4. PostgreSQL migration `0007_in_app_notifications.sql` adds the notification table, event-type check, project and organization/project foreign keys, and recipient/read indexes; migration `0008_transactional_outbox.sql` adds typed delivery intents, claim indexes, retry state, and the same organization/project boundary; the in-memory repository mirrors both contracts.
5. The web UI adds a Notifications view with unread count, event details, target navigation, individual mark-read on open, and Mark all read.
6. Application/API and mapper/migration regressions cover durable assignment/comment notifications, agent denial, scoped read state, and persistence mapping.

Deliberate boundaries:

- The current prototype resolves direct owner/reviewer IDs only; role-directory fanout, membership-change reconciliation, live provider delivery, preference administration, digest sending, and pagination remain future work. The outbox/email handlers are deliberately injected and do not choose an external provider.
- Notifications do not capture raw agent transcripts or private reasoning. MCP remains optional and does not expose the human notification feed to ordinary agents.

### 20.15 Implemented transactional outbox and worker cycle slice

Implemented:

1. `OutboxEvent` is a typed durable record with organization/project scope, notification payload, availability time, lease, attempt count, completion state, and last error.
2. Every in-app notification is written together with a pending `notification.created` outbox event through the same application repository transaction.
3. In-memory and PostgreSQL repositories support ordered listing, lease-based claiming, completion, retry scheduling, and dead-letter transitions; expired processing leases can be reclaimed.
4. `apps/worker/src/index.ts` exports `runOutboxCycle`, an at-least-once handler boundary with bounded exponential backoff and configurable batch/attempt settings while preserving the existing reminder-policy seam.
5. Worker, application, mapper, and migration regressions cover successful delivery, retry/dead-letter behavior, notification-to-outbox linkage, tenant constraints, and migration metadata.

Deliberate boundaries:

- No live email, chat, source-control, or work-item provider is enabled; the email template/handler seam and durable receipts are implemented without credentials.
- No daemon scheduler, external adapter, time-series telemetry export, notification preferences, or live PostgreSQL runtime is claimed until the pilot selects a deployment and validates it against an isolated database. Project-scoped inspection, point-in-time metrics, and audited replay are implemented through REST.

### 20.16 Implemented CLI bootstrap safety and diagnostics slice

Implemented:

1. `bridge init --dry-run` previews project registration, Bridge-owned files, and the selected native instruction adapter without mutating API or repository state; when a project ID is known, it may perform a read-only REST mapping validation.
2. Dry-run plans report `create`, `update`, or `unchanged` actions and use a safe placeholder when a new project ID would be assigned by registration.
3. `bridge doctor` verifies API health, the configured project mapping, `.bridge/agent-instructions.md`, and the client-specific managed instruction block.
4. Doctor output reports structured checks, stable failure exit codes, and capability levels: instructions and CLI are available; MCP and hooks are not implicitly claimed unless explicitly configured.
5. CLI regression coverage proves no mutation during dry-run and successful doctor validation after initialization.

Deliberate boundaries:

- Provider-backed repository validation/synchronization, hooks, vendor-native configuration generation, and universal vendor-native interception remain future adapter work. The init mapping check confirms authorized project identity through REST; it does not claim that a provider URL is reachable.
- Doctor validates the fixed-principal prototype boundary; it is not an authentication or organization-membership check.

### 20.17 Implemented optional MCP endpoint discovery slice

Implemented:

1. `bridge init --mcp-url <url>` validates an absolute HTTP(S) endpoint and records it as optional `mcp_url` configuration; `--dry-run` previews the same change without mutation.
2. Re-running `bridge init --force` preserves the existing configured MCP endpoint unless a replacement is supplied.
3. `BRIDGE_MCP_URL` can override repository configuration for a local doctor run without changing committed files.
4. `bridge doctor` sends a bounded diagnostic MCP JSON-RPC `initialize` probe only when an endpoint is configured, reports `ready`, `failed`, or `not_configured`, and never exposes the response body.
5. A healthy endpoint reports capability level `instructions+mcp`; a failed configured endpoint fails doctor with a configuration exit code while preserving the usable instruction/CLI path.
6. CLI regression coverage verifies endpoint persistence, successful initialization, unavailable-endpoint diagnostics, and the no-MCP fallback.

Deliberate boundaries:

- This slice does not negotiate authentication, persist MCP sessions, install hooks, or generate vendor configuration for Cursor/Copilot; Codex and Claude project configuration generation is covered by the later adapter slice.
- MCP remains an opt-in adapter; repositories without `mcp_url` continue to operate through generated instructions, CLI commands, repository snapshots, and the web UI.

### 20.18 Implemented adapter-only installation slice

Implemented:

1. `bridge install --client <client>` activates or switches Codex, Claude Code, Cursor, or Copilot instructions from an existing `.bridge/project.yaml`.
2. Adapter installation never registers a project or calls the Bridge API; it updates the repository's selected client and Bridge-owned workflow files only.
3. Existing unrelated native instruction content is preserved through the same marked-block merge used by `bridge init`.
4. `bridge install --dry-run` reports create/update/unchanged actions for the project config, generated Bridge files, and adapter path without writing files.
5. The command preserves optional MCP configuration while changing only the selected client field.
6. CLI regression coverage proves adapter switching, no duplicate project registration, unrelated-content preservation, and dry-run non-mutation.

Deliberate boundaries:

- This is repository adapter activation, not package installation, authentication, organization onboarding, or vendor-specific MCP configuration generation.
- Switching clients does not delete the previous client's managed block; cleanup remains an explicit human action so unrelated guidance cannot be removed accidentally.

### 20.19 Added repository collaboration and CI handoff guardrails

Implemented:

1. Root `AGENTS.md` provides concise contributor/agent rules and points to the canonical product context, architecture, and backlog documents.
2. Root `CLAUDE.md` references the same instructions so Claude-based contributors receive identical scope and validation guidance.
3. `CONTRIBUTING.md` documents setup, optional PostgreSQL testing, package boundaries, migration expectations, pull-request content, and secret-safety rules.
4. `.github/pull_request_template.md` captures scope, validation, migration, MCP, identity, and secret-safety checks.
5. `.github/workflows/ci.yml` runs `pnpm check` on pushes and pull requests with an isolated PostgreSQL 16 service, enabling the opt-in persistence integration test in CI.

Deliberate boundaries:

- GitHub Actions CI run `31265758794` completed successfully for initial commit `efe10f3`, exercising the isolated PostgreSQL service in addition to typecheck, tests, and production builds.
- Apache License 2.0 is selected in root `LICENSE` and declared in every workspace package. Packages remain marked private until an intentional registry-publication decision.

### 20.20 Completed GitHub release-readiness hardening

Implemented and verified:

1. Existing-repository `bridge init --dry-run` and `--force` now preserve project identity, repository mapping, selected client, API URL, and optional MCP URL unless the operator explicitly replaces them.
2. `bridge doctor` parses a real JSON-RPC initialize result, rejects error-shaped or malformed responses, and uses a bounded five-second request timeout.
3. `bridge inbox` exposes the same role/risk/category/state-filtered human inbox as REST without requiring MCP.
4. Standalone MCP now shares the API's canonical PostgreSQL repository and fails fast without `DATABASE_URL`, eliminating invisible process-local MCP state.
5. Context and MCP record links now target implemented project/view query deep links instead of nonexistent routes.
6. The web application now includes Decisions, Assumptions, and Agent Runs views with source-record navigation and query deep-link selection; Decisions gained governed lifecycle actions in the later decision-lifecycle slice.
7. Question acceptance refreshes the Decision view immediately; an interactive regression reproduced the stale state before the fix and verified the accepted Decision afterward.
8. Node 24 is pinned for common version managers through `.nvmrc`, browser-build configuration is included in Turbo's environment-aware cache key, and runtime environment examples document all local service addresses.
9. The CLI tarball was rebuilt and smoke-tested from a fresh temporary project; the production dependency audit reported no known vulnerabilities.

Deliberate boundaries:

- Live PostgreSQL execution remains CI/isolated-database dependent because this workstation has no local PostgreSQL, Docker, or Podman runtime.
- Authentication, organization onboarding, automatic vendor prompt interception, external notification adapters, scheduled worker deployment, and public package publication are intentionally not represented as completed.
- The repository is licensed under Apache-2.0; ownership-specific copyright or trademark notices can be added later without changing the selected license.

### 20.21 Added observable agent conformance and GitHub CLI distribution

Implemented and verified:

1. `bridge conformance --task [--run-id]` verifies the task-linked run, context snapshot, complete agent-created blocking question, question/run linkage, PRD/ADR/API-contract/test-plan versions, exact version/run linkage, and the human boundary.
2. A separately launched Codex CLI session in a fresh initialized repository received only the ordinary Hospital Management System prompt and passed the final observable conformance check without MCP.
3. The first failed conformance result correctly identified that the agent had published all specifications but had not routed a question; the agent then created a protected role-owned question and the run moved to `waiting_for_human`.
4. Packaged execution now recognizes pnpm's symlinked binary through real-path entrypoint comparison, with a regression test.
5. Generated instructions provide `./node_modules/.bin/bridge` as a no-reinstall fallback when unrelated application dependency policy blocks `pnpm exec`.
6. Root validation now packages the CLI, installs it globally under a temporary prefix, executes the installed command, and verifies a no-mutation bootstrap dry run.
7. A tag-driven GitHub Actions workflow validates tag/version equality and creates a GitHub Release containing the tarball and SHA-256 checksum. Installation and release-owner steps are documented in `docs/distribution.md`.
8. `--output human|json` provides a generic readable rendering for successful commands while preserving JSON as the agent/CI default and for all error envelopes.

Deliberate boundaries:

- Observable conformance cannot detect a vendor-private clarification UI that the vendor does not expose.
- The Codex result is evidence for one client/version/environment; Claude Code remains the next cross-vendor run.
- No release tag was pushed and no registry package was published during implementation. The package stays registry-private until the owner selects and controls a namespace.

### 20.22 Implemented decision lifecycle and direct impact reporting

Implemented and verified:

1. Human decision owners, configured project decision owners, and project administrators can supersede, expire, or revoke an active decision with an expected version and required rationale.
2. Supersession requires a different active replacement in the same project, category, and exact scope; database foreign keys also prevent cross-project replacement references.
3. Accepted answer content remains immutable. The original row records only lifecycle state, actor, rationale, timestamp, replacement link, and incremented version.
4. Retired decisions disappear from default context but remain visible in decision history and retain source-question navigation.
5. Each transition returns directly linked specification IDs, decision-confirmed assumption IDs, source/provenance run IDs, later run IDs whose context snapshots consumed the decision, and the decision's scoped work-item ID as potentially affected records.
6. Lifecycle transitions, audit events, dedicated `decision.lifecycle_changed` outbox events, and any durable recipient notifications plus delivery intents commit through the application transaction boundary.
7. REST provides generic and explicit lifecycle routes, while the Decisions UI exposes the action, replacement selection, lifecycle history, and impact counts.
8. Forward-only migration `0009_true_marauders.sql` adds lifecycle provenance, optimistic versioning, same-project replacement constraints, lifecycle invariants, and the `decision_lifecycle` notification type.
9. Application, API, mapper, migration-structure, type-check, test, build, and packaged-CLI validation pass. The PostgreSQL integration test now exercises supersession when CI supplies its isolated database.

Deliberate boundaries:

- Impact is direct and deterministic; deeper transitive dependency analysis remains BRG-123.
- Automatic review-date expiry and scheduled lifecycle automation remain future work.
- No agent, CLI, or MCP path can perform a human decision lifecycle action.

### 20.23 Implemented specification review feedback and request changes

Implemented and verified:

1. Configured human reviewers and project administrators can append formal `commented` or `changes_requested` feedback to the current draft/in-review specification version.
2. Agents, ordinary contributors, and cross-project principals cannot submit formal review feedback.
3. Review records preserve reviewer identity/type, exact version ID, outcome, body, and timestamp without modifying the version's Markdown body or content hash.
4. Any change request permanently blocks approval of that exact immutable version. The author must publish a new version, which starts with an empty review history.
5. A previously approved version remains current agent context while a newer version receives feedback; only explicit approval changes agent-facing authority.
6. Feedback, audit events, durable notifications, and notification outbox intents commit through the application transaction boundary.
7. REST and the Specifications UI expose review history, comments, request-changes controls, an explicit changes-requested state, and the new-version requirement.
8. Forward-only migration `0010_safe_white_queen.sql` adds the review array with a JSON-shape constraint and extends the notification type constraint.
9. Application/API behavior, PostgreSQL mappers and opt-in integration coverage, type-checks, tests, production builds, and packaged CLI smoke validation pass.

Deliberate boundaries:

- Feedback is append-only; edit/delete windows, inline Markdown anchors, mentions, configurable teams, quorum, and reviewer reassignment remain future work.
- A change request is resolved by publishing a new immutable version, not by mutating or reopening the reviewed body.
- Human review actions remain REST/web-only and do not require MCP approval.

### 20.24 Implemented active-by-default decision browsing and explicit history filters

Implemented and verified:

1. Decision collection reads return active records by default, matching the existing rule that only active authority enters agent context.
2. An authorized caller can explicitly include lifecycle history or select one lifecycle status, then narrow results by exact case-insensitive category, owner, inclusive creation-time range, or supplied exact repository/component/branch/environment/work-item scope dimensions.
3. The shared query contract rejects invalid timestamps and reversed creation-time ranges at the REST boundary.
4. Filtering occurs after tenant/project authorization, so query parameters cannot expose records outside the caller's project access.
5. The Decisions UI exposes active/history mode, lifecycle state, category, owner, component, and creation-date controls with a single clear action.
6. Direct decision links and lifecycle notifications automatically enable history, preserving navigation to retired records without changing the normal active-only view.
7. Application and API regressions cover active defaults, explicit superseded history, combined filters, and invalid date ranges; the PostgreSQL integration path explicitly requests history when verifying retired rows.

Deliberate boundaries:

- The first UI surface exposes component scope because it is the most common narrowing dimension; REST already supports every defined scope dimension.
- Filters are local view state, not saved preferences or shareable query parameters.

### 20.25 Corrected the decision-lifecycle migration for the full PostgreSQL chain

GitHub Actions run `31326190863` exposed a migration-chain defect that local in-memory validation could not execute: migration `0002_complex_moondragon.sql` already creates the exact `bridge_decisions_organization_project_id_unique` constraint, while the generated decision-lifecycle migration attempted to create a unique index with the same PostgreSQL relation name. Migration `0009_true_marauders.sql` now uses `CREATE UNIQUE INDEX IF NOT EXISTS`, preserving fresh and upgrade behavior while allowing the pre-existing exact uniqueness constraint to support the replacement-decision composite foreign key. The migration-structure regression asserts both the earlier constraint and the guarded later statement. The next PostgreSQL run `31326475659` proved that the full migration chain proceeded, then exposed a stale reconnect assertion added with the lifecycle scenario: the run correctly persisted both its original and replacement question IDs. The integration test now asserts those exact provenance IDs instead of expecting only one question. GitHub Actions run `31326716422` then passed the complete isolated-PostgreSQL CI gate for commit `665d83a`.

### 20.26 Implemented authorized full-text decision search

Implemented and locally verified:

1. The decision-list query contract accepts a trimmed two-to-200-character search expression and composes it with active/history, lifecycle status, category, owner, creation-time, and exact-scope filters.
2. Application authorization resolves the project before invoking repository search, preventing search input from weakening tenant/project access.
3. PostgreSQL searches weighted `simple` text-search vectors across answer, rationale, and category, ranks answer matches above rationale and category matches, and preserves creation-time ordering for equal ranks.
4. Forward-only migration `0011_keen_galactus.sql` creates the matching GIN expression index; the schema, Drizzle snapshot/journal, and migration regression describe the same index.
5. Dependency-free in-memory mode implements deterministic Unicode token matching and the same answer/rationale/category field weights, so REST, web, CLI-backed API access, and optional MCP remain usable without PostgreSQL or MCP approval.
6. The MCP `bridge_search_decisions` tool delegates to the same active-only application query instead of maintaining its former substring implementation.
7. The Decisions UI provides an explicit search control and search-specific empty state; a one-character query is not submitted, and clearing filters also clears the draft.
8. Application/API/MCP regressions cover active search, explicit retired-history search, combined filters, invalid input, and cross-organization denial. The opt-in PostgreSQL reconnect test covers active and retired full-text results when CI supplies its isolated database.

Deliberate boundaries:

- The `simple` configuration provides predictable language-neutral token matching without extensions; stemming, fuzzy/trigram matching, synonyms, and semantic/vector retrieval remain separate evaluated enhancements.
- Search relevance scores affect ordering but are not exposed as organizational authority or confidence.
- The GIN index is created normally rather than concurrently because migrations run explicitly before service startup; a large production deployment should revisit online index rollout.

### 20.27 Implemented bounded immutable specification version diffs

Implemented and locally verified:

1. `GET /v1/artifacts/:artifactId/diff` delegates to one application query that authorizes artifact access and requires both requested versions to belong to that artifact.
2. The derived response includes from/to version provenance, stable old/new line numbers, added/removed/unchanged kinds, complete counts, and exact/truncated metadata.
3. Normal documents use a deterministic longest-common-subsequence line comparison bounded to one million comparison cells and 5,000 lines on either side.
4. Larger generated documents fall back to deterministic removed/added regions and every response caps rendered lines at 2,000, preventing unbounded browser rendering while retaining complete counts.
5. The Specifications UI lets a reviewer choose any two versions, safely renders text through React, and represents changed text as adjacent removed and added lines.
6. Comparison only normalizes line endings in derived input. Stored Markdown, hashes, versions, approval state, audits, and outbox records remain untouched, so no schema migration was required.
7. Application and API regressions cover exact changes, metadata and line numbers, cross-project denial, invalid input, large-diff fallback/truncation, and byte-for-byte preservation of immutable bodies.

Deliberate boundaries:

- This is a line diff rather than a word-level or semantic Markdown diff; its output is predictable and does not execute or render embedded Markdown/HTML.
- A truncated response shows its retained prefix and complete aggregate counts, not a pageable diff. Server-side pagination or downloadable patches can be evaluated if real pilot artifacts require them.
- No MCP-specific diff tool was added. Human review uses the canonical REST/web path, while agents retain existing artifact-version retrieval and MCP remains optional.

### 20.28 Implemented project-scoped outbox operations and replay

Implemented and locally verified:

1. `GET /v1/admin/projects/:projectId/outbox` is a human project-admin-only application/REST query with optional status/type filters and a bounded 1–200 item response.
2. Every response includes project-wide point-in-time metrics: counts by state, cumulative attempts, failed/dead-letter count, ready work, expired processing leases, and oldest-ready age.
3. `POST /v1/admin/outbox/:eventId/replay` accepts only failed or dead-letter work and requires the operator's last observed attempt count, preventing stale or concurrent replay.
4. Replay retains the stable event ID and safe pointer-only payload, clears lease/error/completion state, resets the retry budget, and makes the event immediately available to the existing worker.
5. The replay mutation and immutable `outbox.replayed` audit event commit in one repository transaction. Forward-only migration `0012_outbox_operator_replay.sql` adds the matching `outbox_event` audit subject.
6. Cross-organization event IDs return not found; project members without project-admin authority and all agent principals are denied.
7. Application/API/migration regressions cover metrics, filters, invalid input, authority boundaries, invalid states, optimistic conflicts, successful replay, event-ID preservation, and audit provenance.

Deliberate boundaries:

- The snapshot is an operational API, not a web administration page or a time-series telemetry backend; dashboards and alerts remain BRG-104/BRG-111 work.
- Replay resets per-cycle attempts because the immutable audit record preserves who replayed the stable event and when. Email delivery receipts retain each event/channel's current attempt outcome and provider message ID across replay.
- The worker remains handler-injected. Live provider/directory wiring, team delivery, jitter, digest scheduling, and preference administration are still pending; MCP is not required for operator access.

### 20.29 Implemented a privacy-minimized provider-neutral email delivery seam

Implemented and locally verified:

1. `apps/worker/src/email.ts` defines injected recipient-directory and sender contracts; no provider SDK, credentials, or organization identity flow is embedded in the worker.
2. Plain-text assignment, clarification, blocking-escalation, accepted-answer, and artifact-review templates contain bounded minimal context plus an HTTP(S) Bridge review link. Subjects remove control characters to prevent header injection.
3. The notification email handler verifies the notification/outbox pointer envelope before resolving a destination and supplies `${eventId}:email` as the stable provider idempotency key.
4. Recipient addresses exist only in the in-memory sender request. Durable `OutboxDelivery` records contain an organization-scoped SHA-256 destination fingerprint, channel, resolved preference, attempt count, status, timestamps, sanitized failure, and optional provider message ID.
5. Ordinary `immediate`, `muted`, and `digest` preferences produce delivered, suppressed, and deferred outcomes respectively. Protected-review notification email is immediate even when the injected preference is muted/digest.
6. Previously delivered/suppressed/deferred event-channel receipts are not sent twice. A failed receipt can retry only against the same destination fingerprint, preventing silent redirection after failure.
7. Forward-only migration `0013_ancient_gwen_stacy.sql` creates tenant-consistent delivery receipts, adds the required outbox composite key before its foreign key, and enforces channel/status/preference/attempt/hash/time/result invariants.
8. Project-admin outbox inspection returns delivery receipts and delivery-status counts without revealing addresses. Worker, application, API, mapper/migration, and opt-in reconnect coverage exercise the seam.

Deliberate boundaries:

- No message leaves the process until a deployment supplies a real recipient directory and sender. SES credentials, email addresses, and customer data are not stored in repository files or outbox payloads.
- The link can now enter the OIDC web flow; hosted callback, cookie-domain, and email-link validation remain deployment work, so BRG-092 still does not claim a production delivery path.
- Digest preference is durably deferred but not yet batched or sent. The blocking-escalation template exists, while producing SLA escalation notifications awaits scheduled policy work.
- Only plain text is generated. HTML rendering, unsubscribe/preference administration, bounce/complaint handling, SES provider implementation, scheduling, jitter, and telemetry export remain deployment slices.

### 20.30 Implemented operational health and restore-verification foundations

Implemented and locally verified:

1. API and standalone MCP HTTP surfaces expose separate liveness and readiness routes; the API preserves its legacy `/health` liveness response.
2. Readiness crosses the application repository boundary. In-memory development reports its backend, PostgreSQL executes a minimal dependency query, and failures return a sanitized `503` without connection details.
3. `pnpm restore:verify` is a read-only verifier for an already restored isolated PostgreSQL database. It checks required tables, migration history, core row counts, immutable artifact SHA-256 values, tenant-scope consistency, delivery scope, and artifact current/approved-version pointers.
4. The verifier refuses an obvious production-target mistake when `BRIDGE_RESTORE_DATABASE_URL` identifies the same database as `DATABASE_URL`, never prints artifact bodies or connection strings, and exits nonzero on failed checks.
5. `docs/runbooks/backup-restore.md` documents safe dump/restore separation, disabled workers, verification, evidence, and recovery activation without destructive cleanup commands.
6. `docs/runbooks/incidents.md` covers queue backlog/dead letters, failed migrations, active OIDC identity outages, and notification-provider outages while preserving human authority and MCP-independent paths.
7. Application, API, database verifier, MCP, type-check, test, build, and packaged-CLI validation pass without adding a schema migration or production identity/provider dependency.

Deliberate boundaries:

- No repository change can configure or prove managed PostgreSQL PITR, backup retention, object-storage versioning, alerting, or a real isolated restore. BRG-103 remains partial until deployment owners attach dated external evidence.
- Current artifact bodies live in PostgreSQL; object-storage recovery becomes mandatory when the runtime begins storing objects outside that database.
- Readiness covers the canonical repository dependency only. Provider/queue degradation belongs to operational telemetry; the new identity-outage runbook explicitly notes that OIDC can fail while repository readiness stays green.

### 20.31 Implemented end-to-end correlation and safe structured-logging foundations

Implemented and locally verified:

1. Web and CLI callers generate a bounded `x-bridge-correlation-id`; API and MCP validate or replace inbound values and return the effective value on every response.
2. Async request context crosses the transport/application boundary without adding correlation parameters to domain commands. Direct application calls receive a generated context at the repository transaction boundary.
3. Audit and outbox events persist the operation correlation ID. Forward-only migration `0014_first_jane_foster.sql` backfills deterministic legacy IDs before setting non-null constraints, adds format checks, and indexes both durable lookup paths.
4. The worker restores each claimed event's persisted context before handling it. Email and Slack sender requests receive that ID explicitly with their existing stable event/channel idempotency keys.
5. Replayed delivery work keeps its original causal correlation ID while the operator replay audit uses the new request correlation ID.
6. `@bridge/observability` provides context helpers and a JSON logger with bounded event/service names, an operational-field allowlist, recursive sensitive-key removal, unknown free-form redaction, and exception-message suppression.
7. Standalone API/MCP runtimes use safe logging instead of framework-default request/error logs; worker cycle logs are injectable and correlated.
8. Observability, API, application, worker, database mapper/migration, MCP, CLI, web, type-check, test, build, and packaged-distribution validation pass.

Deliberate boundaries:

- This slice provides correlation and safe logs, not distributed tracing export, metrics, dashboards, alert delivery, or deployment log-access controls. BRG-104 remains partial.
- Correlation IDs are untrusted diagnostic metadata. They never confer identity, tenant access, approval authority, or idempotency.
- The logger intentionally sacrifices arbitrary message text for privacy; diagnostic code should add stable event names, safe machine codes, record IDs, enums, and numeric measurements instead of free-form content.

### 20.32 Implemented portable metrics, dashboard, alerts, and initial service objectives

Implemented and locally verified:

1. `@bridge/observability` now includes a dependency-free process-local `BridgeMetrics` registry with fixed counters, gauges, histograms, deterministic snapshots, and Prometheus text rendering.
2. API and standalone MCP runtimes share a registry with their application service and PostgreSQL repository, record bounded route/outcome/duration series, and expose `GET /metrics`. `401`/`403` authorization denials are counted separately.
3. Metrics never add tenant, project, principal, record, prompt, answer, specification, or other content labels. API operations use framework route templates and both HTTP surfaces collapse unmatched paths to `unmatched`.
4. Context retrieval records success/error, end-to-end latency, result count, and pre-truncation candidate count without changing the public context contract.
5. In-memory and PostgreSQL repository transactions record backend/outcome/duration at the outer transaction boundary. The current driver does not expose a stable pool-utilization metric, so provider/exporter saturation telemetry remains explicit deployment work.
6. Outbox cycles record their completion timestamp, claimed count, oldest claimed age, and processed/retried/dead-lettered outcomes; notification email and Slack handling record delivered/failed/suppressed/deferred/skipped outcomes and duration.
7. `config/observability/bridge-pilot-dashboard.json` provides request, latency, error, authorization, database, context, queue, notification, and bounded MCP tool-call PromQL panels. `config/observability/bridge-pilot-alerts.yml` provides sustained API/MCP failure, database availability-risk, outbox backlog/dead-letter, and notification-failure rules.
8. `docs/service-objectives.md` defines the measurement boundary, initial non-contractual pilot objectives, error-budget interpretation, thresholds, response class, ownership, and calibration process.
9. Observability, application, API, and worker regressions cover rendering/privacy, authorization denial, context/database wiring, queue outcomes/age, and email/Slack delivery/idempotent-skip metrics.

Deliberate boundaries:

- Metrics are process-local and reset on restart. Multi-instance collection, storage, dashboard hosting, rule evaluation, paging routes, and monitoring-network access control belong to the deployment.
- The worker exposes injection seams rather than a long-running metrics server because its scheduled durable runtime remains incomplete. Queue/provider panels become live only after that deployment host exports the shared registry.
- MCP session initialize outcomes and bounded tool-call success/error/duration are exported without request arguments or identity/content labels. Database pool saturation requires provider/exporter telemetry.
- The included objectives and thresholds are starting hypotheses. BRG-104 remains partial until representative pilot telemetry validates them and external alert delivery is exercised.

### 20.33 Implemented privacy-conscious product analytics

Implemented and locally verified:

1. `GET /v1/admin/projects/:projectId/analytics` defines a mandatory project scope and optional controlled agent-client plus inclusive run-start cohort filters through the shared contract layer.
2. The application requires a human project administrator after ordinary project access checks. Agents and non-admin humans cannot retrieve analytics, and no support-style cross-tenant bypass exists.
3. Read-time aggregation uses existing run links to count context retrieval, question creation/reuse/routing coverage, responses, decision acceptance/later-run reuse, assumption resolution, and specification publication/approval.
4. Outcomes include context compliance, reuse/routing/acceptance/resolution/approval rates, distinct reused decisions, median decision/specification approval times, assumption status counts, question-volume and context-size guardrails, and per-client breakdowns.
5. The endpoint and web view return only counts, rates, durations, timestamps, and controlled client values. They include a human-readable collection/exclusion notice and do not return task summaries, record text, specification content, principal names, external links, prompts, outputs, transcripts, hidden reasoning, secrets, or credentials.
6. The web **Analytics** view supports client/date filters, summary cards, governed activity, guardrails, client comparison, loading/empty/denied behavior, and the same privacy notice.
7. No migration or external analytics service was added. Both in-memory and PostgreSQL modes use the canonical repository/application boundary, and MCP remains optional.
8. Application and REST regressions prove calculations, exact question/decision reuse, client filtering, content exclusion, invalid-range validation, and project-admin authority. The complete typecheck/test/build/distribution gate passes.

Deliberate boundaries:

- Cohorts select runs by start time and report the current outcome of linked records; this is not an immutable historical as-of warehouse.
- Routing coverage means an owner or role was present. Subjective first-owner correctness requires configured ownership evidence or pilot feedback.
- Retrieving a decision proves Bridge supplied approved context, not that a model followed it or avoided rework.
- User-reported rework, question-quality judgments, mute/unsubscribe behavior, and secret-detection events are not technically available and are not guessed.
- A future materialized analytics store requires a separate privacy/schema/retention review; the MVP intentionally calculates in place.

### 20.34 Implemented OIDC web/API and organization-membership foundation

Implemented and locally verified:

1. The founder explicitly reopened authentication and organization scope. `@bridge/auth` now verifies RS256 OIDC access/ID tokens against JWKS with exact issuer, audience, signature, expiry, state, nonce, PKCE, and matching ID/access-token subject checks.
2. Browser Authorization Code login stores state/nonce/verifier/return location in a ten-minute encrypted `HttpOnly` cookie. The callback exchanges the code server-side and creates an encrypted `HttpOnly` session that cannot outlive the access token; logout clears it and delegates provider logout.
3. API requests accept the session or bearer token. OIDC mode ignores `x-bridge-principal-id`; production startup fails closed without OIDC configuration. The fixed reviewer switcher remains available only outside production.
4. Forward-only migration `0015_spooky_bulldozer.sql` adds organizations, OIDC principal identities, active/disabled organization memberships, and project memberships. It backfills organizations from existing projects before adding the project foreign key.
5. Token role/project claims are not authoritative. Issuer + subject + external organization resolve through the repository on every request, so disabling organization membership blocks the next request.
6. Project roles are stored and evaluated for the target project. A project-admin role in one project cannot confer authority in another; existing fixed global roles remain backward-compatible for development fixtures.
7. `GET /v1/auth/config`, `/login`, `/callback`, `/logout`, and `/me` drive the web sign-in surface. OIDC mode hides reviewer impersonation and displays the authenticated member; local development behavior remains dependency-free.
8. An all-or-nothing environment bootstrap creates the initial external organization mapping and human administrator without exposing a public unauthenticated onboarding endpoint.
9. OIDC startup disables demo organization/project/content seeding. The initial administrator can create the first real project through the existing authorized registration command; development mode retains the complete seeded demonstration.
10. Authentication, application, domain, API, mapper/migration, in-memory directory, and opt-in PostgreSQL reconnect coverage exercises valid/invalid tokens, missing claims, inactive membership, state/nonce/PKCE, session cookies, development-header rejection, and project-scoped roles.

Deliberate boundaries:

- This slice completes the BRG-010 code foundation plus durable trusted-human web sign-in/logout audit events, but not live Auth0 tenant validation or failed/unknown authentication attribution.
- The standalone MCP server now supports external OIDC bearer validation with a dedicated audience and coarse per-tool scopes; its fixed principal remains development-only. Noninteractive CLI/CI service identities use the separate REST-administered Bridge credential path rather than the delegated-human CLI flow.
- Provider-backed organization invitations and enterprise group provisioning remain BRG-127 work; versioned member/role/project-access administration is recorded in section 20.35.
- Coarse REST capability enforcement is now implemented for non-human bearer principals, but endpoint-specific OAuth scopes, CI/service grants, web refresh/revocation administration, PostgreSQL RLS, and maintenance roles remain incomplete.
- Secrets belong only in environment/deployment secret management. No client secret, access token, session token, raw identity-provider response, or customer identity data is recorded in repository documentation.

### 20.35 Implemented versioned organization member administration

Implemented and locally verified:

1. Organization and project membership rows now carry positive optimistic-concurrency versions. Administrator updates require the last-read organization membership version, and project membership writes use their stored versions inside the same transaction.
2. Human organization administrators can list all human members, provision an exact subject under the configured OIDC issuer, disable/reactivate organization access, assign normalized organization roles, grant all-project access, and configure active project memberships with scoped roles.
3. `GET`/`POST /v1/admin/organization/members` and `PATCH /v1/admin/organization/members/:memberId` are the canonical REST boundary. Agents, ordinary humans, and cross-tenant project identifiers are denied.
4. The web **Organization** area is visible only for an organization-level `organization-admin`. It includes member creation, active/disabled status, organization roles, all-project access, and per-project role editing with loading, empty, conflict, and failure behavior.
5. Disabling membership takes effect on the next authentication resolution. The application prevents disabling or demoting the final active organization administrator.
6. Material member changes write a dedicated organization-level audit record with correlation ID, actor, action, target membership, and timestamp. They are not incorrectly attached to an arbitrary project audit stream.
7. Migration `0016_charming_siren.sql` adds the organization audit table, membership versions, positive-version checks, controlled audit actions/subject type, correlation validation, and indexes. Restore verification now requires and counts the new table.
8. The first-admin bootstrap creates membership only when it is absent, so leaving bootstrap configuration present cannot reset a later versioned membership update.
9. Development fixtures grant the architect an explicit organization-admin role so the workflow can be tested without external identity infrastructure. Production OIDC startup remains free of demo data.

Deliberate boundaries:

- Provisioning currently requires the exact provider subject; Bridge does not send provider email invitations or synchronize identity profile changes.
- Reusable teams, ownership-rule configuration, custom role-definition lifecycle, SCIM/group provisioning, and enterprise directory reconciliation remain future slices.
- Organization audit retrieval has a repository boundary but no separate operator audit-view UI yet.
- Failed/unknown authentication attribution, endpoint-specific authentication audits, MCP-side token issuance, RLS, provider-side refresh/revocation administration, and live-provider validation remain incomplete; trusted human web sign-in/logout events are implemented, while REST/MCP bearer capabilities and the service-identity foundation are implemented in sections 20.37-20.39.

### 20.36 Implemented interactive CLI public-client authentication

Implemented and locally verified:

1. OIDC configuration can publish a separate native/public CLI client ID, exact loopback redirect URI, authorization/token/revocation endpoints, audience, scopes, and organization. The confidential web client secret and session secret are never published.
2. `bridge login` generates unpredictable state and a high-entropy verifier, sends an S256 challenge, binds only the configured literal `127.0.0.1` port, accepts only the exact callback path and GET method, compares state safely, bounds the authorization code, and times out after five minutes.
3. The CLI exchanges the authorization code without a client secret, then calls Bridge `/v1/auth/me` with the bearer token before persisting anything. The API remains responsible for issuer/audience/signature/expiry validation and active organization/project membership resolution.
4. Versioned sessions are keyed by API URL and stored in macOS Keychain or Linux Secret Service. Keychain writes send the secret over child-process stdin rather than process arguments. Tokens are never written to `.bridge`, repository configuration, CLI success output, or structured CLI errors.
5. Every ordinary CLI request discovers the API authentication mode. Development mode retains the fixed local principal header; OIDC mode omits that header and uses the stored bearer token.
6. Near-expiry sessions refresh when a refresh token exists, preserve or replace rotated refresh tokens, validate the refreshed access token through Bridge, and atomically replace the credential. Rejected/non-refreshable sessions are removed and explicitly require login.
7. `bridge auth status` reports mode, principal metadata, expiry, refresh availability, and credential-store type without credentials. It removes corrupt sessions safely. `bridge logout` attempts provider refresh-token revocation and clears local storage even when remote revocation is unavailable.
8. The packaged CLI now includes the authentication module. Focused tests cover PKCE/public configuration, callback path/state rejection, keychain stdin handling, stored-session account binding, login, refresh, authenticated API calls, revocation, cleanup, and token exclusion from output.

Deliberate boundaries:

- Windows Credential Manager is not supported by this build. The pilot operating-system implementations are macOS Keychain and Linux Secret Service (`secret-tool`).
- Refresh-token issuance and rotation must be enabled on the external native OIDC client; otherwise the CLI safely asks the user to log in again after access-token expiry.
- The interactive session represents a delegated human. CI and unattended agents need a separate narrowly scoped service-identity flow and must not copy a person's keychain credential.
- Failed/unknown authentication attribution, endpoint-specific API/tool scopes, MCP-side authorization-server/token issuance, and live-provider validation remain pending; trusted human web sign-in/logout events are implemented, while REST/MCP bearer capabilities and protected-resource metadata are covered in sections 20.37-20.38.

### 20.37 Implemented coarse REST bearer capability enforcement

Implemented and locally verified:

1. OIDC access-token `scope` claims are parsed as bounded, whitespace-delimited capability names. Invalid types, empty/oversized names, and unsupported characters fail authentication with a stable `401` rather than being ignored.
2. Resolved non-human bearer principals carry only the validated token scopes for the request; directory metadata cannot silently broaden or preserve stale token capabilities. Human principals continue to use membership and role policy and are not blocked by the coarse provider scope gate.
3. Every authenticated `/v1` `GET`/`HEAD` operation except `/v1/auth/*` requires `bridge:read`; mutating `/v1` operations require `bridge:write`; `bridge:admin` satisfies both. Missing capabilities return a structured `403` with the required capability.
4. `/v1/auth/me` exposes the validated scope list for CLI/UI diagnostics without returning tokens. Development-mode fixed-principal requests remain unchanged.
5. Auth, API, and MCP regressions cover valid scopes, malformed claims, missing read/write capabilities, admin wildcard behavior, human-session compatibility, verifier-only validation, development fallback, and validation ordering after a capability check. MCP remains optional.

Deliberate boundaries:

- This is a coarse REST/MCP boundary, not a complete endpoint-specific OAuth authorization model. Fine-grained tool scopes, MCP-side token issuance, token rotation, and live-provider validation remain pending.
- Scope strings are capability hints from the verified token; server-side organization membership, project access, human approval rules, and record-specific policy remain authoritative.
- The implementation does not add raw transcript capture, private reasoning storage, secrets, or customer data.

### 20.38 Implemented standalone MCP bearer authentication

Implemented and locally verified:

1. `@bridge/auth` now exposes a verifier-only OIDC path that needs only issuer, audience, optional organization claim/JWKS URI, and the existing principal directory; MCP does not receive or invent web client/session secrets.
2. The standalone MCP process accepts `Authorization: Bearer` before MCP initialization, validates the token with the shared issuer/JWKS rules, requires `BRIDGE_MCP_OIDC_AUDIENCE`, and resolves active organization membership through the canonical PostgreSQL directory.
3. MCP publishes protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` (and the origin fallback), advertises the Bridge coarse scopes, and returns `401` plus a `WWW-Authenticate` metadata reference when credentials are missing or malformed.
4. MCP tool callbacks enforce `bridge:read` for reads and `bridge:write` for writes for authenticated non-human principals; `bridge:admin` satisfies both. Human principals continue through membership and role policy. The fixed `BRIDGE_MCP_PRINCIPAL_ID` fallback is explicitly development-only and production startup fails closed.
5. The MCP package links the shared auth package, avoids demo fixture seeding in OIDC mode, and retains the CLI/REST paths when an organization does not approve MCP.

Deliberate boundaries:

- MCP validates tokens issued by an external OIDC authorization server; Bridge does not yet implement MCP-side dynamic client registration, authorization-code/token issuance, refresh/revocation administration, or provider-specific live conformance.
- Tool authorization is intentionally coarse. Endpoint-specific scopes, delegated human/operator binding, PostgreSQL RLS, rate limits, and workload-identity federation remain follow-up work.
- MCP authentication does not expand Bridge’s data boundary: raw transcripts, private reasoning, secrets, and customer data remain excluded.

### 20.39 Implemented revocable service identities for unattended agents

Implemented and locally verified:

1. Human organization administrators can create `agent`, `ci`, or `integration` identities through `POST /v1/admin/organization/service-identities`, assigning normalized roles, all-project access or explicit project memberships, and one or more coarse capabilities.
2. Bridge returns a generated `brg_srv_...` token only in creation/rotation responses. PostgreSQL and the in-memory repository persist only a SHA-256 hash, expiry, scopes, version, and optional rotation/revocation times; list responses never expose token material.
3. API and standalone MCP bearer authentication recognize service tokens through the shared directory, re-check expiry, revocation, active organization membership, and active project membership on every resolution, and attach only the credential's server-side scopes.
4. `POST /v1/admin/organization/service-identities/:serviceCredentialId/rotate` and `.../revoke` use optimistic version checks, immediately invalidate replaced/revoked tokens, and write organization audit records with the `service_credential` subject type. Replacement tokens are returned once; revoking or disabling the identity's membership blocks subsequent bearer requests.
5. The forward-only `0017_cooing_slipstream.sql` and `0018_brainy_blonde_phantom.sql` migrations add the credential table, token-hash uniqueness, positive-version/scope checks, rotation metadata, and organization-audit action/subject checks. Application, auth, API, CLI, mapper, and restore-verification tests cover creation, one-time token exposure, resolution, rotation, scope assignment, listing, and revocation.

Deliberate boundaries:

- Service identities are administered through REST or the equivalent `bridge service identity` CLI commands (and can be driven by a CI secret manager); versioned token rotation is implemented, while provider-side workload identity exchange remains a follow-up capability.
- Tokens are bearer credentials and should be injected through a CI secret manager, never committed, logged, or copied from a human interactive session. Bridge does not store raw agent transcripts or private reasoning.
- Capability enforcement remains coarse (`bridge:read`, `bridge:write`, `bridge:admin`); endpoint-specific scopes, PostgreSQL RLS, rate limits, and live provider/deployment validation remain pending.

### 20.40 Implemented high-confidence secret blocking for durable content

Implemented and locally verified:

1. A shared application-layer detector runs after tenant/role authorization and before every durable free-form write for administration labels, runs, context tasks, assumptions, questions/discussion/answers/reviews, decisions, and specification publication/review/approval.
2. The bounded detector recognizes Bridge service tokens, common provider-token formats, AWS/Google credential identifiers, private-key headers, bearer credentials, credential-bearing database URLs, and long secret URL parameters. Documentation placeholders and ordinary credential-free URLs remain valid.
3. A detection rejects the transaction with stable `SECRET_DETECTED`/`422` behavior. The message and details contain only the controlled content type, field path, and detector type; the matched value is never returned, logged, audited, notified, or persisted.
4. REST, CLI, and optional MCP inherit the same application policy. Tests prove secret-bearing questions/specifications are not stored and the submitted value is absent from API, CLI, and MCP errors.
5. `bridge_content_secret_detections_total` records only bounded content/detector labels. It contains no organization, project, principal, record, or secret labels and is not joined to product-analytics cohorts.

Deliberate boundaries:

- Bridge rejects instead of silently redacting because questions, decisions, assumptions, and specification versions are governance records whose meaning must not be changed invisibly.
- This is a high-confidence accidental-leak guardrail, not comprehensive entropy scanning, enterprise DLP, malware inspection, attachment scanning, or repository secret scanning. Broader policy remains BRG-101 follow-up work.
- Existing accepted records are not retroactively scanned or rewritten. A future migration/backfill would require explicit policy for false positives, quarantine, retention, and audit evidence.

### 20.41 Implemented permission-restricted audit browser and export

Implemented and locally verified:

1. Human project administrators can list the selected project's append-only audit stream; human organization administrators can independently list the organization administration stream. Both application paths authorize the requested scope before reading and deny agents, ordinary members, and cross-tenant principals.
2. Shared contracts validate exact action, actor, subject type/ID, correlation ID, and inclusive creation-time filters. Results are newest-first with an offset capped at 10,000 and page size capped at 200.
3. The web **Audit** area exposes available project/organization scopes, filters, loading/empty/error states, page controls, and JSON/CSV downloads. It uses canonical REST and does not require MCP.
4. Export uses a write-scoped `POST` command, caps output at 5,000 records, and appends an `audit.exported` event in the same repository transaction. Forward-only migration `0019_luxuriant_wallop.sql` expands the organization audit action/subject constraints; Drizzle snapshot/journal metadata matches the migration.
5. The unified read/export record contains only audit IDs, tenant/project identifiers, actor ID/type, controlled action/subject metadata, timestamp, and correlation ID. It never loads or returns question, response, decision, assumption, specification, notification, prompt, transcript, customer-content, private-reasoning, token, or credential bodies.
6. Application/API/database regressions cover authorization, tenant isolation, filters, paging bounds, invalid date ranges, JSON/CSV content, content exclusion, export audit provenance, and migration constraints.

Deliberate boundaries:

- The browser covers events already produced by implemented commands; completing BRG-100 still requires broader assignment, policy, permission, and authentication event coverage plus production retention/export governance.
- Offset pagination is deliberately bounded for the pilot. A keyset cursor and repository-level filtered queries should replace in-memory filtering before very large tenant audit volumes.
- PostgreSQL core tenant rows now also have forced RLS as recorded in section 20.43; tamper-evident chaining/external WORM retention and SIEM streaming remain deployment/security follow-up work.

### 20.42 Verified the implemented authorization and tenant-isolation matrix

Implemented and locally verified:

1. `docs/authorization-matrix.md` maps every PRD permissions row to an implemented command or an explicit unavailable capability, and records transport behavior for REST, web, CLI, and optional MCP.
2. Organization administrators now inherit project-administrator access and authority across projects in only their own organization. Configured project decision owners may approve an immutable specification even when they are not an artifact-specific reviewer. Both paths preserve the real human actor in approval/audit records.
3. Non-human principals still cannot accept decisions, approve specifications, perform lifecycle actions, or satisfy a human role merely by receiving a human-looking owner/reviewer assignment. The MCP agent surface exposes none of those approval commands.
4. Project, run, assumption, question, decision, artifact/version, notification, and outbox lookups return the same resource-specific `404` for an inaccessible real ID and an absent ID. Same-project role failures remain `403`.
5. Application and REST regressions cover cross-organization and same-organization/unassigned ID guessing, collection/search/inbox/notification/outbox/audit isolation, ordinary and protected authority, and concurrent protected acceptance. Exactly one concurrent REST request can create the authoritative decision.

Deliberate boundaries:

- Reassignment remains unavailable, so its implementation still requires role, history, audit, and adversarial test slices. Project-policy mutation is now an explicit administrator-only, versioned command as recorded in section 20.55.
- RLS, the maintenance-store boundary, security-definer bootstrap-directory lookups, and repeatable role/grant reconciliation are now implemented as recorded in sections 20.43-20.45; endpoint-specific non-human scopes and live provider/isolated-database evidence remain BRG-011/BRG-013/BRG-012 work.
- CLI and MCP are agent integration surfaces and intentionally do not implement human approval commands; humans approve through REST-backed UI/API workflows.

### 20.43 Implemented forced tenant RLS and a separate maintenance boundary

Implemented and locally verified:

1. The repository transaction contract accepts immutable organization or maintenance context. Every principal-bearing application operation now executes inside an organization-scoped transaction; a nested transaction cannot change its tenant or elevate itself to maintenance.
2. PostgreSQL sets `bridge.organization_id` with transaction-local `set_config`. Policies use missing-safe `current_setting`, so absent scope exposes no protected rows and rejects writes.
3. Forward-only migration `0020_tenant_row_security.sql` enables and forces RLS on 18 core tenant/project tables; migrations `0024_amazing_blindfold.sql` through `0027_vengeful_lady_ursula.sql` add adapter diagnostics, project repositories, ownership configuration, and policy configuration with the same forced policy, bringing the current protected set to 22. Direct tables compare organization ownership; artifact versions, question responses, and run continuation locators verify ownership through their RLS-protected parent.
4. Idempotency records now store non-null organization ownership and use `(organization_id, key)` as their primary key so equal client keys cannot collide across tenants. The migration backfills existing question, artifact-version, run, and assumption records, discards only orphaned cache rows whose referenced resource no longer exists, then enforces the constraint; schema, repository behavior, migration metadata, and regression coverage match.
5. The default PostgreSQL store rejects maintenance operations. A separately opted-in `mode: "maintenance"` store is required for cross-tenant outbox claims/completion/failure, and PostgreSQL itself must authenticate that connection with `BYPASSRLS`.
6. Repository readiness rejects an API/MCP role that is a superuser or has `BYPASSRLS`, and rejects a maintenance configuration whose role cannot bypass RLS. The restore verifier also refuses a connection that cannot inspect all tenants and disables policy filtering as an additional fail-loud check. This prevents an unsafe or incomplete check without exposing credentials in health output.
7. Static CI tests verify every expected `ENABLE`, `FORCE`, and policy statement plus safe idempotency backfill ordering. The isolated PostgreSQL integration test verifies catalog flags, missing-scope default denial, cross-tenant read/insert/update filtering, tenant switching, and maintenance-context rejection.
8. `docs/database-security.md` records the three-role deployment model, grants, protected tables, bootstrap exceptions, restore requirement, and test procedure. REST remains canonical and MCP remains optional.

Deliberate boundaries:

- `bridge_organizations`, `bridge_principal_identities`, and `bridge_service_credentials` remain outside RLS because exact identity/token lookup occurs before Bridge can resolve an organization. Migration `0021_bootstrap_directory_security.sql` now revokes ambient table reads and exposes only bounded security-definer functions; tenant-scoped directory reads require the transaction-local organization setting. Membership and project reads continue inside the resolved tenant.
- The live worker is still handler-injected. Its future database wiring must use a distinct maintenance secret and store mode; the API/MCP `DATABASE_URL` must never carry `BYPASSRLS`.
- Static and opt-in integration coverage do not prove production role grants, RDS configuration, or every live ID-guessing path. BRG-012 and BRG-102 remain partial until dated isolated-database and deployment evidence exists.
- PostgreSQL constraints can reveal conflicting-key existence even under RLS. Bridge retains opaque identifiers, composite tenant constraints, application authorization, and stable not-found masking alongside database policies.

### 20.44 Implemented security-definer bootstrap directory lookups

Implemented and locally verified:

1. Forward-only migration `0021_bootstrap_directory_security.sql` adds six SQL-language, `SECURITY DEFINER` lookup functions for OIDC identities, organizations, service-token resolution, tenant-scoped identity reads, tenant-scoped credential reads, and credential listing.
2. Every function pins `search_path` to `pg_catalog, public`, uses exact parameters, and is revoked from `PUBLIC`. Deployment grants `EXECUTE` only to the runtime role; the runtime role receives no direct `SELECT` on the three bootstrap tables.
3. Tenant-scoped functions fail closed unless the requested organization matches the transaction-local `bridge.organization_id`. Pre-tenant functions return only the exact OIDC, external-organization, or token-hash match required to establish that scope.
4. The PostgreSQL repository routes all bootstrap reads through these functions. Service-token resolution uses the joined credential/identity result, while organization-principal listing resolves identities through the scoped function instead of a cross-table directory join.
5. Static migration tests assert the security-definer count, safe search path, explicit `PUBLIC` revocations, and tenant-scope predicates. The opt-in integration suite exercises the grants with a temporary NOBYPASSRLS role when the isolated test connection has role-management authority.

Deliberate boundaries:

- Bootstrap tables remain writable by application workflows that create organizations, identities, and credentials. Credential revoke/rotate updates avoid `RETURNING` so the runtime role does not need table `SELECT`; role reconciliation must preserve the no-direct-`SELECT` contract.
- Production role grants, default-privilege reconciliation, and managed PostgreSQL/RDS evidence remain deployment work. Operators must re-apply the explicit bootstrap-table `SELECT` revocation after grant reconciliation.

### 20.45 Implemented repeatable PostgreSQL role and grant reconciliation

Implemented and locally verified:

1. `scripts/provision-postgres-roles.sql` is an operator-only, idempotent `psql` script. It creates missing migrator/runtime/maintenance roles without passwords, reconciles `NOSUPERUSER`, `NOBYPASSRLS`, and `BYPASSRLS`, and refuses duplicate role mappings.
2. The script grants database/schema/table/sequence capabilities to runtime and maintenance, revokes runtime `SELECT` on the three bootstrap tables, grants the six migration-0021 lookup functions only to runtime, and configures default privileges for future migration-owned tables.
3. Catalog assertions fail the script if the role attributes, bootstrap `SELECT` revocations, or lookup-function `EXECUTE` grants do not match the contract. Passwords and workload credentials remain outside the repository and deployment script.
4. Static tests cover the script's no-password and grant boundaries. The existing isolated PostgreSQL integration test remains the live check for a temporary NOBYPASSRLS role; a deployment operator must run the reconciliation script against the target database after migrations.

Deliberate boundaries:

- The script requires a role-management-capable operator connection and does not create or rotate credentials. It must never receive the API `DATABASE_URL` or the maintenance URL.
- Default privileges cannot target only the bootstrap table names, so deployments must re-apply the explicit runtime `SELECT` revocation after any broad grant reconciliation.

### 20.46 Implemented project-scoped pilot support view

Implemented and locally verified:

1. Project and organization administrators can call `GET /v1/admin/projects/:projectId/support`; ordinary members and agent principals receive the existing project-operator denial.
2. The response contains only bounded metadata for active unrouted questions, overdue active decisions whose source question is protected, dead-letter delivery jobs, pending/failed counts, and recorded agent client/capability observations.
3. The web **Support** area provides loading, empty, error, denied, and project-scoped states, links unrouted questions and overdue decisions back to their canonical views, and does not expose delivery error text or governance content.
4. Adapter capability is derived from recorded runs. The latest bounded `bridge doctor` client/capability/MCP/check status is now submitted through REST and displayed separately; it is an operational observation, not a live provider integration guarantee.

Deliberate boundaries:

- The view is an operational signal surface, not a replacement for the outbox replay controls, audit browser, or local repository diagnostics.
- Provider-backed disconnected integrations, richer connector health details, and historical/time-series diagnostic reporting remain follow-up work.

### 20.47 Implemented Slack pilot team-channel adapter

Implemented and locally verified:

1. The worker exposes a Slack Incoming Webhook sender and notification handler behind the existing injected outbox boundary. Webhook URLs are accepted only for `https://hooks.slack.com/services/...` and are expected to come from deployment secret storage.
2. `BRIDGE_SLACK_PROJECT_CHANNELS` provides a configurable JSON mapping from project ID to Slack webhook URL. The mapping is resolved per project and missing mappings are recorded as suppressed Slack delivery receipts rather than retried indefinitely.
3. Question-related notification outbox payloads carry bounded status, risk, and owner IDs. The Slack message resolves owner labels when a directory is supplied, includes a Bridge link, and states that final acceptance/approval remains in Bridge. It does not send the notification body or raw agent content.
4. Slack receipts store only an organization/project-scoped destination hash, semantic dedupe key, preference outcome, attempt count, sanitized error, and provider request ID. Repeated delivery of an already delivered event is skipped using the existing event/channel receipt key; separate recipient events for the same question notification are collapsed by the semantic key.

Deliberate boundaries:

- This is notification-only; Slack cannot accept decisions, approve specifications, or mutate Bridge state.
- The repository provides the provider-neutral sender/handler and configuration parser. Live Slack workspace installation, deployment secret provisioning, and provider/network failure-window validation remain deployment work; worker composition is implemented in section 20.48.
- The existing at-least-once outbox model applies. A provider acknowledgement lost before the receipt is committed can still require operator review; no unproven exactly-once claim is made.

### 20.48 Implemented deployable Slack outbox worker runtime

Implemented and locally verified:

1. `@bridge/worker` now starts a bounded polling loop instead of only printing a readiness placeholder. It claims through the existing outbox contract, invokes the Slack notification handler, records normal retry/dead-letter outcomes through `runOutboxCycle`, and waits between cycles to avoid a hot loop.
2. The process requires `BRIDGE_WORKER_DATABASE_URL`, deliberately separate from the API's `DATABASE_URL`, and opens the PostgreSQL store in `maintenance` mode. This preserves the database security boundary: API/MCP use `NOBYPASSRLS`, while only the explicitly provisioned worker connection can claim cross-tenant delivery work.
3. `BRIDGE_WORKER_CHANNEL` currently accepts `slack`; `BRIDGE_WORKER_POLL_INTERVAL_MS`, `BRIDGE_WORKER_BATCH_SIZE`, `BRIDGE_WORKER_ASSUMPTION_EXPIRY_INTERVAL_MS`, `BRIDGE_WORKER_MAX_ATTEMPTS`, and `BRIDGE_WORKER_BASE_BACKOFF_MS` are validated and bounded. `SIGTERM` and `SIGINT` stop polling and close the database client cleanly.
4. Before delivery polling, the worker invokes the application-owned assumption expiry cycle at the configured interval. The cycle marks only overdue active assumptions, records the automatic expiry audit event, and creates owner/creator notifications and outbox intents once.
5. The worker passes the shared metrics registry and safe logger through the existing correlation-aware outbox/integration boundaries. It never runs migrations, stores webhook URLs, accepts decisions, or changes the human approval boundary.

Deliberate boundaries:

- The runtime currently composes Slack only. Email still requires a live sender/directory and a separate deployment composition; no unsupported email path is silently marked delivered.
- A worker database connection must be provisioned with the documented maintenance role and an explicit target. No production or shared database command is part of the repository validation.
- Slack workspace installation, deployment secret provisioning, provider/network failure-window testing, and a worker metrics exporter remain deployment evidence.

### 20.49 Implemented persisted bounded adapter diagnostics

Implemented and locally verified:

1. `POST /v1/projects/:projectId/adapter-diagnostics` accepts a bounded, REST-canonical report from an authorized project client. The application records the reporter envelope, correlation ID, client, capabilities, MCP state, check names/statuses, aggregate pass/fail state, and observation time inside the tenant transaction.
2. PostgreSQL migration `0024_amazing_blindfold.sql` adds one latest-per-project/client diagnostic row with a project foreign key, explicit RLS policy and forced RLS, constrained status values, and a bounded observed-time index. The repository mapper, upsert, restore verifier, migration assertions, and isolated-database RLS checks include the new table.
3. `bridge doctor` posts its bounded result after local checks. A persistence failure is itself a failed doctor check, while API/MCP/project/configuration details remain local to the CLI and are not copied into the durable report.
4. Project support returns and renders the latest diagnostics without secrets, URLs, raw errors, prompts, repository content, or human approval state. Existing run-derived capability observations remain distinct, and MCP remains optional.

Deliberate boundaries:

- Diagnostics are operational observations, not governance records; they do not create approvals, decisions, audit events, provider connections, or automatic remediation.
- Only the latest result per adapter is retained in this slice. Historical trends, provider-backed connector health, vendor-native configuration generation, and live deployment validation remain follow-up work.

### 20.50 Implemented bounded MCP session and tool telemetry

Implemented and locally verified:

1. `BridgeMetrics` records MCP initialize outcomes plus bounded tool-call success/error counts and duration histograms using controlled session outcomes and tool names.
2. The standalone MCP runtime records initialize request outcomes and wraps all registered tool handlers, including thrown errors and policy denials, without recording request arguments, session IDs, tenant/project/principal IDs, prompts, or content.
3. The pilot dashboard includes MCP tool-call rate and p95-duration panels, while the observability, architecture, backlog, and README documentation describes the new metrics and their limits.

Deliberate boundaries:

- The telemetry remains process-local and optional with MCP; REST remains the canonical business boundary and CLI/repository snapshots remain viable when MCP is not approved.
- Tool errors are diagnostic outcomes, not automatic approval, policy, or incident decisions. Hosted collection, alert delivery, durable worker export, provider pool saturation, and pilot calibration remain deployment work.

### 20.51 Implemented REST-canonical project repository records

Implemented and locally verified:

1. `POST /v1/projects/:projectId/repositories` links provider, owner, repository name, and canonical HTTP(S) URL metadata to an authorized project; `GET` returns the records to any principal with project access.
2. Repository identity is deterministic and unique within an organization/provider/owner/name scope. Repeating the same link returns an idempotent replay, while attempting to link the same identity to another project returns a conflict without leaking unrelated project data.
3. The in-memory and PostgreSQL repositories share the same contract. Migration `0025_calm_vengeance.sql` adds a tenant-scoped, forced-RLS table with a composite project foreign key, uniqueness constraint, index, mapper, restore-verifier coverage, and migration regression checks.
4. Linking is project-admin/human controlled and writes a project audit event. Repository metadata remains separate from source code and is never fetched or stored by Bridge.

The administrator web **Repositories** view and MCP-independent CLI now provide list/link presentation over the same REST endpoints. They preserve the metadata-only boundary and leave provider validation and source synchronization to a future integration slice.

Deliberate boundaries:

- REST is the canonical repository-association boundary; MCP remains optional and does not gain a direct database path.
- Provider-backed repository validation and synchronization remain follow-up work. The canonical URL is caller-supplied metadata, not proof of provider connectivity.

### 20.52 Completed interactive repository initialization

Implemented and locally verified:

1. `bridge init --interactive` lists only projects returned by the canonical authorized REST project list, displays stable project names/IDs, and accepts a numbered selection, project ID, or project name.
2. `bridge init` detects a repository name from the local `origin` remote when available, with an explicit `--repository` override and directory-name fallback.
3. Explicitly selected and newly registered project IDs are read back through `GET /v1/projects/:projectId` before any `.bridge/` or native adapter file is written; a failed mapping leaves the repository unchanged.
4. Existing Bridge-owned changes are planned as create/update/unchanged actions. Interactive runs show the changed paths and require an affirmative confirmation; `--force` preserves the existing explicit noninteractive override and `--yes` supports separately approved automation.
5. CLI regression coverage proves authorized selection, mapping-failure no-write behavior, and confirmation refusal/approval. No schema, migration, MCP, or direct database path was added.

Deliberate boundaries:

- REST validates project identity and caller access, not provider connectivity or source synchronization. Repository records remain metadata-only and continue to use the separate REST repository-management commands.
- Interactive initialization is a human setup workflow. Agents and CI can continue using explicit project IDs or a pre-approved `--name` registration flow without MCP.

### 20.53 Implemented project-scoped Codex and Claude MCP configuration

Implemented and locally verified:

1. When `mcp_url` is configured, `bridge init` and `bridge install` generate Codex's project-scoped `.codex/config.toml` or Claude Code's project-scoped `.mcp.json` alongside the existing Bridge instruction adapter.
2. Codex uses a managed `[mcp_servers.bridge]` block with the approved HTTP endpoint. Claude Code uses an `mcpServers.bridge` entry with explicit HTTP transport; no token, OAuth secret, bearer header, or other credential is written.
3. Existing unrelated TOML/JSON settings and MCP servers are preserved. Bridge-owned markers permit safe regeneration; an unrelated existing `bridge` server or malformed config fails closed instead of being overwritten.
4. Dry-run plans include vendor MCP config changes, and switching clients leaves the previous client's config file untouched so unrelated client state is not deleted.
5. CLI regression coverage verifies Codex generation, Claude JSON merging, client switching, and preservation of unrelated settings.

Deliberate boundaries:

- MCP remains optional. Cursor and Copilot continue to receive instruction-only adapters in this slice; vendor-specific configuration for them, hooks, vendor discovery, and authentication remain pending.
- Generated project config only points the client at the approved endpoint. The user or approved client performs any OAuth login through its own supported flow; Bridge never stores client credentials in the repository.

### 20.54 Implemented configurable project roles, teams, and ownership rules

Implemented and locally verified:

1. Human project and organization administrators can read and replace one project-scoped ownership configuration through canonical `GET` and `POST /v1/admin/projects/:projectId/ownership` REST endpoints and the web **Ownership** view.
2. The aggregate contains normalized custom role definitions, reusable teams of active human project members, and ordered rules that can match repository, component, and category within the project. Owner and reviewer targets remain separate and may reference direct humans, roles, or team keys.
3. Equal-priority rules whose selectors overlap are rejected independently for the owner and reviewer lanes. Missing teams, duplicate targets, non-human or inaccessible principals, empty responsibility rules, stale versions, and secret-bearing labels fail before persistence.
4. The complete aggregate is written with optimistic concurrency and a `project.ownership_configured` audit record in one transaction. In-memory rollback, PostgreSQL compare-and-set behavior, tenant masking, human administrator authority, and REST validation have regression coverage.
5. Forward-only migration `0026_thin_sheva_callister.sql` adds the project-composite foreign key, JSON shape/count checks, forced tenant RLS, mapper/repository/restore support, and an expanded audit-subject constraint for ownership configuration.

Deliberate boundaries:

- Role assignment remains in versioned organization/project membership administration. Teams and direct responsibility targets can contain only active humans; no agent recommendation or configuration change creates human approval authority.
- BRG-022 supplies the separate risk/protected-action policy; BRG-031 now consumes these ownership rules for explainable question routing and reassignment as recorded in section 20.56.
- REST remains canonical. MCP has no ownership-management tool or direct database path and remains optional.

### 20.55 Implemented versioned risk, routing, and protected-action policy

Implemented and locally verified:

1. Human project and organization administrators can read and replace one project-scoped policy through canonical `GET` and `POST /v1/admin/projects/:projectId/policy` REST endpoints and the web **Policy** view. Updates use optimistic aggregate versions and append `project.policy_configured` atomically.
2. The limited application-owned matcher supports exact normalized category plus optional repository, component, branch, environment, and work-item scope. Ordered rules set minimum risk, one of `assume_and_log`, `ask_async`, `block`, or `protected_approval`, and separate required owner/reviewer roles; equal-priority overlap is rejected.
3. Evaluation takes the strongest outcome across agent-declared risk/interruption, the first matching configured rule, and code-owned PILOT-008 safety floors. An exact configured protected category must retain every default authority role, so administrators may strengthen but cannot silently weaken the pilot matrix.
4. Assumption writes proceed only when the effective action remains low-risk `assume_and_log`. Questions persist effective action, policy version, matched rule key, and required owner/reviewer roles; policy owner roles augment explicit routing, protected questions always block, and automatic fallback is rejected.
5. Protected review now recognizes the policy-required human roles instead of one hard-coded title. Acceptance requires the accepting human to hold every required owner role, while each reviewer role must be held by that owner or represented by an approved human review; an agent still cannot review or accept.
6. Question creation/reuse/review/decision/lifecycle audits and assumption-recorded audits retain policy version. Forward-only migration `0027_vengeful_lady_ursula.sql` safely backfills existing questions before adding non-null policy provenance, adds audit provenance, and creates the tenant-scoped forced-RLS policy aggregate with mapper/repository/restore coverage; `0028_cold_tombstone.sql` adds bounded required-owner-role provenance.

Deliberate boundaries:

- This is the PILOT-021 limited declarative schema evaluated in application code, not a general policy language. Selectors are exact, the safety matrix is code-owned, and conditional expressions remain outside this slice; bounded per-reviewer-role quorum is implemented.
- BRG-031 now applies ownership rules and policy authority to explainable routing and reassignment as recorded in section 20.56.
- REST remains canonical. MCP consumes the resulting governed question behavior through existing application commands but has no policy-management or direct database path.

### 20.56 Implemented explainable question routing and reassignment

Implemented and locally verified:

1. Question creation resolves explicit owner targets, scoped repository/component ownership, category ownership, project-wide ownership or configured decision owners, then an administrator-visible fallback. Owner and reviewer lanes resolve independently and policy-required roles are always retained.
2. Every question persists owner/reviewer route sources, matched rule keys, ownership/policy versions, and an initial append-only assignment-history entry. The administrator support view exposes questions with no resolved owner target.
3. Personalized inbox routing now includes direct reviewers and reviewer roles without granting them owner acceptance authority. The web Questions detail shows current lanes, route provenance, and assignment history.
4. Human project administrators can reassign an unresolved question through canonical `POST /v1/questions/:questionId/assignments` or the web form. Direct targets must be active human project members, stale versions fail, required policy roles cannot be removed, and agents/contributors are denied.
5. Reassignment updates the aggregate, appends history, writes a policy-versioned `question.reassigned` audit, stores a typed transactional outbox event, and notifies direct owners/reviewers atomically. Injected audit failure proves the assignment and event roll back together.
6. Forward-only migration `0029_unknown_madame_hydra.sql` backfills legacy current assignments and history before enforcing JSON shape/non-null constraints and adding the reassignment outbox type. Mapper, migration, domain/application, API, MCP compatibility, worker, and web type coverage pass without running a database command.

Deliberate boundaries:

- Reassignment is a human project-administrator coordination command, not approval. Decision acceptance and protected-review rules remain separate, and no agent can become a direct human assignment target or invoke the command.
- REST remains canonical. MCP retains existing governed question creation/read behavior but exposes no reassignment tool and remains optional.
- Notification preferences and live isolated-PostgreSQL evidence remain separate backlog/deployment work. Due-aware inbox behavior is recorded in section 20.57.

### 20.57 Implemented due-aware personalized inbox and server action authority

Implemented and locally verified:

1. Structured question creation accepts an optional offset-aware ISO due timestamp and stores its canonical UTC form. Forward-only migration `0030_gray_smasher.sql` adds the nullable `due_at` column plus a project/due index without rewriting existing questions.
2. Shared list, detail, REST inbox, and optional MCP inbox reads derive `overdue`, `due_soon` (within seven days), `scheduled`, or `none` from the application clock. No stale calculated status is persisted.
3. Inbox filtering now covers status, risk, category, both owner and reviewer roles, and due state. Protected work remains first, followed by overdue, blocking, due-soon, remaining risk, nearest deadline, active discussion, and recency.
4. Every question read carries server-derived `canAccept`, still-available policy-review roles, and `canReassign`. The shared Questions UI therefore does not lose an owner's actual authority merely because a personalized inbox filter excludes that record.
5. The web shows due state in list and detail views, exposes a due filter, and round-trips all inbox filters through prefixed URL query parameters while preserving unrelated deep-link state. Initialization is gated so an unfiltered request cannot race and overwrite restored filters.
6. Application tests cover canonical due timestamps, every due filter, prioritization, human authority, and tenant-safe empty agent inbox behavior. REST rejects unknown due filters, MCP consumes the shared contract, database mapping/migration coverage passes, and no target database command was run.

Deliberate boundaries:

- Due timestamps are optional question metadata supplied through canonical question creation. A separate deadline-change command, reminders/escalations, and notification preferences remain future workflow policy.
- Multi-role quorum, administrative approval override, and review reassignment are now implemented in BRG-043; this inbox slice exposes their server-derived status and action authority and never grants approval authority locally.
- URL state makes one project inbox view shareable and restorable without introducing another persisted preference aggregate. Server-stored personal views and a cross-project aggregate remain later product choices.
- REST remains canonical. MCP uses the same read contract and remains optional; no human mutation path was added to MCP.

### 20.58 Implemented protected approval quorum, override, reassignment audit, and question provenance

Implemented and locally verified:

1. Project policy rules accept an optional bounded reviewer quorum per normalized required reviewer role. Non-required roles and non-protected actions are rejected at the REST contract and application boundaries; stronger matching policy rules merge quorum requirements conservatively.
2. Protected question reads expose approval requirements with approved, rejected, remaining, and satisfied/pending/rejected status. Quorum counts distinct human reviewer IDs, and rejected requirements block ordinary acceptance until enough approved reviews exist.
3. Human project administrators can use canonical `POST /v1/questions/:questionId/override` with an expected version, decision rationale, and bounded reason when a protected reviewer requirement cannot be completed. Agents and non-admin humans are denied; the command creates the decision as a human action, stores only bounded override metadata, and writes a separate `question.approval_overridden` audit reason.
4. Reviewer-only reassignment is distinguished as `question.review_reassigned` while retaining the existing versioned assignment history, notification, and transactional outbox behavior. Reassignment remains coordination, not approval authority.
5. The web Questions detail adds a compact provenance disclosure for the linked run and scope, displays approval counts, exposes only server-authorized review/override actions, and the Audit view/CSV includes bounded administrative reasons.
6. Forward-only migration `0031_deep_vampiro.sql` adds effective reviewer quorum and approval-override JSON metadata to questions plus a nullable audit reason. Domain/application/REST/API/web/database mapper and migration tests cover quorum, rejection blocking, override authorization/conflicts, reassignment auditing, audit export, and legacy mapper compatibility. No database command was run; PostgreSQL integration remains gated by an explicitly isolated `BRIDGE_TEST_DATABASE_URL`.

Deliberate boundaries:

- The override is an exceptional human administrative decision, not synthetic reviewer evidence; MCP exposes no approval or override mutation and REST remains canonical.
- Reviewer assignment still uses the existing role/direct-target coordination model. Reviewer directory UX, notification preferences, provider-backed related-link synchronization, and live isolated-PostgreSQL evidence remain follow-up work. Question collaboration edits, mentions, controlled clarification, and cancelled/expired discussion reopening are implemented in section 20.59; accepted-decision reopening remains a separate lifecycle slice.
- Reasons are operational audit metadata only. Bridge continues to reject and avoid storing secrets, raw transcripts, prompts, answers outside their governed records, or private reasoning.

### 20.59 Implemented governed question collaboration slice

Implemented and locally verified:

1. Questions accept bounded typed related links for repository, work item, branch, artifact, run, or external references. The links remain metadata-only and do not imply provider synchronization or source access.
2. Human responses and threaded comments can carry mention IDs. The application validates every mention as an active human with access to the question's organization/project, deduplicates IDs, and creates the existing scoped human notification type without exposing a new agent authority path.
3. The original human author can edit an unresolved response or comment with an expected question version. The previous value is appended to an explicit revision-history array before the current value changes; agents, other humans, resolved questions, stale versions, and no-op edits are rejected.
4. Question owners can request clarification on an open question. Owners and project administrators can reopen only cancelled or expired questions into `in_discussion`. Accepted questions and accepted decisions are intentionally excluded; decision lifecycle remains a separate governed command.
5. REST remains canonical through `PATCH /v1/questions/:questionId/responses/:responseId`, `PATCH /v1/questions/:questionId/comments/:commentId`, `POST /v1/questions/:questionId/clarification`, and `POST /v1/questions/:questionId/reopen`. MCP remains optional and exposes no human mutation shortcut.
6. Question detail reads expose server-derived editable response/comment IDs and clarification/reopen authority. The web renders related links, mentions, edit forms, revision history, and authorized clarification/reopen forms with progressive disclosure.
7. Forward-only migration `0032_bitter_lethal_legion.sql` adds `related_links` to questions and `mentioned_principal_ids` plus `revision_history` to responses, each with JSON-array shape constraints and mapper/repository coverage. Application, REST, contract, domain, mapper, migration, and web type checks/tests cover the slice. No database command was run; PostgreSQL integration remains gated by an explicitly isolated `BRIDGE_TEST_DATABASE_URL`.

Deliberate boundaries:

- Mention validation is project-scoped membership validation, not a directory search or notification-preference system; notification preferences and provider-backed delivery remain separate work.
- Related links are supplied and displayed as bounded metadata. GitHub/work-item validation and synchronization remain integration work.
- Reopening a question discussion does not reopen, supersede, or revise an accepted Decision. Any accepted-decision correction must use the separate decision lifecycle/replacement model.
- REST/application policy is authoritative for all mutation paths. MCP and repository snapshots remain optional alternatives for agent workflows and cannot create human approval.

### 20.60 Implemented governed assumption lifecycle and scheduled expiry

Implemented and locally verified:

1. `POST /v1/assumptions/:assumptionId/resolve` remains the single REST-canonical human resolution command. It preserves expected-version, decision-owner/project-admin, rationale, expiry, supersession, and cross-project link checks.
2. A confirming human can supply `confirmedDecisionId` to link an existing active same-project decision or `createDecision: true` to create an authoritative decision from the assumption statement. The new decision is human-owned, audited as accepted, and stored without a question/response pointer; the assumption retains the provenance link. Direct-negation conflicts are rejected.
3. The assumptions view now filters all lifecycle states, shows directly linked source-run/source-link context, and exposes authorized human confirm/reject/expire controls. Confirmation can explicitly create the authoritative decision; agents see no resolution authority.
4. The application owns `expireDueAssumptions`, which scans organizations/projects only through the maintenance transaction boundary. The worker runs it on a bounded `BRIDGE_WORKER_ASSUMPTION_EXPIRY_INTERVAL_MS` schedule before outbox polling. Only overdue active records transition, so repeated cycles do not duplicate notifications.
5. Automatic expiry notifies project decision owners and the assumption creator with the durable `assumption_expired` in-app type and a `notification.created` outbox event. No raw transcript, secret, or private reasoning is included.
6. Forward-only migrations `0033_sparkling_carlie_cooper.sql` and `0034_mute_energizer.sql` allow question-less/source-less decisions for assumption provenance with an explicit source-shape check; `0035_odd_gravity.sql` extends the notification type constraint for assumption expiry. Mapper, application, REST, worker, web, and migration regressions cover creation/linking, human-only authority, scheduled idempotence, notification fanout, filtering, and delivery scheduling. Migration files were generated, but no database connection or migration command was run; PostgreSQL integration remains gated by an explicitly isolated `BRIDGE_TEST_DATABASE_URL`.

Deliberate boundaries:

- Confirming an assumption does not silently create a decision; the human must choose the explicit create option or link an existing decision. Confirmed assumptions remain visibly distinct from authoritative decisions even when linked.
- The worker schedule is deployable but not a claim that a hosted scheduler, provider delivery, live PostgreSQL role, or production alerting configuration has been validated. REST remains canonical for human actions and MCP remains optional.

### 20.61 Completed pilot support signals for assumptions and blocked runs

Implemented and locally verified:

1. `GET /v1/admin/projects/:projectId/support` now reports active assumptions due within seven days, including an overdue flag for records whose maintenance expiry has not yet run. Resolved assumptions are excluded.
2. The same support read model reports runs in `waiting_for_human` with bounded client/capability metadata and remaining blocking-question counts. Task summaries and assumption statements are intentionally omitted from the support payload.
3. The web **Support** view adds summary counts and progressive-disclosure signal panels that link assumptions to **Assumptions** and blocked runs to **Agent Runs**; existing unrouted-question, overdue-decision, delivery, adapter, and doctor links remain unchanged.
4. Application and REST regressions cover expiring-assumption ordering, blocked-run counts, operator-only access, seeded blocked-run behavior, and the support payload's content-minimization boundary. No schema or database command was added; PostgreSQL integration remains gated by an explicitly isolated `BRIDGE_TEST_DATABASE_URL`.

Deliberate boundaries:

- The seven-day window is an operator signal, not a new assumption lifecycle state or a replacement for the scheduled worker expiry cycle.
- Support rows are bounded metadata and do not grant mutation authority. REST remains canonical, MCP remains optional, and human approval boundaries are unchanged.

### 20.63 Implemented durable human web authentication audit events

Implemented and locally verified:

1. A successful OIDC web callback now returns the trusted active human principal to the API boundary, creates the encrypted browser session, and appends a tenant-scoped `authentication.succeeded` organization audit event through the application transaction boundary.
2. Cookie-backed web logout resolves only the trusted session cookie and appends `authentication.logged_out` before clearing the session. Missing or invalid cookies still log out safely without fabricating an audit record.
3. Non-human principals are rejected from establishing browser sessions, preserving the distinction between agent recommendation authority and human web approval authority.
4. Organization audit constraints, domain types, mappers, in-memory/application behavior, REST callback/logout tests, and the opt-in PostgreSQL integration path cover the new `principal_identity` subject type and authentication actions through forward-only migration `0036_clammy_paper_doll.sql`.

Deliberate boundaries:

- Failed, malformed, expired, or otherwise unknown authentication attempts are not durably attributed because no trusted tenant/principal context exists; they remain correlation-aware safe logs.
- This covers trusted human web sign-in/logout only. CLI token lifecycle, bearer authentication failures, provider-side audit feeds, production retention, and live tenant/deployment evidence remain follow-up work. REST remains canonical, MCP remains optional, and no database command was run against a production target.

## 21. Important implementation files

- Product requirements: `docs/bridge-prd.md`
- Contributor/agent rules: `AGENTS.md`, `CLAUDE.md`, and `CONTRIBUTING.md`
- CI workflow: `.github/workflows/ci.yml`
- Founder/pilot decisions: `docs/pilot-decisions.md`
- Technical architecture: `docs/technical-architecture.md`
- Authorization evidence matrix: `docs/authorization-matrix.md`
- Implementation backlog: `docs/mvp-backlog.md`
- This living context: `docs/working-context.md`
- Domain entities/policy: `packages/domain/src/index.ts`
- OIDC verifier and encrypted web session: `packages/auth/src/index.ts`
- Authentication and organization operator guide: `docs/authentication.md`
- PostgreSQL tenant-isolation and role guide: `docs/database-security.md`
- PostgreSQL role reconciliation: `scripts/provision-postgres-roles.sql`
- Shared schemas: `packages/contracts/src/index.ts`
- Application service/repository interface: `packages/application/src/index.ts`
- Persisted-content secret detector: `packages/application/src/content-security.ts`
- Database schema: `packages/database/src/schema.ts`
- PostgreSQL repository: `packages/database/src/repository.ts`
- Project repository metadata schema/mappers: `packages/database/src/schema.ts`, `packages/database/src/mappers.ts`
- Initial migration: `packages/database/drizzle/0000_nice_bulldozer.sql`
- Agent-run migration: `packages/database/drizzle/0001_early_ricochet.sql`
- Assumption migration: `packages/database/drizzle/0002_complex_moondragon.sql`
- Project-registration audit migration: `packages/database/drizzle/0003_project_registration.sql`
- Role-aware question migration: `packages/database/drizzle/0004_role_aware_questions.sql`
- Protected-question review migration: `packages/database/drizzle/0005_question_reviews.sql`
- Threaded question comments migration: `packages/database/drizzle/0006_question_comments.sql`
- In-app notifications migration: `packages/database/drizzle/0007_in_app_notifications.sql`
- Transactional outbox migration: `packages/database/drizzle/0008_transactional_outbox.sql`
- Decision lifecycle migration: `packages/database/drizzle/0009_true_marauders.sql`
- Specification review migration: `packages/database/drizzle/0010_safe_white_queen.sql`
- Decision full-text search migration: `packages/database/drizzle/0011_keen_galactus.sql`
- Outbox operator-audit migration: `packages/database/drizzle/0012_outbox_operator_replay.sql`
- Email delivery-receipt migration: `packages/database/drizzle/0013_ancient_gwen_stacy.sql`
- Correlation propagation migration: `packages/database/drizzle/0014_first_jane_foster.sql`
- Organization/identity/membership migration: `packages/database/drizzle/0015_spooky_bulldozer.sql`
- Versioned member-administration migration: `packages/database/drizzle/0016_charming_siren.sql`
- Service-identity migration: `packages/database/drizzle/0017_cooing_slipstream.sql`
- Service-identity rotation/audit migration: `packages/database/drizzle/0018_brainy_blonde_phantom.sql`
- Organization audit-export constraint migration: `packages/database/drizzle/0019_luxuriant_wallop.sql`
- Tenant row-security migration: `packages/database/drizzle/0020_tenant_row_security.sql`
- Bootstrap directory security migration: `packages/database/drizzle/0021_bootstrap_directory_security.sql`
- Slack delivery-channel migration: `packages/database/drizzle/0022_blue_betty_ross.sql`
- Slack semantic-dedupe migration: `packages/database/drizzle/0023_normal_synch.sql`
- Persisted adapter-diagnostic migration: `packages/database/drizzle/0024_amazing_blindfold.sql`
- Project repository metadata migration: `packages/database/drizzle/0025_calm_vengeance.sql`
- Project ownership configuration migration: `packages/database/drizzle/0026_thin_sheva_callister.sql`
- Project policy and question provenance migration: `packages/database/drizzle/0027_vengeful_lady_ursula.sql`
- Required policy owner-role provenance migration: `packages/database/drizzle/0028_cold_tombstone.sql`
- Explainable question routing and assignment-history migration: `packages/database/drizzle/0029_unknown_madame_hydra.sql`
- Question due-date and project/due index migration: `packages/database/drizzle/0030_gray_smasher.sql`
- Protected approval quorum, override metadata, and audit-reason migration: `packages/database/drizzle/0031_deep_vampiro.sql`
- Governed question collaboration, related links, mentions, and revision-history migration: `packages/database/drizzle/0032_bitter_lethal_legion.sql`
- Assumption-sourced decisions migration: `packages/database/drizzle/0033_sparkling_carlie_cooper.sql`
- Decision source-shape constraint migration: `packages/database/drizzle/0034_mute_energizer.sql`
- Assumption-expiry notification migration: `packages/database/drizzle/0035_odd_gravity.sql`
- Human web authentication audit migration: `packages/database/drizzle/0036_clammy_paper_doll.sql`
- Demo fixtures: `packages/test-support/src/index.ts`
- REST API: `apps/api/src/app.ts`
- API bootstrap: `apps/api/src/server.ts`
- MCP tools: `apps/mcp/src/bridge-server.ts`
- MCP HTTP bootstrap: `apps/mcp/src/server.ts`
- CLI: `apps/cli/src/index.ts`
- CLI PKCE, loopback callback, and OS credential stores: `apps/cli/src/auth.ts`
- Web UI: `apps/web/app/page.tsx`
- Web styles: `apps/web/app/globals.css`
- Worker outbox cycle/runtime: `apps/worker/src/index.ts`, `apps/worker/src/runtime.ts`
- Provider-neutral notification email handler: `apps/worker/src/email.ts`
- Slack pilot notification handler and Incoming Webhook sender: `apps/worker/src/slack.ts`
- Correlation and safe structured logging: `packages/observability/src/index.ts`
- Bounded metrics registry and Prometheus rendering: `packages/observability/src/metrics.ts`
- Observability behavior and boundaries: `docs/observability.md`
- Product analytics definitions and privacy boundary: `docs/product-analytics.md`
- Pilot service objectives: `docs/service-objectives.md`
- Portable dashboard and alert definitions: `config/observability/bridge-pilot-dashboard.json`, `config/observability/bridge-pilot-alerts.yml`
- Read-only restore verifier: `packages/database/src/verify-restore.ts`
- Backup/restore runbook: `docs/runbooks/backup-restore.md`
- Incident runbook: `docs/runbooks/incidents.md`

## 22. Source references already used in product decisions

These references were previously reviewed and are recorded in the formal decision documents:

- OpenAI/Codex MCP documentation: `https://learn.chatgpt.com/docs/extend/mcp?surface=cli`
- Claude Code MCP documentation: `https://code.claude.com/docs/en/mcp`
- Drizzle PostgreSQL documentation: `https://orm.drizzle.team/docs/get-started/postgresql-new`
- Postgres.js project documentation: `https://github.com/porsager/postgres`
- Auth0 MCP authorization reference: `https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server`
- Auth0 Organizations reference: `https://auth0.com/docs/manage-users/organizations/organizations-overview`

Auth0 references now support the reopened identity implementation. Provider-specific deployment configuration still requires live validation.

## 23. Continuation checklist

Before continuing work:

1. Read this file.
2. Read the latest explicit user message.
3. Check `git status --short` and preserve user changes.
4. Check whether `AGENTS.md` or other workspace instructions now exist.
5. Confirm identity changes stay inside the reopened scope and preserve membership, tenant, human-approval, secret-handling, and MCP-optional boundaries.
6. Update the task plan.
7. Implement through existing contracts/domain/application boundaries.
8. Add tests proportional to the behavior changed.
9. Run `pnpm check` when dependencies are available.
10. Update this file before handing off.

## 24. One-sentence current state

Bridge is a contributor-ready governed-agent MVP with installable CLI bootstrap, shared question/decision/specification workflows, completed human assumption confirmation and scheduled expiry notification, a due-aware personalized inbox with URL-persisted filters and server-derived action authority, durable optional PostgreSQL/MCP paths, versioned project role/team/ownership configuration, versioned limited risk/routing/protected-action policy with immutable pilot floors, configurable protected reviewer quorum with approval summaries and audited administrator override, explainable owner/reviewer routing and administrator-only versioned reassignment, question run/scope provenance, privacy-conscious analytics/observability, bounded MCP session/tool telemetry, REST-canonical project repository records with administrator web/CLI management, Auth0-compatible OIDC web/API with durable trusted-human sign-in/logout audit events, interactive CLI PKCE, audited organization/project membership administration, permission-restricted metadata audit browsing/export, revocable scoped service identities, coarse REST/MCP bearer capabilities, MCP protected-resource metadata, pre-persistence high-confidence secret blocking, forced transaction-scoped RLS on the core tenant data plane, security-definer bootstrap-directory lookups, repeatable PostgreSQL role/grant reconciliation, a project-scoped pilot support view with latest bounded adapter diagnostics, a Slack Incoming Webhook notification adapter, and a deployable maintenance-role Slack outbox worker; failed/unknown authentication attribution, endpoint-specific tool scopes, broader policy/assignment audit coverage, richer connector diagnostics, MCP-side token issuance, broader DLP, enterprise provisioning, provider-backed repository validation/synchronization, live provider/deployment validation, cross-vendor conformance, and recovery evidence remain pending.
