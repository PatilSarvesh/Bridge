import { createPublicKey, type KeyObject, verify as verifyCryptographicSignature, X509Certificate } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

import { type RecordOutboxDeliveryFeedbackInput, recordOutboxDeliveryFeedbackInputSchema } from "@bridge/contracts";
import {
  type BridgeMetrics,
  correlationIdHeader,
  currentCorrelationId,
  runWithCorrelationContext,
  type SafeLogger,
} from "@bridge/observability";

const ingressPath = "/webhooks/aws/ses";
const defaultHost = "127.0.0.1";
const defaultPort = 4_300;
const defaultRequestTimeoutMs = 5_000;
const defaultMaximumBodyBytes = 256_000;
const defaultCertificateCacheTtlMs = 60 * 60 * 1_000;
const defaultReplayTtlMs = 24 * 60 * 60 * 1_000;
const defaultMaximumReplayEntries = 10_000;
const maximumTopicMappings = 100;
const maximumTopicMappingBytes = 64_000;
const maximumCertificateBytes = 32_000;
const snsHostPattern = /^sns\.[a-z0-9-]{3,}\.amazonaws\.com(?:\.cn)?$/;
const topicArnPattern = /^arn:aws(?:-[a-z]+)*:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_.-]{1,256}$/;
const projectIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const serviceTokenPattern = /^brg_srv_[A-Za-z0-9_-]{43}$/;
const messageIdPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,199}$/;
const providerMessageIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+=-]{0,499}$/;

type Fetch = typeof globalThis.fetch;

export interface SesFeedbackEnvironment {
  readonly BRIDGE_SES_FEEDBACK_INGRESS_ENABLED?: string;
  readonly BRIDGE_SES_FEEDBACK_HOST?: string;
  readonly BRIDGE_SES_FEEDBACK_PORT?: string;
  readonly BRIDGE_SES_FEEDBACK_API_URL?: string;
  readonly BRIDGE_SES_FEEDBACK_SERVICE_TOKEN?: string;
  readonly BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS?: string;
  readonly BRIDGE_SES_FEEDBACK_CONFIRM_SUBSCRIPTIONS?: string;
  readonly BRIDGE_SES_FEEDBACK_REQUEST_TIMEOUT_MS?: string;
  readonly BRIDGE_SES_FEEDBACK_MAX_BODY_BYTES?: string;
}

export interface SesFeedbackConfiguration {
  readonly host: string;
  readonly port: number;
  readonly apiUrl: string;
  readonly serviceToken: string;
  readonly topicProjects: ReadonlyMap<string, string>;
  readonly confirmSubscriptions: boolean;
  readonly requestTimeoutMs: number;
  readonly maximumBodyBytes: number;
  readonly certificateCacheTtlMs: number;
  readonly replayTtlMs: number;
  readonly maximumReplayEntries: number;
}

export interface SnsEnvelope {
  readonly Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  readonly MessageId: string;
  readonly TopicArn: string;
  readonly Message: string;
  readonly Timestamp: string;
  readonly SignatureVersion: "1" | "2";
  readonly Signature: string;
  readonly SigningCertURL: string;
  readonly Subject?: string;
  readonly SubscribeURL?: string;
  readonly Token?: string;
}

export interface SnsSigningKey {
  readonly key: KeyObject;
  readonly validUntil: number;
}

export type SnsSigningKeyLoader = (certificateUrl: string) => Promise<SnsSigningKey>;
export type SnsSignatureVerifier = (message: SnsEnvelope) => Promise<void>;

export interface SesFeedbackHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface SesFeedbackProcessorRequest {
  readonly body: string;
  readonly headers: IncomingHttpHeaders;
}

export interface SesFeedbackProcessorOptions {
  readonly configuration: SesFeedbackConfiguration;
  readonly verifySignature: SnsSignatureVerifier;
  readonly forwardFeedback: (projectId: string, input: RecordOutboxDeliveryFeedbackInput) => Promise<void>;
  readonly confirmSubscription: (message: SnsEnvelope) => Promise<void>;
  readonly replayCache?: SnsReplayCache;
}

