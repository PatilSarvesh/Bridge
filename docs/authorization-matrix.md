# Authorization and tenant-isolation matrix

This document records the implemented server-side authorization contract for BRG-102. It translates the default matrix in `docs/bridge-prd.md` into concrete Bridge commands and identifies unavailable product capabilities instead of treating them as implicit permissions.

## Principal and role semantics

- Every project operation first verifies organization and project access. An inaccessible project or record returns the same resource-specific `404` code as an absent identifier.
- An organization administrator has project-administrator authority for every project in the same organization, even when no separate project grant is present. This inheritance never crosses the organization boundary.
- Project roles apply only to their target project.
- A human decision owner may be selected by question owner ID/role or by the project's configured decision-owner IDs.
- A specification approver must be a configured artifact reviewer, configured project decision owner, project administrator, or organization administrator.
- A non-human principal can never satisfy `assertHuman`, even if it is assigned a human-looking role or appears in an owner/reviewer list.
- Protected acceptance requires both ordinary acceptance authority and an approved human security review, unless the accepting human independently has the security-reviewer role.

## PRD permissions matrix mapping

| PRD action | Agent / CI | Contributor | Reviewer | Decision owner | Project admin | Org admin | Implemented command and evidence |
|---|---|---|---|---|---|---|---|
| Read approved project context | Scoped | Allow | Allow | Allow | Allow | Allow | `getContext`; project access plus non-human `bridge:read` at REST/MCP |
| Create question | Allow | Allow | Allow | Allow | Allow | Allow | `createQuestion`; project access plus non-human `bridge:write` at REST/MCP |
| Comment or propose answer | Deny | Allow | Allow | Allow | Allow | Allow | `addQuestionComment` and `proposeAnswer` require a human |
| Reassign question | Deny | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | No reassignment command exists in the current product; no transport can grant it |
| Accept ordinary decision | Deny | Deny | Deny unless also owner | Allow | Allow | Allow | `acceptAnswer`; human owner/owner-role/project-admin policy |
| Accept protected approval | Deny | Deny | Policy-based | Policy-based | Policy-based | Policy-based | `reviewQuestion` plus `acceptAnswer`; separate approved security review and atomic acceptance |
| Record assumption | Allow within assumption policy | Allow | Allow | Allow | Allow | Allow | `recordAssumption`; agents require linked run provenance and all callers remain subject to low-risk/reversible policy |
| Publish artifact draft | Allow | Allow | Allow | Allow | Allow | Allow | `publishArtifact`; publishing never creates approval |
| Approve artifact | Deny | Deny | Policy-based | Allow | Allow | Allow | `approveArtifactVersion`; immutable version, human authority, and configured reviewer/owner/admin policy |
| Supersede decision | Deny | Deny | Deny unless also owner | Allow | Allow | Allow | `changeDecisionLifecycle`; human owner/configured project owner/admin plus optimistic version |
| Configure project ownership | Deny | Deny | Deny | Deny | Allow | Allow | `replaceProjectOwnershipConfiguration`; human project-admin policy, active-human team/target validation, optimistic aggregate version, and project audit event |
| Change project policy | Deny | Deny | Deny | Deny | Allow | Allow | `replaceProjectPolicyConfiguration`; human project-admin policy, immutable protected floors, overlap validation, optimistic aggregate version, and project audit event |
| Manage organization | Deny | Deny | Deny | Deny | Deny | Allow | Organization member and service-identity commands require `organization-admin` |

“Reviewer” is record-specific: a security reviewer can submit the protected-question review, while an artifact reviewer can review or approve only an artifact to which they are assigned. A reviewer does not gain ordinary decision-owner authority merely from the reviewer label.

## Transport boundary

| Transport | Authorization behavior |
|---|---|
| REST API | Canonical external boundary. Resolves the principal, applies coarse non-human read/write capability, then delegates to application policy. |
| Web UI | Calls REST and cannot manufacture approval state locally. |
| CLI | Calls REST. The agent-oriented CLI does not provide decision/specification approval commands. Repository snapshots contain server-approved context only; local edits do not create approval. |
| MCP | Optional agent surface. Uses the same application policy and coarse non-human capabilities. It intentionally exposes no accept, approve, protected-review, lifecycle, or organization-management tools. |

## ID-guessing and denial behavior

Project, run, assumption, question, decision, artifact/version, notification, and outbox lookups authorize before returning record data. For callers outside the organization or without the requested project grant:

- a real inaccessible project returns `PROJECT_NOT_FOUND`, matching an absent project ID;
- a real inaccessible record returns its own stable not-found code, matching an absent ID of that resource type;
- error bodies contain no record title, body, answer, rationale, principal name, or tenant metadata;
- collection, search, inbox, notification, analytics, support, outbox, and audit queries verify project access before reading the scoped collection.

This masks record existence while preserving `FORBIDDEN` for an authenticated principal who can access the project but lacks the action role, such as a contributor attempting acceptance or audit export.

## Automated evidence

- `packages/domain/src/index.test.ts` covers project-role isolation, same-organization org-admin inheritance, cross-organization denial, configured decision-owner approval, and non-human approval denial.
- `packages/application/src/index.test.ts` covers matrix-level human/agent policies, same-organization and cross-organization ID guessing for all implemented aggregate types, search/inbox/notification/outbox/audit isolation, and stable absent-versus-inaccessible errors.
- `apps/api/src/app.test.ts` covers REST scope enforcement, resource-specific ID masking, human-only approval, protected-review sequencing, and exactly one successful decision under concurrent protected acceptance requests.
- `apps/mcp/src/bridge-server.test.ts` verifies the MCP tool list contains agent submission/context tools but no human approval or lifecycle commands.
- `packages/database/src/row-security.test.ts` verifies the forward-only migration enables and forces every expected tenant policy even when CI has no live database.
- `packages/database/src/repository.integration.test.ts` covers serializable aggregate transactions, row locking, tenant predicates, composite tenant/project constraints, forced RLS catalog state, missing-scope default denial, and cross-organization read/write filtering when `BRIDGE_TEST_DATABASE_URL` points to an isolated PostgreSQL database.

## Deliberate remaining boundaries

- RLS now protects 22 tenant/project tables and application operations set transaction-local tenant context. The pre-tenant organization, principal-identity, and service-credential directories remain bounded bootstrap exceptions; repeatable production role/grant reconciliation is documented and live deployment evidence remains BRG-012 work. Application policy and composite constraints remain required alongside RLS.
- Question reassignment does not yet exist. Its future API requires an explicit matrix row, audit event, history, and adversarial tests before release.
- Live identity-provider and isolated PostgreSQL concurrency/ID-guessing evidence is deployment validation, not implied by the deterministic in-memory and optional integration suites.
- Coarse `bridge:read`, `bridge:write`, and `bridge:admin` capabilities remain; endpoint-specific non-human scopes are BRG-011/BRG-013 follow-up work.
