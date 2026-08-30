import { describe, expect, it } from "vitest";

import {
  authenticatedApiRateLimitPoliciesFromEnvironment,
  createAuthenticatedApiRateLimiter,
} from "./rate-limit-config.js";

describe("authenticated API rate-limit configuration", () => {
  it("uses bounded defaults and applies one configured window to every quota", () => {
    expect(authenticatedApiRateLimitPoliciesFromEnvironment({})).toEqual({
      organization_read: { maxRequests: 2_400, windowMs: 60_000 },
      organization_write: { maxRequests: 1_200, windowMs: 60_000 },
      principal_read: { maxRequests: 240, windowMs: 60_000 },
      principal_write: { maxRequests: 120, windowMs: 60_000 },
    });

    expect(
      authenticatedApiRateLimitPoliciesFromEnvironment({
        BRIDGE_API_AUTHENTICATED_RATE_WINDOW_MS: "5000",
        BRIDGE_API_ORGANIZATION_READ_LIMIT: "40",
        BRIDGE_API_ORGANIZATION_WRITE_LIMIT: "30",
        BRIDGE_API_PRINCIPAL_READ_LIMIT: "20",
        BRIDGE_API_PRINCIPAL_WRITE_LIMIT: "10",
      }),
    ).toEqual({
      organization_read: { maxRequests: 40, windowMs: 5_000 },
      organization_write: { maxRequests: 30, windowMs: 5_000 },
      principal_read: { maxRequests: 20, windowMs: 5_000 },
      principal_write: { maxRequests: 10, windowMs: 5_000 },
    });
  });

  it("fails closed on invalid limits without echoing their values", () => {
    const invalidValue = "sensitive-invalid-value";
    expect(() =>
      authenticatedApiRateLimitPoliciesFromEnvironment({
        BRIDGE_API_PRINCIPAL_WRITE_LIMIT: invalidValue,
      }),
    ).toThrow("BRIDGE_API_PRINCIPAL_WRITE_LIMIT must be an integer between 1 and 1000000.");
    try {
      authenticatedApiRateLimitPoliciesFromEnvironment({
        BRIDGE_API_PRINCIPAL_WRITE_LIMIT: invalidValue,
      });
    } catch (error) {
      expect(String(error)).not.toContain(invalidValue);
    }
  });

  it("creates an enforceable limiter from the validated policy", () => {
    const limiter = createAuthenticatedApiRateLimiter({
      BRIDGE_API_PRINCIPAL_READ_LIMIT: "1",
      BRIDGE_API_AUTHENTICATED_RATE_WINDOW_MS: "1000",
    });
    expect(limiter.check("principal", "principal_read")).toMatchObject({
      allowed: true,
      limit: 1,
      remaining: 0,
    });
    expect(limiter.check("principal", "principal_read")).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });
});
