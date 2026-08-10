import type {
  AgentRun,
  Assumption,
  Artifact,
  ArtifactVersion,
  AuditEvent,
  ContextSnapshot,
  Decision,
  Notification,
  Organization,
  OrganizationMembership,
  OutboxDelivery,
  OutboxEvent,
  PrincipalIdentity,
  Project,
  ProjectMembership,
  Question,
  QuestionResponse,
} from "@bridge/domain";

import {
  agentRuns,
  assumptions,
  artifacts,
  artifactVersions,
  auditEvents,
  contextSnapshots,
  decisions,
  projects,
  questionResponses,
  questions,
  notifications,
  organizations,
  organizationMemberships,
  outboxDeliveries,
  outboxEvents,
  principalIdentities,
  projectMemberships,
} from "./schema.js";

export type OrganizationRow = typeof organizations.$inferSelect;
export type PrincipalIdentityRow = typeof principalIdentities.$inferSelect;
export type OrganizationMembershipRow = typeof organizationMemberships.$inferSelect;
export type ProjectMembershipRow = typeof projectMemberships.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type AssumptionRow = typeof assumptions.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type QuestionResponseRow = typeof questionResponses.$inferSelect;
export type DecisionRow = typeof decisions.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type ArtifactVersionRow = typeof artifactVersions.$inferSelect;
export type ContextSnapshotRow = typeof contextSnapshots.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type OutboxEventRow = typeof outboxEvents.$inferSelect;
export type OutboxDeliveryRow = typeof outboxDeliveries.$inferSelect;

export function organizationToRow(organization: Organization): typeof organizations.$inferInsert {
  return {
    id: organization.id,
    externalIdentityProviderId: organization.externalIdentityProviderId,
    slug: organization.slug,
    name: organization.name,
    createdAt: organization.createdAt,
  };
}

export function organizationFromRow(row: OrganizationRow): Organization {
  return { ...row };
}

export function principalIdentityToRow(
  identity: PrincipalIdentity,
): typeof principalIdentities.$inferInsert {
  return { ...identity };
}

export function principalIdentityFromRow(row: PrincipalIdentityRow): PrincipalIdentity {
  return { ...row };
}

export function organizationMembershipToRow(
  membership: OrganizationMembership,
): typeof organizationMemberships.$inferInsert {
  return { ...membership };
}

export function organizationMembershipFromRow(
  row: OrganizationMembershipRow,
): OrganizationMembership {
  return { ...row };
}

export function projectMembershipToRow(
  membership: ProjectMembership,
): typeof projectMemberships.$inferInsert {
  return { ...membership };
}

export function projectMembershipFromRow(row: ProjectMembershipRow): ProjectMembership {
  return { ...row };
}

export function projectToRow(project: Project): typeof projects.$inferInsert {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    decisionOwnerIds: project.decisionOwnerIds,
  };
}

export function notificationToRow(notification: Notification): typeof notifications.$inferInsert {
  return {
    id: notification.id,
    organizationId: notification.organizationId,
    projectId: notification.projectId,
    recipientId: notification.recipientId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    targetType: notification.targetType,
    targetId: notification.targetId,
    createdAt: notification.createdAt,
    readAt: notification.readAt ?? null,
  };
}

export function notificationFromRow(row: NotificationRow): Notification {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    recipientId: row.recipientId,
    type: row.type as Notification["type"],
    title: row.title,
    body: row.body,
    targetType: row.targetType as Notification["targetType"],
    targetId: row.targetId,
    createdAt: row.createdAt,
    ...(row.readAt === null ? {} : { readAt: row.readAt }),
  };
}

export function outboxEventToRow(event: OutboxEvent): typeof outboxEvents.$inferInsert {
  return {
    id: event.id,
    correlationId: event.correlationId,
    organizationId: event.organizationId,
    projectId: event.projectId,
    type: event.type,
    payload: event.payload,
    status: event.status,
    attempts: event.attempts,
    availableAt: event.availableAt,
    leaseUntil: event.leaseUntil ?? null,
    createdAt: event.createdAt,
    processedAt: event.processedAt ?? null,
    lastError: event.lastError ?? null,
  };
}

export function outboxEventFromRow(row: OutboxEventRow): OutboxEvent {
  return {
    id: row.id,
    correlationId: row.correlationId,
    organizationId: row.organizationId,
    projectId: row.projectId,
    type: row.type as OutboxEvent["type"],
    payload: row.payload,
    status: row.status as OutboxEvent["status"],
    attempts: row.attempts,
    availableAt: row.availableAt,
    createdAt: row.createdAt,
    ...(row.leaseUntil === null ? {} : { leaseUntil: row.leaseUntil }),
    ...(row.processedAt === null ? {} : { processedAt: row.processedAt }),
    ...(row.lastError === null ? {} : { lastError: row.lastError }),
  };
}

