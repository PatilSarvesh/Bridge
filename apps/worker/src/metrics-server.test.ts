import { BridgeMetrics } from "@bridge/observability";
import { describe, expect, it } from "vitest";

import { workerMetricsHttpResponse } from "./metrics-server.js";

describe("worker metrics HTTP surface", () => {
  it("serves bounded Prometheus metrics without reflecting request or tenant content", () => {
    const metrics = new BridgeMetrics();
    metrics.recordOutboxCycle({
      claimed: 3,
      processed: 1,
      retried: 1,
      deadLettered: 1,
      oldestClaimedAgeMs: 12_000,
      observedAtMs: Date.parse("2026-08-23T00:00:00.000Z"),
    });
    const secretPath = "/projects/prj_secret?token=must-not-appear";
    expect(workerMetricsHttpResponse(metrics, "GET", secretPath)).toMatchObject({
      statusCode: 404,
      body: "Not found\n",
    });

    const response = workerMetricsHttpResponse(metrics, "GET", "/metrics");

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "cache-control": "no-store",
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
    expect(response.body).toContain("bridge_outbox_events_total");
    expect(response.body).toContain(
      'bridge_http_requests_total{operation="/metrics",outcome="success",service="worker"} 1',
    );
    expect(response.body).toContain(
      'bridge_http_requests_total{operation="unmatched",outcome="client_error",service="worker"} 1',
    );
    expect(response.body).not.toContain("prj_secret");
    expect(response.body).not.toContain("must-not-appear");
  });

  it("supports HEAD, rejects mutations, and collapses malformed targets", () => {
    const metrics = new BridgeMetrics();

    expect(workerMetricsHttpResponse(metrics, "HEAD", "/metrics")).toMatchObject({
      statusCode: 200,
      body: "",
    });
    expect(workerMetricsHttpResponse(metrics, "POST", "/metrics")).toMatchObject({
      statusCode: 405,
      headers: expect.objectContaining({ allow: "GET, HEAD" }),
      body: "Method not allowed\n",
    });
    expect(workerMetricsHttpResponse(metrics, "GET", "http://[")).toMatchObject({
      statusCode: 404,
      body: "Not found\n",
    });
    expect(metrics.renderPrometheus()).not.toContain("http://[");
  });
});
