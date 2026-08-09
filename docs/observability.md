# Observability foundation

Bridge provides vendor-neutral correlation, safe structured logging, bounded process-local metrics, Prometheus text export for the HTTP services, a pilot dashboard definition, alert rules, and initial service objectives. It does not require OpenTelemetry, CloudWatch, MCP, or a hosted deployment.

## Correlation flow

The correlation path is:

```text
web or CLI -> API/MCP -> application transaction -> audit/outbox -> worker -> integration
```

- Web and CLI requests generate `x-bridge-correlation-id`; API and MCP also generate one when a caller does not provide a valid value.
- Accepted values match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. Unsafe or oversized input is replaced rather than reflected.
- API and MCP return the effective ID through the same response header.
- The transport establishes an async context without adding transport parameters to domain commands.
- Direct application use receives a new context at the repository transaction boundary.
- Audit events and outbox events persist the same operation ID. Migration `0014_first_jane_foster.sql` safely backfills pre-existing rows before enforcing non-null and format constraints.
- A worker restores the persisted context for each claimed event. The provider-neutral email request receives the correlation ID explicitly alongside its stable idempotency key.
- Replaying an event preserves its original delivery correlation ID; the separate replay audit record receives the operator request's new correlation ID.

Correlation IDs are diagnostic metadata, not authentication, authorization, tenant scope, or proof that two actions have the same authority.

## Safe structured logging

`@bridge/observability` emits one JSON object per line through an injectable sink. API and MCP disable framework-default request logging and use the safe logger when runtime logging is enabled. Workers can receive the same logger through `runOutboxCycle`.

The logger preserves bounded operational fields such as record IDs, method, route, status, duration, event type, attempt count, client, capability, and backend. It redacts by default:

- authorization headers, cookies, credentials, tokens, API keys, passwords, and secrets;
- artifact bodies, content, prompts, outputs, answers, rationales, summaries, and titles;
- exception messages and unknown free-form strings;
- nested occurrences of the same fields.

Errors retain only a bounded error name and safe machine code when present. Logs must use stable internal event names and structured identifiers; callers must not encode customer content into event names, IDs, routes, or error codes.

## Current operator behavior

- `GET /health/live` and `GET /health/ready` return a correlation response header.
- API completion/failure and MCP completion/failure events use safe structured logs when those standalone servers run.
- Worker processed/retry/dead-letter log records reuse the outbox event's persisted correlation ID when a safe logger is supplied.
- Project-admin outbox inspection includes the durable correlation ID through the existing authorized event representation.

## Metrics and scraping

`@bridge/observability` includes a dependency-free `BridgeMetrics` registry. The API and standalone MCP service each create one registry shared with their application and PostgreSQL repository, then expose it through `GET /metrics` in Prometheus text format. For local inspection:

```bash
curl --silent http://127.0.0.1:4000/metrics
curl --silent http://127.0.0.1:4100/metrics
```

The endpoints intentionally contain no tenant, project, principal, record, prompt, answer, specification, or other content labels. Operations use route templates; unmatched paths collapse to `unmatched`, and the registry collapses operations beyond its 128-label process budget to `overflow`. A deployed reverse proxy must restrict `/metrics` to the monitoring network even though the current fixed-principal prototype does not implement authentication.

The registry records:

- HTTP request count, outcome, authorization denials, and duration by `api`/`mcp` and bounded operation;
- context success/error count, latency, result count, and candidate count;
- in-memory/PostgreSQL transaction count, outcome, and duration;
- most recent outbox-cycle timestamp and claim count, oldest claimed event age, processed work, retries, and dead letters;
- email delivery/policy outcome and handler duration.

API and MCP metrics are process-local and reset on restart. A multi-instance deployment must scrape every instance and aggregate in the metrics backend. The worker accepts the same registry through `runOutboxCycle` and `createNotificationEmailHandler`; its long-running scheduling/export host remains deployment-owned because the repository worker entry point is not yet a durable daemon.

Import `config/observability/bridge-pilot-dashboard.json` into Grafana (or translate its PromQL into the chosen dashboard system), load `config/observability/bridge-pilot-alerts.yml` into a Prometheus-compatible rule evaluator, and use [`service-objectives.md`](./service-objectives.md) for the initial objectives and threshold rationale.

## Remaining BRG-104 work

- OpenTelemetry spans/export and production collector wiring.
- MCP tool-name/session metrics beyond the bounded `/mcp` HTTP operation.
- Stable PostgreSQL pool-utilization telemetry supplied by the selected deployment/provider.
- A long-running worker metrics endpoint or collector integration and production evaluation of the included alert rules.
- Validation and tuning of the initial service objectives against representative pilot telemetry.
- Deployment-owned log access control, retention, and audit evidence.

The repository now supplies the portable instrumentation and operational definitions, but BRG-104 remains partial until a real deployment exports the worker/provider signals, evaluates alerts, proves database saturation coverage, and calibrates the objectives.
