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

An operator with PostgreSQL role-management authority can use a deployment-specific equivalent of:

```sql
create role bridge_migrator login nosuperuser nobypassrls;
create role bridge_runtime login nosuperuser nobypassrls;
create role bridge_maintenance login nosuperuser bypassrls;

grant connect on database bridge to bridge_runtime, bridge_maintenance;
grant usage on schema public to bridge_runtime, bridge_maintenance;
grant select, insert, update, delete on all tables in schema public
  to bridge_runtime, bridge_maintenance;

revoke select on table
  public.bridge_organizations,
  public.bridge_principal_identities,
  public.bridge_service_credentials
from bridge_runtime;

grant execute on function public.bridge_lookup_principal_identity_by_oidc(text, text) to bridge_runtime;
grant execute on function public.bridge_lookup_organization_by_external_id(text) to bridge_runtime;
grant execute on function public.bridge_lookup_service_token(text) to bridge_runtime;
grant execute on function public.bridge_get_principal_identity(text) to bridge_runtime;
grant execute on function public.bridge_get_service_credential(text) to bridge_runtime;
grant execute on function public.bridge_list_service_credentials(text) to bridge_runtime;

alter default privileges for role bridge_migrator in schema public
  grant select, insert, update, delete on tables to bridge_runtime, bridge_maintenance;
```

Re-apply the explicit bootstrap-table `SELECT` revocation after any role/grant
reconciliation job; default privileges cannot target only these three table names.

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

Static tests verify that migration `0020_tenant_row_security.sql` enables and forces every expected policy and backfills idempotency ownership before making it non-null. They also verify that migration `0021_bootstrap_directory_security.sql` creates only the approved security-definer directory lookups and revokes ambient table/function access from `PUBLIC`. The opt-in PostgreSQL integration test additionally verifies:

- every protected relation has both `relrowsecurity` and `relforcerowsecurity`;
- an unscoped non-bypass role sees no protected project rows;
- changing the transaction-local organization exposes only that organization's row;
- a scoped insert or update cannot target another organization;
- an application store cannot request maintenance scope.
- the runtime role cannot directly read bootstrap directory tables but can execute the explicitly granted lookup functions.

Run the live test only against an isolated database:

```bash
BRIDGE_TEST_DATABASE_URL='postgresql://.../bridge_test' \
  pnpm --filter @bridge/database test
```

Foreign-key and uniqueness checks can reveal the existence of conflicting keys even with RLS. Bridge therefore continues to use opaque IDs, tenant-aware constraints, resource masking, and application authorization; RLS is not treated as the only isolation control.
