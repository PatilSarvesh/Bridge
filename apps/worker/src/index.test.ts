import type {
  Notification,
  NotificationQuestionContext,
  OutboxDelivery,
  OutboxEvent,
} from "@bridge/domain";
import { BridgeMetrics, currentCorrelationId } from "@bridge/observability";
import { describe, expect, it } from "vitest";

import {
  assumptionsDueForExpiry,
  createNotificationEmailHandler,
  decisionsDueForReview,
  renderEssentialEmailTemplate,
  runOutboxCycle,
  createNotificationSlackHandler,
  createSlackChannelDirectory,
  createSlackChannelDirectoryFromEnvironment,
  createSlackWebhookSender,
  renderSlackNotification,
  type EmailSendRequest,
  type EssentialEmailTemplateKind,
  type NotificationEmailStore,
  type OutboxStore,
  type SlackNotificationStore,
  type SlackSendRequest,
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
    correlationId: `cor_${id}`,
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
    correlationId: `cor_${id}`,
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

class TestNotificationSlackStore implements SlackNotificationStore {
  readonly notifications = new Map<string, Notification>();
  readonly deliveries = new Map<string, OutboxDelivery>();

  constructor(items: readonly Notification[]) {
    for (const item of items) this.notifications.set(item.id, item);
  }

  async getNotification(notificationId: string): Promise<Notification | undefined> {
    return this.notifications.get(notificationId);
  }

  async getOutboxDelivery(eventId: string, channel: "slack"): Promise<OutboxDelivery | undefined> {
    return [...this.deliveries.values()].find(
      (delivery) => delivery.outboxEventId === eventId && delivery.channel === channel,
    );
  }

  async listOutboxDeliveries(projectId: string): Promise<readonly OutboxDelivery[]> {
    return [...this.deliveries.values()].filter((delivery) => delivery.projectId === projectId);
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
    const metrics = new BridgeMetrics();
    const store = new TestOutboxStore([outboxEvent("evt_one"), outboxEvent("evt_two")]);
    const delivered: string[] = [];
    const correlations: Array<string | undefined> = [];
    const result = await runOutboxCycle(store, async (event) => {
      delivered.push(event.id);
      correlations.push(currentCorrelationId());
    }, { now: () => new Date("2026-08-08T00:00:00.000Z"), metrics });

    expect(result).toEqual({ claimed: 2, processed: 2, retried: 0, deadLettered: 0 });
    expect(delivered).toEqual(["evt_one", "evt_two"]);
    expect(correlations).toEqual(["cor_evt_one", "cor_evt_two"]);
    expect(store.events.every((event) => event.status === "processed")).toBe(true);
    expect(metrics.snapshot().counters).toContainEqual({
      name: "bridge_outbox_events_total",
      labels: { outcome: "processed" },
      value: 2,
    });
    expect(metrics.snapshot().gauges).toContainEqual({
      name: "bridge_outbox_last_cycle_claimed",
      labels: {},
      value: 2,
    });
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
    const metrics = new BridgeMetrics();
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
      metrics,
    });

    await handler(event);
    await handler(event);
    expect(requests).toEqual([
      expect.objectContaining({
        to: "owner@example.test",
        idempotencyKey: "evt_email_immediate:email",
        correlationId: "cor_evt_email_immediate",
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
    expect(metrics.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "bridge_notification_deliveries_total",
        labels: { channel: "email", outcome: "delivered" },
        value: 1,
      }),
      expect.objectContaining({
        name: "bridge_notification_deliveries_total",
        labels: { channel: "email", outcome: "skipped" },
        value: 1,
      }),
    ]));
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

describe("Slack notification delivery", () => {
  const questionContext: NotificationQuestionContext = {
    id: "qst_worker",
    status: "in_discussion",
    risk: "protected",
    ownerIds: ["usr_owner"],
  };

  it("renders question status, risk, owner, and a Bridge link without the notification body", async () => {
    const item = notification("slack_render");
    const rendered = await renderSlackNotification(
      item,
      questionContext,
      "https://bridge.example.test/",
      { resolveDisplayName: async () => "Architecture Owner" },
    );

    expect(rendered.text).toContain("status: in_discussion");
    expect(rendered.text).toContain("risk: protected");
    expect(rendered.text).toContain("owner: Architecture Owner");
    expect(rendered.text).toContain("view=questions");
    expect(rendered.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining("Status") }),
          expect.objectContaining({ text: expect.stringContaining("Risk") }),
          expect.objectContaining({ text: expect.stringContaining("Owner") }),
        ]),
      }),
      expect.objectContaining({
        elements: expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining("Final acceptance and approval remain in Bridge") }),
        ]),
      }),
    ]));
    expect(JSON.stringify(rendered)).not.toContain(item.body);
  });

  it("uses the configured Slack webhook once for duplicate event delivery", async () => {
    const metrics = new BridgeMetrics();
    const item = notification("slack_delivery");
    const event = {
      ...notificationEvent("evt_slack_delivery", item),
      status: "processing" as const,
      attempts: 1,
      payload: {
        ...notificationEvent("evt_slack_delivery", item).payload,
        questionContext,
      },
    };
    const store = new TestNotificationSlackStore([item]);
    const requests: SlackSendRequest[] = [];
    const handler = createNotificationSlackHandler({
      store,
      channels: createSlackChannelDirectory({
        prj_worker: "https://hooks.slack.com/services/T000/B000/secret",
      }),
      sender: {
        send: async (request) => {
          requests.push(request);
          return { providerMessageId: "slack-request-001" };
        },
      },
      publicBaseUrl: "https://bridge.example.test/",
      owners: { resolveDisplayName: async () => "Architecture Owner" },
      now: () => new Date("2026-08-08T00:00:01.000Z"),
      metrics,
    });

    await handler(event);
    await handler(event);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      idempotencyKey: "evt_slack_delivery:slack",
      correlationId: "cor_evt_slack_delivery",
    });
    const [delivery] = [...store.deliveries.values()];
    expect(delivery).toMatchObject({
      outboxEventId: event.id,
      channel: "slack",
      status: "delivered",
      attemptCount: 1,
      preference: "immediate",
      providerMessageId: "slack-request-001",
      destinationHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(delivery)).not.toContain("hooks.slack.com");
    expect(metrics.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "bridge_notification_deliveries_total",
        labels: { channel: "slack", outcome: "delivered" },
        value: 1,
      }),
      expect.objectContaining({
        name: "bridge_notification_deliveries_total",
        labels: { channel: "slack", outcome: "skipped" },
        value: 1,
      }),
    ]));
  });

  it("collapses separate recipient events into one project-channel message", async () => {
    const first = notification("slack_owner_one");
    const second = { ...first, id: "ntf_slack_owner_two", recipientId: "usr_second" };
    const firstEvent = {
      ...notificationEvent("evt_slack_owner_one", first),
      status: "processing" as const,
      attempts: 1,
      payload: { ...notificationEvent("evt_slack_owner_one", first).payload, questionContext },
    };
    const secondEvent = {
      ...notificationEvent("evt_slack_owner_two", second),
      status: "processing" as const,
      attempts: 1,
      payload: { ...notificationEvent("evt_slack_owner_two", second).payload, questionContext },
    };
    const store = new TestNotificationSlackStore([first, second]);
    const requests: SlackSendRequest[] = [];
    const handler = createNotificationSlackHandler({
      store,
      channels: createSlackChannelDirectory({
        prj_worker: "https://hooks.slack.com/services/T000/B000/secret",
      }),
      sender: {
        send: async (request) => {
          requests.push(request);
          return { providerMessageId: `slack-request-${requests.length}` };
        },
      },
      publicBaseUrl: "https://bridge.example.test/",
    });

    await handler(firstEvent);
    await handler(secondEvent);

    expect(requests).toHaveLength(1);
    expect([...store.deliveries.values()].map((delivery) => delivery.status)).toEqual([
      "delivered",
      "suppressed",
    ]);
  });

  it("supports environment-configured project mappings and validates Slack webhook sends", async () => {
    const directory = createSlackChannelDirectoryFromEnvironment(JSON.stringify({
      prj_worker: "https://hooks.slack.com/services/T000/B000/secret",
    }));
    await expect(directory.resolveChannel("prj_worker")).resolves.toEqual({
      webhookUrl: "https://hooks.slack.com/services/T000/B000/secret",
    });
    expect(() => createSlackChannelDirectory({ prj_worker: "https://example.test/hook" })).toThrow(
      "Slack Incoming Webhook URL",
    );

    let request: RequestInit | undefined;
    const sender = createSlackWebhookSender(async (_url, init) => {
      request = init;
      return new Response("ok", { status: 200, headers: { "x-slack-req-id": "slack-request-002" } });
    });
    await expect(sender.send({
      webhookUrl: "https://hooks.slack.com/services/T000/B000/secret",
      text: "Bridge notification",
      blocks: [],
      idempotencyKey: "evt_slack_sender:slack",
      correlationId: "cor_slack_sender",
    })).resolves.toEqual({ providerMessageId: "slack-request-002" });
    expect(request).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "content-type": "application/json" }),
    });
    expect(JSON.parse(String(request?.body))).toMatchObject({ text: "Bridge notification", blocks: [] });
  });
});
