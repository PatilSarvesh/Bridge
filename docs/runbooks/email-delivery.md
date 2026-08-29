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
5. Configure SES bounce/complaint feedback and an operator response path outside Bridge. The current
   adapter records send results but does not consume SES feedback events or automatically suppress an
   address.

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
6. Exercise an SES rejection in the isolated environment and confirm bounded retry/dead-letter state,
   a sanitized error, and operator replay behavior.

Do not use a production database for this validation unless the user has explicitly supplied and
approved that exact target.

## Delivery guarantee and incident boundary

Bridge delivery is at least once. A provider acknowledgement can succeed immediately before the
database receipt write fails; that narrow failure window can produce a duplicate after retry. The
stable event/batch keys and opaque SES tags support diagnosis but do not make SES exactly once.
Successful delivery never grants approval authority: recipients must sign in to Bridge, and only the
existing human policy boundary can accept decisions or approve specification versions.
