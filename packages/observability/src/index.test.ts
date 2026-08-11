import { describe, expect, it } from "vitest";

import {
  BridgeMetrics,
  correlationIdPattern,
  createSafeLogger,
  currentCorrelationContext,
  redactLogAttributes,
  resolveCorrelationId,
  runWithCorrelationContext,
  runWithCorrelationContextIfAbsent,
} from "./index.js";

describe("Bridge observability primitives", () => {
  it("accepts bounded safe correlation IDs and replaces unsafe input", () => {
    expect(resolveCorrelationId(" web_request-001 ")).toBe("web_request-001");
    const generated = resolveCorrelationId("unsafe\r\nheader");
    expect(generated).toMatch(correlationIdPattern);
    expect(generated).not.toContain("unsafe");
    runWithCorrelationContext({ correlationId: "unsafe\ncontext", source: "worker" }, () => {
      expect(currentCorrelationContext()?.correlationId).toMatch(correlationIdPattern);
      expect(currentCorrelationContext()?.correlationId).not.toContain("unsafe");
    });
  });

  it("preserves an existing correlation context across async application work", async () => {
    await runWithCorrelationContext(
      { correlationId: "cli_request-002", source: "cli" },
      async () => {
        await Promise.resolve();
        expect(currentCorrelationContext()).toEqual({
          correlationId: "cli_request-002",
          source: "cli",
        });
        runWithCorrelationContextIfAbsent("application", () => {
          expect(currentCorrelationContext()?.correlationId).toBe("cli_request-002");
        });
      },
    );
    expect(currentCorrelationContext()).toBeUndefined();
  });

  it("redacts secrets, artifact content, error messages, and unknown free-form strings", () => {
    const lines: string[] = [];
    const logger = createSafeLogger({
      service: "bridge-api",
      sink: (line) => lines.push(line),
      now: () => new Date("2026-08-10T00:00:00.000Z"),
    });
    runWithCorrelationContext({ correlationId: "api_request-003", source: "api" }, () => {
      logger.error("request.failed", {
        projectId: "prj_safe",
        statusCode: 500,
        authorization: "Bearer SENSITIVE_TOKEN",
        artifactBody: "private specification",
        arbitraryNote: "free-form customer content",
        error: new Error("database password=SENSITIVE_PASSWORD"),
        correlationId: "forged_correlation",
        service: "forged-service",
        event: "forged-event",
      });
    });

    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      timestamp: "2026-08-10T00:00:00.000Z",
      level: "error",
      service: "bridge-api",
      event: "request.failed",
      correlationId: "api_request-003",
      source: "api",
      projectId: "prj_safe",
      statusCode: 500,
      authorization: "[redacted]",
      artifactBody: "[redacted]",
      arbitraryNote: "[redacted]",
      error: { errorName: "Error" },
    });
    expect(JSON.stringify(record)).not.toContain("SENSITIVE");
    expect(redactLogAttributes({ prompt: "private", count: 2 })).toEqual({
      prompt: "[redacted]",
      count: 2,
    });
  });

  it("renders bounded request, context, database, outbox, and delivery metrics", () => {
    const metrics = new BridgeMetrics();
    metrics.recordHttpRequest({
      service: "api",
      operation: "/v1/projects/:projectId/context?ignored=true",
      statusCode: 403,
      durationMs: 125,
    });
    metrics.recordContextRetrieval({
      outcome: "success",
      durationMs: 50,
      resultCount: 4,
      candidateCount: 12,
    });
    metrics.recordDatabaseTransaction({ backend: "postgresql", outcome: "success", durationMs: 20 });
    metrics.recordOutboxCycle({
      claimed: 3,
      processed: 1,
      retried: 1,
      deadLettered: 1,
      oldestClaimedAgeMs: 12_000,
      observedAtMs: 1_786_320_000_000,
    });
    metrics.recordNotificationDelivery({ channel: "email", outcome: "delivered", durationMs: 30 });
    metrics.recordContentSecretDetection({
      contentType: "artifact",
      secretType: "private_key",
    });

    const snapshot = metrics.snapshot();
    expect(snapshot.counters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "bridge_authorization_denials_total",
        labels: { service: "api", operation: "/v1/projects/:projectId/context", status: "403" },
        value: 1,
      }),
      expect.objectContaining({
        name: "bridge_outbox_events_total",
        labels: { outcome: "dead_lettered" },
        value: 1,
      }),
      expect.objectContaining({
        name: "bridge_content_secret_detections_total",
        labels: { content_type: "artifact", secret_type: "private_key" },
        value: 1,
      }),
    ]));
    expect(snapshot.gauges).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "bridge_outbox_last_cycle_claimed", value: 3 }),
      expect.objectContaining({ name: "bridge_outbox_oldest_claimed_age_seconds", value: 12 }),
      expect.objectContaining({ name: "bridge_outbox_last_cycle_timestamp_seconds", value: 1_786_320_000 }),
    ]));
    expect(snapshot.histograms).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "bridge_context_candidate_count", count: 1, sum: 12 }),
      expect.objectContaining({ name: "bridge_http_request_duration_seconds", count: 1, sum: 0.125 }),
    ]));

    const rendered = metrics.renderPrometheus();
    expect(rendered).toContain("# TYPE bridge_http_requests_total counter");
    expect(rendered).toContain('bridge_http_requests_total{operation="/v1/projects/:projectId/context",outcome="client_error",service="api"} 1');
    expect(rendered).toContain('bridge_http_request_duration_seconds_bucket{le="+Inf",operation="/v1/projects/:projectId/context",service="api"} 1');
    expect(rendered).toContain('bridge_content_secret_detections_total{content_type="artifact",secret_type="private_key"} 1');
    expect(rendered).not.toContain("ignored=true");
    expect(rendered).not.toContain("organizationId");
    expect(rendered).not.toContain("projectId=prj_");

    for (let index = 0; index < 140; index += 1) {
      metrics.recordHttpRequest({
        service: "api",
        operation: `/cardinality-test/${index}`,
        statusCode: 200,
        durationMs: 1,
      });
    }
    const boundedRequests = metrics.snapshot().counters.filter(
      (sample) => sample.name === "bridge_http_requests_total",
    );
    expect(boundedRequests).toHaveLength(129);
    expect(boundedRequests).toContainEqual(expect.objectContaining({
      labels: { service: "api", operation: "overflow", outcome: "success" },
      value: 13,
    }));
  });
});
