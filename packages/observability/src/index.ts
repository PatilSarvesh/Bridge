import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export * from "./rate-limit.js";
export * from "./metrics.js";

export const correlationIdHeader = "x-bridge-correlation-id";
export const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type CorrelationSource = "web" | "api" | "cli" | "mcp" | "application" | "worker" | "integration";

export interface CorrelationContext {
  readonly correlationId: string;
  readonly source: CorrelationSource;
}

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export function createCorrelationId(): string {
  return `cor_${randomUUID().replaceAll("-", "")}`;
}

export function resolveCorrelationId(candidate: string | undefined): string {
  const normalized = candidate?.trim();
  return normalized && correlationIdPattern.test(normalized)
    ? normalized
    : createCorrelationId();
}

export function currentCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

export function currentCorrelationId(): string | undefined {
  return currentCorrelationContext()?.correlationId;
}

export function runWithCorrelationContext<T>(
  context: CorrelationContext,
  work: () => T,
): T {
  return correlationStorage.run({
    ...context,
    correlationId: resolveCorrelationId(context.correlationId),
  }, work);
}

export function runWithCorrelationContextIfAbsent<T>(
  source: CorrelationSource,
  work: () => T,
): T {
  return currentCorrelationContext()
    ? work()
    : runWithCorrelationContext({ correlationId: createCorrelationId(), source }, work);
}

export type SafeLogLevel = "info" | "warn" | "error";
export type SafeLogAttributes = Readonly<Record<string, unknown>>;

export interface SafeLogger {
  info(event: string, attributes?: SafeLogAttributes): void;
  warn(event: string, attributes?: SafeLogAttributes): void;
  error(event: string, attributes?: SafeLogAttributes): void;
}

export interface SafeLoggerOptions {
  readonly service: string;
  readonly sink?: (line: string) => void;
  readonly now?: () => Date;
}

const REDACTED = "[redacted]";
const sensitiveKeyPattern = /(authorization|cookie|credential|token|secret|password|api.?key|body|content|context|prompt|output|answer|rationale|summary|title|message)/i;
const safeStringKeys = new Set([
  "action",
  "actorid",
  "artifactid",
  "artifactversionid",
  "backend",
  "capability",
  "channel",
  "client",
  "correlationid",
  "decisionid",
  "deliveryid",
  "errorcode",
  "errorname",
  "eventid",
  "method",
  "notificationid",
  "operation",
  "organizationid",
  "path",
  "principalid",
  "projectid",
  "questionid",
  "result",
  "route",
  "runid",
  "source",
  "status",
  "subjectid",
  "subjecttype",
  "tool",
  "type",
]);

function normalizedKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function safeIdentifier(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 128);
  return normalized || fallback;
}

function redactLogValue(key: string, value: unknown, depth: number): unknown {
  if (sensitiveKeyPattern.test(key)) return REDACTED;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return safeStringKeys.has(normalizedKey(key))
      ? value.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 256)
      : REDACTED;
  }
  if (value instanceof Error) {
    const errorCode = "code" in value && typeof value.code === "string" ? value.code : undefined;
    return {
      errorName: safeIdentifier(value.name, "Error"),
      ...(errorCode ? { errorCode: safeIdentifier(errorCode, "unknown") } : {}),
    };
  }
  if (depth >= 4) return REDACTED;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactLogValue(key, item, depth + 1));
  }
  if (typeof value === "object" && value !== undefined) {
    return Object.fromEntries(
      Object.entries(value).slice(0, 100).map(([nestedKey, nestedValue]) => [
        nestedKey,
        redactLogValue(nestedKey, nestedValue, depth + 1),
      ]),
    );
  }
  return REDACTED;
}

export function redactLogAttributes(attributes: SafeLogAttributes = {}): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(attributes).slice(0, 100).map(([key, value]) => [
      key,
      redactLogValue(key, value, 0),
    ]),
  );
}

export function createSafeLogger(options: SafeLoggerOptions): SafeLogger {
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const service = safeIdentifier(options.service, "bridge");
  const write = (level: SafeLogLevel, event: string, attributes: SafeLogAttributes = {}) => {
    const context = currentCorrelationContext();
    sink(JSON.stringify({
      ...redactLogAttributes(attributes),
      timestamp: now().toISOString(),
      level,
      service,
      event: safeIdentifier(event, "unknown"),
      ...(context ? { correlationId: context.correlationId, source: context.source } : {}),
    }));
  };
  return {
    info: (event, attributes) => write("info", event, attributes),
    warn: (event, attributes) => write("warn", event, attributes),
    error: (event, attributes) => write("error", event, attributes),
  };
}
