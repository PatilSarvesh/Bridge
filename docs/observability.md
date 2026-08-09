# Observability foundation

Bridge's first observability slice provides vendor-neutral correlation and safe structured logging. It does not require OpenTelemetry, CloudWatch, MCP, or a hosted deployment, and it does not claim that dashboards, metrics export, alerts, or service objectives are complete.

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

## Remaining BRG-104 work

- OpenTelemetry spans/export and production collector wiring.
- Request/tool latency, error, authorization-denial, context-performance, database-pool, notification, and queue-age metrics.
- Dashboards and alert rules for API/MCP failure, database exhaustion, and outbox backlog.
- Initial service-level indicators, objectives, and alert thresholds validated against pilot telemetry.
- Deployment-owned log access control, retention, and audit evidence.

Until these exist, correlation materially improves diagnosis but BRG-104 remains partial.
