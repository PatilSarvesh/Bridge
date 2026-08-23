import { pathToFileURL } from "node:url";

import type { OutboxEvent } from "@bridge/domain";
import {
  type BridgeMetrics,
  createSafeLogger,
  runWithCorrelationContext,
  type SafeLogger,
} from "@bridge/observability";

export * from "./email.js";
export * from "./slack.js";

export interface ReviewableDecision {
  readonly id: string;
  readonly status: "active" | "superseded" | "expired" | "revoked";
  readonly reviewAt: string;
}

export interface ExpirableAssumption {
  readonly id: string;
  readonly status: "active" | "confirmed" | "rejected" | "expired" | "superseded";
  readonly expiresAt: string;
}

export interface OutboxStore {
  claimOutboxEvents(now: string, limit: number): Promise<readonly OutboxEvent[]>;
  completeOutboxEvent(eventId: string, processedAt: string): Promise<void>;
  failOutboxEvent(
    eventId: string,
    lastError: string,
    availableAt: string,
    deadLetter: boolean,
  ): Promise<void>;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

export interface OutboxCycleOptions {
  readonly now?: () => Date;
  readonly batchSize?: number;
  readonly maxAttempts?: number;
  readonly baseBackoffMs?: number;
  readonly logger?: SafeLogger;
  readonly metrics?: BridgeMetrics;
}

export interface AssumptionExpiryCycleResult {
  readonly expiredCount: number;
}

export type AssumptionExpiryCycle = () => Promise<AssumptionExpiryCycleResult>;

export interface BlockingQuestionEscalationCycleResult {
  readonly escalatedCount: number;
}

export type BlockingQuestionEscalationCycle = () => Promise<BlockingQuestionEscalationCycleResult>;

export interface OutboxCycleResult {
  readonly claimed: number;
  readonly processed: number;
  readonly retried: number;
  readonly deadLettered: number;
}

export async function runOutboxCycle(
  store: OutboxStore,
  handler: OutboxHandler,
  options: OutboxCycleOptions = {},
): Promise<OutboxCycleResult> {
  const now = options.now ?? (() => new Date());
  const currentTime = now();
  const maxAttempts = options.maxAttempts ?? 5;
  const baseBackoffMs = options.baseBackoffMs ?? 1_000;
  const events = await store.claimOutboxEvents(currentTime.toISOString(), options.batchSize ?? 25);
  const oldestClaimedAgeMs = events.length === 0
    ? 0
    : Math.max(
        0,
        currentTime.getTime() - Math.min(...events.map((event) => new Date(event.createdAt).getTime())),
      );
  let processed = 0;
  let retried = 0;
  let deadLettered = 0;

  for (const event of events) {
    await runWithCorrelationContext(
      { correlationId: event.correlationId, source: "worker" },
      async () => {
        try {
          await handler(event);
          await store.completeOutboxEvent(event.id, now().toISOString());
          options.logger?.info("outbox.processed", {
            eventId: event.id,
            projectId: event.projectId,
            type: event.type,
            attempts: event.attempts,
            status: "processed",
          });
          processed += 1;
        } catch (error) {
          const lastError = error instanceof Error ? error.message : String(error);
          const deadLetter = event.attempts >= maxAttempts;
          const delay = deadLetter ? 0 : baseBackoffMs * 2 ** Math.max(0, event.attempts - 1);
          await store.failOutboxEvent(
            event.id,
            lastError,
            new Date(currentTime.getTime() + delay).toISOString(),
            deadLetter,
          );
          options.logger?.error("outbox.failed", {
            eventId: event.id,
            projectId: event.projectId,
            type: event.type,
            attempts: event.attempts,
            status: deadLetter ? "dead_letter" : "retry_scheduled",
            error,
          });
          if (deadLetter) deadLettered += 1;
          else retried += 1;
        }
      },
    );
  }

  const result = { claimed: events.length, processed, retried, deadLettered };
  options.metrics?.recordOutboxCycle({
    ...result,
    oldestClaimedAgeMs,
    observedAtMs: currentTime.getTime(),
  });
  return result;
}

export function decisionsDueForReview(
  decisions: readonly ReviewableDecision[],
  now: Date,
): readonly ReviewableDecision[] {
  const nowTime = now.getTime();
  return decisions.filter(
    (decision) => decision.status === "active" && new Date(decision.reviewAt).getTime() <= nowTime,
  );
}

export function assumptionsDueForExpiry(
  assumptions: readonly ExpirableAssumption[],
  now: Date,
): readonly ExpirableAssumption[] {
  const nowTime = now.getTime();
  return assumptions.filter(
    (assumption) =>
      assumption.status === "active" && new Date(assumption.expiresAt).getTime() <= nowTime,
  );
}

export async function runReviewReminderCycle(): Promise<void> {
  // Durable notification delivery is available through runOutboxCycle. Scheduling
  // reminder and expiry policy remains a deployment concern, so this entry point
  // reports the jobs that an operator-provided scheduler should invoke.
  process.stdout.write(
    `${JSON.stringify({ service: "bridge-worker", jobs: ["decision-review-reminders", "assumption-expiry", "blocking-question-escalation", "email-digest"], status: "ready" })}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logger = createSafeLogger({ service: "bridge-worker" });
  const controller = new AbortController();
  const stop = (): void => {
    logger.info("service.shutdown_requested", { status: "stopping" });
    controller.abort();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  void import("./runtime.js")
    .then(async ({ createConfiguredWorker, loadWorkerConfiguration, runOutboxWorker }) => {
      const configuration = loadWorkerConfiguration();
      const runtime = createConfiguredWorker(configuration);
      try {
        await runtime.store.repository.checkHealth();
        logger.info("service.started", {
          channel: configuration.channel,
          pollIntervalMs: configuration.pollIntervalMs,
          batchSize: configuration.batchSize,
          status: "ready",
        });
        await runOutboxWorker({
          store: runtime.store.repository,
          handler: runtime.handler,
          pollIntervalMs: configuration.pollIntervalMs,
          cycleOptions: {
            batchSize: configuration.batchSize,
            maxAttempts: configuration.maxAttempts,
            baseBackoffMs: configuration.baseBackoffMs,
          },
          assumptionExpiryCycle: runtime.assumptionExpiryCycle,
          assumptionExpiryIntervalMs: configuration.assumptionExpiryIntervalMs,
          blockingQuestionEscalationCycle: runtime.blockingQuestionEscalationCycle,
          blockingQuestionEscalationIntervalMs: configuration.blockingQuestionEscalationIntervalMs,
          emailDigestIntervalMs: configuration.emailDigestIntervalMs,
          signal: controller.signal,
        });
      } finally {
        await runtime.close();
      }
    })
    .catch((error: unknown) => {
      logger.error("service.failed", { error });
      process.exitCode = 1;
    })
    .finally(() => {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
    });
}
