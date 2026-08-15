import { createHash } from "node:crypto";

import type {
  Notification,
  NotificationQuestionContext,
  OutboxDelivery,
  OutboxEvent,
} from "@bridge/domain";
import type { BridgeMetrics, BridgeNotificationOutcome } from "@bridge/observability";

import { sanitizeDeliveryError } from "./email.js";

export interface SlackChannelConfiguration {
  /** Slack Incoming Webhook URL. Keep this in deployment secret storage. */
  readonly webhookUrl: string;
}

export interface SlackChannelDirectory {
  resolveChannel(projectId: string): Promise<SlackChannelConfiguration | undefined>;
}

export interface SlackOwnerDirectory {
  resolveDisplayName(principalId: string): Promise<string | undefined>;
}

export interface SlackSendRequest {
  readonly webhookUrl: string;
  readonly text: string;
  readonly blocks: readonly SlackBlock[];
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface SlackSender {
  send(request: SlackSendRequest): Promise<{ readonly providerMessageId: string }>;
}

export interface SlackNotificationStore {
  getNotification(notificationId: string): Promise<Notification | undefined>;
  getOutboxDelivery(eventId: string, channel: "slack"): Promise<OutboxDelivery | undefined>;
  listOutboxDeliveries(projectId: string): Promise<readonly OutboxDelivery[]>;
  saveOutboxDelivery(delivery: OutboxDelivery): Promise<void>;
}

export interface SlackNotificationHandlerOptions {
  readonly store: SlackNotificationStore;
  readonly channels: SlackChannelDirectory;
  readonly sender: SlackSender;
  readonly publicBaseUrl: string;
  readonly owners?: SlackOwnerDirectory;
  readonly now?: () => Date;
  readonly metrics?: BridgeMetrics;
}

export interface SlackBlockText {
  readonly type: "mrkdwn";
  readonly text: string;
}

export interface SlackBlock {
  readonly type: "section" | "context";
  readonly text?: SlackBlockText;
  readonly fields?: readonly SlackBlockText[];
  readonly elements?: readonly SlackBlockText[];
}

export type SlackFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function safeLine(value: string, limit: number): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function escapeMrkdwn(value: string): string {
  return safeLine(value, 500).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function validateWebhookUrl(webhookUrl: string): string {
  const url = new URL(webhookUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "hooks.slack.com" ||
    !url.pathname.startsWith("/services/") ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("Slack channel configuration must use a Slack Incoming Webhook URL.");
  }
  return url.toString();
}

function parseProjectChannelMapping(raw: string): ReadonlyMap<string, SlackChannelConfiguration> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("BRIDGE_SLACK_PROJECT_CHANNELS must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BRIDGE_SLACK_PROJECT_CHANNELS must be a JSON object keyed by project ID.");
  }

  const entries: Array<readonly [string, SlackChannelConfiguration]> = [];
  for (const [projectId, value] of Object.entries(parsed)) {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId || !/^[A-Za-z0-9_-]{1,100}$/.test(normalizedProjectId)) {
      throw new Error("Slack project channel mappings contain an invalid project ID.");
    }
    if (typeof value !== "string") {
      throw new Error(`Slack channel mapping for ${normalizedProjectId} must be a webhook URL string.`);
    }
    entries.push([normalizedProjectId, { webhookUrl: validateWebhookUrl(value) }]);
  }
  return new Map(entries);
}

export function createSlackChannelDirectory(
  mapping: Readonly<Record<string, string>>,
): SlackChannelDirectory {
  const channels = new Map<string, SlackChannelConfiguration>();
  for (const [projectId, webhookUrl] of Object.entries(mapping)) {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId || !/^[A-Za-z0-9_-]{1,100}$/.test(normalizedProjectId)) {
      throw new Error("Slack project channel mappings contain an invalid project ID.");
    }
    channels.set(normalizedProjectId, { webhookUrl: validateWebhookUrl(webhookUrl) });
  }
  return {
    resolveChannel: async (projectId) => channels.get(projectId),
  };
}

