import type { BridgeMetrics, BridgeRateLimiter } from "@bridge/observability";
import { hashRateLimitKey, rateLimitHeaders } from "@bridge/observability";

export interface McpRateLimitRequest {
  readonly method: string;
  readonly path: string;
  readonly remoteAddress?: string;
  readonly authorization?: string;
}

export interface McpRateLimitResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): McpRateLimitResponse;
  json(body: unknown): unknown;
}

export interface McpRateLimitOptions {
  readonly limiter: BridgeRateLimiter;
  readonly metrics?: BridgeMetrics;
}

export function enforceMcpRateLimit(
  request: McpRateLimitRequest,
  response: McpRateLimitResponse,
  options: McpRateLimitOptions,
): boolean {
  if (request.path !== "/mcp") return true;

  const decision = options.limiter.check(
    hashRateLimitKey(
      "mcp-http",
      request.remoteAddress ?? "unknown",
      request.authorization ?? "anonymous",
      request.method,
      request.path,
    ),
    "mcp",
  );
  for (const [name, value] of Object.entries(rateLimitHeaders(decision))) response.setHeader(name, value);
  if (decision.allowed) return true;

  options.metrics?.recordRateLimitDenial({ service: "mcp", bucket: "mcp" });
  response.setHeader("Retry-After", decision.retryAfterSeconds.toString());
  response.status(429).json({
    error: "RATE_LIMITED",
    error_description: "Too many requests. Retry later.",
    details: { retryAfterSeconds: decision.retryAfterSeconds },
  });
  return false;
}
