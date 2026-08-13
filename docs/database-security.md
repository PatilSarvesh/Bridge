# PostgreSQL tenant isolation and database roles

Bridge uses application authorization and PostgreSQL row-level security (RLS) together. RLS is defense in depth; it does not replace membership, project-role, or human-approval checks.

## Runtime contract

- The API and MCP processes use a non-superuser PostgreSQL role with `NOBYPASSRLS`.
- Each application operation runs in a transaction and sets `bridge.organization_id` with transaction-local `set_config(..., true)` before accessing tenant data.
- The policies use `current_setting('bridge.organization_id', true)`. If no organization was set, protected tables return no rows and reject writes.
- Tenant scope cannot be changed by a nested repository transaction.
- RLS is enabled and forced on the protected tables, including for their owner. PostgreSQL superusers and roles carrying `BYPASSRLS` still bypass policies, so they must never be used by the API or MCP service.
- Readiness reports failure when an application connection can bypass RLS, or when a configured maintenance connection cannot bypass RLS.

The following bootstrap directory tables are deliberately outside RLS in this slice:

- `bridge_organizations`
- `bridge_principal_identities`
- `bridge_service_credentials`

OIDC and service-token resolution must find the organization before a tenant transaction can be established. These repositories expose bounded exact-key lookups; membership and project data are then loaded inside the resolved organization transaction. A future hardening slice may replace these lookups with security-definer functions or a separately permissioned identity directory. This exception means Bridge must not yet claim complete production tenant isolation.

## Role separation

Use three credentials in deployed environments:

| Role | RLS attribute | Used by | Purpose |
|---|---|---|---|
| `bridge_migrator` | Schema owner; no application traffic | Release migration job | Forward-only DDL and migration history |
| `bridge_runtime` | `NOBYPASSRLS`, non-superuser | API and optional MCP | Tenant-scoped business operations |
| `bridge_maintenance` | `BYPASSRLS`, non-superuser | Worker/restore/approved maintenance only | Cross-tenant queue and integrity work |

The exact role names may be changed by deployment, but the separation and attributes may not. Keep each credential in a different secret. Never place a migration or maintenance URL in `DATABASE_URL` for the API or MCP service.

An operator with PostgreSQL role-management authority can use a deployment-specific equivalent of:

```sql
create role bridge_migrator login nosuperuser nobypassrls;
create role bridge_runtime login nosuperuser nobypassrls;
create role bridge_maintenance login nosuperuser bypassrls;

grant connect on database bridge to bridge_runtime, bridge_maintenance;
grant usage on schema public to bridge_runtime, bridge_maintenance;
grant select, insert, update, delete on all tables in schema public
  to bridge_runtime, bridge_maintenance;

alter default privileges for role bridge_migrator in schema public
  grant select, insert, update, delete on tables to bridge_runtime, bridge_maintenance;
```

Create passwords or workload credentials through the deployment secret system rather than source-controlled SQL. The migration role must own the Bridge schema objects so it can apply forward-only migrations. Do not grant `TRUNCATE`, DDL, role administration, or membership in the migration/maintenance roles to `bridge_runtime`.

## Application and maintenance stores

Normal services use the default store:

```ts
createPostgresBridgeStore(process.env.DATABASE_URL!);
```

Only a cross-tenant worker or approved maintenance process may opt into the maintenance boundary:

```ts
createPostgresBridgeStore(process.env.BRIDGE_MAINTENANCE_DATABASE_URL!, {
  mode: "maintenance",
});
```

The maintenance option enables only explicitly maintenance-gated repository operations. It does not set a bypass parameter; PostgreSQL itself must authenticate the connection as the separately provisioned `BYPASSRLS` role.

The current worker package is handler-injected and is not yet wired to a live database process. That later deployment wiring must use `BRIDGE_MAINTENANCE_DATABASE_URL`, never the API URL.

## Restore verification

The restore verifier scans all organizations and therefore requires an isolated restored database plus a maintenance-capable connection. Set `BRIDGE_RESTORE_DATABASE_URL` to a non-production restore target authenticated as the maintenance role. The verifier remains read-only and still refuses an obvious same-target match with `DATABASE_URL`.

## Verification

Static tests verify that migration `0020_tenant_row_security.sql` enables and forces every expected policy and backfills idempotency ownership before making it non-null. The opt-in PostgreSQL integration test additionally verifies:

- every protected relation has both `relrowsecurity` and `relforcerowsecurity`;
- an unscoped non-bypass role sees no protected project rows;
- changing the transaction-local organization exposes only that organization's row;
- a scoped insert or update cannot target another organization;
- an application store cannot request maintenance scope.

Run the live test only against an isolated database:

```bash
BRIDGE_TEST_DATABASE_URL='postgresql://.../bridge_test' \
  pnpm --filter @bridge/database test
```

Foreign-key and uniqueness checks can reveal the existence of conflicting keys even with RLS. Bridge therefore continues to use opaque IDs, tenant-aware constraints, resource masking, and application authorization; RLS is not treated as the only isolation control.