export function createSlackChannelDirectoryFromEnvironment(
  raw = process.env.BRIDGE_SLACK_PROJECT_CHANNELS,
): SlackChannelDirectory {
  if (!raw?.trim()) {
    return createSlackChannelDirectory({});
  }
  const channels = parseProjectChannelMapping(raw);
  return {
    resolveChannel: async (projectId) => channels.get(projectId),
  };
}

export function createSlackWebhookSender(fetcher: SlackFetch = fetch): SlackSender {
  return {
    async send(request) {
      const webhookUrl = validateWebhookUrl(request.webhookUrl);
      const response = await fetcher(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Bridge/notification-worker",
        },
        body: JSON.stringify({
          text: request.text,
          blocks: request.blocks,
          unfurl_links: false,
          unfurl_media: false,
        }),
      });
      if (!response.ok) {
        throw new Error(`Slack webhook returned HTTP ${response.status}.`);
      }
      const providerMessageId = response.headers.get("x-slack-req-id")?.trim();
      return {
        providerMessageId: providerMessageId || `slack_${createHash("sha256").update(request.idempotencyKey).digest("hex").slice(0, 32)}`,
      };
    },
  };
}

function deliveryId(eventId: string): string {
  return `odl_${createHash("sha256").update(`${eventId}:slack`).digest("hex").slice(0, 32)}`;
}

function destinationHash(organizationId: string, projectId: string, webhookUrl: string): string {
  return createHash("sha256").update(`${organizationId}\0${projectId}\0${webhookUrl}`).digest("hex");
}

function semanticDedupeKey(
  projectId: string,
  notification: Notification,
  question: NotificationQuestionContext | undefined,
): string {
  return `sdl_${createHash("sha256")
    .update([
      projectId,
      notification.type,
      notification.targetType,
      notification.targetId,
      notification.title,
      question?.id ?? "",
      question?.status ?? "",
      question?.risk ?? "",
    ].join("\0"))
    .digest("hex")}`;
}

function safeProviderMessageId(value: string): string {
  const messageId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/+=-]{0,499}$/.test(messageId)) {
    throw new Error("Slack returned an invalid request ID.");
  }
  return messageId;
}

function notificationUrl(publicBaseUrl: string, notification: Notification, question?: NotificationQuestionContext): string {
  const url = new URL(publicBaseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Bridge publicBaseUrl must use HTTP or HTTPS.");
  }
  url.searchParams.set("view", question ? "questions" : "notifications");
  url.searchParams.set("projectId", notification.projectId);
  if (question) url.searchParams.set("questionId", question.id);
  return url.toString();
}

async function ownerLabel(
  context: NotificationQuestionContext | undefined,
  owners: SlackOwnerDirectory | undefined,
): Promise<string> {
  if (!context || context.ownerIds.length === 0) return "Unassigned";
  const names = await Promise.all(context.ownerIds.slice(0, 10).map(async (ownerId) => {
    const displayName = await owners?.resolveDisplayName(ownerId);
    return safeLine(displayName || ownerId, 120);
  }));
  return names.join(", ").slice(0, 300);
}

export async function renderSlackNotification(
  notification: Notification,
  question: NotificationQuestionContext | undefined,
  publicBaseUrl: string,
  owners?: SlackOwnerDirectory,
): Promise<{ readonly text: string; readonly blocks: readonly SlackBlock[] }> {
  const title = escapeMrkdwn(notification.title) || "Bridge notification";
  const status = question?.status ?? "unavailable";
  const risk = question?.risk ?? "unavailable";
  const ownerLabelValue = await ownerLabel(question, owners);
  const owner = escapeMrkdwn(ownerLabelValue);
  const link = notificationUrl(publicBaseUrl, notification, question);
  const safeLink = escapeMrkdwn(link);
  const blocks: readonly SlackBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${title}*` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Status*\n${escapeMrkdwn(status)}` },
        { type: "mrkdwn", text: `*Risk*\n${escapeMrkdwn(risk)}` },
        { type: "mrkdwn", text: `*Owner*\n${owner}` },
        { type: "mrkdwn", text: `<${safeLink}|Open in Bridge>` },
      ],
    },
    {
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: "Final acceptance and approval remain in Bridge.",
      }],
    },
  ];
  return {
    text: `[Bridge] ${safeLine(notification.title, 180)} — status: ${status}; risk: ${risk}; owner: ${owner}; ${safeLink}`,
    blocks,
  };
}

