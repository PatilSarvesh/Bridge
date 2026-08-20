import type { Principal } from "@bridge/domain";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OidcAccessTokenVerifier,
  OidcAuthenticator,
  hashServiceToken,
  type OidcConfiguration,
  type PrincipalDirectory,
} from "./index.js";

const issuer = "https://identity.example/";
const audience = "https://api.bridge.example";
const principal: Principal = {
  id: "usr_member",
  type: "human",
  organizationId: "org_bridge",
  projectIds: ["prj_one"],
  roles: ["organization-member"],
  projectRoles: { prj_one: ["project-admin"] },
  displayName: "Bridge Member",
};

async function fixture(directoryResult: Principal | null = principal) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const directory: PrincipalDirectory = {
    resolveOidcPrincipal: vi.fn(async () => directoryResult ?? undefined),
  };
  const configuration: OidcConfiguration = {
    issuer,
    audience,
    clientId: "bridge-web",
    clientSecret: "test-client-secret",
    cliClientId: "bridge-cli",
    cliRedirectUri: "http://127.0.0.1:8765/callback",
    publicApiUrl: "https://api.bridge.example",
    publicWebUrl: "https://bridge.example/app",
    sessionSecret: "test-session-secret-with-at-least-thirty-two-characters",
    loginOrganization: "auth0-org-acme",
    secureCookies: true,
  };
  const jwks = createLocalJWKSet({ keys: [{ ...publicJwk, kid: "test-key", use: "sig", alg: "RS256" }] });
  const authenticator = new OidcAuthenticator(
    configuration,
    directory,
    jwks,
  );
  const sign = (
    claims: Record<string, unknown>,
    tokenAudience = audience,
    subject = "auth0|member",
  ) => new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(tokenAudience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { authenticator, configuration, directory, jwks, sign };
}

afterEach(() => vi.unstubAllGlobals());

