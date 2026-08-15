import type {
  AdapterDiagnosticCheckName,
  AdapterDiagnosticCheckStatus,
  AdapterDiagnosticMcpStatus,
  AgentRunCapability,
  AgentRunClient,
  AgentRunStatus,
  AssumptionConfidence,
  AssumptionStatus,
  ArtifactType,
  ArtifactReviewStatus,
  ArtifactVersionStatus,
  DecisionStatus,
  DeliveryChannel,
  NotificationDeliveryPreference,
  PrincipalType,
  NotificationType,
  OutboxDeliveryStatus,
  OutboxEventStatus,
  OutboxEventType,
  QuestionReviewStatus,
  QuestionStatus,
  QuestionType,
  Risk,
  Scope,
} from "@bridge/contracts";

export type {
  DeliveryChannel,
  NotificationDeliveryPreference,
  OutboxDeliveryStatus,
  OutboxEventStatus,
  OutboxEventType,
} from "@bridge/contracts";

export type BridgeErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "PROJECT_NOT_FOUND"
  | "QUESTION_NOT_FOUND"
  | "DECISION_NOT_FOUND"
  | "ARTIFACT_NOT_FOUND"
  | "RUN_NOT_FOUND"
  | "ASSUMPTION_NOT_FOUND"
  | "NOTIFICATION_NOT_FOUND"
  | "OUTBOX_EVENT_NOT_FOUND"
  | "MEMBER_NOT_FOUND"
  | "IDENTITY_NOT_CONFIGURED"
  | "LAST_ORGANIZATION_ADMIN"
  | "CONTINUATION_INVALID"
  | "SECRET_DETECTED"
  | "VALIDATION_FAILED"
  | "POLICY_BLOCKED"
  | "CONFLICT";

