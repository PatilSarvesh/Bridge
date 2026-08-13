import type { Scope } from "@bridge/contracts";
import type {
  ArtifactReview,
  OrganizationAuditEvent,
  OutboxPayload,
  QuestionComment,
  QuestionOption,
  QuestionReview,
} from "@bridge/domain";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  type AnyPgColumn,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const principalTypeEnum = pgEnum("bridge_principal_type", [
  "human",
  "agent",
  "ci",
  "integration",
]);
export const questionTypeEnum = pgEnum("bridge_question_type", [
  "information",
  "decision",
  "approval",
  "review",
  "assumption_challenge",
  "blocker",
]);
export const riskEnum = pgEnum("bridge_risk", ["low", "medium", "high", "protected"]);
export const questionStatusEnum = pgEnum("bridge_question_status", [
  "open",
  "in_discussion",
  "accepted",
  "duplicate",
  "cancelled",
  "expired",
]);
export const decisionStatusEnum = pgEnum("bridge_decision_status", [
  "active",
  "superseded",
  "expired",
  "revoked",
]);
export const artifactTypeEnum = pgEnum("bridge_artifact_type", [
  "prd",
  "adr",
  "api_contract",
  "test_plan",
]);
export const artifactVersionStatusEnum = pgEnum("bridge_artifact_version_status", [
  "draft",
  "in_review",
  "approved",
  "superseded",
]);
export const idempotencyKindEnum = pgEnum("bridge_idempotency_kind", [
  "question",
  "artifact_version",
  "run",
  "assumption",
]);
export const agentRunClientEnum = pgEnum("bridge_agent_run_client", [
  "codex",
  "claude_code",
  "cursor",
  "copilot",
  "custom",
  "unknown",
]);
export const agentRunCapabilityEnum = pgEnum("bridge_agent_run_capability", [
  "instructions",
  "cli",
  "mcp",
  "hooks",
  "orchestrated",
]);
export const agentRunStatusEnum = pgEnum("bridge_agent_run_status", [
  "running",
  "waiting_for_human",
  "completed",
  "failed",
  "cancelled",
]);
export const assumptionConfidenceEnum = pgEnum("bridge_assumption_confidence", [
  "low",
  "medium",
  "high",
]);
export const assumptionStatusEnum = pgEnum("bridge_assumption_status", [
  "active",
  "confirmed",
  "rejected",
  "expired",
  "superseded",
]);

export const membershipStatusEnum = pgEnum("bridge_membership_status", ["active", "disabled"]);

export const organizations = pgTable("bridge_organizations", {
  id: text("id").primaryKey(),
  externalIdentityProviderId: text("external_identity_provider_id").notNull().unique(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const principalIdentities = pgTable(
  "bridge_principal_identities",
  {
    id: text("id").primaryKey(),
    type: principalTypeEnum("type").notNull(),
    displayName: text("display_name").notNull(),
    oidcIssuer: text("oidc_issuer").notNull(),
    oidcSubject: text("oidc_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    unique("bridge_principal_identities_oidc_unique").on(table.oidcIssuer, table.oidcSubject),
  ],
);

export const serviceCredentials = pgTable(
  "bridge_service_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    principalId: text("principal_id")
      .notNull()
      .references(() => principalIdentities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopes: jsonb("scopes").$type<readonly string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true, mode: "string" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
    version: integer("version").default(1).notNull(),
  },
  (table) => [
    uniqueIndex("bridge_service_credentials_token_hash_unique").on(table.tokenHash),
    index("bridge_service_credentials_org_created_idx").on(table.organizationId, table.createdAt),
    index("bridge_service_credentials_principal_idx").on(table.principalId),
  ],
);

export const organizationMemberships = pgTable(
  "bridge_organization_memberships",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    principalId: text("principal_id")
      .notNull()
      .references(() => principalIdentities.id, { onDelete: "cascade" }),
    status: membershipStatusEnum("status").notNull(),
    roles: jsonb("roles").$type<readonly string[]>().notNull(),
    allProjects: boolean("all_projects").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
    version: integer("version").default(1).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.principalId] }),
    index("bridge_organization_memberships_principal_idx").on(table.principalId),
  ],
);

export const projects = pgTable("bridge_projects", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  decisionOwnerIds: jsonb("decision_owner_ids").$type<readonly string[]>().notNull(),
});