export function outboxDeliveryToRow(delivery: OutboxDelivery): typeof outboxDeliveries.$inferInsert {
  return {
    id: delivery.id,
    organizationId: delivery.organizationId,
    projectId: delivery.projectId,
    outboxEventId: delivery.outboxEventId,
    channel: delivery.channel,
    destinationHash: delivery.destinationHash,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    preference: delivery.preference,
    providerMessageId: delivery.providerMessageId ?? null,
    lastError: delivery.lastError ?? null,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
}

export function outboxDeliveryFromRow(row: OutboxDeliveryRow): OutboxDelivery {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    outboxEventId: row.outboxEventId,
    channel: row.channel as OutboxDelivery["channel"],
    destinationHash: row.destinationHash,
    status: row.status as OutboxDelivery["status"],
    attemptCount: row.attemptCount,
    preference: row.preference as OutboxDelivery["preference"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.providerMessageId === null ? {} : { providerMessageId: row.providerMessageId }),
    ...(row.lastError === null ? {} : { lastError: row.lastError }),
  };
}

export function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    decisionOwnerIds: row.decisionOwnerIds,
  };
}

export function runToRow(run: AgentRun): typeof agentRuns.$inferInsert {
  return {
    id: run.id,
    organizationId: run.organizationId,
    projectId: run.projectId,
    agentId: run.agentId,
    agentType: run.agentType,
    client: run.client,
    capability: run.capability,
    taskSummary: run.taskSummary,
    scope: run.scope,
    status: run.status,
    contextSnapshotIds: run.contextSnapshotIds,
    questionIds: run.questionIds,
    artifactVersionIds: run.artifactVersionIds,
    assumptionIds: run.assumptionIds,
    externalLinks: run.externalLinks,
    resultLinks: run.resultLinks,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    endedAt: run.endedAt ?? null,
    summary: run.summary ?? null,
    continuesRunId: run.continuesRunId ?? null,
    version: run.version,
  };
}

export function runFromRow(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    agentId: row.agentId,
    agentType: row.agentType,
    client: row.client,
    capability: row.capability,
    taskSummary: row.taskSummary,
    scope: row.scope,
    status: row.status,
    contextSnapshotIds: row.contextSnapshotIds,
    questionIds: row.questionIds,
    artifactVersionIds: row.artifactVersionIds,
    assumptionIds: row.assumptionIds,
    externalLinks: row.externalLinks,
    resultLinks: row.resultLinks,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    ...(row.endedAt === null ? {} : { endedAt: row.endedAt }),
    ...(row.summary === null ? {} : { summary: row.summary }),
    ...(row.continuesRunId === null ? {} : { continuesRunId: row.continuesRunId }),
    version: row.version,
  };
}

export function assumptionToRow(assumption: Assumption): typeof assumptions.$inferInsert {
  return {
    id: assumption.id,
    organizationId: assumption.organizationId,
    projectId: assumption.projectId,
    runId: assumption.runId ?? null,
    statement: assumption.statement,
    rationale: assumption.rationale,
    category: assumption.category,
    risk: assumption.risk,
    confidence: assumption.confidence,
    reversible: assumption.reversible,
    reversalCost: assumption.reversalCost,
    scope: assumption.scope,
    sourceLinks: assumption.sourceLinks,
    status: assumption.status,
    createdById: assumption.createdById,
    createdByType: assumption.createdByType,
    createdAt: assumption.createdAt,
    expiresAt: assumption.expiresAt,
    resolvedById: assumption.resolvedById ?? null,
    resolvedAt: assumption.resolvedAt ?? null,
    resolutionRationale: assumption.resolutionRationale ?? null,
    confirmedDecisionId: assumption.confirmedDecisionId ?? null,
    supersedingAssumptionId: assumption.supersedingAssumptionId ?? null,
    version: assumption.version,
  };
}

export function assumptionFromRow(row: AssumptionRow): Assumption {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    ...(row.runId === null ? {} : { runId: row.runId }),
    statement: row.statement,
    rationale: row.rationale,
    category: row.category,
    risk: row.risk,
    confidence: row.confidence,
    reversible: row.reversible,
    reversalCost: row.reversalCost,
    scope: row.scope,
    sourceLinks: row.sourceLinks,
    status: row.status,
    createdById: row.createdById,
    createdByType: row.createdByType,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    ...(row.resolvedById === null ? {} : { resolvedById: row.resolvedById }),
    ...(row.resolvedAt === null ? {} : { resolvedAt: row.resolvedAt }),
    ...(row.resolutionRationale === null ? {} : { resolutionRationale: row.resolutionRationale }),
    ...(row.confirmedDecisionId === null ? {} : { confirmedDecisionId: row.confirmedDecisionId }),
    ...(row.supersedingAssumptionId === null
      ? {}
      : { supersedingAssumptionId: row.supersedingAssumptionId }),
    version: row.version,
  };
}

