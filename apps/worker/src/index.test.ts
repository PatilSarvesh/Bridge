import type { OutboxEvent } from "@bridge/domain";
import { describe, expect, it } from "vitest";

import {
  assumptionsDueForExpiry,
  decisionsDueForReview,
  runOutboxCycle,
  type OutboxStore,
} from "./index.js";

class TestOutboxStore implements OutboxStore {
  constructor(readonly events: OutboxEvent[]) {}

  async claimOutboxEvents(now: string, limit: number): Promise<readonly OutboxEvent[]> {
    const nowTime = Date.parse(now);
    const candidates = this.events
      .filter(
        (event) =>
          (event.status === "pending" || event.status === "failed" || event.status === "processing") &&
          Date.parse(event.availableAt) <= nowTime &&
          (!event.leaseUntil || Date.parse(event.leaseUntil) <= nowTime),
      )
      .sort((left, right) => left.availableAt.localeCompare(right.availableAt))
      .slice(0, limit);
    return candidates.map((event) => {
      const { lastError: _lastError, processedAt: _processedAt, leaseUntil: _leaseUntil, ...base } = event;
      const claimed: OutboxEvent = {
        ...base,
        status: "processing",
        attempts: event.attempts + 1,
        leaseUntil: new Date(nowTime + 5 * 60 * 1_000).toISOString(),
      };
      this.events[this.events.findIndex((candidate) => candidate.id === event.id)] = claimed;
      return claimed;
    });
  }

  async completeOutboxEvent(eventId: string, processedAt: string): Promise<void> {
    const index = this.events.findIndex((event) => event.id === eventId);
    if (index < 0) return;
    const { lastError: _lastError, leaseUntil: _leaseUntil, ...base } = this.events[index]!;
    this.events[index] = { ...base, status: "processed", processedAt };
  }

  async failOutboxEvent(
    eventId: string,
    lastError: string,
    availableAt: string,
    deadLetter: boolean,
  ): Promise<void> {
    const index = this.events.findIndex((event) => event.id === eventId);
    if (index < 0) return;
    const { leaseUntil: _leaseUntil, processedAt: _processedAt, ...base } = this.events[index]!;
    this.events[index] = {
      ...base,
      status: deadLetter ? "dead_letter" : "failed",
      availableAt,
      lastError,
    };
  }
}

function outboxEvent(id: string): OutboxEvent {
  return {
    id,
    organizationId: "org_worker",
    projectId: "prj_worker",
    type: "notification.created",
    payload: {
      notificationId: `ntf_${id}`,
      recipientId: "usr_owner",
      notificationType: "question_assigned",
      targetType: "question",
      targetId: "qst_worker",
    },
    status: "pending",
    attempts: 0,
    availableAt: "2026-08-08T00:00:00.000Z",
    createdAt: "2026-08-08T00:00:00.000Z",
  };
}

describe("decision review reminders", () => {
  it("returns only active decisions whose review date has arrived", () => {
    const due = decisionsDueForReview(
      [
        { id: "due", status: "active", reviewAt: "2026-08-07T00:00:00.000Z" },
        { id: "future", status: "active", reviewAt: "2026-08-08T00:00:00.000Z" },
        { id: "closed", status: "superseded", reviewAt: "2026-08-01T00:00:00.000Z" },
      ],
      new Date("2026-08-07T12:00:00.000Z"),
    );

    expect(due.map((decision) => decision.id)).toEqual(["due"]);
  });

  it("returns only active assumptions whose expiry has arrived", () => {
    const due = assumptionsDueForExpiry(
      [
        { id: "due", status: "active", expiresAt: "2026-08-07T00:00:00.000Z" },
        { id: "future", status: "active", expiresAt: "2026-08-08T00:00:00.000Z" },
        { id: "confirmed", status: "confirmed", expiresAt: "2026-08-01T00:00:00.000Z" },
      ],
      new Date("2026-08-07T12:00:00.000Z"),
    );

    expect(due.map((assumption) => assumption.id)).toEqual(["due"]);
  });
});

describe("notification outbox cycle", () => {
  it("claims and completes events through an injected delivery handler", async () => {
    const store = new TestOutboxStore([outboxEvent("evt_one"), outboxEvent("evt_two")]);
    const delivered: string[] = [];
    const result = await runOutboxCycle(store, async (event) => {
      delivered.push(event.id);
    }, { now: () => new Date("2026-08-08T00:00:00.000Z") });

    expect(result).toEqual({ claimed: 2, processed: 2, retried: 0, deadLettered: 0 });
    expect(delivered).toEqual(["evt_one", "evt_two"]);
    expect(store.events.every((event) => event.status === "processed")).toBe(true);
  });

  it("retries failures and dead-letters after the configured attempt budget", async () => {
    const store = new TestOutboxStore([outboxEvent("evt_retry")]);
    const handler = async () => {
      throw new Error("downstream unavailable");
    };
    const first = await runOutboxCycle(store, handler, {
      now: () => new Date("2026-08-08T00:00:00.000Z"),
      maxAttempts: 2,
      baseBackoffMs: 1_000,
    });
    const second = await runOutboxCycle(store, handler, {
      now: () => new Date("2026-08-08T00:00:02.000Z"),
      maxAttempts: 2,
      baseBackoffMs: 1_000,
    });

    expect(first).toEqual({ claimed: 1, processed: 0, retried: 1, deadLettered: 0 });
    expect(second).toEqual({ claimed: 1, processed: 0, retried: 0, deadLettered: 1 });
    expect(store.events[0]).toMatchObject({ status: "dead_letter", attempts: 2, lastError: "downstream unavailable" });
  });
});
