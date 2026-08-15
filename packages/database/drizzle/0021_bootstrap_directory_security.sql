-- Bootstrap directory lookups run before a tenant transaction exists. Keep the
-- tables out of RLS, but remove ambient table reads and expose only bounded,
-- security-definer functions to the application role.
CREATE OR REPLACE FUNCTION public.bridge_lookup_principal_identity_by_oidc(
  p_issuer text,
  p_subject text
)
RETURNS TABLE (
  id text,
  type public.bridge_principal_type,
  display_name text,
  oidc_issuer text,
  oidc_subject text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $bridge$
  SELECT i.id, i.type, i.display_name, i.oidc_issuer, i.oidc_subject, i.created_at
  FROM public.bridge_principal_identities AS i
  WHERE i.oidc_issuer = p_issuer
    AND i.oidc_subject = p_subject
  LIMIT 1
$bridge$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bridge_lookup_organization_by_external_id(
  p_external_identity_provider_id text
)
RETURNS TABLE (
  id text,
  external_identity_provider_id text,
  slug text,
  name text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $bridge$
  SELECT o.id, o.external_identity_provider_id, o.slug, o.name, o.created_at
  FROM public.bridge_organizations AS o
  WHERE o.external_identity_provider_id = p_external_identity_provider_id
  LIMIT 1
$bridge$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bridge_lookup_service_token(
  p_token_hash text
)
RETURNS TABLE (
  id text,
  organization_id text,
  principal_id text,
  name text,
  token_hash text,
  scopes jsonb,
  created_at timestamptz,
  expires_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  version integer,
  principal_type public.bridge_principal_type,
  principal_display_name text,
  principal_oidc_issuer text,
  principal_oidc_subject text,
  principal_created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $bridge$
  SELECT
    c.id,
    c.organization_id,
    c.principal_id,
    c.name,
    c.token_hash,
    c.scopes,
    c.created_at,
    c.expires_at,
    c.rotated_at,
    c.revoked_at,
    c.version,
    i.type,
    i.display_name,
    i.oidc_issuer,
    i.oidc_subject,
    i.created_at
  FROM public.bridge_service_credentials AS c
  JOIN public.bridge_principal_identities AS i ON i.id = c.principal_id
  WHERE c.token_hash = p_token_hash
  LIMIT 1
$bridge$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bridge_get_principal_identity(
  p_principal_id text
)
RETURNS TABLE (
  id text,
  type public.bridge_principal_type,
  display_name text,
  oidc_issuer text,
  oidc_subject text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $bridge$
  SELECT i.id, i.type, i.display_name, i.oidc_issuer, i.oidc_subject, i.created_at
  FROM public.bridge_principal_identities AS i
  WHERE i.id = p_principal_id
    AND EXISTS (
      SELECT 1
      FROM public.bridge_organization_memberships AS m
      WHERE m.principal_id = i.id
        AND m.organization_id = nullif(current_setting('bridge.organization_id', true), '')
    )
  LIMIT 1
$bridge$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bridge_get_service_credential(
  p_service_credential_id text
)
RETURNS TABLE (
  id text,
  organization_id text,
  principal_id text,
  name text,
  token_hash text,
  scopes jsonb,
  created_at timestamptz,
  expires_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $bridge$
  SELECT
    c.id,
    c.organization_id,
    c.principal_id,
    c.name,
    c.token_hash,
    c.scopes,
    c.created_at,
    c.expires_at,
    c.rotated_at,
    c.revoked_at,
    c.version
  FROM public.bridge_service_credentials AS c
  WHERE c.id = p_service_credential_id
    AND c.organization_id = nullif(current_setting('bridge.organization_id', true), '')
  LIMIT 1
$bridge$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bridge_list_service_credentials(
  p_organization_id text
)
RETURNS TABLE (
  id text,
  organization_id text,
  principal_id text,
  name text,
  token_hash text,
  scopes jsonb,
  created_at timestamptz,
  expires_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $bridge$
  SELECT
    c.id,
    c.organization_id,
    c.principal_id,
    c.name,
    c.token_hash,
    c.scopes,
    c.created_at,
    c.expires_at,
    c.rotated_at,
    c.revoked_at,
    c.version
  FROM public.bridge_service_credentials AS c
  WHERE c.organization_id = p_organization_id
    AND c.organization_id = nullif(current_setting('bridge.organization_id', true), '')
  ORDER BY c.created_at ASC
$bridge$;
--> statement-breakpoint
REVOKE ALL ON TABLE
  public.bridge_organizations,
  public.bridge_principal_identities,
  public.bridge_service_credentials
FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bridge_lookup_principal_identity_by_oidc(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bridge_lookup_organization_by_external_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bridge_lookup_service_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bridge_get_principal_identity(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bridge_get_service_credential(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bridge_list_service_credentials(text) FROM PUBLIC;
