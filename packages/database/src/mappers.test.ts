import { readFileSync } from "node:fs";

import type {
  AgentRun,
  Assumption,
  Artifact,
  ContextSnapshot,
  Decision,
  Notification,
  Organization,
  OrganizationAuditEvent,
  OrganizationMembership,
  OutboxDelivery,
  OutboxEvent,
  PrincipalIdentity,
  Project,
  ProjectMembership,
  Question,
  ServiceCredential,
} from "@bridge/domain";
import { describe, expect, it } from "vitest";

import {
  artifactFromRows,
  assumptionFromRow,
  assumptionToRow,
  artifactToRow,
  artifactVersionToRow,
  decisionFromRow,
  decisionToRow,
  contextSnapshotFromRow,
  contextSnapshotToRow,
  projectFromRow,
  projectToRow,
  notificationFromRow,
  notificationToRow,
  organizationFromRow,
  organizationAuditEventFromRow,
  organizationAuditEventToRow,
  organizationMembershipFromRow,
  organizationMembershipToRow,
  organizationToRow,
  outboxEventFromRow,
  outboxEventToRow,
  outboxDeliveryFromRow,
  outboxDeliveryToRow,
  principalIdentityFromRow,
  principalIdentityToRow,
  projectMembershipFromRow,
  projectMembershipToRow,
  serviceCredentialFromRow,
  serviceCredentialToRow,
  questionFromRows,
  questionToRow,
  responseToRow,
  runFromRow,
  runToRow,
  type AgentRunRow,
  type AssumptionRow,
  type ArtifactRow,
  type ArtifactVersionRow,
  type DecisionRow,
  type ContextSnapshotRow,
  type ProjectRow,
  type QuestionResponseRow,
  type QuestionRow,
  type NotificationRow,
  type OutboxEventRow,
  type OutboxDeliveryRow,
  type OrganizationMembershipRow,
  type OrganizationAuditEventRow,
  type OrganizationRow,
  type PrincipalIdentityRow,
  type ProjectMembershipRow,
  type ServiceCredentialRow,
} from "./mappers.js";

const project: Project = {
  id: "prj_mapping",
  organizationId: "org_mapping",
  name: "Mapping Test",
  decisionOwnerIds: ["usr_owner"],
};

const question: Question = {
  id: "qst_mapping",
  organizationId: project.organizationId,
  projectId: project.id,
  runId: "run_mapping",
  title: "Which persistence strategy should this component use?",
  type: "decision",
  category: "architecture",
  context: "The component needs durable decisions across agent and API restarts.",
  whyItMatters: "Losing accepted decisions would make later agent sessions repeat questions.",
  risk: "high",
  reversible: false,
  blocking: true,
  ownerIds: ["usr_owner"],
  ownerRoles: ["architect"],
  options: [
    { key: "postgres", label: "PostgreSQL", tradeoffs: "Operational dependency with strong transactions." },
    { key: "memory", label: "Memory", tradeoffs: "Simple but state is lost on restart." },
  ],
  recommendationKey: "postgres",
  scope: { repository: "bridge", component: "persistence" },
  createdById: "agt_codex",
  createdByType: "agent",
  createdAt: "2026-08-07T10:00:00.000Z",
  status: "in_discussion",
  responses: [
    {
      id: "rsp_mapping",
      questionId: "qst_mapping",
      authorId: "usr_owner",
      authorType: "human",
      answer: "Use PostgreSQL.",
      rationale: "Atomic durable state is required.",
      optionKey: "postgres",
      createdAt: "2026-08-07T10:01:00.000Z",
    },
  ],
  reviews: [
    {
      id: "qrv_mapping",
      questionId: "qst_mapping",
      reviewerId: "usr_owner",
      reviewerType: "human",
      reviewerRole: "security-reviewer",
      status: "approved",
      rationale: "The protected persistence choice has the required security review.",
      createdAt: "2026-08-07T10:01:30.000Z",
    },
  ],
  comments: [
    {
      id: "qcm_mapping",
      questionId: "qst_mapping",
      authorId: "usr_owner",
      authorType: "human",
      body: "Please confirm the migration rollback path before accepting this choice.",
      createdAt: "2026-08-07T10:01:45.000Z",
    },
  ],
  version: 2,
};