describe("OIDC authentication", () => {
  it("publishes only public CLI OAuth configuration for a hardened loopback client", async () => {
    const { authenticator } = await fixture();
    expect(authenticator.publicConfiguration()).toMatchObject({
      mode: "oidc",
      cliClientId: "bridge-cli",
      cliAuthorizationEndpoint: "https://identity.example/authorize",
      cliTokenEndpoint: "https://identity.example/oauth/token",
      cliRevocationEndpoint: "https://identity.example/oauth/revoke",
      cliAudience: audience,
      cliRedirectUri: "http://127.0.0.1:8765/callback",
      cliScopes: "openid profile email offline_access",
      cliOrganization: "auth0-org-acme",
    });
    expect(JSON.stringify(authenticator.publicConfiguration())).not.toContain("test-client-secret");
    expect(JSON.stringify(authenticator.publicConfiguration())).not.toContain("session-secret");
  });

  it("verifies access tokens and resolves authority from server-side membership", async () => {
    const { authenticator, directory, sign } = await fixture();
    const token = await sign({ org_id: "auth0-org-acme", roles: ["untrusted-token-admin"] });

    await expect(authenticator.authenticateRequest({ authorization: `Bearer ${token}` }))
      .resolves.toEqual(principal);
    expect(directory.resolveOidcPrincipal).toHaveBeenCalledWith({
      issuer,
      subject: "auth0|member",
      organizationExternalId: "auth0-org-acme",
    });
  });

  it("carries validated scope claims only for the resolved non-human principal", async () => {
    const agent: Principal = {
      ...principal,
      id: "agt_bridge",
      type: "agent",
      roles: ["agent"],
      displayName: "Bridge Agent",
    };
    const { authenticator, sign } = await fixture(agent);
    const token = await sign({ org_id: "auth0-org-acme", scope: "bridge:read bridge:write" });
    await expect(authenticator.authenticateAccessToken(token)).resolves.toMatchObject({
      id: agent.id,
      type: "agent",
      scopes: ["bridge:read", "bridge:write"],
    });
  });

  it("supports verifier-only MCP/API bearer validation without session secrets", async () => {
    const agent: Principal = {
      ...principal,
      id: "agt_mcp",
      type: "agent",
      roles: ["agent"],
      displayName: "MCP Agent",
    };
    const { directory, jwks, sign } = await fixture(agent);
    const verifier = new OidcAccessTokenVerifier({ issuer, audience }, directory, jwks);
    const token = await sign({ org_id: "auth0-org-acme", scope: "bridge:read" });
    await expect(verifier.authenticateAccessToken(token)).resolves.toMatchObject({
      id: agent.id,
      scopes: ["bridge:read"],
    });
  });

  it("rejects malformed or oversized scope claims", async () => {
    const { authenticator, sign } = await fixture({ ...principal, type: "agent" });
    const malformed = await sign({ org_id: "auth0-org-acme", scope: 42 });
    await expect(authenticator.authenticateAccessToken(malformed))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
    const oversized = await sign({
      org_id: "auth0-org-acme",
      scope: Array.from({ length: 101 }, (_, index) => `scope-${index}`).join(" "),
    });
    await expect(authenticator.authenticateAccessToken(oversized))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
  });

  it("authenticates revocable service tokens through the bearer path", async () => {
    const { authenticator, directory } = await fixture({
      ...principal,
      id: "svc_ci",
      type: "ci",
      displayName: "Hospital CI",
    });
    const token = `brg_srv_${"a".repeat(43)}`;
    const servicePrincipal: Principal = {
      ...principal,
      id: "svc_ci",
      type: "ci",
      displayName: "Hospital CI",
    };
    directory.resolveServiceToken = vi.fn(async (tokenHash) => tokenHash === hashServiceToken(token)
      ? {
          principal: servicePrincipal,
          credential: {
            id: "scr_ci",
            organizationId: servicePrincipal.organizationId,
            principalId: servicePrincipal.id,
            name: "Hospital CI",
            tokenHash,
            scopes: ["bridge:read"],
            createdAt: "2026-08-11T00:00:00.000Z",
            expiresAt: "2099-08-12T00:00:00.000Z",
            version: 1,
          },
        }
      : undefined);

    await expect(authenticator.authenticateRequest({ authorization: `Bearer ${token}` }))
      .resolves.toMatchObject({ id: "svc_ci", type: "ci", scopes: ["bridge:read"] });
    await expect(new OidcAccessTokenVerifier({ issuer, audience }, directory)
      .authenticateBearerToken(token)).resolves.toMatchObject({ scopes: ["bridge:read"] });

    directory.resolveServiceToken = vi.fn(async () => undefined);
    await expect(authenticator.authenticateRequest({ authorization: `Bearer ${token}` }))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
  });

  it("fails closed for invalid audience, missing organization, and inactive membership", async () => {
    const validFixture = await fixture();
    const wrongAudience = await validFixture.sign({ org_id: "auth0-org-acme" }, "wrong-audience");
    await expect(validFixture.authenticator.authenticateAccessToken(wrongAudience))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });

    const missingOrganization = await validFixture.sign({});
    await expect(validFixture.authenticator.authenticateAccessToken(missingOrganization))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });

    const inactiveFixture = await fixture(null);
    const inactive = await inactiveFixture.sign({ org_id: "auth0-org-acme" });
    await expect(inactiveFixture.authenticator.authenticateAccessToken(inactive))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
  });

  it("uses state, nonce, PKCE, encrypted cookies, and a bounded same-origin return URL", async () => {
    const { authenticator, configuration, sign } = await fixture();
    const login = await authenticator.beginWebLogin("https://evil.example/redirect");
    const authorizationUrl = new URL(login.authorizationUrl);
    const nonce = authorizationUrl.searchParams.get("nonce")!;
    const state = authorizationUrl.searchParams.get("state")!;
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("organization")).toBe("auth0-org-acme");
    expect(login.transactionCookie).toContain("HttpOnly");
    expect(login.transactionCookie).toContain("Secure");

    const accessToken = await sign({ org_id: "auth0-org-acme" });
    const idToken = await sign({ nonce }, configuration.clientId);
    const tokenFetch = vi.fn(async () => new Response(JSON.stringify({
      access_token: accessToken,
      id_token: idToken,
      expires_in: 300,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", tokenFetch);

    const callback = await authenticator.completeWebLogin({
      code: "authorization-code",
      state,
      cookie: login.transactionCookie.split(";")[0]!,
    });
    expect(callback.redirectUrl).toBe("https://bridge.example/app");
    expect(callback.principal).toEqual(principal);
    expect(callback.sessionCookie).toContain("HttpOnly");
    await expect(authenticator.authenticateRequest({ cookie: callback.sessionCookie.split(";")[0]! }))
      .resolves.toEqual(principal);
    expect(tokenFetch).toHaveBeenCalledOnce();
  });

  it("does not establish a web session for a non-human principal", async () => {
    const agent: Principal = {
      ...principal,
      id: "agt_web",
      type: "agent",
      roles: ["agent"],
      displayName: "Web Agent",
    };
    const { authenticator, configuration, sign } = await fixture(agent);
    const login = await authenticator.beginWebLogin();
    const authorizationUrl = new URL(login.authorizationUrl);
    const token = await sign({ org_id: "auth0-org-acme" });
    const idToken = await sign({ nonce: authorizationUrl.searchParams.get("nonce") }, configuration.clientId);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: token,
      id_token: idToken,
      expires_in: 300,
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(authenticator.completeWebLogin({
      code: "authorization-code",
      state: authorizationUrl.searchParams.get("state")!,
      cookie: login.transactionCookie.split(";")[0]!,
    })).rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
  });

  it("rejects a callback whose state does not match before exchanging a code", async () => {
    const { authenticator } = await fixture();
    const login = await authenticator.beginWebLogin();
    await expect(authenticator.completeWebLogin({
      code: "authorization-code",
      state: "attacker-state",
      cookie: login.transactionCookie.split(";")[0]!,
    })).rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
  });

  it("rejects a callback when the ID and access token subjects differ", async () => {
    const { authenticator, configuration, sign } = await fixture();
    const login = await authenticator.beginWebLogin();
    const authorizationUrl = new URL(login.authorizationUrl);
    const nonce = authorizationUrl.searchParams.get("nonce")!;
    const state = authorizationUrl.searchParams.get("state")!;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: await sign({ org_id: "auth0-org-acme" }),
      id_token: await sign({ nonce }, configuration.clientId, "auth0|different-member"),
      expires_in: 300,
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(authenticator.completeWebLogin({
      code: "authorization-code",
      state,
      cookie: login.transactionCookie.split(";")[0]!,
    })).rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
  });
});
