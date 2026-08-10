# Authentication and organization foundation

Bridge can run in one of two explicit authentication modes:

- **Development mode** keeps the seeded `x-bridge-principal-id` switcher for local demonstrations. It is rejected when `NODE_ENV=production`.
- **OIDC mode** validates RS256 access and ID tokens against the configured issuer JWKS and uses server-side Bridge memberships for authority.

OIDC mode currently completes BRG-010's application foundation. CLI browser login, MCP OAuth metadata/scope enforcement, enterprise provisioning, organization-member administration UI, refresh tokens, and durable authentication audit events remain separate work.

## Security boundary

The access token supplies only the verified issuer, subject, audience, expiry, and external organization identifier. Bridge does not trust token role or project claims. It resolves each request through these durable records:

1. `bridge_organizations`
2. `bridge_principal_identities`
3. an active `bridge_organization_memberships` row
4. active `bridge_project_memberships` rows

A disabled organization membership fails the next request. Project roles are evaluated only for the target project; a project administrator in one project does not become an administrator in another.

Browser sign-in uses Authorization Code with PKCE. Bridge keeps the verifier, state, nonce, and bounded same-origin return URL in a short-lived encrypted `HttpOnly`, `SameSite=Lax` cookie. The callback validates state, exchanges the code server-side, verifies the ID-token nonce and signature, re-verifies the access token, and creates an encrypted `HttpOnly` session cookie. The session cannot outlive the access token. Bearer tokens use the same verifier and directory lookup.

## Auth0 pilot setup

Create an Auth0 Regular Web Application and API:

- API identifier: the value used for `BRIDGE_OIDC_AUDIENCE`
- Allowed callback URL: `${BRIDGE_PUBLIC_API_URL}/v1/auth/callback`
- Allowed logout URL: `BRIDGE_PUBLIC_WEB_URL`
- Signing algorithm: RS256
- Organization login enabled for the pilot organization

The access token must contain the Auth0 organization identifier in `org_id`, or in the custom claim named by `BRIDGE_OIDC_ORGANIZATION_CLAIM`. `BRIDGE_OIDC_LOGIN_ORGANIZATION` can pin the initial pilot login to one Auth0 organization.

Current vendor references:

- [Auth0 organization tokens](https://auth0.com/docs/manage-users/organizations/using-tokens)
- [Auth0 access-token validation](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens)
- [Auth0 logout endpoint](https://auth0.com/docs/api/authentication/logout/auth-0-logout)

Configure the API runtime:

```bash
export NODE_ENV=production
export DATABASE_URL='postgresql://...'
export BRIDGE_PUBLIC_API_URL='https://api.bridge.example'
export BRIDGE_PUBLIC_WEB_URL='https://bridge.example'
export BRIDGE_OIDC_ISSUER='https://YOUR_TENANT.auth0.com/'
export BRIDGE_OIDC_AUDIENCE='https://api.bridge.example'
export BRIDGE_OIDC_CLIENT_ID='...'
export BRIDGE_OIDC_CLIENT_SECRET='...'
export BRIDGE_AUTH_SESSION_SECRET='a-random-secret-containing-at-least-32-characters'
export BRIDGE_OIDC_LOGIN_ORGANIZATION='org_...'
pnpm db:migrate
pnpm dev:api
```

Never commit the client secret or session secret. Use the deployment secret manager in hosted environments. HTTPS is required for the default secure cookies. `BRIDGE_AUTH_INSECURE_COOKIES=true` exists only for deliberate loopback testing.

## First organization administrator

Initial organization creation is an operator bootstrap, not an unauthenticated public endpoint. On one API start, supply all of the following together:

```bash
export BRIDGE_BOOTSTRAP_ORGANIZATION_ID='org_acme'
export BRIDGE_BOOTSTRAP_OIDC_ORGANIZATION_ID='org_auth0_external_id'
export BRIDGE_BOOTSTRAP_ORGANIZATION_SLUG='acme'
export BRIDGE_BOOTSTRAP_ORGANIZATION_NAME='Acme'
export BRIDGE_BOOTSTRAP_ADMIN_ID='usr_initial_admin'
export BRIDGE_BOOTSTRAP_ADMIN_SUBJECT='auth0|subject'
export BRIDGE_BOOTSTRAP_ADMIN_NAME='Initial administrator'
```

Bootstrap is idempotent by internal organization and principal IDs. It creates an active human membership with `organization-admin` and `project-admin` roles and access to all projects in that organization. Remove the bootstrap variables after the successful start. Later membership changes should be implemented through version-checked, audited administration commands rather than by keeping bootstrap configuration active.

When OIDC mode is enabled, API startup does not seed the local demo organization, principals, project, question, or specification. After the initial administrator signs in, use the existing authorized project-registration operation to create the first real project.

## Public authentication endpoints

```text
GET /v1/auth/config
GET /v1/auth/login
GET /v1/auth/callback
GET /v1/auth/logout
GET /v1/auth/me
```

All business endpoints accept the encrypted Bridge session cookie or a valid `Authorization: Bearer ...` access token in OIDC mode. The local principal header is ignored in that mode.

## Remaining limitations

- The standalone MCP process still uses its fixed development principal and is not production-authenticated.
- The CLI has no PKCE login or secure credential-store integration yet.
- Access tokens are audience-validated, but application scopes and service-identity grants are not yet enforced.
- There is no organization member invitation/disable UI; the durable repository methods and schema are the foundation for that next slice.
- PostgreSQL RLS and a separate maintenance role remain part of BRG-012.
- A real Auth0 tenant and hosted callback/logout configuration require deployment-owner validation.
