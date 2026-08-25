# PostgreSQL tenant isolation and database roles

Bridge uses application authorization and PostgreSQL row-level security (RLS) together. RLS is defense in depth; it does not replace membership, project-role, or human-approval checks.

## Runtime contract

- The API and MCP processes use a non-superuser PostgreSQL role with `NOBYPASSRLS`.
- Each application operation runs in a transaction and sets `bridge.organization_id` with transaction-local `set_config(..., true)` before accessing tenant data.
- The policies use `current_setting('bridge.organization_id', true)`. If no organization was set, protected tables return no rows and reject writes.
- Tenant scope cannot be changed by a nested repository transaction.
- RLS is enabled and forced on the protected tables, including for their owner. PostgreSQL superusers and roles carrying `BYPASSRLS` still bypass policies, so they must never be used by the API or MCP service.
- Readiness reports failure when an application connection can bypass RLS, or when a configured maintenance connection cannot bypass RLS.

The following bootstrap directory tables remain outside RLS because authentication must resolve a
tenant before a tenant transaction can be established:

- `bridge_organizations`
- `bridge_principal_identities`
- `bridge_service_credentials`

The current 27-table protected tenant/project set also includes `bridge_adapter_diagnostics`,
`bridge_project_repositories`, `bridge_project_ownership_configurations`,
`bridge_project_policy_configurations`, `bridge_notification_preferences`, and
`bridge_github_pull_requests`, `bridge_github_issues`, `bridge_directory_groups`, and
`bridge_directory_group_members`. These relations were added or corrected by forward-only migrations
`0024_amazing_blindfold.sql` through `0027_vengeful_lady_ursula.sql`,
`0041_force_notification_preferences_rls.sql`, `0042_even_wallop.sql`, and
`0043_misty_dragon_man.sql`, `0044_marvelous_lockjaw.sql`, and
`0045_short_mercury.sql`; they use the same forced
RLS policy boundary as the original tenant relations.

OIDC and service-token resolution use the bounded security-definer functions from migration
`0021_bootstrap_directory_security.sql`. The functions use a fixed `search_path`, return only
exact-key results, and are not executable by `PUBLIC`. Tenant-scoped identity and credential
lookups additionally require the transaction-local organization setting; service-token and OIDC
bootstrap lookups are the only intentionally pre-tenant operations. The application role must
never receive direct `SELECT` on these three tables.

## Role separation

Use three credentials in deployed environments:

| Role | RLS attribute | Used by | Purpose |
|---|---|---|---|
| `bridge_migrator` | Schema owner; no application traffic | Release migration job | Forward-only DDL and migration history |
| `bridge_runtime` | `NOBYPASSRLS`, non-superuser | API and optional MCP | Tenant-scoped business operations |
| `bridge_maintenance` | `BYPASSRLS`, non-superuser | Worker/restore/approved maintenance only | Cross-tenant queue and integrity work |

The exact role names may be changed by deployment, but the separation and attributes may not. Keep each credential in a different secret. Never place a migration or maintenance URL in `DATABASE_URL` for the API or MCP service.

Use the repository's idempotent role/grant reconciliation script with a separate
role-management-capable operator connection. It creates missing roles without
passwords, reconciles `NOSUPERUSER`/`NOBYPASSRLS`/`BYPASSRLS`, grants the required
database and table capabilities, grants the six bootstrap lookup functions only
to the runtime role, and verifies the resulting catalog state:

```bash
psql "$BRIDGE_DATABASE_ADMIN_URL" \
  -v bridge_migrator_role=bridge_migrator \
  -v bridge_runtime_role=bridge_runtime \
  -v bridge_maintenance_role=bridge_maintenance \
  -f scripts/provision-postgres-roles.sql
```

`BRIDGE_DATABASE_ADMIN_URL` is an operator-only connection string and must never
be used as `DATABASE_URL`, `BRIDGE_MAINTENANCE_DATABASE_URL`, or an application
secret. The script never handles passwords; provision each role's workload
credential through the deployment secret system. Run it after migrations so the
`0021_bootstrap_directory_security.sql` functions exist. The explicit bootstrap
table `SELECT` revocation must be re-applied after any grant reconciliation job;
default privileges cannot target only those three table names.

Create passwords or workload credentials through the deployment secret system rather than source-controlled SQL. The migration role must own the Bridge schema objects so it can apply forward-only migrations. Do not grant `TRUNCATE`, DDL, role administration, or membership in the migration/maintenance roles to `bridge_runtime`.

## Application and maintenance stores

Normal services use the default store:

```ts
createPostgresBridgeStore(process.env.DATABASE_URL!);
```

Only a cross-tenant worker or approved maintenance process may opt into the maintenance boundary:

```ts
createPostgresBridgeStore(process.env.BRIDGE_WORKER_DATABASE_URL!, {
  mode: "maintenance",
});
```

The maintenance option enables only explicitly maintenance-gated repository operations. It does not set a bypass parameter; PostgreSQL itself must authenticate the connection as the separately provisioned `BYPASSRLS` role.

The worker package now provides a bounded Slack outbox daemon plus maintenance-gated assumption expiry, one-time overdue blocking-question escalation, and deferred-email digest claim cycles. It requires `BRIDGE_WORKER_DATABASE_URL`, opens the store with `mode: "maintenance"`, and never falls back to `DATABASE_URL`; the deployment must provision that value from the separate maintenance role's secret. Escalation writes only a durable timestamp, audit record, and privacy-bounded notification/outbox pointer; digest claims persist only due/lease timestamps and privacy-minimized delivery metadata. Live addresses still come from the injected directory. The separate process-local metrics listener defaults to loopback, exposes no database URL or tenant/content labels, and must remain behind the deployment's monitoring-network boundary if its host is overridden.

## Restore verification

The restore verifier scans all organizations and therefore requires an isolated restored database plus a maintenance-capable connection. Set `BRIDGE_RESTORE_DATABASE_URL` to a non-production restore target authenticated as the maintenance role. The verifier remains read-only and still refuses an obvious same-target match with `DATABASE_URL`.

## Verification

Static tests verify that migration `0020_tenant_row_security.sql` enables and forces every original expected policy, migrations `0024_amazing_blindfold.sql` through `0027_vengeful_lady_ursula.sql` add and force the adapter-diagnostic, repository, ownership-configuration, and policy-configuration policies, required backfills precede non-null constraints, and migration `0028_cold_tombstone.sql` adds bounded required-owner-role provenance. They also verify that migration `0021_bootstrap_directory_security.sql` creates only the approved security-definer directory lookups and revokes ambient table/function access from `PUBLIC`, and that `scripts/provision-postgres-roles.sql` preserves the role, grant, and no-password contract. The opt-in PostgreSQL integration test additionally verifies:

- every protected relation has both `relrowsecurity` and `relforcerowsecurity`;
- an unscoped non-bypass role sees no protected project rows;
- changing the transaction-local organization exposes only that organization's row;
- a scoped insert or update cannot target another organization;
- an application store cannot request maintenance scope;
- the runtime role cannot directly read bootstrap directory tables but can execute the explicitly granted lookup functions.

Run the live test only against an isolated database:

```bash
BRIDGE_TEST_DATABASE_URL='postgresql://.../bridge_test' \
  pnpm --filter @bridge/database test
```

Foreign-key and uniqueness checks can reveal the existence of conflicting keys even with RLS. Bridge therefore continues to use opaque IDs, tenant-aware constraints, resource masking, and application authorization; RLS is not treated as the only isolation control.