export interface SesFeedbackServerOptions {
  readonly configuration: SesFeedbackConfiguration;
  readonly metrics: BridgeMetrics;
  readonly logger?: SafeLogger;
  readonly fetch?: Fetch;
  readonly now?: () => number;
  readonly signingKeyLoader?: SnsSigningKeyLoader;
}

export interface SesFeedbackServer {
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

type IngressErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_SNS_MESSAGE"
  | "UNEXPECTED_TOPIC"
  | "SIGNING_KEY_UNAVAILABLE"
  | "INVALID_SIGNATURE"
  | "INVALID_SES_FEEDBACK"
  | "SUBSCRIPTION_CONFIRMATION_DISABLED"
  | "SUBSCRIPTION_CONFIRMATION_FAILED"
  | "BRIDGE_API_UNAVAILABLE";

class SesFeedbackIngressError extends Error {
  constructor(
    readonly code: IngressErrorCode,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "SesFeedbackIngressError";
  }
}

const responseHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

function parseBoolean(raw: string | undefined, name: keyof SesFeedbackEnvironment, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${String(name)} must be \`true\` or \`false\`.`);
}

function positiveInteger(
  raw: string | undefined,
  name: keyof SesFeedbackEnvironment,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = raw?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${String(name)} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${String(name)} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function validateHost(raw: string | undefined): string {
  const host = raw?.trim() || defaultHost;
  if (!/^[A-Za-z0-9.:[\]-]{1,255}$/.test(host)) {
    throw new Error("BRIDGE_SES_FEEDBACK_HOST must be a hostname or IP address without a URL scheme.");
  }
  return host;
}

function validateApiUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) throw new Error("BRIDGE_SES_FEEDBACK_API_URL is required when SES feedback ingress is enabled.");
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("BRIDGE_SES_FEEDBACK_API_URL must be an origin without credentials, path, query, or fragment.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("BRIDGE_SES_FEEDBACK_API_URL must use HTTPS, except for an explicit loopback address.");
  }
  return url.toString();
}

function parseTopicProjects(raw: string | undefined): ReadonlyMap<string, string> {
  const value = raw?.trim();
  if (!value) {
    throw new Error("BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS is required when SES feedback ingress is enabled.");
  }
  if (Buffer.byteLength(value, "utf8") > maximumTopicMappingBytes) {
    throw new Error("BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS exceeds the configured size limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS must be a JSON object keyed by exact SNS topic ARN.");
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > maximumTopicMappings) {
    throw new Error(`BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS must contain between 1 and ${maximumTopicMappings} topics.`);
  }
  const mappings = new Map<string, string>();
  for (const [topicArn, projectId] of entries) {
    if (!topicArnPattern.test(topicArn)) {
      throw new Error("BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS contains an invalid SNS topic ARN.");
    }
    if (typeof projectId !== "string" || !projectIdPattern.test(projectId.trim())) {
      throw new Error("BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS contains an invalid Bridge project ID.");
    }
    mappings.set(topicArn, projectId.trim());
  }
  return mappings;
}

