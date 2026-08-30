import { createHash } from "node:crypto";

import type {
  Notification,
  NotificationDeliveryPreference,
  NotificationPreference,
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
  getNotificationPreference?(
    organizationId: string,
    principalId: string,
    channel: "email",
  ): Promise<NotificationPreference | undefined>;
  getOutboxDelivery(eventId: string, channel: "email"): Promise<OutboxDelivery | undefined>;
  saveOutboxDelivery(delivery: OutboxDelivery): Promise<void>;
}

export interface EmailDigestStore extends NotificationEmailStore {
  getOutboxEvent(eventId: string): Promise<OutboxEvent | undefined>;
  claimDeferredEmailDeliveries(now: string, limit: number, leaseMs?: number): Promise<readonly OutboxDelivery[]>;
}

export interface NotificationEmailHandlerOptions {
  readonly store: NotificationEmailStore;
  readonly directory: EmailRecipientDirectory;
  readonly sender: EmailSender;
  readonly publicBaseUrl: string;
  readonly now?: () => Date;
  readonly mandatory?: (notification: Notification) => boolean;
  readonly digestDelayMs?: number;
  readonly metrics?: BridgeMetrics;
}

export interface EmailDigestCycleOptions {
  readonly store: EmailDigestStore;
  readonly directory: EmailRecipientDirectory;
  readonly sender: EmailSender;
  readonly publicBaseUrl: string;
  readonly now?: () => Date;
  readonly batchSize?: number;
  readonly maxAttempts?: number;
  readonly baseBackoffMs?: number;
  readonly leaseMs?: number;
  readonly metrics?: BridgeMetrics;
}

export interface EmailDigestCycleResult {
  readonly claimed: number;
  readonly digestsSent: number;
  readonly delivered: number;
  readonly suppressed: number;
  readonly retried: number;
  readonly failed: number;
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
  return value
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function safeContext(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 800);
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

export function renderNotificationDigest(
  notifications: readonly Notification[],
  actionUrl: string,
): RenderedEmailTemplate {
  if (notifications.length === 0) throw new Error("A Bridge email digest requires at least one notification.");
  const url = new URL(actionUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Bridge email links must use HTTP or HTTPS.");
  }
  const listed = notifications.slice(0, 20);
  const remaining = Math.max(0, notifications.length - listed.length);
  return {
    subject: `[Bridge] Digest: ${notifications.length} update${notifications.length === 1 ? "" : "s"}`,
    text: [
      "Bridge notification digest",
      "",
      ...listed.map((notification) => `- ${safeLine(notification.title, 160) || "Bridge update"}`),
      ...(remaining > 0 ? [`- ${remaining} more update${remaining === 1 ? "" : "s"}`] : []),
      "",
      `Open Bridge: ${url.toString()}`,
      "",
      "This digest contains only notification titles. Review authoritative records in Bridge.",
    ].join("\n"),
  };
}

export function sanitizeDeliveryError(error: unknown, fallback = "Notification delivery failed."): string {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-access-key]")
      .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
      .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
      .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .slice(0, 1_000) || fallback
  );
}

