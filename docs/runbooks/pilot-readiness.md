# Controlled pilot readiness runbook

This runbook is the repository-side execution guide for BRG-112. It creates a repeatable evidence review without claiming that AWS, PostgreSQL, OIDC, Slack, SES, staging, backups, or incident tooling are configured. The pilot decision is **not ready** until the deployment owner attaches the external evidence listed here in the private operations record.

## Readiness report

The machine-readable checklist is [`config/pilot-readiness.json`](../../config/pilot-readiness.json). Generate a bounded report locally:

```bash
pnpm pilot:readiness
pnpm pilot:readiness -- --json
```

The default report is informational and exits successfully when the manifest is valid. Use the strict form in a deployment gate only after the private evidence record has been updated:

```bash
pnpm pilot:readiness -- --strict
```

Strict mode returns exit code `10` while any criterion still requires external evidence. The command reads one repository file, performs no network calls, never opens a database connection, never starts a worker, and never changes repository state. `repository_verified` means repeatable local/CI evidence; it is not equivalent to `complete` when a criterion also requires external evidence.

## Review order

Run the repository checks first, then attach deployment evidence in the same order as the manifest:

1. Run `CI=true pnpm check` and record the source revision and result. This covers typecheck, workspace tests, production builds, packaged CLI smoke, and the readiness-manifest regression. The PostgreSQL integration path is valid only when CI or an operator supplies an explicitly isolated `BRIDGE_TEST_DATABASE_URL`.
2. In an isolated staging environment, run the fresh-project journey from the README: initialize a repository, start an agent run, retrieve context, create a blocking question, accept the answer as a human, and verify a linked later run retrieves the accepted decision. Run `bridge conformance --task ... --run-id ...` and preserve only bounded result metadata in the private record.
3. Review the authorization and tenant-isolation evidence in [`authorization-matrix.md`](../authorization-matrix.md). If live PostgreSQL is available, run the integration suite against an isolated database and attach the migration/RLS/role evidence. Never use a shared or production database for this check.
4. Exercise recovery and delivery degradation separately. Restore a backup into new isolated infrastructure with writers, MCP, workers, and external providers disabled; run the read-only [`restore:verify`](./backup-restore.md#verify-the-restored-state) procedure; then sample liveness, readiness, approved decisions, specifications, audit history, and outbox state. For notification failure, use the injected worker/provider failure tests and a staging provider failure window. Do not manually mark deliveries processed or accept/approve records during recovery verification.
5. Give pilot users the onboarding path in the README and explicitly explain that MCP is optional, repository/CLI snapshots are the fallback, and Bridge does not automatically resume a vendor session. A human must review and accept decisions; a later agent session must explicitly start a linked continuation run.
6. Assign a service owner, product authority owner, incident owner, escalation channel, and feedback intake before the pilot starts. Record names and channels only in the private operations system; do not add personal data, credentials, customer data, or incident transcripts to this repository.

## Evidence record template

The private record should contain, for each criterion:

- criterion ID and final status (`complete` only after all required external evidence exists);
- source revision, environment name, review date, operator, and command/result summary;
- links to the private staging, security, backup/restore, provider-failure, and ownership records;
- exceptions, risk acceptance, rollback owner, and next review date.

Do not store database URLs, credentials, access tokens, provider webhook values, raw agent transcripts, specification bodies, customer data, or unredacted logs in the evidence record or repository. Store only bounded metadata and links to the approved private system.

## Pilot go/no-go boundary

The pilot may proceed only when all six BRG-112 criteria are marked `complete` in the private record and the product authority owner has reviewed the limitations. A repository-green check is necessary but insufficient. In particular:

- production OIDC configuration and membership behavior still need live validation;
- RLS, PostgreSQL role separation, and cross-tenant behavior still need live deployment evidence;
- PITR retention and an isolated restore exercise are deployment responsibilities;
- SES/Slack installation, provider secrets, worker scheduling, and failure-window behavior are deployment responsibilities;
- service objectives require a real metrics backend, worker export, alert routes, and pilot calibration.

## Rollback and incident response

If readiness evidence fails or a pilot incident occurs, keep REST canonical and preserve the CLI, repository-snapshot, and web fallback paths. Stop workers before restore or when downstream duplication is possible; stop writers only when continued mutations increase harm. Do not bypass human approval, enable fixed development principals in production, repair records with direct SQL, or replay outbox work without the audited REST command and last observed attempt version. Follow [`incidents.md`](./incidents.md) and [`backup-restore.md`](./backup-restore.md), and record the timeline and owners privately.

## Pilot onboarding

The minimum briefing should cover:

- what Bridge stores: structured questions, decisions, assumptions, specifications, provenance, and bounded lifecycle metadata—not raw sessions or private reasoning;
- what Bridge does not guarantee: universal interception of vendor-native clarification UI or automatic resumption of an exact vendor session;
- how humans retain authority: agents may recommend and draft, while only authorized humans accept decisions, approve specifications, or override protected review requirements;
- how to operate without MCP: use the REST-backed CLI and repository snapshots, with the web UI as the human approval surface;
- how to report an issue: use the assigned private incident/feedback channel and include only correlation IDs, bounded record IDs, source revision, and safe symptoms.

The onboarding owner should collect acknowledgement outside the repository before granting pilot access.

## Ownership and response

The deployment owner assigns the service owner, product authority owner, security reviewer, incident commander, and feedback coordinator. The service owner reviews health, queue, provider, and objective evidence; the product authority owner decides whether product limitations are acceptable; the security reviewer reviews tenant/approval evidence; and the incident commander controls recovery and rollback. The assigned people must use the existing incident runbook and keep their records in the approved private system.