export function questionToRow(question: Question): typeof questions.$inferInsert {
  return {
    id: question.id,
    organizationId: question.organizationId,
    projectId: question.projectId,
    runId: question.runId ?? null,
    title: question.title,
    type: question.type,
    category: question.category,
    context: question.context,
    whyItMatters: question.whyItMatters,
    risk: question.risk,
    reversible: question.reversible,
    blocking: question.blocking,
    ownerIds: question.ownerIds,
    ownerRoles: question.ownerRoles,
    options: question.options,
    reviews: question.reviews,
    comments: question.comments,
    recommendationKey: question.recommendationKey ?? null,
    fallback: question.fallback ?? null,
    scope: question.scope,
    createdById: question.createdById,
    createdByType: question.createdByType,
    createdAt: question.createdAt,
    status: question.status,
    acceptedResponseId: question.acceptedResponseId ?? null,
    decisionId: question.decisionId ?? null,
    version: question.version,
  };
}

export function responseToRow(response: QuestionResponse): typeof questionResponses.$inferInsert {
  return {
    id: response.id,
    questionId: response.questionId,
    authorId: response.authorId,
    authorType: response.authorType,
    answer: response.answer,
    rationale: response.rationale,
    optionKey: response.optionKey ?? null,
    createdAt: response.createdAt,
  };
}

export function responseFromRow(row: QuestionResponseRow): QuestionResponse {
  return {
    id: row.id,
    questionId: row.questionId,
    authorId: row.authorId,
    authorType: row.authorType,
    answer: row.answer,
    rationale: row.rationale,
    ...(row.optionKey === null ? {} : { optionKey: row.optionKey }),
    createdAt: row.createdAt,
  };
}

export function questionFromRows(
  row: QuestionRow,
  responseRows: readonly QuestionResponseRow[],
): Question {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    ...(row.runId === null ? {} : { runId: row.runId }),
    title: row.title,
    type: row.type,
    category: row.category,
    context: row.context,
    whyItMatters: row.whyItMatters,
    risk: row.risk,
    reversible: row.reversible,
    blocking: row.blocking,
    ownerIds: row.ownerIds,
    ownerRoles: row.ownerRoles,
    options: row.options,
    reviews: row.reviews,
    comments: row.comments,
    ...(row.recommendationKey === null ? {} : { recommendationKey: row.recommendationKey }),
    ...(row.fallback === null ? {} : { fallback: row.fallback }),
    scope: row.scope,
    createdById: row.createdById,
    createdByType: row.createdByType,
    createdAt: row.createdAt,
    status: row.status,
    responses: responseRows
      .filter((response) => response.questionId === row.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(responseFromRow),
    ...(row.acceptedResponseId === null ? {} : { acceptedResponseId: row.acceptedResponseId }),
    ...(row.decisionId === null ? {} : { decisionId: row.decisionId }),
    version: row.version,
  };
}

export function decisionToRow(decision: Decision): typeof decisions.$inferInsert {
  return {
    id: decision.id,
    organizationId: decision.organizationId,
    projectId: decision.projectId,
    questionId: decision.questionId,
    answer: decision.answer,
    rationale: decision.rationale,
    category: decision.category,
    scope: decision.scope,
    ownerId: decision.ownerId,
    sourceResponseId: decision.sourceResponseId,
    status: decision.status,
    createdAt: decision.createdAt,
    reviewAt: decision.reviewAt,
    lifecycleRationale: decision.lifecycleRationale ?? null,
    lifecycleChangedById: decision.lifecycleChangedById ?? null,
    lifecycleChangedAt: decision.lifecycleChangedAt ?? null,
    replacementDecisionId: decision.replacementDecisionId ?? null,
    version: decision.version,
  };
}

