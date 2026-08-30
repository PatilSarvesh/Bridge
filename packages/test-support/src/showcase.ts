import { createHash } from "node:crypto";

import type { BridgeRepository } from "@bridge/application";
import {
  artifactApprovalStatus,
  type AdapterDiagnostic,
  type AgentRun,
  type Artifact,
  type ArtifactReview,
  type ArtifactReviewerAssignment,
  type ArtifactReviewerRouteSource,
  type ArtifactVersion,
  type Assumption,
  type AuditEvent,
  type ContextSnapshot,
  type Decision,
  type Notification,
  type OutboxDelivery,
  type OutboxEvent,
  type Principal,
  type Project,
  type ProjectOwnershipConfiguration,
  type ProjectPolicyConfiguration,
  type Question,
  type RepositoryRecord,
} from "@bridge/domain";

interface ShowcasePrincipals {
  readonly agent: Principal;
  readonly architect: Principal;
  readonly contributor: Principal;
  readonly qaLead: Principal;
  readonly securityReviewer: Principal;
  readonly businessAnalyst: Principal;
}

interface ShowcaseSeedOptions {
  readonly repository: BridgeRepository;
  readonly project: Project;
  readonly principals: ShowcasePrincipals;
  readonly now?: Date;
}

function shiftedIso(anchor: Date, days: number, hours = 0): string {
  return new Date(anchor.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString();
}

function contentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function artifactVersion(input: Omit<ArtifactVersion, "approvalStatus" | "contentSha256">): ArtifactVersion {
  const version = { ...input, contentSha256: contentHash(input.body) };
  return { ...version, approvalStatus: artifactApprovalStatus(version) };
}

function reviewerAssignment(
  id: string,
  reviewerIds: readonly string[],
  routeSource: ArtifactReviewerRouteSource,
  createdAt: string,
  options: {
    readonly ownershipRuleKey?: string;
    readonly requestedReviewerIds?: readonly string[];
    readonly requestedReviewerRoles?: readonly string[];
    readonly requestedReviewerTeamKeys?: readonly string[];
  } = {},
): ArtifactReviewerAssignment {
  return {
    id,
    reviewerIds,
    routeSource,
    ownershipVersion: 1,
    ...(options.ownershipRuleKey ? { ownershipRuleKey: options.ownershipRuleKey } : {}),
    requestedReviewerIds: options.requestedReviewerIds ?? [],
    requestedReviewerRoles: options.requestedReviewerRoles ?? [],
    requestedReviewerTeamKeys: options.requestedReviewerTeamKeys ?? [],
    createdAt,
  };
}

function routing(
  ownerSource: Question["routing"]["ownerSource"],
  reviewerSource: Question["routing"]["reviewerSource"],
  ownerRuleKey?: string,
  reviewerRuleKey?: string,
): Question["routing"] {
  return {
    ownerSource,
    reviewerSource,
    ownershipVersion: 1,
    policyVersion: 1,
    ...(ownerRuleKey ? { ownerRuleKey } : {}),
    ...(reviewerRuleKey ? { reviewerRuleKey } : {}),
  };
}

export const showcaseIds = {
  questions: {
    protected: "qst_showcase_protected_release",
    discussion: "qst_showcase_webhook_delivery",
    accepted: "qst_showcase_storage_retention",
    protectedAccepted: "qst_showcase_data_residency",
    unrouted: "qst_showcase_unrouted_copy",
    duplicate: "qst_showcase_duplicate_currency",
    cancelled: "qst_showcase_cancelled_export",
  },
  decisions: {
    retention: "dec_showcase_storage_retention",
    residency: "dec_showcase_data_residency",
    superseded: "dec_showcase_legacy_retry",
    revoked: "dec_showcase_revoked_export",
    expired: "dec_showcase_expired_cache",
  },
  artifacts: {
    prd: "art_showcase_prd",
    adr: "art_showcase_adr",
    api: "art_showcase_api",
    tests: "art_showcase_tests",
  },
  assumptions: {
    expiring: "asm_showcase_expiring_volume",
    active: "asm_showcase_active_browser",
    confirmed: "asm_showcase_confirmed_retention",
    rejected: "asm_showcase_rejected_regions",
    expired: "asm_showcase_expired_latency",
    superseded: "asm_showcase_superseded_webhook",
  },
  runs: {
    blocked: "run_showcase_blocked_release",
    running: "run_showcase_running_dashboard",
    completed: "run_showcase_completed_retention",
    failed: "run_showcase_failed_connector",
    cancelled: "run_showcase_cancelled_copy",
  },
} as const;

/**
 * Adds a broad, synthetic development dataset without replacing records that a
 * local reviewer has already changed. This fixture is never enabled in OIDC or
 * production mode and writes only through the repository bootstrap boundary.
 */
export async function seedShowcaseData(options: ShowcaseSeedOptions): Promise<void> {
  const { repository, project, principals } = options;
  const anchor = options.now ?? new Date();
  const { agent, architect, contributor, qaLead, securityReviewer, businessAnalyst } = principals;
  const q = showcaseIds.questions;
  const d = showcaseIds.decisions;
  const a = showcaseIds.artifacts;
  const s = showcaseIds.assumptions;
  const r = showcaseIds.runs;

  await repository.transaction(
    async (scopedRepository) => {
      const repositories: readonly RepositoryRecord[] = [
        {
          id: "repo_showcase_bridge",
          organizationId: project.organizationId,
          projectId: project.id,
          provider: "github",
          owner: "bridge-labs",
          name: "bridge",
          canonicalUrl: "https://github.com/bridge-labs/bridge",
          createdAt: shiftedIso(anchor, -48),
        },
        {
          id: "repo_showcase_payments",
          organizationId: project.organizationId,
          projectId: project.id,
          provider: "github",
          owner: "bridge-labs",
          name: "payments-api",
          canonicalUrl: "https://github.com/bridge-labs/payments-api",
          createdAt: shiftedIso(anchor, -31),
        },
      ];
      for (const record of repositories) {
        if (!(await scopedRepository.getRepositoryRecord(record.id))) {
          await scopedRepository.saveRepositoryRecord(record);
        }
      }

      if (!(await scopedRepository.getProjectOwnershipConfiguration(project.id))) {
        const ownership: ProjectOwnershipConfiguration = {
          organizationId: project.organizationId,
          projectId: project.id,
          roles: [
            { name: "component-owner", description: "Owns architecture and delivery choices for a bounded component." },
            {
              name: "architecture-reviewer",
              description: "Reviews system boundaries, compatibility, and maintainability.",
            },
            { name: "release-reviewer", description: "Validates rollout, observability, and recovery readiness." },
          ],
          teams: [
            { key: "payments-core", name: "Payments core", memberIds: [architect.id, contributor.id] },
            { key: "release-council", name: "Release council", memberIds: [qaLead.id, securityReviewer.id] },
          ],
          rules: [
            {
              key: "transfer-architecture",
              name: "Transfer architecture changes",
              priority: 10,
              category: "architecture",
              repository: "payments-api",
              component: "transfers",
              owners: { principalIds: [architect.id], roles: [], teamKeys: [] },
              reviewers: { principalIds: [], roles: ["architecture-reviewer"], teamKeys: ["release-council"] },
            },
            {
              key: "quality-routing",
              name: "Quality and test decisions",
              priority: 20,
              category: "quality",
              owners: { principalIds: [qaLead.id], roles: ["qa-lead"], teamKeys: [] },
              reviewers: { principalIds: [architect.id], roles: [], teamKeys: [] },
            },
            {
              key: "project-default",
              name: "Project default route",
              priority: 100,
              owners: { principalIds: [architect.id], roles: [], teamKeys: [] },
              reviewers: { principalIds: [], roles: [], teamKeys: ["release-council"] },
            },
          ],
          version: 1,
          updatedById: architect.id,
          updatedAt: shiftedIso(anchor, -12),
        };
        await scopedRepository.saveProjectOwnershipConfiguration(ownership, 0);
      }

      if (!(await scopedRepository.getProjectPolicyConfiguration(project.id))) {
        const policy: ProjectPolicyConfiguration = {
          organizationId: project.organizationId,
          projectId: project.id,
          rules: [
            {
              key: "production-release",
              name: "Protect production release changes",
              priority: 10,
              category: "release",
              scope: { repository: "payments-api", environment: "production" },
              action: "protected_approval",
              minimumRisk: "protected",
              requiredOwnerRoles: ["project-admin"],
              requiredReviewerRoles: ["security-reviewer"],
              reviewerQuorum: { "security-reviewer": 1 },
            },
            {
              key: "quality-gate",
              name: "Block high-risk quality regressions",
              priority: 20,
              category: "quality",
              scope: { repository: "payments-api" },
              action: "block",
              minimumRisk: "high",
              requiredOwnerRoles: ["qa-lead"],
              requiredReviewerRoles: ["architecture-owner"],
            },
            {
              key: "design-review",
              name: "Route design changes asynchronously",
              priority: 30,
              category: "design",
              scope: {},
              action: "ask_async",
              minimumRisk: "medium",
              requiredOwnerRoles: [],
              requiredReviewerRoles: [],
            },
          ],
          version: 1,
          updatedById: architect.id,
          updatedAt: shiftedIso(anchor, -10),
        };
        await scopedRepository.saveProjectPolicyConfiguration(policy, 0);
      }

      const runs: readonly AgentRun[] = [
        {
          id: r.blocked,
          organizationId: project.organizationId,
          projectId: project.id,
          agentId: agent.id,
          agentType: agent.type,
          client: "codex",
          capability: "hooks",
          continuationMode: "automatic",
          taskSummary: "Prepare the guarded production rollout for transfer webhooks",
          scope: {
            repository: "payments-api",
            component: "webhooks",
            branch: "feature/signed-webhooks",
            environment: "production",
            workItem: "PAY-284",
          },
          status: "waiting_for_human",
          contextSnapshotIds: ["ctx_showcase_release"],
          questionIds: [q.protected],
          artifactVersionIds: ["av_showcase_adr_v1"],
          assumptionIds: [s.expiring],
          externalLinks: ["https://github.com/bridge-labs/payments-api/issues/284"],
          resultLinks: [],
          startedAt: shiftedIso(anchor, -2, -5),
          updatedAt: shiftedIso(anchor, -1, -4),
          version: 5,
        },
        {
          id: r.running,
          organizationId: project.organizationId,
          projectId: project.id,
          agentId: agent.id,
          agentType: agent.type,
          client: "claude_code",
          capability: "cli",
          continuationMode: "manual",
          taskSummary: "Improve pilot analytics cards and responsive tables",
          scope: { repository: "bridge", component: "web", branch: "feature/analytics-density", workItem: "BRG-148" },
          status: "running",
          contextSnapshotIds: ["ctx_showcase_dashboard"],
          questionIds: [],
          artifactVersionIds: [],
          assumptionIds: [s.active],
          externalLinks: ["https://github.com/bridge-labs/bridge/issues/148"],
          resultLinks: [],
          startedAt: shiftedIso(anchor, -1, -1),
          updatedAt: shiftedIso(anchor, 0, -2),
          version: 3,
        },
        {
          id: r.completed,
          organizationId: project.organizationId,
          projectId: project.id,
          agentId: agent.id,
          agentType: agent.type,
          client: "cursor",
          capability: "mcp",
          continuationMode: "manual",
          taskSummary: "Define customer event retention and publish the product requirements",
          scope: {
            repository: "payments-api",
            component: "event-store",
            branch: "feature/retention",
            workItem: "PAY-231",
          },
          status: "completed",
          contextSnapshotIds: ["ctx_showcase_retention"],
          questionIds: [q.accepted],
          artifactVersionIds: ["av_showcase_prd_v2"],
          assumptionIds: [s.confirmed],
          externalLinks: ["https://github.com/bridge-labs/payments-api/issues/231"],
          resultLinks: ["https://github.com/bridge-labs/payments-api/pull/318"],
          startedAt: shiftedIso(anchor, -16),
          updatedAt: shiftedIso(anchor, -13),
          endedAt: shiftedIso(anchor, -13),
          summary: "Retention limits were approved by a human and reflected in the current PRD.",
          version: 7,
        },
        {
          id: r.failed,
          organizationId: project.organizationId,
          projectId: project.id,
          agentId: agent.id,
          agentType: agent.type,
          client: "copilot",
          capability: "instructions",
          continuationMode: "manual",
          taskSummary: "Synchronize external incident metadata for support triage",
          scope: {
            repository: "bridge",
            component: "integrations",
            branch: "spike/incident-sync",
            workItem: "BRG-139",
          },
          status: "failed",
          contextSnapshotIds: [],
          questionIds: [],
          artifactVersionIds: [],
          assumptionIds: [],
          externalLinks: [],
          resultLinks: [],
          startedAt: shiftedIso(anchor, -8),
          updatedAt: shiftedIso(anchor, -8, 2),
          endedAt: shiftedIso(anchor, -8, 2),
          summary: "The provider sandbox was unavailable; no external state was changed.",
          version: 2,
        },
        {
          id: r.cancelled,
          organizationId: project.organizationId,
          projectId: project.id,
          agentId: agent.id,
          agentType: agent.type,
          client: "custom",
          capability: "orchestrated",
          continuationMode: "manual",
          taskSummary: "Explore alternate empty-state copy for the review workspace",
          scope: { repository: "bridge", component: "web", branch: "experiment/empty-copy" },
          status: "cancelled",
          contextSnapshotIds: [],
          questionIds: [q.cancelled],
          artifactVersionIds: [],
          assumptionIds: [],
          externalLinks: [],
          resultLinks: [],
          startedAt: shiftedIso(anchor, -22),
          updatedAt: shiftedIso(anchor, -21),
          endedAt: shiftedIso(anchor, -21),
          summary: "The experiment was intentionally stopped after the design direction changed.",
          version: 2,
        },
      ];
      for (const run of runs) {
        if (!(await scopedRepository.getRun(run.id))) await scopedRepository.saveRun(run);
      }

      const questions: readonly Question[] = [
        {
          id: q.protected,
          organizationId: project.organizationId,
          projectId: project.id,
          runId: r.blocked,
          title: "May signed webhook delivery be enabled for the production rollout?",
          type: "approval",
          category: "release",
          context:
            "The new webhook path verifies signatures, deduplicates delivery attempts, and has passed staging load tests. Production enablement changes the external delivery boundary.",
          whyItMatters:
            "A rollout without explicit security approval could expose customer events or cause duplicate partner actions.",
          risk: "protected",
          policyAction: "protected_approval",
          policyVersion: 1,
          policyRuleKey: "production-release",
          reversible: true,
          blocking: true,
          dueAt: shiftedIso(anchor, -1),
          blockingEscalatedAt: shiftedIso(anchor, 0, -6),
          ownerIds: [architect.id],
          ownerRoles: ["project-admin"],
          requiredOwnerRoles: ["project-admin"],
          reviewerIds: [securityReviewer.id],
          reviewerRoles: ["security-reviewer"],
          requiredReviewerRoles: ["security-reviewer"],
          requiredReviewerQuorum: { "security-reviewer": 1 },
          routing: routing("scoped_ownership", "policy", "transfer-architecture", "production-release"),
          assignmentHistory: [
            {
              id: "qas_showcase_protected_initial",
              kind: "initial",
              changedById: agent.id,
              changedByType: agent.type,
              ownerIds: [architect.id],
              ownerRoles: ["project-admin"],
              reviewerIds: [securityReviewer.id],
              reviewerRoles: ["security-reviewer"],
              route: routing("scoped_ownership", "policy", "transfer-architecture", "production-release"),
              createdAt: shiftedIso(anchor, -2, -4),
              questionVersion: 1,
            },
          ],
          options: [
            {
              key: "staged-rollout",
              label: "Approve a staged 10% rollout",
              tradeoffs: "Limits initial exposure but requires active monitoring and a second promotion step.",
            },
            {
              key: "full-rollout",
              label: "Approve full production rollout",
              tradeoffs: "Finishes sooner but increases the impact of an undiscovered delivery issue.",
            },
            {
              key: "hold",
              label: "Hold for additional evidence",
              tradeoffs: "Reduces immediate risk but delays partner onboarding.",
            },
          ],
          relatedLinks: [
            {
              type: "repository",
              label: "payments-api repository",
              url: "https://github.com/bridge-labs/payments-api",
            },
            {
              type: "work_item",
              label: "PAY-284 rollout issue",
              url: "https://github.com/bridge-labs/payments-api/issues/284",
            },
            {
              type: "branch",
              label: "signed-webhooks branch",
              url: "https://github.com/bridge-labs/payments-api/tree/feature/signed-webhooks",
            },
            { type: "run", label: "Bridge agent run", url: `http://localhost:3000/?runId=${r.blocked}` },
          ],
          recommendationKey: "staged-rollout",
          fallback: null,
          scope: {
            repository: "payments-api",
            component: "webhooks",
            branch: "feature/signed-webhooks",
            environment: "production",
            workItem: "PAY-284",
          },
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -2, -4),
          status: "open",
          responses: [
            {
              id: "qrs_showcase_protected_response",
              questionId: q.protected,
              authorId: contributor.id,
              authorType: contributor.type,
              answer:
                "Start with a staged 10% rollout and automatically pause when signature failures exceed the agreed threshold.",
              rationale:
                "Staging preserves the rollback path while producing production evidence before full enablement.",
              optionKey: "staged-rollout",
              mentionedPrincipalIds: [securityReviewer.id],
              createdAt: shiftedIso(anchor, -1, -18),
            },
          ],
          reviews: [],
          comments: [
            {
              id: "qcm_showcase_protected_comment",
              questionId: q.protected,
              authorId: securityReviewer.id,
              authorType: securityReviewer.type,
              body: "Please confirm the alert threshold and identify who owns the rollback decision during the first hour.",
              mentionedPrincipalIds: [architect.id],
              createdAt: shiftedIso(anchor, -1, -12),
            },
          ],
          version: 4,
        },
        {
          id: q.discussion,
          organizationId: project.organizationId,
          projectId: project.id,
          title: "Which retry window should webhook delivery use after transient failures?",
          type: "decision",
          category: "architecture",
          context:
            "Partner endpoints occasionally return transient 429 and 503 responses. The retry worker currently has no agreed maximum delivery window.",
          whyItMatters:
            "The choice affects partner expectations, queue growth, support load, and how quickly permanent failures become visible.",
          risk: "high",
          policyAction: "block",
          policyVersion: 1,
          policyRuleKey: "demo-high-risk-default",
          reversible: true,
          blocking: true,
          dueAt: shiftedIso(anchor, 2),
          ownerIds: [architect.id],
          ownerRoles: ["architecture-owner"],
          requiredOwnerRoles: [],
          reviewerIds: [qaLead.id],
          reviewerRoles: ["qa-lead"],
          requiredReviewerRoles: [],
          routing: routing("explicit_owner", "scoped_ownership", undefined, "quality-routing"),
          assignmentHistory: [
            {
              id: "qas_showcase_discussion_initial",
              kind: "initial",
              changedById: agent.id,
              changedByType: agent.type,
              ownerIds: [businessAnalyst.id],
              ownerRoles: [],
              reviewerIds: [qaLead.id],
              reviewerRoles: ["qa-lead"],
              route: routing("explicit_owner", "scoped_ownership", undefined, "quality-routing"),
              createdAt: shiftedIso(anchor, -6),
              questionVersion: 1,
            },
            {
              id: "qas_showcase_discussion_reassigned",
              kind: "reassigned",
              changedById: architect.id,
              changedByType: architect.type,
              ownerIds: [architect.id],
              ownerRoles: ["architecture-owner"],
              reviewerIds: [qaLead.id],
              reviewerRoles: ["qa-lead"],
              route: routing("reassignment", "reassignment"),
              reason: "Architecture owns the queue behavior; QA remains the rollout reviewer.",
              createdAt: shiftedIso(anchor, -5),
              questionVersion: 2,
            },
          ],
          options: [
            {
              key: "six-hours",
              label: "Retry for up to 6 hours",
              tradeoffs: "Keeps the queue small but may abandon recoverable partner outages.",
            },
            {
              key: "twenty-four-hours",
              label: "Retry for up to 24 hours",
              tradeoffs: "Improves delivery durability at the cost of a larger queue and later failure visibility.",
            },
            {
              key: "seventy-two-hours",
              label: "Retry for up to 72 hours",
              tradeoffs: "Maximizes eventual delivery but creates significant operational backlog.",
            },
          ],
          relatedLinks: [
            { type: "external", label: "Webhook reliability guidance", url: "https://example.com/webhook-reliability" },
          ],
          recommendationKey: "twenty-four-hours",
          fallback: "Keep the current six-hour window until a human accepts a different option.",
          scope: { repository: "payments-api", component: "webhooks", environment: "production", workItem: "PAY-271" },
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -6),
          status: "in_discussion",
          responses: [
            {
              id: "qrs_showcase_discussion_response",
              questionId: q.discussion,
              authorId: contributor.id,
              authorType: contributor.type,
              answer: "Use a 24-hour retry window with bounded exponential backoff.",
              rationale:
                "Most partner incidents recover within a day and the queue capacity model supports that window.",
              optionKey: "twenty-four-hours",
              mentionedPrincipalIds: [qaLead.id],
              revisionHistory: [
                {
                  id: "qrr_showcase_discussion_revision",
                  answer: "Use a 12-hour retry window.",
                  rationale: "This was the initial estimate before the queue model was reviewed.",
                  optionKey: "six-hours",
                  mentionedPrincipalIds: [],
                  editedById: contributor.id,
                  editedByType: contributor.type,
                  editedAt: shiftedIso(anchor, -4, -8),
                },
              ],
              createdAt: shiftedIso(anchor, -5, -10),
            },
          ],
          reviews: [],
          comments: [
            {
              id: "qcm_showcase_discussion_parent",
              questionId: q.discussion,
              authorId: qaLead.id,
              authorType: qaLead.type,
              body: "Can we show the queue depth and dead-letter threshold used by the model?",
              mentionedPrincipalIds: [contributor.id],
              revisionHistory: [
                {
                  id: "qcr_showcase_discussion_revision",
                  body: "Can we show the queue depth used by the model?",
                  mentionedPrincipalIds: [contributor.id],
                  editedById: qaLead.id,
                  editedByType: qaLead.type,
                  editedAt: shiftedIso(anchor, -4, -3),
                },
              ],
              createdAt: shiftedIso(anchor, -4, -4),
            },
            {
              id: "qcm_showcase_discussion_reply",
              questionId: q.discussion,
              parentCommentId: "qcm_showcase_discussion_parent",
              authorId: contributor.id,
              authorType: contributor.type,
              body: "Yes. The current model stays below 35% capacity during a two-hour regional outage.",
              mentionedPrincipalIds: [qaLead.id],
              createdAt: shiftedIso(anchor, -4, -1),
            },
          ],
          version: 7,
        },
        {
          id: q.accepted,
          organizationId: project.organizationId,
          projectId: project.id,
          runId: r.completed,
          title: "How long should customer delivery events remain queryable?",
          type: "decision",
          category: "data-retention",
          context:
            "The event store currently retains delivery history indefinitely even though support workflows use only recent records.",
          whyItMatters:
            "A clear retention period controls storage growth and gives support and privacy teams a shared expectation.",
          risk: "medium",
          policyAction: "ask_async",
          policyVersion: 1,
          policyRuleKey: "demo-retention-review",
          reversible: true,
          blocking: false,
          dueAt: shiftedIso(anchor, -13),
          ownerIds: [businessAnalyst.id],
          ownerRoles: ["business-analyst"],
          requiredOwnerRoles: [],
          reviewerIds: [architect.id],
          reviewerRoles: ["architecture-owner"],
          requiredReviewerRoles: [],
          routing: routing("category_role", "project_default"),
          assignmentHistory: [
            {
              id: "qas_showcase_retention_initial",
              kind: "initial",
              changedById: agent.id,
              changedByType: agent.type,
              ownerIds: [businessAnalyst.id],
              ownerRoles: ["business-analyst"],
              reviewerIds: [architect.id],
              reviewerRoles: ["architecture-owner"],
              route: routing("category_role", "project_default"),
              createdAt: shiftedIso(anchor, -15),
              questionVersion: 1,
            },
          ],
          options: [
            {
              key: "ninety-days",
              label: "Retain for 90 days",
              tradeoffs: "Lowest storage cost but a shorter support investigation window.",
            },
            {
              key: "one-year",
              label: "Retain for one year",
              tradeoffs: "Balances support history with bounded storage and deletion operations.",
            },
            {
              key: "indefinite",
              label: "Retain indefinitely",
              tradeoffs: "Maximum history with unbounded storage and privacy obligations.",
            },
          ],
          recommendationKey: "one-year",
          fallback: "Retain for 90 days if no human decision is recorded before implementation starts.",
          scope: {
            repository: "payments-api",
            component: "event-store",
            environment: "production",
            workItem: "PAY-231",
          },
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -15),
          status: "accepted",
          responses: [
            {
              id: "qrs_showcase_retention_accepted",
              questionId: q.accepted,
              authorId: businessAnalyst.id,
              authorType: businessAnalyst.type,
              answer: "Retain delivery events for one year, then delete them through the governed retention job.",
              rationale:
                "One year covers the contractual dispute window without preserving operational records indefinitely.",
              optionKey: "one-year",
              createdAt: shiftedIso(anchor, -14),
            },
          ],
          reviews: [],
          comments: [],
          acceptedResponseId: "qrs_showcase_retention_accepted",
          decisionId: d.retention,
          version: 4,
        },
        {
          id: q.protectedAccepted,
          organizationId: project.organizationId,
          projectId: project.id,
          title: "Which region may store regulated customer event metadata?",
          type: "approval",
          category: "regulated-data",
          context:
            "Enterprise customers require event metadata to remain within an approved region while the reporting service is being expanded.",
          whyItMatters:
            "The storage region is a protected compliance boundary and must be approved by accountable humans.",
          risk: "protected",
          policyAction: "protected_approval",
          policyVersion: 1,
          policyRuleKey: "bridge-regulated-data",
          reversible: false,
          blocking: true,
          dueAt: shiftedIso(anchor, -28),
          ownerIds: [architect.id],
          ownerRoles: ["data-privacy-owner"],
          requiredOwnerRoles: ["data-privacy-owner"],
          reviewerIds: [securityReviewer.id],
          reviewerRoles: ["security-reviewer"],
          requiredReviewerRoles: ["security-reviewer"],
          routing: routing("policy", "policy"),
          assignmentHistory: [
            {
              id: "qas_showcase_residency_initial",
              kind: "initial",
              changedById: agent.id,
              changedByType: agent.type,
              ownerIds: [architect.id],
              ownerRoles: ["data-privacy-owner"],
              reviewerIds: [securityReviewer.id],
              reviewerRoles: ["security-reviewer"],
              route: routing("policy", "policy"),
              createdAt: shiftedIso(anchor, -35),
              questionVersion: 1,
            },
          ],
          options: [
            {
              key: "eu-only",
              label: "Store regulated metadata in the EU region only",
              tradeoffs: "Meets current customer commitments but adds region-aware routing.",
            },
            {
              key: "global",
              label: "Use the global event store",
              tradeoffs: "Simpler operations but does not meet the recorded residency requirement.",
            },
          ],
          recommendationKey: "eu-only",
          fallback: null,
          scope: {
            repository: "payments-api",
            component: "event-store",
            environment: "production",
            workItem: "PAY-198",
          },
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -35),
          status: "accepted",
          responses: [
            {
              id: "qrs_showcase_residency_accepted",
              questionId: q.protectedAccepted,
              authorId: architect.id,
              authorType: architect.type,
              answer: "Store regulated event metadata in the EU region only.",
              rationale:
                "This matches the approved customer and privacy boundary while keeping operational data minimal.",
              optionKey: "eu-only",
              createdAt: shiftedIso(anchor, -34),
            },
          ],
          reviews: [
            {
              id: "qrv_showcase_residency",
              questionId: q.protectedAccepted,
              reviewerId: securityReviewer.id,
              reviewerType: securityReviewer.type,
              reviewerRole: "security-reviewer",
              status: "approved",
              rationale: "The region boundary, encryption controls, and deletion procedure are explicit and testable.",
              createdAt: shiftedIso(anchor, -33),
            },
          ],
          comments: [],
          acceptedResponseId: "qrs_showcase_residency_accepted",
          decisionId: d.residency,
          version: 5,
        },
        {
          id: q.unrouted,
          organizationId: project.organizationId,
          projectId: project.id,
          title: "Who should own the terminology review for empty-state guidance?",
          type: "information",
          category: "content-design",
          context:
            "The redesigned workspace introduces new guidance across inbox, specification, and support empty states.",
          whyItMatters:
            "A named owner is needed so terminology remains consistent and understandable across every workspace area.",
          risk: "low",
          policyAction: "ask_async",
          policyVersion: 1,
          policyRuleKey: "demo-unrouted",
          reversible: true,
          blocking: false,
          dueAt: shiftedIso(anchor, 12),
          ownerIds: [],
          ownerRoles: [],
          requiredOwnerRoles: [],
          reviewerIds: [],
          reviewerRoles: [],
          requiredReviewerRoles: [],
          routing: routing("none", "none"),
          assignmentHistory: [
            {
              id: "qas_showcase_unrouted_initial",
              kind: "initial",
              changedById: agent.id,
              changedByType: agent.type,
              ownerIds: [],
              ownerRoles: [],
              reviewerIds: [],
              reviewerRoles: [],
              route: routing("none", "none"),
              createdAt: shiftedIso(anchor, -3),
              questionVersion: 1,
            },
          ],
          options: [],
          scope: { repository: "bridge", component: "web", branch: "feature/workspace-redesign", workItem: "BRG-151" },
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -3),
          status: "open",
          responses: [],
          reviews: [],
          comments: [],
          version: 1,
        },
        {
          id: q.duplicate,
          organizationId: project.organizationId,
          projectId: project.id,
          title: "Which currency should the sample expense tracker display by default?",
          type: "decision",
          category: "product",
          context:
            "A second agent run asked the same currency question after an earlier question had already been routed.",
          whyItMatters:
            "Showing duplicate history verifies that Bridge prevents repeated interruptions without hiding provenance.",
          risk: "low",
          policyAction: "ask_async",
          policyVersion: 1,
          policyRuleKey: "demo-product",
          reversible: true,
          blocking: false,
          ownerIds: [businessAnalyst.id],
          ownerRoles: ["business-analyst"],
          requiredOwnerRoles: [],
          reviewerIds: [],
          reviewerRoles: [],
          requiredReviewerRoles: [],
          routing: routing("explicit_owner", "none"),
          assignmentHistory: [
            {
              id: "qas_showcase_duplicate_initial",
              kind: "initial",
              changedById: agent.id,
              changedByType: agent.type,
              ownerIds: [businessAnalyst.id],
              ownerRoles: ["business-analyst"],
              reviewerIds: [],
              reviewerRoles: [],
              route: routing("explicit_owner", "none"),
              createdAt: shiftedIso(anchor, -19),
              questionVersion: 1,
            },
          ],
          options: [
            {
              key: "inr",
              label: "Indian rupee",
              tradeoffs: "Fits the first local demo but is less neutral for a reusable sample.",
            },
            {
              key: "user-selected",
              label: "Require the user to choose",
              tradeoffs: "Avoids a default but adds setup friction.",
            },
          ],
          recommendationKey: "inr",
          fallback: "Use the locale-derived currency in the non-production sample.",
          scope: { repository: "expense-tracker", component: "preferences" },
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -19),
          status: "duplicate",
          responses: [],
          reviews: [],
          comments: [],
          version: 2,
        },
        {
          id: q.cancelled,
          organizationId: project.organizationId,
          projectId: project.id,
          runId: r.cancelled,
          title: "Should the old dashboard copy remain during the redesign experiment?",
          type: "decision",
          category: "design",
          context: "The experiment was stopped after the product direction changed to a fully modular workspace.",
          whyItMatters: "Cancelled records demonstrate lifecycle history without presenting stale work as actionable.",
          risk: "medium",
          policyAction: "ask_async",
          policyVersion: 1,
          policyRuleKey: "design-review",
          reversible: true,
          blocking: false,
          ownerIds: [architect.id],
          ownerRoles: [],
          requiredOwnerRoles: [],
          reviewerIds: [],
          reviewerRoles: [],
          requiredReviewerRoles: [],
          routing: routing("explicit_owner", "none"),
          assignmentHistory: [
            {
              id: "qas_showcase_cancelled_initial",
              kind: "initial",
              changedById: agent.id,
              changedByType: agent.type,
              ownerIds: [architect.id],
              ownerRoles: [],
              reviewerIds: [],
              reviewerRoles: [],
              route: routing("explicit_owner", "none"),
              createdAt: shiftedIso(anchor, -22),
              questionVersion: 1,
            },
          ],
          options: [
            {
              key: "retain",
              label: "Retain the old copy",
              tradeoffs: "Reduces change but carries obsolete terminology.",
            },
            {
              key: "replace",
              label: "Replace it with the new language",
              tradeoffs: "Improves consistency but expands the experiment.",
            },
          ],
          recommendationKey: "replace",
          fallback: "Keep the current copy while the experiment is paused.",
          scope: { repository: "bridge", component: "web", branch: "experiment/empty-copy" },
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -22),
          status: "cancelled",
          responses: [],
          reviews: [],
          comments: [],
          version: 2,
        },
      ];
      for (const question of questions) {
        if (!(await scopedRepository.getQuestion(question.id))) await scopedRepository.saveQuestion(question);
      }

      const decisions: readonly Decision[] = [
        {
          id: d.retention,
          organizationId: project.organizationId,
          projectId: project.id,
          questionId: q.accepted,
          answer: "Retain customer delivery events for one year.",
          rationale:
            "A one-year window covers support and contractual needs while keeping storage and deletion obligations bounded.",
          category: "data-retention",
          scope: {
            repository: "payments-api",
            component: "event-store",
            environment: "production",
            workItem: "PAY-231",
          },
          ownerId: businessAnalyst.id,
          sourceResponseId: "qrs_showcase_retention_accepted",
          status: "active",
          createdAt: shiftedIso(anchor, -13),
          reviewAt: shiftedIso(anchor, 77),
          version: 1,
        },
        {
          id: d.residency,
          organizationId: project.organizationId,
          projectId: project.id,
          questionId: q.protectedAccepted,
          answer: "Store regulated customer event metadata in the EU region only.",
          rationale: "The approved region matches current commitments and keeps the protected data boundary explicit.",
          category: "regulated-data",
          scope: {
            repository: "payments-api",
            component: "event-store",
            environment: "production",
            workItem: "PAY-198",
          },
          ownerId: architect.id,
          sourceResponseId: "qrs_showcase_residency_accepted",
          status: "active",
          createdAt: shiftedIso(anchor, -32),
          reviewAt: shiftedIso(anchor, -2),
          version: 1,
        },
        {
          id: d.superseded,
          organizationId: project.organizationId,
          projectId: project.id,
          answer: "Retry every transfer failure three times without classifying the error.",
          rationale: "This was the original prototype rule and is retained only as historical context.",
          category: "architecture",
          scope: { repository: "payments-api", component: "transfers" },
          ownerId: architect.id,
          status: "superseded",
          createdAt: shiftedIso(anchor, -120),
          reviewAt: shiftedIso(anchor, -30),
          lifecycleRationale: "Replaced by the accepted transient-failure classification policy.",
          lifecycleChangedById: architect.id,
          lifecycleChangedAt: shiftedIso(anchor, -44),
          replacementDecisionId: d.retention,
          version: 2,
        },
        {
          id: d.revoked,
          organizationId: project.organizationId,
          projectId: project.id,
          answer: "Allow unrestricted CSV export from the pilot dashboard.",
          rationale: "The early pilot used a broad export while governance requirements were still being defined.",
          category: "data-export",
          scope: { repository: "bridge", component: "audit" },
          ownerId: architect.id,
          status: "revoked",
          createdAt: shiftedIso(anchor, -95),
          reviewAt: shiftedIso(anchor, -5),
          lifecycleRationale: "Revoked after governed bounded exports were introduced.",
          lifecycleChangedById: architect.id,
          lifecycleChangedAt: shiftedIso(anchor, -40),
          version: 2,
        },
        {
          id: d.expired,
          organizationId: project.organizationId,
          projectId: project.id,
          answer: "Cache project context for five minutes during the pilot.",
          rationale: "The bounded pilot cache reduced repeated reads while usage was low.",
          category: "performance",
          scope: { repository: "bridge", component: "context" },
          ownerId: architect.id,
          status: "expired",
          createdAt: shiftedIso(anchor, -180),
          reviewAt: shiftedIso(anchor, -90),
          lifecycleRationale: "The review date passed and the cache policy now requires fresh evidence.",
          lifecycleChangedById: architect.id,
          lifecycleChangedAt: shiftedIso(anchor, -89),
          version: 2,
        },
      ];
      for (const decision of decisions) {
        if (!(await scopedRepository.getDecision(decision.id))) await scopedRepository.saveDecision(decision);
      }

      const assumptions: readonly Assumption[] = [
        {
          id: s.expiring,
          organizationId: project.organizationId,
          projectId: project.id,
          runId: r.blocked,
          statement: "The first production webhook cohort will stay below 20,000 deliveries per hour.",
          rationale:
            "Current partner onboarding schedules and staging measurements support this temporary rollout estimate.",
          category: "capacity",
          risk: "low",
          confidence: "medium",
          reversible: true,
          reversalCost: "Reduce the rollout cohort and scale the delivery workers before resuming.",
          scope: { repository: "payments-api", component: "webhooks", environment: "production", workItem: "PAY-284" },
          sourceLinks: ["https://github.com/bridge-labs/payments-api/issues/284"],
          status: "active",
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -4),
          expiresAt: shiftedIso(anchor, 3),
          version: 1,
        },
        {
          id: s.active,
          organizationId: project.organizationId,
          projectId: project.id,
          runId: r.running,
          statement: "Most pilot reviewers will use a desktop viewport wider than 1024 pixels.",
          rationale:
            "The current pilot group primarily reviews Bridge from managed laptops, while mobile remains supported.",
          category: "design",
          risk: "low",
          confidence: "medium",
          reversible: true,
          reversalCost:
            "Reprioritize responsive density and navigation testing if mobile usage is higher than expected.",
          scope: { repository: "bridge", component: "web", workItem: "BRG-148" },
          sourceLinks: [],
          status: "active",
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -1),
          expiresAt: shiftedIso(anchor, 18),
          version: 1,
        },
        {
          id: s.confirmed,
          organizationId: project.organizationId,
          projectId: project.id,
          runId: r.completed,
          statement: "Support investigations require no more than one year of delivery-event history.",
          rationale:
            "The initial product plan used this premise while the retention owner gathered contractual evidence.",
          category: "data-retention",
          risk: "low",
          confidence: "high",
          reversible: true,
          reversalCost: "Extend the governed retention window and restore only from an approved archive if needed.",
          scope: {
            repository: "payments-api",
            component: "event-store",
            environment: "production",
            workItem: "PAY-231",
          },
          sourceLinks: ["https://github.com/bridge-labs/payments-api/issues/231"],
          status: "confirmed",
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -18),
          expiresAt: shiftedIso(anchor, 12),
          resolvedById: businessAnalyst.id,
          resolvedAt: shiftedIso(anchor, -13),
          resolutionRationale: "The human retention decision confirmed the bounded support-history requirement.",
          confirmedDecisionId: d.retention,
          version: 2,
        },
        {
          id: s.rejected,
          organizationId: project.organizationId,
          projectId: project.id,
          statement: "Every enterprise customer will require the same storage region.",
          rationale:
            "Early discovery included only EU customers and temporarily treated that cohort as representative.",
          category: "product",
          risk: "low",
          confidence: "low",
          reversible: true,
          reversalCost: "Introduce region-aware policy and routing before onboarding another residency cohort.",
          scope: { repository: "payments-api", component: "event-store" },
          sourceLinks: [],
          status: "rejected",
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -42),
          expiresAt: shiftedIso(anchor, -12),
          resolvedById: architect.id,
          resolvedAt: shiftedIso(anchor, -34),
          resolutionRationale: "Customer residency requirements differ and must remain explicit per governed scope.",
          version: 2,
        },
        {
          id: s.expired,
          organizationId: project.organizationId,
          projectId: project.id,
          statement: "The provider sandbox will remain below 400 milliseconds at the 95th percentile.",
          rationale: "This was a short-lived planning premise based on the first integration sample.",
          category: "performance",
          risk: "low",
          confidence: "low",
          reversible: true,
          reversalCost: "Adjust timeout budgets after collecting current provider measurements.",
          scope: { repository: "bridge", component: "integrations" },
          sourceLinks: [],
          status: "expired",
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -35),
          expiresAt: shiftedIso(anchor, -5),
          resolvedById: architect.id,
          resolvedAt: shiftedIso(anchor, -5),
          resolutionRationale: "The evidence window elapsed without sufficient live provider measurements.",
          version: 2,
        },
        {
          id: s.superseded,
          organizationId: project.organizationId,
          projectId: project.id,
          statement: "Webhook retries will require no more than six hours.",
          rationale: "The first capacity sketch used a six-hour maximum before partner recovery data was reviewed.",
          category: "architecture",
          risk: "low",
          confidence: "medium",
          reversible: true,
          reversalCost: "Increase queue capacity and update delivery expectations.",
          scope: { repository: "payments-api", component: "webhooks" },
          sourceLinks: [],
          status: "superseded",
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -28),
          expiresAt: shiftedIso(anchor, 2),
          resolvedById: architect.id,
          resolvedAt: shiftedIso(anchor, -6),
          resolutionRationale: "A newer assumption incorporates the reviewed queue-capacity model.",
          supersedingAssumptionId: s.expiring,
          version: 2,
        },
      ];
      for (const assumption of assumptions) {
        if (!(await scopedRepository.getAssumption(assumption.id))) await scopedRepository.saveAssumption(assumption);
      }

      const prdV1 = artifactVersion({
        id: "av_showcase_prd_v1",
        artifactId: a.prd,
        version: 1,
        summary: "Initial retention requirements prepared for product and privacy review.",
        body: "# Event retention requirements\n\n## Goal\n\nDefine a bounded customer-event retention period.\n\n## Initial requirement\n\nRetain events for 90 days.",
        citedDecisionIds: [],
        status: "superseded",
        createdById: agent.id,
        createdByType: agent.type,
        createdAt: shiftedIso(anchor, -17),
        reviews: [
          {
            id: "arv_showcase_prd_v1_comment",
            artifactVersionId: "av_showcase_prd_v1",
            reviewerId: businessAnalyst.id,
            reviewerType: businessAnalyst.type,
            status: "commented",
            body: "Please align the period with the contractual dispute window before approval.",
            createdAt: shiftedIso(anchor, -16, 2),
          },
        ],
        requiredApprovals: 1,
        reviewerAssignment: reviewerAssignment(
          "ara_showcase_prd_v1",
          [businessAnalyst.id],
          "explicit_reviewer",
          shiftedIso(anchor, -17),
          { requestedReviewerIds: [businessAnalyst.id] },
        ),
        runId: r.completed,
      });
      const prdV2 = artifactVersion({
        id: "av_showcase_prd_v2",
        artifactId: a.prd,
        version: 2,
        summary: "Approved product requirements for one-year event retention and governed deletion.",
        body: `# Event retention requirements

## Outcome

Customer delivery events remain queryable for **one year**, then the governed retention job removes them.

## Product requirements

- Support can search events by customer, delivery, and date.
- The UI shows the scheduled deletion date.
- Deletion is auditable and cannot be triggered by an agent.
- Export remains bounded to the authorized project.

## Success measures

| Measure | Target |
| --- | --- |
| Retention coverage | 365 days |
| Deletion job completion | 99.9% within 24 hours |
| Unauthorized export | 0 events |

> Human approval remains authoritative for any future change to the retention period.

## Delivery checklist

- [x] Record the human decision
- [x] Define deletion ownership
- [ ] Complete isolated restore evidence
`,
        citedDecisionIds: [d.retention],
        status: "approved",
        createdById: agent.id,
        createdByType: agent.type,
        createdAt: shiftedIso(anchor, -13),
        reviews: [
          {
            id: "arv_showcase_prd_v2_approval",
            artifactVersionId: "av_showcase_prd_v2",
            reviewerId: architect.id,
            reviewerType: architect.type,
            status: "approved",
            body: "Approved because the requirement cites the accepted retention decision and preserves governed deletion.",
            createdAt: shiftedIso(anchor, -12),
          },
        ],
        requiredApprovals: 1,
        reviewerAssignment: reviewerAssignment(
          "ara_showcase_prd_v2",
          [architect.id, businessAnalyst.id],
          "scoped_ownership",
          shiftedIso(anchor, -13),
          { ownershipRuleKey: "product-requirements-review" },
        ),
        runId: r.completed,
        approvedById: architect.id,
        approvalRationale: "The product, privacy, and operational boundaries are explicit and traceable.",
        approvedAt: shiftedIso(anchor, -12),
      });
      const adrV1 = artifactVersion({
        id: "av_showcase_adr_v1",
        artifactId: a.adr,
        version: 1,
        summary: "Proposes signed delivery, idempotent retries, and a staged production rollout.",
        body: `# Signed webhook delivery architecture

## Status

In review. Human approval has not been completed.

## Context

Partners need reliable event delivery without allowing duplicate processing or unsigned requests.

## Decision proposal

1. Verify every webhook with a versioned signature.
2. Persist one idempotency key per delivery attempt.
3. Retry only transient failures with bounded exponential backoff.
4. Begin with a 10% production cohort and an explicit rollback owner.

## Operational guardrails

\`\`\`text
pause rollout when signature_failure_rate > 0.5%
pause rollout when duplicate_delivery_rate > 0.1%
\`\`\`

## Consequences

- Delivery becomes observable and recoverable.
- Key rotation and partner clock skew need dedicated tests.
- Production enablement still requires the open protected question.
`,
        citedDecisionIds: [],
        status: "in_review",
        createdById: agent.id,
        createdByType: agent.type,
        createdAt: shiftedIso(anchor, -2),
        reviews: [
          {
            id: "arv_showcase_adr_v1_comment",
            artifactVersionId: "av_showcase_adr_v1",
            reviewerId: qaLead.id,
            reviewerType: qaLead.type,
            status: "commented",
            body: "The staged rollout and pause thresholds are testable; add the recovery drill result before final approval.",
            createdAt: shiftedIso(anchor, -1),
          },
        ],
        requiredApprovals: 2,
        reviewerAssignment: reviewerAssignment(
          "ara_showcase_adr_v1",
          [architect.id, qaLead.id, securityReviewer.id],
          "scoped_ownership",
          shiftedIso(anchor, -2),
          { ownershipRuleKey: "webhook-architecture-review" },
        ),
        runId: r.blocked,
      });
      const apiV1 = artifactVersion({
        id: "av_showcase_api_v1",
        artifactId: a.api,
        version: 1,
        summary: "Defines the partner-facing webhook envelope and retry response semantics.",
        body: `# Webhook delivery API contract

## Request envelope

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| \`event_id\` | string | yes | Stable idempotency identifier |
| \`event_type\` | string | yes | Versioned event name |
| \`occurred_at\` | timestamp | yes | UTC source time |
| \`data\` | object | yes | Event-specific payload |

## Responses

- \`2xx\`: delivery accepted
- \`408\`, \`429\`, \`5xx\`: transient failure
- other \`4xx\`: permanent failure

## Compatibility

Consumers ignore unknown additive fields. Breaking changes require a new event version.
`,
        citedDecisionIds: [],
        status: "in_review",
        createdById: agent.id,
        createdByType: agent.type,
        createdAt: shiftedIso(anchor, -7),
        reviews: [
          {
            id: "arv_showcase_api_v1_changes",
            artifactVersionId: "av_showcase_api_v1",
            reviewerId: securityReviewer.id,
            reviewerType: securityReviewer.type,
            status: "changes_requested",
            body: "Specify the signature headers, accepted clock skew, and key-rotation overlap before this contract can be approved.",
            createdAt: shiftedIso(anchor, -6),
          },
        ],
        requiredApprovals: 1,
        reviewerAssignment: reviewerAssignment(
          "ara_showcase_api_v1",
          [securityReviewer.id],
          "explicit_reviewer",
          shiftedIso(anchor, -7),
          { requestedReviewerRoles: ["security-reviewer"] },
        ),
      });
      const testV1 = artifactVersion({
        id: "av_showcase_tests_v1",
        artifactId: a.tests,
        version: 1,
        summary: "Draft verification plan spanning unit, contract, integration, and rollout checks.",
        body: `# Webhook verification plan

## Test layers

- Unit tests for signature parsing and retry classification
- Contract tests for the versioned envelope
- Isolated PostgreSQL integration tests for idempotency
- Staging load test for the expected pilot cohort

## Required evidence

- [ ] Clock-skew boundary tests
- [ ] Key-rotation overlap test
- [x] Duplicate-delivery idempotency test
- [ ] Production rollback drill
`,
        citedDecisionIds: [],
        status: "draft",
        createdById: agent.id,
        createdByType: agent.type,
        createdAt: shiftedIso(anchor, -5),
        reviews: [],
        requiredApprovals: 1,
        reviewerAssignment: reviewerAssignment(
          "ara_showcase_tests_v1",
          [qaLead.id],
          "project_default",
          shiftedIso(anchor, -5),
          { ownershipRuleKey: "project-quality-review" },
        ),
      });
      const artifacts: readonly Artifact[] = [
        {
          id: a.prd,
          organizationId: project.organizationId,
          projectId: project.id,
          title: "Customer event retention requirements",
          type: "prd",
          scope: { repository: "payments-api", component: "event-store", workItem: "PAY-231" },
          reviewerIds: [architect.id, businessAnalyst.id],
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -17),
          currentVersionId: prdV2.id,
          approvedVersionId: prdV2.id,
          versions: [prdV1, prdV2],
        },
        {
          id: a.adr,
          organizationId: project.organizationId,
          projectId: project.id,
          title: "Signed webhook delivery architecture",
          type: "adr",
          scope: { repository: "payments-api", component: "webhooks", environment: "production", workItem: "PAY-284" },
          reviewerIds: [architect.id, qaLead.id, securityReviewer.id],
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -2),
          currentVersionId: adrV1.id,
          versions: [adrV1],
        },
        {
          id: a.api,
          organizationId: project.organizationId,
          projectId: project.id,
          title: "Webhook delivery API contract",
          type: "api_contract",
          scope: { repository: "payments-api", component: "webhooks", workItem: "PAY-276" },
          reviewerIds: [securityReviewer.id],
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -7),
          currentVersionId: apiV1.id,
          versions: [apiV1],
        },
        {
          id: a.tests,
          organizationId: project.organizationId,
          projectId: project.id,
          title: "Webhook verification and rollout test plan",
          type: "test_plan",
          scope: { repository: "payments-api", component: "webhooks", workItem: "PAY-284" },
          reviewerIds: [qaLead.id],
          createdById: agent.id,
          createdByType: agent.type,
          createdAt: shiftedIso(anchor, -5),
          currentVersionId: testV1.id,
          versions: [testV1],
        },
      ];
      for (const artifact of artifacts) {
        if (!(await scopedRepository.getArtifact(artifact.id))) await scopedRepository.saveArtifact(artifact);
      }

      const snapshots: readonly ContextSnapshot[] = [
        {
          id: "ctx_showcase_release",
          organizationId: project.organizationId,
          projectId: project.id,
          principalId: agent.id,
          runId: r.blocked,
          task: "Prepare the signed webhook rollout with governed release approval.",
          itemIds: [d.residency, a.prd, s.expiring],
          createdAt: shiftedIso(anchor, -2, -5),
        },
        {
          id: "ctx_showcase_dashboard",
          organizationId: project.organizationId,
          projectId: project.id,
          principalId: agent.id,
          runId: r.running,
          task: "Improve analytics information density without exposing governed content.",
          itemIds: [a.prd, s.active],
          createdAt: shiftedIso(anchor, -1, -1),
        },
        {
          id: "ctx_showcase_retention",
          organizationId: project.organizationId,
          projectId: project.id,
          principalId: agent.id,
          runId: r.completed,
          task: "Implement the accepted one-year event retention requirement.",
          itemIds: [d.retention, a.prd, s.confirmed],
          createdAt: shiftedIso(anchor, -15),
        },
      ];
      const existingSnapshots = new Set(
        (await scopedRepository.listContextSnapshots(project.id)).map((snapshot) => snapshot.id),
      );
      for (const snapshot of snapshots) {
        if (!existingSnapshots.has(snapshot.id)) await scopedRepository.saveContextSnapshot(snapshot);
      }

      const diagnostics: readonly AdapterDiagnostic[] = [
        {
          organizationId: project.organizationId,
          projectId: project.id,
          client: "codex",
          reportedById: agent.id,
          reportedByType: agent.type,
          correlationId: "demo_diag_codex_20260827",
          capabilities: ["instructions", "cli", "hooks"],
          mcpStatus: "not_configured",
          checks: [
            { name: "api", status: "pass" },
            { name: "project-config", status: "pass" },
            { name: "project-mapping", status: "pass" },
            { name: "bridge-instructions", status: "pass" },
            { name: "client-instructions", status: "pass" },
            { name: "mcp", status: "pass" },
          ],
          status: "pass",
          observedAt: shiftedIso(anchor, 0, -3),
          history: [],
        },
        {
          organizationId: project.organizationId,
          projectId: project.id,
          client: "cursor",
          reportedById: agent.id,
          reportedByType: agent.type,
          correlationId: "demo_diag_cursor_20260827",
          capabilities: ["instructions", "mcp"],
          mcpStatus: "failed",
          checks: [
            { name: "api", status: "pass" },
            { name: "project-config", status: "pass" },
            { name: "mcp", status: "fail" },
            { name: "client-instructions", status: "pass" },
          ],
          status: "fail",
          observedAt: shiftedIso(anchor, -1),
          history: [],
        },
      ];
      const existingDiagnostics = new Set(
        (await scopedRepository.listAdapterDiagnostics(project.id)).map((diagnostic) => diagnostic.client),
      );
      for (const diagnostic of diagnostics) {
        if (!existingDiagnostics.has(diagnostic.client)) await scopedRepository.saveAdapterDiagnostic(diagnostic);
      }

      const notifications: readonly Notification[] = [
        {
          id: "ntf_showcase_blocking",
          organizationId: project.organizationId,
          projectId: project.id,
          recipientId: architect.id,
          type: "question_blocking_escalation",
          title: "Production rollout approval is overdue",
          body: "The signed webhook rollout remains blocked until the protected question is reviewed.",
          targetType: "question",
          targetId: q.protected,
          createdAt: shiftedIso(anchor, 0, -6),
        },
        {
          id: "ntf_showcase_response",
          organizationId: project.organizationId,
          projectId: project.id,
          recipientId: architect.id,
          type: "question_response",
          title: "A response was proposed",
          body: "A contributor proposed the 24-hour retry window for webhook delivery.",
          targetType: "response",
          targetId: "qrs_showcase_discussion_response",
          createdAt: shiftedIso(anchor, -4),
        },
        {
          id: "ntf_showcase_artifact",
          organizationId: project.organizationId,
          projectId: project.id,
          recipientId: architect.id,
          type: "artifact_review_requested",
          title: "Architecture review requested",
          body: "The signed webhook delivery ADR is ready for human review.",
          targetType: "artifact_version",
          targetId: "av_showcase_adr_v1",
          createdAt: shiftedIso(anchor, -2),
        },
        {
          id: "ntf_showcase_decision",
          organizationId: project.organizationId,
          projectId: project.id,
          recipientId: architect.id,
          type: "question_accepted",
          title: "Retention decision accepted",
          body: "The one-year event-retention decision is now authoritative project context.",
          targetType: "decision",
          targetId: d.retention,
          createdAt: shiftedIso(anchor, -13),
          readAt: shiftedIso(anchor, -12),
        },
        {
          id: "ntf_showcase_feedback",
          organizationId: project.organizationId,
          projectId: project.id,
          recipientId: architect.id,
          type: "artifact_review_feedback",
          title: "API contract changes requested",
          body: "Security review requested signature and key-rotation details in the webhook contract.",
          targetType: "artifact_version",
          targetId: "av_showcase_api_v1",
          createdAt: shiftedIso(anchor, -6),
          readAt: shiftedIso(anchor, -5),
        },
      ];
      for (const notification of notifications) {
        if (!(await scopedRepository.getNotification(notification.id)))
          await scopedRepository.saveNotification(notification);
      }

      const outboxEvents: readonly OutboxEvent[] = [
        {
          id: "evt_showcase_pending",
          correlationId: "demo_outbox_pending_20260827",
          organizationId: project.organizationId,
          projectId: project.id,
          type: "notification.created",
          payload: {
            notificationId: "ntf_showcase_blocking",
            recipientId: architect.id,
            notificationType: "question_blocking_escalation",
            targetType: "question",
            targetId: q.protected,
            questionContext: { id: q.protected, status: "open", risk: "protected", ownerIds: [architect.id] },
          },
          status: "pending",
          attempts: 0,
          availableAt: shiftedIso(anchor, 0, -1),
          createdAt: shiftedIso(anchor, 0, -1),
        },
        {
          id: "evt_showcase_processed",
          correlationId: "demo_outbox_processed_20260827",
          organizationId: project.organizationId,
          projectId: project.id,
          type: "notification.created",
          payload: {
            notificationId: "ntf_showcase_decision",
            recipientId: architect.id,
            notificationType: "question_accepted",
            targetType: "decision",
            targetId: d.retention,
          },
          status: "processed",
          attempts: 1,
          availableAt: shiftedIso(anchor, -13),
          createdAt: shiftedIso(anchor, -13),
          processedAt: shiftedIso(anchor, -13, 1),
        },
        {
          id: "evt_showcase_failed",
          correlationId: "demo_outbox_failed_20260827",
          organizationId: project.organizationId,
          projectId: project.id,
          type: "notification.created",
          payload: {
            notificationId: "ntf_showcase_response",
            recipientId: architect.id,
            notificationType: "question_response",
            targetType: "response",
            targetId: "qrs_showcase_discussion_response",
          },
          status: "failed",
          attempts: 3,
          availableAt: shiftedIso(anchor, 0, 1),
          createdAt: shiftedIso(anchor, -4),
          lastError: "Provider request timed out after the bounded delivery window.",
        },
        {
          id: "evt_showcase_dead_letter",
          correlationId: "demo_outbox_dead_20260827",
          organizationId: project.organizationId,
          projectId: project.id,
          type: "decision.lifecycle_changed",
          payload: {
            decisionId: d.revoked,
            status: "revoked",
            changedById: architect.id,
          },
          status: "dead_letter",
          attempts: 8,
          availableAt: shiftedIso(anchor, -2),
          createdAt: shiftedIso(anchor, -5),
          lastError: "Delivery retry budget exhausted for the synthetic demo event.",
        },
      ];
      for (const event of outboxEvents) {
        if (!(await scopedRepository.getOutboxEvent(event.id))) await scopedRepository.saveOutboxEvent(event);
      }

      const deliveries: readonly OutboxDelivery[] = [
        {
          id: "odl_showcase_slack_delivered",
          organizationId: project.organizationId,
          projectId: project.id,
          outboxEventId: "evt_showcase_processed",
          channel: "slack",
          dedupeKey: "demo-retention-accepted",
          destinationHash: "sha256:demo-project-channel",
          status: "delivered",
          attemptCount: 1,
          preference: "immediate",
          providerMessageId: "demo-message-231",
          createdAt: shiftedIso(anchor, -13),
          updatedAt: shiftedIso(anchor, -13, 1),
        },
        {
          id: "odl_showcase_email_deferred",
          organizationId: project.organizationId,
          projectId: project.id,
          outboxEventId: "evt_showcase_pending",
          channel: "email",
          dedupeKey: "demo-protected-rollout",
          destinationHash: "sha256:demo-reviewer",
          status: "deferred",
          attemptCount: 0,
          preference: "digest",
          digestAvailableAt: shiftedIso(anchor, 0, 8),
          createdAt: shiftedIso(anchor, 0, -1),
          updatedAt: shiftedIso(anchor, 0, -1),
        },
        {
          id: "odl_showcase_slack_failed",
          organizationId: project.organizationId,
          projectId: project.id,
          outboxEventId: "evt_showcase_dead_letter",
          channel: "slack",
          dedupeKey: "demo-revoked-export",
          destinationHash: "sha256:demo-project-channel",
          status: "failed",
          attemptCount: 8,
          preference: "immediate",
          providerMessageId: "demo-slack-failure-051",
          lastError: "Synthetic delivery failure for dashboard coverage.",
          feedback: {
            provider: "slack",
            type: "provider_failure",
            receivedAt: shiftedIso(anchor, -1, 4),
          },
          createdAt: shiftedIso(anchor, -5),
          updatedAt: shiftedIso(anchor, -2),
        },
      ];
      for (const delivery of deliveries) {
        if (!(await scopedRepository.getOutboxDelivery(delivery.outboxEventId, delivery.channel))) {
          await scopedRepository.saveOutboxDelivery(delivery);
        }
      }

      const auditEvents: readonly AuditEvent[] = [
        ["aud_showcase_run", "run.started", "run", r.running, agent, -1, "api"],
        ["aud_showcase_question", "question.created", "question", q.protected, agent, -2, "mcp"],
        [
          "aud_showcase_response",
          "question.response_proposed",
          "response",
          "qrs_showcase_discussion_response",
          contributor,
          -5,
          "api",
        ],
        ["aud_showcase_comment", "question.comment_added", "question", q.discussion, qaLead, -4, "web"],
        ["aud_showcase_accept", "question.accepted", "decision", d.retention, businessAnalyst, -13, "web"],
        ["aud_showcase_decision", "decision.revoked", "decision", d.revoked, architect, -40, "web"],
        ["aud_showcase_assumption", "assumption.recorded", "assumption", s.expiring, agent, -4, "mcp"],
        [
          "aud_showcase_artifact",
          "artifact.version_published",
          "artifact_version",
          "av_showcase_adr_v1",
          agent,
          -2,
          "api",
        ],
        [
          "aud_showcase_review",
          "artifact.version_commented",
          "artifact_version",
          "av_showcase_adr_v1",
          qaLead,
          -1,
          "web",
        ],
        [
          "aud_showcase_approve",
          "artifact.version_approved",
          "artifact_version",
          "av_showcase_prd_v2",
          architect,
          -12,
          "web",
        ],
        ["aud_showcase_repository", "repository.linked", "repository", "repo_showcase_bridge", architect, -48, "api"],
        ["aud_showcase_policy", "project.policy_updated", "policy_configuration", project.id, architect, -10, "api"],
        [
          "aud_showcase_feedback",
          "notification.delivery_feedback_recorded",
          "outbox_delivery",
          "odl_showcase_slack_failed",
          architect,
          -1,
          "integration",
        ],
      ].map(([id, action, subjectType, subjectId, actor, days, source], index) => ({
        id: String(id),
        correlationId: `demo_audit_${String(index + 1).padStart(2, "0")}`,
        organizationId: project.organizationId,
        projectId: project.id,
        actorId: (actor as Principal).id,
        actorType: (actor as Principal).type,
        action: String(action),
        subjectType: subjectType as AuditEvent["subjectType"],
        subjectId: String(subjectId),
        source: source as NonNullable<AuditEvent["source"]>,
        ...(id === "aud_showcase_question"
          ? {
              policyVersion: 1,
              policyRuleKey: "production-release",
              assignmentId: "qas_showcase_protected_initial",
              ownerRouteSource: "scoped_ownership" as const,
              reviewerRouteSource: "policy" as const,
            }
          : {}),
        ...(id === "aud_showcase_assumption"
          ? {
              policyVersion: 0,
              policyRuleKey: "bridge-assumption-default",
            }
          : {}),
        createdAt: shiftedIso(anchor, Number(days)),
      }));
      const existingAuditIds = new Set((await scopedRepository.listAuditEvents(project.id)).map((event) => event.id));
      for (const event of auditEvents) {
        if (!existingAuditIds.has(event.id)) await scopedRepository.saveAuditEvent(event);
      }
    },
    { organizationId: project.organizationId },
  );
}
