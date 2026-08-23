import type { OutboxEvent } from "@bridge/domain";
import { describe, expect, it } from "vitest";

import {
  loadWorkerConfiguration,
  runOutboxWorker,
  type OutboxWorkerOptions,
} from "./runtime.js";
import type { OutboxStore } from "./index.js";

function event(): OutboxEvent {
  return {
    id: "evt_runtime",
    correlationId: "cor_runtime",
    organizationId: "org_runtime",
    projectId: "prj_runtime",
    type: "notification.created",
    payload: {
      notificationId: "ntf_runtime",
      recipientId: "usr_runtime",
      notificationType: "question_assigned",
      targetType: "question",
      targetId: "qst_runtime",
    },
    status: "pending",
    attempts: 0,
    availableAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

class RuntimeStore implements OutboxStore {
  readonly events = [event()];
  completed = 0;
  failed = 0;

  async claimOutboxEvents(): Promise<readonly OutboxEvent[]> {
    const candidate = this.events[0];
    if (!candidate || candidate.status !== "pending") return [];
    const claimed = { ...candidate, status: "processing" as const, attempts: 1 };
    this.events[0] = claimed;
    return [claimed];
  }

  async completeOutboxEvent(): Promise<void> {
    this.completed += 1;
    this.events[0] = { ...this.events[0]!, status: "processed" };
  }

  async failOutboxEvent(): Promise<void> {
    this.failed += 1;
  }
}

describe("worker runtime", () => {
  it("loads a maintenance-database Slack configuration with bounded defaults", () => {
    expect(loadWorkerConfiguration({
      BRIDGE_WORKER_DATABASE_URL: "postgresql://worker:password@example.test/bridge",
    })).toEqual({
      databaseUrl: "postgresql://worker:password@example.test/bridge",
      publicWebUrl: "http://127.0.0.1:3000/",
      channel: "slack",
      pollIntervalMs: 1_000,
      batchSize: 25,
      assumptionExpiryIntervalMs: 60_000,
      blockingQuestionEscalationIntervalMs: 60_000,
      emailDigestIntervalMs: 60_000,
      maxAttempts: 5,
      baseBackoffMs: 1_000,
      maxBackoffMs: 900_000,
      retryJitterRatio: 0.25,
      codexExecutable: "codex",
      codexContinuationTimeoutMs: 900_000,
      metricsHost: "127.0.0.1",
      metricsPort: 4_200,
    });
  });

  it("rejects unsupported channels and unsafe public URLs", () => {
    expect(() => loadWorkerConfiguration({
      BRIDGE_WORKER_DATABASE_URL: "postgresql://worker@example.test/bridge",
      BRIDGE_WORKER_CHANNEL: "email",
    })).toThrow("BRIDGE_WORKER_CHANNEL currently supports only `slack`.");
    expect(() => loadWorkerConfiguration({
      BRIDGE_WORKER_DATABASE_URL: "postgresql://worker@example.test/bridge",
      BRIDGE_PUBLIC_WEB_URL: "file:///tmp/bridge",
    })).toThrow("BRIDGE_PUBLIC_WEB_URL must use HTTP or HTTPS.");
    expect(() => loadWorkerConfiguration({
      BRIDGE_WORKER_DATABASE_URL: "postgresql://worker@example.test/bridge",
      BRIDGE_WORKER_RETRY_JITTER_PERCENT: "101",
    })).toThrow("BRIDGE_WORKER_RETRY_JITTER_PERCENT must be between 0 and 100.");
    expect(() => loadWorkerConfiguration({
      BRIDGE_WORKER_DATABASE_URL: "postgresql://worker@example.test/bridge",
      BRIDGE_WORKER_BASE_BACKOFF_MS: "5000",
      BRIDGE_WORKER_MAX_BACKOFF_MS: "1000",
    })).toThrow("BRIDGE_WORKER_MAX_BACKOFF_MS must be at least BRIDGE_WORKER_BASE_BACKOFF_MS.");
    expect(() => loadWorkerConfiguration({
      BRIDGE_WORKER_DATABASE_URL: "postgresql://worker@example.test/bridge",
      BRIDGE_WORKER_METRICS_HOST: "http://example.test",
    })).toThrow("BRIDGE_WORKER_METRICS_HOST must be a hostname or IP address without a URL scheme.");
    expect(() => loadWorkerConfiguration({
      BRIDGE_WORKER_DATABASE_URL: "postgresql://worker@example.test/bridge",
      BRIDGE_CODEX_CONTINUATION_TIMEOUT_MS: "999",
    })).toThrow("BRIDGE_CODEX_CONTINUATION_TIMEOUT_MS must be between 1000 and 3600000.");
  });

  it("processes a cycle and stops cleanly when the worker is aborted", async () => {
    const store = new RuntimeStore();
    const controller = new AbortController();
    const logs: string[] = [];
    const options: OutboxWorkerOptions = {
      store,
      handler: async () => controller.abort(),
      pollIntervalMs: 250,
      signal: controller.signal,
      logger: {
        info: (name) => logs.push(name),
        warn: (name) => logs.push(name),
        error: (name) => logs.push(name),
      },
      sleep: async () => undefined,
    };

    await runOutboxWorker(options);

    expect(store.completed).toBe(1);
    expect(store.failed).toBe(0);
    expect(logs).toContain("worker.cycle_completed");
  });

  it("runs the scheduled assumption expiry cycle before delivery work", async () => {
    const store = new RuntimeStore();
    const controller = new AbortController();
    const logs: string[] = [];
    let expiryRuns = 0;
    let escalationRuns = 0;
    let digestRuns = 0;
    await runOutboxWorker({
      store,
      handler: async () => controller.abort(),
      assumptionExpiryCycle: async () => {
        expiryRuns += 1;
        return { expiredCount: 2 };
      },
      assumptionExpiryIntervalMs: 1_000,
      blockingQuestionEscalationCycle: async () => {
        escalationRuns += 1;
        return { escalatedCount: 1 };
      },
      blockingQuestionEscalationIntervalMs: 1_000,
      emailDigestCycle: async () => {
        digestRuns += 1;
        return { claimed: 2, digestsSent: 1, delivered: 2, suppressed: 0, retried: 0, failed: 0 };
      },
      emailDigestIntervalMs: 1_000,
      pollIntervalMs: 250,
      signal: controller.signal,
      logger: {
        info: (name) => logs.push(name),
        warn: (name) => logs.push(name),
        error: (name) => logs.push(name),
      },
      sleep: async () => undefined,
    });

    expect(expiryRuns).toBe(1);
    expect(escalationRuns).toBe(1);
    expect(digestRuns).toBe(1);
    expect(logs).toContain("assumption_expiry.cycle_completed");
    expect(logs).toContain("blocking_question_escalation.cycle_completed");
    expect(logs).toContain("email_digest.cycle_completed");
  });

  it("validates the polling interval before opening a worker loop", async () => {
    await expect(runOutboxWorker({
      store: new RuntimeStore(),
      handler: async () => undefined,
      pollIntervalMs: 100,
    })).rejects.toThrow("Worker poll interval must be between 250 and 60000 milliseconds.");
  });
});
