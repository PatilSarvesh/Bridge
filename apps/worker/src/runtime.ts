import { BridgeService } from "@bridge/application";
import { createPostgresBridgeStore, type PostgresBridgeStore } from "@bridge/database";
import {
  BridgeMetrics,
  createSafeLogger,
  type SafeLogger,
} from "@bridge/observability";

import {
  runOutboxCycle,
  type AssumptionExpiryCycle,
  type BlockingQuestionEscalationCycle,
  type EmailDigestCycleResult,
  type OutboxCycleOptions,
  type OutboxHandler,
  type OutboxStore,
} from "./index.js";
import {
  createNotificationSlackHandler,
  createSlackChannelDirectoryFromEnvironment,
  createSlackWebhookSender,
} from "./slack.js";

const defaultPublicWebUrl = "http://127.0.0.1:3000";

export interface WorkerConfiguration {
  readonly databaseUrl: string;
  readonly publicWebUrl: string;
  readonly channel: "slack";
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly assumptionExpiryIntervalMs: number;
  readonly blockingQuestionEscalationIntervalMs: number;
  readonly emailDigestIntervalMs: number;
  readonly maxAttempts: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly retryJitterRatio: number;
  readonly metricsHost: string;
  readonly metricsPort: number;
}

export interface WorkerEnvironment {
  readonly BRIDGE_WORKER_DATABASE_URL?: string;
  readonly BRIDGE_PUBLIC_WEB_URL?: string;
  readonly BRIDGE_WORKER_CHANNEL?: string;
  readonly BRIDGE_WORKER_POLL_INTERVAL_MS?: string;
  readonly BRIDGE_WORKER_BATCH_SIZE?: string;
  readonly BRIDGE_WORKER_ASSUMPTION_EXPIRY_INTERVAL_MS?: string;
  readonly BRIDGE_WORKER_BLOCKING_ESCALATION_INTERVAL_MS?: string;
  readonly BRIDGE_WORKER_EMAIL_DIGEST_INTERVAL_MS?: string;
  readonly BRIDGE_WORKER_MAX_ATTEMPTS?: string;
  readonly BRIDGE_WORKER_BASE_BACKOFF_MS?: string;
  readonly BRIDGE_WORKER_MAX_BACKOFF_MS?: string;
  readonly BRIDGE_WORKER_RETRY_JITTER_PERCENT?: string;
  readonly BRIDGE_WORKER_METRICS_HOST?: string;
  readonly BRIDGE_WORKER_METRICS_PORT?: string;
}

export interface ConfiguredWorker {
  readonly configuration: WorkerConfiguration;
  readonly store: PostgresBridgeStore;
  readonly handler: OutboxHandler;
  readonly assumptionExpiryCycle: AssumptionExpiryCycle;
  readonly blockingQuestionEscalationCycle: BlockingQuestionEscalationCycle;
  readonly metrics: BridgeMetrics;
  readonly close: () => Promise<void>;
}

