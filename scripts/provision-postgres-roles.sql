\set ON_ERROR_STOP on

-- This script is intentionally separate from Bridge migrations. It requires a
-- role-management-capable operator connection and never stores passwords.
-- Override any of these names with psql -v key=value when deploying.
\if :{?bridge_migrator_role}
\else
\set bridge_migrator_role bridge_migrator
\endif
\if :{?bridge_runtime_role}
\else
\set bridge_runtime_role bridge_runtime
\endif
\if :{?bridge_maintenance_role}
\else
\set bridge_maintenance_role bridge_maintenance
\endif

-- Refuse an ambiguous role mapping before changing role state.
SELECT CASE
  WHEN :'bridge_migrator_role' <> :'bridge_runtime_role'
   AND :'bridge_migrator_role' <> :'bridge_maintenance_role'
   AND :'bridge_runtime_role' <> :'bridge_maintenance_role'
  THEN 'SELECT true'
  ELSE 'SELECT 1 / 0'
END;
\gexec

-- Create missing roles without passwords. Passwords/workload credentials are
-- provisioned by the deployment secret system, never by this repository.
SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',
  :'bridge_migrator_role'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'bridge_migrator_role'
);
\gexec
SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',
  :'bridge_runtime_role'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'bridge_runtime_role'
);
\gexec
SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER BYPASSRLS NOINHERIT',
  :'bridge_maintenance_role'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'bridge_maintenance_role'
);
\gexec

-- Reconcile the security attributes on every run. This deliberately demotes
-- an accidentally over-privileged role instead of silently accepting it.
SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',
  :'bridge_migrator_role'
);
\gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',
  :'bridge_runtime_role'
);
\gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER BYPASSRLS NOINHERIT',
  :'bridge_maintenance_role'
);
\gexec

-- Grant only the database/schema entry points needed by the two service roles.
SELECT format(
  'GRANT CONNECT ON DATABASE %I TO %I, %I',
  current_database(),
  :'bridge_runtime_role',
  :'bridge_maintenance_role'
);
\gexec
SELECT format(
  'GRANT USAGE ON SCHEMA public TO %I, %I',
  :'bridge_runtime_role',
  :'bridge_maintenance_role'
);
\gexec
SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I, %I',
  :'bridge_runtime_role',
  :'bridge_maintenance_role'
);
\gexec
SELECT format(
  'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I, %I',
  :'bridge_runtime_role',
  :'bridge_maintenance_role'
);
\gexec

-- Bootstrap tables are intentionally outside RLS, so runtime receives DML for
-- the application workflows but never receives direct SELECT on their rows.
SELECT format(
  'REVOKE ALL ON TABLE public.%I FROM PUBLIC',
  table_name
)
FROM (VALUES
  ('bridge_organizations'),
  ('bridge_principal_identities'),
  ('bridge_service_credentials')
) AS bootstrap_tables(table_name);
\gexec
SELECT format(
  'REVOKE SELECT ON TABLE public.%I FROM %I',
  table_name,
  :'bridge_runtime_role'
)
FROM (VALUES
  ('bridge_organizations'),
  ('bridge_principal_identities'),
  ('bridge_service_credentials')
) AS bootstrap_tables(table_name);
\gexec

-- The runtime role reaches bootstrap data only through the six bounded
-- security-definer functions created by migration 0021.
SELECT format(
  'GRANT EXECUTE ON FUNCTION public.%s TO %I',
  function_signature,
  :'bridge_runtime_role'
)
FROM (VALUES
  ('bridge_lookup_principal_identity_by_oidc(text, text)'),
  ('bridge_lookup_organization_by_external_id(text)'),
  ('bridge_lookup_service_token(text)'),
  ('bridge_get_principal_identity(text)'),
  ('bridge_get_service_credential(text)'),
  ('bridge_list_service_credentials(text)')
) AS lookup_functions(function_signature);
\gexec

-- Keep future objects created by the migration role aligned with the table
-- contract. Default privileges cannot target only the three bootstrap names,
-- so the explicit SELECT revocation above must be re-applied after any grant
-- reconciliation job.
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I, %I',
  :'bridge_migrator_role',
  :'bridge_runtime_role',
  :'bridge_maintenance_role'
);
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I, %I',
  :'bridge_migrator_role',
  :'bridge_runtime_role',
  :'bridge_maintenance_role'
);
\gexec

-- Fail closed if the resulting catalog state does not match the contract.
SELECT CASE
  WHEN r.migrator_ok = 1 AND r.runtime_ok = 1 AND r.maintenance_ok = 1
  THEN 'SELECT true'
  ELSE 'SELECT 1 / 0'
END
FROM (
  SELECT
    count(*) FILTER (
      WHERE rolname = :'bridge_migrator_role' AND NOT rolsuper AND NOT rolbypassrls
    ) AS migrator_ok,
    count(*) FILTER (
      WHERE rolname = :'bridge_runtime_role' AND NOT rolsuper AND NOT rolbypassrls
    ) AS runtime_ok,
    count(*) FILTER (
      WHERE rolname = :'bridge_maintenance_role' AND NOT rolsuper AND rolbypassrls
    ) AS maintenance_ok
  FROM pg_roles
  WHERE rolname IN (
    :'bridge_migrator_role',
    :'bridge_runtime_role',
    :'bridge_maintenance_role'
  )
) AS r;
\gexec

SELECT CASE
  WHEN bool_and(NOT has_table_privilege(:'bridge_runtime_role', format('public.%I', table_name), 'SELECT'))
  THEN 'SELECT true'
  ELSE 'SELECT 1 / 0'
END
FROM (VALUES
  ('bridge_organizations'),
  ('bridge_principal_identities'),
  ('bridge_service_credentials')
) AS bootstrap_tables(table_name);
\gexec

SELECT CASE
  WHEN bool_and(has_function_privilege(:'bridge_runtime_role', format('public.%s', function_signature), 'EXECUTE'))
  THEN 'SELECT true'
  ELSE 'SELECT 1 / 0'
END
FROM (VALUES
  ('bridge_lookup_principal_identity_by_oidc(text, text)'),
  ('bridge_lookup_organization_by_external_id(text)'),
  ('bridge_lookup_service_token(text)'),
  ('bridge_get_principal_identity(text)'),
  ('bridge_get_service_credential(text)'),
  ('bridge_list_service_credentials(text)')
) AS lookup_functions(function_signature);
\gexec

\echo Bridge PostgreSQL roles and grants are reconciled and verified.
