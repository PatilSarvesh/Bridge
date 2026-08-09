import type { Notification, OutboxDelivery, OutboxEvent } from "@bridge/domain";
import { describe, expect, it } from "vitest";

import {
  assumptionsDueForExpiry,
  createNotificationEmailHandler,
  decisionsDueForReview,
  renderEssentialEmailTemplate,
  runOutboxCycle,
  type EmailSendRequest,
  type EssentialEmailTemplateKind,
  type NotificationEmailStore,
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

function notification(id: string, type: Notification["type"] = "question_assigned"): Notification {
  return {
    id: `ntf_${id}`,
    organizationId: "org_worker",
    projectId: "prj_worker",
    recipientId: "usr_owner",
    type,
    title: "Transfer policy needs review",
    body: "A minimal Bridge activity summary is ready for review.",
    targetType: type.startsWith("artifact_") ? "artifact_version" : "question",
    targetId: type.startsWith("artifact_") ? "av_worker" : "qst_worker",
    createdAt: "2026-08-08T00:00:00.000Z",
  };
}

function notificationEvent(id: string, item: Notification): OutboxEvent {
  return {
    id,
    organizationId: item.organizationId,
    projectId: item.projectId,
    type: "notification.created",
    payload: {
      notificationId: item.id,
      recipientId: item.recipientId,
      notificationType: item.type,
      targetType: item.targetType,
      targetId: item.targetId,
    },
    status: "pending",
    attempts: 0,
    availableAt: item.createdAt,
    createdAt: item.createdAt,
  };
}

class TestNotificationEmailStore implements NotificationEmailStore {
  readonly notifications = new Map<string, Notification>();
  readonly deliveries = new Map<string, OutboxDelivery>();

  constructor(items: readonly Notification[]) {
    for (const item of items) this.notifications.set(item.id, item);
  }

  async getNotification(notificationId: string): Promise<Notification | undefined> {
    return this.notifications.get(notificationId);
  }

  async getOutboxDelivery(eventId: string, channel: "email"): Promise<OutboxDelivery | undefined> {
    return [...this.deliveries.values()].find(
      (delivery) => delivery.outboxEventId === eventId && delivery.channel === channel,
    );
  }

  async saveOutboxDelivery(delivery: OutboxDelivery): Promise<void> {
    this.deliveries.set(delivery.id, delivery);
  }
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

describe("notification email delivery", () => {
  it("renders all essential minimal-context templates with safe subjects and Bridge links", () => {
    const kinds: readonly EssentialEmailTemplateKind[] = [
      "assignment",
      "clarification",
      "blocking_escalation",
      "accepted_answer",
      "artifact_review",
    ];
    const rendered = kinds.map((kind) => renderEssentialEmailTemplate({
      kind,
      title: "Review needed\r\nBcc: attacker@example.test",
      context: "Open the authoritative Bridge record; no raw transcript is included.",
      actionUrl: "https://bridge.example.test/?view=notifications&projectId=prj_worker",
    }));

    expect(rendered.map((template) => template.subject)).toEqual([
      expect.stringContaining("Review assignment"),
      expect.stringContaining("Clarification"),
      expect.stringContaining("Blocking escalation"),
      expect.stringContaining("Answer accepted"),
      expect.stringContaining("Specification review"),
    ]);
    expect(rendered.every((template) => !template.subject.includes("\n"))).toBe(true);
    expect(rendered.every((template) => template.text.includes("https://bridge.example.test/"))).toBe(true);
  });

  it("delivers immediate email idempotently without persisting its address", async () => {
    const item = notification("email_immediate");
    const event = { ...notificationEvent("evt_email_immediate", item), status: "processing" as const, attempts: 1 };
    const store = new TestNotificationEmailStore([item]);
    const requests: EmailSendRequest[] = [];
    const handler = createNotificationEmailHandler({
      store,
      directory: {
        resolveEmailRecipient: async () => ({ address: "Owner@Example.Test", preference: "immediate" }),
      },
      sender: {
        send: async (request) => {
          requests.push(request);
          return { providerMessageId: "provider-message-001" };
        },
      },
      publicBaseUrl: "https://bridge.example.test/review",
      now: () => new Date("2026-08-08T00:00:01.000Z"),
    });

    await handler(event);
    await handler(event);
    expect(requests).toEqual([
      expect.objectContaining({
        to: "owner@example.test",
        idempotencyKey: "evt_email_immediate:email",
        subject: expect.stringContaining("Review assignment"),
      }),
    ]);
    const [delivery] = [...store.deliveries.values()];
    expect(delivery).toMatchObject({
      outboxEventId: event.id,
      channel: "email",
      status: "delivered",
      attemptCount: 1,
      preference: "immediate",
      providerMessageId: "provider-message-001",
      destinationHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(delivery)).not.toContain("owner@example.test");
  });

  it("honors ordinary muted/digest preferences while protected review email remains immediate", async () => {
    const muted = { ...notification("email_muted"), recipientId: "usr_muted" };
    const digest = { ...notification("email_digest", "question_comment"), recipientId: "usr_digest" };
    const protectedReview = { ...notification("email_protected", "question_review"), recipientId: "usr_protected" };
    const store = new TestNotificationEmailStore([muted, digest, protectedReview]);
    const requests: EmailSendRequest[] = [];
    const preferences = new Map([
      [muted.recipientId, "muted" as const],
      [digest.recipientId, "digest" as const],
      [protectedReview.recipientId, "muted" as const],
    ]);
    const handler = createNotificationEmailHandler({
      store,
      directory: {
        resolveEmailRecipient: async (recipientId) => ({
          address: `${recipientId}@example.test`,
          preference: preferences.get(recipientId) ?? "immediate",
        }),
      },
      sender: {
        send: async (request) => {
          requests.push(request);
          return { providerMessageId: `provider-${requests.length}` };
        },
      },
      publicBaseUrl: "https://bridge.example.test/",
    });

    await handler({ ...notificationEvent("evt_email_muted", muted), status: "processing", attempts: 1 });
    await handler({ ...notificationEvent("evt_email_digest", digest), status: "processing", attempts: 1 });
    await handler({ ...notificationEvent("evt_email_protected", protectedReview), status: "processing", attempts: 1 });

    expect([...store.deliveries.values()].map((delivery) => delivery.status)).toEqual([
      "suppressed",
      "deferred",
      "delivered",
    ]);
    expect(requests).toHaveLength(1);
  });

  it("records sanitized failures while the outbox exposes retry and permanent failure state", async () => {
    const item = notification("email_failure");
    const eventStore = new TestOutboxStore([notificationEvent("evt_email_failure", item)]);
    const emailStore = new TestNotificationEmailStore([item]);
    const handler = createNotificationEmailHandler({
      store: emailStore,
      directory: {
        resolveEmailRecipient: async () => ({ address: "owner@example.test", preference: "immediate" }),
      },
      sender: {
        send: async () => {
          throw new Error("SES rejected owner@example.test token=top-secret Bearer hidden-value");
        },
      },
      publicBaseUrl: "https://bridge.example.test/",
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    });

    const first = await runOutboxCycle(eventStore, handler, {
      now: () => new Date("2026-08-08T00:00:00.000Z"),
      maxAttempts: 2,
      baseBackoffMs: 1_000,
    });
    const second = await runOutboxCycle(eventStore, handler, {
      now: () => new Date("2026-08-08T00:00:02.000Z"),
      maxAttempts: 2,
      baseBackoffMs: 1_000,
    });

    expect(first).toEqual({ claimed: 1, processed: 0, retried: 1, deadLettered: 0 });
    expect(second).toEqual({ claimed: 1, processed: 0, retried: 0, deadLettered: 1 });
    expect(eventStore.events[0]).toMatchObject({ status: "dead_letter", attempts: 2 });
    const [delivery] = [...emailStore.deliveries.values()];
    expect(delivery).toMatchObject({ status: "failed", attemptCount: 2 });
    expect(delivery?.lastError).toContain("[redacted-email]");
    expect(delivery?.lastError).toContain("token=[redacted]");
    expect(delivery?.lastError).toContain("Bearer [redacted]");
    expect(delivery?.lastError).not.toContain("top-secret");
    expect(delivery?.lastError).not.toContain("hidden-value");
  });
});
