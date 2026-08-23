# Operational incident runbook

This runbook covers the first-response paths required for the Bridge pilot. Preserve evidence, keep human authority intact, and do not repair durable records with direct SQL. The web UI, CLI, REST API, and optional MCP adapter all share the REST/application policy boundary; an MCP outage must not block CLI, repository snapshot, or web workflows.

## Initial triage

1. Name an incident owner and record the start time, affected environment, source revision, and observed symptoms in the private incident system.
2. Check `GET /health/live`. Failure means the process or HTTP listener is unavailable.
3. Check `GET /health/ready`. A `503` means the repository dependency is unavailable; its body is intentionally sanitized.
4. Stop or scale down writers only when continued mutations could increase harm. Stop workers before a restore or when downstream deliveries may duplicate.
5. Preserve service, migration-job, worker, and provider logs without copying secrets or customer content into the repository.

`GET /health` remains a compatibility alias for liveness. It must not be used to decide whether a deployment is ready for traffic.

For repository adapter issues, ask the affected maintainer to run `bridge doctor` from the configured repository and inspect the project **Support** view. Doctor persists only bounded client/capability/MCP/check status metadata through REST; use the local CLI output and approved private incident records for details, and never copy URLs, secrets, repository content, or raw error text into Bridge documentation.

## Queue backlog or dead letters

Symptoms include growing ready work, expired processing leases, repeated failures, or dead-letter counts in `GET /v1/admin/projects/:projectId/outbox`.

1. Confirm API readiness and database capacity before increasing worker concurrency.
2. Inspect project-scoped status/type filters and delivery receipts. Never query or update the outbox directly to bypass tenant checks.
3. Separate transient provider failure, poison payload, invalid deployment configuration, and insufficient worker capacity.
4. For a provider outage, leave work durable and bound worker retries; do not replay continuously.
5. After correcting the cause, replay only failed/dead-letter events through `POST /v1/admin/outbox/:eventId/replay` with the last observed `expectedAttempts`. A conflict requires a fresh inspection.
6. Watch attempts, ready age, expired leases, and delivery results until the queue drains. Stable event/channel idempotency keys must be preserved.

Escalate when backlog age threatens the pilot objective, database saturation rises, or failures contain a payload/schema class not covered by the active worker. Record affected event counts and IDs, not payload bodies.

## Failed database migration

1. Keep the incompatible application revision out of service. Do not make API startup run migrations automatically.
2. Preserve the release-job output and identify the last entry in `drizzle.__drizzle_migrations` using a restricted operator session.
3. Compare the deployed source revision with the forward-only files and metadata under `packages/database/drizzle`.
4. Determine whether the failure occurred before any statement committed. Never assume a partially reported migration rolled back.
5. Prefer a reviewed forward-fix migration. Do not edit an already applied migration, run ad hoc repair SQL, or force the migration journal.
6. If data integrity is uncertain, keep writers stopped and restore to isolated infrastructure using [`backup-restore.md`](backup-restore.md). Switch traffic only after verification and approval.

Escalate immediately for destructive statements, constraint failures involving tenant scope, missing migration history, or any mismatch between database schema and migration metadata.

## Identity outage

OIDC is now an active dependency for authenticated web/API deployments. Symptoms include provider authorization/token failures, JWKS fetch or key-rotation errors, valid users receiving `UNAUTHENTICATED`, or a broad increase in `401` metrics. Readiness still checks the canonical repository only, so an identity outage may leave `/health/ready` green.

1. Never bypass authentication, enable the development principal header in production, or substitute a shared human/agent principal.
2. Confirm issuer/audience/client/callback configuration and provider status without printing client secrets, access tokens, cookies, authorization codes, or customer claims.
3. Stop protected writes if token signature, issuer, audience, expiry, organization, or membership cannot be verified. Do not trust roles copied from a token.
4. Distinguish provider failure from a Bridge directory problem: inspect only scoped membership status and external organization mapping through an approved operator path.
5. Preserve accepted decisions/specifications. If the approved deployment architecture provides a separate authenticated read-only continuity path, enable only that reviewed path; do not invent an incident-time bypass.
6. After recovery, validate login state/nonce, callback, `/v1/auth/me`, project visibility, one authorized action, one unauthorized cross-project action, logout, and a bearer-token request.
7. Review authentication failures by correlation ID and safe metrics/log fields. Record counts and configuration versions, never raw tokens or identity-provider responses.

Escalate immediately for suspected key/issuer compromise, unexpected organization mapping, disabled-member access, cross-tenant visibility, callback manipulation, or session-cookie leakage. Rotate affected provider/client/session secrets through deployment secret management and invalidate sessions according to the provider incident plan.

## Notification provider outage

In-app notifications and durable outbox intents remain canonical when an email/team provider is unavailable. Provider failure should degrade delivery, not make the core API unready while PostgreSQL remains usable.

1. Confirm questions, decisions, specifications, and in-app notifications remain available in the web UI/API.
2. Inspect outbox and delivery state per project. Avoid exposing recipient destinations; Bridge stores only scoped destination hashes.
3. Disable or bound provider calls if they amplify errors, throttling, or cost. Keep unsent intents durable.
4. Tell pilot users through an approved independent channel to use the Bridge inbox/UI while external delivery is degraded.
5. After provider recovery, resume the worker gradually and use existing stable idempotency keys. Replay only failed/dead-letter work after inspection.
6. Validate delivery receipts and queue age without marking successful records manually.

The current repository includes provider-neutral immediate/digest email seams and a deployable Slack outbox worker, but no live email sender/recipient directory, configured digest runtime composition, Slack workspace installation, or production provider credentials. Deployment owners must extend this procedure with the selected maintenance connection, secret provisioning, workspace evidence, and provider failure-window results.

## Closeout

Confirm liveness/readiness, queue stability, normal read/write policy behavior, and any provider recovery. Record timeline, cause, scope, remediation, customer communication, and follow-up owners in the private incident system. Convert code fixes into reviewed tests and forward migrations; keep secrets and customer data out of issues and repository documentation.
