import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import {
  CliAuthenticationError,
  cliCredentialService,
  createAuthorizationRequest,
  createSystemCredentialStore,
  parseCliOidcConfiguration,
  parseStoredSession,
  serializeStoredSession,
  startLoopbackCallback,
  type CommandRunner,
  type StoredCliSession,
} from "./auth.js";

const publicConfiguration = {
  mode: "oidc",
  cliClientId: "bridge-cli",
  cliAuthorizationEndpoint: "https://identity.example/authorize",
  cliTokenEndpoint: "https://identity.example/oauth/token",
  cliRevocationEndpoint: "https://identity.example/oauth/revoke",
  cliAudience: "https://api.bridge.example",
  cliRedirectUri: "http://127.0.0.1:8765/callback",
  cliScopes: "openid profile offline_access",
  cliOrganization: "org_acme",
};

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

describe("Bridge CLI authentication primitives", () => {
  it("builds a public-client authorization request with S256 PKCE and organization scope", () => {
    const request = createAuthorizationRequest(parseCliOidcConfiguration(publicConfiguration));
    const authorization = new URL(request.authorizationUrl);
    expect(authorization.origin).toBe("https://identity.example");
    expect(authorization.searchParams.get("client_id")).toBe("bridge-cli");
    expect(authorization.searchParams.get("redirect_uri")).toBe(publicConfiguration.cliRedirectUri);
    expect(authorization.searchParams.get("organization")).toBe("org_acme");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("code_challenge")).toHaveLength(43);
    expect(request.verifier.length).toBeGreaterThanOrEqual(43);
    expect(request.state.length).toBeGreaterThanOrEqual(40);
    expect(request.authorizationUrl).not.toContain(request.verifier);
  });

  it("rejects non-HTTPS provider endpoints and non-literal loopback redirects", () => {
    expect(() => parseCliOidcConfiguration({
      ...publicConfiguration,
      cliAuthorizationEndpoint: "http://identity.example/authorize",
    })).toThrowError(CliAuthenticationError);
    expect(() => parseCliOidcConfiguration({
      ...publicConfiguration,
      cliRedirectUri: "http://localhost:8765/callback",
    })).toThrow("explicit http://127.0.0.1");
    expect(() => parseCliOidcConfiguration({
      ...publicConfiguration,
      cliRedirectUri: "https://bridge.example/callback",
    })).toThrow("explicit http://127.0.0.1");
  });

  it("accepts only an exact callback path and constant-time state before returning a code", async () => {
    const port = await availablePort();
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const callback = await startLoopbackCallback(redirectUri, "expected-state", 5_000);

    const wrongPath = await fetch(`http://127.0.0.1:${port}/other?state=expected-state&code=attacker`);
    expect(wrongPath.status).toBe(404);
    const wrongState = await fetch(`${redirectUri}?state=wrong-state&code=attacker`);
    expect(wrongState.status).toBe(400);
    const accepted = await fetch(`${redirectUri}?state=expected-state&code=authorization-code`);
    expect(accepted.status).toBe(200);
    await expect(callback.waitForCode).resolves.toBe("authorization-code");
    expect(accepted.headers.get("cache-control")).toBe("no-store");
  });

  it("uses keychain stdin instead of placing a stored session in process arguments", async () => {
    const calls: Array<{ executable: string; args: readonly string[]; stdin?: string }> = [];
    const runner: CommandRunner = async (executable, args, stdin) => {
      calls.push({ executable, args, ...(stdin === undefined ? {} : { stdin }) });
      if (args[0] === "find-generic-password") return { exitCode: 0, stdout: "stored-value\n" };
      return { exitCode: 0, stdout: "" };
    };
    const store = createSystemCredentialStore("darwin", runner);
    await store.set("https://api.bridge.example", "sensitive-session-value");
    await expect(store.get("https://api.bridge.example")).resolves.toBe("stored-value");
    await expect(store.delete("https://api.bridge.example")).resolves.toBe(true);

    const write = calls[0]!;
    expect(write.executable).toBe("/usr/bin/security");
    expect(write.args.at(-1)).toBe("-w");
    expect(write.args.join(" ")).not.toContain("sensitive-session-value");
    expect(write.stdin).toBe("sensitive-session-value\n");
    expect(write.args).toContain(cliCredentialService);
  });

  it("round-trips a bounded versioned session and rejects another API account", () => {
    const session: StoredCliSession = {
      version: 1,
      apiUrl: "https://api.bridge.example",
      accessToken: "access-token-with-safe-test-length",
      refreshToken: "refresh-token-with-safe-test-length",
      expiresAt: 1_800_000_000,
      scopes: ["openid", "offline_access"],
      obtainedAt: "2026-08-10T00:00:00.000Z",
    };
    const serialized = serializeStoredSession(session);
    expect(parseStoredSession(serialized, session.apiUrl)).toEqual(session);
    expect(() => parseStoredSession(serialized, "https://other.bridge.example"))
      .toThrow("stored CLI authentication session is invalid");
  });
});