export class BridgeError extends Error {
  constructor(
    public readonly code: BridgeErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export interface Principal {
  readonly id: string;
  readonly type: PrincipalType;
  readonly organizationId: string;
  readonly projectIds: readonly string[];
  readonly allProjects?: boolean;
  readonly roles: readonly string[];
  readonly projectRoles?: Readonly<Record<string, readonly string[]>>;
  readonly scopes?: readonly string[];
  readonly displayName: string;
}

export type MembershipStatus = "active" | "disabled";

export interface Organization {
  readonly id: string;
  readonly externalIdentityProviderId: string;
  readonly slug: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface PrincipalIdentity {
  readonly id: string;
  readonly type: PrincipalType;
  readonly displayName: string;
  readonly oidcIssuer: string;
  readonly oidcSubject: string;
  readonly createdAt: string;
}

export interface ServiceCredential {
  readonly id: string;
  readonly organizationId: string;
  readonly principalId: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly rotatedAt?: string;
  readonly revokedAt?: string;
  readonly version: number;
}

export interface ServiceTokenResolution {
  readonly credential: ServiceCredential;
  readonly principal: Principal;
}

export interface OrganizationMembership {
  readonly organizationId: string;
  readonly principalId: string;
  readonly status: MembershipStatus;
  readonly roles: readonly string[];
  readonly allProjects: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ProjectMembership {
  readonly organizationId: string;
  readonly projectId: string;
  readonly principalId: string;
  readonly status: MembershipStatus;
  readonly roles: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface OrganizationAuditEvent {
  readonly id: string;
  readonly correlationId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly actorType: PrincipalType;
  readonly action:
    | "organization_member.created"
    | "organization_member.updated"
    | "service_identity.created"
    | "service_identity.rotated"
    | "service_identity.revoked"
    | "audit.exported";
  readonly subjectType: "organization_membership" | "service_credential" | "audit_export";
  readonly subjectId: string;
  readonly createdAt: string;
}

export interface Project {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly decisionOwnerIds: readonly string[];
}

export interface RepositoryRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly provider: string;
  readonly owner: string;
  readonly name: string;
  readonly canonicalUrl: string;
  readonly createdAt: string;
}

export interface AgentRun {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly agentId: string;
  readonly agentType: PrincipalType;
  readonly client: AgentRunClient;
  readonly capability: AgentRunCapability;
  readonly taskSummary: string;
  readonly scope: Scope;
  readonly status: AgentRunStatus;
  readonly contextSnapshotIds: readonly string[];
  readonly questionIds: readonly string[];
  readonly artifactVersionIds: readonly string[];
  readonly assumptionIds: readonly string[];
  readonly externalLinks: readonly string[];
  readonly resultLinks: readonly string[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly endedAt?: string;
  readonly summary?: string;
  readonly continuesRunId?: string;
  readonly version: number;
}

export interface AdapterDiagnostic {
  readonly organizationId: string;
  readonly projectId: string;
  readonly client: AgentRunClient;
  readonly reportedById: string;
  readonly reportedByType: PrincipalType;
  readonly correlationId: string;
  readonly capabilities: readonly AgentRunCapability[];
  readonly mcpStatus: AdapterDiagnosticMcpStatus;
  readonly checks: readonly {
    readonly name: AdapterDiagnosticCheckName;
    readonly status: AdapterDiagnosticCheckStatus;
  }[];
  readonly status: "pass" | "fail";
  readonly observedAt: string;
}

export interface Assumption {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly runId?: string;
  readonly statement: string;
  readonly rationale: string;
  readonly category: string;
  readonly risk: Risk;
  readonly confidence: AssumptionConfidence;
  readonly reversible: boolean;
  readonly reversalCost: string;
  readonly scope: Scope;
  readonly sourceLinks: readonly string[];
  readonly status: AssumptionStatus;
  readonly createdById: string;
  readonly createdByType: PrincipalType;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly resolvedById?: string;
  readonly resolvedAt?: string;
  readonly resolutionRationale?: string;
  readonly confirmedDecisionId?: string;
  readonly supersedingAssumptionId?: string;
  readonly version: number;
}

export interface QuestionOption {
  readonly key: string;
  readonly label: string;
  readonly tradeoffs: string;
}

export interface QuestionResponse {
  readonly id: string;
  readonly questionId: string;
  readonly authorId: string;
  readonly authorType: PrincipalType;
  readonly answer: string;
  readonly rationale: string;
  readonly optionKey?: string;
  readonly createdAt: string;
}

export interface QuestionReview {
  readonly id: string;
  readonly questionId: string;
  readonly reviewerId: string;
  readonly reviewerType: PrincipalType;
  readonly reviewerRole: string;
  readonly status: QuestionReviewStatus;
  readonly rationale: string;
  readonly createdAt: string;
}

export interface QuestionComment {
  readonly id: string;
  readonly questionId: string;
  readonly parentCommentId?: string;
  readonly authorId: string;
  readonly authorType: PrincipalType;
  readonly body: string;
  readonly createdAt: string;
}

export interface Notification {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly recipientId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly targetType: "question" | "response" | "comment" | "review" | "decision" | "artifact" | "artifact_version";
  readonly targetId: string;
  readonly createdAt: string;
  readonly readAt?: string;
}

export interface NotificationOutboxPayload {
  readonly notificationId: string;
  readonly recipientId: string;
  readonly notificationType: NotificationType;
  readonly targetType: Notification["targetType"];
  readonly targetId: string;
  readonly questionContext?: NotificationQuestionContext;
}

export interface NotificationQuestionContext {
  readonly id: string;
  readonly status: QuestionStatus;
  readonly risk: Risk;
  readonly ownerIds: readonly string[];
}

export interface DecisionLifecycleOutboxPayload {
  readonly decisionId: string;
  readonly status: "superseded" | "expired" | "revoked";
  readonly changedById: string;
  readonly replacementDecisionId?: string;
}

export type OutboxPayload = NotificationOutboxPayload | DecisionLifecycleOutboxPayload;

export interface OutboxEvent {
  readonly id: string;
  readonly correlationId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly type: OutboxEventType;
  readonly payload: OutboxPayload;
  readonly status: OutboxEventStatus;
  readonly attempts: number;
  readonly availableAt: string;
  readonly createdAt: string;
  readonly leaseUntil?: string;
  readonly processedAt?: string;
  readonly lastError?: string;
}

export interface OutboxDelivery {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly outboxEventId: string;
  readonly channel: DeliveryChannel;
  readonly dedupeKey?: string;
  readonly destinationHash: string;
  readonly status: OutboxDeliveryStatus;
  readonly attemptCount: number;
  readonly preference: NotificationDeliveryPreference;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly providerMessageId?: string;
  readonly lastError?: string;
}

export interface Question {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly runId?: string;
  readonly title: string;
  readonly type: QuestionType;
  readonly category: string;
  readonly context: string;
  readonly whyItMatters: string;
  readonly risk: Risk;
  readonly reversible: boolean;
  readonly blocking: boolean;
  readonly ownerIds: readonly string[];
  readonly ownerRoles: readonly string[];
  readonly options: readonly QuestionOption[];
  readonly recommendationKey?: string;
  readonly fallback?: string | null;
  readonly scope: Scope;
  readonly createdById: string;
  readonly createdByType: PrincipalType;
  readonly createdAt: string;
  readonly status: QuestionStatus;
  readonly responses: readonly QuestionResponse[];
  readonly reviews: readonly QuestionReview[];
  readonly comments: readonly QuestionComment[];
  readonly acceptedResponseId?: string;
  readonly decisionId?: string;
  readonly version: number;
}

export type QuestionInboxReason = "direct_owner" | "role_owner" | "project_admin" | "protected_review";

export interface QuestionInboxItem extends Question {
  readonly inboxReasons: readonly QuestionInboxReason[];
  readonly canAccept: boolean;
}

export interface Decision {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly questionId: string;
  readonly answer: string;
  readonly rationale: string;
  readonly category: string;
  readonly scope: Scope;
  readonly ownerId: string;
  readonly sourceResponseId: string;
  readonly status: DecisionStatus;
  readonly createdAt: string;
  readonly reviewAt: string;
  readonly lifecycleRationale?: string;
  readonly lifecycleChangedById?: string;
  readonly lifecycleChangedAt?: string;
  readonly replacementDecisionId?: string;
  readonly version: number;
}

export interface ContextItem {
  readonly id: string;
  readonly type: "decision" | "artifact" | "assumption";
  readonly title: string;
  readonly summary: string;
  readonly scope: Scope;
  readonly authority: "approved" | "confirmed" | "assumption";
  readonly sourceUrl: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
}

export interface ArtifactVersion {
  readonly id: string;
  readonly artifactId: string;
  readonly version: number;
  readonly summary: string;
  readonly body: string;
  readonly contentSha256: string;
  readonly citedDecisionIds: readonly string[];
  readonly status: ArtifactVersionStatus;
  readonly createdById: string;
  readonly createdByType: PrincipalType;
  readonly createdAt: string;
  readonly reviews: readonly ArtifactReview[];
  readonly runId?: string;
  readonly approvedById?: string;
  readonly approvalRationale?: string;
  readonly approvedAt?: string;
}

export interface ArtifactReview {
  readonly id: string;
  readonly artifactVersionId: string;
  readonly reviewerId: string;
  readonly reviewerType: PrincipalType;
  readonly status: ArtifactReviewStatus;
  readonly body: string;
  readonly createdAt: string;
}

export interface Artifact {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly title: string;
  readonly type: ArtifactType;
  readonly scope: Scope;
  readonly reviewerIds: readonly string[];
  readonly createdById: string;
  readonly createdByType: PrincipalType;
  readonly createdAt: string;
  readonly currentVersionId: string;
  readonly approvedVersionId?: string;
  readonly versions: readonly ArtifactVersion[];
}

export interface ContextSnapshot {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly principalId: string;
  readonly runId?: string;
  readonly task: string;
  readonly itemIds: readonly string[];
  readonly createdAt: string;
}

export interface AuditEvent {
  readonly id: string;
  readonly correlationId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly actorType: PrincipalType;
  readonly action: string;
  readonly subjectType: "project" | "repository" | "question" | "response" | "decision" | "assumption" | "artifact" | "artifact_version" | "context_snapshot" | "run" | "outbox_event" | "audit_export";
  readonly subjectId: string;
  readonly createdAt: string;
}

export function assertProjectAccess(principal: Principal, project: Project): void {
  if (
    principal.organizationId !== project.organizationId ||
    (
      !principalHasRole(principal, "organization-admin") &&
      !principal.allProjects &&
      !principal.projectIds.includes(project.id)
    )
  ) {
    throw new BridgeError("FORBIDDEN", "The principal cannot access this project.", 403);
  }
}

export function assertHuman(principal: Principal, action: string): void {
  if (principal.type !== "human") {
    throw new BridgeError("FORBIDDEN", `${action} requires an authenticated human.`, 403);
  }
}

export function normalizeRoleName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function principalHasRole(principal: Principal, role: string, projectId?: string): boolean {
  const normalizedRole = normalizeRoleName(role);
  const organizationRoles = principal.roles.map(normalizeRoleName);
  if (
    projectId &&
    normalizedRole === "project-admin" &&
    organizationRoles.includes("organization-admin")
  ) {
    return true;
  }
  return [
    ...organizationRoles,
    ...(projectId ? principal.projectRoles?.[projectId] ?? [] : []),
  ].some((principalRole) => normalizeRoleName(principalRole) === normalizedRole);
}

export const bridgeScopes = {
  read: "bridge:read",
  write: "bridge:write",
} as const;

export type BridgeScope = (typeof bridgeScopes)[keyof typeof bridgeScopes];

export function principalHasScope(principal: Principal, scope: BridgeScope): boolean {
  if (principal.type === "human") return true;
  return principal.scopes?.includes(scope) === true || principal.scopes?.includes("bridge:admin") === true;
}

export function assertPrincipalScope(
  principal: Principal,
  scope: BridgeScope,
  action: string,
): void {
  if (principalHasScope(principal, scope)) return;
  throw new BridgeError(
    "FORBIDDEN",
    `${action} requires the ${scope} capability.`,
    403,
    { requiredScope: scope },
  );
}

function hasQuestionOwnerMatch(principal: Principal, question: Question): boolean {
  return question.ownerIds.includes(principal.id) ||
    question.ownerRoles.some((role) => principalHasRole(principal, role, question.projectId)) ||
    principalHasRole(principal, "project-admin", question.projectId);
}

export function canAcceptQuestion(principal: Principal, question: Question): boolean {
  if (principal.type !== "human" || !hasQuestionOwnerMatch(principal, question)) return false;
  return question.risk !== "protected" ||
    principalHasRole(principal, "security-reviewer", question.projectId) ||
    question.reviews.some((review) => review.status === "approved" && normalizeRoleName(review.reviewerRole) === "security-reviewer");
}

export function questionInboxReasons(
  principal: Principal,
  question: Question,
): readonly QuestionInboxReason[] {
  if (principal.type !== "human" || !["open", "in_discussion"].includes(question.status)) return [];
  const reasons: QuestionInboxReason[] = [];
  if (question.ownerIds.includes(principal.id)) reasons.push("direct_owner");
  if (question.ownerRoles.some((role) => principalHasRole(principal, role, question.projectId))) reasons.push("role_owner");
  if (principalHasRole(principal, "project-admin", question.projectId)) reasons.push("project_admin");
  if (question.risk === "protected" && principalHasRole(principal, "security-reviewer", question.projectId)) {
    reasons.push("protected_review");
  }
  return reasons;
}

export function assertCanAccept(principal: Principal, question: Question): void {
  assertHuman(principal, "Accepting a decision");
  if (!hasQuestionOwnerMatch(principal, question)) {
    throw new BridgeError("FORBIDDEN", "Only a configured decision owner or assigned role can accept this answer.", 403);
  }
  if (
    question.risk === "protected" &&
    !principalHasRole(principal, "security-reviewer", question.projectId) &&
    !question.reviews.some(
      (review) => review.status === "approved" && normalizeRoleName(review.reviewerRole) === "security-reviewer",
    )
  ) {
    throw new BridgeError(
      "POLICY_BLOCKED",
      "Protected decisions require a human security reviewer in this vertical slice.",
      403,
    );
  }
}

export function assertCanApproveArtifact(
  principal: Principal,
  artifact: Artifact,
  projectDecisionOwnerIds: readonly string[] = [],
): void {
  assertHuman(principal, "Approving a specification");
  const isReviewer = artifact.reviewerIds.includes(principal.id);
  const isDecisionOwner = projectDecisionOwnerIds.includes(principal.id);
  const isProjectAdmin = principalHasRole(principal, "project-admin", artifact.projectId);
  if (!isReviewer && !isDecisionOwner && !isProjectAdmin) {
    throw new BridgeError(
      "FORBIDDEN",
      "Only a configured specification reviewer, decision owner, or project administrator can approve this version.",
      403,
    );
  }
}

export function assertCanReviewArtifact(principal: Principal, artifact: Artifact): void {
  assertHuman(principal, "Reviewing a specification");
  const isReviewer = artifact.reviewerIds.includes(principal.id);
  const isProjectAdmin = principalHasRole(principal, "project-admin", artifact.projectId);
  if (!isReviewer && !isProjectAdmin) {
    throw new BridgeError(
      "FORBIDDEN",
      "Only a configured specification reviewer can add formal review feedback.",
      403,
    );
  }
}

export function reviewDateFor(risk: Risk, createdAt: Date): string {
  const reviewAt = new Date(createdAt);
  reviewAt.setUTCDate(reviewAt.getUTCDate() + (risk === "protected" ? 90 : 180));
  return reviewAt.toISOString();
}
