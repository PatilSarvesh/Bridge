import { BridgeMetrics } from "@bridge/observability";
import { describe, expect, it } from "vitest";

import { workerHttpResponse, workerMetricsHttpResponse } from "./metrics-server.js";

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

  it("reports liveness without depending on PostgreSQL", async () => {
    const metrics = new BridgeMetrics();
    let checks = 0;
    const response = await workerHttpResponse(metrics, "GET", "/health/live", async () => {
      checks += 1;
      throw new Error("database unavailable");
    });

    expect(response).toMatchObject({
      statusCode: 200,
      headers: expect.objectContaining({ "cache-control": "no-store" }),
    });
    expect(JSON.parse(response.body)).toEqual({ service: "bridge-worker", status: "ok" });
    expect(checks).toBe(0);
  });

  it("reports repository-backed readiness and sanitizes failures", async () => {
    const metrics = new BridgeMetrics();
    const ready = await workerHttpResponse(metrics, "GET", "/health/ready", async () => ({
      status: "ready",
      checks: [{ name: "repository", status: "ready", backend: "postgresql" }],
    }));

    expect(ready.statusCode).toBe(200);
    expect(JSON.parse(ready.body)).toEqual({
      service: "bridge-worker",
      status: "ready",
      checks: [{ name: "repository", status: "ready", backend: "postgresql" }],
    });

    const failed = await workerHttpResponse(metrics, "GET", "/health/ready", async () => {
      throw new Error("postgresql://secret@database/bridge");
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).toContain("Repository dependency is unavailable.");
    expect(failed.body).not.toContain("postgresql://");
    expect(failed.body).not.toContain("secret");
  });

  it("bounds slow readiness checks and rejects health mutations", async () => {
    const metrics = new BridgeMetrics();
    const slow = await workerHttpResponse(metrics, "HEAD", "/health/ready", () => new Promise(() => undefined), 5);
    expect(slow).toMatchObject({ statusCode: 503, body: "" });

    const mutation = await workerHttpResponse(metrics, "POST", "/health/live", async () => ({
      status: "ready",
      checks: [{ name: "repository", status: "ready", backend: "postgresql" }],
    }));
    expect(mutation).toMatchObject({
      statusCode: 405,
      headers: expect.objectContaining({ allow: "GET, HEAD" }),
    });
  });
});