const run: AgentRun = {
  id: "run_mapping",
  organizationId: project.organizationId,
  projectId: project.id,
  agentId: "agt_codex",
  agentType: "agent",
  client: "codex",
  capability: "cli",
  taskSummary: "Implement durable persistence mappings",
  scope: { repository: "bridge", component: "persistence" },
  status: "running",
  contextSnapshotIds: ["ctx_mapping"],
  questionIds: [question.id],
  artifactVersionIds: ["av_mapping"],
  assumptionIds: ["asm_mapping"],
  externalLinks: ["https://example.test/work/42"],
  resultLinks: [],
  startedAt: "2026-08-07T09:59:00.000Z",
  updatedAt: "2026-08-07T10:02:00.000Z",
  version: 3,
};

const assumption: Assumption = {
  id: "asm_mapping",
  organizationId: project.organizationId,
  projectId: project.id,
  runId: run.id,
  statement: "Internal retry metrics may use the existing transfer namespace.",
  rationale: "The namespace is internal, reversible, and consistent with adjacent metrics.",
  category: "observability",
  risk: "low",
  confidence: "medium",
  reversible: true,
  reversalCost: "Rename the metric and update the internal dashboard query.",
  scope: { repository: "bridge", component: "persistence" },
  sourceLinks: ["https://example.test/work/42"],
  status: "active",
  createdById: "agt_codex",
  createdByType: "agent",
  createdAt: "2026-08-07T10:02:00.000Z",
  expiresAt: "2026-08-14T10:02:00.000Z",
  version: 1,
};

const decision: Decision = {
  id: "dec_mapping",
  organizationId: project.organizationId,
  projectId: project.id,
  questionId: question.id,
  answer: "Use PostgreSQL.",
  rationale: "Atomic durable state is required.",
  category: "architecture",
  scope: { repository: "bridge", component: "persistence" },
  ownerId: "usr_owner",
  sourceResponseId: "rsp_mapping",
  status: "superseded",
  createdAt: "2026-08-07T10:02:00.000Z",
  reviewAt: "2027-02-03T10:02:00.000Z",
  lifecycleRationale: "A later decision introduced a more precise persistence boundary.",
  lifecycleChangedById: "usr_owner",
  lifecycleChangedAt: "2026-08-08T10:02:00.000Z",
  replacementDecisionId: "dec_mapping_replacement",
  version: 2,
};

const contextSnapshot: ContextSnapshot = {
  id: "ctx_mapping",
  organizationId: project.organizationId,
  projectId: project.id,
  principalId: "agt_codex",
  runId: run.id,
  task: "Implement the accepted persistence decision",
  itemIds: [decision.id],
  createdAt: "2026-08-07T10:02:30.000Z",
};

const artifact: Artifact = {
  id: "art_mapping",
  organizationId: project.organizationId,
  projectId: project.id,
  title: "Persistence architecture",
  type: "adr",
  scope: { repository: "bridge", component: "persistence" },
  reviewerIds: ["usr_owner"],
  createdById: "agt_codex",
  createdByType: "agent",
  createdAt: "2026-08-07T10:02:00.000Z",
  currentVersionId: "av_mapping",
  approvedVersionId: "av_mapping",
  versions: [
    {
      id: "av_mapping",
      artifactId: "art_mapping",
      version: 1,
      summary: "Use PostgreSQL transactions behind the repository boundary.",
      body: "# Persistence\n\nUse PostgreSQL transactions behind the Bridge repository boundary.",
      contentSha256: "a".repeat(64),
      citedDecisionIds: [],
      status: "approved",
      createdById: "agt_codex",
      createdByType: "agent",
      createdAt: "2026-08-07T10:02:00.000Z",
      reviews: [
        {
          id: "arv_mapping",
          artifactVersionId: "av_mapping",
          reviewerId: "usr_owner",
          reviewerType: "human",
          status: "commented",
          body: "The transaction boundary and recovery behavior are clear.",
          createdAt: "2026-08-07T10:02:30.000Z",
        },
      ],
      approvedById: "usr_owner",
      approvalRationale: "This provides the required durability and atomicity.",
      approvedAt: "2026-08-07T10:03:00.000Z",
    },
  ],
};

