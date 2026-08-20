# Authentication and organization foundation

Bridge can run in one of two explicit authentication modes:

- **Development mode** keeps the seeded `x-bridge-principal-id` switcher for local demonstrations. It is rejected when `NODE_ENV=production`.
- **OIDC mode** validates RS256 access and ID tokens against the configured issuer JWKS and uses server-side Bridge memberships for authority.

OIDC mode currently completes BRG-010's application foundation. Version-checked organization-member administration, interactive CLI public-client authentication, coarse REST bearer-capability enforcement, standalone MCP bearer validation, revocable scoped service identities, and durable human web sign-in/logout audit events are implemented; MCP authorization-server provisioning, provider-backed invitations, enterprise provisioning, and failed/unknown authentication attribution remain separate work.

## Security boundary

The access token supplies the verified issuer, subject, audience, expiry, external organization identifier, and optional space-delimited `scope` claim. Bridge does not trust token role or project claims. It resolves each request through these durable records:

1. `bridge_organizations`
2. `bridge_principal_identities`
3. an active `bridge_organization_memberships` row
4. active `bridge_project_memberships` rows

A disabled organization membership fails the next request. Project roles are evaluated only for the target project; a project administrator in one project does not become an administrator in another.

Browser sign-in uses Authorization Code with PKCE. Bridge keeps the verifier, state, nonce, and bounded same-origin return URL in a short-lived encrypted `HttpOnly`, `SameSite=Lax` cookie. The callback validates state, exchanges the code server-side, verifies the ID-token nonce and signature, re-verifies the access token, and creates an encrypted `HttpOnly` session cookie. The session cannot outlive the access token. Bearer tokens use the same verifier and directory lookup.

After the callback resolves an active human organization member, the API appends `authentication.succeeded` to the tenant-scoped organization audit stream before returning the session redirect. Cookie-backed logout resolves the trusted session principal and appends `authentication.logged_out` before clearing the session. Non-human principals cannot establish a web session. Missing, invalid, expired, or otherwise untrusted credentials are not assigned a durable authentication audit event because the request has no trusted tenant context; they are recorded only through privacy-safe correlation-aware logs.

For non-human bearer principals, Bridge validates the optional scope claim and applies coarse capabilities at the REST boundary:

- `bridge:read` is required for `GET` and `HEAD` requests under `/v1` (except `/v1/auth/*`).
- `bridge:write` is required for mutating `/v1` requests.
- `bridge:admin` satisfies both coarse capabilities.
- Human principals continue to use server-side membership and role policy; provider scopes do not replace those checks.

Missing capabilities return `403` with the required capability in structured error details. Malformed scope claims return `401`. This is intentionally a first coarse boundary; endpoint-specific tool scopes and MCP-side token issuance remain separate work.

## Standalone MCP bearer authentication

The standalone MCP process remains optional. In development, it can use `BRIDGE_MCP_PRINCIPAL_ID` with the durable PostgreSQL adapter. In production, it refuses to start without `BRIDGE_OIDC_ISSUER`, `BRIDGE_MCP_OIDC_AUDIENCE`, and a bearer-token verifier; the fixed principal is never a production fallback.

