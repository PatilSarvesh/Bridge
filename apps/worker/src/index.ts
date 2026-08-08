import { pathToFileURL } from "node:url";

import type { OutboxEvent } from "@bridge/domain";

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
}

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
  let processed = 0;
  let retried = 0;
  let deadLettered = 0;

  for (const event of events) {
    try {
      await handler(event);
      await store.completeOutboxEvent(event.id, now().toISOString());
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
      if (deadLetter) deadLettered += 1;
      else retried += 1;
    }
  }

  return { claimed: events.length, processed, retried, deadLettered };
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
    `${JSON.stringify({ service: "bridge-worker", jobs: ["decision-review-reminders", "assumption-expiry"], status: "ready" })}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReviewReminderCycle().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
