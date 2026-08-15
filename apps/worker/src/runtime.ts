import { createPostgresBridgeStore, type PostgresBridgeStore } from "@bridge/database";
import {
  BridgeMetrics,
  createSafeLogger,
  type SafeLogger,
} from "@bridge/observability";

import {
  runOutboxCycle,
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
  readonly maxAttempts: number;
  readonly baseBackoffMs: number;
}

export interface WorkerEnvironment {
  readonly BRIDGE_WORKER_DATABASE_URL?: string;
  readonly BRIDGE_PUBLIC_WEB_URL?: string;
  readonly BRIDGE_WORKER_CHANNEL?: string;
  readonly BRIDGE_WORKER_POLL_INTERVAL_MS?: string;
  readonly BRIDGE_WORKER_BATCH_SIZE?: string;
  readonly BRIDGE_WORKER_MAX_ATTEMPTS?: string;
  readonly BRIDGE_WORKER_BASE_BACKOFF_MS?: string;
}

export interface ConfiguredWorker {
  readonly configuration: WorkerConfiguration;
  readonly store: PostgresBridgeStore;
  readonly handler: OutboxHandler;
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
  return {
    databaseUrl,
    publicWebUrl,
    channel,
    pollIntervalMs: positiveInteger(environment, "BRIDGE_WORKER_POLL_INTERVAL_MS", 1_000, 250, 60_000),
    batchSize: positiveInteger(environment, "BRIDGE_WORKER_BATCH_SIZE", 25, 1, 100),
    maxAttempts: positiveInteger(environment, "BRIDGE_WORKER_MAX_ATTEMPTS", 5, 1, 20),
    baseBackoffMs: positiveInteger(environment, "BRIDGE_WORKER_BASE_BACKOFF_MS", 1_000, 100, 60_000),
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
  return {
    configuration,
    store,
    handler,
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

  while (!signal?.aborted) {
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
