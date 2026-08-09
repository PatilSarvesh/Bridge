import { describe, expect, it } from "vitest";

import {
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
});
