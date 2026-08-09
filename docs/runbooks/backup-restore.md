# Backup and restore runbook

This runbook protects Bridge's canonical PostgreSQL state. It is an operator procedure, not evidence that a production backup service is already configured. Before a pilot, the deployment owner must attach dated evidence for backup retention, point-in-time recovery (PITR), and an isolated restore exercise.

## Current storage boundary

Bridge currently stores questions, decisions, specifications (including Markdown bodies), audit events, notifications, and outbox state in PostgreSQL. The current runtime does not write artifact objects to S3 or another object store. If object storage is introduced, enable encryption, versioning or an equivalent immutable recovery mechanism, lifecycle controls, and a separate restore exercise before treating it as durable.

## Production control checklist

Before serving pilot data, the deployment owner must verify and record:

- automated encrypted PostgreSQL backups are enabled;
- PITR is enabled and the provider reports a usable latest-restorable time;
- backup retention and the accepted recovery point/recovery time objectives are recorded in the deployment change;
- backup and restore permissions are separate from ordinary application credentials;
- backup failure and shrinking-restorable-window alerts have an owner;
- object-storage versioning and lifecycle protection are enabled if Bridge begins storing objects outside PostgreSQL;
- a restore has passed in an isolated environment from the same production configuration.

Do not place database URLs, provider credentials, snapshot identifiers containing customer information, or unredacted verifier output in this repository.

## Create a portable PostgreSQL backup

Managed-provider snapshots/PITR are the production mechanism. A custom-format `pg_dump` is useful as an additional portable exercise. Inject the following values through the operator's secret manager or shell environment; do not commit them:

```bash
export BRIDGE_SOURCE_DATABASE_URL='postgresql://...'
export BRIDGE_BACKUP_FILE='/secure/operator/path/bridge-restore-test.dump'

pg_dump \
  --dbname="$BRIDGE_SOURCE_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$BRIDGE_BACKUP_FILE"
```

Record the command version, start/end times, source environment, source revision, backup mechanism, and encrypted backup location in the private operations record. Never attach the dump to a GitHub issue or commit.

## Restore into an isolated database

Provision a new empty database with no application, MCP, or worker process connected. Never aim this procedure at a shared or production database. Use a restore-specific credential and keep outbound notification providers disabled.

```bash
export BRIDGE_RESTORE_DATABASE_URL='postgresql://.../bridge_restore_exercise'
export BRIDGE_BACKUP_FILE='/secure/operator/path/bridge-restore-test.dump'

pg_restore \
  --dbname="$BRIDGE_RESTORE_DATABASE_URL" \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$BRIDGE_BACKUP_FILE"
```

The target must already be empty. This runbook intentionally does not use `--clean`, `dropdb`, or database-owner credentials.

## Verify the restored state

Run the repository's read-only verifier from the same source revision as the backup:

```bash
export BRIDGE_RESTORE_DATABASE_URL='postgresql://.../bridge_restore_exercise'
pnpm restore:verify
```

If `DATABASE_URL` is also present, the verifier refuses to run when both URLs identify the same host, port, and database. The verifier issues only `SELECT` statements and reports:

- required Bridge tables and Drizzle migration history;
- row counts for the core records;
- SHA-256 integrity for every immutable artifact version without printing bodies;
- organization/project consistency across tenant-scoped records and delivery receipts;
- valid current/approved artifact-version pointers.

A zero exit status and `"passed": true` are necessary but not sufficient. With the worker and external delivery adapters still disabled, start an API instance against the isolated target and confirm:

```bash
curl --fail http://127.0.0.1:4000/health/live
curl --fail http://127.0.0.1:4000/health/ready
```

Then use read-only API/UI paths to sample projects, accepted decisions, approved specifications, audit history, and outbox counts. Do not accept decisions, approve specifications, replay outbox events, or start workers during the exercise.

## Evidence and completion

The private restore record must contain the exercise date, operators, source recovery point, isolated target, source revision, elapsed restore time, verifier result, sampled-record result, measured recovery point/recovery time, exceptions, and cleanup approval. It must not contain secrets, raw specification bodies, customer data, or full database URLs.

BRG-103 is not complete until production PITR evidence and one dated isolated restore record exist. Repository tests alone do not satisfy that operational acceptance criterion.

## Recovery activation

For a real recovery, declare an incident, stop Bridge writers and workers, choose the approved recovery point, restore to new infrastructure, run this verifier, and obtain incident-commander approval before switching traffic. Keep workers disabled until duplicate-delivery risk and outbox state have been reviewed. Prefer switching application connectivity to the verified database over modifying the failed database in place.