export function createNotificationSlackHandler(
  options: SlackNotificationHandlerOptions,
): (event: OutboxEvent) => Promise<void> {
  const now = options.now ?? (() => new Date());

  return async (event) => {
    if (event.type !== "notification.created") return;
    const startedAt = performance.now();
    let outcome: BridgeNotificationOutcome = "failed";
    try {
      if (!("notificationId" in event.payload)) throw new Error("Notification outbox payload is invalid.");
      const notification = await options.store.getNotification(event.payload.notificationId);
      if (
        !notification ||
        notification.organizationId !== event.organizationId ||
        notification.projectId !== event.projectId ||
        notification.recipientId !== event.payload.recipientId ||
        notification.type !== event.payload.notificationType ||
        notification.targetType !== event.payload.targetType ||
        notification.targetId !== event.payload.targetId
      ) {
        throw new Error("Notification delivery source is missing or inconsistent.");
      }

      const existing = await options.store.getOutboxDelivery(event.id, "slack");
      if (existing && existing.status !== "failed") {
        outcome = "skipped";
        return;
      }

      const channel = await options.channels.resolveChannel(event.projectId);
      const dedupeKey = semanticDedupeKey(event.projectId, notification, event.payload.questionContext);
      if (!channel) {
        const timestamp = now().toISOString();
        await options.store.saveOutboxDelivery({
          id: existing?.id ?? deliveryId(event.id),
          organizationId: event.organizationId,
          projectId: event.projectId,
          outboxEventId: event.id,
          channel: "slack",
          dedupeKey,
          destinationHash: destinationHash(event.organizationId, event.projectId, "unconfigured"),
          status: "suppressed",
          attemptCount: event.attempts,
          preference: "muted",
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        });
        outcome = "suppressed";
        return;
      }

      const webhookUrl = validateWebhookUrl(channel.webhookUrl);
      const hashedDestination = destinationHash(event.organizationId, event.projectId, webhookUrl);
      if (existing && existing.destinationHash !== hashedDestination) {
        throw new Error("The Slack destination changed after a failed attempt; operator review is required.");
      }

      const timestamp = now().toISOString();
      const baseDelivery = {
        id: existing?.id ?? deliveryId(event.id),
        organizationId: event.organizationId,
        projectId: event.projectId,
        outboxEventId: event.id,
        channel: "slack" as const,
        dedupeKey,
        destinationHash: hashedDestination,
        attemptCount: event.attempts,
        preference: "immediate" as const,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      const alreadyDelivered = (await options.store.listOutboxDeliveries(event.projectId)).some(
        (delivery) =>
          delivery.outboxEventId !== event.id &&
          delivery.channel === "slack" &&
          delivery.dedupeKey === dedupeKey &&
          delivery.destinationHash === hashedDestination &&
          delivery.status === "delivered",
      );
      if (alreadyDelivered) {
        await options.store.saveOutboxDelivery({
          ...baseDelivery,
          status: "suppressed",
        });
        outcome = "suppressed";
        return;
      }
      const rendered = await renderSlackNotification(
        notification,
        event.payload.questionContext,
        options.publicBaseUrl,
        options.owners,
      );
      try {
        const result = await options.sender.send({
          webhookUrl,
          ...rendered,
          idempotencyKey: `${event.id}:slack`,
          correlationId: event.correlationId,
        });
        await options.store.saveOutboxDelivery({
          ...baseDelivery,
          status: "delivered",
          providerMessageId: safeProviderMessageId(result.providerMessageId),
        });
        outcome = "delivered";
      } catch (error) {
        const lastError = sanitizeDeliveryError(error, "Slack delivery failed.");
        await options.store.saveOutboxDelivery({
          ...baseDelivery,
          status: "failed",
          lastError,
        });
        throw new Error(lastError);
      }
    } finally {
      options.metrics?.recordNotificationDelivery({
        channel: "slack",
        outcome,
        durationMs: Math.max(0, performance.now() - startedAt),
      });
    }
  };
}