export function loadSesFeedbackConfiguration(
  environment: SesFeedbackEnvironment = process.env,
): SesFeedbackConfiguration | undefined {
  const enabled = parseBoolean(
    environment.BRIDGE_SES_FEEDBACK_INGRESS_ENABLED,
    "BRIDGE_SES_FEEDBACK_INGRESS_ENABLED",
    false,
  );
  if (!enabled) return undefined;
  const serviceToken = environment.BRIDGE_SES_FEEDBACK_SERVICE_TOKEN?.trim();
  if (!serviceToken || !serviceTokenPattern.test(serviceToken)) {
    throw new Error("BRIDGE_SES_FEEDBACK_SERVICE_TOKEN must be a valid Bridge service token.");
  }
  return {
    host: validateHost(environment.BRIDGE_SES_FEEDBACK_HOST),
    port: positiveInteger(environment.BRIDGE_SES_FEEDBACK_PORT, "BRIDGE_SES_FEEDBACK_PORT", defaultPort, 1, 65_535),
    apiUrl: validateApiUrl(environment.BRIDGE_SES_FEEDBACK_API_URL),
    serviceToken,
    topicProjects: parseTopicProjects(environment.BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS),
    confirmSubscriptions: parseBoolean(
      environment.BRIDGE_SES_FEEDBACK_CONFIRM_SUBSCRIPTIONS,
      "BRIDGE_SES_FEEDBACK_CONFIRM_SUBSCRIPTIONS",
      false,
    ),
    requestTimeoutMs: positiveInteger(
      environment.BRIDGE_SES_FEEDBACK_REQUEST_TIMEOUT_MS,
      "BRIDGE_SES_FEEDBACK_REQUEST_TIMEOUT_MS",
      defaultRequestTimeoutMs,
      100,
      30_000,
    ),
    maximumBodyBytes: positiveInteger(
      environment.BRIDGE_SES_FEEDBACK_MAX_BODY_BYTES,
      "BRIDGE_SES_FEEDBACK_MAX_BODY_BYTES",
      defaultMaximumBodyBytes,
      1_024,
      1_000_000,
    ),
    certificateCacheTtlMs: defaultCertificateCacheTtlMs,
    replayTtlMs: defaultReplayTtlMs,
    maximumReplayEntries: defaultMaximumReplayEntries,
  };
}

function requireString(value: Readonly<Record<string, unknown>>, key: string, maximumLength: number): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > maximumLength) {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS message is malformed.");
  }
  return candidate;
}

function optionalString(
  value: Readonly<Record<string, unknown>>,
  key: string,
  maximumLength: number,
): string | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > maximumLength) {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS message is malformed.");
  }
  return candidate;
}

export function parseSnsEnvelope(rawBody: string, maximumMessageBytes = defaultMaximumBodyBytes): SnsEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS message is malformed.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS message is malformed.");
  }
  const value = parsed as Readonly<Record<string, unknown>>;
  const type = requireString(value, "Type", 50);
  if (!["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"].includes(type)) {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS message type is unsupported.");
  }
  const messageId = requireString(value, "MessageId", 200);
  const topicArn = requireString(value, "TopicArn", 1_000);
  const timestamp = requireString(value, "Timestamp", 100);
  const signatureVersion = requireString(value, "SignatureVersion", 10);
  const signature = requireString(value, "Signature", 4_096);
  if (
    !messageIdPattern.test(messageId) ||
    !topicArnPattern.test(topicArn) ||
    !Number.isFinite(Date.parse(timestamp)) ||
    (signatureVersion !== "1" && signatureVersion !== "2") ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature) ||
    Buffer.from(signature, "base64").length === 0
  ) {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS message is malformed.");
  }
  const subject = optionalString(value, "Subject", 1_000);
  const subscribeUrl = optionalString(value, "SubscribeURL", 2_048);
  const token = optionalString(value, "Token", 4_096);
  if (type !== "Notification" && (!subscribeUrl || !token)) {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS confirmation message is malformed.");
  }
  return {
    Type: type as SnsEnvelope["Type"],
    MessageId: messageId,
    TopicArn: topicArn,
    Message: requireString(value, "Message", maximumMessageBytes),
    Timestamp: timestamp,
    SignatureVersion: signatureVersion,
    Signature: signature,
    SigningCertURL: requireString(value, "SigningCertURL", 2_048),
    ...(subject ? { Subject: subject } : {}),
    ...(subscribeUrl ? { SubscribeURL: subscribeUrl } : {}),
    ...(token ? { Token: token } : {}),
  };
}

export function snsStringToSign(message: SnsEnvelope): string {
  const keys: readonly (keyof SnsEnvelope)[] =
    message.Type === "Notification"
      ? ["Message", "MessageId", ...(message.Subject ? (["Subject"] as const) : []), "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return keys.map((key) => `${key}\n${message[key] ?? ""}\n`).join("");
}

function validateSnsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS message contains an invalid AWS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !snsHostPattern.test(url.hostname)) {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS message contains an invalid AWS URL.");
  }
  return url;
}

