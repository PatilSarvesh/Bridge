# Bridge Pilot Decisions

| Field | Value |
|---|---|
| Status | Approved working decisions |
| Version | 1.1 |
| Decision date | 2026-08-07 |
| Authority | Founder delegated pilot decisions to Codex |
| Review point | After the first two design-partner pilots |
| Related documents | [PRD](./bridge-prd.md), [Technical Architecture](./technical-architecture.md), [MVP Backlog](./mvp-backlog.md) |

## 1. Decision policy

These decisions remove ambiguity from the MVP backlog. They are intentionally optimized for a fast but credible multi-tenant pilot. They may be superseded using evidence from implementation spikes or design-partner usage, but the team should not reopen them during ordinary refinement without new evidence.

## 2. Product decisions

### PILOT-001 — Product name

**Decision:** Use **Bridge** as the product and repository name throughout the private pilot. Complete trademark, company-name, and domain review before a public launch.

**Rationale:** The name directly communicates the product's role between agents, people, decisions, and sessions. A private pilot does not justify delaying validation for a naming exercise.

### PILOT-002 — Initial customer profile

**Decision:** Target software organizations with 10–250 contributors that use at least two coding-agent clients and have cross-role architecture, product, QA, data, or security decisions.

**Rationale:** This segment experiences both session fragmentation and decision-authority mismatch while remaining reachable for a design-partner pilot.

### PILOT-003 — Pilot commercial model

**Decision:** Run the first two to five design-partner pilots at no software charge in exchange for weekly workflow reviews, anonymized product metrics, and permission to use non-confidential learnings. Do not promise permanent free usage.

**Rationale:** The first objective is validating decision reuse, routing quality, and reduced rework—not optimizing billing.

### PILOT-004 — Initial agent clients

**Decision:** Support **Codex** first and **Claude Code** second.

**Rationale:** Both currently support remote HTTP MCP servers with OAuth, making them suitable for testing a vendor-neutral Bridge contract. Codex is the first end-to-end conformance client; Claude Code is the cross-vendor proof.

**Implementation consequence:**

- Codex adapter generates project-scoped `.codex/config.toml` and Bridge instructions.
- Claude Code adapter generates project-scoped `.mcp.json` and Bridge instructions.
- Conformance tests exercise the same MCP tool schemas and authorization scopes against both clients.

**Evidence:**

- [OpenAI Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)

### PILOT-005 — Session continuation

**Decision:** Promise durable continuation, not universal automatic session resumption, in the MVP.

**Rationale:** A later authenticated run can always retrieve the accepted answer and context. Exact session resume varies by client and should not be a cross-vendor MVP dependency.

**MVP behavior:** Bridge notifies the operator when a blocker is resolved and provides the run ID, question ID, and resume-context key. Vendor-specific auto-resume is a later adapter capability.

### PILOT-006 — First-class artifact types

**Decision:** Support four artifact types in the MVP:

1. Product requirements document
2. Architecture decision record
3. API contract
4. Test plan

All other content may be uploaded as a generic document but does not receive specialized metadata during the pilot.

### PILOT-007 — Human authority

**Decision:** Only authenticated human principals can accept answers, approve specifications, supersede decisions, or grant protected exceptions. Agent and CI principals cannot satisfy a human approval requirement.

**Rationale:** Bridge exists to make decision ownership explicit. Allowing agents to approve their own recommendations would undermine its central value.

### PILOT-008 — Protected categories

**Decision:** The following categories always block affected work and require explicit human approval:

| Category | Required authority |
|---|---|
| Authentication, authorization, or access-control change | Component owner plus security reviewer |
| Secret, credential, or key handling | Security reviewer |
| PII, privacy, or regulated-data handling | Data/privacy owner plus security reviewer |
| Production data deletion or destructive migration | Component owner plus operations/SRE reviewer |
| Production schema migration with irreversible impact | Component owner plus database/architecture reviewer |
| Public API breaking change | Product owner plus architecture owner |
| Security exception or disabled control | Security owner |
| Legal or regulatory interpretation | Authorized legal/compliance owner |
| New recurring infrastructure spend above project threshold | Project owner plus finance/operations approver |

Administrators may configure stricter policy but cannot silently weaken these defaults during the pilot.

### PILOT-009 — Review and expiry defaults

**Decision:**

- Ordinary active decisions: review every 180 days.
- Security, privacy, authentication, and compliance decisions: review every 90 days.
- Low-risk assumptions: expire after 7 days by default and may not exceed 30 days.
- Blocking protected questions: escalation begins after 4 working hours.
- Other blocking questions: escalation begins after 1 business day.
- Non-blocking questions: include in a daily digest unless explicitly urgent.