export function decisionFromRow(row: DecisionRow): Decision {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    questionId: row.questionId,
    answer: row.answer,
    rationale: row.rationale,
    category: row.category,
    scope: row.scope,
    ownerId: row.ownerId,
    sourceResponseId: row.sourceResponseId,
    status: row.status,
    createdAt: row.createdAt,
    reviewAt: row.reviewAt,
    ...(row.lifecycleRationale === null ? {} : { lifecycleRationale: row.lifecycleRationale }),
    ...(row.lifecycleChangedById === null ? {} : { lifecycleChangedById: row.lifecycleChangedById }),
    ...(row.lifecycleChangedAt === null ? {} : { lifecycleChangedAt: row.lifecycleChangedAt }),
    ...(row.replacementDecisionId === null ? {} : { replacementDecisionId: row.replacementDecisionId }),
    version: row.version,
  };
}

export function artifactToRow(artifact: Artifact): typeof artifacts.$inferInsert {
  return {
    id: artifact.id,
    organizationId: artifact.organizationId,
    projectId: artifact.projectId,
    title: artifact.title,
    type: artifact.type,
    scope: artifact.scope,
    reviewerIds: artifact.reviewerIds,
    createdById: artifact.createdById,
    createdByType: artifact.createdByType,
    createdAt: artifact.createdAt,
    currentVersionId: artifact.currentVersionId,
    approvedVersionId: artifact.approvedVersionId ?? null,
  };
}

export function artifactVersionToRow(
  version: ArtifactVersion,
): typeof artifactVersions.$inferInsert {
  return {
    id: version.id,
    artifactId: version.artifactId,
    version: version.version,
    summary: version.summary,
    body: version.body,
    contentSha256: version.contentSha256,
    citedDecisionIds: version.citedDecisionIds,
    status: version.status,
    createdById: version.createdById,
    createdByType: version.createdByType,
    createdAt: version.createdAt,
    reviews: version.reviews,
    runId: version.runId ?? null,
    approvedById: version.approvedById ?? null,
    approvalRationale: version.approvalRationale ?? null,
    approvedAt: version.approvedAt ?? null,
  };
}

export function artifactVersionFromRow(row: ArtifactVersionRow): ArtifactVersion {
  return {
    id: row.id,
    artifactId: row.artifactId,
    version: row.version,
    summary: row.summary,
    body: row.body,
    contentSha256: row.contentSha256,
    citedDecisionIds: row.citedDecisionIds,
    status: row.status,
    createdById: row.createdById,
    createdByType: row.createdByType,
    createdAt: row.createdAt,
    reviews: row.reviews,
    ...(row.runId === null ? {} : { runId: row.runId }),
    ...(row.approvedById === null ? {} : { approvedById: row.approvedById }),
    ...(row.approvalRationale === null ? {} : { approvalRationale: row.approvalRationale }),
    ...(row.approvedAt === null ? {} : { approvedAt: row.approvedAt }),
  };
}

export function artifactFromRows(
  row: ArtifactRow,
  versionRows: readonly ArtifactVersionRow[],
): Artifact {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    title: row.title,
    type: row.type,
    scope: row.scope,
    reviewerIds: row.reviewerIds,
    createdById: row.createdById,
    createdByType: row.createdByType,
    createdAt: row.createdAt,
    currentVersionId: row.currentVersionId,
    ...(row.approvedVersionId === null ? {} : { approvedVersionId: row.approvedVersionId }),
    versions: versionRows
      .filter((version) => version.artifactId === row.id)
      .sort((left, right) => left.version - right.version)
      .map(artifactVersionFromRow),
  };
}

export function contextSnapshotToRow(
  snapshot: ContextSnapshot,
): typeof contextSnapshots.$inferInsert {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    projectId: snapshot.projectId,
    principalId: snapshot.principalId,
    runId: snapshot.runId ?? null,
    task: snapshot.task,
    itemIds: snapshot.itemIds,
    createdAt: snapshot.createdAt,
  };
}

export function contextSnapshotFromRow(row: ContextSnapshotRow): ContextSnapshot {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    principalId: row.principalId,
    ...(row.runId === null ? {} : { runId: row.runId }),
    task: row.task,
    itemIds: row.itemIds,
    createdAt: row.createdAt,
  };
}

export function auditEventToRow(event: AuditEvent): typeof auditEvents.$inferInsert {
  return {
    id: event.id,
    correlationId: event.correlationId,
    organizationId: event.organizationId,
    projectId: event.projectId,
    actorId: event.actorId,
    actorType: event.actorType,
    action: event.action,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    createdAt: event.createdAt,
  };
}

export function auditEventFromRow(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    correlationId: row.correlationId,
    organizationId: row.organizationId,
    projectId: row.projectId,
    actorId: row.actorId,
    actorType: row.actorType,
    action: row.action,
    subjectType: row.subjectType as AuditEvent["subjectType"],
    subjectId: row.subjectId,
    createdAt: row.createdAt,
  };
}
