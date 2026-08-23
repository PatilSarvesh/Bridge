import { bridgeCapabilityScopes } from "@bridge/contracts";
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
  PolicyAction,
  OutboxDeliveryStatus,
  OutboxEventStatus,
  OutboxEventType,
  QuestionReviewStatus,
  QuestionStatus,
  QuestionType,
  Risk,
  Scope,
  BridgeCapabilityScope,
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
  | "PULL_REQUEST_NOT_FOUND"
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
    | "audit.exported"
    | "authentication.succeeded"
    | "authentication.logged_out";
  readonly subjectType:
    | "organization_membership"
    | "service_credential"
    | "audit_export"
    | "principal_identity";
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

export interface GithubPullRequestContext {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly repositoryId: string;
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed" | "merged";
  readonly canonicalUrl: string;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly headSha: string;
  readonly decisionIds: readonly string[];
  readonly artifactVersionIds: readonly string[];
  readonly sourceUpdatedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ProjectRoleDefinition {
  readonly name: string;
  readonly description: string;
}

export interface ProjectTeam {
  readonly key: string;
  readonly name: string;
  readonly memberIds: readonly string[];
}

export interface OwnershipRuleTarget {
  readonly principalIds: readonly string[];
  readonly roles: readonly string[];
  readonly teamKeys: readonly string[];
}

export interface ProjectOwnershipRule {
  readonly key: string;
  readonly name: string;
  readonly priority: number;
  readonly category?: string;
  readonly repository?: string;
  readonly component?: string;
  readonly owners: OwnershipRuleTarget;
  readonly reviewers: OwnershipRuleTarget;
}

export interface ProjectOwnershipConfiguration {
  readonly organizationId: string;
  readonly projectId: string;
  readonly roles: readonly ProjectRoleDefinition[];
  readonly teams: readonly ProjectTeam[];
  readonly rules: readonly ProjectOwnershipRule[];
  readonly version: number;
  readonly updatedById?: string;
  readonly updatedAt?: string;
}

export interface ProjectPolicyRule {
  readonly key: string;
  readonly name: string;
  readonly priority: number;
  readonly category?: string;
  readonly scope: Scope;
  readonly action: PolicyAction;
  readonly minimumRisk: Risk;
  readonly requiredOwnerRoles: readonly string[];
  readonly requiredReviewerRoles: readonly string[];
  readonly reviewerQuorum?: Readonly<Record<string, number>>;
}

export interface ProjectPolicyConfiguration {
  readonly organizationId: string;
  readonly projectId: string;
  readonly rules: readonly ProjectPolicyRule[];
  readonly version: number;
  readonly updatedById?: string;
  readonly updatedAt?: string;
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

export interface QuestionLink {
  readonly type: "repository" | "work_item" | "branch" | "artifact" | "run" | "external";
  readonly label: string;
  readonly url: string;
}

export interface QuestionResponseRevision {
  readonly id: string;
  readonly answer: string;
  readonly rationale: string;
  readonly optionKey?: string;
  readonly mentionedPrincipalIds: readonly string[];
  readonly editedById: string;
  readonly editedByType: PrincipalType;
  readonly editedAt: string;
}

export interface QuestionResponse {
  readonly id: string;
  readonly questionId: string;
  readonly authorId: string;
  readonly authorType: PrincipalType;
  readonly answer: string;
  readonly rationale: string;
  readonly optionKey?: string;
  readonly mentionedPrincipalIds?: readonly string[];
  readonly revisionHistory?: readonly QuestionResponseRevision[];
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

export interface QuestionCommentRevision {
  readonly id: string;
  readonly body: string;
  readonly mentionedPrincipalIds: readonly string[];
  readonly editedById: string;
  readonly editedByType: PrincipalType;
  readonly editedAt: string;
}

export interface QuestionComment {
  readonly id: string;
  readonly questionId: string;
  readonly parentCommentId?: string;
  readonly authorId: string;
  readonly authorType: PrincipalType;
  readonly body: string;
  readonly mentionedPrincipalIds?: readonly string[];
  readonly revisionHistory?: readonly QuestionCommentRevision[];
  readonly createdAt: string;
}

export interface QuestionApprovalOverride {
  readonly changedById: string;
  readonly changedByType: PrincipalType;
  readonly reason: string;
  readonly createdAt: string;
  readonly questionVersion: number;
}

export type QuestionApprovalRequirementStatus = "satisfied" | "pending" | "rejected";

export interface QuestionApprovalRequirement {
  readonly role: string;
  readonly requiredCount: number;
  readonly approvedCount: number;
  readonly rejectedCount: number;
  readonly remainingCount: number;
  readonly status: QuestionApprovalRequirementStatus;
  readonly reviewerIds: readonly string[];
}

export interface QuestionApprovalStatus {
  readonly requirements: readonly QuestionApprovalRequirement[];
  readonly satisfied: boolean;
  readonly overridden: boolean;
}

export type QuestionRouteSource =
  | "explicit_owner"
  | "scoped_ownership"
  | "category_role"
  | "project_default"
  | "admin_fallback"
  | "policy"
  | "none"
  | "reassignment"
  | "legacy_assignment";

export interface QuestionRoutingExplanation {
  readonly ownerSource: QuestionRouteSource;
  readonly reviewerSource: QuestionRouteSource;
  readonly ownerRuleKey?: string;
  readonly reviewerRuleKey?: string;
  readonly ownershipVersion: number;
  readonly policyVersion: number;
}

export interface QuestionAssignmentHistoryEntry {
  readonly id: string;
  readonly kind: "initial" | "reassigned";
  readonly changedById: string;
  readonly changedByType: PrincipalType;
  readonly ownerIds: readonly string[];
  readonly ownerRoles: readonly string[];
  readonly reviewerIds: readonly string[];
  readonly reviewerRoles: readonly string[];
  readonly route: QuestionRoutingExplanation;
  readonly reason?: string;
  readonly createdAt: string;
  readonly questionVersion: number;
}

export interface Notification {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly recipientId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly targetType: "question" | "response" | "comment" | "review" | "decision" | "assumption" | "artifact" | "artifact_version";
  readonly targetId: string;
  readonly createdAt: string;
  readonly readAt?: string;
}

export interface NotificationPreference {
  readonly organizationId: string;
  readonly principalId: string;
  readonly channel: "email";
  readonly preference: NotificationDeliveryPreference;
  readonly updatedAt: string;
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

export interface QuestionReassignedOutboxPayload {
  readonly questionId: string;
  readonly changedById: string;
  readonly assignmentId: string;
  readonly questionVersion: number;
}

export type OutboxPayload = NotificationOutboxPayload | DecisionLifecycleOutboxPayload | QuestionReassignedOutboxPayload;

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
  readonly digestAvailableAt?: string;
  readonly digestLeaseUntil?: string;
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
  readonly policyAction: PolicyAction;
  readonly policyVersion: number;
  readonly policyRuleKey: string;
  readonly reversible: boolean;
  readonly blocking: boolean;
  readonly dueAt?: string;
  readonly blockingEscalatedAt?: string;
  readonly ownerIds: readonly string[];
  readonly ownerRoles: readonly string[];
  readonly requiredOwnerRoles: readonly string[];
  readonly reviewerIds: readonly string[];
  readonly reviewerRoles: readonly string[];
  readonly requiredReviewerRoles: readonly string[];
  readonly requiredReviewerQuorum?: Readonly<Record<string, number>>;
  readonly routing: QuestionRoutingExplanation;
  readonly assignmentHistory: readonly QuestionAssignmentHistoryEntry[];
  readonly options: readonly QuestionOption[];
  readonly relatedLinks?: readonly QuestionLink[];
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
  readonly approvalOverride?: QuestionApprovalOverride;
  readonly acceptedResponseId?: string;
  readonly decisionId?: string;
  readonly version: number;
}

export type QuestionInboxReason =
  | "direct_owner"
  | "role_owner"
  | "direct_reviewer"
  | "role_reviewer"
  | "project_admin"
  | "protected_review";

export type QuestionDueStatus = "overdue" | "due_soon" | "scheduled" | "none";

export interface QuestionInboxItem extends Question {
  readonly inboxReasons: readonly QuestionInboxReason[];
  readonly canAccept: boolean;
  readonly reviewRoles: readonly string[];
  readonly canReassign: boolean;
  readonly canOverrideApproval: boolean;
  readonly canRequestClarification: boolean;
  readonly canReopen: boolean;
  readonly editableResponseIds: readonly string[];
  readonly editableCommentIds: readonly string[];
  readonly approvalStatus: QuestionApprovalStatus;
  readonly dueStatus: QuestionDueStatus;
}

export interface Decision {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly questionId?: string;
  readonly answer: string;
  readonly rationale: string;
  readonly category: string;
  readonly scope: Scope;
  readonly ownerId: string;
  readonly sourceResponseId?: string;
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
  readonly requiredApprovals: number;
  readonly approvalStatus: ArtifactApprovalStatus;
  readonly runId?: string;
  readonly approvedById?: string;
  readonly approvalRationale?: string;
  readonly approvedAt?: string;
}

export interface ArtifactApprovalStatus {
  readonly requiredCount: number;
  readonly approvedCount: number;
  readonly remainingCount: number;
  readonly status: "pending" | "blocked" | "satisfied";
  readonly satisfied: boolean;
  readonly reviewerIds: readonly string[];
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

export function artifactApprovalStatus(
  version: Pick<ArtifactVersion, "requiredApprovals" | "reviews" | "status"> &
    Pick<Partial<ArtifactVersion>, "approvedById">,
): ArtifactApprovalStatus {
  const approvedReviewerIds = new Set(
    version.reviews
      .filter((review) => review.status === "approved" && review.reviewerType === "human")
      .map((review) => review.reviewerId),
  );
  if (
    approvedReviewerIds.size === 0 &&
    version.approvedById &&
    ["approved", "superseded"].includes(version.status)
  ) {
    approvedReviewerIds.add(version.approvedById);
  }
  const reviewerIds = [...approvedReviewerIds].sort((left, right) => left.localeCompare(right));
  const blocked = version.reviews.some((review) => review.status === "changes_requested");
  const approvedCount = reviewerIds.length;
  const satisfied = !blocked && approvedCount >= version.requiredApprovals;
  return {
    requiredCount: version.requiredApprovals,
    approvedCount,
    remainingCount: Math.max(0, version.requiredApprovals - approvedCount),
    status: blocked ? "blocked" : satisfied ? "satisfied" : "pending",
    satisfied,
    reviewerIds,
  };
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
  readonly subjectType: "project" | "repository" | "pull_request_context" | "ownership_configuration" | "policy_configuration" | "question" | "response" | "decision" | "assumption" | "artifact" | "artifact_version" | "context_snapshot" | "run" | "outbox_event" | "audit_export";
  readonly subjectId: string;
  readonly reason?: string;
  readonly policyVersion?: number;
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

export const bridgeScopes = bridgeCapabilityScopes;

export type BridgeScope = BridgeCapabilityScope;

const fineGrainedReadScopes = new Set<BridgeScope>([
  bridgeScopes.projectsRead,
  bridgeScopes.repositoriesRead,
  bridgeScopes.contextRead,
  bridgeScopes.runsRead,
  bridgeScopes.questionsRead,
  bridgeScopes.assumptionsRead,
  bridgeScopes.decisionsRead,
  bridgeScopes.artifactsRead,
  bridgeScopes.notificationsRead,
  bridgeScopes.organizationRead,
]);
const fineGrainedWriteScopes = new Set<BridgeScope>([
  bridgeScopes.projectsWrite,
  bridgeScopes.repositoriesWrite,
  bridgeScopes.runsWrite,
  bridgeScopes.questionsWrite,
  bridgeScopes.assumptionsWrite,
  bridgeScopes.decisionsWrite,
  bridgeScopes.artifactsWrite,
  bridgeScopes.notificationsWrite,
  bridgeScopes.diagnosticsWrite,
]);

export function principalHasScope(principal: Principal, scope: BridgeScope): boolean {
  if (principal.type === "human") return true;
  const granted = new Set(principal.scopes ?? []);
  if (granted.has(bridgeScopes.admin) || granted.has(scope)) return true;
  if (fineGrainedReadScopes.has(scope)) return granted.has(bridgeScopes.read);
  if (fineGrainedWriteScopes.has(scope)) return granted.has(bridgeScopes.write);
  return false;
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
  const assigned = question.ownerIds.includes(principal.id) ||
    question.ownerRoles.some((role) => principalHasRole(principal, role, question.projectId)) ||
    principalHasRole(principal, "project-admin", question.projectId);
  return assigned && (question.requiredOwnerRoles ?? []).every((role) =>
    principalHasRole(principal, role, question.projectId));
}

function requiredQuestionReviewerRoles(question: Question): readonly string[] {
  return (question.requiredReviewerRoles ?? []).length > 0
    ? question.requiredReviewerRoles.map(normalizeRoleName)
    : question.risk === "protected" && (!question.policyRuleKey || question.policyRuleKey === "bridge-legacy-protected")
      ? ["security-reviewer"]
      : [];
}

export function questionApprovalStatus(question: Question): QuestionApprovalStatus {
  const quorum = question.requiredReviewerQuorum ?? {};
  const requirements = requiredQuestionReviewerRoles(question).map((role): QuestionApprovalRequirement => {
    const configuredCount = Object.entries(quorum).find(([configuredRole]) => normalizeRoleName(configuredRole) === role)?.[1];
    const requiredCount = Math.max(1, configuredCount ?? 1);
    const roleReviews = question.reviews.filter((review) => normalizeRoleName(review.reviewerRole) === role);
    const approvedReviewerIds = [...new Set(
      roleReviews.filter((review) => review.status === "approved").map((review) => review.reviewerId),
    )];
    const rejectedReviewerIds = [...new Set(
      roleReviews.filter((review) => review.status === "rejected").map((review) => review.reviewerId),
    )];
    const approvedCount = Math.min(requiredCount, approvedReviewerIds.length);
    const satisfied = approvedCount >= requiredCount;
    return {
      role,
      requiredCount,
      approvedCount,
      rejectedCount: rejectedReviewerIds.length,
      remainingCount: Math.max(0, requiredCount - approvedCount),
      status: satisfied ? "satisfied" : rejectedReviewerIds.length > 0 ? "rejected" : "pending",
      reviewerIds: [...new Set(roleReviews.map((review) => review.reviewerId))],
    };
  });
  return {
    requirements,
    satisfied: requirements.every((requirement) => requirement.status === "satisfied"),
    overridden: Boolean(question.approvalOverride),
  };
}

function hasRequiredQuestionReviews(principal: Principal, question: Question): boolean {
  if (question.risk !== "protected") return true;
  return questionApprovalStatus(question).requirements.every((requirement) => {
    if (requirement.status === "rejected" && requirement.approvedCount < requirement.requiredCount) return false;
    const principalCountsAsApproval = principalHasRole(principal, requirement.role, question.projectId) &&
      !requirement.reviewerIds.includes(principal.id);
    return requirement.approvedCount + (principalCountsAsApproval ? 1 : 0) >= requirement.requiredCount;
  });
}

export function canAcceptQuestion(principal: Principal, question: Question): boolean {
  if (
    principal.type !== "human" ||
    !["open", "in_discussion"].includes(question.status) ||
    !hasQuestionOwnerMatch(principal, question)
  ) return false;
  return question.risk !== "protected" || hasRequiredQuestionReviews(principal, question);
}

export function canRequestQuestionClarification(principal: Principal, question: Question): boolean {
  if (principal.type !== "human" || question.status !== "open") return false;
  return principalHasRole(principal, "project-admin", question.projectId) || hasQuestionOwnerMatch(principal, question);
}

export function canReopenQuestion(principal: Principal, question: Question): boolean {
  if (principal.type !== "human" || !["cancelled", "expired"].includes(question.status)) return false;
  return principalHasRole(principal, "project-admin", question.projectId) || hasQuestionOwnerMatch(principal, question);
}

export function editableQuestionResponseIds(principal: Principal, question: Question): readonly string[] {
  if (principal.type !== "human" || !["open", "in_discussion"].includes(question.status)) return [];
  return question.responses
    .filter((response) => response.authorType === "human" && response.authorId === principal.id)
    .map((response) => response.id);
}

export function editableQuestionCommentIds(principal: Principal, question: Question): readonly string[] {
  if (principal.type !== "human" || !["open", "in_discussion"].includes(question.status)) return [];
  return question.comments
    .filter((comment) => comment.authorType === "human" && comment.authorId === principal.id)
    .map((comment) => comment.id);
}

export function questionReviewRoles(
  principal: Principal,
  question: Question,
): readonly string[] {
  if (principal.type !== "human" || !["open", "in_discussion"].includes(question.status)) return [];
  return requiredQuestionReviewerRoles(question).filter((role) =>
    principalHasRole(principal, role, question.projectId) &&
    !question.reviews.some((review) =>
      review.reviewerId === principal.id && normalizeRoleName(review.reviewerRole) === normalizeRoleName(role)));
}

export function questionDueStatus(question: Question, now: Date): QuestionDueStatus {
  if (!question.dueAt) return "none";
  const dueAt = Date.parse(question.dueAt);
  if (!Number.isFinite(dueAt)) return "none";
  if (dueAt < now.getTime()) return "overdue";
  if (dueAt <= now.getTime() + 7 * 24 * 60 * 60 * 1_000) return "due_soon";
  return "scheduled";
}

export function questionInboxItem(
  principal: Principal,
  question: Question,
  now: Date,
): QuestionInboxItem {
  const approvalStatus = questionApprovalStatus(question);
  return {
    ...question,
    inboxReasons: questionInboxReasons(principal, question),
    canAccept: canAcceptQuestion(principal, question),
    reviewRoles: questionReviewRoles(principal, question),
    canReassign: principal.type === "human" &&
      ["open", "in_discussion"].includes(question.status) &&
      principalHasRole(principal, "project-admin", question.projectId),
    canOverrideApproval: principal.type === "human" &&
      ["open", "in_discussion"].includes(question.status) &&
      question.risk === "protected" &&
      principalHasRole(principal, "project-admin", question.projectId) &&
      !canAcceptQuestion(principal, question),
    canRequestClarification: canRequestQuestionClarification(principal, question),
    canReopen: canReopenQuestion(principal, question),
    editableResponseIds: editableQuestionResponseIds(principal, question),
    editableCommentIds: editableQuestionCommentIds(principal, question),
    approvalStatus,
    dueStatus: questionDueStatus(question, now),
  };
}

export function questionInboxReasons(
  principal: Principal,
  question: Question,
): readonly QuestionInboxReason[] {
  if (principal.type !== "human" || !["open", "in_discussion"].includes(question.status)) return [];
  const reasons: QuestionInboxReason[] = [];
  if (question.ownerIds.includes(principal.id)) reasons.push("direct_owner");
  if (question.ownerRoles.some((role) => principalHasRole(principal, role, question.projectId))) reasons.push("role_owner");
  if ((question.reviewerIds ?? []).includes(principal.id)) reasons.push("direct_reviewer");
  if ((question.reviewerRoles ?? []).some((role) => principalHasRole(principal, role, question.projectId))) {
    reasons.push("role_reviewer");
  }
  if (principalHasRole(principal, "project-admin", question.projectId)) reasons.push("project_admin");
  if (question.risk === "protected" && requiredQuestionReviewerRoles(question).some((role) =>
    principalHasRole(principal, role, question.projectId))) {
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
    !hasRequiredQuestionReviews(principal, question)
  ) {
    throw new BridgeError(
      "POLICY_BLOCKED",
      "Protected decisions require every policy-specified human review role.",
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