export function validateSnsSigningCertificateUrl(raw: string): URL {
  const url = validateSnsUrl(raw);
  if (url.search || url.hash || !/^\/SimpleNotificationService-[A-Za-z0-9_-]{1,200}\.pem$/.test(url.pathname)) {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS signing certificate URL is invalid.");
  }
  return url;
}

async function boundedResponseBytes(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    await response.body?.cancel();
    throw new Error("The remote response exceeded the configured size limit.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error("The remote response exceeded the configured size limit.");
  return bytes;
}

export function createSnsSigningKeyLoader(options: {
  readonly fetch?: Fetch;
  readonly timeoutMs: number;
  readonly now?: () => number;
}): SnsSigningKeyLoader {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  return async (rawUrl) => {
    const url = validateSnsSigningCertificateUrl(rawUrl);
    const response = await fetchImplementation(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("The SNS signing certificate could not be retrieved.");
    }
    const certificate = new X509Certificate(await boundedResponseBytes(response, maximumCertificateBytes));
    const validFrom = Date.parse(certificate.validFrom);
    const validUntil = Date.parse(certificate.validTo);
    const currentTime = now();
    if (
      !Number.isFinite(validFrom) ||
      !Number.isFinite(validUntil) ||
      currentTime < validFrom ||
      currentTime >= validUntil
    ) {
      throw new Error("The SNS signing certificate is not currently valid.");
    }
    return { key: createPublicKey(certificate.publicKey), validUntil };
  };
}

export function createSnsSignatureVerifier(options: {
  readonly loadSigningKey: SnsSigningKeyLoader;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
}): SnsSignatureVerifier {
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? defaultCertificateCacheTtlMs;
  const cache = new Map<string, { readonly key: KeyObject; readonly expiresAt: number }>();
  return async (message) => {
    validateSnsSigningCertificateUrl(message.SigningCertURL);
    const currentTime = now();
    let cached = cache.get(message.SigningCertURL);
    if (cached && cached.expiresAt <= currentTime) {
      cache.delete(message.SigningCertURL);
      cached = undefined;
    }
    if (!cached) {
      let loaded: SnsSigningKey;
      try {
        loaded = await options.loadSigningKey(message.SigningCertURL);
      } catch {
        throw new SesFeedbackIngressError(
          "SIGNING_KEY_UNAVAILABLE",
          503,
          "The SNS signing key is temporarily unavailable.",
        );
      }
      if (!Number.isFinite(loaded.validUntil) || loaded.validUntil <= currentTime) {
        throw new SesFeedbackIngressError(
          "SIGNING_KEY_UNAVAILABLE",
          503,
          "The SNS signing key is temporarily unavailable.",
        );
      }
      cached = { key: loaded.key, expiresAt: Math.min(loaded.validUntil, currentTime + cacheTtlMs) };
      cache.set(message.SigningCertURL, cached);
      while (cache.size > 16) cache.delete(cache.keys().next().value as string);
    }
    const verified = verifyCryptographicSignature(
      message.SignatureVersion === "1" ? "RSA-SHA1" : "RSA-SHA256",
      Buffer.from(snsStringToSign(message), "utf8"),
      cached.key,
      Buffer.from(message.Signature, "base64"),
    );
    if (!verified) {
      throw new SesFeedbackIngressError("INVALID_SIGNATURE", 403, "The SNS message signature is invalid.");
    }
  };
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

export function normalizeSesFeedback(message: SnsEnvelope): RecordOutboxDeliveryFeedbackInput | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message.Message);
  } catch {
    throw new SesFeedbackIngressError("INVALID_SES_FEEDBACK", 422, "The SES feedback payload is malformed.");
  }
  const event = recordValue(parsed);
  if (!event) {
    throw new SesFeedbackIngressError("INVALID_SES_FEEDBACK", 422, "The SES feedback payload is malformed.");
  }
  const eventType = event.notificationType ?? event.eventType;
  if (typeof eventType !== "string") {
    throw new SesFeedbackIngressError("INVALID_SES_FEEDBACK", 422, "The SES feedback payload is malformed.");
  }
  if (eventType !== "Bounce" && eventType !== "Complaint") return undefined;
  const mail = recordValue(event.mail);
  const feedbackRecord = recordValue(eventType === "Bounce" ? event.bounce : event.complaint);
  const providerMessageId = mail?.messageId;
  const receivedAt = feedbackRecord?.timestamp;
  if (
    typeof providerMessageId !== "string" ||
    !providerMessageIdPattern.test(providerMessageId) ||
    typeof receivedAt !== "string"
  ) {
    throw new SesFeedbackIngressError("INVALID_SES_FEEDBACK", 422, "The SES feedback payload is malformed.");
  }
  const normalized = recordOutboxDeliveryFeedbackInputSchema.safeParse({
    channel: "email",
    provider: "ses",
    providerMessageId,
    type: eventType === "Bounce" ? "bounce" : "complaint",
    receivedAt,
  });
  if (!normalized.success) {
    throw new SesFeedbackIngressError("INVALID_SES_FEEDBACK", 422, "The SES feedback payload is malformed.");
  }
  return normalized.data;
}