### PILOT-010 — External guests

**Decision:** Do not support external guests in the MVP. Every human must be an authenticated member of the organization.

**Rationale:** Guest access materially expands authorization, information-disclosure, and lifecycle complexity without proving the central agent-decision loop.

### PILOT-011 — Raw conversations and model reasoning

**Decision:** Do not capture complete agent sessions, private chain-of-thought, or raw prompts by default. Store structured task summaries, questions, stated rationales, decisions, assumptions, artifacts, tool events, and external links.

### PILOT-012 — Source-code retention

**Decision:** Bridge does not retain repository source code during the MVP. Impact analysis uses repository, component, file path, branch, commit, pull-request, and work-item metadata supplied by adapters or integrations.

## 3. Integration decisions

### PILOT-013 — Human notification channels

**Decision:** Provide in-app notifications, email through Amazon SES, and Slack as the first team-channel integration.

**Rationale:** In-app provides durable state, email provides a universal fallback, and Slack is the first collaborative notification surface. Final protected acceptance remains in Bridge.

### PILOT-014 — Source-control integration

**Decision:** GitHub is the first source-control and work-link integration. Implement it as a GitHub App with read-only repository metadata and pull-request access initially. Do not request source-content access for the MVP.

**Rationale:** GitHub links decisions to issues, commits, and pull requests while preserving the product's no-source-retention boundary.

### PILOT-015 — Work-item integration

**Decision:** Use GitHub Issues for the first pilot work-item integration. Defer Linear and Jira until the decision loop is validated.

### PILOT-016 — Repository configuration

**Decision:** Commit non-secret canonical configuration under `.bridge/`. Generate client-specific project configuration with a dry-run and safe merge.

Files intended for version control:

```text
.bridge/project.yaml
.bridge/roles.yaml
.bridge/policies.yaml
.bridge/ownership.yaml
.codex/config.toml
.mcp.json
```

Credentials, OAuth tokens, and machine-specific state remain in the operating-system keychain or ignored local storage.

### PILOT-016A — MCP-independent operation

**Decision:** MCP is an optional Bridge adapter, not an MVP prerequisite. The CLI must provide the complete question-to-decision loop, and repository synchronization must make approved context available as ordinary files when agent-initiated network access is prohibited.

**Supported capability levels:**

1. MCP tools over remote HTTP.
2. CLI commands executed by an agent with terminal access.
3. Approved CI or operator synchronization into `.bridge/context.md` and JSON snapshots.
4. Manual web UI exchange when no automated integration is permitted.

CLI and MCP call the same API and application policies. Repository snapshots include decision IDs, provenance, generation time, and the context snapshot ID; local file edits never create approval.

## 4. Technical decisions

### PILOT-017 — Application architecture

**Decision:** Build a TypeScript modular monolith in a pnpm/Turborepo monorepo with separately runnable web, API, MCP, worker, and CLI applications.

**Stack:**

| Concern | Decision |
|---|---|
| Web | Next.js with React and accessible server-rendered application routes |
| API | Fastify with schema-first REST endpoints |
| MCP | TypeScript MCP SDK over Streamable HTTP |
| CLI | Node.js/TypeScript npm package |
| Data access | Drizzle ORM plus reviewed SQL migrations |
| Database | PostgreSQL with row-level security |
| Queue | pg-boss backed by PostgreSQL |
| Object storage | Amazon S3 |
| Validation/contracts | JSON Schema-compatible TypeScript schemas shared across transports |
| Testing | Unit, PostgreSQL integration, REST/MCP contract, and Playwright end-to-end tests |

**Rationale:** One language and shared contracts reduce coordination cost while explicit application boundaries preserve future scaling options.

### PILOT-018 — Hosting

**Decision:** Ship the hosted pilot in AWS `ap-south-1` using:

- ECS Fargate for web, API, MCP, and worker processes
- Application Load Balancer for HTTP ingress
- RDS PostgreSQL with automated backups and point-in-time recovery
- S3 for artifact objects
- SES for email
- Secrets Manager and KMS for credentials and encryption keys
- CloudWatch plus OpenTelemetry for logs, metrics, and traces

Use one primary region during the pilot. Add regional deployment or data residency only after customer requirements justify it.

### PILOT-019 — Identity and OAuth (reopened)

**Decision:** On 2026-08-10 the founder explicitly reopened authentication and organization scope. Implement the Auth0-compatible OIDC web/API foundation while retaining fixed principals only as an explicit non-production development mode.

