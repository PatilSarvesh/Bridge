# Pilot service objectives

These are Bridge's initial engineering objectives for a controlled pilot. They are not a contractual SLA. The first two weeks of representative staging/pilot telemetry are the calibration period; the service owner records any threshold change, supporting evidence, and effective date in this file.

## Measurement boundary

- Availability and latency are calculated from `bridge_http_requests_total` and `bridge_http_request_duration_seconds` across all healthy instances.
- Server errors are HTTP `5xx`. Client errors are excluded from availability, but `401`/`403` are tracked separately as authorization-denial guardrails.
- `/health`, `/health/live`, and `/metrics` are excluded from user-journey availability. `/health/ready` is a dependency signal rather than user traffic.
- Context objectives use application-level context metrics, which include authorization, repository transaction, ranking, snapshot, and audit work.
- Database transaction-admission indicators describe top-level work queued by each Bridge process before the Postgres.js pool. They do not measure non-transactional health/bootstrap/identity queries, server connection limits, locks, or RDS-wide saturation.
- Outbox and notification objectives become active only when the deployment runs a durable worker and scrapes its process-local `BridgeMetrics` endpoint into the selected metrics backend.
- Planned maintenance approved before the event may be annotated, but the raw measurement must remain available.

## Initial objectives

| Indicator | Pilot objective | Window | Error budget / interpretation |
|---|---:|---:|---|
| API successful-request availability | 99.5% | Rolling 30 days | About 3h 39m equivalent unsuccessful time at continuous traffic |
| MCP successful-request availability | 99.0% | Rolling 30 days | MCP is optional; REST/CLI remain the fallback |
| Ordinary API latency | 95% under 1s; 99% under 5s | Rolling 7 days | The 5s value is also the implementation timeout budget |
| Context retrieval latency | 95% under 5s; 99% under 10s | Rolling 7 days | Includes ranking and durable snapshot/audit work |
| Context retrieval success | 99.0% | Rolling 7 days | Excludes caller validation and authorization denials |
| Database transaction admission | Neither queued work nor at least 90% slot use sustained for 5m | Continuous guardrail | Page and correlate process pressure with provider/server connection telemetry before changing capacity |
| Oldest ready/claimed outbox work | 99% under 5m | Rolling 7 days | Investigate at 5m; urgent escalation at 15m |
| Notification handling | 95% reaches a terminal policy/delivery result within 5m | Rolling 7 days | `suppressed`, `deferred`, and `skipped` are valid policy outcomes, not failures |

Low-volume periods can make ratios misleading. Paging alerts therefore require both a sustained ratio and a minimum request rate. Ticket alerts retain lower-volume durable failures such as dead letters.

## Alert thresholds and response

The importable Prometheus-compatible rules are in `config/observability/bridge-pilot-alerts.yml`.

| Alert | Threshold | Hold | Initial response |
|---|---|---:|---|
| API sustained failure | More than 5% `5xx`, with meaningful traffic | 10m | Page; verify readiness and PostgreSQL, preserve REST/CLI fallback evidence |
| MCP sustained failure | More than 5% `5xx`, with meaningful traffic | 10m | Page during an MCP-enabled pilot; direct agents to REST/CLI |
| Database availability risk | More than 5% transaction errors or sustained readiness failure | 5m | Page; inspect database availability, connection limits, locks, and saturation |
| Database transaction saturation | At least 90% admission-slot use or any queued top-level transaction | 5m | Page; identify slow work and validate PostgreSQL/RDS capacity before scaling or changing slot limits |
| Outbox backlog | Oldest claimed event or last completed worker cycle over 5m | 10m | Ticket; inspect worker progress, retries, leases, and provider status |
| Outbox dead letter | Any new dead letter | Immediate | Ticket; inspect the sanitized failure and use audited replay only after remediation |
| Notification delivery failure | More than 10% failures with at least 10 outcomes | 15m | Ticket; core writes remain available while notification delivery is degraded |

The availability alert detects externally visible failures. The transaction-saturation alert uses Bridge-owned FIFO admission gauges and wait histograms aligned with the configured Postgres.js maximum, so it can detect process-side pressure without driver internals. It is not PostgreSQL/RDS connection telemetry and can miss pressure from non-transactional health/bootstrap/identity queries or other clients. Before production, the deployment must also add provider/exporter server connection, pool saturation, and connection-limit telemetry without high-cardinality database labels.

## Review and ownership

- Pilot service owner: deployment operator designated for the pilot.
- Product authority owner: project decision owner; operators do not approve product decisions while responding to incidents.
- Review weekly during the calibration period and monthly afterward.
- Freeze paging thresholds during an active incident. Change them afterward with dated evidence, rather than suppressing a real failure.
- A notification-provider or MCP outage is degraded service, not permission to bypass human approval or write directly to PostgreSQL.
