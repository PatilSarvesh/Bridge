import {
  type BridgeRateLimitBucket,
  BridgeRateLimiter,
  type BridgeRateLimitPolicy,
  defaultBridgeRateLimitPolicies,
} from "@bridge/observability";

type AuthenticatedApiQuotaBucket = Extract<
  BridgeRateLimitBucket,
  "organization_read" | "organization_write" | "principal_read" | "principal_write"
>;

export type AuthenticatedApiRateLimitPolicies = Readonly<Record<AuthenticatedApiQuotaBucket, BridgeRateLimitPolicy>>;

type RateLimitEnvironment = Readonly<Record<string, string | undefined>>;

const windowEnvironmentName = "BRIDGE_API_AUTHENTICATED_RATE_WINDOW_MS";
const policyEnvironmentNames: Readonly<Record<AuthenticatedApiQuotaBucket, string>> = {
  organization_read: "BRIDGE_API_ORGANIZATION_READ_LIMIT",
  organization_write: "BRIDGE_API_ORGANIZATION_WRITE_LIMIT",
  principal_read: "BRIDGE_API_PRINCIPAL_READ_LIMIT",
  principal_write: "BRIDGE_API_PRINCIPAL_WRITE_LIMIT",
};

function boundedEnvironmentInteger(
  environment: RateLimitEnvironment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function authenticatedApiRateLimitPoliciesFromEnvironment(
  environment: RateLimitEnvironment = process.env,
): AuthenticatedApiRateLimitPolicies {
  const windowMs = boundedEnvironmentInteger(
    environment,
    windowEnvironmentName,
    defaultBridgeRateLimitPolicies.principal_read.windowMs,
    1_000,
    86_400_000,
  );
  const policy = (bucket: AuthenticatedApiQuotaBucket): BridgeRateLimitPolicy => ({
    maxRequests: boundedEnvironmentInteger(
      environment,
      policyEnvironmentNames[bucket],
      defaultBridgeRateLimitPolicies[bucket].maxRequests,
      1,
      1_000_000,
    ),
    windowMs,
  });
  return {
    organization_read: policy("organization_read"),
    organization_write: policy("organization_write"),
    principal_read: policy("principal_read"),
    principal_write: policy("principal_write"),
  };
}

export function createAuthenticatedApiRateLimiter(environment: RateLimitEnvironment = process.env): BridgeRateLimiter {
  return new BridgeRateLimiter({
    policies: authenticatedApiRateLimitPoliciesFromEnvironment(environment),
  });
}