export interface WorkerSleep {
  (milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export interface OutboxWorkerOptions {
  readonly store: OutboxStore;
  readonly handler: OutboxHandler;
  readonly pollIntervalMs?: number;
  readonly cycleOptions?: Omit<OutboxCycleOptions, "logger" | "metrics">;
  readonly assumptionExpiryCycle?: AssumptionExpiryCycle;
  readonly assumptionExpiryIntervalMs?: number;
  readonly blockingQuestionEscalationCycle?: BlockingQuestionEscalationCycle;
  readonly blockingQuestionEscalationIntervalMs?: number;
  readonly emailDigestCycle?: () => Promise<EmailDigestCycleResult>;
  readonly emailDigestIntervalMs?: number;
  readonly logger?: SafeLogger;
  readonly metrics?: BridgeMetrics;
  readonly signal?: AbortSignal;
  readonly sleep?: WorkerSleep;
}

function requiredEnvironment(environment: WorkerEnvironment, name: "BRIDGE_WORKER_DATABASE_URL"): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Bridge worker.`);
  return value;
}

function positiveInteger(
  environment: WorkerEnvironment,
  name: keyof WorkerEnvironment,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${String(name)} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${String(name)} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function validatePublicWebUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BRIDGE_PUBLIC_WEB_URL must use HTTP or HTTPS.");
  }
  return url.toString();
}

function validateMetricsHost(value: string): string {
  const host = value.trim();
  if (!/^[A-Za-z0-9.:[\]-]{1,255}$/.test(host)) {
    throw new Error("BRIDGE_WORKER_METRICS_HOST must be a hostname or IP address without a URL scheme.");
  }
  return host;
}

export function loadWorkerConfiguration(
  environment: WorkerEnvironment = process.env,
): WorkerConfiguration {
  const databaseUrl = requiredEnvironment(environment, "BRIDGE_WORKER_DATABASE_URL");
  const publicWebUrl = validatePublicWebUrl(
    environment.BRIDGE_PUBLIC_WEB_URL?.trim() || defaultPublicWebUrl,
  );
  const channel = environment.BRIDGE_WORKER_CHANNEL?.trim() || "slack";
  if (channel !== "slack") {
    throw new Error("BRIDGE_WORKER_CHANNEL currently supports only `slack`.");
  }
  const baseBackoffMs = positiveInteger(
    environment,
    "BRIDGE_WORKER_BASE_BACKOFF_MS",
    1_000,
    100,
    60_000,
  );
  const maxBackoffMs = positiveInteger(
    environment,
    "BRIDGE_WORKER_MAX_BACKOFF_MS",
    15 * 60 * 1_000,
    1_000,
    86_400_000,
  );
  if (maxBackoffMs < baseBackoffMs) {
    throw new Error("BRIDGE_WORKER_MAX_BACKOFF_MS must be at least BRIDGE_WORKER_BASE_BACKOFF_MS.");
  }
  return {
    databaseUrl,
    publicWebUrl,
    channel,
    pollIntervalMs: positiveInteger(environment, "BRIDGE_WORKER_POLL_INTERVAL_MS", 1_000, 250, 60_000),
    batchSize: positiveInteger(environment, "BRIDGE_WORKER_BATCH_SIZE", 25, 1, 100),
    assumptionExpiryIntervalMs: positiveInteger(
      environment,
      "BRIDGE_WORKER_ASSUMPTION_EXPIRY_INTERVAL_MS",
      60_000,
      1_000,
      86_400_000,
    ),
    blockingQuestionEscalationIntervalMs: positiveInteger(
      environment,
      "BRIDGE_WORKER_BLOCKING_ESCALATION_INTERVAL_MS",
      60_000,
      1_000,
      86_400_000,
    ),
    emailDigestIntervalMs: positiveInteger(
      environment,
      "BRIDGE_WORKER_EMAIL_DIGEST_INTERVAL_MS",
      60_000,
      1_000,
      86_400_000,
    ),
    maxAttempts: positiveInteger(environment, "BRIDGE_WORKER_MAX_ATTEMPTS", 5, 1, 20),
    baseBackoffMs,
    maxBackoffMs,
    retryJitterRatio: positiveInteger(
      environment,
      "BRIDGE_WORKER_RETRY_JITTER_PERCENT",
      25,
      0,
      100,
    ) / 100,
    metricsHost: validateMetricsHost(environment.BRIDGE_WORKER_METRICS_HOST ?? "127.0.0.1"),
    metricsPort: positiveInteger(environment, "BRIDGE_WORKER_METRICS_PORT", 4_200, 1, 65_535),
  };
}

export function createConfiguredWorker(
  configuration: WorkerConfiguration,
  metrics = new BridgeMetrics(),
): ConfiguredWorker {
  const store = createPostgresBridgeStore(configuration.databaseUrl, {
    mode: "maintenance",
    metrics,
  });
  const handler = createNotificationSlackHandler({
    store: store.repository,
    channels: createSlackChannelDirectoryFromEnvironment(),
    sender: createSlackWebhookSender(),
    publicBaseUrl: configuration.publicWebUrl,
    metrics,
  });
  const service = new BridgeService(store.repository);
  return {
    configuration,
    store,
    handler,
    assumptionExpiryCycle: () => service.expireDueAssumptions(),
    blockingQuestionEscalationCycle: () => service.escalateDueBlockingQuestions(),
    metrics,
    close: store.close,
  };
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function runOutboxWorker(options: OutboxWorkerOptions): Promise<void> {
  const logger = options.logger ?? createSafeLogger({ service: "bridge-worker" });
  const signal = options.signal;
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 60_000) {
    throw new Error("Worker poll interval must be between 250 and 60000 milliseconds.");
  }
  const assumptionExpiryIntervalMs = options.assumptionExpiryIntervalMs ?? 60_000;
  if (
    !Number.isSafeInteger(assumptionExpiryIntervalMs) ||
    assumptionExpiryIntervalMs < 1_000 ||
    assumptionExpiryIntervalMs > 86_400_000
  ) {
    throw new Error("Worker assumption expiry interval must be between 1000 and 86400000 milliseconds.");
  }
  const emailDigestIntervalMs = options.emailDigestIntervalMs ?? 60_000;
  if (
    !Number.isSafeInteger(emailDigestIntervalMs) ||
    emailDigestIntervalMs < 1_000 ||
    emailDigestIntervalMs > 86_400_000
  ) {
    throw new Error("Worker email digest interval must be between 1000 and 86400000 milliseconds.");
  }
  const blockingQuestionEscalationIntervalMs = options.blockingQuestionEscalationIntervalMs ?? 60_000;
  if (
    !Number.isSafeInteger(blockingQuestionEscalationIntervalMs) ||
    blockingQuestionEscalationIntervalMs < 1_000 ||
    blockingQuestionEscalationIntervalMs > 86_400_000
  ) {
    throw new Error("Worker blocking-question escalation interval must be between 1000 and 86400000 milliseconds.");
  }

  let nextAssumptionExpiryAt = 0;
  let nextBlockingQuestionEscalationAt = 0;
  let nextEmailDigestAt = 0;
  while (!signal?.aborted) {
    if (options.assumptionExpiryCycle && Date.now() >= nextAssumptionExpiryAt) {
      try {
        const result = await options.assumptionExpiryCycle();
        logger.info("assumption_expiry.cycle_completed", {
          expiredCount: result.expiredCount,
          status: "success",
        });
      } catch (error) {
        logger.error("assumption_expiry.cycle_failed", { error, status: "retrying" });
      }
      nextAssumptionExpiryAt = Date.now() + assumptionExpiryIntervalMs;
    }
    if (
      options.blockingQuestionEscalationCycle &&
      Date.now() >= nextBlockingQuestionEscalationAt
    ) {
      try {
        const result = await options.blockingQuestionEscalationCycle();
        logger.info("blocking_question_escalation.cycle_completed", {
          escalatedCount: result.escalatedCount,
          status: "success",
        });
      } catch (error) {
        logger.error("blocking_question_escalation.cycle_failed", { error, status: "retrying" });
      }
      nextBlockingQuestionEscalationAt = Date.now() + blockingQuestionEscalationIntervalMs;
    }
    if (options.emailDigestCycle && Date.now() >= nextEmailDigestAt) {
      try {
        const result = await options.emailDigestCycle();
        logger.info("email_digest.cycle_completed", { ...result, status: "success" });
      } catch (error) {
        logger.error("email_digest.cycle_failed", { error, status: "retrying" });
      }
      nextEmailDigestAt = Date.now() + emailDigestIntervalMs;
    }
    try {
      const cycleOptions: OutboxCycleOptions = {
        ...options.cycleOptions,
        logger,
        ...(options.metrics ? { metrics: options.metrics } : {}),
      };
      const result = await runOutboxCycle(options.store, options.handler, {
        ...cycleOptions,
      });
      logger.info("worker.cycle_completed", {
        claimed: result.claimed,
        processed: result.processed,
        retried: result.retried,
        deadLettered: result.deadLettered,
        status: "success",
      });
    } catch (error) {
      logger.error("worker.cycle_failed", { error, status: "retrying" });
    }
    if (signal?.aborted) break;
    await sleep(pollIntervalMs, signal);
  }
}