const notification: Notification = {
  id: "ntf_mapping",
  organizationId: project.organizationId,
  projectId: project.id,
  recipientId: "usr_owner",
  type: "question_comment",
  title: "A clarification needs your attention",
  body: "A teammate added context to the persistence question.",
  targetType: "comment",
  targetId: "qcm_mapping",
  createdAt: "2026-08-07T10:02:10.000Z",
};

const outboxEvent: OutboxEvent = {
  id: "evt_mapping",
  correlationId: "cor_mapping",
  organizationId: project.organizationId,
  projectId: project.id,
  type: "notification.created",
  payload: {
    notificationId: notification.id,
    recipientId: notification.recipientId,
    notificationType: notification.type,
    targetType: notification.targetType,
    targetId: notification.targetId,
  },
  status: "pending",
  attempts: 0,
  availableAt: "2026-08-07T10:02:10.000Z",
  createdAt: "2026-08-07T10:02:10.000Z",
};

const outboxDelivery: OutboxDelivery = {
  id: "odl_mapping",
  organizationId: project.organizationId,
  projectId: project.id,
  outboxEventId: outboxEvent.id,
  channel: "email",
  destinationHash: "a".repeat(64),
  status: "delivered",
  attemptCount: 1,
  preference: "immediate",
  providerMessageId: "provider-message-mapping",
  createdAt: "2026-08-07T10:02:11.000Z",
  updatedAt: "2026-08-07T10:02:12.000Z",
};

