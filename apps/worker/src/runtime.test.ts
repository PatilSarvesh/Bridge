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
      maxAttempts: 5,
      baseBackoffMs: 1_000,
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

  it("validates the polling interval before opening a worker loop", async () => {
    await expect(runOutboxWorker({
      store: new RuntimeStore(),
      handler: async () => undefined,
      pollIntervalMs: 100,
    })).rejects.toThrow("Worker poll interval must be between 250 and 60000 milliseconds.");
  });
});