The first slice includes durable organizations, OIDC identities, active/disabled organization memberships, project memberships, project-scoped role resolution, browser Authorization Code with PKCE, and API bearer validation. Initial organization administration is an operator-controlled environment bootstrap. Self-service invitations, CLI login, standalone MCP OAuth, service scopes, and enterprise provisioning remain later slices.

**Flow decisions:**

- Web: Authorization Code flow.
- CLI: Authorization Code with PKCE and a localhost callback; do not use Device Authorization Flow for organization-scoped login.
- MCP: OAuth authorization with protected-resource metadata and scoped Bridge API tokens.
- CI: Client Credentials using a dedicated service identity and narrow project scopes.
- Enterprise federation: Auth0 connection to customer identity providers when required.

**Rationale:** Auth0 provides standards-aligned OIDC/OAuth behavior without making Bridge an authorization server. Authority remains in Bridge memberships rather than token role claims. Auth0 Device Authorization Flow has organization limitations, so the future CLI design retains PKCE with a local callback.

**Evidence:**

- [Auth0 authorization for MCP servers](https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server)
- [Auth0 Organizations overview](https://auth0.com/docs/manage-users/organizations/organizations-overview)

### PILOT-020 — Search and retrieval

**Decision:** Use PostgreSQL full-text search, trigram similarity, explicit relationships, and deterministic weighted ranking. Do not introduce a vector database in the MVP.

**Review trigger:** Evaluate embeddings only when a labeled pilot dataset shows unacceptable retrieval recall after metadata and full-text tuning.

### PILOT-021 — Policy engine

**Decision:** Implement a limited declarative Bridge policy schema evaluated in application code. Do not add a general embedded policy language in the MVP.

**Rationale:** The pilot needs explainable risk and approval rules, not an unrestricted policy programming platform.

### PILOT-022 — Artifact storage threshold

**Decision:** Store Markdown artifact bodies up to 256 KiB in PostgreSQL. Store larger bodies and all binary attachments in S3. Every body receives a content hash and immutable version record.

### PILOT-023 — Deployment model

**Decision:** Offer hosted-only deployment for the private pilot. Design tenant isolation and infrastructure interfaces so a dedicated or self-hosted enterprise deployment remains possible later, but do not build it now.

## 5. UX decisions

### PILOT-024 — Navigation

**Decision:** The initial application uses six primary work areas:

1. Inbox
2. Questions
3. Decisions
4. Specifications
5. Assumptions
6. Agent Runs

Administration sits behind project and organization settings rather than occupying primary navigation.

### PILOT-025 — Default landing page

**Decision:** Open on **My Inbox**, not a dashboard. The top of the queue contains protected, blocking, overdue, and directly assigned items.

**Rationale:** The first user job is taking accountable action, not monitoring vanity metrics.

### PILOT-026 — Question interaction

**Decision:** Use one focused question-detail surface with:

- Context and impact
- Options and trade-offs
- Agent recommendation clearly labeled as advisory
- Decision owner and required reviewers
- Discussion
- Related work
- Accept action requiring rationale

Do not use a chat-first layout or hide acceptance inside discussion.

### PILOT-027 — Visual direction

**Decision:** Use a calm, enterprise collaboration style with neutral surfaces, strong information hierarchy, restrained blue for actions, amber/red only for risk, and green only for accepted states. Optimize for dense readable work rather than a consumer chatbot appearance.

## 6. Consequences for the backlog

The following items are no longer blocked by founder input:

- BRG-001 — Pilot selections are resolved by this document.
- BRG-010, BRG-013, BRG-060 — Deferred; organization onboarding and authentication are outside the active implementation scope.
- BRG-052, BRG-062 — Codex is the first MCP/adapter client; Claude Code is second.
- BRG-092 — Amazon SES is the email provider.
- BRG-093 — Slack is the pilot team channel.
- BRG-125 and BRG-126 — GitHub is selected; GitHub Issues serves as the initial work-item source.

## 7. Review triggers

Revisit these decisions only if one of the following occurs:

- A pilot customer cannot use the hosted AWS region for legal or security reasons.
- Codex or Claude Code cannot complete the conformance workflow using the selected OAuth design.
- Auth0 cannot meet required MCP client-registration or organization semantics in an implementation spike.
- PostgreSQL retrieval fails agreed relevance tests on the pilot corpus.
- Slack is not used by either selected design partner.
- GitHub cannot provide sufficient metadata without source-content permissions.
- Operating cost or team expertise makes the selected stack materially slower than an alternative.
