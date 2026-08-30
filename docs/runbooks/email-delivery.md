# SES email delivery runbook

Bridge can deliver immediate and digest notification email through AWS SES v2. This is a controlled
pilot deployment adapter: durable notifications, preferences, outbox retries, and privacy-minimized
receipts remain canonical in Bridge, while AWS account setup and recipient addresses stay outside the
database.

## Required deployment controls

Before enabling email, the deployment owner must:

1. Verify the approved sender identity in the selected SES region and request production access when
   the account is still in the SES sandbox.
2. Grant the worker task role only the required SES send action and database maintenance-role access.
   Bridge uses the standard AWS credential chain; do not place AWS access keys in Bridge variables.
3. Store the principal-to-address JSON mapping in deployment secret storage. Email addresses are
   customer identity data and must not be committed to this repository, copied into task logs, or
   placed in outbox payloads.
4. Configure an HTTPS `BRIDGE_PUBLIC_WEB_URL` whose OIDC callback, cookie domain, and access checks
   have been validated in the target environment.
5. Create one SNS topic per intended Bridge project boundary (or another deliberately reviewed exact
   mapping), configure SES bounce and complaint publication, and use SNS signature version 2 where
   available. Bridge rejects callback topics that are not present in its exact deployment mapping.
6. Create a project-restricted Bridge service identity of type `integration` with only
   `bridge:notifications:write`. Store its one-time token in deployment secret storage; do not reuse
   the worker database credential, a human session, or a broad administration token.
7. Route `POST /webhooks/aws/ses` through a TLS-terminating load balancer to the separately configured
   feedback listener. The listener is plain HTTP and loopback-only by default; never expose it directly
   to the public internet.

## Worker configuration

Use the separately provisioned maintenance-role PostgreSQL target. The worker never runs migrations.

```bash
export BRIDGE_WORKER_DATABASE_URL='postgresql://bridge_maintenance:REPLACE@db.example/bridge'
export BRIDGE_PUBLIC_WEB_URL='https://bridge.example'
export BRIDGE_WORKER_CHANNEL='email'
export BRIDGE_SES_REGION='ap-south-1'
export BRIDGE_SES_FROM_ADDRESS='bridge@example.com'
export BRIDGE_EMAIL_RECIPIENTS='{"usr_architect":"architect@example.com"}'
export BRIDGE_SES_CONFIGURATION_SET='bridge-pilot'
pnpm --filter @bridge/worker start
```

Use `BRIDGE_WORKER_CHANNEL=all` to run Slack and SES from the same outbox worker. `slack` remains the
default. Email mode fails closed at startup when region, sender, or recipients are missing. The
recipient mapping accepts 1–1,000 exact Bridge principal IDs and is held only in worker memory. A
persisted human preference still determines immediate, digest, or muted delivery; protected review
email remains immediate.

The optional SES configuration set must already exist. Provider tags contain only SHA-256 hashes of
the Bridge delivery and correlation keys. They support provider-side trace correlation without
copying record IDs or content.

## Signed bounce and complaint ingress

The optional ingress is disabled unless `BRIDGE_SES_FEEDBACK_INGRESS_ENABLED=true`. It runs beside
the outbox worker on a separate listener and always forwards normalized feedback through the
canonical Bridge REST API. It never writes provider input through the worker's maintenance database
connection.

Create the least-privilege service identity while signed in as an organization administrator. Do not
copy the returned token into shell history or repository files; move it directly into the deployment
secret manager.

```bash
bridge service identity create \
  --name 'SES feedback ingress' \
  --type integration \
  --scope bridge:notifications:write \
  --project prj_payments \
  --expires-at 2026-12-01T00:00:00Z \
  --api-url https://api.bridge.example
```

Configure the worker from secret-backed deployment variables:

```bash
export BRIDGE_SES_FEEDBACK_INGRESS_ENABLED='true'
export BRIDGE_SES_FEEDBACK_HOST='0.0.0.0'
export BRIDGE_SES_FEEDBACK_PORT='4300'
export BRIDGE_SES_FEEDBACK_API_URL='https://api.bridge.example'
export BRIDGE_SES_FEEDBACK_SERVICE_TOKEN='REPLACE_FROM_SECRET_MANAGER'
export BRIDGE_SES_FEEDBACK_TOPIC_PROJECTS='{"arn:aws:sns:ap-south-1:123456789012:bridge-feedback":"prj_payments"}'
export BRIDGE_SES_FEEDBACK_CONFIRM_SUBSCRIPTIONS='false'
```