export const projectMemberships = pgTable(
  "bridge_project_memberships",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    principalId: text("principal_id")
      .notNull()
      .references(() => principalIdentities.id, { onDelete: "cascade" }),
    status: membershipStatusEnum("status").notNull(),
    roles: jsonb("roles").$type<readonly string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
    version: integer("version").default(1).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.projectId, table.principalId] }),
    index("bridge_project_memberships_principal_idx").on(table.principalId),
    foreignKey({
      name: "bridge_project_memberships_organization_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
  ],
);

export const agentRuns = pgTable(
  "bridge_agent_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    agentId: text("agent_id").notNull(),
    agentType: principalTypeEnum("agent_type").notNull(),
    client: agentRunClientEnum("client").notNull(),
    capability: agentRunCapabilityEnum("capability").notNull(),
    taskSummary: text("task_summary").notNull(),
    scope: jsonb("scope").$type<Scope>().notNull(),
    status: agentRunStatusEnum("status").notNull(),
    contextSnapshotIds: jsonb("context_snapshot_ids").$type<readonly string[]>().notNull(),
    questionIds: jsonb("question_ids").$type<readonly string[]>().notNull(),
    artifactVersionIds: jsonb("artifact_version_ids").$type<readonly string[]>().notNull(),
    assumptionIds: jsonb("assumption_ids").$type<readonly string[]>().default([]).notNull(),
    externalLinks: jsonb("external_links").$type<readonly string[]>().notNull(),
    resultLinks: jsonb("result_links").$type<readonly string[]>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
    summary: text("summary"),
    continuesRunId: text("continues_run_id"),
    version: integer("version").notNull(),
  },
  (table) => [
    index("bridge_agent_runs_project_started_idx").on(table.projectId, table.startedAt),
    index("bridge_agent_runs_project_status_idx").on(table.projectId, table.status),
  ],
);

export const runContinuationLocators = pgTable("bridge_run_continuation_locators", {
  runId: text("run_id")
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: "cascade" }),
  resumeContextKey: text("resume_context_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const questions = pgTable(
  "bridge_questions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    type: questionTypeEnum("type").notNull(),
    category: text("category").notNull(),
    context: text("context").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    risk: riskEnum("risk").notNull(),
    reversible: boolean("reversible").notNull(),
    blocking: boolean("blocking").notNull(),
    ownerIds: jsonb("owner_ids").$type<readonly string[]>().notNull(),
    ownerRoles: jsonb("owner_roles").$type<readonly string[]>().default([]).notNull(),
    options: jsonb("options").$type<readonly QuestionOption[]>().notNull(),
    reviews: jsonb("reviews").$type<readonly QuestionReview[]>().default([]).notNull(),
    comments: jsonb("comments").$type<readonly QuestionComment[]>().default([]).notNull(),
    recommendationKey: text("recommendation_key"),
    fallback: text("fallback"),
    scope: jsonb("scope").$type<Scope>().notNull(),
    createdById: text("created_by_id").notNull(),
    createdByType: principalTypeEnum("created_by_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    status: questionStatusEnum("status").notNull(),
    acceptedResponseId: text("accepted_response_id"),
    decisionId: text("decision_id"),
    version: integer("version").notNull(),
  },
  (table) => [
    index("bridge_questions_project_created_idx").on(table.projectId, table.createdAt),
    index("bridge_questions_project_status_idx").on(table.projectId, table.status),
  ],
);

export const questionResponses = pgTable(
  "bridge_question_responses",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    authorType: principalTypeEnum("author_type").notNull(),
    answer: text("answer").notNull(),
    rationale: text("rationale").notNull(),
    optionKey: text("option_key"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("bridge_question_responses_question_created_idx").on(table.questionId, table.createdAt)],
);

