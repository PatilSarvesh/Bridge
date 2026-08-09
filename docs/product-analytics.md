# Privacy-conscious product analytics

Bridge calculates pilot product analytics from authoritative project records at read time. It does not copy conversations or content into a second analytics store, and it does not require MCP or an external analytics vendor.

## Access and filtering

The project-admin endpoint is:

```text
GET /v1/admin/projects/:projectId/analytics?client=&startedFrom=&startedTo=
```

- The path is the mandatory project filter.
- `client` accepts the controlled run clients `codex`, `claude_code`, `cursor`, `copilot`, `custom`, or `unknown`.
- `startedFrom` and `startedTo` are inclusive ISO 8601 timestamps and select runs by `startedAt`.
- All returned activity is attributed to that run cohort through durable run links.
- A human project administrator with access to the project is required. Agent and non-admin human principals are denied by the application layer.

The **Analytics** web view exposes the same project/client/date filters, summary cards, activity counts, guardrails, client breakdown, and collection notice. The current identity is still a fixed prototype principal; this endpoint is not production authentication or organization onboarding.

## Metric definitions

| Metric | Definition |
|---|---|
| Runs retrieving context | Selected runs with at least one linked context snapshot divided by selected runs |
| Context retrievals | Context snapshots linked to selected runs |
| Question submissions | Run-question associations in the cohort |
| Questions created | Associated questions whose originating `runId` is the selected run |
| Questions reused | Associations to a question created by another run |
| First-assignment routing coverage | Created questions having at least one owner ID or normalized owner role, divided by created questions |
| Responses proposed | Immutable response records on cohort-created questions, including the accepted source response when acceptance creates it |
| Decisions accepted | Cohort-created questions linked to a durable decision |
| Median decision time | Median duration from cohort question creation to decision creation |
| Accepted decisions reused | Distinct decisions retrieved in a context snapshot by a run other than the originating question's run |
| Decision reuse occurrences | Decision/context-snapshot pairs satisfying that later-run rule |
| Assumptions recorded/resolved | Run-linked assumptions and the subset whose current state is not `active` |
| Specification approval | Run-linked immutable versions with `approvedAt`, divided by run-linked published versions |
| Questions per run | Question submissions divided by selected runs |
| Context items per retrieval | Total snapshot item identifiers divided by context retrievals |

Rates return zero when the cohort denominator is zero. Durations are returned in milliseconds. Client breakdown rows use the same definitions and the already-filtered cohort.

## Data used and excluded

Analytics uses only lifecycle metadata needed for the calculations:

- project and run identifiers;
- controlled agent client/capability/status values;
- lifecycle timestamps and current statuses;
- links among runs, snapshots, questions, decisions, assumptions, and artifact versions;
- owner/role presence and aggregate item/response counts.

The response does not include or create analytics copies of:

- raw prompts, agent outputs, transcripts, or hidden reasoning;
- task summaries or question, response, comment, decision, assumption, and review text;
- specification titles, summaries, bodies, or hashes;
- principal names, notification content, external links, email addresses, secrets, or credentials.

The REST response repeats this collection/exclusion notice so an administrator can inspect the boundary without finding this document.

## Interpretation limits

- First-assignment routing measures whether Bridge had an explicit owner or role, not whether pilot users judge that person to be the correct expert. Routing correctness requires configured ownership data or pilot feedback.
- Decision retrieval proves that approved context was returned to a later run; it cannot prove the model followed it or that a new question was avoided.
- Cohorts select runs by start time, then show the current lifecycle outcomes of their linked records. This is useful for pilot outcomes but is not an immutable historical as-of report.
- Responses and some human actions do not carry their own run ID. They are attributed to the originating question's run and are not attributed again when a later run reuses that question.
- User-reported rework, question quality, mute/unsubscribe behavior, and secret-detection events are not yet technically available and are not guessed.
- The read-time calculation scans project aggregates. A later materialized analytics store requires a separate privacy/schema review, retention rules, backfill semantics, and tenant-safe aggregation.