MCP uses the shared issuer/JWKS verifier and resolves the token subject plus organization claim through the same active membership directory as the API. MCP must use a dedicated audience (`BRIDGE_MCP_OIDC_AUDIENCE`) so an API token cannot be reused accidentally as an unrestricted MCP credential. The process publishes OAuth protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` and advertises `bridge:read`, `bridge:write`, and `bridge:admin`.

Authenticated non-human MCP principals are checked per tool: read tools require `bridge:read`, write tools require `bridge:write`, and `bridge:admin` satisfies both. Human principals still rely on server-side membership and role policy. Missing bearer credentials return `401` with a `WWW-Authenticate` metadata reference; invalid audience, signature, expiry, membership, or scope claims fail closed. MCP does not issue tokens itself; the configured external OIDC authorization server remains responsible for login and token issuance.

## Auth0 pilot setup

Create an Auth0 Regular Web Application, Native Application, and API. The web and CLI clients must use different client IDs; the CLI is a public client and must never receive the web client secret.

Web application configuration:

- API identifier: the value used for `BRIDGE_OIDC_AUDIENCE`
- Allowed callback URL: `${BRIDGE_PUBLIC_API_URL}/v1/auth/callback`
- Allowed logout URL: `BRIDGE_PUBLIC_WEB_URL`
- Signing algorithm: RS256
- Organization login enabled for the pilot organization

Native CLI application configuration:

- Application type: Native
- Token endpoint authentication method: none
- Allowed callback URL: the exact `http://127.0.0.1:<port>/callback` value configured below
- Authorization Code grant enabled with refresh-token rotation
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
export BRIDGE_OIDC_CLI_CLIENT_ID='...native-public-client-id...'
export BRIDGE_OIDC_CLI_REDIRECT_URI='http://127.0.0.1:8765/callback'
export BRIDGE_AUTH_SESSION_SECRET='a-random-secret-containing-at-least-32-characters'
export BRIDGE_OIDC_LOGIN_ORGANIZATION='org_...'
pnpm db:migrate
pnpm dev:api
```

Never commit the client secret or session secret. Use the deployment secret manager in hosted environments. HTTPS is required for the default secure cookies. `BRIDGE_AUTH_INSECURE_COOKIES=true` exists only for deliberate loopback testing.

The CLI client ID and loopback redirect URI are public configuration, not secrets. Both must be configured together. Bridge publishes the client ID, provider endpoints, API audience, scopes, organization, and redirect URI through `GET /v1/auth/config`; it never publishes the web client secret or session-encryption secret.

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

## Organization member administration

An active human with the organization-level `organization-admin` role can open **Organization** in the web application or use:

```text
GET   /v1/admin/organization/members
POST  /v1/admin/organization/members
PATCH /v1/admin/organization/members/:memberId
```

Creating a member provisions a human identity for the configured OIDC issuer using its exact subject, then assigns organization roles, all-project access, and optional project-scoped roles. Updates require the last-read organization-membership version. Project identifiers are validated against the administrator's organization, role names are normalized, and every successful creation or update writes an organization-level audit event.

Disabling an organization membership denies the member's next authenticated request. Bridge also prevents disabling or demoting the final active organization administrator. The operator bootstrap creates the first administrator only when that membership is absent; leaving bootstrap variables configured no longer overwrites later versioned administration changes.

## Unattended service identities

An active human organization administrator can provision a narrowly scoped non-human credential for CI or an unattended agent:

```text
GET  /v1/admin/organization/service-identities
POST /v1/admin/organization/service-identities
POST /v1/admin/organization/service-identities/:serviceCredentialId/rotate
POST /v1/admin/organization/service-identities/:serviceCredentialId/revoke
```

The creation body selects `type` (`agent`, `ci`, or `integration`), normalized roles, optional all-project or explicit project memberships, one or more capabilities (`bridge:read`, `bridge:write`, or `bridge:admin`), and an expiry no more than one year away. The response includes a generated `brg_srv_...` bearer token once. Bridge stores only its SHA-256 hash; list and revoke responses never contain the token or hash. Save the token immediately in the CI platform's secret manager and send it as `Authorization: Bearer <token>`.

Service-token resolution re-checks expiry, revocation, active organization membership, and active project memberships on every request. Revoking the credential or disabling its identity's organization membership therefore takes effect without waiting for a provider token cache. The same bearer path works for REST and optional MCP; JWT/OIDC MCP tokens still require the configured MCP audience, while the opaque Bridge service-token prefix is resolved by the Bridge directory.

Rotation is optimistic-versioned and immediately invalidates the previous token. The replacement token is returned once, while Bridge stores only its hash and an audit event records the rotation. This is a credential-management foundation, not workload identity federation; provider-side exchange, rate limits, and endpoint-specific scopes remain follow-up work. Never commit, print, or log a service token.

The CLI provides the same REST-backed administration path for an organization administrator:

```bash
bridge service identity create \
  --name "Hospital CI" \
  --type ci \
  --scope bridge:read \
  --scope bridge:write \
  --project prj_hospital=contributor \
  --expires-at 2026-12-01T00:00:00Z \
  --api-url https://api.bridge.example