export const decisions = pgTable(
  "bridge_decisions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    answer: text("answer").notNull(),
    rationale: text("rationale").notNull(),
    category: text("category").notNull(),
    scope: jsonb("scope").$type<Scope>().notNull(),
    ownerId: text("owner_id").notNull(),
    sourceResponseId: text("source_response_id").notNull(),
    status: decisionStatusEnum("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    reviewAt: timestamp("review_at", { withTimezone: true, mode: "string" }).notNull(),
    lifecycleRationale: text("lifecycle_rationale"),
    lifecycleChangedById: text("lifecycle_changed_by_id"),
    lifecycleChangedAt: timestamp("lifecycle_changed_at", { withTimezone: true, mode: "string" }),
    replacementDecisionId: text("replacement_decision_id").references(
      (): AnyPgColumn => decisions.id,
      { onDelete: "restrict" },
    ),
    version: integer("version").default(1).notNull(),
  },
  (table) => [
    uniqueIndex("bridge_decisions_question_unique").on(table.questionId),
    uniqueIndex("bridge_decisions_organization_project_id_unique").on(
      table.organizationId,
      table.projectId,
      table.id,
    ),
    index("bridge_decisions_project_status_idx").on(table.projectId, table.status),
    index("bridge_decisions_full_text_idx").using(
      "gin",
      sql`(
        setweight(to_tsvector('simple', coalesce(${table.answer}, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(${table.rationale}, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(${table.category}, '')), 'C')
      )`,
    ),
    foreignKey({
      name: "bridge_decisions_replacement_scope_fk",
      columns: [table.organizationId, table.projectId, table.replacementDecisionId],
      foreignColumns: [table.organizationId, table.projectId, table.id],
    }).onDelete("restrict"),
  ],
);

export const assumptions = pgTable(
  "bridge_assumptions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "restrict" }),
    statement: text("statement").notNull(),
    rationale: text("rationale").notNull(),
    category: text("category").notNull(),
    risk: riskEnum("risk").notNull(),
    confidence: assumptionConfidenceEnum("confidence").notNull(),
    reversible: boolean("reversible").notNull(),
    reversalCost: text("reversal_cost").notNull(),
    scope: jsonb("scope").$type<Scope>().notNull(),
    sourceLinks: jsonb("source_links").$type<readonly string[]>().notNull(),
    status: assumptionStatusEnum("status").notNull(),
    createdById: text("created_by_id").notNull(),
    createdByType: principalTypeEnum("created_by_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    resolvedById: text("resolved_by_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
    resolutionRationale: text("resolution_rationale"),
    confirmedDecisionId: text("confirmed_decision_id").references(() => decisions.id, {
      onDelete: "restrict",
    }),
    supersedingAssumptionId: text("superseding_assumption_id").references(
      (): AnyPgColumn => assumptions.id,
      { onDelete: "restrict" },
    ),
    version: integer("version").notNull(),
  },
  (table) => [
    index("bridge_assumptions_project_created_idx").on(table.projectId, table.createdAt),
    index("bridge_assumptions_project_status_expiry_idx").on(
      table.projectId,
      table.status,
      table.expiresAt,
    ),
  ],
);

export const artifacts = pgTable(
  "bridge_artifacts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    type: artifactTypeEnum("type").notNull(),
    scope: jsonb("scope").$type<Scope>().notNull(),
    reviewerIds: jsonb("reviewer_ids").$type<readonly string[]>().notNull(),
    createdById: text("created_by_id").notNull(),
    createdByType: principalTypeEnum("created_by_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    currentVersionId: text("current_version_id").notNull(),
    approvedVersionId: text("approved_version_id"),
  },
  (table) => [index("bridge_artifacts_project_created_idx").on(table.projectId, table.createdAt)],
);

export const artifactVersions = pgTable(
  "bridge_artifact_versions",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    summary: text("summary").notNull(),
    body: text("body").notNull(),
    contentSha256: text("content_sha256").notNull(),
    citedDecisionIds: jsonb("cited_decision_ids").$type<readonly string[]>().notNull(),
    status: artifactVersionStatusEnum("status").notNull(),
    createdById: text("created_by_id").notNull(),
    createdByType: principalTypeEnum("created_by_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    reviews: jsonb("reviews").$type<readonly ArtifactReview[]>().default([]).notNull(),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "restrict" }),
    approvedById: text("approved_by_id"),
    approvalRationale: text("approval_rationale"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("bridge_artifact_versions_number_unique").on(table.artifactId, table.version),
    index("bridge_artifact_versions_artifact_status_idx").on(table.artifactId, table.status),
  ],
);

export const contextSnapshots = pgTable(
  "bridge_context_snapshots",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "restrict" }),
    task: text("task").notNull(),
    itemIds: jsonb("item_ids").$type<readonly string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("bridge_context_snapshots_project_created_idx").on(table.projectId, table.createdAt)],
);