export class SnsReplayCache {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maximumEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  has(key: string): boolean {
    const expiresAt = this.entries.get(key);
    if (!expiresAt) return false;
    if (expiresAt <= this.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  add(key: string): void {
    const currentTime = this.now();
    for (const [candidate, expiresAt] of this.entries) {
      if (expiresAt <= currentTime) this.entries.delete(candidate);
    }
    while (this.entries.size >= this.maximumEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, currentTime + this.ttlMs);
  }
}

function singleHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? undefined : value?.trim();
}

function validateSnsHeaders(message: SnsEnvelope, headers: IncomingHttpHeaders): void {
  const messageType = singleHeader(headers, "x-amz-sns-message-type");
  if (!messageType || messageType !== message.Type) {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS request headers are invalid.");
  }
  const topicArn = singleHeader(headers, "x-amz-sns-topic-arn");
  const messageId = singleHeader(headers, "x-amz-sns-message-id");
  if ((topicArn && topicArn !== message.TopicArn) || (messageId && messageId !== message.MessageId)) {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS request headers are invalid.");
  }
}

export function createBridgeFeedbackForwarder(options: {
  readonly apiUrl: string;
  readonly serviceToken: string;
  readonly timeoutMs: number;
  readonly fetch?: Fetch;
}): SesFeedbackProcessorOptions["forwardFeedback"] {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  return async (projectId, input) => {
    const endpoint = new URL(
      `v1/projects/${encodeURIComponent(projectId)}/integrations/notifications/delivery-feedback`,
      options.apiUrl,
    );
    let response: Response;
    try {
      response = await fetchImplementation(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${options.serviceToken}`,
          "content-type": "application/json",
          ...(currentCorrelationId() ? { [correlationIdHeader]: currentCorrelationId()! } : {}),
        },
        body: JSON.stringify(input),
      });
    } catch {
      throw new SesFeedbackIngressError("BRIDGE_API_UNAVAILABLE", 503, "The Bridge API is temporarily unavailable.");
    }
    await response.body?.cancel();
    if (!response.ok) {
      throw new SesFeedbackIngressError("BRIDGE_API_UNAVAILABLE", 503, "The Bridge API is temporarily unavailable.");
    }
  };
}

function validateSubscriptionUrl(message: SnsEnvelope): URL {
  if (!message.SubscribeURL || !message.Token) {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS confirmation message is malformed.");
  }
  const url = validateSnsUrl(message.SubscribeURL);
  const certificateUrl = validateSnsSigningCertificateUrl(message.SigningCertURL);
  const allowedParameters = new Set(["Action", "TopicArn", "Token"]);
  const parameterNames = [...url.searchParams.keys()];
  if (
    url.hostname !== certificateUrl.hostname ||
    url.pathname !== "/" ||
    url.hash ||
    parameterNames.some((name) => !allowedParameters.has(name)) ||
    [...allowedParameters].some((name) => url.searchParams.getAll(name).length !== 1) ||
    url.searchParams.get("Action") !== "ConfirmSubscription" ||
    url.searchParams.get("TopicArn") !== message.TopicArn ||
    url.searchParams.get("Token") !== message.Token
  ) {
    throw new SesFeedbackIngressError("INVALID_SNS_MESSAGE", 400, "The SNS subscription URL is invalid.");
  }
  return url;
}

export function createSnsSubscriptionConfirmer(options: {
  readonly fetch?: Fetch;
  readonly timeoutMs: number;
}): SesFeedbackProcessorOptions["confirmSubscription"] {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  return async (message) => {
    const url = validateSubscriptionUrl(message);
    let response: Response;
    try {
      response = await fetchImplementation(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch {
      throw new SesFeedbackIngressError(
        "SUBSCRIPTION_CONFIRMATION_FAILED",
        503,
        "The SNS subscription could not be confirmed.",
      );
    }
    await response.body?.cancel();
    if (!response.ok) {
      throw new SesFeedbackIngressError(
        "SUBSCRIPTION_CONFIRMATION_FAILED",
        503,
        "The SNS subscription could not be confirmed.",
      );
    }
  };
}

function jsonResponse(statusCode: number, status: string): SesFeedbackHttpResponse {
  return { statusCode, headers: responseHeaders, body: `${JSON.stringify({ status })}\n` };
}

export function createSesFeedbackProcessor(
  options: SesFeedbackProcessorOptions,
): (request: SesFeedbackProcessorRequest) => Promise<SesFeedbackHttpResponse> {
  const replayCache =
    options.replayCache ??
    new SnsReplayCache(options.configuration.replayTtlMs, options.configuration.maximumReplayEntries);
  return async (request) => {
    const message = parseSnsEnvelope(request.body, options.configuration.maximumBodyBytes);
    validateSnsHeaders(message, request.headers);
    const projectId = options.configuration.topicProjects.get(message.TopicArn);
    if (!projectId) {
      throw new SesFeedbackIngressError("UNEXPECTED_TOPIC", 403, "The SNS topic is not configured for this ingress.");
    }
    await options.verifySignature(message);
    const replayKey = `${message.TopicArn}\n${message.MessageId}`;
    return runWithCorrelationContext({ correlationId: `sns_${message.MessageId}`, source: "integration" }, async () => {
      if (replayCache.has(replayKey)) return jsonResponse(200, "idempotent_replay");
      if (message.Type === "SubscriptionConfirmation") {
        if (!options.configuration.confirmSubscriptions) {
          throw new SesFeedbackIngressError(
            "SUBSCRIPTION_CONFIRMATION_DISABLED",
            503,
            "SNS subscription confirmation is disabled.",
          );
        }
        await options.confirmSubscription(message);
        replayCache.add(replayKey);
        return jsonResponse(200, "subscription_confirmed");
      }
      if (message.Type === "UnsubscribeConfirmation") {
        replayCache.add(replayKey);
        return { statusCode: 204, headers: responseHeaders, body: "" };
      }
      const feedback = normalizeSesFeedback(message);
      if (!feedback) {
        replayCache.add(replayKey);
        return { statusCode: 204, headers: responseHeaders, body: "" };
      }
      await options.forwardFeedback(projectId, feedback);
      replayCache.add(replayKey);
      return jsonResponse(200, "recorded");
    });
  };
}

function errorResponse(error: unknown): { readonly response: SesFeedbackHttpResponse; readonly code: string } {
  if (error instanceof SesFeedbackIngressError) {
    return { response: jsonResponse(error.statusCode, error.code.toLowerCase()), code: error.code };
  }
  return { response: jsonResponse(500, "internal_error"), code: "INTERNAL_ERROR" };
}

function requestPath(requestUrl: string | undefined): string {
  try {
    return new URL(requestUrl ?? "/", "http://bridge-worker.invalid").pathname;
  } catch {
    return "unmatched";
  }
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export function startSesFeedbackServer(options: SesFeedbackServerOptions): Promise<SesFeedbackServer> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const loadSigningKey =
    options.signingKeyLoader ??
    createSnsSigningKeyLoader({
      fetch: fetchImplementation,
      timeoutMs: options.configuration.requestTimeoutMs,
      ...(options.now ? { now: options.now } : {}),
    });
  const processRequest = createSesFeedbackProcessor({
    configuration: options.configuration,
    verifySignature: createSnsSignatureVerifier({
      loadSigningKey,
      cacheTtlMs: options.configuration.certificateCacheTtlMs,
      ...(options.now ? { now: options.now } : {}),
    }),
    forwardFeedback: createBridgeFeedbackForwarder({
      apiUrl: options.configuration.apiUrl,
      serviceToken: options.configuration.serviceToken,
      timeoutMs: options.configuration.requestTimeoutMs,
      fetch: fetchImplementation,
    }),
    confirmSubscription: createSnsSubscriptionConfirmer({
      fetch: fetchImplementation,
      timeoutMs: options.configuration.requestTimeoutMs,
    }),
  });
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const startedAt = performance.now();
      const finish = (rendered: SesFeedbackHttpResponse, code?: string): void => {
        options.metrics.recordHttpRequest({
          service: "worker",
          operation: requestPath(request.url) === ingressPath ? ingressPath : "unmatched",
          statusCode: rendered.statusCode,
          durationMs: Math.max(0, performance.now() - startedAt),
        });
        if (code) options.logger?.warn("ses_feedback.request_rejected", { errorCode: code, status: "rejected" });
        response.writeHead(rendered.statusCode, rendered.headers);
        response.end(rendered.body);
      };
      if (requestPath(request.url) !== ingressPath) {
        request.resume();
        finish(jsonResponse(404, "not_found"));
        return;
      }
      if (request.method !== "POST") {
        request.resume();
        finish({
          statusCode: 405,
          headers: { ...responseHeaders, allow: "POST" },
          body: `${JSON.stringify({ status: "method_not_allowed" })}\n`,
        });
        return;
      }
      const contentType = singleHeader(request.headers, "content-type")?.toLowerCase();
      if (!contentType || (!contentType.startsWith("text/plain") && !contentType.startsWith("application/json"))) {
        request.resume();
        finish(jsonResponse(415, "unsupported_media_type"));
        return;
      }
      const declaredLength = singleHeader(request.headers, "content-length");
      if (
        declaredLength &&
        (!/^\d+$/.test(declaredLength) || Number(declaredLength) > options.configuration.maximumBodyBytes)
      ) {
        request.resume();
        finish(jsonResponse(413, "request_too_large"));
        return;
      }
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      let finished = false;
      request.on("data", (chunk: Buffer) => {
        if (finished) return;
        receivedBytes += chunk.byteLength;
        if (receivedBytes > options.configuration.maximumBodyBytes) {
          finished = true;
          finish(jsonResponse(413, "request_too_large"));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        if (finished) return;
        finished = true;
        void processRequest({ body: Buffer.concat(chunks).toString("utf8"), headers: request.headers })
          .then((rendered) => {
            options.logger?.info("ses_feedback.request_processed", { status: "success" });
            finish(rendered);
          })
          .catch((error: unknown) => {
            const rendered = errorResponse(error);
            finish(rendered.response, rendered.code);
          });
      });
      request.on("error", () => {
        if (finished) return;
        finished = true;
        finish(jsonResponse(400, "invalid_request"), "INVALID_REQUEST");
      });
    });
    const startupError = (error: Error): void => reject(error);
    server.once("error", startupError);
    server.listen(options.configuration.port, options.configuration.host, () => {
      server.removeListener("error", startupError);
      server.on("error", () => {
        options.logger?.error("ses_feedback.server_failed", { status: "failed" });
      });
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.configuration.port;
      resolve({
        host: options.configuration.host,
        port,
        close: () => closeServer(server),
      });
    });
  });
}
