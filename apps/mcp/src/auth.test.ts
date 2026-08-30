import { BridgeError, type Principal } from "@bridge/domain";
import { describe, expect, it, vi } from "vitest";

import { classifyMcpAuthenticationOutcome, resolveMcpPrincipal } from "./auth.js";

const agent: Principal = {
  id: "agt_mcp",
  type: "agent",
  organizationId: "org_bridge",
  projectIds: ["prj_one"],
  roles: ["agent"],
  displayName: "MCP Agent",
};

function request(authorization?: string) {
  return { header: vi.fn(() => authorization) };
}

describe("MCP authentication boundary", () => {
  it("classifies failures without exposing credential or tenant values", () => {
    expect(classifyMcpAuthenticationOutcome(new BridgeError("UNAUTHENTICATED", "invalid", 401), false)).toBe(
      "missing_credentials",
    );
    expect(classifyMcpAuthenticationOutcome(new BridgeError("UNAUTHENTICATED", "invalid", 401), true)).toBe(
      "invalid_credentials",
    );
    expect(classifyMcpAuthenticationOutcome(new BridgeError("FORBIDDEN", "denied", 403), true)).toBe(
      "authorization_denied",
    );
    expect(classifyMcpAuthenticationOutcome(new BridgeError("IDENTITY_NOT_CONFIGURED", "missing", 503), false)).toBe(
      "configuration_error",
    );
  });

  it("rejects missing or malformed bearer credentials when OIDC is enabled", async () => {
    const verifier = { authenticateAccessToken: vi.fn(async () => agent) };
    await expect(resolveMcpPrincipal(request(), { verifier, production: true }))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
    await expect(resolveMcpPrincipal(request("Basic abc"), { verifier, production: true }))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
    expect(verifier.authenticateAccessToken).not.toHaveBeenCalled();
  });

  it("passes only the bearer token to the shared verifier", async () => {
    const verifier = { authenticateAccessToken: vi.fn(async () => agent) };
    await expect(resolveMcpPrincipal(request("Bearer signed-token"), { verifier, production: true }))
      .resolves.toEqual(agent);
    expect(verifier.authenticateAccessToken).toHaveBeenCalledWith("signed-token");
  });

  it("keeps the fixed principal fallback development-only", async () => {
    await expect(resolveMcpPrincipal(request(), { developmentPrincipal: agent, production: false }))
      .resolves.toEqual(agent);
    await expect(resolveMcpPrincipal(request(), { production: true }))
      .rejects.toMatchObject({ code: "IDENTITY_NOT_CONFIGURED", statusCode: 503 });
  });

  it("preserves verifier failures without replacing them with a local principal", async () => {
    const verifier = {
      authenticateAccessToken: vi.fn(async () => {
        throw new BridgeError("UNAUTHENTICATED", "The access token is invalid or expired.", 401);
      }),
    };
    await expect(resolveMcpPrincipal(request("Bearer invalid"), { verifier, production: false }))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
  });
});