export const auditEvents = pgTable(
  "bridge_audit_events",
  {
    id: text("id").primaryKey(),
    correlationId: text("correlation_id").notNull(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    actorId: text("actor_id").notNull(),
    actorType: principalTypeEnum("actor_type").notNull(),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("bridge_audit_events_project_created_idx").on(table.projectId, table.createdAt),
    index("bridge_audit_events_correlation_idx").on(table.correlationId),
  ],
);

export const organizationAuditEvents = pgTable(
  "bridge_organization_audit_events",
  {
    id: text("id").primaryKey(),
    correlationId: text("correlation_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorId: text("actor_id").notNull(),
    actorType: principalTypeEnum("actor_type").notNull(),
    action: text("action").$type<OrganizationAuditEvent["action"]>().notNull(),
    subjectType: text("subject_type").$type<OrganizationAuditEvent["subjectType"]>().notNull(),
    subjectId: text("subject_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("bridge_organization_audit_events_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("bridge_organization_audit_events_correlation_idx").on(table.correlationId),
    check(
      "bridge_organization_audit_events_action_check",
      sql`${table.action} IN ('organization_member.created', 'organization_member.updated', 'service_identity.created', 'service_identity.rotated', 'service_identity.revoked', 'audit.exported')`,
    ),
    check(
      "bridge_organization_audit_events_subject_check",
      sql`((${table.action} IN ('organization_member.created', 'organization_member.updated') AND ${table.subjectType} = 'organization_membership') OR (${table.action} IN ('service_identity.created', 'service_identity.rotated', 'service_identity.revoked') AND ${table.subjectType} = 'service_credential') OR (${table.action} = 'audit.exported' AND ${table.subjectType} = 'audit_export'))`,
    ),
  ],
);

export const notifications = pgTable(
  "bridge_notifications",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id")
      .notNull(),
    recipientId: text("recipient_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("bridge_notifications_recipient_created_idx").on(table.recipientId, table.createdAt),
    index("bridge_notifications_recipient_read_idx").on(table.recipientId, table.readAt),
    foreignKey({
      name: "bridge_notifications_project_fk",
      columns: [table.projectId],
      foreignColumns: [projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bridge_notifications_organization_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
  ],
);

export const outboxEvents = pgTable(
  "bridge_outbox_events",
  {
    id: text("id").primaryKey(),
    correlationId: text("correlation_id").notNull(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id")
      .notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<OutboxPayload>().notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull(),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "string" }).notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "string" }),
    lastError: text("last_error"),
  },
  (table) => [
    index("bridge_outbox_status_available_idx").on(table.status, table.availableAt),
    index("bridge_outbox_project_created_idx").on(table.projectId, table.createdAt),
    index("bridge_outbox_correlation_idx").on(table.correlationId),
    unique("bridge_outbox_events_org_project_id_unique").on(
      table.organizationId,
      table.projectId,
      table.id,
    ),
    foreignKey({
      name: "bridge_outbox_events_project_fk",
      columns: [table.projectId],
      foreignColumns: [projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bridge_outbox_events_organization_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
  ],
);

export const outboxDeliveries = pgTable(
  "bridge_outbox_deliveries",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id").notNull(),
    outboxEventId: text("outbox_event_id").notNull(),
    channel: text("channel").notNull(),
    destinationHash: text("destination_hash").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    preference: text("preference").notNull(),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    unique("bridge_outbox_deliveries_event_channel_unique").on(table.outboxEventId, table.channel),
    index("bridge_outbox_deliveries_project_updated_idx").on(table.projectId, table.updatedAt),
    index("bridge_outbox_deliveries_status_updated_idx").on(table.status, table.updatedAt),
    foreignKey({
      name: "bridge_outbox_deliveries_event_scope_fk",
      columns: [table.organizationId, table.projectId, table.outboxEventId],
      foreignColumns: [outboxEvents.organizationId, outboxEvents.projectId, outboxEvents.id],
    }).onDelete("cascade"),
  ],
);

export const idempotencyRecords = pgTable(
  "bridge_idempotency_records",
  {
    key: text("key").primaryKey(),
    kind: idempotencyKindEnum("kind").notNull(),
    requestHash: text("request_hash").notNull(),
    resourceId: text("resource_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => [index("bridge_idempotency_resource_idx").on(table.kind, table.resourceId)],
);
