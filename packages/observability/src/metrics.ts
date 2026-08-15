export type BridgeServiceName = "api" | "mcp";
export type BridgeRequestOutcome = "success" | "client_error" | "server_error";
export type BridgeDatabaseBackend = "memory" | "postgresql";
export type BridgeOperationOutcome = "success" | "error";
export type BridgeNotificationOutcome =
  | "delivered"
  | "failed"
  | "suppressed"
  | "deferred"
  | "skipped";
export type BridgeDetectedSecretType =
  | "bridge_service_token"
  | "github_token"
  | "aws_access_key"
  | "google_api_key"
  | "slack_token"
  | "stripe_live_key"
  | "ai_provider_key"
  | "private_key"
  | "bearer_token"
  | "credential_url"
  | "secret_url_parameter";
export type BridgeSecretContentType =
  | "administration"
  | "run"
  | "context"
  | "assumption"
  | "question"
  | "decision"
  | "artifact";

type MetricLabels = Readonly<Record<string, string>>;

interface CounterDefinition {
  readonly name: string;
  readonly help: string;
}

interface HistogramDefinition extends CounterDefinition {
  readonly buckets: readonly number[];
}

interface CounterState extends CounterDefinition {
  readonly labels: MetricLabels;
  value: number;
}

interface GaugeState extends CounterState {}

interface HistogramState extends HistogramDefinition {
  readonly labels: MetricLabels;
  readonly bucketCounts: number[];
  count: number;
  sum: number;
}

export interface BridgeMetricSample {
  readonly name: string;
  readonly labels: MetricLabels;
  readonly value: number;
}

export interface BridgeHistogramSample {
  readonly name: string;
  readonly labels: MetricLabels;
  readonly count: number;
  readonly sum: number;
  readonly buckets: readonly {
    readonly upperBound: number;
    readonly count: number;
  }[];
}

export interface BridgeMetricsSnapshot {
  readonly counters: readonly BridgeMetricSample[];
  readonly gauges: readonly BridgeMetricSample[];
  readonly histograms: readonly BridgeHistogramSample[];
}