function templateKind(notification: Notification): EssentialEmailTemplateKind {
  if (notification.type === "question_assigned") return "assignment";
  if (notification.type === "question_blocking_escalation") return "blocking_escalation";
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

export function normalizeEmailAddress(address: string): string {
  const normalized = address.trim().toLocaleLowerCase("en");
  const separator = normalized.lastIndexOf("@");
  const localPart = separator > 0 ? normalized.slice(0, separator) : "";
  const domain = separator > 0 ? normalized.slice(separator + 1) : "";
  const domainLabels = domain.split(".");
  if (
    normalized.length > 320 ||
    localPart.length === 0 ||
    localPart.length > 64 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart) ||
    domain.length === 0 ||
    domain.length > 253 ||
    domainLabels.length < 2 ||
    domainLabels.some((label) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
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
  const digestDelayMs = options.digestDelayMs ?? 24 * 60 * 60 * 1_000;
  if (!Number.isSafeInteger(digestDelayMs) || digestDelayMs < 60_000 || digestDelayMs > 7 * 24 * 60 * 60 * 1_000) {
    throw new Error("Email digest delay must be between one minute and seven days.");
  }

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
      if (existing && (existing.status !== "failed" || existing.feedback)) {
        outcome = "skipped";
        return;
      }
      const recipient = await options.directory.resolveEmailRecipient(notification.recipientId);
      if (!recipient) throw new Error("No email destination is configured for this recipient.");
      const storedPreference = await options.store.getNotificationPreference?.(
        event.organizationId,
        notification.recipientId,
        "email",
      );
      const preference = storedPreference?.preference ?? recipient.preference;
      const address = normalizeEmailAddress(recipient.address);
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
        preference,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      if (!mandatory(notification) && preference !== "immediate") {
        outcome = preference === "muted" ? "suppressed" : "deferred";
        await options.store.saveOutboxDelivery({
          ...baseDelivery,
          status: outcome,
          ...(preference === "digest"
            ? {
                attemptCount: existing?.attemptCount ?? 0,
                digestAvailableAt: new Date(Date.parse(timestamp) + digestDelayMs).toISOString(),
              }
            : {}),
        });
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

interface DigestCandidate {
  readonly delivery: OutboxDelivery;
  readonly event: OutboxEvent;
  readonly notification: Notification;
  readonly address: string;
}

function withoutDeliveryResult(
  delivery: OutboxDelivery,
): Omit<OutboxDelivery, "providerMessageId" | "lastError" | "digestLeaseUntil"> {
  const {
    providerMessageId: _providerMessageId,
    lastError: _lastError,
    digestLeaseUntil: _digestLeaseUntil,
    ...base
  } = delivery;
  return base;
}

export async function runEmailDigestCycle(options: EmailDigestCycleOptions): Promise<EmailDigestCycleResult> {
  const now = options.now ?? (() => new Date());
  const currentTime = now();
  const batchSize = options.batchSize ?? 100;
  const maxAttempts = options.maxAttempts ?? 5;
  const baseBackoffMs = options.baseBackoffMs ?? 60_000;
  const leaseMs = options.leaseMs ?? 5 * 60 * 1_000;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("Email digest batch size must be between 1 and 500.");
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new Error("Email digest max attempts must be between 1 and 20.");
  }
  if (!Number.isSafeInteger(baseBackoffMs) || baseBackoffMs < 1_000 || baseBackoffMs > 24 * 60 * 60 * 1_000) {
    throw new Error("Email digest base backoff must be between one second and one day.");
  }
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 60 * 60 * 1_000) {
    throw new Error("Email digest lease must be between one second and one hour.");
  }

  const claimed = await options.store.claimDeferredEmailDeliveries(currentTime.toISOString(), batchSize, leaseMs);
  let digestsSent = 0;
  let delivered = 0;
  let suppressed = 0;
  let retried = 0;
  let failed = 0;

  const failDelivery = async (delivery: OutboxDelivery, error: unknown): Promise<void> => {
    const exhausted = delivery.attemptCount >= maxAttempts;
    const delay = baseBackoffMs * 2 ** Math.max(0, delivery.attemptCount - 1);
    await options.store.saveOutboxDelivery({
      ...withoutDeliveryResult(delivery),
      status: exhausted ? "failed" : "deferred",
      updatedAt: currentTime.toISOString(),
      digestAvailableAt: new Date(currentTime.getTime() + delay).toISOString(),
      ...(exhausted ? { lastError: sanitizeDeliveryError(error, "Email digest delivery failed.") } : {}),
    });
    if (exhausted) failed += 1;
    else retried += 1;
  };

  const groups = new Map<string, DigestCandidate[]>();
  for (const delivery of claimed) {
    try {
      const event = await options.store.getOutboxEvent(delivery.outboxEventId);
      if (!event || event.type !== "notification.created" || !("notificationId" in event.payload)) {
        throw new Error("Deferred email digest source event is missing or invalid.");
      }
      const notification = await options.store.getNotification(event.payload.notificationId);
      if (
        !notification ||
        notification.organizationId !== delivery.organizationId ||
        notification.projectId !== delivery.projectId ||
        notification.recipientId !== event.payload.recipientId
      ) {
        throw new Error("Deferred email digest notification is missing or inconsistent.");
      }
      const recipient = await options.directory.resolveEmailRecipient(notification.recipientId);
      if (!recipient) throw new Error("No email destination is configured for this digest recipient.");
      const storedPreference = await options.store.getNotificationPreference?.(
        delivery.organizationId,
        notification.recipientId,
        "email",
      );
      const preference = storedPreference?.preference ?? recipient.preference;
      if (preference === "muted") {
        await options.store.saveOutboxDelivery({
          ...withoutDeliveryResult(delivery),
          status: "suppressed",
          preference,
          updatedAt: currentTime.toISOString(),
        });
        suppressed += 1;
        continue;
      }
      const address = normalizeEmailAddress(recipient.address);
      if (destinationHash(delivery.organizationId, address) !== delivery.destinationHash) {
        throw new Error("The email destination changed after digest deferral; operator review is required.");
      }
      const recipientGroup = [delivery.organizationId, delivery.projectId, notification.recipientId].join(":");
      const key = delivery.dedupeKey ? `batch:${delivery.dedupeKey}` : `recipient:${recipientGroup}`;
      groups.set(key, [...(groups.get(key) ?? []), { delivery, event, notification, address }]);
    } catch (error) {
      await failDelivery(delivery, error);
    }
  }

  for (const candidates of groups.values()) {
    const startedAt = performance.now();
    let outcome: BridgeNotificationOutcome = "failed";
    const ordered = [...candidates].sort(
      (left, right) =>
        left.notification.createdAt.localeCompare(right.notification.createdAt) ||
        left.delivery.id.localeCompare(right.delivery.id),
    );
    const existingBatchKey = ordered[0]?.delivery.dedupeKey;
    const batchKey =
      existingBatchKey ??
      `edg_${createHash("sha256")
        .update(
          ordered
            .map((candidate) => candidate.delivery.id)
            .sort()
            .join(":"),
        )
        .digest("hex")}`;
    const batched = ordered.map(
      (candidate): DigestCandidate => ({
        ...candidate,
        delivery: { ...candidate.delivery, dedupeKey: batchKey },
      }),
    );
    try {
      for (const candidate of batched) {
        if (
          candidate.address !== batched[0]!.address ||
          (candidate.delivery.dedupeKey && candidate.delivery.dedupeKey !== batchKey)
        ) {
          throw new Error("Deferred email digest batch recipients are inconsistent.");
        }
        if (!ordered.find((original) => original.delivery.id === candidate.delivery.id)?.delivery.dedupeKey) {
          await options.store.saveOutboxDelivery({
            ...candidate.delivery,
            updatedAt: currentTime.toISOString(),
          });
        }
      }
      const first = batched[0]!;
      const template = renderNotificationDigest(
        batched.map((candidate) => candidate.notification),
        notificationUrl(options.publicBaseUrl, first.notification),
      );
      const result = await options.sender.send({
        to: first.address,
        ...template,
        idempotencyKey: `${batchKey}:email`,
        correlationId: first.event.correlationId,
      });
      const providerMessageId = safeProviderMessageId(result.providerMessageId);
      for (const candidate of batched) {
        await options.store.saveOutboxDelivery({
          ...withoutDeliveryResult(candidate.delivery),
          dedupeKey: batchKey,
          status: "delivered",
          updatedAt: currentTime.toISOString(),
          providerMessageId,
        });
      }
      digestsSent += 1;
      delivered += batched.length;
      outcome = "delivered";
    } catch (error) {
      for (const candidate of batched) await failDelivery(candidate.delivery, error);
    } finally {
      options.metrics?.recordNotificationDelivery({
        channel: "email",
        outcome,
        durationMs: Math.max(0, performance.now() - startedAt),
      });
    }
  }

  return { claimed: claimed.length, digestsSent, delivered, suppressed, retried, failed };
}
