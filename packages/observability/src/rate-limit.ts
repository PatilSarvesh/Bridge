import { createHash } from "node:crypto";

export type BridgeRateLimitBucket =
  | "auth"
  | "read"
  | "write"
  | "mcp"
  | "organization_read"
  | "organization_write"
  | "principal_read"
  | "principal_write";

export interface BridgeRateLimitPolicy {
  readonly maxRequests: number;
  readonly windowMs: number;
}

export const defaultBridgeRateLimitPolicies: Readonly<Record<BridgeRateLimitBucket, BridgeRateLimitPolicy>> = {
  auth: { maxRequests: 30, windowMs: 60_000 },
  read: { maxRequests: 240, windowMs: 60_000 },
  write: { maxRequests: 120, windowMs: 60_000 },
  mcp: { maxRequests: 120, windowMs: 60_000 },
  organization_read: { maxRequests: 2_400, windowMs: 60_000 },
  organization_write: { maxRequests: 1_200, windowMs: 60_000 },
  principal_read: { maxRequests: 240, windowMs: 60_000 },
  principal_write: { maxRequests: 120, windowMs: 60_000 },
};

export interface BridgeRateLimitOptions {
  readonly now?: () => number;
  readonly maxKeys?: number;
  readonly policies?: Partial<Record<BridgeRateLimitBucket, BridgeRateLimitPolicy>>;
}

export interface BridgeRateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Seconds until the current window resets. */
  readonly retryAfterSeconds: number;
}

interface RateLimitWindow {
  readonly startedAtMs: number;
  count: number;
  lastSeenAtMs: number;
}

const defaultMaxKeys = 10_000;

function boundedInteger(value: number, fallback: number, minimum: number, maximum: number): number {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function normalizedPolicy(
  policy: BridgeRateLimitPolicy | undefined,
  fallback: BridgeRateLimitPolicy,
): BridgeRateLimitPolicy {
  return {
    maxRequests: boundedInteger(policy?.maxRequests ?? fallback.maxRequests, fallback.maxRequests, 1, 1_000_000),
    windowMs: boundedInteger(policy?.windowMs ?? fallback.windowMs, fallback.windowMs, 1_000, 86_400_000),
  };
}

/** Hashes dimensions before they enter process-local limiter state. */
export function hashRateLimitKey(...parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\u0000");
  return hash.digest("hex");
}

/**
 * A bounded, process-local fixed-window limiter for transport safeguards.
 * Deployment gateways remain responsible for distributed and tenant billing quotas.
 */
export class BridgeRateLimiter {
  private readonly now: () => number;
  private readonly maxKeys: number;
  private readonly policies: Readonly<Record<BridgeRateLimitBucket, BridgeRateLimitPolicy>>;
  private readonly windows = new Map<string, RateLimitWindow>();

  constructor(options: BridgeRateLimitOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxKeys = boundedInteger(options.maxKeys ?? defaultMaxKeys, defaultMaxKeys, 1, 1_000_000);
    this.policies = {
      auth: normalizedPolicy(options.policies?.auth, defaultBridgeRateLimitPolicies.auth),
      read: normalizedPolicy(options.policies?.read, defaultBridgeRateLimitPolicies.read),
      write: normalizedPolicy(options.policies?.write, defaultBridgeRateLimitPolicies.write),
      mcp: normalizedPolicy(options.policies?.mcp, defaultBridgeRateLimitPolicies.mcp),
      organization_read: normalizedPolicy(
        options.policies?.organization_read,
        defaultBridgeRateLimitPolicies.organization_read,
      ),
      organization_write: normalizedPolicy(
        options.policies?.organization_write,
        defaultBridgeRateLimitPolicies.organization_write,
      ),
      principal_read: normalizedPolicy(options.policies?.principal_read, defaultBridgeRateLimitPolicies.principal_read),
      principal_write: normalizedPolicy(
        options.policies?.principal_write,
        defaultBridgeRateLimitPolicies.principal_write,
      ),
    };
  }

  check(key: string, bucket: BridgeRateLimitBucket): BridgeRateLimitDecision {
    const policy = this.policies[bucket];
    const rawNow = this.now();
    const now = Number.isFinite(rawNow) ? Math.max(0, rawNow) : Date.now();
    const normalizedKey = key.trim().slice(0, 256) || "unknown";
    const stateKey = `${bucket}:${normalizedKey}`;
    let window = this.windows.get(stateKey);

    if (window === undefined && this.windows.size >= this.maxKeys) {
      const oldest = [...this.windows.entries()].sort(
        ([, left], [, right]) => left.lastSeenAtMs - right.lastSeenAtMs,
      )[0];
      if (oldest) this.windows.delete(oldest[0]);
    }

    if (window === undefined || now < window.startedAtMs || now >= window.startedAtMs + policy.windowMs) {
      window = { startedAtMs: now, count: 0, lastSeenAtMs: now };
      this.windows.set(stateKey, window);
    } else {
      window.lastSeenAtMs = now;
    }

    const allowed = window.count < policy.maxRequests;
    if (allowed) window.count += 1;
    const resetInMs = Math.max(0, window.startedAtMs + policy.windowMs - now);

    return {
      allowed,
      limit: policy.maxRequests,
      remaining: Math.max(0, policy.maxRequests - window.count),
      retryAfterSeconds: Math.max(1, Math.ceil(resetInMs / 1_000)),
    };
  }
}

export function rateLimitHeaders(decision: BridgeRateLimitDecision): Readonly<Record<string, string>> {
  return {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(decision.retryAfterSeconds),
  };
}
