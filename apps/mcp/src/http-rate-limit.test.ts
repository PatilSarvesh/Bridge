import { BridgeMetrics, BridgeRateLimiter } from "@bridge/observability";
import { describe, expect, it } from "vitest";

import { enforceMcpRateLimit, type McpRateLimitResponse } from "./http-rate-limit.js";

class TestResponse implements McpRateLimitResponse {
  readonly headers: Record<string, string> = {};
  statusCode = 200;
  body: unknown;

  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  status(code: number): McpRateLimitResponse {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): void {
    this.body = body;
  }
}

describe("Bridge MCP HTTP rate limiting", () => {
  it("returns bounded headers and a retryable error without limiting health paths", () => {
    let now = 0;
    const metrics = new BridgeMetrics();
    const limiter = new BridgeRateLimiter({
      now: () => now,
      policies: { mcp: { maxRequests: 1, windowMs: 1_000 } },
    });
    const request = {
      method: "POST",
      path: "/mcp",
      remoteAddress: "127.0.0.1",
      authorization: "Bearer sensitive-token",
    };
    const firstResponse = new TestResponse();
    expect(enforceMcpRateLimit(request, firstResponse, { limiter, metrics })).toBe(true);
    expect(firstResponse.headers).toMatchObject({
      "ratelimit-limit": "1",
      "ratelimit-remaining": "0",
      "ratelimit-reset": "1",
    });

    const secondResponse = new TestResponse();
    expect(enforceMcpRateLimit(request, secondResponse, { limiter, metrics })).toBe(false);
    expect(secondResponse.statusCode).toBe(429);
    expect(secondResponse.headers).toMatchObject({
      "retry-after": "1",
      "ratelimit-reset": "1",
    });
    expect(secondResponse.body).toEqual({
      error: "RATE_LIMITED",
      error_description: "Too many requests. Retry later.",
      details: { retryAfterSeconds: 1 },
    });
    expect(JSON.stringify(secondResponse.body)).not.toContain("sensitive-token");

    const healthResponse = new TestResponse();
    expect(enforceMcpRateLimit({ ...request, path: "/health" }, healthResponse, { limiter, metrics })).toBe(true);
    expect(healthResponse.headers).toEqual({});
    expect(metrics.renderPrometheus()).toContain(
      'bridge_rate_limit_denials_total{bucket="mcp",service="mcp"} 1',
    );

    now = 1_000;
    expect(enforceMcpRateLimit(request, new TestResponse(), { limiter, metrics })).toBe(true);
  });
});