export interface HttpRequestMetric {
  readonly service: BridgeServiceName;
  readonly operation: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

export interface ContextRetrievalMetric {
  readonly outcome: BridgeOperationOutcome;
  readonly durationMs: number;
  readonly resultCount?: number;
  readonly candidateCount?: number;
}

export interface DatabaseTransactionMetric {
  readonly backend: BridgeDatabaseBackend;
  readonly outcome: BridgeOperationOutcome;
  readonly durationMs: number;
}

export interface OutboxCycleMetric {
  readonly claimed: number;
  readonly processed: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly oldestClaimedAgeMs?: number;
  readonly observedAtMs?: number;
}

export interface NotificationDeliveryMetric {
  readonly channel: "email" | "slack";
  readonly outcome: BridgeNotificationOutcome;
  readonly durationMs: number;
}

export interface ContentSecretDetectionMetric {
  readonly contentType: BridgeSecretContentType;
  readonly secretType: BridgeDetectedSecretType;
}

const secondsBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
const countBuckets = [0, 1, 2, 5, 10, 20, 50, 100, 250] as const;
const maxOperationLabels = 128;

const definitions = {
  httpRequests: {
    name: "bridge_http_requests_total",
    help: "Completed Bridge HTTP requests.",
  },
  httpDuration: {
    name: "bridge_http_request_duration_seconds",
    help: "Bridge HTTP request duration in seconds.",
    buckets: secondsBuckets,
  },
  authorizationDenials: {
    name: "bridge_authorization_denials_total",
    help: "Bridge HTTP requests denied with status 401 or 403.",
  },
  contextRequests: {
    name: "bridge_context_requests_total",
    help: "Completed Bridge context retrieval operations.",
  },
  contextDuration: {
    name: "bridge_context_duration_seconds",
    help: "Bridge context retrieval duration in seconds.",
    buckets: secondsBuckets,
  },
  contextResults: {
    name: "bridge_context_result_count",
    help: "Number of context items returned by successful retrievals.",
    buckets: countBuckets,
  },
  contextCandidates: {
    name: "bridge_context_candidate_count",
    help: "Number of context candidates scored by successful retrievals.",
    buckets: countBuckets,
  },
  databaseTransactions: {
    name: "bridge_database_transactions_total",
    help: "Completed Bridge repository transactions.",
  },
  databaseTransactionDuration: {
    name: "bridge_database_transaction_duration_seconds",
    help: "Bridge repository transaction duration in seconds.",
    buckets: secondsBuckets,
  },
  outboxEvents: {
    name: "bridge_outbox_events_total",
    help: "Outbox events completed, retried, or dead-lettered by the worker.",
  },
  outboxClaimed: {
    name: "bridge_outbox_last_cycle_claimed",
    help: "Number of outbox events claimed by the most recent worker cycle.",
  },
  outboxOldestClaimedAge: {
    name: "bridge_outbox_oldest_claimed_age_seconds",
    help: "Age in seconds of the oldest event claimed by the most recent worker cycle.",
  },
  outboxLastCycleTimestamp: {
    name: "bridge_outbox_last_cycle_timestamp_seconds",
    help: "Unix timestamp in seconds of the most recent completed outbox worker cycle.",
  },
  notificationDeliveries: {
    name: "bridge_notification_deliveries_total",
    help: "Completed Bridge notification delivery attempts and policy outcomes.",
  },
  notificationDeliveryDuration: {
    name: "bridge_notification_delivery_duration_seconds",
    help: "Bridge notification delivery handling duration in seconds.",
    buckets: secondsBuckets,
  },
  contentSecretDetections: {
    name: "bridge_content_secret_detections_total",
    help: "Bridge content writes rejected after high-confidence secret detection.",
  },
} as const;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function countValue(value: number): number {
  return Math.floor(finiteNonNegative(value));
}

function normalizeOperation(value: string): string {
  const withoutQuery = value.split("?", 1)[0]?.trim() ?? "";
  const normalized = withoutQuery
    .replace(/[^A-Za-z0-9_/:.\-*]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return normalized || "unknown";
}

function requestOutcome(statusCode: number): BridgeRequestOutcome {
  if (statusCode >= 500) return "server_error";
  if (statusCode >= 400) return "client_error";
  return "success";
}

function labelsKey(labels: MetricLabels): string {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0000");
}

function seriesKey(name: string, labels: MetricLabels): string {
  return `${name}\u0000${labelsKey(labels)}`;
}

function escapeLabelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function renderLabels(labels: MetricLabels, extra?: readonly [string, string]): string {
  const entries = [...Object.entries(labels), ...(extra ? [extra] : [])]
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "";
  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(",")}}`;
}

function renderNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toString();
}

function sortedBySeries<T extends { readonly name: string; readonly labels: MetricLabels }>(
  samples: Iterable<T>,
): readonly T[] {
  return [...samples].sort((left, right) =>
    left.name.localeCompare(right.name) || labelsKey(left.labels).localeCompare(labelsKey(right.labels)),
  );
}

/**
 * A bounded, process-local registry for Bridge's operational metrics.
 *
 * The public recording methods accept only controlled dimensions. In particular,
 * tenant, project, principal, record, and free-form content labels are intentionally
 * absent to prevent cardinality growth and accidental customer-data disclosure.
 */
export class BridgeMetrics {
  private readonly counters = new Map<string, CounterState>();
  private readonly gauges = new Map<string, GaugeState>();
  private readonly histograms = new Map<string, HistogramState>();
  private readonly operationLabels = new Set<string>();

  recordHttpRequest(metric: HttpRequestMetric): void {
    const operation = this.boundedOperation(metric.service, metric.operation);
    const labels = {
      service: metric.service,
      operation,
      outcome: requestOutcome(metric.statusCode),
    };
    this.increment(definitions.httpRequests, labels);
    this.observe(
      definitions.httpDuration,
      { service: labels.service, operation: labels.operation },
      finiteNonNegative(metric.durationMs) / 1_000,
    );
    if (metric.statusCode === 401 || metric.statusCode === 403) {
      this.increment(definitions.authorizationDenials, {
        service: metric.service,
        operation: labels.operation,
        status: metric.statusCode.toString(),
      });
    }
  }

  recordContextRetrieval(metric: ContextRetrievalMetric): void {
    this.increment(definitions.contextRequests, { outcome: metric.outcome });
    this.observe(
      definitions.contextDuration,
      { outcome: metric.outcome },
      finiteNonNegative(metric.durationMs) / 1_000,
    );
    if (metric.outcome === "success") {
      this.observe(definitions.contextResults, {}, countValue(metric.resultCount ?? 0));
      this.observe(definitions.contextCandidates, {}, countValue(metric.candidateCount ?? 0));
    }
  }

  recordDatabaseTransaction(metric: DatabaseTransactionMetric): void {
    const labels = { backend: metric.backend, outcome: metric.outcome };
    this.increment(definitions.databaseTransactions, labels);
    this.observe(
      definitions.databaseTransactionDuration,
      labels,
      finiteNonNegative(metric.durationMs) / 1_000,
    );
  }

  recordOutboxCycle(metric: OutboxCycleMetric): void {
    this.increment(definitions.outboxEvents, { outcome: "processed" }, countValue(metric.processed));
    this.increment(definitions.outboxEvents, { outcome: "retried" }, countValue(metric.retried));
    this.increment(definitions.outboxEvents, { outcome: "dead_lettered" }, countValue(metric.deadLettered));
    this.setGauge(definitions.outboxClaimed, {}, countValue(metric.claimed));
    this.setGauge(
      definitions.outboxOldestClaimedAge,
      {},
      finiteNonNegative(metric.oldestClaimedAgeMs ?? 0) / 1_000,
    );
    if (metric.observedAtMs !== undefined) {
      this.setGauge(
        definitions.outboxLastCycleTimestamp,
        {},
        finiteNonNegative(metric.observedAtMs) / 1_000,
      );
    }
  }

  recordNotificationDelivery(metric: NotificationDeliveryMetric): void {
    const labels = { channel: metric.channel, outcome: metric.outcome };
    this.increment(definitions.notificationDeliveries, labels);
    this.observe(
      definitions.notificationDeliveryDuration,
      labels,
      finiteNonNegative(metric.durationMs) / 1_000,
    );
  }

  recordContentSecretDetection(metric: ContentSecretDetectionMetric): void {
    this.increment(definitions.contentSecretDetections, {
      content_type: metric.contentType,
      secret_type: metric.secretType,
    });
  }

  snapshot(): BridgeMetricsSnapshot {
    return {
      counters: sortedBySeries(this.counters.values()).map((sample) => ({
        name: sample.name,
        labels: { ...sample.labels },
        value: sample.value,
      })),
      gauges: sortedBySeries(this.gauges.values()).map((sample) => ({
        name: sample.name,
        labels: { ...sample.labels },
        value: sample.value,
      })),
      histograms: sortedBySeries(this.histograms.values()).map((sample) => ({
        name: sample.name,
        labels: { ...sample.labels },
        count: sample.count,
        sum: sample.sum,
        buckets: sample.buckets.map((upperBound, index) => ({
          upperBound,
          count: sample.bucketCounts[index] ?? 0,
        })),
      })),
    };
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    const counters = sortedBySeries(this.counters.values());
    const gauges = sortedBySeries(this.gauges.values());
    const histograms = sortedBySeries(this.histograms.values());

    this.renderSimpleSeries(lines, "counter", counters);
    this.renderSimpleSeries(lines, "gauge", gauges);
    let previousHistogram = "";
    for (const sample of histograms) {
      if (sample.name !== previousHistogram) {
        lines.push(`# HELP ${sample.name} ${sample.help}`, `# TYPE ${sample.name} histogram`);
        previousHistogram = sample.name;
      }
      sample.buckets.forEach((upperBound, index) => {
        lines.push(
          `${sample.name}_bucket${renderLabels(sample.labels, ["le", renderNumber(upperBound)])} ${sample.bucketCounts[index] ?? 0}`,
        );
      });
      lines.push(
        `${sample.name}_bucket${renderLabels(sample.labels, ["le", "+Inf"])} ${sample.count}`,
        `${sample.name}_sum${renderLabels(sample.labels)} ${renderNumber(sample.sum)}`,
        `${sample.name}_count${renderLabels(sample.labels)} ${sample.count}`,
      );
    }
    return `${lines.join("\n")}\n`;
  }

  private renderSimpleSeries(
    lines: string[],
    type: "counter" | "gauge",
    samples: readonly CounterState[],
  ): void {
    let previousName = "";
    for (const sample of samples) {
      if (sample.name !== previousName) {
        lines.push(`# HELP ${sample.name} ${sample.help}`, `# TYPE ${sample.name} ${type}`);
        previousName = sample.name;
      }
      lines.push(`${sample.name}${renderLabels(sample.labels)} ${renderNumber(sample.value)}`);
    }
  }

  private boundedOperation(service: BridgeServiceName, value: string): string {
    const operation = normalizeOperation(value);
    const key = `${service}:${operation}`;
    if (this.operationLabels.has(key)) return operation;
    if (this.operationLabels.size >= maxOperationLabels) return "overflow";
    this.operationLabels.add(key);
    return operation;
  }

  private increment(definition: CounterDefinition, labels: MetricLabels, value = 1): void {
    const amount = finiteNonNegative(value);
    const key = seriesKey(definition.name, labels);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += amount;
      return;
    }
    this.counters.set(key, { ...definition, labels: { ...labels }, value: amount });
  }

  private setGauge(definition: CounterDefinition, labels: MetricLabels, value: number): void {
    this.gauges.set(seriesKey(definition.name, labels), {
      ...definition,
      labels: { ...labels },
      value: finiteNonNegative(value),
    });
  }

  private observe(definition: HistogramDefinition, labels: MetricLabels, value: number): void {
    const observation = finiteNonNegative(value);
    const key = seriesKey(definition.name, labels);
    let state = this.histograms.get(key);
    if (!state) {
      state = {
        ...definition,
        labels: { ...labels },
        bucketCounts: definition.buckets.map(() => 0),
        count: 0,
        sum: 0,
      };
      this.histograms.set(key, state);
    }
    state.count += 1;
    state.sum += observation;
    definition.buckets.forEach((upperBound, index) => {
      if (observation <= upperBound) state!.bucketCounts[index] = (state!.bucketCounts[index] ?? 0) + 1;
    });
  }
}
