# Observability foundation

Bridge provides vendor-neutral correlation, safe structured logging, bounded process-local metrics, Prometheus text export for the API, optional MCP service, and worker, a pilot dashboard definition, alert rules, and initial service objectives. It does not require OpenTelemetry, CloudWatch, MCP, or a hosted deployment.

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
- A worker restores the persisted context for each claimed event. Provider-neutral email and Slack requests receive the correlation ID explicitly alongside their stable idempotency keys.
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
- API and MCP authentication failures emit a bounded `authentication.outcome` warning with the flow, fixed outcome, route/path, method, status, and the current correlation context; credential values and tenant attribution are never included.
- Worker processed/retry/dead-letter log records reuse the outbox event's persisted correlation ID when a safe logger is supplied.
- Project-admin outbox inspection includes the durable correlation ID through the existing authorized event representation.

## Metrics and scraping

`@bridge/observability` includes a dependency-free `BridgeMetrics` registry. The API and standalone MCP service each create one registry shared with their application and PostgreSQL repository; the worker shares one registry across its repository, outbox cycle, and integration handler. Each process exposes that registry through `GET /metrics` in Prometheus text format. For local inspection:

```bash
curl --silent http://127.0.0.1:4000/metrics
curl --silent http://127.0.0.1:4100/metrics
curl --silent http://127.0.0.1:4200/metrics
```

The endpoints intentionally contain no tenant, project, principal, record, prompt, answer, specification, destination, or other content labels. Operations use bounded route names; unmatched paths collapse to `unmatched`, and the registry collapses operations beyond its 128-label process budget to `overflow`. The worker listener defaults to `127.0.0.1:4200`; `BRIDGE_WORKER_METRICS_HOST` and `BRIDGE_WORKER_METRICS_PORT` are validated deployment overrides. A deployed reverse proxy or network policy must restrict every `/metrics` endpoint to the monitoring network because these scrape surfaces do not implement end-user authentication.

The registry records:

- HTTP request count, outcome, authorization denials, and duration by `api`/`mcp` and bounded operation;
- authentication outcomes by service and fixed flow/outcome (`authenticated`, `missing_credentials`, `invalid_credentials`, `authorization_denied`, or `configuration_error`), without tenant, project, principal, credential, or provider-response labels;
- context success/error count, latency, result count, and candidate count;
- in-memory/PostgreSQL transaction count, outcome, and duration;
- most recent outbox-cycle timestamp and claim count, oldest claimed event age, processed work, retries, and dead letters;
- email and Slack delivery/policy outcome and handler duration.
- high-confidence content-secret rejections by controlled content and detector type, without tenant, project, principal, record, or matched-value labels.
- bounded rate-limit denials by service and fixed transport/authenticated-quota bucket, without source, credential, tenant, project, principal, route, or content labels. API buckets distinguish pre-authentication auth/read/write safeguards from organization/principal read/write denials; they never label the affected organization, principal, or route.
- MCP initialize outcomes and tool-call success/error/duration by bounded tool name, without request arguments, session identifiers, tenant, project, principal, record, or content labels.
- idempotent write outcomes by a fixed operation/outcome vocabulary, plus application conflict totals without record, tenant, project, principal, or error-message labels.

API, MCP, and worker metrics are process-local and reset on restart. A multi-instance deployment must scrape every instance and aggregate in the metrics backend. Repository, `runOutboxCycle`, and Slack delivery instrumentation share the exported worker registry; an email-enabled deployment must pass the same registry to its provider-neutral email handler and digest composition.

Import `config/observability/bridge-pilot-dashboard.json` into Grafana (or translate its PromQL into the chosen dashboard system), load `config/observability/bridge-pilot-alerts.yml` into a Prometheus-compatible rule evaluator, and use [`service-objectives.md`](./service-objectives.md) for the initial objectives and threshold rationale.

Authentication outcome metrics are diagnostic transport signals, not audit records. A missing or invalid identity is intentionally not attributed to an organization, and a successful authentication outcome does not grant authority; the normal server-side membership and policy checks still decide access. The existing trusted-human sign-in/logout audit events remain the only persisted authentication events in the current slice.

## Remaining BRG-104 work

- OpenTelemetry spans/export and production collector wiring.
- Stable PostgreSQL pool-utilization telemetry supplied by the selected deployment/provider.
- Production scraping/collector integration and evaluation of the included alert rules for every deployed API, MCP, and worker instance.
- Validation and tuning of the initial service objectives against representative pilot telemetry.
- Deployment-owned log access control, retention, and audit evidence.

The repository now supplies the portable instrumentation and operational definitions, but BRG-104 remains partial until a real deployment exports the worker/provider signals, evaluates alerts, proves database saturation coverage, and calibrates the objectives.