describe("PostgreSQL domain mappings", () => {
  it("round-trips organizations, identities, and memberships", () => {
    const organization: Organization = {
      id: "org_mapping",
      externalIdentityProviderId: "auth0-org-mapping",
      slug: "mapping",
      name: "Mapping Organization",
      createdAt: "2026-08-07T09:00:00.000Z",
    };
    const identity: PrincipalIdentity = {
      id: "usr_mapping",
      type: "human",
      displayName: "Mapping User",
      oidcIssuer: "https://identity.example/",
      oidcSubject: "auth0|mapping",
      createdAt: organization.createdAt,
    };
    const organizationMembership: OrganizationMembership = {
      organizationId: organization.id,
      principalId: identity.id,
      status: "active",
      roles: ["organization-member"],
      allProjects: false,
      createdAt: organization.createdAt,
      updatedAt: organization.createdAt,
      version: 1,
    };
    const projectMembership: ProjectMembership = {
      organizationId: organization.id,
      projectId: project.id,
      principalId: identity.id,
      status: "active",
      roles: ["project-admin"],
      createdAt: organization.createdAt,
      updatedAt: organization.createdAt,
      version: 1,
    };
    const serviceCredential: ServiceCredential = {
      id: "scr_mapping",
      organizationId: organization.id,
      principalId: "agt_mapping",
      name: "Mapping CI",
      tokenHash: "b".repeat(64),
      scopes: ["bridge:read"],
      createdAt: organization.createdAt,
      expiresAt: "2026-08-08T09:00:00.000Z",
      version: 1,
    };
    const organizationAuditEvent: OrganizationAuditEvent = {
      id: "oaud_mapping",
      correlationId: "cor_mapping",
      organizationId: organization.id,
      actorId: identity.id,
      actorType: "human",
      action: "organization_member.updated",
      subjectType: "organization_membership",
      subjectId: identity.id,
      createdAt: organization.createdAt,
    };

    expect(organizationFromRow(organizationToRow(organization) as OrganizationRow)).toEqual(organization);
    expect(principalIdentityFromRow(principalIdentityToRow(identity) as PrincipalIdentityRow)).toEqual(identity);
    expect(organizationMembershipFromRow(
      organizationMembershipToRow(organizationMembership) as OrganizationMembershipRow,
    )).toEqual(organizationMembership);
    expect(projectMembershipFromRow(
      projectMembershipToRow(projectMembership) as ProjectMembershipRow,
    )).toEqual(projectMembership);
    expect(serviceCredentialFromRow(
      serviceCredentialToRow(serviceCredential) as ServiceCredentialRow,
    )).toEqual(serviceCredential);
    expect(organizationAuditEventFromRow(
      organizationAuditEventToRow(organizationAuditEvent) as OrganizationAuditEventRow,
    )).toEqual(organizationAuditEvent);
  });

  it("round-trips projects, runs, assumptions, questions, and artifact aggregates", () => {
    expect(projectFromRow(projectToRow(project) as ProjectRow)).toEqual(project);
    expect(runFromRow(runToRow(run) as AgentRunRow)).toEqual(run);
    expect(assumptionFromRow(assumptionToRow(assumption) as AssumptionRow)).toEqual(assumption);
    expect(decisionFromRow(decisionToRow(decision) as DecisionRow)).toEqual(decision);
    expect(contextSnapshotFromRow(contextSnapshotToRow(contextSnapshot) as ContextSnapshotRow))
      .toEqual(contextSnapshot);

    const questionRow = questionToRow(question) as QuestionRow;
    const responseRows = question.responses.map(responseToRow) as QuestionResponseRow[];
    expect(questionFromRows(questionRow, responseRows)).toEqual(question);

    const artifactRow = artifactToRow(artifact) as ArtifactRow;
    const versionRows = artifact.versions.map(artifactVersionToRow) as ArtifactVersionRow[];
    expect(artifactFromRows(artifactRow, versionRows)).toEqual(artifact);

    expect(notificationFromRow(notificationToRow(notification) as NotificationRow)).toEqual(notification);
    expect(outboxEventFromRow(outboxEventToRow(outboxEvent) as OutboxEventRow)).toEqual(outboxEvent);
    expect(outboxDeliveryFromRow(outboxDeliveryToRow(outboxDelivery) as OutboxDeliveryRow))
      .toEqual(outboxDelivery);
  });

  it("ships reviewed deferred constraints for atomic aggregate references", () => {
    const migration = readFileSync(
      new URL("../drizzle/0000_nice_bulldozer.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("bridge_questions_decision_fk");
    expect(migration).toContain("bridge_artifacts_current_version_fk");
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(5);
    expect(migration).toContain("bridge_artifact_versions_one_approved_idx");
    expect(migration).toContain("bridge_questions_organization_project_fk");

    const runMigration = readFileSync(
      new URL("../drizzle/0001_early_ricochet.sql", import.meta.url),
      "utf8",
    );
    expect(runMigration).toContain("bridge_agent_runs_terminal_check");
    expect(runMigration).toContain("bridge_questions_run_scope_fk");
    expect(runMigration).toContain("bridge_context_snapshots_run_scope_fk");
    expect(runMigration).toContain("Imported legacy Bridge run");
    expect(runMigration).toContain("bridge_run_continuation_locators");
    expect(runMigration).toContain("'context_snapshot', 'run'");

    const assumptionMigration = readFileSync(
      new URL("../drizzle/0002_complex_moondragon.sql", import.meta.url),
      "utf8",
    );
    expect(assumptionMigration).toContain("bridge_assumptions_policy_check");
    expect(assumptionMigration).toContain("bridge_assumptions_time_check");
    expect(assumptionMigration).toContain("bridge_assumptions_resolution_check");
    expect(assumptionMigration).toContain("bridge_assumptions_run_scope_fk");
    expect(assumptionMigration).toContain(
      'ADD CONSTRAINT "bridge_decisions_organization_project_id_unique" UNIQUE ("organization_id", "project_id", "id")',
    );
    expect(assumptionMigration).toContain("'decision', 'assumption', 'artifact'");

    const projectMigration = readFileSync(
      new URL("../drizzle/0003_project_registration.sql", import.meta.url),
      "utf8",
    );
    expect(projectMigration).toContain("'project', 'question', 'response'");

    const commentMigration = readFileSync(
      new URL("../drizzle/0006_question_comments.sql", import.meta.url),
      "utf8",
    );
    expect(commentMigration).toContain('ADD COLUMN "comments" jsonb');
    expect(commentMigration).toContain('jsonb_typeof("comments") = \'array\'');

    const roleMigration = readFileSync(
      new URL("../drizzle/0004_role_aware_questions.sql", import.meta.url),
      "utf8",
    );
    expect(roleMigration).toContain('"owner_roles" jsonb');
    expect(roleMigration).toContain('jsonb_typeof("owner_roles") = \'array\'');

    const reviewMigration = readFileSync(
      new URL("../drizzle/0005_question_reviews.sql", import.meta.url),
      "utf8",
    );
    expect(reviewMigration).toContain('"reviews" jsonb');
    expect(reviewMigration).toContain('jsonb_typeof("reviews") = \'array\'');

    const notificationMigration = readFileSync(
      new URL("../drizzle/0007_in_app_notifications.sql", import.meta.url),
      "utf8",
    );
    expect(notificationMigration).toContain("CREATE TABLE \"bridge_notifications\"");
    expect(notificationMigration).toContain("bridge_notifications_recipient_created_idx");
    expect(notificationMigration).toContain("bridge_notifications_organization_project_fk");

    const outboxMigration = readFileSync(
      new URL("../drizzle/0008_transactional_outbox.sql", import.meta.url),
      "utf8",
    );
    expect(outboxMigration).toContain("CREATE TABLE \"bridge_outbox_events\"");
    expect(outboxMigration).toContain("bridge_outbox_events_status_check");
    expect(outboxMigration).toContain("bridge_outbox_events_type_check");
    expect(outboxMigration).toContain("bridge_outbox_status_available_idx");
    expect(outboxMigration).toContain("bridge_outbox_events_organization_project_fk");
    expect(notificationMigration).toContain("question_assigned");
    expect(notificationMigration).toContain("artifact_approved");

    const decisionLifecycleMigration = readFileSync(
      new URL("../drizzle/0009_true_marauders.sql", import.meta.url),
      "utf8",
    );
    expect(decisionLifecycleMigration).toContain("bridge_decisions_lifecycle_check");
    expect(decisionLifecycleMigration).toContain("bridge_decisions_replacement_scope_fk");
    expect(decisionLifecycleMigration).toContain("decision_lifecycle");
    expect(decisionLifecycleMigration).toContain("decision.lifecycle_changed");
    const guardedDecisionScopeIndex =
      "CREATE UNIQUE INDEX IF NOT EXISTS \"bridge_decisions_organization_project_id_unique\"";
    expect(decisionLifecycleMigration).toContain(guardedDecisionScopeIndex);
    expect(decisionLifecycleMigration.indexOf(guardedDecisionScopeIndex))
      .toBeLessThan(decisionLifecycleMigration.indexOf("ADD CONSTRAINT \"bridge_decisions_replacement_scope_fk\""));

    const artifactReviewMigration = readFileSync(
      new URL("../drizzle/0010_safe_white_queen.sql", import.meta.url),
      "utf8",
    );
    expect(artifactReviewMigration).toContain("bridge_artifact_versions_reviews_shape_check");
    expect(artifactReviewMigration).toContain("artifact_review_feedback");

    const decisionSearchMigration = readFileSync(
      new URL("../drizzle/0011_keen_galactus.sql", import.meta.url),
      "utf8",
    );
    expect(decisionSearchMigration).toContain('CREATE INDEX "bridge_decisions_full_text_idx"');
    expect(decisionSearchMigration).toContain("USING gin");
    expect(decisionSearchMigration).toContain("setweight(to_tsvector('simple'");

    const outboxOperatorMigration = readFileSync(
      new URL("../drizzle/0012_outbox_operator_replay.sql", import.meta.url),
      "utf8",
    );
    expect(outboxOperatorMigration).toContain("bridge_audit_events_subject_type_check");
    expect(outboxOperatorMigration).toContain("'outbox_event'");

    const emailDeliveryMigration = readFileSync(
      new URL("../drizzle/0013_ancient_gwen_stacy.sql", import.meta.url),
      "utf8",
    );
    expect(emailDeliveryMigration).toContain("CREATE TABLE \"bridge_outbox_deliveries\"");
    expect(emailDeliveryMigration).toContain("bridge_outbox_events_org_project_id_unique");
    expect(emailDeliveryMigration.indexOf("bridge_outbox_events_org_project_id_unique"))
      .toBeLessThan(emailDeliveryMigration.indexOf("bridge_outbox_deliveries_event_scope_fk"));
    expect(emailDeliveryMigration).toContain("bridge_outbox_deliveries_result_check");
    expect(emailDeliveryMigration).toContain("bridge_outbox_deliveries_destination_hash_check");

    const correlationMigration = readFileSync(
      new URL("../drizzle/0014_first_jane_foster.sql", import.meta.url),
      "utf8",
    );
    expect(correlationMigration).toContain("UPDATE \"bridge_audit_events\"");
    expect(correlationMigration).toContain("UPDATE \"bridge_outbox_events\"");
    expect(correlationMigration.indexOf("SET \"correlation_id\""))
      .toBeLessThan(correlationMigration.indexOf("ALTER COLUMN \"correlation_id\" SET NOT NULL"));
    expect(correlationMigration).toContain("bridge_audit_events_correlation_check");
    expect(correlationMigration).toContain("bridge_outbox_events_correlation_check");
    expect(correlationMigration).toContain("bridge_outbox_correlation_idx");

    const identityMigration = readFileSync(
      new URL("../drizzle/0015_spooky_bulldozer.sql", import.meta.url),
      "utf8",
    );
    expect(identityMigration).toContain("CREATE TABLE \"bridge_organizations\"");
    expect(identityMigration).toContain("CREATE TABLE \"bridge_organization_memberships\"");
    expect(identityMigration).toContain("CREATE TABLE \"bridge_project_memberships\"");
    expect(identityMigration.indexOf("INSERT INTO \"bridge_organizations\""))
      .toBeLessThan(identityMigration.indexOf("bridge_projects_organization_id_bridge_organizations_id_fk"));

    const memberAdministrationMigration = readFileSync(
      new URL("../drizzle/0016_charming_siren.sql", import.meta.url),
      "utf8",
    );
    expect(memberAdministrationMigration).toContain("CREATE TABLE \"bridge_organization_audit_events\"");
    expect(memberAdministrationMigration).toContain("bridge_organization_memberships_positive_version_check");
    expect(memberAdministrationMigration).toContain("bridge_project_memberships_positive_version_check");
    expect(memberAdministrationMigration).toContain("bridge_organization_audit_events_action_check");
    expect(memberAdministrationMigration).toContain("bridge_organization_audit_events_correlation_check");

    const serviceIdentityMigration = readFileSync(
      new URL("../drizzle/0017_cooing_slipstream.sql", import.meta.url),
      "utf8",
    );
    expect(serviceIdentityMigration).toContain("CREATE TABLE \"bridge_service_credentials\"");
    expect(serviceIdentityMigration).toContain("bridge_service_credentials_token_hash_unique");
    expect(serviceIdentityMigration).toContain("bridge_service_credentials_positive_version_check");
    expect(serviceIdentityMigration).toContain("service_identity.created");
  });
});
