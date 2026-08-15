import { createHash } from "node:crypto";

import type {
  Notification,
  NotificationDeliveryPreference,
  OutboxDelivery,
  OutboxEvent,
} from "@bridge/domain";
import type { BridgeMetrics, BridgeNotificationOutcome } from "@bridge/observability";

export type EssentialEmailTemplateKind =
  | "assignment"
  | "clarification"
  | "blocking_escalation"
  | "accepted_answer"
  | "artifact_review"
  | "activity";

export interface EssentialEmailTemplateInput {
  readonly kind: EssentialEmailTemplateKind;
  readonly title: string;
  readonly context: string;
  readonly actionUrl: string;
}

export interface RenderedEmailTemplate {
  readonly subject: string;
  readonly text: string;
}

export interface EmailRecipient {
  readonly address: string;
  readonly preference: NotificationDeliveryPreference;
}

export interface EmailRecipientDirectory {
  resolveEmailRecipient(recipientId: string): Promise<EmailRecipient | undefined>;
}

export interface EmailSendRequest extends RenderedEmailTemplate {
  readonly to: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface EmailSender {
  send(request: EmailSendRequest): Promise<{ readonly providerMessageId: string }>;
}

export interface NotificationEmailStore {
  getNotification(notificationId: string): Promise<Notification | undefined>;
  getOutboxDelivery(eventId: string, channel: "email"): Promise<OutboxDelivery | undefined>;
  saveOutboxDelivery(delivery: OutboxDelivery): Promise<void>;
}

export interface NotificationEmailHandlerOptions {
  readonly store: NotificationEmailStore;
  readonly directory: EmailRecipientDirectory;
  readonly sender: EmailSender;
  readonly publicBaseUrl: string;
  readonly now?: () => Date;
  readonly mandatory?: (notification: Notification) => boolean;
  readonly metrics?: BridgeMetrics;
}

const TEMPLATE_LABELS: Readonly<Record<EssentialEmailTemplateKind, string>> = {
  assignment: "Review assignment",
  clarification: "Clarification",
  blocking_escalation: "Blocking escalation",
  accepted_answer: "Answer accepted",
  artifact_review: "Specification review",
  activity: "Bridge update",
};

function safeLine(value: string, limit: number): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeContext(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, 800);
}

export function renderEssentialEmailTemplate(input: EssentialEmailTemplateInput): RenderedEmailTemplate {
  const label = TEMPLATE_LABELS[input.kind];
  const title = safeLine(input.title, 180) || "Bridge notification";
  const context = safeContext(input.context);
  const actionUrl = new URL(input.actionUrl);
  if (actionUrl.protocol !== "https:" && actionUrl.protocol !== "http:") {
    throw new Error("Bridge email links must use HTTP or HTTPS.");
  }
  return {
    subject: `[Bridge] ${label}: ${title}`,
    text: [
      label,
      "",
      title,
      ...(context ? [context, ""] : [""]),
      `Open Bridge: ${actionUrl.toString()}`,
      "",
      "This email contains only a minimal activity summary. Review the authoritative record in Bridge.",
    ].join("\n"),
  };
}

export function sanitizeDeliveryError(error: unknown, fallback = "Notification delivery failed."): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-access-key]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 1_000) || fallback;
}

function templateKind(notification: Notification): EssentialEmailTemplateKind {
  if (notification.type === "question_assigned") return "assignment";
  if (notification.type === "question_comment") return "clarification";
  if (notification.type === "question_accepted") return "accepted_answer";
  if (notification.type.startsWith("artifact_")) return "artifact_review";
  return "activity";
}

function notificationUrl(publicBaseUrl: string, notification: Notification): string {
  const url = new URL(publicBaseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Bridge publicBaseUrl must use HTTP or HTTPS.");
  }
  url.searchParams.set("view", "notifications");
  url.searchParams.set("projectId", notification.projectId);
  return url.toString();
}

function normalizeAddress(address: string): string {
  const normalized = address.trim().toLocaleLowerCase("en");
  if (
    normalized.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ||
    /[\r\n]/.test(normalized)
  ) {
    throw new Error("The resolved email destination is invalid.");
  }
  return normalized;
}

function deliveryId(eventId: string): string {
  return `odl_${createHash("sha256").update(`${eventId}:email`).digest("hex").slice(0, 32)}`;
}

function destinationHash(organizationId: string, address: string): string {
  return createHash("sha256").update(`${organizationId}\0${address}`).digest("hex");
}

function safeProviderMessageId(value: string): string {
  const messageId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/+=-]{0,499}$/.test(messageId)) {
    throw new Error("The email provider returned an invalid message ID.");
  }
  return messageId;
}

export function createNotificationEmailHandler(
  options: NotificationEmailHandlerOptions,
): (event: OutboxEvent) => Promise<void> {
  const now = options.now ?? (() => new Date());
  const mandatory = options.mandatory ?? ((notification) => notification.type === "question_review");

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

      const existing = await options.store.getOutboxDelivery(event.id, "email");
      if (existing && existing.status !== "failed") {
        outcome = "skipped";
        return;
      }
      const recipient = await options.directory.resolveEmailRecipient(notification.recipientId);
      if (!recipient) throw new Error("No email destination is configured for this recipient.");
      const address = normalizeAddress(recipient.address);
      const hashedDestination = destinationHash(event.organizationId, address);
      if (existing && existing.destinationHash !== hashedDestination) {
        throw new Error("The email destination changed after a failed attempt; operator review is required.");
      }

      const timestamp = now().toISOString();
      const baseDelivery = {
        id: existing?.id ?? deliveryId(event.id),
        organizationId: event.organizationId,
        projectId: event.projectId,
        outboxEventId: event.id,
        channel: "email" as const,
        destinationHash: hashedDestination,
        attemptCount: event.attempts,
        preference: recipient.preference,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      if (!mandatory(notification) && recipient.preference !== "immediate") {
        outcome = recipient.preference === "muted" ? "suppressed" : "deferred";
        await options.store.saveOutboxDelivery({ ...baseDelivery, status: outcome });
        return;
      }

      const template = renderEssentialEmailTemplate({
        kind: templateKind(notification),
        title: notification.title,
        context: notification.body,
        actionUrl: notificationUrl(options.publicBaseUrl, notification),
      });
      try {
        const result = await options.sender.send({
          to: address,
          ...template,
          idempotencyKey: `${event.id}:email`,
          correlationId: event.correlationId,
        });
        const providerMessageId = safeProviderMessageId(result.providerMessageId);
        await options.store.saveOutboxDelivery({
          ...baseDelivery,
          status: "delivered",
          providerMessageId,
        });
        outcome = "delivered";
      } catch (error) {
        const lastError = sanitizeDeliveryError(error);
        await options.store.saveOutboxDelivery({
          ...baseDelivery,
          status: "failed",
          lastError,
        });
        throw new Error(lastError);
      }
    } finally {
      options.metrics?.recordNotificationDelivery({
        channel: "email",
        outcome,
        durationMs: Math.max(0, performance.now() - startedAt),
      });
    }
  };
}
