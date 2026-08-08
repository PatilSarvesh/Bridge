## Summary

<!-- What changed and why? -->

## Scope

- [ ] REST/API contract
- [ ] Domain/application policy
- [ ] PostgreSQL schema/migration
- [ ] CLI/agent adapter
- [ ] MCP
- [ ] Web UI
- [ ] Worker/outbox
- [ ] Documentation only

## Validation

- [ ] `pnpm check`
- [ ] PostgreSQL integration test (if relevant; isolated database only)
- [ ] Browser/manual verification (if UI behavior changed)

## Safety checklist

- [ ] No authentication or organization-onboarding behavior was added without explicit approval.
- [ ] MCP-independent behavior remains available.
- [ ] No secrets, tokens, raw transcripts, private reasoning, or customer data are committed.
- [ ] Migrations are forward-only and documented.
- [ ] Known limitations and follow-up work are recorded.