bridge service identity list --api-url https://api.bridge.example
bridge service identity rotate scr_... --version 1 --api-url https://api.bridge.example
bridge service identity revoke scr_... --version 1 --api-url https://api.bridge.example
```

`create` and `rotate` print a token exactly once in their success response and never write it to `.bridge`, the repository, or the CLI credential store. Rotation requires the current `--version`, invalidates the old token immediately, and increments the credential version. Copy the replacement directly into the CI platform's secret manager. `--project project-id=role1,role2` may be repeated; `--all-projects` grants organization-wide project visibility. The API remains authoritative for membership, expiry, and organization-admin authorization.

## Public authentication endpoints

```text
GET /v1/auth/config
GET /v1/auth/login
GET /v1/auth/callback
GET /v1/auth/logout
GET /v1/auth/me
```

All business endpoints accept the encrypted Bridge session cookie or a valid `Authorization: Bearer ...` access token in OIDC mode. The local principal header is ignored in that mode.

## CLI browser authentication

The CLI remains REST-based and does not require MCP. Sign in from any directory by supplying the API URL, or omit it when `.bridge/project.yaml` already contains the URL:

```bash
bridge login --api-url https://api.bridge.example
bridge auth status --api-url https://api.bridge.example
bridge logout --api-url https://api.bridge.example
```

`bridge login` performs the following bounded flow:

1. Fetch public CLI OAuth configuration from the Bridge API.
2. Generate an unpredictable state and PKCE verifier/challenge.
3. Bind only the configured literal `127.0.0.1` port and exact callback path.
4. Open the authorization URL, or print it for `--no-browser` mode.
5. Reject wrong methods, paths, state values, provider errors, oversized codes, or callbacks after five minutes.
6. Exchange the code directly as a public client without a client secret.
7. Ask `GET /v1/auth/me` to validate the access token and active server-side membership before storing it.

The versioned session contains only the API URL, access token, optional refresh token, expiry, granted scopes, and acquisition time. It is stored under an API-specific account in macOS Keychain or Linux Secret Service (`secret-tool`), never in the repository, `.bridge`, shell environment, CLI output, or error details. Unsupported or unavailable credential stores fail closed. Windows Credential Manager support is not implemented yet.

Before an authenticated API call, the CLI discovers whether the server is in development or OIDC mode. Development servers retain the fixed-principal header. OIDC servers receive only the bearer token. When an access token is near expiry, the CLI uses refresh-token rotation when available, validates the new access token through Bridge, and atomically replaces the keychain record. A missing or rejected refresh token removes the expired local session and requires login. Logout attempts provider refresh-token revocation and removes the local keychain entry even when remote revocation is unavailable.

This is an interactive delegated-human flow. CI and unattended agents must use a separate service identity and must not reuse a person's keychain session.

## Remaining limitations

- The standalone MCP process now validates external OIDC bearer tokens when configured; development may still use the fixed principal. Dynamic client registration, MCP-side authorization-server/token issuance, fine-grained tool scopes, and live-provider validation remain pending.
- Coarse `bridge:read`, `bridge:write`, and `bridge:admin` capabilities are enforced for non-human REST and MCP bearer principals, including revocable Bridge service tokens. Endpoint-specific tool scopes, MCP-side authorization-server/token issuance, and live-provider validation remain pending.
- Windows Credential Manager is not supported by the current CLI build; the implemented pilot stores are macOS Keychain and Linux Secret Service.
- Member provisioning currently requires an administrator to know the exact OIDC subject. Provider-backed email invitations, profile synchronization, and SCIM/group provisioning are not implemented.
- PostgreSQL RLS and a separate maintenance role remain part of BRG-012.
- A real Auth0 tenant and hosted callback/logout configuration require deployment-owner validation. Failed/unknown authentication attribution and provider-specific authentication event coverage remain future work.