The API must be running in authenticated/OIDC mode for the scoped service token. Plain HTTP API
forwarding is accepted only for an explicit loopback URL, so deployed worker-to-API traffic must use
HTTPS. The listener accepts at most 256 KB by default and uses a five-second bound for certificate,
subscription-confirmation, and Bridge API calls; both limits have bounded environment overrides.

Before processing any event, Bridge:

1. Requires the SNS message-type header to match the JSON envelope and rejects mismatched optional
   topic/message-ID headers.
2. Requires an exact configured `TopicArn` and an HTTPS signing-certificate URL on an SNS-owned AWS
   host with the expected certificate path.
3. Fetches the certificate without redirects, bounds its size/time, checks its validity period, and
   verifies SNS signature version 1 or 2. Version 2 (SHA-256 with RSA) is preferred; version 1 remains
   accepted for AWS compatibility.
4. Parses the signed SNS `Message` as SES JSON, tolerates unknown future fields, and extracts only
   `mail.messageId`, bounce/complaint type, and the provider timestamp. Recipient addresses, provider
   diagnostics, headers, and the raw callback are neither forwarded nor persisted.
5. Calls `POST /v1/projects/:projectId/integrations/notifications/delivery-feedback` with the scoped
   bearer token. A downstream failure returns `503` so SNS can retry; Bridge's canonical endpoint and
   a bounded process-local SNS message-ID cache make successful retries idempotent.

SNS subscription confirmation is intentionally disabled by default. After the exact topic mapping
and public HTTPS route are reviewed, set `BRIDGE_SES_FEEDBACK_CONFIRM_SUBSCRIPTIONS=true` and create
or retry the subscription. Bridge verifies the confirmation signature and topic first, then follows
only an exact same-SNS-host `ConfirmSubscription` URL whose topic and token match the signed envelope,
without redirects. Return the flag to `false` after confirmation if deployment policy requires an
explicit confirmation window. AWS documents the required [SNS signature verification](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html),
[HTTP notification envelope](https://docs.aws.amazon.com/sns/latest/dg/http-notification-json.html),
[subscription confirmation](https://docs.aws.amazon.com/sns/latest/dg/http-subscription-confirmation-json.html),
and [SES feedback payload](https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html).

## Validation

Validate first with an isolated non-production Bridge database and approved SES test recipients:

1. Start the API/web against the migrated isolated target and start the maintenance worker with
   `email` mode.
2. Create an ordinary assignment and a protected review notification through the canonical REST/web
   workflow. Do not insert outbox rows directly.
3. Confirm the recipient receives bounded plain text and the link requires normal Bridge sign-in.
4. Inspect the project outbox administration view. Confirm `email` delivery is `delivered`, has a
   provider message ID, and exposes no address.
5. Select digest preference, create ordinary notifications, run past the configured digest interval,
   and confirm one title-only digest is recorded under a stable batch key.
6. Subscribe the mapped HTTPS callback while confirmation is explicitly enabled. Confirm AWS reports
   a non-pending subscription, then send signed SES bounce and complaint simulator events.
7. Confirm the matching receipt becomes `failed` with controlled provider/type/time metadata in the
   Outbox and Support views. Confirm no address, raw provider payload, certificate URL, service token,
   or provider diagnostic appears in PostgreSQL, responses, metrics, or logs.
8. Replay the same SNS message and confirm the response is idempotent. Test an unmapped topic, modified
   signature, oversized body, certificate redirect, and unavailable Bridge API; verify they fail
   closed and the API outage remains retryable.
9. Exercise an SES send rejection in the isolated environment and confirm bounded retry/dead-letter
   state, a sanitized error, and operator replay behavior.

Do not use a production database for this validation unless the user has explicitly supplied and
approved that exact target.

## Delivery guarantee and incident boundary

Bridge delivery is at least once. A provider acknowledgement can succeed immediately before the
database receipt write fails; that narrow failure window can produce a duplicate after retry. The
stable event/batch keys and opaque SES tags support diagnosis but do not make SES exactly once.
Successful delivery never grants approval authority: recipients must sign in to Bridge, and only the
existing human policy boundary can accept decisions or approve specification versions.

The process-local SNS replay cache is an abuse/retry optimization, not a durable webhook-event store.
SNS reuses a message ID for its own retries, while the canonical REST command remains the durable
idempotency boundary by provider message ID and normalized feedback. Bridge does not provision the SNS
topic, SES identity, subscription, load-balancer route, DNS/TLS certificate, service token, alerting,
or live failure-window evidence; deployment owners must validate those before pilot readiness.
