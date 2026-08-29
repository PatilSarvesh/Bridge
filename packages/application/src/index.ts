import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type {
  AcceptAnswerInput,
  AuditExportInput,
  AuditListQuery,
  ApproveArtifactVersionInput,
  ArtifactDiffLine,
  ArtifactReviewInput,
  ArtifactVersionDiff,
  ArtifactVersionDiffQuery,
  ChangeDecisionLifecycleInput,
  ContextQuery,
  CreateOrganizationMemberInput,
  CreateDirectoryGroupInput,
  CreateServiceIdentityInput,
  DecisionListQuery,
  DecisionConflictQuery,
  DecisionImpactQuery,
  CreateQuestionInput,
  EditQuestionCommentInput,
  EditQuestionResponseInput,
  FindQuestionMatchesInput,
  LinkRepositoryInput,
  GithubPullRequestListQuery,
  GithubPullRequestContextQuery,
  GithubIssueContextQuery,
  GithubIssueListQuery,
  SyncGithubIssueInput,
  SyncGithubPullRequestInput,
  PublishArtifactInput,
  ProposeAnswerInput,
  QuestionCommentInput,
  QuestionClarificationInput,
  RecordAssumptionInput,
  RegisterProjectInput,
  ReportAgentRunInput,
  ResolveAssumptionInput,
  Scope,
  StartAgentRunInput,
  UpdateOrganizationMemberInput,
  SyncDirectoryGroupInput,
  RevokeServiceIdentityInput,
  RotateServiceIdentityInput,
  NotificationListQuery,
  NotificationPreferenceInput,
  NotificationReadAllInput,
  OutboxOperationsQuery,
  ProjectAnalyticsQuery,
  ProjectDataExportInput,
  ProjectMembershipConfiguration,
  QuestionReviewInput,
  OverrideQuestionApprovalInput,
  ReassignQuestionInput,
  QuestionInboxQuery,
  QuestionAudienceViewQuery,
  QuestionDecisionDigestQuery,
  QuestionSubmissionDisposition,
  ReplayOutboxEventInput,
  RecordAdapterDiagnosticInput,
  ReplaceProjectOwnershipInput,
  ReplaceProjectPolicyInput,
  PolicyAction,
  Risk,
} from "@bridge/contracts";
import {
  assertCanApproveArtifact,
  assertCanReviewArtifact,
  assertCanAccept,
  artifactApprovalStatus,
  assertHuman,
  assertProjectAccess,
  canAcceptQuestion,
  canReopenQuestion,
  canRequestQuestionClarification,
  questionInboxItem,
  BridgeError,
  normalizeRoleName,
  principalHasRole,
  reviewDateFor,
  type AgentRun,
  type AdapterDiagnostic,
  type Assumption,
  type AuditEvent,
  type Artifact,
  type ArtifactReview,
  type ArtifactVersion,
  type BridgeErrorCode,
  type ContextItem,
  type ContextTrustLevel,
  type ContextSnapshot,
  type Decision,
  type DirectoryGroup,
  type DirectoryGroupMember,
  type GithubPullRequestContext,
  type GithubIssueWorkItem,
  type Principal,
  type Project,
  type Question,
  type QuestionAssignmentHistoryEntry,
  type QuestionComment,
  type QuestionCommentRevision,
  type QuestionApprovalOverride,
  type QuestionInboxItem,
  type QuestionReview,
  type QuestionRouteSource,
  type QuestionRoutingExplanation,
  type QuestionResponse,
  type QuestionResponseRevision,
  type QuestionLink,
  type Notification,
  type NotificationPreference,
  type NotificationQuestionContext,
  type Organization,
  type OrganizationAuditEvent,
  type OrganizationMembership,
  type OutboxDelivery,
  type OutboxEvent,
  type PrincipalIdentity,
  type ProjectMembership,
  type ProjectOwnershipConfiguration,
  type ProjectOwnershipRule,
  type ProjectPolicyConfiguration,
  type ProjectPolicyRule,
  type ProjectRoleDefinition,
  type ProjectTeam,
  type RepositoryRecord,
  type ServiceCredential,
  type ServiceTokenResolution,
} from "@bridge/domain";
import {
  type BridgeSecretContentType,
  type BridgeIdempotencyOperation,
  type BridgeIdempotencyOutcome,
  type BridgeMetrics,
  createCorrelationId,
  currentCorrelationContext,
  currentCorrelationId,
  runWithCorrelationContextIfAbsent,
} from "@bridge/observability";

import { detectSecret } from "./content-security.js";

export interface RepositoryTransactionContext {
  readonly organizationId?: string;
  readonly maintenance?: boolean;
}

export interface BridgeRepository {
  checkHealth(): Promise<{ readonly backend: string }>;
  transaction<T>(
    work: (repository: BridgeRepository) => Promise<T>,
    context?: RepositoryTransactionContext,
  ): Promise<T>;
  getOrganizationByExternalId(externalIdentityProviderId: string): Promise<Organization | undefined>;
  listOrganizations(): Promise<readonly Organization[]>;
  saveOrganization(organization: Organization): Promise<void>;
  getPrincipalIdentityByOidc(issuer: string, subject: string): Promise<PrincipalIdentity | undefined>;
  getPrincipalIdentity(principalId: string): Promise<PrincipalIdentity | undefined>;
  savePrincipalIdentity(identity: PrincipalIdentity): Promise<void>;
  getServiceCredential(serviceCredentialId: string): Promise<ServiceCredential | undefined>;
  getServiceCredentialByTokenHash(tokenHash: string): Promise<ServiceCredential | undefined>;
  listServiceCredentials(organizationId: string): Promise<readonly ServiceCredential[]>;
  saveServiceCredential(credential: ServiceCredential): Promise<void>;
  revokeServiceCredential(
    credential: ServiceCredential,
    expectedVersion?: number,
  ): Promise<boolean>;
  rotateServiceCredential(
    credential: ServiceCredential,
    expectedVersion?: number,
  ): Promise<boolean>;
  getOrganizationMembership(
    organizationId: string,
    principalId: string,
  ): Promise<OrganizationMembership | undefined>;
  listOrganizationMemberships(organizationId: string): Promise<readonly OrganizationMembership[]>;
  saveOrganizationMembership(
    membership: OrganizationMembership,
    expectedVersion?: number,
  ): Promise<boolean>;
  getDirectoryGroup(groupId: string): Promise<DirectoryGroup | undefined>;
  listDirectoryGroups(organizationId: string): Promise<readonly DirectoryGroup[]>;
  saveDirectoryGroup(group: DirectoryGroup, expectedVersion?: number): Promise<boolean>;
  listDirectoryGroupMembers(groupId: string): Promise<readonly DirectoryGroupMember[]>;
  listDirectoryGroupMembersForPrincipal(
    organizationId: string,
    principalId: string,
  ): Promise<readonly DirectoryGroupMember[]>;
  saveDirectoryGroupMember(member: DirectoryGroupMember, expectedVersion?: number): Promise<boolean>;
  listProjectMemberships(
    organizationId: string,
    principalId: string,
  ): Promise<readonly ProjectMembership[]>;
  saveProjectMembership(membership: ProjectMembership, expectedVersion?: number): Promise<boolean>;
  resolveOidcPrincipal(identity: {
    readonly issuer: string;
    readonly subject: string;
    readonly organizationExternalId: string;
  }): Promise<Principal | undefined>;
  resolveServiceToken(tokenHash: string): Promise<ServiceTokenResolution | undefined>;
  listOrganizationPrincipals(organizationId: string): Promise<readonly Principal[]>;
  getProject(projectId: string): Promise<Project | undefined>;
  listProjects(organizationId: string): Promise<readonly Project[]>;
  saveProject(project: Project): Promise<void>;
  getRepositoryRecord(repositoryId: string): Promise<RepositoryRecord | undefined>;
  listProjectRepositories(projectId: string): Promise<readonly RepositoryRecord[]>;
  saveRepositoryRecord(repository: RepositoryRecord): Promise<void>;
  getGithubPullRequest(pullRequestId: string): Promise<GithubPullRequestContext | undefined>;
  listGithubPullRequests(projectId: string): Promise<readonly GithubPullRequestContext[]>;
  saveGithubPullRequest(
    pullRequest: GithubPullRequestContext,
    expectedVersion?: number,
  ): Promise<boolean>;
  getGithubIssue(issueId: string): Promise<GithubIssueWorkItem | undefined>;
  listGithubIssues(projectId: string): Promise<readonly GithubIssueWorkItem[]>;
  saveGithubIssue(issue: GithubIssueWorkItem, expectedVersion?: number): Promise<boolean>;
  getProjectOwnershipConfiguration(projectId: string): Promise<ProjectOwnershipConfiguration | undefined>;
  saveProjectOwnershipConfiguration(
    configuration: ProjectOwnershipConfiguration,
    expectedVersion: number,
  ): Promise<boolean>;
  getProjectPolicyConfiguration(projectId: string): Promise<ProjectPolicyConfiguration | undefined>;
  saveProjectPolicyConfiguration(
    configuration: ProjectPolicyConfiguration,
    expectedVersion: number,
  ): Promise<boolean>;
  getRun(runId: string): Promise<AgentRun | undefined>;
  listRuns(projectId: string): Promise<readonly AgentRun[]>;
  saveRun(run: AgentRun): Promise<void>;
  listAdapterDiagnostics(projectId: string): Promise<readonly AdapterDiagnostic[]>;
  saveAdapterDiagnostic(diagnostic: AdapterDiagnostic): Promise<void>;
  findIdempotentRun(key: string): Promise<AgentRun | undefined>;
  getIdempotentRunRequestHash(key: string): Promise<string | undefined>;
  saveIdempotentRun(key: string, runId: string, requestHash: string): Promise<void>;
  getRunContinuationKey(runId: string): Promise<string | undefined>;
  getRunVendorSessionId(runId: string): Promise<string | undefined>;
  saveRunContinuationKey(
    runId: string,
    resumeContextKey: string,
    vendorSessionId?: string,
  ): Promise<void>;
  getAssumption(assumptionId: string): Promise<Assumption | undefined>;
  listAssumptions(projectId: string): Promise<readonly Assumption[]>;
  saveAssumption(assumption: Assumption): Promise<void>;
  findIdempotentAssumption(key: string): Promise<Assumption | undefined>;
  getIdempotentAssumptionRequestHash(key: string): Promise<string | undefined>;
  saveIdempotentAssumption(key: string, assumptionId: string, requestHash: string): Promise<void>;
  getQuestion(questionId: string): Promise<Question | undefined>;
  listQuestions(projectId: string): Promise<readonly Question[]>;
  searchQuestionMatchCandidates(
    projectId: string,
    query: QuestionMatchCandidateQuery,
  ): Promise<readonly Question[]>;
  saveQuestion(question: Question): Promise<void>;
  findIdempotentQuestion(key: string): Promise<Question | undefined>;
  saveIdempotentQuestion(key: string, questionId: string, requestHash: string): Promise<void>;
  getIdempotentRequestHash(key: string): Promise<string | undefined>;
  getDecision(decisionId: string): Promise<Decision | undefined>;
  listDecisions(projectId: string): Promise<readonly Decision[]>;
  searchDecisions(projectId: string, search: string): Promise<readonly Decision[]>;
  saveDecision(decision: Decision): Promise<void>;
  getArtifact(artifactId: string): Promise<Artifact | undefined>;
  getArtifactByVersionId(versionId: string): Promise<Artifact | undefined>;
  listArtifacts(projectId: string): Promise<readonly Artifact[]>;
  saveArtifact(artifact: Artifact): Promise<void>;
  getIdempotentArtifactVersionId(key: string): Promise<string | undefined>;
  getIdempotentArtifactRequestHash(key: string): Promise<string | undefined>;
  saveIdempotentArtifactVersion(
    key: string,
    versionId: string,
    requestHash: string,
  ): Promise<void>;
  saveContextSnapshot(snapshot: ContextSnapshot): Promise<void>;
  listContextSnapshots(projectId: string): Promise<readonly ContextSnapshot[]>;
  saveAuditEvent(event: AuditEvent): Promise<void>;
  listAuditEvents(projectId: string): Promise<readonly AuditEvent[]>;
  saveOrganizationAuditEvent(event: OrganizationAuditEvent): Promise<void>;
  listOrganizationAuditEvents(organizationId: string): Promise<readonly OrganizationAuditEvent[]>;
  getNotification(notificationId: string): Promise<Notification | undefined>;
  listNotifications(
    organizationId: string,
    recipientId: string,
    projectId?: string,
    unreadOnly?: boolean,
  ): Promise<readonly Notification[]>;
  saveNotification(notification: Notification): Promise<void>;
  getNotificationPreference(
    organizationId: string,
    principalId: string,
    channel: NotificationPreference["channel"],
  ): Promise<NotificationPreference | undefined>;
  listNotificationPreferences(
    organizationId: string,
    principalId: string,
  ): Promise<readonly NotificationPreference[]>;
  saveNotificationPreference(preference: NotificationPreference): Promise<void>;
  listOutboxEvents(projectId?: string): Promise<readonly OutboxEvent[]>;
  getOutboxEvent(eventId: string): Promise<OutboxEvent | undefined>;
  saveOutboxEvent(event: OutboxEvent): Promise<void>;
  listOutboxDeliveries(projectId: string): Promise<readonly OutboxDelivery[]>;
  getOutboxDelivery(eventId: string, channel: OutboxDelivery["channel"]): Promise<OutboxDelivery | undefined>;
  saveOutboxDelivery(delivery: OutboxDelivery): Promise<void>;
  claimOutboxEvents(now: string, limit: number): Promise<readonly OutboxEvent[]>;
  completeOutboxEvent(eventId: string, processedAt: string): Promise<void>;
  failOutboxEvent(
    eventId: string,
    lastError: string,
    availableAt: string,
    deadLetter: boolean,
  ): Promise<void>;
}

interface IdempotencyRecord {
  readonly questionId: string;
  readonly requestHash: string;
}

interface ArtifactIdempotencyRecord {
  readonly versionId: string;
  readonly requestHash: string;
}

interface RunIdempotencyRecord {
  readonly runId: string;
  readonly requestHash: string;
}

interface AssumptionIdempotencyRecord {
  readonly assumptionId: string;
  readonly requestHash: string;
}

export interface ArtifactPublication {
  readonly artifact: Artifact;
  readonly version: ArtifactVersion;
}

export interface ArtifactReviewResult extends ArtifactPublication {
  readonly review: ArtifactReview;
}

export interface RunRegistration {
  readonly run: AgentRun;
  readonly resumeContextKey: string;
}

export interface ProjectRegistration {
  readonly project: Project;
  readonly disposition: "created" | "idempotent_replay";
}

export interface RepositoryRegistration {
  readonly repository: RepositoryRecord;
  readonly disposition: "created" | "idempotent_replay";
}

export interface GithubPullRequestRegistration {
  readonly pullRequest: GithubPullRequestContext;
  readonly disposition: "created" | "updated" | "idempotent_replay";
}

export interface GithubPullRequestContextView {
  readonly pullRequest: GithubPullRequestContext;
  readonly trustLevel: ContextTrustLevel;
  readonly decisions: readonly (Pick<Decision, "id" | "answer" | "category" | "status" | "scope"> & {
    readonly trustLevel: ContextTrustLevel;
  })[];
  readonly artifactVersions: readonly {
    readonly artifactId: string;
    readonly artifactTitle: string;
    readonly artifactType: Artifact["type"];
    readonly versionId: string;
    readonly version: number;
    readonly status: ArtifactVersion["status"];
    readonly summary: string;
    readonly trustLevel: ContextTrustLevel;
  }[];
  readonly humanApprovalChanged: false;
}

export interface GithubIssueRegistration {
  readonly issue: GithubIssueWorkItem;
  readonly disposition: "created" | "updated" | "idempotent_replay";
}

export interface GithubIssueContextView {
  readonly issue: GithubIssueWorkItem;
  readonly trustLevel: ContextTrustLevel;
  readonly decisions: GithubPullRequestContextView["decisions"];
  readonly artifactVersions: GithubPullRequestContextView["artifactVersions"];
  readonly humanApprovalChanged: false;
}

export interface OrganizationMember {
  readonly id: string;
  readonly displayName: string;
  readonly oidcSubject: string;
  readonly status: OrganizationMembership["status"];
  readonly roles: readonly string[];
  readonly allProjects: boolean;
  readonly provisioning: OrganizationMembership["provisioning"];
  readonly projectMemberships: readonly ProjectMembership[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface DirectoryGroupView {
  readonly group: DirectoryGroup;
  readonly members: readonly DirectoryGroupMember[];
}

export interface DirectoryGroupRegistration extends DirectoryGroupView {
  readonly disposition: "created" | "idempotent_replay";
}

export interface DirectoryGroupSyncResult extends DirectoryGroupView {
  readonly disposition: "updated" | "idempotent_replay";
  readonly membershipChanges: {
    readonly provisioned: number;
    readonly reactivated: number;
    readonly disabled: number;
    readonly preserved: number;
  };
  readonly humanApprovalChanged: false;
}

export interface OrganizationMemberRegistration {
  readonly member: OrganizationMember;
  readonly disposition: "created" | "idempotent_replay";
}

export interface ServiceIdentity {
  readonly id: string;
  readonly principalId: string;
  readonly name: string;
  readonly type: Principal["type"];
  readonly scopes: readonly string[];
  readonly roles: readonly string[];
  readonly allProjects: boolean;
  readonly projectMemberships: readonly ProjectMembership[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly rotatedAt?: string;
  readonly revokedAt?: string;
  readonly version: number;
}

export interface ServiceIdentityRegistration {
  readonly serviceIdentity: ServiceIdentity;
  readonly token: string;
}

export interface ContinuationDescriptor {
  readonly run: AgentRun;
  readonly blockingQuestions: readonly Question[];
  readonly acceptedDecisionIds: readonly string[];
  readonly remainingQuestionIds: readonly string[];
  readonly canContinue: boolean;
  readonly continueInstruction: string;
}

export interface DecisionLifecycleImpact {
  readonly artifactIds: readonly string[];
  readonly artifactVersionIds: readonly string[];
  readonly assumptionIds: readonly string[];
  readonly questionIds: readonly string[];
  readonly contextSnapshotIds: readonly string[];
  readonly runIds: readonly string[];
  readonly workItems: readonly string[];
  readonly branches: readonly string[];
  readonly repositories: readonly string[];
  readonly links: readonly DecisionImpactLink[];
  readonly nodes: readonly DecisionImpactNode[];
  readonly edges: readonly DecisionImpactEdge[];
  readonly maxDepthReached: number;
  readonly truncated: boolean;
}

export type DecisionImpactNodeType =
  | "decision"
  | "question"
  | "artifact"
  | "artifact_version"
  | "assumption"
  | "context_snapshot"
  | "run";

export interface DecisionImpactNode {
  readonly id: string;
  readonly type: DecisionImpactNodeType;
  readonly label: string;
  readonly depth: number;
  readonly path: readonly string[];
  readonly scope?: Scope;
  readonly status?: string;
}

export interface DecisionImpactEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly relation:
    | "source_question"
    | "cited_by_artifact"
    | "contains_citing_version"
    | "confirmed_assumption"
    | "consumed_in_context"
    | "context_used_by_run"
    | "created_in_run"
    | "continued_by_run"
    | "produced_question"
    | "produced_assumption"
    | "produced_artifact_version";
}

export interface DecisionImpactLink {
  readonly sourceId: string;
  readonly type: QuestionLink["type"] | "run_external" | "run_result";
  readonly url: string;
  readonly depth: number;
}

export interface DecisionLifecycleChange {
  readonly decision: Decision;
  readonly impact: DecisionLifecycleImpact;
}

export interface DecisionConflict {
  readonly id: string;
  readonly category: string;
  readonly confidence: "high" | "medium";
  readonly scopeRelation: "exact" | "ancestor_descendant" | "partial";
  readonly overlappingFields: readonly (keyof Scope)[];
  readonly signals: readonly ("different answers in exact scope" | "opposing language")[];
  readonly left: Pick<Decision, "id" | "answer" | "rationale" | "scope" | "ownerId" | "createdAt" | "version">;
  readonly right: Pick<Decision, "id" | "answer" | "rationale" | "scope" | "ownerId" | "createdAt" | "version">;
  readonly advisory: true;
  readonly humanResolutionRequired: true;
}

export interface AssumptionExpiryCycleResult {
  readonly expiredCount: number;
}

export interface BlockingQuestionEscalationCycleResult {
  readonly escalatedCount: number;
}

export interface OutboxOperationsMetrics {
  readonly total: number;
  readonly statusCounts: Readonly<Record<OutboxEvent["status"], number>>;
  readonly failedCount: number;
  readonly totalAttempts: number;
  readonly readyCount: number;
  readonly expiredLeaseCount: number;
  readonly oldestReadyAt?: string;
  readonly oldestReadyAgeMs?: number;
  readonly deliveryStatusCounts: Readonly<Record<OutboxDelivery["status"], number>>;
}

export interface OutboxOperationsView {
  readonly items: readonly OutboxEvent[];
  readonly deliveries: readonly OutboxDelivery[];
  readonly totalMatching: number;
  readonly metrics: OutboxOperationsMetrics;
}

export interface ProjectSupportView {
  readonly projectId: string;
  readonly generatedAt: string;
  readonly routing: {
    readonly unroutedQuestions: readonly {
      readonly id: string;
      readonly title: string;
      readonly category: string;
      readonly risk: Question["risk"];
      readonly blocking: boolean;
      readonly status: Question["status"];
      readonly ownerIds: readonly string[];
      readonly ownerRoles: readonly string[];
      readonly createdAt: string;
    }[];
  };
  readonly decisions: {
    readonly overdueProtected: readonly {
      readonly id: string;
      readonly questionId: string;
      readonly category: string;
      readonly ownerId: string;
      readonly status: Decision["status"];
      readonly reviewAt: string;
    }[];
  };
  readonly assumptions: {
    readonly expiring: readonly {
      readonly id: string;
      readonly category: string;
      readonly risk: Assumption["risk"];
      readonly confidence: Assumption["confidence"];
      readonly expiresAt: string;
      readonly overdue: boolean;
      readonly createdById: string;
      readonly runId?: string;
    }[];
  };
  readonly runs: {
    readonly blocked: readonly {
      readonly id: string;
      readonly client: AgentRun["client"];
      readonly capability: AgentRun["capability"];
      readonly status: "waiting_for_human";
      readonly remainingBlockingQuestionCount: number;
      readonly startedAt: string;
      readonly updatedAt: string;
    }[];
  };
  readonly delivery: {
    readonly pendingCount: number;
    readonly failedCount: number;
    readonly deadLetterEvents: readonly {
      readonly id: string;
      readonly type: OutboxEvent["type"];
      readonly attempts: number;
      readonly createdAt: string;
      readonly availableAt: string;
      readonly hasError: boolean;
    }[];
  };
  readonly adapters: {
    readonly items: readonly {
      readonly client: AgentRun["client"];
      readonly runCount: number;
      readonly capabilities: readonly AgentRun["capability"][];
      readonly lastObservedAt?: string;
      readonly lastSuccessfulMcpRunAt?: string;
    }[];
    readonly mcpDiagnostics: "observed_from_runs" | "observed_from_doctor" | "not_reported";
    readonly note: string;
  };
  readonly diagnostics: readonly {
    readonly client: AgentRun["client"];
    readonly status: "pass" | "fail";
    readonly capabilities: readonly AgentRun["capability"][];
    readonly mcpStatus: "ready" | "failed" | "not_configured";
    readonly checks: readonly {
      readonly name: string;
      readonly status: "pass" | "fail";
    }[];
    readonly checkCount: number;
    readonly passedCheckCount: number;
    readonly failingCheckNames: readonly string[];
    readonly observedAt: string;
  }[];
}

export interface AuditRecord {
  readonly id: string;
  readonly scope: "organization" | "project";
  readonly correlationId: string;
  readonly organizationId: string;
  readonly projectId?: string;
  readonly actorId: string;
  readonly actorType: Principal["type"];
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly source?: AuditEvent["source"];
  readonly reason?: string;
  readonly policyVersion?: number;
  readonly policyRuleKey?: string;
  readonly assignmentId?: string;
  readonly ownerRouteSource?: QuestionRouteSource;
  readonly reviewerRouteSource?: QuestionRouteSource;
  readonly beforeVersion?: number;
  readonly afterVersion?: number;
  readonly createdAt: string;
}

interface AuditMetadata {
  readonly beforeVersion?: number;
  readonly afterVersion?: number;
  readonly policyRuleKey?: string;
  readonly assignmentId?: string;
  readonly ownerRouteSource?: QuestionRouteSource;
  readonly reviewerRouteSource?: QuestionRouteSource;
}

export interface AuditPage {
  readonly items: readonly AuditRecord[];
  readonly offset: number;
  readonly limit: number;
  readonly totalMatching: number;
  readonly nextOffset?: number;
}

export interface ProjectPolicyView extends ProjectPolicyConfiguration {
  readonly defaultRules: readonly ProjectPolicyRule[];
}

export interface AuditExport {
  readonly filename: string;
  readonly contentType: "application/json; charset=utf-8" | "text/csv; charset=utf-8";
  readonly body: string;
  readonly itemCount: number;
}

export interface ProjectDataExportCount {
  readonly total: number;
  readonly included: number;
  readonly offset: number;
  readonly nextOffset?: number;
}

export interface ProjectDataExport {
  readonly filename: string;
  readonly contentType: "application/json; charset=utf-8";
  readonly body: string;
  readonly counts: {
    readonly decisions: ProjectDataExportCount;
    readonly artifacts: ProjectDataExportCount;
    readonly auditEvents: ProjectDataExportCount;
  };
  readonly humanApprovalChanged: false;
}

export interface ProjectAnalyticsActivity {
  readonly contextRetrievals: number;
  readonly questionSubmissions: number;
  readonly questionsCreated: number;
  readonly questionsReused: number;
  readonly questionsRoutedOnCreation: number;
  readonly responsesProposed: number;
  readonly decisionsAccepted: number;
  readonly decisionReuseOccurrences: number;
  readonly assumptionsRecorded: number;
  readonly assumptionsResolved: number;
  readonly specificationVersionsPublished: number;
  readonly specificationVersionsApproved: number;
}

export interface ProjectAnalyticsOutcomes {
  readonly runsWithContextRate: number;
  readonly questionReuseRate: number;
  readonly firstAssignmentRoutingRate: number;
  readonly decisionAcceptanceRate: number;
  readonly acceptedDecisionReuseCount: number;
  readonly assumptionResolutionRate: number;
  readonly assumptionStatusCounts: Readonly<Record<Assumption["status"], number>>;
  readonly specificationApprovalRate: number;
  readonly medianQuestionResolutionMs?: number;
  readonly medianSpecificationApprovalMs?: number;
}

export interface ProjectAnalyticsGuardrails {
  readonly questionsPerRun: number;
  readonly blockingQuestions: number;
  readonly unroutedBlockingQuestions: number;
  readonly contextItemsReturned: number;
  readonly contextItemsPerRetrieval: number;
}

export interface ProjectAnalyticsClientBreakdown {
  readonly client: AgentRun["client"];
  readonly runCount: number;
  readonly contextRetrievals: number;
  readonly questionSubmissions: number;
  readonly questionsReused: number;
  readonly decisionsAccepted: number;
  readonly decisionReuseOccurrences: number;
  readonly assumptionsRecorded: number;
}

export interface ProjectAnalyticsView {
  readonly projectId: string;
  readonly generatedAt: string;
  readonly cohort: {
    readonly runCount: number;
    readonly client?: AgentRun["client"];
    readonly startedFrom?: string;
    readonly startedTo?: string;
  };
  readonly activity: ProjectAnalyticsActivity;
  readonly outcomes: ProjectAnalyticsOutcomes;
  readonly guardrails: ProjectAnalyticsGuardrails;
  readonly byClient: readonly ProjectAnalyticsClientBreakdown[];
  readonly privacy: {
    readonly derivedFrom: readonly string[];
    readonly excluded: readonly string[];
  };
}

interface AnalyticsSource {
  readonly snapshots: readonly ContextSnapshot[];
  readonly questions: readonly Question[];
  readonly decisions: readonly Decision[];
  readonly assumptions: readonly Assumption[];
  readonly artifacts: readonly Artifact[];
}

interface AnalyticsCohort {
  readonly activity: ProjectAnalyticsActivity;
  readonly outcomes: ProjectAnalyticsOutcomes;
  readonly guardrails: ProjectAnalyticsGuardrails;
}

function analyticsRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function medianDuration(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle];
}

function calculateAnalyticsCohort(
  runs: readonly AgentRun[],
  source: AnalyticsSource,
): AnalyticsCohort {
  const runIds = new Set(runs.map((run) => run.id));
  const questionsById = new Map(source.questions.map((question) => [question.id, question]));
  const decisionsById = new Map(source.decisions.map((decision) => [decision.id, decision]));
  const questionPairs: Array<{ readonly run: AgentRun; readonly question: Question }> = [];
  for (const run of runs) {
    for (const questionId of run.questionIds) {
      const question = questionsById.get(questionId);
      if (question) questionPairs.push({ run, question });
    }
  }
  const createdQuestions = [...new Map(
    questionPairs
      .filter(({ run, question }) => question.runId === run.id)
      .map(({ question }) => [question.id, question]),
  ).values()];
  const reusedQuestionPairs = questionPairs.filter(({ run, question }) => question.runId !== run.id);
  const snapshots = source.snapshots.filter((snapshot) => snapshot.runId && runIds.has(snapshot.runId));
  const assumptions = source.assumptions.filter((assumption) => assumption.runId && runIds.has(assumption.runId));
  const versions = source.artifacts.flatMap((artifact) =>
    artifact.versions.filter((version) => version.runId && runIds.has(version.runId)),
  );
  const approvedVersions = versions.filter((version) => version.approvedAt !== undefined);
  const routedQuestions = createdQuestions.filter(
    (question) => question.ownerIds.length > 0 || question.ownerRoles.length > 0,
  );
  const acceptedQuestions = createdQuestions.filter(
    (question) => question.decisionId && decisionsById.has(question.decisionId),
  );
  const reusedDecisionIds = new Set<string>();
  let decisionReuseOccurrences = 0;
  for (const snapshot of snapshots) {
    for (const itemId of snapshot.itemIds) {
      const decision = decisionsById.get(itemId);
      if (!decision || !decision.questionId || Date.parse(decision.createdAt) > Date.parse(snapshot.createdAt)) continue;
      const originQuestion = questionsById.get(decision.questionId);
      if (originQuestion?.runId === snapshot.runId) continue;
      reusedDecisionIds.add(decision.id);
      decisionReuseOccurrences += 1;
    }
  }
  const assumptionStatusCounts: Record<Assumption["status"], number> = {
    active: 0,
    confirmed: 0,
    rejected: 0,
    expired: 0,
    superseded: 0,
  };
  for (const assumption of assumptions) assumptionStatusCounts[assumption.status] += 1;
  const resolvedAssumptions = assumptions.filter((assumption) => assumption.status !== "active");
  const questionResolutionDurations = acceptedQuestions.flatMap((question) => {
    const decision = question.decisionId ? decisionsById.get(question.decisionId) : undefined;
    if (!decision) return [];
    return [Math.max(0, Date.parse(decision.createdAt) - Date.parse(question.createdAt))];
  });
  const approvalDurations = approvedVersions.flatMap((version) => version.approvedAt
    ? [Math.max(0, Date.parse(version.approvedAt) - Date.parse(version.createdAt))]
    : []);
  const medianQuestionResolutionMs = medianDuration(questionResolutionDurations);
  const medianSpecificationApprovalMs = medianDuration(approvalDurations);
  const blockingQuestions = createdQuestions.filter((question) => question.blocking);
  const unroutedBlockingQuestions = blockingQuestions.filter(
    (question) => question.ownerIds.length === 0 && question.ownerRoles.length === 0,
  );
  const contextItemsReturned = snapshots.reduce((total, snapshot) => total + snapshot.itemIds.length, 0);
  const activity: ProjectAnalyticsActivity = {
    contextRetrievals: snapshots.length,
    questionSubmissions: questionPairs.length,
    questionsCreated: createdQuestions.length,
    questionsReused: reusedQuestionPairs.length,
    questionsRoutedOnCreation: routedQuestions.length,
    responsesProposed: createdQuestions.reduce((total, question) => total + question.responses.length, 0),
    decisionsAccepted: acceptedQuestions.length,
    decisionReuseOccurrences,
    assumptionsRecorded: assumptions.length,
    assumptionsResolved: resolvedAssumptions.length,
    specificationVersionsPublished: versions.length,
    specificationVersionsApproved: approvedVersions.length,
  };
  return {
    activity,
    outcomes: {
      runsWithContextRate: analyticsRate(
        runs.filter((run) => run.contextSnapshotIds.length > 0).length,
        runs.length,
      ),
      questionReuseRate: analyticsRate(activity.questionsReused, activity.questionSubmissions),
      firstAssignmentRoutingRate: analyticsRate(activity.questionsRoutedOnCreation, activity.questionsCreated),
      decisionAcceptanceRate: analyticsRate(activity.decisionsAccepted, activity.questionsCreated),
      acceptedDecisionReuseCount: reusedDecisionIds.size,
      assumptionResolutionRate: analyticsRate(activity.assumptionsResolved, activity.assumptionsRecorded),
      assumptionStatusCounts,
      specificationApprovalRate: analyticsRate(
        activity.specificationVersionsApproved,
        activity.specificationVersionsPublished,
      ),
      ...(medianQuestionResolutionMs !== undefined
        ? { medianQuestionResolutionMs }
        : {}),
      ...(medianSpecificationApprovalMs !== undefined
        ? { medianSpecificationApprovalMs }
        : {}),
    },
    guardrails: {
      questionsPerRun: analyticsRate(activity.questionSubmissions, runs.length),
      blockingQuestions: blockingQuestions.length,
      unroutedBlockingQuestions: unroutedBlockingQuestions.length,
      contextItemsReturned,
      contextItemsPerRetrieval: analyticsRate(contextItemsReturned, activity.contextRetrievals),
    },
  };
}

export interface QuestionMatch {
  readonly questionId: string;
  readonly title: string;
  readonly category: string;
  readonly status: Question["status"];
  readonly decisionId?: string;
  readonly scope: Scope;
  readonly score: number;
  readonly matchKind: "exact" | "related";
  readonly reasons: readonly string[];
  readonly createdAt: string;
}

export interface QuestionMatchCandidateQuery {
  readonly title: string;
  readonly context: string;
}

export interface QuestionAudienceView {
  readonly questionId: string;
  readonly questionVersion: number;
  readonly role: string;
  readonly mode: QuestionAudienceViewQuery["mode"];
  readonly source: {
    readonly title: string;
    readonly context: string;
    readonly whyItMatters: string;
    readonly options: Question["options"];
    readonly recommendationKey?: string;
  };
  readonly presentation: {
    readonly title: string;
    readonly context: string;
    readonly whyItMatters: string;
    readonly focusAreas: readonly string[];
    readonly reviewPrompt: string;
  };
  readonly guardrails: {
    readonly derivedOnly: true;
    readonly sourceFieldsUnchanged: true;
    readonly humanApprovalRequired: true;
  };
}

export interface QuestionDecisionDigest {
  readonly id: string;
  readonly category: string;
  readonly scope: Scope;
  readonly questionCount: number;
  readonly remainingQuestionCount: number;
  readonly earliestDueAt?: string;
  readonly groupingReasons: readonly ["low risk and non-blocking", "same category", "same exact scope"];
  readonly questions: readonly {
    readonly id: string;
    readonly title: string;
    readonly whyItMatters: string;
    readonly status: Question["status"];
    readonly dueAt?: string;
    readonly dueStatus: QuestionInboxItem["dueStatus"];
    readonly canAccept: boolean;
  }[];
  readonly humanApprovalRequired: true;
  readonly batchAcceptanceAvailable: false;
}

interface NotificationDraft {
  readonly type: Notification["type"];
  readonly title: string;
  readonly body: string;
  readonly targetType: Notification["targetType"];
  readonly targetId: string;
  readonly recipientRoles?: readonly string[];
  readonly questionContext?: NotificationQuestionContext;
}

interface PolicyEvaluationInput {
  readonly operation: "assumption" | "question";
  readonly category: string;
  readonly scope: Scope;
  readonly declaredRisk: Risk;
  readonly reversible: boolean;
  readonly blocking: boolean;
}

interface PolicyEvaluation {
  readonly action: PolicyAction;
  readonly risk: Risk;
  readonly policyVersion: number;
  readonly policyRuleKey: string;
  readonly requiredOwnerRoles: readonly string[];
  readonly requiredReviewerRoles: readonly string[];
  readonly requiredReviewerQuorum: Readonly<Record<string, number>>;
}

interface RoutingResolution {
  readonly ownerIds: readonly string[];
  readonly ownerRoles: readonly string[];
  readonly reviewerIds: readonly string[];
  readonly reviewerRoles: readonly string[];
  readonly explanation: QuestionRoutingExplanation;
}

export type QuestionSubmission = Question & {
  readonly submissionDisposition: QuestionSubmissionDisposition;
};

type RawArtifactDiffLine = Pick<ArtifactDiffLine, "kind" | "text">;

const MAX_EXACT_DIFF_CELLS = 1_000_000;
const MAX_EXACT_DIFF_DIMENSION = 5_000;
const MAX_RENDERED_DIFF_LINES = 2_000;
const SUPPORT_ASSUMPTION_EXPIRY_WINDOW_MS = 7 * 86_400_000;

const policyRule = (
  key: string,
  category: string,
  requiredOwnerRoles: readonly string[],
  requiredReviewerRoles: readonly string[],
): ProjectPolicyRule => ({
  key,
  name: `Bridge protected default: ${category}`,
  priority: 1,
  category,
  scope: {},
  action: "protected_approval",
  minimumRisk: "protected",
  requiredOwnerRoles,
  requiredReviewerRoles,
});

const DEFAULT_PROTECTED_POLICY_RULES: readonly ProjectPolicyRule[] = [
  policyRule("bridge-authentication", "authentication", ["component-owner"], ["security-reviewer"]),
  policyRule("bridge-authorization", "authorization", ["component-owner"], ["security-reviewer"]),
  policyRule("bridge-access-control", "access-control", ["component-owner"], ["security-reviewer"]),
  policyRule("bridge-secret-handling", "secrets", [], ["security-reviewer"]),
  policyRule("bridge-credential-handling", "credentials", [], ["security-reviewer"]),
  policyRule("bridge-key-handling", "keys", [], ["security-reviewer"]),
  policyRule("bridge-security", "security", [], ["security-reviewer"]),
  policyRule("bridge-pii", "pii", ["data-privacy-owner"], ["security-reviewer"]),
  policyRule("bridge-privacy", "privacy", ["data-privacy-owner"], ["security-reviewer"]),
  policyRule("bridge-regulated-data", "regulated-data", ["data-privacy-owner"], ["security-reviewer"]),
  policyRule("bridge-production-deletion", "production-deletion", ["component-owner"], ["operations-sre-reviewer"]),
  policyRule("bridge-destructive-migration", "destructive-migration", ["component-owner"], ["operations-sre-reviewer"]),
  policyRule("bridge-irreversible-schema", "irreversible-schema-migration", ["component-owner"], ["database-architecture-reviewer"]),
  policyRule("bridge-breaking-api", "breaking-api", ["product-owner"], ["architecture-owner"]),
  policyRule("bridge-security-exception", "security-exception", ["security-owner"], []),
  policyRule("bridge-legal", "legal", ["legal-compliance-owner"], []),
  policyRule("bridge-regulatory", "regulatory", ["legal-compliance-owner"], []),
  policyRule("bridge-recurring-spend", "recurring-infrastructure-spend", ["project-owner"], ["finance-operations-approver"]),
];

const RISK_RANK: Readonly<Record<Risk, number>> = { low: 0, medium: 1, high: 2, protected: 3 };
const ACTION_RANK: Readonly<Record<PolicyAction, number>> = {
  assume_and_log: 0,
  ask_async: 1,
  block: 2,
  protected_approval: 3,
};

function splitMarkdownLines(body: string): readonly string[] {
  return body.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

function exactLineDiff(fromLines: readonly string[], toLines: readonly string[]): readonly RawArtifactDiffLine[] {
  const matrix = Array.from(
    { length: fromLines.length + 1 },
    () => new Uint32Array(toLines.length + 1),
  );
  for (let fromIndex = 1; fromIndex <= fromLines.length; fromIndex += 1) {
    for (let toIndex = 1; toIndex <= toLines.length; toIndex += 1) {
      matrix[fromIndex]![toIndex] = fromLines[fromIndex - 1] === toLines[toIndex - 1]
        ? matrix[fromIndex - 1]![toIndex - 1]! + 1
        : Math.max(matrix[fromIndex - 1]![toIndex]!, matrix[fromIndex]![toIndex - 1]!);
    }
  }

  const reversed: RawArtifactDiffLine[] = [];
  let fromIndex = fromLines.length;
  let toIndex = toLines.length;
  while (fromIndex > 0 || toIndex > 0) {
    if (
      fromIndex > 0 &&
      toIndex > 0 &&
      fromLines[fromIndex - 1] === toLines[toIndex - 1]
    ) {
      reversed.push({ kind: "unchanged", text: fromLines[fromIndex - 1]! });
      fromIndex -= 1;
      toIndex -= 1;
    } else if (
      toIndex > 0 &&
      (fromIndex === 0 || matrix[fromIndex]![toIndex - 1]! >= matrix[fromIndex - 1]![toIndex]!)
    ) {
      reversed.push({ kind: "added", text: toLines[toIndex - 1]! });
      toIndex -= 1;
    } else {
      reversed.push({ kind: "removed", text: fromLines[fromIndex - 1]! });
      fromIndex -= 1;
    }
  }
  return reversed.reverse();
}

function buildArtifactVersionDiff(
  artifactId: string,
  fromVersion: ArtifactVersion,
  toVersion: ArtifactVersion,
): ArtifactVersionDiff {
  const fromLines = splitMarkdownLines(fromVersion.body);
  const toLines = splitMarkdownLines(toVersion.body);
  let prefixLength = 0;
  while (
    prefixLength < fromLines.length &&
    prefixLength < toLines.length &&
    fromLines[prefixLength] === toLines[prefixLength]
  ) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < fromLines.length - prefixLength &&
    suffixLength < toLines.length - prefixLength &&
    fromLines[fromLines.length - suffixLength - 1] === toLines[toLines.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const fromMiddle = fromLines.slice(prefixLength, fromLines.length - suffixLength);
  const toMiddle = toLines.slice(prefixLength, toLines.length - suffixLength);
  const exact = fromMiddle.length <= MAX_EXACT_DIFF_DIMENSION &&
    toMiddle.length <= MAX_EXACT_DIFF_DIMENSION &&
    fromMiddle.length * toMiddle.length <= MAX_EXACT_DIFF_CELLS;
  const lines: ArtifactDiffLine[] = [];
  const counts = { unchanged: 0, added: 0, removed: 0 };
  let oldLineNumber = 1;
  let newLineNumber = 1;
  let totalLines = 0;
  const append = (kind: ArtifactDiffLine["kind"], text: string) => {
    const oldNumber = kind === "added" ? undefined : oldLineNumber;
    const newNumber = kind === "removed" ? undefined : newLineNumber;
    counts[kind] += 1;
    totalLines += 1;
    if (lines.length < MAX_RENDERED_DIFF_LINES) {
      lines.push({
        kind,
        text,
        ...(oldNumber === undefined ? {} : { oldLineNumber: oldNumber }),
        ...(newNumber === undefined ? {} : { newLineNumber: newNumber }),
      });
    }
    if (kind !== "added") oldLineNumber += 1;
    if (kind !== "removed") newLineNumber += 1;
  };

  for (let index = 0; index < prefixLength; index += 1) {
    append("unchanged", fromLines[index]!);
  }
  if (exact) {
    for (const line of exactLineDiff(fromMiddle, toMiddle)) append(line.kind, line.text);
  } else {
    for (const line of fromMiddle) append("removed", line);
    for (const line of toMiddle) append("added", line);
  }
  for (let index = suffixLength; index > 0; index -= 1) {
    append("unchanged", fromLines[fromLines.length - index]!);
  }

  const versionMetadata = (version: ArtifactVersion) => ({
    id: version.id,
    version: version.version,
    summary: version.summary,
    status: version.status,
    createdById: version.createdById,
    createdAt: version.createdAt,
    contentSha256: version.contentSha256,
  });
  return {
    artifactId,
    from: versionMetadata(fromVersion),
    to: versionMetadata(toVersion),
    lines,
    counts,
    exact,
    truncated: totalLines > lines.length,
    totalLines,
  };
}

export class InMemoryBridgeRepository implements BridgeRepository {
  private readonly organizations = new Map<string, Organization>();
  private readonly principalIdentities = new Map<string, PrincipalIdentity>();
  private readonly serviceCredentials = new Map<string, ServiceCredential>();
  private readonly organizationMemberships = new Map<string, OrganizationMembership>();
  private readonly directoryGroups = new Map<string, DirectoryGroup>();
  private readonly directoryGroupMembers = new Map<string, DirectoryGroupMember>();
  private readonly projectMemberships = new Map<string, ProjectMembership>();
  private readonly projects = new Map<string, Project>();
  private readonly repositoryRecords = new Map<string, RepositoryRecord>();
  private readonly githubPullRequests = new Map<string, GithubPullRequestContext>();
  private readonly githubIssues = new Map<string, GithubIssueWorkItem>();
  private readonly projectOwnershipConfigurations = new Map<string, ProjectOwnershipConfiguration>();
  private readonly projectPolicyConfigurations = new Map<string, ProjectPolicyConfiguration>();
  private readonly runs = new Map<string, AgentRun>();
  private readonly adapterDiagnostics = new Map<string, AdapterDiagnostic>();
  private readonly assumptions = new Map<string, Assumption>();
  private readonly questions = new Map<string, Question>();
  private readonly decisions = new Map<string, Decision>();
  private readonly artifacts = new Map<string, Artifact>();
  private readonly contextSnapshots = new Map<string, ContextSnapshot>();
  private readonly auditEvents = new Map<string, AuditEvent>();
  private readonly organizationAuditEvents = new Map<string, OrganizationAuditEvent>();
  private readonly notifications = new Map<string, Notification>();
  private readonly notificationPreferences = new Map<string, NotificationPreference>();
  private readonly outboxEvents = new Map<string, OutboxEvent>();
  private readonly outboxDeliveries = new Map<string, OutboxDelivery>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly artifactIdempotency = new Map<string, ArtifactIdempotencyRecord>();
  private readonly runIdempotency = new Map<string, RunIdempotencyRecord>();
  private readonly assumptionIdempotency = new Map<string, AssumptionIdempotencyRecord>();
  private readonly runContinuationKeys = new Map<string, string>();
  private readonly runVendorSessionIds = new Map<string, string>();
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(private readonly metrics?: BridgeMetrics) {}

  async checkHealth(): Promise<{ readonly backend: string }> {
    return { backend: "memory" };
  }

  async transaction<T>(
    work: (repository: BridgeRepository) => Promise<T>,
    _context?: RepositoryTransactionContext,
  ): Promise<T> {
    if (!currentCorrelationId()) {
      return runWithCorrelationContextIfAbsent("application", () => this.transaction(work));
    }
    const startedAt = performance.now();
    let outcome: "success" | "error" = "success";
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const snapshot = {
      organizations: new Map(this.organizations),
      principalIdentities: new Map(this.principalIdentities),
      serviceCredentials: new Map(this.serviceCredentials),
      organizationMemberships: new Map(this.organizationMemberships),
      directoryGroups: new Map(this.directoryGroups),
      directoryGroupMembers: new Map(this.directoryGroupMembers),
      projectMemberships: new Map(this.projectMemberships),
      projects: new Map(this.projects),
      repositoryRecords: new Map(this.repositoryRecords),
      githubPullRequests: new Map(this.githubPullRequests),
      githubIssues: new Map(this.githubIssues),
      projectOwnershipConfigurations: new Map(this.projectOwnershipConfigurations),
      projectPolicyConfigurations: new Map(this.projectPolicyConfigurations),
      runs: new Map(this.runs),
      adapterDiagnostics: new Map(this.adapterDiagnostics),
      assumptions: new Map(this.assumptions),
      questions: new Map(this.questions),
      decisions: new Map(this.decisions),
      artifacts: new Map(this.artifacts),
      contextSnapshots: new Map(this.contextSnapshots),
      auditEvents: new Map(this.auditEvents),
      organizationAuditEvents: new Map(this.organizationAuditEvents),
      notifications: new Map(this.notifications),
      notificationPreferences: new Map(this.notificationPreferences),
      outboxEvents: new Map(this.outboxEvents),
      outboxDeliveries: new Map(this.outboxDeliveries),
      idempotency: new Map(this.idempotency),
      artifactIdempotency: new Map(this.artifactIdempotency),
      runIdempotency: new Map(this.runIdempotency),
      assumptionIdempotency: new Map(this.assumptionIdempotency),
      runContinuationKeys: new Map(this.runContinuationKeys),
      runVendorSessionIds: new Map(this.runVendorSessionIds),
    };

    try {
      return await work(this);
    } catch (error) {
      outcome = "error";
      this.restoreMap(this.organizations, snapshot.organizations);
      this.restoreMap(this.principalIdentities, snapshot.principalIdentities);
      this.restoreMap(this.serviceCredentials, snapshot.serviceCredentials);
      this.restoreMap(this.organizationMemberships, snapshot.organizationMemberships);
      this.restoreMap(this.directoryGroups, snapshot.directoryGroups);
      this.restoreMap(this.directoryGroupMembers, snapshot.directoryGroupMembers);
      this.restoreMap(this.projectMemberships, snapshot.projectMemberships);
      this.restoreMap(this.projects, snapshot.projects);
      this.restoreMap(this.repositoryRecords, snapshot.repositoryRecords);
      this.restoreMap(this.githubPullRequests, snapshot.githubPullRequests);
      this.restoreMap(this.githubIssues, snapshot.githubIssues);
      this.restoreMap(this.projectOwnershipConfigurations, snapshot.projectOwnershipConfigurations);
      this.restoreMap(this.projectPolicyConfigurations, snapshot.projectPolicyConfigurations);
      this.restoreMap(this.runs, snapshot.runs);
      this.restoreMap(this.adapterDiagnostics, snapshot.adapterDiagnostics);
      this.restoreMap(this.assumptions, snapshot.assumptions);
      this.restoreMap(this.questions, snapshot.questions);
      this.restoreMap(this.decisions, snapshot.decisions);
      this.restoreMap(this.artifacts, snapshot.artifacts);
      this.restoreMap(this.contextSnapshots, snapshot.contextSnapshots);
      this.restoreMap(this.auditEvents, snapshot.auditEvents);
      this.restoreMap(this.organizationAuditEvents, snapshot.organizationAuditEvents);
      this.restoreMap(this.notifications, snapshot.notifications);
      this.restoreMap(this.notificationPreferences, snapshot.notificationPreferences);
      this.restoreMap(this.outboxEvents, snapshot.outboxEvents);
      this.restoreMap(this.outboxDeliveries, snapshot.outboxDeliveries);
      this.restoreMap(this.idempotency, snapshot.idempotency);
      this.restoreMap(this.artifactIdempotency, snapshot.artifactIdempotency);
      this.restoreMap(this.runIdempotency, snapshot.runIdempotency);
      this.restoreMap(this.assumptionIdempotency, snapshot.assumptionIdempotency);
      this.restoreMap(this.runContinuationKeys, snapshot.runContinuationKeys);
      this.restoreMap(this.runVendorSessionIds, snapshot.runVendorSessionIds);
      throw error;
    } finally {
      release();
      this.metrics?.recordDatabaseTransaction({
        backend: "memory",
        outcome,
        durationMs: Math.max(0, performance.now() - startedAt),
      });
    }
  }

  private restoreMap<Key, Value>(target: Map<Key, Value>, source: Map<Key, Value>): void {
    target.clear();
    for (const [key, value] of source) target.set(key, value);
  }

  async getOrganizationByExternalId(
    externalIdentityProviderId: string,
  ): Promise<Organization | undefined> {
    return [...this.organizations.values()].find(
      (organization) => organization.externalIdentityProviderId === externalIdentityProviderId,
    );
  }

  async listOrganizations(): Promise<readonly Organization[]> {
    return [...this.organizations.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  async saveOrganization(organization: Organization): Promise<void> {
    this.organizations.set(organization.id, organization);
  }

  async getPrincipalIdentityByOidc(
    issuer: string,
    subject: string,
  ): Promise<PrincipalIdentity | undefined> {
    return [...this.principalIdentities.values()].find(
      (identity) => identity.oidcIssuer === issuer && identity.oidcSubject === subject,
    );
  }

  async getPrincipalIdentity(principalId: string): Promise<PrincipalIdentity | undefined> {
    return this.principalIdentities.get(principalId);
  }

  async savePrincipalIdentity(identity: PrincipalIdentity): Promise<void> {
    this.principalIdentities.set(identity.id, identity);
  }

  async getServiceCredential(serviceCredentialId: string): Promise<ServiceCredential | undefined> {
    return this.serviceCredentials.get(serviceCredentialId);
  }

  async getServiceCredentialByTokenHash(tokenHash: string): Promise<ServiceCredential | undefined> {
    return [...this.serviceCredentials.values()].find((credential) => credential.tokenHash === tokenHash);
  }

  async listServiceCredentials(organizationId: string): Promise<readonly ServiceCredential[]> {
    return [...this.serviceCredentials.values()]
      .filter((credential) => credential.organizationId === organizationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async saveServiceCredential(credential: ServiceCredential): Promise<void> {
    this.serviceCredentials.set(credential.id, credential);
  }

  async revokeServiceCredential(
    credential: ServiceCredential,
    expectedVersion?: number,
  ): Promise<boolean> {
    const current = this.serviceCredentials.get(credential.id);
    if (!current || (expectedVersion !== undefined && current.version !== expectedVersion)) return false;
    this.serviceCredentials.set(credential.id, credential);
    return true;
  }

  async rotateServiceCredential(
    credential: ServiceCredential,
    expectedVersion?: number,
  ): Promise<boolean> {
    const current = this.serviceCredentials.get(credential.id);
    if (!current || (expectedVersion !== undefined && current.version !== expectedVersion)) return false;
    this.serviceCredentials.set(credential.id, credential);
    return true;
  }

  async getOrganizationMembership(
    organizationId: string,
    principalId: string,
  ): Promise<OrganizationMembership | undefined> {
    return this.organizationMemberships.get(`${organizationId}:${principalId}`);
  }

  async listOrganizationMemberships(
    organizationId: string,
  ): Promise<readonly OrganizationMembership[]> {
    return [...this.organizationMemberships.values()]
      .filter((membership) => membership.organizationId === organizationId)
      .sort((left, right) => left.principalId.localeCompare(right.principalId));
  }

  async saveOrganizationMembership(
    membership: OrganizationMembership,
    expectedVersion?: number,
  ): Promise<boolean> {
    const key = `${membership.organizationId}:${membership.principalId}`;
    const current = this.organizationMemberships.get(key);
    if (expectedVersion !== undefined && current?.version !== expectedVersion) return false;
    this.organizationMemberships.set(
      key,
      membership,
    );
    return true;
  }

  async getDirectoryGroup(groupId: string): Promise<DirectoryGroup | undefined> {
    return this.directoryGroups.get(groupId);
  }

  async listDirectoryGroups(organizationId: string): Promise<readonly DirectoryGroup[]> {
    return [...this.directoryGroups.values()]
      .filter((group) => group.organizationId === organizationId)
      .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id));
  }

  async saveDirectoryGroup(group: DirectoryGroup, expectedVersion?: number): Promise<boolean> {
    const current = this.directoryGroups.get(group.id);
    if (
      (expectedVersion === undefined && current !== undefined) ||
      (expectedVersion !== undefined && current?.version !== expectedVersion)
    ) return false;
    this.directoryGroups.set(group.id, group);
    return true;
  }

  async listDirectoryGroupMembers(groupId: string): Promise<readonly DirectoryGroupMember[]> {
    return [...this.directoryGroupMembers.values()]
      .filter((member) => member.groupId === groupId)
      .sort((left, right) => left.externalSubject.localeCompare(right.externalSubject));
  }

  async listDirectoryGroupMembersForPrincipal(
    organizationId: string,
    principalId: string,
  ): Promise<readonly DirectoryGroupMember[]> {
    return [...this.directoryGroupMembers.values()]
      .filter((member) =>
        member.organizationId === organizationId && member.principalId === principalId)
      .sort((left, right) => left.groupId.localeCompare(right.groupId));
  }

  async saveDirectoryGroupMember(
    member: DirectoryGroupMember,
    expectedVersion?: number,
  ): Promise<boolean> {
    const current = this.directoryGroupMembers.get(member.id);
    if (
      (expectedVersion === undefined && current !== undefined) ||
      (expectedVersion !== undefined && current?.version !== expectedVersion)
    ) return false;
    this.directoryGroupMembers.set(member.id, member);
    return true;
  }

  async listProjectMemberships(
    organizationId: string,
    principalId: string,
  ): Promise<readonly ProjectMembership[]> {
    return [...this.projectMemberships.values()].filter(
      (membership) =>
        membership.organizationId === organizationId &&
        membership.principalId === principalId,
    );
  }

  async saveProjectMembership(
    membership: ProjectMembership,
    expectedVersion?: number,
  ): Promise<boolean> {
    const key = `${membership.organizationId}:${membership.projectId}:${membership.principalId}`;
    const current = this.projectMemberships.get(key);
    if (expectedVersion !== undefined && current?.version !== expectedVersion) return false;
    this.projectMemberships.set(key, membership);
    return true;
  }

  async resolveOidcPrincipal(identity: {
    readonly issuer: string;
    readonly subject: string;
    readonly organizationExternalId: string;
  }): Promise<Principal | undefined> {
    const principalIdentity = await this.getPrincipalIdentityByOidc(identity.issuer, identity.subject);
    const organization = await this.getOrganizationByExternalId(identity.organizationExternalId);
    if (!principalIdentity || !organization) return undefined;
    const organizationMembership = await this.getOrganizationMembership(
      organization.id,
      principalIdentity.id,
    );
    if (!organizationMembership || organizationMembership.status !== "active") return undefined;
    const projectMemberships = (await this.listProjectMemberships(
      organization.id,
      principalIdentity.id,
    )).filter((membership) => membership.status === "active");
    return {
      id: principalIdentity.id,
      type: principalIdentity.type,
      organizationId: organization.id,
      projectIds: projectMemberships.map((membership) => membership.projectId),
      allProjects: organizationMembership.allProjects,
      roles: organizationMembership.roles,
      projectRoles: Object.fromEntries(
        projectMemberships.map((membership) => [membership.projectId, membership.roles]),
      ),
      displayName: principalIdentity.displayName,
    };
  }

  async resolveServiceToken(tokenHash: string): Promise<ServiceTokenResolution | undefined> {
    const credential = await this.getServiceCredentialByTokenHash(tokenHash);
    const expiresAt = credential ? Date.parse(credential.expiresAt) : Number.NaN;
    if (!credential || credential.revokedAt || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return undefined;
    const principalIdentity = await this.getPrincipalIdentity(credential.principalId);
    const organizationMembership = principalIdentity
      ? await this.getOrganizationMembership(credential.organizationId, principalIdentity.id)
      : undefined;
    if (!principalIdentity || principalIdentity.type === "human" || !organizationMembership ||
      organizationMembership.status !== "active") return undefined;
    const projectMemberships = (await this.listProjectMemberships(
      credential.organizationId,
      principalIdentity.id,
    )).filter((membership) => membership.status === "active");
    return {
      credential,
      principal: {
        id: principalIdentity.id,
        type: principalIdentity.type,
        organizationId: credential.organizationId,
        projectIds: projectMemberships.map((membership) => membership.projectId),
        allProjects: organizationMembership.allProjects,
        roles: organizationMembership.roles,
        projectRoles: Object.fromEntries(
          projectMemberships.map((membership) => [membership.projectId, membership.roles]),
        ),
        displayName: principalIdentity.displayName,
      },
    };
  }

  async listOrganizationPrincipals(organizationId: string): Promise<readonly Principal[]> {
    const principals: Principal[] = [];
    for (const membership of this.organizationMemberships.values()) {
      if (membership.organizationId !== organizationId || membership.status !== "active") continue;
      const identity = this.principalIdentities.get(membership.principalId);
      if (!identity) continue;
      const projectMemberships = (await this.listProjectMemberships(organizationId, identity.id))
        .filter((projectMembership) => projectMembership.status === "active");
      principals.push({
        id: identity.id,
        type: identity.type,
        organizationId,
        projectIds: projectMemberships.map((projectMembership) => projectMembership.projectId),
        allProjects: membership.allProjects,
        roles: membership.roles,
        projectRoles: Object.fromEntries(
          projectMemberships.map((projectMembership) => [projectMembership.projectId, projectMembership.roles]),
        ),
        displayName: identity.displayName,
      });
    }
    return principals.sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    return this.projects.get(projectId);
  }

  async listProjects(organizationId: string): Promise<readonly Project[]> {
    return [...this.projects.values()]
      .filter((project) => project.organizationId === organizationId)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }

  async getRepositoryRecord(repositoryId: string): Promise<RepositoryRecord | undefined> {
    return this.repositoryRecords.get(repositoryId);
  }

  async listProjectRepositories(projectId: string): Promise<readonly RepositoryRecord[]> {
    return [...this.repositoryRecords.values()]
      .filter((repository) => repository.projectId === projectId)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }

  async saveRepositoryRecord(repository: RepositoryRecord): Promise<void> {
    this.repositoryRecords.set(repository.id, repository);
  }

  async getGithubPullRequest(
    pullRequestId: string,
  ): Promise<GithubPullRequestContext | undefined> {
    return this.githubPullRequests.get(pullRequestId);
  }

  async listGithubPullRequests(projectId: string): Promise<readonly GithubPullRequestContext[]> {
    return [...this.githubPullRequests.values()]
      .filter((pullRequest) => pullRequest.projectId === projectId)
      .sort((left, right) =>
        right.sourceUpdatedAt.localeCompare(left.sourceUpdatedAt) || left.id.localeCompare(right.id));
  }

  async saveGithubPullRequest(
    pullRequest: GithubPullRequestContext,
    expectedVersion?: number,
  ): Promise<boolean> {
    const current = this.githubPullRequests.get(pullRequest.id);
    if (
      (expectedVersion === undefined && current !== undefined) ||
      (expectedVersion !== undefined && current?.version !== expectedVersion)
    ) return false;
    this.githubPullRequests.set(pullRequest.id, pullRequest);
    return true;
  }

  async getGithubIssue(issueId: string): Promise<GithubIssueWorkItem | undefined> {
    return this.githubIssues.get(issueId);
  }

  async listGithubIssues(projectId: string): Promise<readonly GithubIssueWorkItem[]> {
    return [...this.githubIssues.values()]
      .filter((issue) => issue.projectId === projectId)
      .sort((left, right) =>
        right.sourceUpdatedAt.localeCompare(left.sourceUpdatedAt) || left.id.localeCompare(right.id));
  }

  async saveGithubIssue(issue: GithubIssueWorkItem, expectedVersion?: number): Promise<boolean> {
    const current = this.githubIssues.get(issue.id);
    if (
      (expectedVersion === undefined && current !== undefined) ||
      (expectedVersion !== undefined && current?.version !== expectedVersion)
    ) return false;
    this.githubIssues.set(issue.id, issue);
    return true;
  }

  async getProjectOwnershipConfiguration(
    projectId: string,
  ): Promise<ProjectOwnershipConfiguration | undefined> {
    return this.projectOwnershipConfigurations.get(projectId);
  }

  async saveProjectOwnershipConfiguration(
    configuration: ProjectOwnershipConfiguration,
    expectedVersion: number,
  ): Promise<boolean> {
    const current = this.projectOwnershipConfigurations.get(configuration.projectId);
    if ((current?.version ?? 0) !== expectedVersion) return false;
    this.projectOwnershipConfigurations.set(configuration.projectId, configuration);
    return true;
  }

  async getProjectPolicyConfiguration(
    projectId: string,
  ): Promise<ProjectPolicyConfiguration | undefined> {
    return this.projectPolicyConfigurations.get(projectId);
  }

  async saveProjectPolicyConfiguration(
    configuration: ProjectPolicyConfiguration,
    expectedVersion: number,
  ): Promise<boolean> {
    const current = this.projectPolicyConfigurations.get(configuration.projectId);
    if ((current?.version ?? 0) !== expectedVersion) return false;
    this.projectPolicyConfigurations.set(configuration.projectId, configuration);
    return true;
  }

  async getRun(runId: string): Promise<AgentRun | undefined> {
    return this.runs.get(runId);
  }

  async listRuns(projectId: string): Promise<readonly AgentRun[]> {
    return [...this.runs.values()]
      .filter((run) => run.projectId === projectId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async saveRun(run: AgentRun): Promise<void> {
    this.runs.set(run.id, run);
  }

  async listAdapterDiagnostics(projectId: string): Promise<readonly AdapterDiagnostic[]> {
    return [...this.adapterDiagnostics.values()]
      .filter((diagnostic) => diagnostic.projectId === projectId)
      .sort((left, right) => left.client.localeCompare(right.client));
  }

  async saveAdapterDiagnostic(diagnostic: AdapterDiagnostic): Promise<void> {
    this.adapterDiagnostics.set(`${diagnostic.projectId}:${diagnostic.client}`, diagnostic);
  }

  async findIdempotentRun(key: string): Promise<AgentRun | undefined> {
    const record = this.runIdempotency.get(key);
    return record ? this.runs.get(record.runId) : undefined;
  }

  async getIdempotentRunRequestHash(key: string): Promise<string | undefined> {
    return this.runIdempotency.get(key)?.requestHash;
  }

  async saveIdempotentRun(key: string, runId: string, requestHash: string): Promise<void> {
    this.runIdempotency.set(key, { runId, requestHash });
  }

  async getRunContinuationKey(runId: string): Promise<string | undefined> {
    return this.runContinuationKeys.get(runId);
  }

  async getRunVendorSessionId(runId: string): Promise<string | undefined> {
    return this.runVendorSessionIds.get(runId);
  }

  async saveRunContinuationKey(
    runId: string,
    resumeContextKey: string,
    vendorSessionId?: string,
  ): Promise<void> {
    this.runContinuationKeys.set(runId, resumeContextKey);
    if (vendorSessionId) this.runVendorSessionIds.set(runId, vendorSessionId);
  }

  async getAssumption(assumptionId: string): Promise<Assumption | undefined> {
    return this.assumptions.get(assumptionId);
  }

  async listAssumptions(projectId: string): Promise<readonly Assumption[]> {
    return [...this.assumptions.values()]
      .filter((assumption) => assumption.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async saveAssumption(assumption: Assumption): Promise<void> {
    this.assumptions.set(assumption.id, assumption);
  }

  async findIdempotentAssumption(key: string): Promise<Assumption | undefined> {
    const record = this.assumptionIdempotency.get(key);
    return record ? this.assumptions.get(record.assumptionId) : undefined;
  }

  async getIdempotentAssumptionRequestHash(key: string): Promise<string | undefined> {
    return this.assumptionIdempotency.get(key)?.requestHash;
  }

  async saveIdempotentAssumption(
    key: string,
    assumptionId: string,
    requestHash: string,
  ): Promise<void> {
    this.assumptionIdempotency.set(key, { assumptionId, requestHash });
  }

  async getQuestion(questionId: string): Promise<Question | undefined> {
    return this.questions.get(questionId);
  }

  async listQuestions(projectId: string): Promise<readonly Question[]> {
    return [...this.questions.values()]
      .filter((question) => question.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async searchQuestionMatchCandidates(
    projectId: string,
    _query: QuestionMatchCandidateQuery,
  ): Promise<readonly Question[]> {
    return this.listQuestions(projectId);
  }

  async saveQuestion(question: Question): Promise<void> {
    this.questions.set(question.id, question);
  }

  async findIdempotentQuestion(key: string): Promise<Question | undefined> {
    const record = this.idempotency.get(key);
    return record ? this.questions.get(record.questionId) : undefined;
  }

  async saveIdempotentQuestion(key: string, questionId: string, requestHash: string): Promise<void> {
    this.idempotency.set(key, { questionId, requestHash });
  }

  async getIdempotentRequestHash(key: string): Promise<string | undefined> {
    return this.idempotency.get(key)?.requestHash;
  }

  async getDecision(decisionId: string): Promise<Decision | undefined> {
    return this.decisions.get(decisionId);
  }

  async listDecisions(projectId: string): Promise<readonly Decision[]> {
    return [...this.decisions.values()]
      .filter((decision) => decision.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async searchDecisions(projectId: string, search: string): Promise<readonly Decision[]> {
    const tokenize = (value: string): readonly string[] =>
      value.toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? [];
    const searchTokens = [...new Set(tokenize(search))];
    if (searchTokens.length === 0) return [];

    return (await this.listDecisions(projectId))
      .map((decision) => {
        const answerTokens = new Set(tokenize(decision.answer));
        const rationaleTokens = new Set(tokenize(decision.rationale));
        const categoryTokens = new Set(tokenize(decision.category));
        const matches = searchTokens.every((token) =>
          answerTokens.has(token) || rationaleTokens.has(token) || categoryTokens.has(token),
        );
        const score = matches
          ? searchTokens.reduce(
            (total, token) => total +
              (answerTokens.has(token) ? 4 : 0) +
              (rationaleTokens.has(token) ? 2 : 0) +
              (categoryTokens.has(token) ? 1 : 0),
            0,
          )
          : 0;
        return { decision, score };
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) =>
        right.score - left.score || right.decision.createdAt.localeCompare(left.decision.createdAt),
      )
      .map(({ decision }) => decision);
  }

  async saveDecision(decision: Decision): Promise<void> {
    this.decisions.set(decision.id, decision);
  }

  async getArtifact(artifactId: string): Promise<Artifact | undefined> {
    return this.artifacts.get(artifactId);
  }

  async getArtifactByVersionId(versionId: string): Promise<Artifact | undefined> {
    return [...this.artifacts.values()].find((artifact) =>
      artifact.versions.some((version) => version.id === versionId),
    );
  }

  async listArtifacts(projectId: string): Promise<readonly Artifact[]> {
    return [...this.artifacts.values()]
      .filter((artifact) => artifact.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    this.artifacts.set(artifact.id, artifact);
  }

  async getIdempotentArtifactVersionId(key: string): Promise<string | undefined> {
    return this.artifactIdempotency.get(key)?.versionId;
  }

  async getIdempotentArtifactRequestHash(key: string): Promise<string | undefined> {
    return this.artifactIdempotency.get(key)?.requestHash;
  }

  async saveIdempotentArtifactVersion(
    key: string,
    versionId: string,
    requestHash: string,
  ): Promise<void> {
    this.artifactIdempotency.set(key, { versionId, requestHash });
  }

  async saveContextSnapshot(snapshot: ContextSnapshot): Promise<void> {
    this.contextSnapshots.set(snapshot.id, snapshot);
  }

  async listContextSnapshots(projectId: string): Promise<readonly ContextSnapshot[]> {
    return [...this.contextSnapshots.values()]
      .filter((snapshot) => snapshot.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async saveAuditEvent(event: AuditEvent): Promise<void> {
    this.auditEvents.set(event.id, event);
  }

  async saveOrganizationAuditEvent(event: OrganizationAuditEvent): Promise<void> {
    this.organizationAuditEvents.set(event.id, event);
  }

  async listOrganizationAuditEvents(
    organizationId: string,
  ): Promise<readonly OrganizationAuditEvent[]> {
    return [...this.organizationAuditEvents.values()]
      .filter((event) => event.organizationId === organizationId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  }

  async getNotification(notificationId: string): Promise<Notification | undefined> {
    return this.notifications.get(notificationId);
  }

  async listNotifications(
    organizationId: string,
    recipientId: string,
    projectId?: string,
    unreadOnly = false,
  ): Promise<readonly Notification[]> {
    return [...this.notifications.values()]
      .filter((notification) =>
        notification.organizationId === organizationId &&
        notification.recipientId === recipientId &&
        (!projectId || notification.projectId === projectId) &&
        (!unreadOnly || !notification.readAt),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async saveNotification(notification: Notification): Promise<void> {
    this.notifications.set(notification.id, notification);
  }

  async getNotificationPreference(
    organizationId: string,
    principalId: string,
    channel: NotificationPreference["channel"],
  ): Promise<NotificationPreference | undefined> {
    return this.notificationPreferences.get(`${organizationId}:${principalId}:${channel}`);
  }

  async listNotificationPreferences(
    organizationId: string,
    principalId: string,
  ): Promise<readonly NotificationPreference[]> {
    return [...this.notificationPreferences.values()]
      .filter((preference) =>
        preference.organizationId === organizationId && preference.principalId === principalId)
      .sort((left, right) => left.channel.localeCompare(right.channel));
  }

  async saveNotificationPreference(preference: NotificationPreference): Promise<void> {
    this.notificationPreferences.set(
      `${preference.organizationId}:${preference.principalId}:${preference.channel}`,
      preference,
    );
  }

  async listOutboxEvents(projectId?: string): Promise<readonly OutboxEvent[]> {
    return [...this.outboxEvents.values()]
      .filter((event) => !projectId || event.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getOutboxEvent(eventId: string): Promise<OutboxEvent | undefined> {
    return this.outboxEvents.get(eventId);
  }

  async saveOutboxEvent(event: OutboxEvent): Promise<void> {
    this.outboxEvents.set(event.id, event);
  }

  async listOutboxDeliveries(projectId: string): Promise<readonly OutboxDelivery[]> {
    return [...this.outboxDeliveries.values()]
      .filter((delivery) => delivery.projectId === projectId)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  }

  async getOutboxDelivery(
    eventId: string,
    channel: OutboxDelivery["channel"],
  ): Promise<OutboxDelivery | undefined> {
    return [...this.outboxDeliveries.values()].find(
      (delivery) => delivery.outboxEventId === eventId && delivery.channel === channel,
    );
  }

  async saveOutboxDelivery(delivery: OutboxDelivery): Promise<void> {
    this.outboxDeliveries.set(delivery.id, delivery);
  }

  async claimOutboxEvents(now: string, limit: number): Promise<readonly OutboxEvent[]> {
    const nowTime = Date.parse(now);
    const candidates = [...this.outboxEvents.values()]
      .filter((event) =>
        (event.status === "pending" || event.status === "failed" || event.status === "processing") &&
        Date.parse(event.availableAt) <= nowTime &&
        (!event.leaseUntil || Date.parse(event.leaseUntil) <= nowTime),
      )
      .sort((left, right) => left.availableAt.localeCompare(right.availableAt) || left.createdAt.localeCompare(right.createdAt))
      .slice(0, Math.max(0, limit));
    const leaseUntil = new Date(nowTime + 5 * 60 * 1_000).toISOString();
    const claimed = candidates.map((event) => {
      const { lastError: _lastError, processedAt: _processedAt, leaseUntil: _leaseUntil, ...base } = event;
      return {
        ...base,
        status: "processing" as const,
        attempts: event.attempts + 1,
        leaseUntil,
      };
    });
    for (const event of claimed) await this.saveOutboxEvent(event);
    return claimed;
  }

  async completeOutboxEvent(eventId: string, processedAt: string): Promise<void> {
    const event = this.outboxEvents.get(eventId);
    if (!event) return;
    const { lastError: _lastError, leaseUntil: _leaseUntil, ...base } = event;
    await this.saveOutboxEvent({ ...base, status: "processed", processedAt });
  }

  async failOutboxEvent(
    eventId: string,
    lastError: string,
    availableAt: string,
    deadLetter: boolean,
  ): Promise<void> {
    const event = this.outboxEvents.get(eventId);
    if (!event) return;
    const { leaseUntil: _leaseUntil, processedAt: _processedAt, ...base } = event;
    await this.saveOutboxEvent({
      ...base,
      status: deadLetter ? "dead_letter" : "failed",
      availableAt,
      lastError,
    });
  }

  async listAuditEvents(projectId: string): Promise<readonly AuditEvent[]> {
    return [...this.auditEvents.values()].filter((event) => event.projectId === projectId);
  }
}

export interface BridgeServiceOptions {
  readonly publicBaseUrl?: string;
  readonly identityIssuer?: string;
  readonly now?: () => Date;
  readonly id?: () => string;
  readonly resumeKey?: () => string;
  readonly metrics?: BridgeMetrics;
}

export interface BridgeReadiness {
  readonly status: "ready" | "not_ready";
  readonly checks: readonly [{
    readonly name: "repository";
    readonly status: "ready" | "failed";
    readonly backend?: string;
    readonly message?: string;
  }];
}

export class BridgeService {
  private readonly publicBaseUrl: string;
  private readonly identityIssuer: string | undefined;
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly resumeKey: () => string;
  private readonly metrics: BridgeMetrics | undefined;

  constructor(
    private readonly repository: BridgeRepository,
    options: BridgeServiceOptions = {},
  ) {
    this.publicBaseUrl = options.publicBaseUrl ?? "http://localhost:3000";
    this.identityIssuer = options.identityIssuer
      ? `${options.identityIssuer.replace(/\/+$/, "")}/`
      : undefined;
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
    this.resumeKey = options.resumeKey ?? (() => randomBytes(32).toString("base64url"));
    this.metrics = options.metrics;
  }

  private tenantTransaction<T>(
    principal: Principal,
    work: (repository: BridgeRepository) => Promise<T>,
  ): Promise<T> {
    return this.repository
      .transaction(work, { organizationId: principal.organizationId })
      .catch((error: unknown) => {
        if (error instanceof BridgeError && error.code === "CONFLICT") {
          this.metrics?.recordConflict();
        }
        throw error;
      });
  }

  private recordIdempotency(
    operation: BridgeIdempotencyOperation,
    outcome: BridgeIdempotencyOutcome,
  ): void {
    this.metrics?.recordIdempotency({ operation, outcome });
  }

  private recordUrl(parameters: Readonly<Record<string, string>>): string {
    const url = new URL(this.publicBaseUrl);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return url.toString();
  }

  private assertSecretSafe(contentType: BridgeSecretContentType, value: unknown): void {
    const detection = detectSecret(value);
    if (!detection) return;
    this.metrics?.recordContentSecretDetection({
      contentType,
      secretType: detection.secretType,
    });
    throw new BridgeError(
      "SECRET_DETECTED",
      "Potential credential detected in content. Remove it and retry; Bridge did not store this request.",
      422,
      {
        contentType,
        fieldPath: detection.fieldPath,
        secretType: detection.secretType,
      },
    );
  }

  async checkReadiness(): Promise<BridgeReadiness> {
    try {
      const health = await this.repository.checkHealth();
      return {
        status: "ready",
        checks: [{ name: "repository", status: "ready", backend: health.backend }],
      };
    } catch {
      return {
        status: "not_ready",
        checks: [{
          name: "repository",
          status: "failed",
          message: "Repository dependency is unavailable.",
        }],
      };
    }
  }

  async recordAuthenticationEvent(
    principal: Principal,
    action: "authentication.succeeded" | "authentication.logged_out",
  ): Promise<void> {
    return this.tenantTransaction(principal, async (repository) => {
      assertHuman(principal, "Recording web authentication");
      await this.auditOrganizationEvent(
        repository,
        principal,
        action,
        principal.id,
        this.now().toISOString(),
        "principal_identity",
      );
    });
  }

  async registerProject(
    principal: Principal,
    input: RegisterProjectInput,
  ): Promise<ProjectRegistration> {
    return this.tenantTransaction(principal, async (repository) => {
      assertHuman(principal, "Registering a project");
      if (
        !principalHasRole(principal, "organization-admin") &&
        !principalHasRole(principal, "project-admin")
      ) {
        throw new BridgeError("FORBIDDEN", "Project registration requires an organization administrator.", 403);
      }
      this.assertSecretSafe("administration", input);
      const projectId = `prj_${createHash("sha256")
        .update(`${principal.organizationId}:${input.idempotencyKey}`)
        .digest("hex")
        .slice(0, 24)}`;
      const ownerIds = input.decisionOwnerIds.length > 0
        ? [...input.decisionOwnerIds]
        : [principal.id];
      const existing = await repository.getProject(projectId);
      if (existing) {
        const sameRequest = existing.organizationId === principal.organizationId &&
          existing.name === input.name &&
          JSON.stringify(existing.decisionOwnerIds) === JSON.stringify(ownerIds);
        if (!sameRequest) {
          this.recordIdempotency("project_registration", "conflict");
          throw new BridgeError(
            "CONFLICT",
            "The project registration key was reused with different project details.",
            409,
          );
        }
        this.recordIdempotency("project_registration", "replayed");
        return { project: existing, disposition: "idempotent_replay" };
      }

      const project: Project = {
        id: projectId,
        organizationId: principal.organizationId,
        name: input.name,
        decisionOwnerIds: ownerIds,
      };
      await repository.saveProject(project);
      await this.audit(
        repository,
        principal,
        project.id,
        "project.registered",
        "project",
        project.id,
        this.now().toISOString(),
      );
      this.recordIdempotency("project_registration", "created");
      return { project, disposition: "created" };
    });
  }

  async listProjects(principal: Principal): Promise<readonly Project[]> {
    return this.tenantTransaction(principal, async (repository) => {
      const projects = await repository.listProjects(principal.organizationId);
      return projects.filter((project) => {
        try {
          assertProjectAccess(principal, project);
          return true;
        } catch {
          return false;
        }
      });
    });
  }

  async linkRepository(
    principal: Principal,
    projectId: string,
    input: LinkRepositoryInput,
  ): Promise<RepositoryRegistration> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      this.assertProjectOperator(principal, "Linking a repository", projectId);
      this.assertSecretSafe("administration", input);
      const provider = input.provider.trim().toLowerCase();
      const owner = input.owner.trim();
      const name = input.name.trim();
      const canonicalUrl = input.canonicalUrl.trim();
      const repositoryId = `repo_${createHash("sha256")
        .update(`${principal.organizationId}:${provider}:${owner}:${name}`)
        .digest("hex")
        .slice(0, 24)}`;
      const existing = await repository.getRepositoryRecord(repositoryId);
      if (existing) {
        const sameRequest = existing.organizationId === principal.organizationId &&
          existing.projectId === projectId &&
          existing.provider === provider &&
          existing.owner === owner &&
          existing.name === name &&
          existing.canonicalUrl === canonicalUrl;
        if (!sameRequest) {
          this.recordIdempotency("repository_link", "conflict");
          throw new BridgeError(
            "CONFLICT",
            "This repository is already linked with different project or metadata.",
            409,
          );
        }
        this.recordIdempotency("repository_link", "replayed");
        return { repository: existing, disposition: "idempotent_replay" };
      }
      const linked: RepositoryRecord = {
        id: repositoryId,
        organizationId: principal.organizationId,
        projectId,
        provider,
        owner,
        name,
        canonicalUrl,
        createdAt: this.now().toISOString(),
      };
      await repository.saveRepositoryRecord(linked);
      await this.audit(
        repository,
        principal,
        projectId,
        "repository.linked",
        "repository",
        linked.id,
        linked.createdAt,
      );
      this.recordIdempotency("repository_link", "created");
      return { repository: linked, disposition: "created" };
    });
  }

  async listProjectRepositories(
    principal: Principal,
    projectId: string,
  ): Promise<readonly RepositoryRecord[]> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      return repository.listProjectRepositories(projectId);
    });
  }

  async syncGithubPullRequest(
    principal: Principal,
    projectId: string,
    input: SyncGithubPullRequestInput,
  ): Promise<GithubPullRequestRegistration> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      this.assertIntegrationWriter(principal, "Synchronizing GitHub pull-request context", projectId);
      this.assertSecretSafe("administration", input);
      const linkedRepository = await repository.getRepositoryRecord(input.repositoryId);
      if (
        !linkedRepository ||
        linkedRepository.projectId !== projectId ||
        linkedRepository.organizationId !== principal.organizationId ||
        linkedRepository.provider !== "github"
      ) {
        throw new BridgeError("PROJECT_NOT_FOUND", "Linked GitHub repository not found.", 404);
      }
      const expectedUrl = new URL(linkedRepository.canonicalUrl);
      expectedUrl.pathname = `${expectedUrl.pathname.replace(/\/$/, "")}/pull/${input.number}`;
      expectedUrl.search = "";
      expectedUrl.hash = "";
      const suppliedUrl = new URL(input.canonicalUrl);
      suppliedUrl.search = "";
      suppliedUrl.hash = "";
      if (suppliedUrl.toString() !== expectedUrl.toString()) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "The pull-request URL does not match the linked GitHub repository and number.",
          422,
        );
      }
      for (const decisionId of input.decisionIds) {
        const decision = await this.requireDecision(principal, decisionId, repository);
        if (decision.projectId !== projectId || decision.status !== "active") {
          throw new BridgeError(
            "VALIDATION_FAILED",
            "Pull-request guidance can cite only active decisions in the same project.",
            422,
          );
        }
      }
      for (const versionId of input.artifactVersionIds) {
        const artifact = await repository.getArtifactByVersionId(versionId);
        const version = artifact?.versions.find((candidate) => candidate.id === versionId);
        if (
          !artifact ||
          artifact.projectId !== projectId ||
          !version ||
          !["approved", "superseded"].includes(version.status)
        ) {
          throw new BridgeError(
            "VALIDATION_FAILED",
            "Pull-request guidance can cite only approved specification versions in the same project.",
            422,
          );
        }
      }
      const pullRequestId = `gpr_${createHash("sha256")
        .update(`${principal.organizationId}:${input.repositoryId}:${input.number}`)
        .digest("hex")
        .slice(0, 24)}`;
      const existing = await repository.getGithubPullRequest(pullRequestId);
      const timestamp = this.now().toISOString();
      const normalized = {
        repositoryId: input.repositoryId,
        number: input.number,
        title: input.title.trim(),
        state: input.state,
        canonicalUrl: suppliedUrl.toString(),
        headBranch: input.headBranch.trim(),
        baseBranch: input.baseBranch.trim(),
        headSha: input.headSha,
        decisionIds: [...input.decisionIds].sort(),
        artifactVersionIds: [...input.artifactVersionIds].sort(),
        sourceUpdatedAt: new Date(input.sourceUpdatedAt).toISOString(),
      } as const;
      if (existing) {
        const sourceOrder = normalized.sourceUpdatedAt.localeCompare(existing.sourceUpdatedAt);
        const same = this.githubPullRequestMatches(existing, normalized);
        if (sourceOrder < 0 || (sourceOrder === 0 && !same)) {
          this.recordIdempotency("github_pull_request_sync", "conflict");
          throw new BridgeError(
            "CONFLICT",
            "The GitHub pull-request update is stale or conflicts with the stored provider version.",
            409,
            { currentVersion: existing.version, sourceUpdatedAt: existing.sourceUpdatedAt },
          );
        }
        if (same) {
          this.recordIdempotency("github_pull_request_sync", "replayed");
          return { pullRequest: existing, disposition: "idempotent_replay" };
        }
        const updated: GithubPullRequestContext = {
          ...existing,
          ...normalized,
          updatedAt: timestamp,
          version: existing.version + 1,
        };
        if (!await repository.saveGithubPullRequest(updated, existing.version)) {
          this.recordIdempotency("github_pull_request_sync", "conflict");
          throw new BridgeError("CONFLICT", "The pull-request context changed during synchronization.", 409);
        }
        await this.audit(
          repository,
          principal,
          projectId,
          "integration.pull_request_synced",
          "pull_request_context",
          updated.id,
          timestamp,
        );
        this.recordIdempotency("github_pull_request_sync", "updated");
        return { pullRequest: updated, disposition: "updated" };
      }
      const created: GithubPullRequestContext = {
        id: pullRequestId,
        organizationId: principal.organizationId,
        projectId,
        ...normalized,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      if (!await repository.saveGithubPullRequest(created)) {
        this.recordIdempotency("github_pull_request_sync", "conflict");
        throw new BridgeError("CONFLICT", "The pull-request context was created concurrently.", 409);
      }
      await this.audit(
        repository,
        principal,
        projectId,
        "integration.pull_request_synced",
        "pull_request_context",
        created.id,
        timestamp,
      );
      this.recordIdempotency("github_pull_request_sync", "created");
      return { pullRequest: created, disposition: "created" };
    });
  }

  async listGithubPullRequests(
    principal: Principal,
    projectId: string,
    query: GithubPullRequestListQuery,
  ): Promise<readonly GithubPullRequestContextView[]> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      const items = (await repository.listGithubPullRequests(projectId))
        .filter((item) => !query.repositoryId || item.repositoryId === query.repositoryId)
        .filter((item) => !query.state || item.state === query.state)
        .slice(0, query.limit);
      return Promise.all(items.map((item) => this.githubPullRequestView(repository, item)));
    });
  }

  async getGithubPullRequestContext(
    principal: Principal,
    projectId: string,
    pullRequestNumber: number,
    query: GithubPullRequestContextQuery,
  ): Promise<GithubPullRequestContextView> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      const pullRequestId = `gpr_${createHash("sha256")
        .update(`${principal.organizationId}:${query.repositoryId}:${pullRequestNumber}`)
        .digest("hex")
        .slice(0, 24)}`;
      const pullRequest = await repository.getGithubPullRequest(pullRequestId);
      if (!pullRequest || pullRequest.projectId !== projectId) {
        throw new BridgeError("PULL_REQUEST_NOT_FOUND", "Pull-request context not found.", 404);
      }
      return this.githubPullRequestView(repository, pullRequest);
    });
  }

  async syncGithubIssue(
    principal: Principal,
    projectId: string,
    input: SyncGithubIssueInput,
  ): Promise<GithubIssueRegistration> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      this.assertIntegrationWriter(principal, "Synchronizing GitHub issue work items", projectId);
      this.assertSecretSafe("administration", input);
      const linkedRepository = await repository.getRepositoryRecord(input.repositoryId);
      if (
        !linkedRepository ||
        linkedRepository.projectId !== projectId ||
        linkedRepository.organizationId !== principal.organizationId ||
        linkedRepository.provider !== "github"
      ) {
        throw new BridgeError("PROJECT_NOT_FOUND", "Linked GitHub repository not found.", 404);
      }
      const expectedUrl = new URL(linkedRepository.canonicalUrl);
      expectedUrl.pathname = `${expectedUrl.pathname.replace(/\/$/, "")}/issues/${input.number}`;
      expectedUrl.search = "";
      expectedUrl.hash = "";
      const suppliedUrl = new URL(input.canonicalUrl);
      suppliedUrl.search = "";
      suppliedUrl.hash = "";
      if (suppliedUrl.toString() !== expectedUrl.toString()) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "The issue URL does not match the linked GitHub repository and number.",
          422,
        );
      }
      for (const decisionId of input.decisionIds) {
        const decision = await this.requireDecision(principal, decisionId, repository);
        if (decision.projectId !== projectId || decision.status !== "active") {
          throw new BridgeError(
            "VALIDATION_FAILED",
            "Work-item guidance can cite only active decisions in the same project.",
            422,
          );
        }
      }
      for (const versionId of input.artifactVersionIds) {
        const artifact = await repository.getArtifactByVersionId(versionId);
        const version = artifact?.versions.find((candidate) => candidate.id === versionId);
        if (
          !artifact ||
          artifact.projectId !== projectId ||
          !version ||
          !["approved", "superseded"].includes(version.status)
        ) {
          throw new BridgeError(
            "VALIDATION_FAILED",
            "Work-item guidance can cite only approved specification versions in the same project.",
            422,
          );
        }
      }
      const issueId = `gwi_${createHash("sha256")
        .update(`${principal.organizationId}:${input.repositoryId}:${input.number}`)
        .digest("hex")
        .slice(0, 24)}`;
      const existing = await repository.getGithubIssue(issueId);
      const timestamp = this.now().toISOString();
      const normalized = {
        repositoryId: input.repositoryId,
        number: input.number,
        reference: `github:${linkedRepository.owner}/${linkedRepository.name}#${input.number}`.toLowerCase(),
        title: input.title.trim(),
        state: input.state,
        canonicalUrl: suppliedUrl.toString(),
        labels: [...input.labels].sort((left, right) => left.localeCompare(right)),
        decisionIds: [...input.decisionIds].sort(),
        artifactVersionIds: [...input.artifactVersionIds].sort(),
        sourceUpdatedAt: new Date(input.sourceUpdatedAt).toISOString(),
      } as const;
      if (existing) {
        const sourceOrder = normalized.sourceUpdatedAt.localeCompare(existing.sourceUpdatedAt);
        const same = this.githubIssueMatches(existing, normalized);
        if (sourceOrder < 0 || (sourceOrder === 0 && !same)) {
          this.recordIdempotency("github_issue_sync", "conflict");
          throw new BridgeError(
            "CONFLICT",
            "The GitHub issue update is stale or conflicts with the stored provider version.",
            409,
            { currentVersion: existing.version, sourceUpdatedAt: existing.sourceUpdatedAt },
          );
        }
        if (same) {
          this.recordIdempotency("github_issue_sync", "replayed");
          return { issue: existing, disposition: "idempotent_replay" };
        }
        const updated: GithubIssueWorkItem = {
          ...existing,
          ...normalized,
          updatedAt: timestamp,
          version: existing.version + 1,
        };
        if (!await repository.saveGithubIssue(updated, existing.version)) {
          this.recordIdempotency("github_issue_sync", "conflict");
          throw new BridgeError("CONFLICT", "The work item changed during synchronization.", 409);
        }
        await this.audit(
          repository,
          principal,
          projectId,
          "integration.work_item_synced",
          "work_item",
          updated.id,
          timestamp,
        );
        this.recordIdempotency("github_issue_sync", "updated");
        return { issue: updated, disposition: "updated" };
      }
      const created: GithubIssueWorkItem = {
        id: issueId,
        organizationId: principal.organizationId,
        projectId,
        ...normalized,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      if (!await repository.saveGithubIssue(created)) {
        this.recordIdempotency("github_issue_sync", "conflict");
        throw new BridgeError("CONFLICT", "The work item was created concurrently.", 409);
      }
      await this.audit(
        repository,
        principal,
        projectId,
        "integration.work_item_synced",
        "work_item",
        created.id,
        timestamp,
      );
      this.recordIdempotency("github_issue_sync", "created");
      return { issue: created, disposition: "created" };
    });
  }

  async listGithubIssues(
    principal: Principal,
    projectId: string,
    query: GithubIssueListQuery,
  ): Promise<readonly GithubIssueContextView[]> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      const items = (await repository.listGithubIssues(projectId))
        .filter((item) => !query.repositoryId || item.repositoryId === query.repositoryId)
        .filter((item) => !query.state || item.state === query.state)
        .filter((item) => !query.label || item.labels.includes(query.label))
        .slice(0, query.limit);
      return Promise.all(items.map((item) => this.githubIssueView(repository, item)));
    });
  }

  async getGithubIssueContext(
    principal: Principal,
    projectId: string,
    issueNumber: number,
    query: GithubIssueContextQuery,
  ): Promise<GithubIssueContextView> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      const issueId = `gwi_${createHash("sha256")
        .update(`${principal.organizationId}:${query.repositoryId}:${issueNumber}`)
        .digest("hex")
        .slice(0, 24)}`;
      const issue = await repository.getGithubIssue(issueId);
      if (!issue || issue.projectId !== projectId) {
        throw new BridgeError("WORK_ITEM_NOT_FOUND", "Work-item context not found.", 404);
      }
      return this.githubIssueView(repository, issue);
    });
  }

  async getProjectOwnershipConfiguration(
    principal: Principal,
    projectId: string,
  ): Promise<ProjectOwnershipConfiguration> {
    return this.tenantTransaction(principal, async (repository) => {
      const project = await this.requireProject(principal, projectId, repository);
      this.assertProjectOperator(principal, "Reading project ownership configuration", projectId);
      return await repository.getProjectOwnershipConfiguration(projectId) ?? {
        organizationId: project.organizationId,
        projectId: project.id,
        roles: [],
        teams: [],
        rules: [],
        version: 0,
      };
    });
  }

  async replaceProjectOwnershipConfiguration(
    principal: Principal,
    projectId: string,
    input: ReplaceProjectOwnershipInput,
  ): Promise<ProjectOwnershipConfiguration> {
    return this.tenantTransaction(principal, async (repository) => {
      const project = await this.requireProject(principal, projectId, repository);
      this.assertProjectOperator(principal, "Configuring project ownership", projectId);
      this.assertSecretSafe("administration", input);
      const current = await repository.getProjectOwnershipConfiguration(projectId);
      const currentVersion = current?.version ?? 0;
      if (input.expectedVersion !== currentVersion) {
        throw new BridgeError(
          "CONFLICT",
          "The project ownership configuration changed after it was read.",
          409,
          { expectedVersion: input.expectedVersion, currentVersion },
        );
      }

      const activeHumans = new Map(
        (await repository.listOrganizationPrincipals(principal.organizationId))
          .filter((candidate) => {
            if (candidate.type !== "human") return false;
            try {
              assertProjectAccess(candidate, project);
              return true;
            } catch {
              return false;
            }
          })
          .map((candidate) => [candidate.id, candidate]),
      );
      const configuration = this.normalizeProjectOwnershipConfiguration(
        principal,
        project,
        input,
        activeHumans,
        currentVersion + 1,
      );
      if (!await repository.saveProjectOwnershipConfiguration(configuration, currentVersion)) {
        throw new BridgeError(
          "CONFLICT",
          "The project ownership configuration changed while it was being saved.",
          409,
        );
      }
      await this.audit(
        repository,
        principal,
        projectId,
        "project.ownership_configured",
        "ownership_configuration",
        projectId,
        configuration.updatedAt!,
        undefined,
        undefined,
        { beforeVersion: currentVersion, afterVersion: configuration.version },
      );
      return configuration;
    });
  }

  async getProjectPolicyConfiguration(
    principal: Principal,
    projectId: string,
  ): Promise<ProjectPolicyView> {
    return this.tenantTransaction(principal, async (repository) => {
      const project = await this.requireProject(principal, projectId, repository);
      this.assertProjectOperator(principal, "Reading project policy configuration", projectId);
      const configuration = await repository.getProjectPolicyConfiguration(projectId) ?? {
        organizationId: project.organizationId,
        projectId: project.id,
        rules: [],
        version: 0,
      };
      return { ...configuration, defaultRules: DEFAULT_PROTECTED_POLICY_RULES };
    });
  }

  async replaceProjectPolicyConfiguration(
    principal: Principal,
    projectId: string,
    input: ReplaceProjectPolicyInput,
  ): Promise<ProjectPolicyView> {
    return this.tenantTransaction(principal, async (repository) => {
      const project = await this.requireProject(principal, projectId, repository);
      this.assertProjectOperator(principal, "Configuring project policy", projectId);
      this.assertSecretSafe("administration", input);
      const current = await repository.getProjectPolicyConfiguration(projectId);
      const currentVersion = current?.version ?? 0;
      if (input.expectedVersion !== currentVersion) {
        throw new BridgeError(
          "CONFLICT",
          "The project policy configuration changed after it was read.",
          409,
          { expectedVersion: input.expectedVersion, currentVersion },
        );
      }
      const timestamp = this.now().toISOString();
      const configuration: ProjectPolicyConfiguration = {
        organizationId: project.organizationId,
        projectId: project.id,
        rules: this.normalizeProjectPolicyRules(input.rules),
        version: currentVersion + 1,
        updatedById: principal.id,
        updatedAt: timestamp,
      };
      if (!await repository.saveProjectPolicyConfiguration(configuration, currentVersion)) {
        throw new BridgeError(
          "CONFLICT",
          "The project policy configuration changed while it was being saved.",
          409,
        );
      }
      await this.audit(
        repository,
        principal,
        projectId,
        "project.policy_configured",
        "policy_configuration",
        projectId,
        timestamp,
        configuration.version,
        undefined,
        { beforeVersion: currentVersion, afterVersion: configuration.version },
      );
      return { ...configuration, defaultRules: DEFAULT_PROTECTED_POLICY_RULES };
    });
  }

  async listOrganizationPrincipals(principal: Principal): Promise<readonly Principal[]> {
    return this.tenantTransaction(principal, async (repository) => {
      assertHuman(principal, "Reading the organization directory");
      const accessibleProjectIds = new Set(
        (await repository.listProjects(principal.organizationId))
          .filter((project) => {
            try {
              assertProjectAccess(principal, project);
              return true;
            } catch {
              return false;
            }
          })
          .map((project) => project.id),
      );
      return (await repository.listOrganizationPrincipals(principal.organizationId))
        .filter((candidate) => candidate.type === "human")
        .map((candidate) => ({
          ...candidate,
          projectIds: candidate.projectIds.filter((projectId) => accessibleProjectIds.has(projectId)),
          projectRoles: Object.fromEntries(
            Object.entries(candidate.projectRoles ?? {})
              .filter(([projectId]) => accessibleProjectIds.has(projectId)),
          ),
        }));
    });
  }

  async listOrganizationMembers(principal: Principal): Promise<readonly OrganizationMember[]> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertOrganizationAdministrator(principal, "Reading organization members");
      const memberships = await repository.listOrganizationMemberships(principal.organizationId);
      const members = await Promise.all(memberships.map(async (membership) => {
        const identity = await repository.getPrincipalIdentity(membership.principalId);
        if (!identity || identity.type !== "human") return undefined;
        return this.organizationMember(identity, membership, await repository.listProjectMemberships(
          principal.organizationId,
          identity.id,
        ));
      }));
      return members
        .filter((member): member is OrganizationMember => Boolean(member))
        .sort((left, right) => left.displayName.localeCompare(right.displayName));
    });
  }

  async listOrganizationProjectsForAdministration(principal: Principal): Promise<readonly Project[]> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertOrganizationAdministrator(principal, "Reading organization projects");
      return repository.listProjects(principal.organizationId);
    });
  }

  async listDirectoryGroups(principal: Principal): Promise<readonly DirectoryGroupView[]> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertOrganizationAdministrator(principal, "Reading directory groups");
      return Promise.all((await repository.listDirectoryGroups(principal.organizationId)).map(async (group) => ({
        group,
        members: await repository.listDirectoryGroupMembers(group.id),
      })));
    });
  }

  async createDirectoryGroup(
    principal: Principal,
    input: CreateDirectoryGroupInput,
  ): Promise<DirectoryGroupRegistration> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertOrganizationAdministrator(principal, "Configuring a directory group");
      this.assertSecretSafe("administration", input);
      if (!this.identityIssuer) {
        throw new BridgeError(
          "IDENTITY_NOT_CONFIGURED",
          "Directory group provisioning requires a configured OIDC issuer.",
          503,
        );
      }
      const issuer = `${input.issuer.replace(/\/+$/, "")}/`;
      if (issuer !== this.identityIssuer) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "The directory group issuer must match the configured organization identity issuer.",
          422,
        );
      }
      const provider = input.provider.trim().toLowerCase();
      const externalGroupId = input.externalGroupId.trim();
      const groupId = `dgr_${createHash("sha256")
        .update(`${principal.organizationId}:${provider}:${issuer}:${externalGroupId}`)
        .digest("hex")
        .slice(0, 24)}`;
      const existing = await repository.getDirectoryGroup(groupId);
      if (existing) {
        const exactReplay = existing.organizationId === principal.organizationId &&
          existing.provider === provider &&
          existing.issuer === issuer &&
          existing.externalGroupId === externalGroupId &&
          existing.displayName === input.displayName.trim();
        if (!exactReplay) {
          this.recordIdempotency("directory_group_create", "conflict");
          throw new BridgeError("CONFLICT", "This directory group has different configuration.", 409);
        }
        this.recordIdempotency("directory_group_create", "replayed");
        return {
          group: existing,
          members: await repository.listDirectoryGroupMembers(existing.id),
          disposition: "idempotent_replay",
        };
      }
      const timestamp = this.now().toISOString();
      const group: DirectoryGroup = {
        id: groupId,
        organizationId: principal.organizationId,
        provider,
        issuer,
        externalGroupId,
        displayName: input.displayName.trim(),
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      if (!await repository.saveDirectoryGroup(group)) {
        this.recordIdempotency("directory_group_create", "conflict");
        throw new BridgeError("CONFLICT", "The directory group was created concurrently.", 409);
      }
      await this.auditOrganizationEvent(
        repository,
        principal,
        "directory_group.created",
        group.id,
        timestamp,
        "directory_group",
        { beforeVersion: 0, afterVersion: group.version },
      );
      return { group, members: [], disposition: "created" };
    });
  }

  async syncDirectoryGroup(
    principal: Principal,
    groupId: string,
    input: SyncDirectoryGroupInput,
  ): Promise<DirectoryGroupSyncResult> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertDirectorySyncWriter(principal, "Synchronizing a directory group");
      this.assertSecretSafe("administration", input);
      const group = await repository.getDirectoryGroup(groupId);
      if (!group || group.organizationId !== principal.organizationId) {
        throw new BridgeError("DIRECTORY_GROUP_NOT_FOUND", "Directory group not found.", 404);
      }
      const sourceUpdatedAt = new Date(input.sourceUpdatedAt).toISOString();
      const normalizedMembers = [...input.members]
        .map((member) => ({
          subject: member.subject.trim(),
          displayName: member.displayName.trim(),
        }))
        .sort((left, right) => left.subject.localeCompare(right.subject));
      const existingMembers = await repository.listDirectoryGroupMembers(group.id);
      const activeSnapshot = existingMembers
        .filter((member) => member.status === "active")
        .map((member) => ({ subject: member.externalSubject, displayName: member.displayName }))
        .sort((left, right) => left.subject.localeCompare(right.subject));
      if (group.sourceUpdatedAt) {
        const sourceOrder = sourceUpdatedAt.localeCompare(group.sourceUpdatedAt);
        const sameSnapshot = group.status === input.status &&
          JSON.stringify(activeSnapshot) === JSON.stringify(normalizedMembers);
        if (sourceOrder < 0 || (sourceOrder === 0 && !sameSnapshot)) {
          this.recordIdempotency("directory_group_sync", "conflict");
          throw new BridgeError(
            "CONFLICT",
            "The directory group event is stale or conflicts with the stored provider version.",
            409,
            { currentVersion: group.version, sourceUpdatedAt: group.sourceUpdatedAt },
          );
        }
        if (sourceOrder === 0 && sameSnapshot) {
          this.recordIdempotency("directory_group_sync", "replayed");
          return {
            group,
            members: existingMembers,
            disposition: "idempotent_replay",
            membershipChanges: { provisioned: 0, reactivated: 0, disabled: 0, preserved: 0 },
            humanApprovalChanged: false,
          };
        }
      }
      if (group.version !== input.expectedVersion) {
        this.recordIdempotency("directory_group_sync", "conflict");
        throw new BridgeError("CONFLICT", "The directory group changed after it was read.", 409, {
          expectedVersion: input.expectedVersion,
          currentVersion: group.version,
        });
      }
      const timestamp = this.now().toISOString();
      const existingBySubject = new Map(
        existingMembers.map((member) => [member.externalSubject, member]),
      );
      const desiredSubjects = new Set(normalizedMembers.map((member) => member.subject));
      const changes = { provisioned: 0, reactivated: 0, disabled: 0, preserved: 0 };
      for (const desired of normalizedMembers) {
        let identity = await repository.getPrincipalIdentityByOidc(group.issuer, desired.subject);
        if (!identity) {
          identity = {
            id: `usr_${createHash("sha256")
              .update(`${group.issuer}:${desired.subject}`)
              .digest("hex")
              .slice(0, 24)}`,
            type: "human",
            displayName: desired.displayName,
            oidcIssuer: group.issuer,
            oidcSubject: desired.subject,
            createdAt: timestamp,
          };
          await repository.savePrincipalIdentity(identity);
        } else if (identity.type !== "human") {
          throw new BridgeError("CONFLICT", "A directory member subject belongs to a service principal.", 409);
        } else if (identity.displayName !== desired.displayName) {
          identity = { ...identity, displayName: desired.displayName };
          await repository.savePrincipalIdentity(identity);
        }
        const membership = await repository.getOrganizationMembership(
          principal.organizationId,
          identity.id,
        );
        if (!membership) {
          await repository.saveOrganizationMembership({
            organizationId: principal.organizationId,
            principalId: identity.id,
            status: "active",
            roles: [],
            allProjects: false,
            provisioning: "directory",
            createdAt: timestamp,
            updatedAt: timestamp,
            version: 1,
          });
          changes.provisioned += 1;
        } else if (membership.provisioning === "directory" && membership.status === "disabled") {
          if (!await repository.saveOrganizationMembership({
            ...membership,
            status: "active",
            updatedAt: timestamp,
            version: membership.version + 1,
          }, membership.version)) {
            throw new BridgeError("CONFLICT", "A directory membership changed during synchronization.", 409);
          }
          changes.reactivated += 1;
        } else if (membership.provisioning === "manual") {
          changes.preserved += 1;
        }
        const existingMember = existingBySubject.get(desired.subject);
        if (existingMember) {
          if (
            existingMember.status !== "active" ||
            existingMember.displayName !== desired.displayName ||
            existingMember.principalId !== identity.id
          ) {
            if (!await repository.saveDirectoryGroupMember({
              ...existingMember,
              principalId: identity.id,
              displayName: desired.displayName,
              status: "active",
              updatedAt: timestamp,
              version: existingMember.version + 1,
            }, existingMember.version)) {
              throw new BridgeError("CONFLICT", "A directory group member changed during synchronization.", 409);
            }
          }
        } else {
          const groupMember: DirectoryGroupMember = {
            id: `dgm_${createHash("sha256")
              .update(`${group.id}:${desired.subject}`)
              .digest("hex")
              .slice(0, 24)}`,
            organizationId: principal.organizationId,
            groupId: group.id,
            principalId: identity.id,
            externalSubject: desired.subject,
            displayName: desired.displayName,
            status: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
            version: 1,
          };
          if (!await repository.saveDirectoryGroupMember(groupMember)) {
            throw new BridgeError("CONFLICT", "A directory group member was created concurrently.", 409);
          }
        }
      }
      const removedPrincipalIds = new Set<string>();
      for (const existing of existingMembers) {
        if (existing.status !== "active" || desiredSubjects.has(existing.externalSubject)) continue;
        if (!await repository.saveDirectoryGroupMember({
          ...existing,
          status: "removed",
          updatedAt: timestamp,
          version: existing.version + 1,
        }, existing.version)) {
          throw new BridgeError("CONFLICT", "A directory group member changed during synchronization.", 409);
        }
        removedPrincipalIds.add(existing.principalId);
      }
      for (const principalId of removedPrincipalIds) {
        const remainsInDirectory = (await repository.listDirectoryGroupMembersForPrincipal(
          principal.organizationId,
          principalId,
        )).some((member) => member.status === "active");
        const membership = await repository.getOrganizationMembership(principal.organizationId, principalId);
        if (remainsInDirectory || !membership || membership.status !== "active") continue;
        if (membership.provisioning === "manual") {
          changes.preserved += 1;
          continue;
        }
        if (!await repository.saveOrganizationMembership({
          ...membership,
          status: "disabled",
          updatedAt: timestamp,
          version: membership.version + 1,
        }, membership.version)) {
          throw new BridgeError("CONFLICT", "A directory membership changed during synchronization.", 409);
        }
        changes.disabled += 1;
      }
      const updatedGroup: DirectoryGroup = {
        ...group,
        status: input.status,
        sourceUpdatedAt,
        updatedAt: timestamp,
        version: group.version + 1,
      };
      if (!await repository.saveDirectoryGroup(updatedGroup, group.version)) {
        this.recordIdempotency("directory_group_sync", "conflict");
        throw new BridgeError("CONFLICT", "The directory group changed during synchronization.", 409);
      }
      await this.auditOrganizationEvent(
        repository,
        principal,
        "directory_group.synced",
        group.id,
        timestamp,
        "directory_group",
        { beforeVersion: group.version, afterVersion: updatedGroup.version },
      );
      this.recordIdempotency("directory_group_sync", "updated");
      return {
        group: updatedGroup,
        members: await repository.listDirectoryGroupMembers(group.id),
        disposition: "updated",
        membershipChanges: changes,
        humanApprovalChanged: false,
      };
    });
  }

  async listServiceIdentities(principal: Principal): Promise<readonly ServiceIdentity[]> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertOrganizationAdministrator(principal, "Reading service identities");
      const credentials = await repository.listServiceCredentials(principal.organizationId);
      const identities = await Promise.all(credentials.map(async (credential) => {
        const identity = await repository.getPrincipalIdentity(credential.principalId);
        const membership = await repository.getOrganizationMembership(
          principal.organizationId,
          credential.principalId,
        );
        if (!identity || !membership || identity.type === "human") return undefined;
        return this.serviceIdentity(credential, identity, membership, await repository.listProjectMemberships(
          principal.organizationId,
          credential.principalId,
        ));
      }));
      return identities
        .filter((identity): identity is ServiceIdentity => Boolean(identity))
        .sort((left, right) => left.name.localeCompare(right.name));
    });
  }

  async createServiceIdentity(
    principal: Principal,
    input: CreateServiceIdentityInput,
  ): Promise<ServiceIdentityRegistration> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertOrganizationAdministrator(principal, "Creating a service identity");
      this.assertSecretSafe("administration", input);
      const configuredProjects = await this.configuredProjectMemberships(
        principal,
        input.projectMemberships,
        repository,
      );
      const timestamp = this.now().toISOString();
      const expiresAt = input.expiresAt ?? new Date(this.now().getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const expiresDate = new Date(expiresAt);
      if (Number.isNaN(expiresDate.getTime()) || expiresDate.toISOString() <= timestamp) {
        throw new BridgeError("VALIDATION_FAILED", "Service identity expiry must be in the future.", 400);
      }
      if (expiresDate.getTime() > this.now().getTime() + 365 * 24 * 60 * 60 * 1000) {
        throw new BridgeError("VALIDATION_FAILED", "Service identity expiry cannot exceed one year.", 400);
      }
      const identityId = `svc_${this.id()}`;
      const credentialId = `scr_${this.id()}`;
      const identity: PrincipalIdentity = {
        id: identityId,
        type: input.type,
        displayName: input.name,
        oidcIssuer: "bridge-service",
        oidcSubject: identityId,
        createdAt: timestamp,
      };
      const membership: OrganizationMembership = {
        organizationId: principal.organizationId,
        principalId: identityId,
        status: "active",
        roles: this.normalizedRoles(input.roles),
        allProjects: input.allProjects,
        provisioning: "manual",
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      const projectMembershipRecords: ProjectMembership[] = [];
      for (const configured of configuredProjects) {
        projectMembershipRecords.push({
          organizationId: principal.organizationId,
          projectId: configured.projectId,
          principalId: identityId,
          status: "active",
          roles: configured.roles,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
        });
      }
      const token = `brg_srv_${randomBytes(32).toString("base64url")}`;
      const credential: ServiceCredential = {
        id: credentialId,
        organizationId: principal.organizationId,
        principalId: identityId,
        name: input.name,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        scopes: [...new Set(input.scopes)],
        createdAt: timestamp,
        expiresAt: expiresDate.toISOString(),
        version: 1,
      };
      await repository.savePrincipalIdentity(identity);
      await repository.saveOrganizationMembership(membership);
      for (const projectMembership of projectMembershipRecords) {
        await repository.saveProjectMembership(projectMembership);
      }
      await repository.saveServiceCredential(credential);
      await this.auditOrganizationEvent(
        repository,
        principal,
        "service_identity.created",
        credential.id,
        timestamp,
        "service_credential",
        { beforeVersion: 0, afterVersion: credential.version },
      );
      return {
        serviceIdentity: this.serviceIdentity(credential, identity, membership, projectMembershipRecords),
        token,
      };
    });
  }

  async revokeServiceIdentity(
    principal: Principal,
    serviceCredentialId: string,
    input: RevokeServiceIdentityInput,
  ): Promise<ServiceIdentity> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertOrganizationAdministrator(principal, "Revoking a service identity");
      const credential = await repository.getServiceCredential(serviceCredentialId);
      if (!credential || credential.organizationId !== principal.organizationId) {
        throw new BridgeError("MEMBER_NOT_FOUND", "Service identity not found.", 404);
      }
      if (credential.version !== input.expectedVersion) {
        throw new BridgeError("CONFLICT", "The service identity changed after it was read.", 409, {
          expectedVersion: input.expectedVersion,
          currentVersion: credential.version,
        });
      }
      const identity = await repository.getPrincipalIdentity(credential.principalId);
      const membership = await repository.getOrganizationMembership(principal.organizationId, credential.principalId);
      if (!identity || !membership || identity.type === "human") {
        throw new BridgeError("MEMBER_NOT_FOUND", "Service identity not found.", 404);
      }
      const revokedAt = credential.revokedAt ?? this.now().toISOString();
      const revoked = { ...credential, revokedAt, version: credential.version + 1 };
      if (!await repository.revokeServiceCredential(revoked, credential.version)) {
        throw new BridgeError("CONFLICT", "The service identity changed while it was being revoked.", 409);
      }
      await this.auditOrganizationEvent(
        repository,
        principal,
        "service_identity.revoked",
        credential.id,
        revokedAt,
        "service_credential",
        { beforeVersion: credential.version, afterVersion: revoked.version },
      );
      return this.serviceIdentity(
        revoked,
        identity,
        membership,
        await repository.listProjectMemberships(principal.organizationId, credential.principalId),
      );
    });
  }

  async rotateServiceIdentity(
    principal: Principal,
    serviceCredentialId: string,
    input: RotateServiceIdentityInput,
  ): Promise<ServiceIdentityRegistration> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertOrganizationAdministrator(principal, "Rotating a service identity");
      const credential = await repository.getServiceCredential(serviceCredentialId);
      if (!credential || credential.organizationId !== principal.organizationId) {
        throw new BridgeError("MEMBER_NOT_FOUND", "Service identity not found.", 404);
      }
      if (credential.version !== input.expectedVersion) {
        throw new BridgeError("CONFLICT", "The service identity changed after it was read.", 409, {
          expectedVersion: input.expectedVersion,
          currentVersion: credential.version,
        });
      }
      if (credential.revokedAt) {
        throw new BridgeError("CONFLICT", "A revoked service identity cannot be rotated.", 409);
      }
      const expiresAt = Date.parse(credential.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= this.now().getTime()) {
        throw new BridgeError("VALIDATION_FAILED", "An expired service identity cannot be rotated; create a new identity.", 400);
      }
      const identity = await repository.getPrincipalIdentity(credential.principalId);
      const membership = await repository.getOrganizationMembership(principal.organizationId, credential.principalId);
      if (!identity || !membership || identity.type === "human") {
        throw new BridgeError("MEMBER_NOT_FOUND", "Service identity not found.", 404);
      }
      const projectMemberships = (await repository.listProjectMemberships(
        principal.organizationId,
        credential.principalId,
      )).filter((projectMembership) => projectMembership.status === "active");
      const timestamp = this.now().toISOString();
      const token = `brg_srv_${randomBytes(32).toString("base64url")}`;
      const rotated: ServiceCredential = {
        ...credential,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        rotatedAt: timestamp,
        version: credential.version + 1,
      };
      if (!await repository.rotateServiceCredential(rotated, credential.version)) {
        throw new BridgeError("CONFLICT", "The service identity changed while it was being rotated.", 409);
      }
      await this.auditOrganizationEvent(
        repository,
        principal,
        "service_identity.rotated",
        credential.id,
        timestamp,
        "service_credential",
        { beforeVersion: credential.version, afterVersion: rotated.version },
      );
      return {
        serviceIdentity: this.serviceIdentity(rotated, identity, membership, projectMemberships),
        token,
      };
    });
  }

  async createOrganizationMember(
    principal: Principal,
    input: CreateOrganizationMemberInput,
  ): Promise<OrganizationMemberRegistration> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertOrganizationAdministrator(principal, "Creating an organization member");
      this.assertSecretSafe("administration", input);
      if (!this.identityIssuer) {
        throw new BridgeError(
          "IDENTITY_NOT_CONFIGURED",
          "Organization member creation requires a configured OIDC issuer.",
          503,
        );
      }
      const configuredProjects = await this.configuredProjectMemberships(
        principal,
        input.projectMemberships,
        repository,
      );
      const roles = this.normalizedRoles(input.roles);
      const timestamp = this.now().toISOString();
      let identity = await repository.getPrincipalIdentityByOidc(this.identityIssuer, input.oidcSubject);
      if (!identity) {
        identity = {
          id: `usr_${createHash("sha256")
            .update(`${this.identityIssuer}:${input.oidcSubject}`)
            .digest("hex")
            .slice(0, 24)}`,
          type: "human",
          displayName: input.displayName,
          oidcIssuer: this.identityIssuer,
          oidcSubject: input.oidcSubject,
          createdAt: timestamp,
        };
        await repository.savePrincipalIdentity(identity);
      }
      if (identity.type !== "human") {
        throw new BridgeError("CONFLICT", "The OIDC subject belongs to a non-human principal.", 409);
      }
      const existing = await repository.getOrganizationMembership(principal.organizationId, identity.id);
      if (existing) {
        const existingProjects = await repository.listProjectMemberships(principal.organizationId, identity.id);
        const exactReplay = identity.displayName === input.displayName &&
          existing.status === "active" &&
          existing.allProjects === input.allProjects &&
          this.sameRoles(existing.roles, roles) &&
          this.sameProjectMembershipConfiguration(existingProjects, configuredProjects);
        if (!exactReplay) {
          this.recordIdempotency("organization_member_create", "conflict");
          throw new BridgeError(
            "CONFLICT",
            "This identity already has an organization membership with different configuration.",
            409,
          );
        }
        this.recordIdempotency("organization_member_create", "replayed");
        return {
          member: this.organizationMember(identity, existing, existingProjects),
          disposition: "idempotent_replay",
        };
      }
      const membership: OrganizationMembership = {
        organizationId: principal.organizationId,
        principalId: identity.id,
        status: "active",
        roles,
        allProjects: input.allProjects,
        provisioning: "manual",
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      await repository.saveOrganizationMembership(membership);
      const projectMembershipRecords: ProjectMembership[] = [];
      for (const configured of configuredProjects) {
        const projectMembership: ProjectMembership = {
          organizationId: principal.organizationId,
          projectId: configured.projectId,
          principalId: identity.id,
          status: "active",
          roles: configured.roles,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
        };
        await repository.saveProjectMembership(projectMembership);
        projectMembershipRecords.push(projectMembership);
      }
      await this.auditOrganizationMember(
        repository,
        principal,
        "organization_member.created",
        identity.id,
        timestamp,
        { beforeVersion: 0, afterVersion: membership.version },
      );
      this.recordIdempotency("organization_member_create", "created");
      return {
        member: this.organizationMember(identity, membership, projectMembershipRecords),
        disposition: "created",
      };
    });
  }

  async updateOrganizationMember(
    principal: Principal,
    memberId: string,
    input: UpdateOrganizationMemberInput,
  ): Promise<OrganizationMember> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertOrganizationAdministrator(principal, "Updating an organization member");
      this.assertSecretSafe("administration", input);
      const identity = await repository.getPrincipalIdentity(memberId);
      const current = await repository.getOrganizationMembership(principal.organizationId, memberId);
      if (!identity || identity.type !== "human" || !current) {
        throw new BridgeError("MEMBER_NOT_FOUND", "Organization member not found.", 404);
      }
      if (current.version !== input.expectedVersion) {
        throw new BridgeError("CONFLICT", "The member configuration changed after it was read.", 409, {
          expectedVersion: input.expectedVersion,
          currentVersion: current.version,
        });
      }
      const roles = this.normalizedRoles(input.roles);
      const remainsAdministrator = input.status === "active" && roles.includes("organization-admin");
      if (
        current.status === "active" &&
        current.roles.some((role) => normalizeRoleName(role) === "organization-admin") &&
        !remainsAdministrator
      ) {
        const activeAdministrators = (await repository.listOrganizationMemberships(principal.organizationId))
          .filter((membership) => membership.status === "active" &&
            membership.roles.some((role) => normalizeRoleName(role) === "organization-admin"));
        if (activeAdministrators.length <= 1) {
          throw new BridgeError(
            "LAST_ORGANIZATION_ADMIN",
            "The final active organization administrator cannot be disabled or demoted.",
            409,
          );
        }
      }
      const configuredProjects = await this.configuredProjectMemberships(
        principal,
        input.projectMemberships,
        repository,
      );
      const timestamp = this.now().toISOString();
      const updatedMembership: OrganizationMembership = {
        ...current,
        status: input.status,
        roles,
        allProjects: input.allProjects,
        provisioning: "manual",
        updatedAt: timestamp,
        version: current.version + 1,
      };
      if (!await repository.saveOrganizationMembership(updatedMembership, current.version)) {
        throw new BridgeError("CONFLICT", "The member configuration changed while it was being saved.", 409);
      }
      const existingProjects = await repository.listProjectMemberships(principal.organizationId, memberId);
      const desiredByProject = new Map(configuredProjects.map((membership) => [membership.projectId, membership]));
      const savedProjects: ProjectMembership[] = [];
      for (const existing of existingProjects) {
        const desired = desiredByProject.get(existing.projectId);
        const updatedProject: ProjectMembership = {
          ...existing,
          status: desired ? "active" : "disabled",
          roles: desired?.roles ?? existing.roles,
          updatedAt: timestamp,
          version: existing.version + 1,
        };
        if (!await repository.saveProjectMembership(updatedProject, existing.version)) {
          throw new BridgeError("CONFLICT", "A project membership changed while it was being saved.", 409);
        }
        savedProjects.push(updatedProject);
        desiredByProject.delete(existing.projectId);
      }
      for (const desired of desiredByProject.values()) {
        const projectMembership: ProjectMembership = {
          organizationId: principal.organizationId,
          projectId: desired.projectId,
          principalId: memberId,
          status: "active",
          roles: desired.roles,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
        };
        await repository.saveProjectMembership(projectMembership);
        savedProjects.push(projectMembership);
      }
      await this.auditOrganizationMember(
        repository,
        principal,
        "organization_member.updated",
        memberId,
        timestamp,
        { beforeVersion: current.version, afterVersion: updatedMembership.version },
      );
      return this.organizationMember(identity, updatedMembership, savedProjects);
    });
  }

  async getProject(principal: Principal, projectId: string): Promise<Project> {
    return this.tenantTransaction(principal, (repository) =>
      this.requireProject(principal, projectId, repository));
  }

  async listNotifications(
    principal: Principal,
    query: Partial<NotificationListQuery> = {},
  ): Promise<readonly Notification[]> {
    return this.tenantTransaction(principal, async (repository) => {
      assertHuman(principal, "Reading notifications");
      if (query.projectId) await this.requireProject(principal, query.projectId, repository);
      const notifications = await repository.listNotifications(
        principal.organizationId,
        principal.id,
        query.projectId,
        query.unreadOnly,
      );
      if (query.projectId) return notifications;
      const accessibleProjectIds = new Set(
        (await repository.listProjects(principal.organizationId))
          .filter((project) => {
            try {
              assertProjectAccess(principal, project);
              return true;
            } catch {
              return false;
            }
          })
          .map((project) => project.id),
      );
      return notifications.filter((notification) => accessibleProjectIds.has(notification.projectId));
    });
  }

  async listNotificationPreferences(
    principal: Principal,
  ): Promise<readonly NotificationPreference[]> {
    return this.tenantTransaction(principal, async (repository) => {
      assertHuman(principal, "Reading notification preferences");
      return repository.listNotificationPreferences(principal.organizationId, principal.id);
    });
  }

  async setNotificationPreference(
    principal: Principal,
    input: NotificationPreferenceInput,
  ): Promise<NotificationPreference> {
    return this.tenantTransaction(principal, async (repository) => {
      assertHuman(principal, "Updating notification preferences");
      if (input.channel !== "email") {
        throw new BridgeError("VALIDATION_FAILED", "Only email notification preferences are supported.", 422);
      }
      const preference: NotificationPreference = {
        organizationId: principal.organizationId,
        principalId: principal.id,
        channel: input.channel,
        preference: input.preference,
        updatedAt: this.now().toISOString(),
      };
      await repository.saveNotificationPreference(preference);
      return preference;
    });
  }

  async markNotificationRead(principal: Principal, notificationId: string): Promise<Notification> {
    return this.tenantTransaction(principal, async (repository) => {
      assertHuman(principal, "Marking a notification read");
      const notification = await repository.getNotification(notificationId);
      if (
        !notification ||
        notification.organizationId !== principal.organizationId ||
        notification.recipientId !== principal.id
      ) {
        throw new BridgeError("NOTIFICATION_NOT_FOUND", "Notification not found.", 404);
      }
      await this.requireProjectForResource(
        principal,
        notification.projectId,
        repository,
        "NOTIFICATION_NOT_FOUND",
        "Notification not found.",
      );
      if (notification.readAt) return notification;
      const updated = { ...notification, readAt: this.now().toISOString() };
      await repository.saveNotification(updated);
      return updated;
    });
  }

  async markAllNotificationsRead(
    principal: Principal,
    input: NotificationReadAllInput = {},
  ): Promise<{ readonly markedCount: number }> {
    return this.tenantTransaction(principal, async (repository) => {
      assertHuman(principal, "Marking notifications read");
      if (input.projectId) await this.requireProject(principal, input.projectId, repository);
      const notifications = await repository.listNotifications(
        principal.organizationId,
        principal.id,
        input.projectId,
        true,
      );
      let notificationsToMark = notifications;
      if (!input.projectId) {
        const accessibleProjectIds = new Set(
          (await repository.listProjects(principal.organizationId))
            .filter((project) => {
              try {
                assertProjectAccess(principal, project);
                return true;
              } catch {
                return false;
              }
            })
            .map((project) => project.id),
        );
        notificationsToMark = notifications.filter((notification) => accessibleProjectIds.has(notification.projectId));
      }
      const readAt = this.now().toISOString();
      for (const notification of notificationsToMark) {
        await repository.saveNotification({ ...notification, readAt });
      }
      return { markedCount: notificationsToMark.length };
    });
  }

  async inspectProjectOutbox(
    principal: Principal,
    projectId: string,
    query: OutboxOperationsQuery,
  ): Promise<OutboxOperationsView> {
    return this.tenantTransaction(principal, async (repository) => {
    await this.requireProject(principal, projectId, repository);
    this.assertProjectOperator(principal, "Inspecting delivery operations", projectId);
    const events = await repository.listOutboxEvents(projectId);
    const deliveries = await repository.listOutboxDeliveries(projectId);
    const nowTime = this.now().getTime();
    const statusCounts: Record<OutboxEvent["status"], number> = {
      pending: 0,
      processing: 0,
      processed: 0,
      failed: 0,
      dead_letter: 0,
    };
    const deliveryStatusCounts: Record<OutboxDelivery["status"], number> = {
      delivered: 0,
      failed: 0,
      suppressed: 0,
      deferred: 0,
    };
    for (const delivery of deliveries) deliveryStatusCounts[delivery.status] += 1;
    let totalAttempts = 0;
    let expiredLeaseCount = 0;
    const readyEvents: OutboxEvent[] = [];
    for (const event of events) {
      statusCounts[event.status] += 1;
      totalAttempts += event.attempts;
      const leaseExpired = event.status === "processing" &&
        Boolean(event.leaseUntil) && Date.parse(event.leaseUntil!) <= nowTime;
      if (leaseExpired) expiredLeaseCount += 1;
      const processingReady = event.status === "processing" &&
        (!event.leaseUntil || Date.parse(event.leaseUntil) <= nowTime);
      const retryable = event.status === "pending" || event.status === "failed" || processingReady;
      if (retryable && Date.parse(event.availableAt) <= nowTime) readyEvents.push(event);
    }
    const oldestReadyAt = readyEvents
      .map((event) => event.availableAt)
      .sort((left, right) => left.localeCompare(right))[0];
    const matching = events.filter((event) =>
      (!query.status || event.status === query.status) &&
      (!query.type || event.type === query.type),
    );
    return {
      items: matching.slice(0, query.limit),
      deliveries: deliveries.filter((delivery) =>
        matching.some((event) => event.id === delivery.outboxEventId),
      ),
      totalMatching: matching.length,
      metrics: {
        total: events.length,
        statusCounts,
        failedCount: statusCounts.failed + statusCounts.dead_letter,
        totalAttempts,
        readyCount: readyEvents.length,
        expiredLeaseCount,
        deliveryStatusCounts,
        ...(oldestReadyAt
          ? {
              oldestReadyAt,
              oldestReadyAgeMs: Math.max(0, nowTime - Date.parse(oldestReadyAt)),
            }
          : {}),
      },
    };
    });
  }

  async getProjectAnalytics(
    principal: Principal,
    projectId: string,
    query: ProjectAnalyticsQuery,
  ): Promise<ProjectAnalyticsView> {
    return this.tenantTransaction(principal, async (repository) => {
    await this.requireProject(principal, projectId, repository);
    this.assertProjectOperator(principal, "Reading project analytics", projectId);
    const [allRuns, snapshots, questions, decisions, assumptions, artifacts] = await Promise.all([
      repository.listRuns(projectId),
      repository.listContextSnapshots(projectId),
      repository.listQuestions(projectId),
      repository.listDecisions(projectId),
      repository.listAssumptions(projectId),
      repository.listArtifacts(projectId),
    ]);
    const runs = allRuns.filter((run) =>
      (!query.client || run.client === query.client) &&
      (!query.startedFrom || Date.parse(run.startedAt) >= Date.parse(query.startedFrom)) &&
      (!query.startedTo || Date.parse(run.startedAt) <= Date.parse(query.startedTo)),
    );
    const source: AnalyticsSource = { snapshots, questions, decisions, assumptions, artifacts };
    const cohort = calculateAnalyticsCohort(runs, source);
    const clients = [...new Set(runs.map((run) => run.client))].sort((left, right) => left.localeCompare(right));
    const byClient = clients.map((client): ProjectAnalyticsClientBreakdown => {
      const clientRuns = runs.filter((run) => run.client === client);
      const clientCohort = calculateAnalyticsCohort(clientRuns, source);
      return {
        client,
        runCount: clientRuns.length,
        contextRetrievals: clientCohort.activity.contextRetrievals,
        questionSubmissions: clientCohort.activity.questionSubmissions,
        questionsReused: clientCohort.activity.questionsReused,
        decisionsAccepted: clientCohort.activity.decisionsAccepted,
        decisionReuseOccurrences: clientCohort.activity.decisionReuseOccurrences,
        assumptionsRecorded: clientCohort.activity.assumptionsRecorded,
      };
    });
    return {
      projectId,
      generatedAt: this.now().toISOString(),
      cohort: {
        runCount: runs.length,
        ...(query.client ? { client: query.client } : {}),
        ...(query.startedFrom ? { startedFrom: query.startedFrom } : {}),
        ...(query.startedTo ? { startedTo: query.startedTo } : {}),
      },
      ...cohort,
      byClient,
      privacy: {
        derivedFrom: [
          "agent run client, capability, status, timestamps, and linked record identifiers",
          "context snapshot timestamps and returned record identifiers",
          "question routing, lifecycle, response, and accepted-decision metadata",
          "assumption lifecycle and specification version approval metadata",
        ],
        excluded: [
          "raw prompts, agent outputs, transcripts, and hidden reasoning",
          "task summaries, question text, responses, comments, decision text, and assumption text",
          "specification titles, summaries, bodies, hashes, and review text",
          "principal names, notification content, external links, secrets, and credentials",
        ],
      },
    };
    });
  }

  async recordAdapterDiagnostic(
    principal: Principal,
    projectId: string,
    input: RecordAdapterDiagnosticInput,
  ): Promise<AdapterDiagnostic> {
    return this.tenantTransaction(principal, async (repository) => {
      const project = await this.requireProject(principal, projectId, repository);
      const diagnostic: AdapterDiagnostic = {
        organizationId: project.organizationId,
        projectId,
        client: input.client,
        reportedById: principal.id,
        reportedByType: principal.type,
        correlationId: currentCorrelationId() ?? createCorrelationId(),
        capabilities: input.capabilities,
        mcpStatus: input.mcpStatus,
        checks: input.checks,
        status: input.checks.every((check) => check.status === "pass") ? "pass" : "fail",
        observedAt: this.now().toISOString(),
      };
      await repository.saveAdapterDiagnostic(diagnostic);
      return diagnostic;
    });
  }

  async getProjectSupport(principal: Principal, projectId: string): Promise<ProjectSupportView> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      this.assertProjectOperator(principal, "Reading project support operations", projectId);
      const [questions, decisions, assumptions, runs, events, adapterDiagnostics] = await Promise.all([
        repository.listQuestions(projectId),
        repository.listDecisions(projectId),
        repository.listAssumptions(projectId),
        repository.listRuns(projectId),
        repository.listOutboxEvents(projectId),
        repository.listAdapterDiagnostics(projectId),
      ]);
      const questionById = new Map(questions.map((question) => [question.id, question]));
      const now = this.now().getTime();
      const unroutedQuestions = questions
        .filter((question) =>
          ["open", "in_discussion"].includes(question.status) &&
          question.ownerIds.length === 0 &&
          question.ownerRoles.length === 0,
        )
        .map((question) => ({
          id: question.id,
          title: question.title,
          category: question.category,
          risk: question.risk,
          blocking: question.blocking,
          status: question.status,
          ownerIds: question.ownerIds,
          ownerRoles: question.ownerRoles,
          createdAt: question.createdAt,
        }));
      const overdueProtected = decisions.flatMap((decision) => {
        if (!decision.questionId) return [];
        const question = questionById.get(decision.questionId);
        return decision.status === "active" &&
          question?.risk === "protected" &&
          Date.parse(decision.reviewAt) <= now
          ? [{
              id: decision.id,
              questionId: decision.questionId,
              category: decision.category,
              ownerId: decision.ownerId,
              status: decision.status,
              reviewAt: decision.reviewAt,
            }]
          : [];
      });
      const expiringAssumptions = assumptions
        .filter((assumption) => {
          if (assumption.status !== "active") return false;
          const expiresAt = Date.parse(assumption.expiresAt);
          return Number.isFinite(expiresAt) && expiresAt <= now + SUPPORT_ASSUMPTION_EXPIRY_WINDOW_MS;
        })
        .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))
        .map((assumption) => ({
          id: assumption.id,
          category: assumption.category,
          risk: assumption.risk,
          confidence: assumption.confidence,
          expiresAt: assumption.expiresAt,
          overdue: Date.parse(assumption.expiresAt) <= now,
          createdById: assumption.createdById,
          ...(assumption.runId ? { runId: assumption.runId } : {}),
        }));
      const remainingBlockingQuestionCounts = new Map<string, number>();
      for (const question of questions) {
        if (
          question.runId &&
          question.blocking &&
          ["open", "in_discussion"].includes(question.status)
        ) {
          remainingBlockingQuestionCounts.set(
            question.runId,
            (remainingBlockingQuestionCounts.get(question.runId) ?? 0) + 1,
          );
        }
      }
      const blockedRuns = runs
        .filter((run) => run.status === "waiting_for_human")
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
        .map((run) => ({
          id: run.id,
          client: run.client,
          capability: run.capability,
          status: "waiting_for_human" as const,
          remainingBlockingQuestionCount: remainingBlockingQuestionCounts.get(run.id) ?? 0,
          startedAt: run.startedAt,
          updatedAt: run.updatedAt,
        }));
      const adapterMap = new Map<AgentRun["client"], AgentRun[]>();
      for (const run of runs) {
        const existing = adapterMap.get(run.client) ?? [];
        existing.push(run);
        adapterMap.set(run.client, existing);
      }
      const capabilityOrder: readonly AgentRun["capability"][] = [
        "instructions",
        "cli",
        "mcp",
        "hooks",
        "orchestrated",
      ];
      const adapters = [...adapterMap.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([client, clientRuns]) => {
          const capabilities = capabilityOrder.filter((capability) =>
            clientRuns.some((run) => run.capability === capability),
          );
          const mcpRuns = clientRuns
            .filter((run) => run.capability === "mcp" && run.status === "completed")
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
          const lastObservedAt = clientRuns
            .map((run) => run.updatedAt)
            .sort((left, right) => right.localeCompare(left))[0];
          return {
            client,
            runCount: clientRuns.length,
            capabilities,
            ...(lastObservedAt ? { lastObservedAt } : {}),
            ...(mcpRuns[0]?.updatedAt ? { lastSuccessfulMcpRunAt: mcpRuns[0].updatedAt } : {}),
          };
        });
      return {
        projectId,
        generatedAt: this.now().toISOString(),
        routing: { unroutedQuestions },
        decisions: { overdueProtected },
        assumptions: { expiring: expiringAssumptions },
        runs: { blocked: blockedRuns },
        delivery: {
          pendingCount: events.filter((event) => event.status === "pending" || event.status === "processing").length,
          failedCount: events.filter((event) => event.status === "failed" || event.status === "dead_letter").length,
          deadLetterEvents: events
            .filter((event) => event.status === "dead_letter")
            .slice(0, 50)
            .map((event) => ({
              id: event.id,
              type: event.type,
              attempts: event.attempts,
              createdAt: event.createdAt,
              availableAt: event.availableAt,
              hasError: Boolean(event.lastError),
            })),
        },
        adapters: {
          items: adapters,
          mcpDiagnostics: adapters.some((adapter) => adapter.capabilities.includes("mcp"))
            ? "observed_from_runs"
            : adapterDiagnostics.length > 0 ? "observed_from_doctor" : "not_reported",
          note: "Capabilities are derived from recorded runs; the latest bounded `bridge doctor` report is shown separately.",
        },
        diagnostics: adapterDiagnostics.map((diagnostic) => {
          const failingCheckNames = diagnostic.checks
            .filter((check) => check.status === "fail")
            .map((check) => check.name);
          return {
            client: diagnostic.client,
            status: diagnostic.status,
            capabilities: diagnostic.capabilities,
            mcpStatus: diagnostic.mcpStatus,
            checks: diagnostic.checks,
            checkCount: diagnostic.checks.length,
            passedCheckCount: diagnostic.checks.length - failingCheckNames.length,
            failingCheckNames,
            observedAt: diagnostic.observedAt,
          };
        }),
      };
    });
  }

  async listOrganizationAudit(principal: Principal, query: AuditListQuery): Promise<AuditPage> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertOrganizationAdministrator(principal, "Reading organization audit events");
      const events = (await repository.listOrganizationAuditEvents(principal.organizationId))
        .map((event): AuditRecord => ({ ...event, scope: "organization" }));
      return this.auditPage(events, query);
    });
  }

  async listProjectAudit(
    principal: Principal,
    projectId: string,
    query: AuditListQuery,
  ): Promise<AuditPage> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      this.assertProjectOperator(principal, "Reading project audit events", projectId);
      const events = (await repository.listAuditEvents(projectId))
        .map((event): AuditRecord => ({ ...event, scope: "project" }));
      return this.auditPage(events, query);
    });
  }

  async exportOrganizationAudit(
    principal: Principal,
    input: AuditExportInput,
  ): Promise<AuditExport> {
    return this.tenantTransaction(principal, async (repository) => {
      this.assertOrganizationAdministrator(principal, "Exporting organization audit events");
      const records = this.filterAuditRecords(
        (await repository.listOrganizationAuditEvents(principal.organizationId))
          .map((event): AuditRecord => ({ ...event, scope: "organization" })),
        input,
      ).slice(0, input.maxItems);
      const timestamp = this.now().toISOString();
      const exportId = `aex_${this.id()}`;
      await this.auditOrganizationEvent(
        repository,
        principal,
        "audit.exported",
        exportId,
        timestamp,
        "audit_export",
      );
      return this.renderAuditExport("organization", principal.organizationId, records, input.format, timestamp);
    });
  }

  async exportProjectAudit(
    principal: Principal,
    projectId: string,
    input: AuditExportInput,
  ): Promise<AuditExport> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      this.assertProjectOperator(principal, "Exporting project audit events", projectId);
      const records = this.filterAuditRecords(
        (await repository.listAuditEvents(projectId))
          .map((event): AuditRecord => ({ ...event, scope: "project" })),
        input,
      ).slice(0, input.maxItems);
      const timestamp = this.now().toISOString();
      const exportId = `aex_${this.id()}`;
      await this.audit(
        repository,
        principal,
        projectId,
        "audit.exported",
        "audit_export",
        exportId,
        timestamp,
      );
      return this.renderAuditExport("project", projectId, records, input.format, timestamp);
    });
  }

  async exportProjectData(
    principal: Principal,
    projectId: string,
    input: ProjectDataExportInput,
  ): Promise<ProjectDataExport> {
    return this.tenantTransaction(principal, async (repository) => {
      const project = await this.requireProject(principal, projectId, repository);
      this.assertProjectOperator(principal, "Exporting project data", projectId);
      const exportedAt = this.now().toISOString();
      const exportId = `pex_${this.id()}`;
      await this.audit(
        repository,
        principal,
        projectId,
        "project.exported",
        "project_export",
        exportId,
        exportedAt,
      );

      const decisions = (await repository.listDecisions(projectId))
        .slice()
        .sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      const artifacts = (await repository.listArtifacts(projectId))
        .slice()
        .sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      const auditEvents = (await repository.listAuditEvents(projectId))
        .slice()
        .sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));

      const decisionItems = decisions.slice(input.decisionOffset, input.decisionOffset + input.maxDecisions);
      const artifactItems = artifacts.slice(input.artifactOffset, input.artifactOffset + input.maxArtifacts);
      const auditItems = auditEvents.slice(input.auditOffset, input.auditOffset + input.maxAuditItems);
      const counts = {
        decisions: this.projectDataExportCount(decisions.length, input.decisionOffset, decisionItems.length),
        artifacts: this.projectDataExportCount(artifacts.length, input.artifactOffset, artifactItems.length),
        auditEvents: this.projectDataExportCount(auditEvents.length, input.auditOffset, auditItems.length),
      };
      const safeTimestamp = exportedAt.replace(/[:.]/g, "-");
      return {
        filename: `bridge-project-${projectId}-${safeTimestamp}.json`,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          schemaVersion: 1,
          exportId,
          exportedAt,
          project,
          counts,
          humanApprovalChanged: false,
          decisions: decisionItems,
          artifacts: artifactItems,
          auditEvents: auditItems,
        }, null, 2),
        counts,
        humanApprovalChanged: false,
      };
    });
  }

  async replayOutboxEvent(
    principal: Principal,
    eventId: string,
    input: ReplayOutboxEventInput,
  ): Promise<OutboxEvent> {
    return this.tenantTransaction(principal, async (repository) => {
      const event = await repository.getOutboxEvent(eventId);
      if (!event || event.organizationId !== principal.organizationId) {
        throw new BridgeError("OUTBOX_EVENT_NOT_FOUND", "Delivery event not found.", 404);
      }
      await this.requireProjectForResource(
        principal,
        event.projectId,
        repository,
        "OUTBOX_EVENT_NOT_FOUND",
        "Delivery event not found.",
      );
      this.assertProjectOperator(principal, "Replaying a delivery event", event.projectId);
      if (event.status !== "failed" && event.status !== "dead_letter") {
        throw new BridgeError(
          "CONFLICT",
          "Only failed or dead-letter delivery events can be replayed.",
          409,
          { currentStatus: event.status, currentAttempts: event.attempts },
        );
      }
      if (event.attempts !== input.expectedAttempts) {
        throw new BridgeError(
          "CONFLICT",
          "The delivery event changed before replay; refresh and try again.",
          409,
          { currentStatus: event.status, currentAttempts: event.attempts },
        );
      }
      const { leaseUntil: _leaseUntil, processedAt: _processedAt, lastError: _lastError, ...base } = event;
      const replayed: OutboxEvent = {
        ...base,
        status: "pending",
        attempts: 0,
        availableAt: this.now().toISOString(),
      };
      await repository.saveOutboxEvent(replayed);
      await this.audit(
        repository,
        principal,
        event.projectId,
        "outbox.replayed",
        "outbox_event",
        event.id,
        this.now().toISOString(),
      );
      return replayed;
    });
  }

  async startRun(
    principal: Principal,
    projectId: string,
    input: StartAgentRunInput,
  ): Promise<RunRegistration> {
    return this.tenantTransaction(principal, (repository) =>
      this.startRunInTransaction(repository, principal, projectId, input),
    );
  }

  private async startRunInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    projectId: string,
    input: StartAgentRunInput,
  ): Promise<RunRegistration> {
    await this.requireProject(principal, projectId, repository);
    if (principal.type === "human") {
      throw new BridgeError("FORBIDDEN", "Only an agent, CI, or integration principal can start an agent run.", 403);
    }
    this.assertSecretSafe("run", input);
    const continuationMode = input.continuationMode ?? "manual";
    if (continuationMode === "automatic") {
      if (
        input.client !== "codex" ||
        !["hooks", "orchestrated"].includes(input.capability) ||
        !input.vendorSessionId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.vendorSessionId)
      ) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "Automatic continuation requires a Codex session UUID and hooks or orchestrated capability.",
          422,
        );
      }
    } else if (input.vendorSessionId) {
      throw new BridgeError(
        "VALIDATION_FAILED",
        "A vendor session ID is allowed only for automatic continuation.",
        422,
      );
    }

    const idempotencyKey = `run:${principal.organizationId}:${principal.id}:${input.idempotencyKey}`;
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = await repository.findIdempotentRun(idempotencyKey);
    if (existing) {
      const existingHash = await repository.getIdempotentRunRequestHash(idempotencyKey);
      if (existingHash !== requestHash) {
        this.recordIdempotency("run_start", "conflict");
        throw new BridgeError("CONFLICT", "The idempotency key was reused with a different request.", 409);
      }
      const existingKey = await repository.getRunContinuationKey(existing.id);
      if (!existingKey) {
        this.recordIdempotency("run_start", "conflict");
        throw new BridgeError("CONFLICT", "The run continuation locator is no longer available.", 409);
      }
      this.recordIdempotency("run_start", "replayed");
      return { run: existing, resumeContextKey: existingKey };
    }

    if (input.continuesRunId && input.resumeContextKey) {
      const previous = await this.requireRun(principal, input.continuesRunId, repository);
      if (previous.projectId !== projectId) {
        throw new BridgeError("CONTINUATION_INVALID", "The prior run belongs to a different project.", 403);
      }
      await this.assertContinuationKey(repository, previous.id, input.resumeContextKey);
      const blockingQuestions = await this.blockingQuestions(repository, previous);
      const remaining = blockingQuestions.filter((question) =>
        ["open", "in_discussion"].includes(question.status),
      );
      if (remaining.length > 0) {
        throw new BridgeError(
          "CONFLICT",
          "The prior run still has unresolved blocking questions.",
          409,
          { questionIds: remaining.map((question) => question.id) },
        );
      }
    }

    const timestamp = this.now().toISOString();
    const run: AgentRun = {
      id: `run_${this.id()}`,
      organizationId: principal.organizationId,
      projectId,
      agentId: principal.id,
      agentType: principal.type,
      client: input.client,
      capability: input.capability,
      continuationMode,
      taskSummary: input.taskSummary,
      scope: { ...input.scope },
      status: "running",
      contextSnapshotIds: [],
      questionIds: [],
      artifactVersionIds: [],
      assumptionIds: [],
      externalLinks: [...input.externalLinks],
      resultLinks: [],
      startedAt: timestamp,
      updatedAt: timestamp,
      ...(input.continuesRunId ? { continuesRunId: input.continuesRunId } : {}),
      version: 1,
    };
    const resumeContextKey = this.resumeKey();
    await repository.saveRun(run);
    await repository.saveRunContinuationKey(run.id, resumeContextKey, input.vendorSessionId);
    await repository.saveIdempotentRun(idempotencyKey, run.id, requestHash);
    await this.audit(repository, principal, projectId, "run.started", "run", run.id, timestamp);
    this.recordIdempotency("run_start", "created");
    return { run, resumeContextKey };
  }

  async listRuns(principal: Principal, projectId: string): Promise<readonly AgentRun[]> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      return repository.listRuns(projectId);
    });
  }

  async getRun(principal: Principal, runId: string): Promise<AgentRun> {
    return this.tenantTransaction(principal, (repository) =>
      this.requireRun(principal, runId, repository));
  }

  async reportRun(
    principal: Principal,
    runId: string,
    input: ReportAgentRunInput,
  ): Promise<AgentRun> {
    return this.tenantTransaction(principal, (repository) =>
      this.reportRunInTransaction(repository, principal, runId, input),
    );
  }

  private async reportRunInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    runId: string,
    input: ReportAgentRunInput,
  ): Promise<AgentRun> {
    const run = await this.requireRun(principal, runId, repository);
    const mayOperate = run.agentId === principal.id ||
      (principal.type === "human" && principalHasRole(principal, "project-admin", run.projectId));
    if (!mayOperate) {
      throw new BridgeError("FORBIDDEN", "Only the run principal or a project administrator can update this run.", 403);
    }
    this.assertSecretSafe("run", input);
    if (run.version !== input.expectedVersion) {
      throw new BridgeError("CONFLICT", "The run changed after it was read.", 409, {
        expectedVersion: input.expectedVersion,
        currentVersion: run.version,
      });
    }

    const allowed: Readonly<Record<AgentRun["status"], readonly AgentRun["status"][]>> = {
      running: ["waiting_for_human", "completed", "failed", "cancelled"],
      waiting_for_human: ["running", "completed", "failed", "cancelled"],
      completed: [],
      failed: [],
      cancelled: [],
    };
    if (!allowed[run.status].includes(input.status)) {
      throw new BridgeError(
        "CONFLICT",
        `A run cannot transition from ${run.status} to ${input.status}.`,
        409,
      );
    }

    const blockingQuestions = await this.blockingQuestions(repository, run);
    const unresolved = blockingQuestions.filter((question) =>
      ["open", "in_discussion"].includes(question.status),
    );
    if (input.status === "waiting_for_human" && unresolved.length === 0) {
      throw new BridgeError(
        "VALIDATION_FAILED",
        "A run can wait for a human only after it has a linked unresolved blocking question.",
        422,
      );
    }
    if (input.status === "running" && unresolved.length > 0) {
      throw new BridgeError(
        "POLICY_BLOCKED",
        "The run cannot resume while blocking questions remain unresolved.",
        403,
        { questionIds: unresolved.map((question) => question.id) },
      );
    }
    if (input.status === "completed" && unresolved.length > 0) {
      throw new BridgeError(
        "POLICY_BLOCKED",
        "The run cannot be completed while blocking questions remain unresolved.",
        403,
        { questionIds: unresolved.map((question) => question.id) },
      );
    }
    if (["completed", "failed"].includes(input.status) && !input.summary) {
      throw new BridgeError(
        "VALIDATION_FAILED",
        `A ${input.status} run requires a concise summary.`,
        422,
      );
    }

    const timestamp = this.now().toISOString();
    const terminal = ["completed", "failed", "cancelled"].includes(input.status);
    const updated: AgentRun = {
      ...run,
      status: input.status,
      resultLinks: [...new Set([...run.resultLinks, ...input.resultLinks])],
      updatedAt: timestamp,
      ...(terminal ? { endedAt: timestamp } : {}),
      ...(input.summary ? { summary: input.summary } : {}),
      version: run.version + 1,
    };
    await repository.saveRun(updated);
    await this.audit(repository, principal, run.projectId, "run.status_changed", "run", run.id, timestamp);
    return updated;
  }

  async getContinuation(
    principal: Principal,
    runId: string,
    resumeContextKey: string,
  ): Promise<ContinuationDescriptor> {
    return this.tenantTransaction(principal, async (repository) => {
      const run = await this.requireRun(principal, runId, repository);
      await this.assertContinuationKey(repository, run.id, resumeContextKey);
      const blockingQuestions = await this.blockingQuestions(repository, run);
      const remainingQuestionIds = blockingQuestions
        .filter((question) => ["open", "in_discussion"].includes(question.status))
        .map((question) => question.id);
      const acceptedDecisionIds = blockingQuestions.flatMap((question) =>
        question.status === "accepted" && question.decisionId ? [question.decisionId] : [],
      );
      const canContinue = remainingQuestionIds.length === 0;
      await this.audit(
        repository,
        principal,
        run.projectId,
        "continuation.read",
        "run",
        run.id,
        this.now().toISOString(),
      );
      return {
        run,
        blockingQuestions,
        acceptedDecisionIds,
        remainingQuestionIds,
        canContinue,
        continueInstruction: canContinue
          ? "Start a new Bridge run with continuesRunId and this resumeContextKey, then retrieve approved context before continuing work."
          : "Wait for the remaining blocking questions to receive accepted human decisions.",
      };
    });
  }

  async recordAssumption(
    principal: Principal,
    projectId: string,
    input: RecordAssumptionInput,
  ): Promise<Assumption> {
    return this.tenantTransaction(principal, (repository) =>
      this.recordAssumptionInTransaction(repository, principal, projectId, input),
    );
  }

  private async recordAssumptionInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    projectId: string,
    input: RecordAssumptionInput,
  ): Promise<Assumption> {
    await this.requireProject(principal, projectId, repository);
    this.assertSecretSafe("assumption", input);
    if (principal.type !== "human" && !input.runId) {
      throw new BridgeError(
        "VALIDATION_FAILED",
        "A non-human assumption requires a source run ID.",
        422,
      );
    }

    const idempotencyKey = `assumption:${principal.organizationId}:${principal.id}:${input.idempotencyKey}`;
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = await repository.findIdempotentAssumption(idempotencyKey);
    if (existing) {
      const existingHash = await repository.getIdempotentAssumptionRequestHash(idempotencyKey);
      if (existingHash !== requestHash) {
        this.recordIdempotency("assumption_record", "conflict");
        throw new BridgeError("CONFLICT", "The idempotency key was reused with a different request.", 409);
      }
      this.recordIdempotency("assumption_record", "replayed");
      return existing;
    }

    const policy = await this.evaluateProjectPolicy(repository, projectId, {
      operation: "assumption",
      category: input.category,
      scope: input.scope,
      declaredRisk: input.risk,
      reversible: input.reversible,
      blocking: false,
    });
    if (policy.action !== "assume_and_log" || policy.risk !== "low") {
      throw new BridgeError(
        "POLICY_BLOCKED",
        "Project policy allows assumption logging only for low-risk, reversible uncertainty.",
        403,
        { policyAction: policy.action, policyRuleKey: policy.policyRuleKey, policyVersion: policy.policyVersion },
      );
    }

    const timestampDate = this.now();
    const timestamp = timestampDate.toISOString();
    const expiresAt = input.expiresAt ?? new Date(timestampDate.getTime() + 7 * 86_400_000).toISOString();
    const expiryTime = Date.parse(expiresAt);
    const maximumExpiry = timestampDate.getTime() + 30 * 86_400_000;
    if (!Number.isFinite(expiryTime) || expiryTime <= timestampDate.getTime() || expiryTime > maximumExpiry) {
      throw new BridgeError(
        "VALIDATION_FAILED",
        "An assumption must expire in the future and no later than 30 days after creation.",
        422,
      );
    }

    const sourceRun = input.runId
      ? await this.requireLinkableRun(principal, input.runId, repository)
      : undefined;
    const exactScopeDecisions = (await repository.listDecisions(projectId)).filter(
      (decision) =>
        decision.status === "active" &&
        decision.category.toLowerCase() === input.category.toLowerCase() &&
        this.scopesEqual(decision.scope, input.scope),
    );
    const duplicateDecision = exactScopeDecisions.find(
      (decision) => this.normalizePremise(decision.answer) === this.normalizePremise(input.statement),
    );
    if (duplicateDecision) {
      throw new BridgeError(
        "CONFLICT",
        "This premise already exists as an active human decision and must not be downgraded to an assumption.",
        409,
        { decisionId: duplicateDecision.id },
      );
    }
    const conflictingDecision = exactScopeDecisions.find((decision) =>
      this.areDirectNegations(decision.answer, input.statement),
    );
    if (conflictingDecision) {
      throw new BridgeError(
        "CONFLICT",
        "The proposed assumption directly conflicts with an active human decision in the same scope.",
        409,
        { decisionId: conflictingDecision.id },
      );
    }

    const assumption: Assumption = {
      id: `asm_${this.id()}`,
      organizationId: principal.organizationId,
      projectId,
      ...(input.runId ? { runId: input.runId } : {}),
      statement: input.statement,
      rationale: input.rationale,
      category: input.category,
      risk: input.risk,
      confidence: input.confidence,
      reversible: input.reversible,
      reversalCost: input.reversalCost,
      scope: { ...input.scope },
      sourceLinks: [...input.sourceLinks],
      status: "active",
      createdById: principal.id,
      createdByType: principal.type,
      createdAt: timestamp,
      expiresAt,
      version: 1,
    };
    await repository.saveAssumption(assumption);
    await repository.saveIdempotentAssumption(idempotencyKey, assumption.id, requestHash);
    if (sourceRun) {
      await repository.saveRun({
        ...sourceRun,
        assumptionIds: [...new Set([...sourceRun.assumptionIds, assumption.id])],
        updatedAt: timestamp,
        version: sourceRun.version + 1,
      });
    }
    await this.audit(
      repository,
      principal,
      projectId,
      "assumption.recorded",
      "assumption",
      assumption.id,
      timestamp,
      policy.policyVersion,
      undefined,
      { policyRuleKey: policy.policyRuleKey },
    );
    this.recordIdempotency("assumption_record", "created");
    return assumption;
  }

  async listAssumptions(principal: Principal, projectId: string): Promise<readonly Assumption[]> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      const assumptions = await repository.listAssumptions(projectId);
      const refreshed: Assumption[] = [];
      for (const assumption of assumptions) {
        refreshed.push(await this.expireAssumptionIfDue(repository, principal, assumption));
      }
      return refreshed;
    });
  }

  async getAssumption(principal: Principal, assumptionId: string): Promise<Assumption> {
    return this.tenantTransaction(principal, async (repository) => {
      const assumption = await this.requireAssumption(principal, assumptionId, repository);
      return this.expireAssumptionIfDue(repository, principal, assumption);
    });
  }

  async expireDueAssumptions(): Promise<AssumptionExpiryCycleResult> {
    return this.repository.transaction(async (repository) => {
      let expiredCount = 0;
      for (const organization of await repository.listOrganizations()) {
        const maintenancePrincipal: Principal = {
          id: "bridge-worker",
          type: "integration",
          organizationId: organization.id,
          projectIds: [],
          allProjects: true,
          roles: ["system-maintenance"],
          displayName: "Bridge worker",
        };
        for (const project of await repository.listProjects(organization.id)) {
          for (const assumption of await repository.listAssumptions(project.id)) {
            const refreshed = await this.expireAssumptionIfDue(
              repository,
              maintenancePrincipal,
              assumption,
              { notify: true },
            );
            if (refreshed.status === "expired" && assumption.status === "active") expiredCount += 1;
          }
        }
      }
      return { expiredCount };
    }, { maintenance: true });
  }

  async escalateDueBlockingQuestions(): Promise<BlockingQuestionEscalationCycleResult> {
    return this.repository.transaction(async (repository) => {
      let escalatedCount = 0;
      const now = this.now();
      const escalatedAt = now.toISOString();
      for (const organization of await repository.listOrganizations()) {
        const maintenancePrincipal: Principal = {
          id: "bridge-worker",
          type: "integration",
          organizationId: organization.id,
          projectIds: [],
          allProjects: true,
          roles: ["system-maintenance"],
          displayName: "Bridge worker",
        };
        for (const project of await repository.listProjects(organization.id)) {
          for (const listedQuestion of await repository.listQuestions(project.id)) {
            if (
              !listedQuestion.blocking ||
              !listedQuestion.dueAt ||
              listedQuestion.blockingEscalatedAt ||
              !["open", "in_discussion"].includes(listedQuestion.status) ||
              Date.parse(listedQuestion.dueAt) > now.getTime()
            ) {
              continue;
            }
            const question = await repository.getQuestion(listedQuestion.id);
            if (
              !question ||
              !question.blocking ||
              !question.dueAt ||
              question.blockingEscalatedAt ||
              !["open", "in_discussion"].includes(question.status) ||
              Date.parse(question.dueAt) > now.getTime()
            ) {
              continue;
            }

            await repository.saveQuestion({ ...question, blockingEscalatedAt: escalatedAt });
            await this.audit(
              repository,
              maintenancePrincipal,
              project.id,
              "question.blocking_escalated",
              "question",
              question.id,
              escalatedAt,
              question.policyVersion,
              undefined,
              { policyRuleKey: question.policyRuleKey },
            );
            await this.notify(
              repository,
              maintenancePrincipal,
              project.id,
              [...question.ownerIds, ...question.reviewerIds, ...project.decisionOwnerIds],
              {
                type: "question_blocking_escalation",
                title: "Overdue blocking question needs attention",
                body: `“${question.title}” is overdue and still blocks progress. Review the authoritative question in Bridge.`,
                targetType: "question",
                targetId: question.id,
                recipientRoles: [
                  ...question.ownerRoles,
                  ...question.requiredOwnerRoles,
                  ...question.reviewerRoles,
                  ...question.requiredReviewerRoles,
                  "project-admin",
                ],
                questionContext: {
                  id: question.id,
                  status: question.status,
                  risk: question.risk,
                  ownerIds: question.ownerIds,
                },
              },
            );
            escalatedCount += 1;
          }
        }
      }
      return { escalatedCount };
    }, { maintenance: true });
  }

  async resolveAssumption(
    principal: Principal,
    assumptionId: string,
    input: ResolveAssumptionInput,
  ): Promise<Assumption> {
    return this.tenantTransaction(principal, async (repository) => {
      assertHuman(principal, "Resolving an assumption");
      const assumption = await this.requireAssumption(principal, assumptionId, repository);
      const project = await this.requireProject(principal, assumption.projectId, repository);
      if (
        !project.decisionOwnerIds.includes(principal.id) &&
        !principalHasRole(principal, "project-admin", project.id)
      ) {
        throw new BridgeError(
          "FORBIDDEN",
          "Only a configured decision owner or project administrator can resolve an assumption.",
          403,
        );
      }
      this.assertSecretSafe("assumption", input);
      if (assumption.version !== input.expectedVersion) {
        throw new BridgeError("CONFLICT", "The assumption changed after it was read.", 409, {
          expectedVersion: input.expectedVersion,
          currentVersion: assumption.version,
        });
      }
      if (assumption.status !== "active") {
        throw new BridgeError("CONFLICT", "Only an active assumption can be resolved.", 409);
      }
      if (Date.parse(assumption.expiresAt) <= this.now().getTime() && input.status !== "expired") {
        throw new BridgeError(
          "CONFLICT",
          "This assumption has reached its expiry and must be marked expired instead of confirmed or rejected.",
          409,
        );
      }

      if (input.confirmedDecisionId) {
        const decision = await repository.getDecision(input.confirmedDecisionId);
        if (
          !decision ||
          decision.projectId !== assumption.projectId ||
          decision.organizationId !== assumption.organizationId ||
          decision.status !== "active"
        ) {
          throw new BridgeError(
            "VALIDATION_FAILED",
            "A confirmed decision link must reference an active decision in the same project.",
            422,
          );
        }
      }
      if (input.supersedingAssumptionId) {
        if (input.supersedingAssumptionId === assumption.id) {
          throw new BridgeError("VALIDATION_FAILED", "An assumption cannot supersede itself.", 422);
        }
        const replacement = await repository.getAssumption(input.supersedingAssumptionId);
        if (
          !replacement ||
          replacement.projectId !== assumption.projectId ||
          replacement.organizationId !== assumption.organizationId ||
          !["active", "confirmed"].includes(replacement.status) ||
          (replacement.status === "active" && Date.parse(replacement.expiresAt) <= this.now().getTime())
        ) {
          throw new BridgeError(
            "VALIDATION_FAILED",
            "A superseding assumption must be active or confirmed in the same project.",
            422,
          );
        }
      }

      if (input.createDecision && input.status !== "confirmed") {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "An authoritative decision can only be created when an assumption is confirmed.",
          422,
        );
      }
      if (input.createDecision && input.confirmedDecisionId) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "Choose an existing confirmed decision or create a new one, not both.",
          422,
        );
      }

      let confirmedDecisionId = input.confirmedDecisionId;
      if (input.createDecision) {
        const exactScopeDecisions = (await repository.listDecisions(assumption.projectId)).filter(
          (decision) =>
            decision.status === "active" &&
            decision.category.toLowerCase() === assumption.category.toLowerCase() &&
            this.scopesEqual(decision.scope, assumption.scope),
        );
        const duplicateDecision = exactScopeDecisions.find(
          (decision) => this.normalizePremise(decision.answer) === this.normalizePremise(assumption.statement),
        );
        const conflictingDecision = exactScopeDecisions.find((decision) =>
          this.areDirectNegations(decision.answer, assumption.statement),
        );
        if (conflictingDecision) {
          throw new BridgeError(
            "CONFLICT",
            "The assumption conflicts with an active human decision and cannot become authoritative.",
            409,
            { decisionId: conflictingDecision.id },
          );
        }
        if (duplicateDecision) {
          confirmedDecisionId = duplicateDecision.id;
        } else {
          const timestampDate = this.now();
          const decision: Decision = {
            id: `dec_${this.id()}`,
            organizationId: assumption.organizationId,
            projectId: assumption.projectId,
            answer: assumption.statement,
            rationale: input.rationale,
            category: assumption.category,
            scope: { ...assumption.scope },
            ownerId: principal.id,
            status: "active",
            createdAt: timestampDate.toISOString(),
            reviewAt: reviewDateFor(assumption.risk, timestampDate),
            version: 1,
          };
          await repository.saveDecision(decision);
          await this.audit(
            repository,
            principal,
            assumption.projectId,
            "decision.accepted",
            "decision",
            decision.id,
            decision.createdAt,
          );
          confirmedDecisionId = decision.id;
        }
      }

      const timestamp = this.now().toISOString();
      const updated: Assumption = {
        ...assumption,
        status: input.status,
        resolvedById: principal.id,
        resolvedAt: timestamp,
        resolutionRationale: input.rationale,
        ...(confirmedDecisionId ? { confirmedDecisionId } : {}),
        ...(input.supersedingAssumptionId
          ? { supersedingAssumptionId: input.supersedingAssumptionId }
          : {}),
        version: assumption.version + 1,
      };
      await repository.saveAssumption(updated);
      await this.audit(
        repository,
        principal,
        assumption.projectId,
        `assumption.${input.status}`,
        "assumption",
        assumption.id,
        timestamp,
      );
      return updated;
    });
  }

  async createQuestion(
    principal: Principal,
    projectId: string,
    input: CreateQuestionInput,
  ): Promise<QuestionSubmission> {
    return this.tenantTransaction(principal, (repository) =>
      this.createQuestionInTransaction(repository, principal, projectId, input),
    );
  }

  private async createQuestionInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    projectId: string,
    input: CreateQuestionInput,
  ): Promise<QuestionSubmission> {
    const project = await this.requireProject(principal, projectId, repository);
    this.assertSecretSafe("question", input);
    const idempotencyKey = `${principal.organizationId}:${principal.id}:${input.idempotencyKey}`;
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = await repository.findIdempotentQuestion(idempotencyKey);
    if (existing) {
      const existingHash = await repository.getIdempotentRequestHash(idempotencyKey);
      if (existingHash !== requestHash) {
        this.recordIdempotency("question_submit", "conflict");
        throw new BridgeError("CONFLICT", "The idempotency key was reused with a different request.", 409);
      }
      this.recordIdempotency("question_submit", "replayed");
      return { ...existing, submissionDisposition: "idempotent_replay" };
    }

    const policy = await this.evaluateProjectPolicy(repository, projectId, {
      operation: "question",
      category: input.category,
      scope: input.scope,
      declaredRisk: input.risk,
      reversible: input.reversible,
      blocking: input.blocking,
    });
    if (policy.action === "protected_approval" && input.fallback) {
      throw new BridgeError(
        "POLICY_BLOCKED",
        "Protected questions cannot define an automatic fallback.",
        403,
      );
    }

    const timestamp = this.now().toISOString();
    const parsedDueAt = input.dueAt === undefined ? undefined : Date.parse(input.dueAt);
    if (parsedDueAt !== undefined && !Number.isFinite(parsedDueAt)) {
      throw new BridgeError("VALIDATION_FAILED", "Question dueAt must be a valid timestamp.", 400);
    }
    const dueAt = parsedDueAt === undefined ? undefined : new Date(parsedDueAt).toISOString();
    const routing = await this.resolveQuestionRouting(repository, project, input, policy);
    const sourceRun = input.runId
      ? await this.requireLinkableRun(principal, input.runId, repository)
      : undefined;

    const effectiveBlocking = input.blocking || ["block", "protected_approval"].includes(policy.action);
    const reusable = await this.findReusableQuestion(
      repository,
      projectId,
      input,
      policy,
      routing,
      dueAt,
      effectiveBlocking,
    );
    if (reusable) {
      await repository.saveIdempotentQuestion(idempotencyKey, reusable.id, requestHash);
      if (sourceRun) {
        await this.linkQuestionToRun(repository, principal, sourceRun, reusable, timestamp);
      }
      await this.audit(
        repository,
        principal,
        projectId,
        "question.reused",
        "question",
        reusable.id,
        timestamp,
        policy.policyVersion,
        undefined,
        { policyRuleKey: policy.policyRuleKey },
      );
      const submissionDisposition = reusable.status === "accepted" ? "reused_accepted" : "reused_pending";
      this.recordIdempotency("question_submit", submissionDisposition);
      return { ...reusable, submissionDisposition };
    }

    const questionId = `qst_${this.id()}`;
    const initialAssignment: QuestionAssignmentHistoryEntry = {
      id: `qas_${this.id()}`,
      kind: "initial",
      changedById: principal.id,
      changedByType: principal.type,
      ownerIds: routing.ownerIds,
      ownerRoles: routing.ownerRoles,
      reviewerIds: routing.reviewerIds,
      reviewerRoles: routing.reviewerRoles,
      route: routing.explanation,
      createdAt: timestamp,
      questionVersion: 1,
    };
    const question: Question = {
      id: questionId,
      organizationId: principal.organizationId,
      projectId,
      ...(input.runId ? { runId: input.runId } : {}),
      title: input.title,
      type: input.type,
      category: input.category,
      context: input.context,
      whyItMatters: input.whyItMatters,
      risk: policy.risk,
      policyAction: policy.action,
      policyVersion: policy.policyVersion,
      policyRuleKey: policy.policyRuleKey,
      reversible: input.reversible,
      blocking: effectiveBlocking,
      ...(dueAt ? { dueAt } : {}),
      ownerIds: routing.ownerIds,
      ownerRoles: routing.ownerRoles,
      requiredOwnerRoles: policy.requiredOwnerRoles,
      reviewerIds: routing.reviewerIds,
      reviewerRoles: routing.reviewerRoles,
      requiredReviewerRoles: policy.requiredReviewerRoles,
      ...(Object.keys(policy.requiredReviewerQuorum).length > 0
        ? { requiredReviewerQuorum: policy.requiredReviewerQuorum }
        : {}),
      routing: routing.explanation,
      assignmentHistory: [initialAssignment],
      options: input.options.map((option) => ({ ...option })),
      ...((input.relatedLinks ?? []).length > 0
        ? { relatedLinks: (input.relatedLinks ?? []).map((link): QuestionLink => ({ ...link })) }
        : {}),
      ...(input.recommendationKey ? { recommendationKey: input.recommendationKey } : {}),
      ...(input.fallback !== undefined ? { fallback: input.fallback } : {}),
      scope: { ...input.scope },
      createdById: principal.id,
      createdByType: principal.type,
      createdAt: timestamp,
      status: "open",
      responses: [],
      reviews: [],
      comments: [],
      version: 1,
    };

    await repository.saveQuestion(question);
    await repository.saveIdempotentQuestion(idempotencyKey, question.id, requestHash);
    if (sourceRun) {
      await this.linkQuestionToRun(repository, principal, sourceRun, question, timestamp);
    }
    await this.audit(
      repository,
      principal,
      projectId,
      "question.created",
      "question",
      question.id,
      timestamp,
      question.policyVersion,
      undefined,
      {
        policyRuleKey: question.policyRuleKey,
        assignmentId: initialAssignment.id,
        ownerRouteSource: question.routing.ownerSource,
        reviewerRouteSource: question.routing.reviewerSource,
      },
    );
    await this.notify(repository, principal, projectId, [...question.ownerIds, ...question.reviewerIds], {
      type: "question_assigned",
      title: "Question needs your review",
      body: `${principal.displayName} routed “${question.title}” to you.`,
      targetType: "question",
      targetId: question.id,
      recipientRoles: [...question.ownerRoles, ...question.reviewerRoles],
      questionContext: {
        id: question.id,
        status: question.status,
        risk: question.risk,
        ownerIds: question.ownerIds,
      },
    });
    this.recordIdempotency("question_submit", "created");
    return { ...question, submissionDisposition: "created" };
  }

  async findQuestionMatches(
    principal: Principal,
    projectId: string,
    input: FindQuestionMatchesInput,
  ): Promise<readonly QuestionMatch[]> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      return this.calculateQuestionMatches(repository, projectId, input);
    });
  }

  private async calculateQuestionMatches(
    repository: BridgeRepository,
    projectId: string,
    input: FindQuestionMatchesInput,
  ): Promise<readonly QuestionMatch[]> {
    const questions = await repository.searchQuestionMatchCandidates(projectId, input);
    const matches: QuestionMatch[] = [];
    for (const question of questions) {
      if (!["open", "in_discussion", "accepted"].includes(question.status)) continue;
      if (question.status === "accepted") {
        const decision = question.decisionId
          ? await repository.getDecision(question.decisionId)
          : undefined;
        if (!decision || decision.status !== "active") continue;
      }

      const titleSimilarity = Math.max(
        this.tokenSimilarity(input.title, question.title),
        this.trigramSimilarity(input.title, question.title),
      );
      const contextSimilarity = Math.max(
        this.tokenSimilarity(input.context, question.context),
        this.trigramSimilarity(input.context, question.context),
      );
      const sameCategory = this.normalizeQuestionText(input.category) ===
        this.normalizeQuestionText(question.category);
      const sameType = input.type === question.type;
      const sameScope = this.scopesEqual(input.scope, question.scope);
      const exact = sameCategory && sameType && sameScope &&
        this.normalizeQuestionText(input.title) === this.normalizeQuestionText(question.title) &&
        this.normalizeQuestionText(input.context) === this.normalizeQuestionText(question.context);
      const score = exact
        ? 100
        : Math.round(
            (titleSimilarity * 0.4 +
              contextSimilarity * 0.25 +
              (sameCategory ? 0.15 : 0) +
              (sameType ? 0.1 : 0) +
              (sameScope ? 0.1 : 0)) * 100,
          );
      if (!exact && score < 40) continue;

      const reasons = [
        ...(exact ? ["same normalized question and scope"] : []),
        ...(sameCategory ? ["same category"] : []),
        ...(sameType ? ["same question type"] : []),
        ...(sameScope ? ["same scope"] : []),
        ...(titleSimilarity >= 0.5 && !exact ? ["similar title"] : []),
        ...(contextSimilarity >= 0.4 && !exact ? ["similar context"] : []),
        ...(question.status === "accepted" ? ["already has an active accepted decision"] : []),
      ];
      matches.push({
        questionId: question.id,
        title: question.title,
        category: question.category,
        status: question.status,
        ...(question.decisionId ? { decisionId: question.decisionId } : {}),
        scope: { ...question.scope },
        score,
        matchKind: exact ? "exact" : "related",
        reasons,
        createdAt: question.createdAt,
      });
    }

    return matches
      .sort((left, right) =>
        Number(right.matchKind === "exact") - Number(left.matchKind === "exact") ||
        Number(right.status === "accepted") - Number(left.status === "accepted") ||
        right.score - left.score ||
        right.createdAt.localeCompare(left.createdAt),
      )
      .slice(0, input.maxItems);
  }

  private async findReusableQuestion(
    repository: BridgeRepository,
    projectId: string,
    input: CreateQuestionInput,
    policy: PolicyEvaluation,
    routing: RoutingResolution,
    dueAt: string | undefined,
    effectiveBlocking: boolean,
  ): Promise<Question | undefined> {
    const questions = await repository.listQuestions(projectId);
    const candidates = questions.filter((question) =>
      ["open", "in_discussion", "accepted"].includes(question.status) &&
      question.type === input.type &&
      this.normalizeQuestionText(question.category) === this.normalizeQuestionText(input.category) &&
      this.normalizeQuestionText(question.title) === this.normalizeQuestionText(input.title) &&
      this.normalizeQuestionText(question.context) === this.normalizeQuestionText(input.context) &&
      this.scopesEqual(question.scope, input.scope) &&
      question.risk === policy.risk &&
      question.policyAction === policy.action &&
      question.reversible === input.reversible &&
      question.blocking === effectiveBlocking &&
      question.dueAt === dueAt &&
      JSON.stringify([...question.ownerIds].sort()) === JSON.stringify([...routing.ownerIds].sort()) &&
      JSON.stringify([...question.ownerRoles].map(normalizeRoleName).filter(Boolean).sort()) ===
        JSON.stringify([...routing.ownerRoles].sort()) &&
      JSON.stringify([...(question.reviewerIds ?? [])].sort()) ===
        JSON.stringify([...routing.reviewerIds].sort()) &&
      JSON.stringify([...(question.reviewerRoles ?? [])].map(normalizeRoleName).filter(Boolean).sort()) ===
        JSON.stringify([...routing.reviewerRoles].sort()) &&
      JSON.stringify([...question.requiredOwnerRoles].map(normalizeRoleName).filter(Boolean).sort()) ===
        JSON.stringify([...policy.requiredOwnerRoles].sort()) &&
      JSON.stringify([...question.requiredReviewerRoles].map(normalizeRoleName).filter(Boolean).sort()) ===
        JSON.stringify([...policy.requiredReviewerRoles].sort()) &&
      JSON.stringify(Object.entries(question.requiredReviewerQuorum ?? {}).sort(([left], [right]) => left.localeCompare(right))) ===
        JSON.stringify(Object.entries(policy.requiredReviewerQuorum).sort(([left], [right]) => left.localeCompare(right)))
    );
    for (const question of candidates.sort((left, right) =>
      Number(right.status === "accepted") - Number(left.status === "accepted") ||
      right.createdAt.localeCompare(left.createdAt),
    )) {
      if (question.status !== "accepted") return question;
      const decision = question.decisionId
        ? await repository.getDecision(question.decisionId)
        : undefined;
      if (decision?.status === "active") return question;
    }
    return undefined;
  }

  private async linkQuestionToRun(
    repository: BridgeRepository,
    principal: Principal,
    run: AgentRun,
    question: Question,
    timestamp: string,
  ): Promise<void> {
    if (run.questionIds.includes(question.id)) return;
    const waiting = question.blocking &&
      ["open", "in_discussion"].includes(question.status) &&
      run.status === "running";
    await repository.saveRun({
      ...run,
      status: waiting ? "waiting_for_human" : run.status,
      questionIds: [...run.questionIds, question.id],
      updatedAt: timestamp,
      version: run.version + 1,
    });
    if (waiting) {
      await this.audit(
        repository,
        principal,
        run.projectId,
        "run.waiting_for_human",
        "run",
        run.id,
        timestamp,
        question.policyVersion,
        undefined,
        { policyRuleKey: question.policyRuleKey },
      );
    }
  }

  private normalizeQuestionText(value: string): string {
    return value
      .normalize("NFKC")
      .toLocaleLowerCase("en")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  private tokenSimilarity(left: string, right: string): number {
    const leftTokens = new Set(this.normalizeQuestionText(left).split(" ").filter(Boolean));
    const rightTokens = new Set(this.normalizeQuestionText(right).split(" ").filter(Boolean));
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
    const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    const union = new Set([...leftTokens, ...rightTokens]).size;
    return intersection / union;
  }

  private trigramSimilarity(left: string, right: string): number {
    const trigrams = (value: string): Set<string> => {
      const normalized = `  ${this.normalizeQuestionText(value)} `;
      const characters = Array.from(normalized);
      if (characters.length <= 3) return new Set([normalized]);
      return new Set(Array.from(
        { length: characters.length - 2 },
        (_, index) => characters.slice(index, index + 3).join(""),
      ));
    };
    const leftTrigrams = trigrams(left);
    const rightTrigrams = trigrams(right);
    if (leftTrigrams.size === 0 || rightTrigrams.size === 0) return 0;
    const overlap = [...leftTrigrams].filter((trigram) => rightTrigrams.has(trigram)).length;
    return (2 * overlap) / (leftTrigrams.size + rightTrigrams.size);
  }

  async listQuestions(principal: Principal, projectId: string): Promise<readonly QuestionInboxItem[]> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      const now = this.now();
      return (await repository.listQuestions(projectId)).map((question) =>
        questionInboxItem(principal, question, now));
    });
  }

  async listQuestionInbox(
    principal: Principal,
    projectId: string,
    filters: QuestionInboxQuery = {},
  ): Promise<readonly QuestionInboxItem[]> {
    return this.tenantTransaction(principal, async (repository) => {
    await this.requireProject(principal, projectId, repository);
    const now = this.now();
    const questions = (await repository.listQuestions(projectId)).map((question) =>
      questionInboxItem(principal, question, now));
    const normalizedCategory = filters.category?.normalize("NFKC").toLocaleLowerCase("en");
    const normalizedRole = filters.role ? normalizeRoleName(filters.role) : undefined;
    return questions
      .filter((question) =>
        (!filters.status || question.status === filters.status) &&
        (!filters.risk || question.risk === filters.risk) &&
        (!normalizedCategory || question.category.normalize("NFKC").toLocaleLowerCase("en") === normalizedCategory) &&
        (!normalizedRole || [...question.ownerRoles, ...(question.reviewerRoles ?? [])]
          .some((role) => normalizeRoleName(role) === normalizedRole)) &&
        (!filters.due ||
          (filters.due === "overdue" && question.dueStatus === "overdue") ||
          (filters.due === "next_7_days" && question.dueStatus === "due_soon") ||
          (filters.due === "scheduled" && question.dueStatus !== "none") ||
          (filters.due === "none" && question.dueStatus === "none")),
      )
      .filter((question) => question.inboxReasons.length > 0)
      .sort((left, right) => {
        const riskRank = { protected: 4, high: 3, medium: 2, low: 1 } as const;
        const protectedDifference = Number(right.risk === "protected") - Number(left.risk === "protected");
        if (protectedDifference !== 0) return protectedDifference;
        const overdueDifference = Number(right.dueStatus === "overdue") - Number(left.dueStatus === "overdue");
        if (overdueDifference !== 0) return overdueDifference;
        if (left.blocking !== right.blocking) return left.blocking ? -1 : 1;
        const dueSoonDifference = Number(right.dueStatus === "due_soon") - Number(left.dueStatus === "due_soon");
        if (dueSoonDifference !== 0) return dueSoonDifference;
        const riskDifference = riskRank[right.risk] - riskRank[left.risk];
        if (riskDifference !== 0) return riskDifference;
        if (left.dueAt && right.dueAt) {
          const dueAtDifference = Date.parse(left.dueAt) - Date.parse(right.dueAt);
          if (dueAtDifference !== 0) return dueAtDifference;
        } else if (left.dueAt || right.dueAt) {
          return left.dueAt ? -1 : 1;
        }
        const discussionDifference = Number(right.status === "in_discussion") - Number(left.status === "in_discussion");
        if (discussionDifference !== 0) return discussionDifference;
        return Date.parse(right.createdAt) - Date.parse(left.createdAt);
      });
    });
  }

  async listQuestionDecisionDigests(
    principal: Principal,
    projectId: string,
    query: QuestionDecisionDigestQuery,
  ): Promise<readonly QuestionDecisionDigest[]> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      const now = this.now();
      const normalizedCategory = query.category?.normalize("NFKC").toLocaleLowerCase("en");
      const candidates = (await repository.listQuestions(projectId))
        .map((question) => questionInboxItem(principal, question, now))
        .filter((question) =>
          question.inboxReasons.length > 0 &&
          ["open", "in_discussion"].includes(question.status) &&
          question.risk === "low" &&
          !question.blocking &&
          (!normalizedCategory || question.category.normalize("NFKC").toLocaleLowerCase("en") === normalizedCategory),
        );
      const grouped = new Map<string, QuestionInboxItem[]>();
      for (const question of candidates) {
        const scopeKey = JSON.stringify(Object.entries(question.scope).sort(([left], [right]) => left.localeCompare(right)));
        const key = `${question.category.normalize("NFKC").toLocaleLowerCase("en")}\u0000${scopeKey}`;
        grouped.set(key, [...(grouped.get(key) ?? []), question]);
      }

      return [...grouped.entries()]
        .filter(([, questions]) => questions.length >= 2)
        .map(([key, questions]): QuestionDecisionDigest => {
          const ordered = [...questions].sort((left, right) => {
            const leftDue = left.dueAt ? Date.parse(left.dueAt) : Number.POSITIVE_INFINITY;
            const rightDue = right.dueAt ? Date.parse(right.dueAt) : Number.POSITIVE_INFINITY;
            return leftDue - rightDue || Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id);
          });
          const first = ordered[0]!;
          const shown = ordered.slice(0, query.maxQuestionsPerDigest);
          const earliestDueAt = ordered.find((question) => question.dueAt)?.dueAt;
          return {
            id: `qdg_${createHash("sha256")
              .update(`${projectId}\u0000${principal.id}\u0000${key}`)
              .digest("hex")
              .slice(0, 24)}`,
            category: first.category,
            scope: { ...first.scope },
            questionCount: ordered.length,
            remainingQuestionCount: ordered.length - shown.length,
            ...(earliestDueAt ? { earliestDueAt } : {}),
            groupingReasons: ["low risk and non-blocking", "same category", "same exact scope"],
            questions: shown.map((question) => ({
              id: question.id,
              title: question.title,
              whyItMatters: question.whyItMatters,
              status: question.status,
              ...(question.dueAt ? { dueAt: question.dueAt } : {}),
              dueStatus: question.dueStatus,
              canAccept: question.canAccept,
            })),
            humanApprovalRequired: true,
            batchAcceptanceAvailable: false,
          };
        })
        .sort((left, right) => {
          const leftDue = left.earliestDueAt ? Date.parse(left.earliestDueAt) : Number.POSITIVE_INFINITY;
          const rightDue = right.earliestDueAt ? Date.parse(right.earliestDueAt) : Number.POSITIVE_INFINITY;
          return leftDue - rightDue || right.questionCount - left.questionCount || left.id.localeCompare(right.id);
        })
        .slice(0, query.maxDigests);
    });
  }

  async getQuestion(principal: Principal, questionId: string): Promise<QuestionInboxItem> {
    return this.tenantTransaction(principal, async (repository) =>
      questionInboxItem(principal, await this.requireQuestion(principal, questionId, repository), this.now()));
  }

  async getQuestionAudienceView(
    principal: Principal,
    questionId: string,
    query: QuestionAudienceViewQuery,
  ): Promise<QuestionAudienceView> {
    return this.tenantTransaction(principal, async (repository) => {
      const question = await this.requireQuestion(principal, questionId, repository);
      const role = query.role.trim();
      const lens = this.questionAudienceLens(role);
      return {
        questionId: question.id,
        questionVersion: question.version,
        role,
        mode: query.mode,
        source: {
          title: question.title,
          context: question.context,
          whyItMatters: question.whyItMatters,
          options: question.options.map((option) => ({ ...option })),
          ...(question.recommendationKey ? { recommendationKey: question.recommendationKey } : {}),
        },
        presentation: query.mode === "rewrite"
          ? {
              title: `For ${role}: ${question.title}`,
              context: `${question.context}\n\nRole focus: ${lens.summary}`,
              whyItMatters: question.whyItMatters,
              focusAreas: lens.focusAreas,
              reviewPrompt: lens.reviewPrompt,
            }
          : {
              title: `What ${role} should evaluate`,
              context: `The recorded question is “${question.title}”. ${lens.summary}`,
              whyItMatters: `The recorded impact remains: ${question.whyItMatters}`,
              focusAreas: lens.focusAreas,
              reviewPrompt: lens.reviewPrompt,
            },
        guardrails: {
          derivedOnly: true,
          sourceFieldsUnchanged: true,
          humanApprovalRequired: true,
        },
      };
    });
  }

  private questionAudienceLens(role: string): {
    readonly summary: string;
    readonly focusAreas: readonly string[];
    readonly reviewPrompt: string;
  } {
    const normalized = normalizeRoleName(role);
    if (["security", "privacy", "compliance", "risk"].some((term) => normalized.includes(term))) {
      return {
        summary: "Evaluate the same options through confidentiality, access-control, abuse, and compliance consequences.",
        focusAreas: ["security controls", "data exposure", "threat and compliance evidence"],
        reviewPrompt: "Which recorded option has acceptable security risk, and what evidence supports that assessment?",
      };
    }
    if (["qa", "quality", "test"].some((term) => normalized.includes(term))) {
      return {
        summary: "Evaluate the same options through acceptance criteria, test coverage, and observable failure modes.",
        focusAreas: ["acceptance criteria", "test evidence", "failure and regression risk"],
        reviewPrompt: "Which recorded option is best supported by test evidence, and what release risk remains?",
      };
    }
    if (["product", "business", "customer"].some((term) => normalized.includes(term))) {
      return {
        summary: "Evaluate the same options through user outcomes, scope, delivery cost, and reversibility.",
        focusAreas: ["user outcome", "scope and priority", "delivery and reversal cost"],
        reviewPrompt: "Which recorded option best serves the intended outcome within the accepted scope and risk?",
      };
    }
    if (["operations", "sre", "platform", "devops", "reliability"].some((term) => normalized.includes(term))) {
      return {
        summary: "Evaluate the same options through reliability, rollout, observability, and recovery needs.",
        focusAreas: ["operational reliability", "rollout and rollback", "monitoring and recovery"],
        reviewPrompt: "Which recorded option can be operated and recovered safely, and what evidence is required?",
      };
    }
    if (["design", "ux", "accessibility"].some((term) => normalized.includes(term))) {
      return {
        summary: "Evaluate the same options through comprehension, accessibility, interaction cost, and user trust.",
        focusAreas: ["user comprehension", "accessibility", "interaction cost and trust"],
        reviewPrompt: "Which recorded option creates the clearest accessible experience with acceptable user cost?",
      };
    }
    if (["architect", "engineer", "developer", "technical"].some((term) => normalized.includes(term))) {
      return {
        summary: "Evaluate the same options through system boundaries, compatibility, delivery complexity, and maintenance.",
        focusAreas: ["system boundaries", "compatibility", "implementation and maintenance cost"],
        reviewPrompt: "Which recorded option fits the architecture with acceptable complexity and long-term cost?",
      };
    }
    return {
      summary: "Evaluate the recorded options through this role's responsibilities, evidence, and accountable trade-offs.",
      focusAreas: ["role responsibilities", "supporting evidence", "risks and trade-offs"],
      reviewPrompt: "Which recorded option should this role support, and what evidence or concern should the owner consider?",
    };
  }

  async requestQuestionClarification(
    principal: Principal,
    questionId: string,
    input: QuestionClarificationInput,
  ): Promise<Question> {
    return this.tenantTransaction(principal, async (repository) => {
      const question = await this.requireQuestion(principal, questionId, repository);
      assertHuman(principal, "Requesting question clarification");
      if (!canRequestQuestionClarification(principal, question)) {
        throw new BridgeError(
          "FORBIDDEN",
          "Only a question owner or project administrator can request clarification.",
          403,
        );
      }
      this.assertSecretSafe("question", input);
      if (question.version !== input.expectedVersion) {
        throw new BridgeError("CONFLICT", "The question changed after it was read.", 409, {
          expectedVersion: input.expectedVersion,
          currentVersion: question.version,
        });
      }
      const timestamp = this.now().toISOString();
      const updated: Question = {
        ...question,
        status: "in_discussion",
        version: question.version + 1,
      };
      await repository.saveQuestion(updated);
      await this.audit(
        repository,
        principal,
        question.projectId,
        "question.clarification_requested",
        "question",
        question.id,
        timestamp,
        question.policyVersion,
        input.reason,
        { policyRuleKey: question.policyRuleKey },
      );
      await this.notify(
        repository,
        principal,
        question.projectId,
        [
          ...question.ownerIds,
          question.createdById,
          ...question.responses.map((response) => response.authorId),
          ...question.comments.map((comment) => comment.authorId),
        ],
        {
          type: "question_comment",
          title: "Clarification requested",
          body: `${principal.displayName} requested clarification for “${question.title}”.`,
          targetType: "question",
          targetId: question.id,
          recipientRoles: question.ownerRoles,
          questionContext: {
            id: question.id,
            status: updated.status,
            risk: question.risk,
            ownerIds: question.ownerIds,
          },
        },
      );
      return updated;
    });
  }

  async reopenQuestion(
    principal: Principal,
    questionId: string,
    input: QuestionClarificationInput,
  ): Promise<Question> {
    return this.tenantTransaction(principal, async (repository) => {
      const question = await this.requireQuestion(principal, questionId, repository);
      assertHuman(principal, "Reopening question discussion");
      if (!canReopenQuestion(principal, question)) {
        throw new BridgeError(
          "FORBIDDEN",
          "Only a question owner or project administrator can reopen this discussion.",
          403,
        );
      }
      this.assertSecretSafe("question", input);
      if (question.version !== input.expectedVersion) {
        throw new BridgeError("CONFLICT", "The question changed after it was read.", 409, {
          expectedVersion: input.expectedVersion,
          currentVersion: question.version,
        });
      }
      const timestamp = this.now().toISOString();
      const updated: Question = {
        ...question,
        status: "in_discussion",
        version: question.version + 1,
      };
      await repository.saveQuestion(updated);
      await this.audit(
        repository,
        principal,
        question.projectId,
        "question.reopened",
        "question",
        question.id,
        timestamp,
        question.policyVersion,
        input.reason,
        { policyRuleKey: question.policyRuleKey },
      );
      await this.notify(
        repository,
        principal,
        question.projectId,
        [
          ...question.ownerIds,
          question.createdById,
          ...question.responses.map((response) => response.authorId),
          ...question.comments.map((comment) => comment.authorId),
        ],
        {
          type: "question_comment",
          title: "Question discussion reopened",
          body: `${principal.displayName} reopened “${question.title}” for discussion.`,
          targetType: "question",
          targetId: question.id,
          recipientRoles: question.ownerRoles,
          questionContext: {
            id: question.id,
            status: updated.status,
            risk: question.risk,
            ownerIds: question.ownerIds,
          },
        },
      );
      return updated;
    });
  }

  async reassignQuestion(
    principal: Principal,
    questionId: string,
    input: ReassignQuestionInput,
  ): Promise<Question> {
    return this.tenantTransaction(principal, async (repository) => {
      const question = await this.requireQuestion(principal, questionId, repository);
      const project = await this.requireProject(principal, question.projectId, repository);
      this.assertProjectOperator(principal, "Reassigning a question", project.id);
      this.assertSecretSafe("question", input);
      if (question.version !== input.expectedVersion) {
        throw new BridgeError("CONFLICT", "The question changed after it was read.", 409, {
          expectedVersion: input.expectedVersion,
          currentVersion: question.version,
        });
      }
      if (!["open", "in_discussion"].includes(question.status)) {
        throw new BridgeError("CONFLICT", "Only an unresolved question can be reassigned.", 409);
      }
      const activeHumans = new Map(
        (await repository.listOrganizationPrincipals(principal.organizationId))
          .filter((candidate) => {
            if (candidate.type !== "human") return false;
            try {
              assertProjectAccess(candidate, project);
              return true;
            } catch {
              return false;
            }
          })
          .map((candidate) => [candidate.id, candidate]),
      );
      for (const principalId of [...input.ownerIds, ...input.reviewerIds]) {
        if (!activeHumans.has(principalId)) {
          throw new BridgeError(
            "VALIDATION_FAILED",
            "Question assignments can target only active human members with project access.",
            400,
            { principalId },
          );
        }
      }
      const normalizedOwnerRoles = this.normalizedRoles(input.ownerRoles);
      const normalizedReviewerRoles = this.normalizedRoles(input.reviewerRoles);
      if (normalizedOwnerRoles.length !== input.ownerRoles.length ||
        normalizedReviewerRoles.length !== input.reviewerRoles.length) {
        throw new BridgeError("VALIDATION_FAILED", "Assignment roles must be unique after normalization.", 400);
      }
      const ownerRoles = this.normalizedRoles([...normalizedOwnerRoles, ...(question.requiredOwnerRoles ?? [])]);
      const reviewerRoles = this.normalizedRoles([
        ...normalizedReviewerRoles,
        ...(question.requiredReviewerRoles ?? []),
      ]);
      const ownersChanged = JSON.stringify([...input.ownerIds].sort()) !== JSON.stringify([...question.ownerIds].sort()) ||
        JSON.stringify(ownerRoles) !== JSON.stringify(this.normalizedRoles(question.ownerRoles));
      const reviewersChanged = JSON.stringify([...input.reviewerIds].sort()) !== JSON.stringify([...question.reviewerIds].sort()) ||
        JSON.stringify(reviewerRoles) !== JSON.stringify(this.normalizedRoles(question.reviewerRoles));
      if (!ownersChanged && !reviewersChanged) {
        throw new BridgeError("CONFLICT", "The reassignment does not change the current owner or reviewer route.", 409);
      }
      const timestamp = this.now().toISOString();
      const ownershipVersion = (await repository.getProjectOwnershipConfiguration(project.id))?.version ?? 0;
      const route: QuestionRoutingExplanation = {
        ownerSource: "reassignment",
        reviewerSource: "reassignment",
        ownershipVersion,
        policyVersion: question.policyVersion,
      };
      const assignment: QuestionAssignmentHistoryEntry = {
        id: `qas_${this.id()}`,
        kind: "reassigned",
        changedById: principal.id,
        changedByType: principal.type,
        ownerIds: [...input.ownerIds],
        ownerRoles,
        reviewerIds: [...input.reviewerIds],
        reviewerRoles,
        route,
        reason: input.reason,
        createdAt: timestamp,
        questionVersion: question.version + 1,
      };
      const updated: Question = {
        ...question,
        ownerIds: assignment.ownerIds,
        ownerRoles: assignment.ownerRoles,
        reviewerIds: assignment.reviewerIds,
        reviewerRoles: assignment.reviewerRoles,
        routing: route,
        assignmentHistory: [...(question.assignmentHistory ?? []), assignment],
        version: question.version + 1,
      };
      await repository.saveQuestion(updated);
      await this.audit(
        repository,
        principal,
        question.projectId,
        !ownersChanged && reviewersChanged ? "question.review_reassigned" : "question.reassigned",
        "question",
        question.id,
        timestamp,
        question.policyVersion,
        input.reason,
        {
          beforeVersion: question.version,
          afterVersion: updated.version,
          policyRuleKey: question.policyRuleKey,
          assignmentId: assignment.id,
          ownerRouteSource: assignment.route.ownerSource,
          reviewerRouteSource: assignment.route.reviewerSource,
        },
      );
      await repository.saveOutboxEvent({
        id: `evt_${this.id()}`,
        correlationId: currentCorrelationId() ?? createCorrelationId(),
        organizationId: question.organizationId,
        projectId: question.projectId,
        type: "question.reassigned",
        payload: {
          questionId: question.id,
          changedById: principal.id,
          assignmentId: assignment.id,
          questionVersion: updated.version,
        },
        status: "pending",
        attempts: 0,
        availableAt: timestamp,
        createdAt: timestamp,
      });
      await this.notify(repository, principal, question.projectId, [
        ...updated.ownerIds,
        ...updated.reviewerIds,
      ], {
        type: "question_assigned",
        title: "Question assignment changed",
        body: `${principal.displayName} reassigned “${question.title}”.`,
        targetType: "question",
        targetId: question.id,
        recipientRoles: [...updated.ownerRoles, ...updated.reviewerRoles],
        questionContext: {
          id: question.id,
          status: question.status,
          risk: question.risk,
          ownerIds: updated.ownerIds,
        },
      });
      return updated;
    });
  }

  async reviewQuestion(
    principal: Principal,
    questionId: string,
    input: QuestionReviewInput,
  ): Promise<QuestionReview> {
    return this.tenantTransaction(principal, (repository) =>
      this.reviewQuestionInTransaction(repository, principal, questionId, input),
    );
  }

  private async reviewQuestionInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    questionId: string,
    input: QuestionReviewInput,
  ): Promise<QuestionReview> {
    assertHuman(principal, "Reviewing a question");
    const question = await this.requireQuestion(principal, questionId, repository);
    if (question.risk !== "protected") {
      throw new BridgeError("POLICY_BLOCKED", "Separate policy review is required only for protected questions.", 422);
    }
    const requiredReviewerRoles = question.requiredReviewerRoles.length > 0
      ? question.requiredReviewerRoles
      : !question.policyRuleKey || question.policyRuleKey === "bridge-legacy-protected"
        ? ["security-reviewer"]
        : [];
    if (requiredReviewerRoles.length === 0) {
      throw new BridgeError(
        "POLICY_BLOCKED",
        "This protected policy requires owner authority but no separate reviewer role.",
        422,
      );
    }
    const principalReviewerRoles = requiredReviewerRoles.filter((role) =>
      principalHasRole(principal, role, question.projectId));
    if (principalReviewerRoles.length === 0) {
      throw new BridgeError(
        "FORBIDDEN",
        "Only a human with a policy-required reviewer role can review this protected question.",
        403,
        { requiredReviewerRoles },
      );
    }
    const reviewerRole = principalReviewerRoles.find((role) =>
      !question.reviews.some((review) =>
        review.reviewerId === principal.id && normalizeRoleName(review.reviewerRole) === normalizeRoleName(role)));
    if (!reviewerRole) {
      throw new BridgeError(
        "CONFLICT",
        "This reviewer has already reviewed the question for every matching required role.",
        409,
        { requiredReviewerRoles },
      );
    }
    this.assertSecretSafe("question", input);
    if (question.version !== input.expectedVersion) {
      throw new BridgeError("CONFLICT", "The question changed after it was read.", 409, {
        expectedVersion: input.expectedVersion,
        currentVersion: question.version,
      });
    }
    if (!["open", "in_discussion"].includes(question.status)) {
      throw new BridgeError("CONFLICT", "Only an unresolved question can receive a security review.", 409);
    }
    const timestamp = this.now().toISOString();
    const review: QuestionReview = {
      id: `qrv_${this.id()}`,
      questionId,
      reviewerId: principal.id,
      reviewerType: principal.type,
      reviewerRole: normalizeRoleName(reviewerRole),
      status: input.status,
      rationale: input.rationale,
      createdAt: timestamp,
    };
    await repository.saveQuestion({
      ...question,
      reviews: [...question.reviews, review],
      version: question.version + 1,
    });
    await this.audit(
      repository,
      principal,
      question.projectId,
      "question.reviewed",
      "question",
      question.id,
      timestamp,
      question.policyVersion,
      undefined,
      { policyRuleKey: question.policyRuleKey },
    );
    await this.notify(repository, principal, question.projectId, [...question.ownerIds, question.createdById], {
      type: "question_review",
      title: "Protected policy review recorded",
      body: `${principal.displayName} marked “${question.title}” ${review.status}.`,
      targetType: "review",
      targetId: review.id,
      recipientRoles: question.ownerRoles,
      questionContext: {
        id: question.id,
        status: question.status,
        risk: question.risk,
        ownerIds: question.ownerIds,
      },
    });
    return review;
  }

  async addQuestionComment(
    principal: Principal,
    questionId: string,
    input: QuestionCommentInput,
  ): Promise<QuestionComment> {
    return this.tenantTransaction(principal, (repository) =>
      this.addQuestionCommentInTransaction(repository, principal, questionId, input),
    );
  }

  private async addQuestionCommentInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    questionId: string,
    input: QuestionCommentInput,
  ): Promise<QuestionComment> {
    assertHuman(principal, "Commenting on a question");
    const question = await this.requireQuestion(principal, questionId, repository);
    this.assertSecretSafe("question", input);
    if (!["open", "in_discussion"].includes(question.status)) {
      throw new BridgeError("CONFLICT", "Resolved questions do not accept new clarification comments.", 409);
    }
    if (question.version !== input.expectedVersion) {
      throw new BridgeError("CONFLICT", "The question changed after it was read.", 409, {
        expectedVersion: input.expectedVersion,
        currentVersion: question.version,
      });
    }
    if (input.parentCommentId && !question.comments.some((comment) => comment.id === input.parentCommentId)) {
      throw new BridgeError("VALIDATION_FAILED", "parentCommentId does not belong to this question.", 422);
    }
    const mentionedPrincipalIds = await this.validateQuestionMentions(
      repository,
      question,
      input.mentionedPrincipalIds,
    );

    const timestamp = this.now().toISOString();
    const comment: QuestionComment = {
      id: `qcm_${this.id()}`,
      questionId,
      ...(input.parentCommentId ? { parentCommentId: input.parentCommentId } : {}),
      authorId: principal.id,
      authorType: principal.type,
      body: input.body,
      ...(mentionedPrincipalIds.length > 0 ? { mentionedPrincipalIds } : {}),
      createdAt: timestamp,
    };
    await repository.saveQuestion({
      ...question,
      status: "in_discussion",
      comments: [...question.comments, comment],
      version: question.version + 1,
    });
    await this.audit(
      repository, principal, question.projectId, "question.comment_added", "question", question.id, timestamp,
      question.policyVersion, undefined, { policyRuleKey: question.policyRuleKey },
    );
    await this.notify(
      repository,
      principal,
      question.projectId,
      [
        ...question.ownerIds,
        ...mentionedPrincipalIds,
        ...question.responses.map((response) => response.authorId),
        ...question.comments.map((existing) => existing.authorId),
      ],
      {
        type: "question_comment",
        title: "New question clarification",
        body: `${principal.displayName} added a clarification to “${question.title}”.`,
        targetType: "comment",
        targetId: comment.id,
        recipientRoles: question.ownerRoles,
        questionContext: {
          id: question.id,
          status: "in_discussion",
          risk: question.risk,
          ownerIds: question.ownerIds,
        },
      },
    );
    return comment;
  }

  private async requireQuestion(
    principal: Principal,
    questionId: string,
    repository: BridgeRepository,
  ): Promise<Question> {
    const question = await repository.getQuestion(questionId);
    if (!question) {
      throw new BridgeError("QUESTION_NOT_FOUND", "Question not found.", 404);
    }
    await this.requireProjectForResource(
      principal,
      question.projectId,
      repository,
      "QUESTION_NOT_FOUND",
      "Question not found.",
    );
    return question;
  }

  private async validateQuestionMentions(
    repository: BridgeRepository,
    question: Question,
    mentionedPrincipalIds: readonly string[] | undefined,
  ): Promise<readonly string[]> {
    const uniqueIds = [...new Set((mentionedPrincipalIds ?? []).map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    const projectHumans = new Set(
      (await repository.listOrganizationPrincipals(question.organizationId))
        .filter((candidate) => candidate.type === "human" && (
          candidate.allProjects === true ||
          candidate.projectIds.includes(question.projectId) ||
          principalHasRole(candidate, "organization-admin")
        ))
        .map((candidate) => candidate.id),
    );
    const invalidPrincipalId = uniqueIds.find((principalId) => !projectHumans.has(principalId));
    if (invalidPrincipalId) {
      throw new BridgeError(
        "VALIDATION_FAILED",
        "Mentions can target only active human members with access to this project.",
        422,
        { principalId: invalidPrincipalId },
      );
    }
    return uniqueIds;
  }

  async proposeAnswer(
    principal: Principal,
    questionId: string,
    input: ProposeAnswerInput,
  ): Promise<QuestionResponse> {
    return this.tenantTransaction(principal, (repository) =>
      this.proposeAnswerInTransaction(repository, principal, questionId, input),
    );
  }

  private async proposeAnswerInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    questionId: string,
    input: ProposeAnswerInput,
  ): Promise<QuestionResponse> {
    assertHuman(principal, "Proposing an answer");
    const question = await this.requireQuestion(principal, questionId, repository);
    this.assertSecretSafe("question", input);
    if (!["open", "in_discussion"].includes(question.status)) {
      throw new BridgeError("CONFLICT", "This question no longer accepts responses.", 409);
    }
    if (input.optionKey && !question.options.some((option) => option.key === input.optionKey)) {
      throw new BridgeError("VALIDATION_FAILED", "optionKey does not belong to this question.", 422);
    }
    const mentionedPrincipalIds = await this.validateQuestionMentions(
      repository,
      question,
      input.mentionedPrincipalIds,
    );

    const timestamp = this.now().toISOString();
    const response: QuestionResponse = {
      id: `rsp_${this.id()}`,
      questionId,
      authorId: principal.id,
      authorType: principal.type,
      answer: input.answer,
      rationale: input.rationale,
      ...(input.optionKey ? { optionKey: input.optionKey } : {}),
      ...(mentionedPrincipalIds.length > 0 ? { mentionedPrincipalIds } : {}),
      createdAt: timestamp,
    };
    await repository.saveQuestion({
      ...question,
      status: "in_discussion",
      responses: [...question.responses, response],
      version: question.version + 1,
    });
    await this.audit(
      repository, principal, question.projectId, "response.proposed", "response", response.id, timestamp,
      question.policyVersion, undefined, { policyRuleKey: question.policyRuleKey },
    );
    await this.notify(repository, principal, question.projectId, [
      ...question.ownerIds,
      ...mentionedPrincipalIds,
    ], {
      type: "question_response",
      title: "New proposed answer",
      body: `${principal.displayName} proposed an answer for “${question.title}”.`,
      targetType: "response",
      targetId: response.id,
      recipientRoles: question.ownerRoles,
      questionContext: {
        id: question.id,
        status: "in_discussion",
        risk: question.risk,
        ownerIds: question.ownerIds,
      },
    });
    return response;
  }

  async editQuestionResponse(
    principal: Principal,
    questionId: string,
    responseId: string,
    input: EditQuestionResponseInput,
  ): Promise<QuestionResponse> {
    return this.tenantTransaction(principal, (repository) =>
      this.editQuestionResponseInTransaction(repository, principal, questionId, responseId, input),
    );
  }

  private async editQuestionResponseInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    questionId: string,
    responseId: string,
    input: EditQuestionResponseInput,
  ): Promise<QuestionResponse> {
    assertHuman(principal, "Editing a proposed answer");
    const question = await this.requireQuestion(principal, questionId, repository);
    const response = question.responses.find((candidate) => candidate.id === responseId);
    if (!response) {
      throw new BridgeError("VALIDATION_FAILED", "responseId does not belong to this question.", 422);
    }
    if (!["open", "in_discussion"].includes(question.status)) {
      throw new BridgeError("CONFLICT", "Resolved questions do not accept response edits.", 409);
    }
    if (response.authorType !== "human" || response.authorId !== principal.id) {
      throw new BridgeError("FORBIDDEN", "Only the original human response author can edit this answer.", 403);
    }
    this.assertSecretSafe("question", input);
    if (question.version !== input.expectedVersion) {
      throw new BridgeError("CONFLICT", "The question changed after it was read.", 409, {
        expectedVersion: input.expectedVersion,
        currentVersion: question.version,
      });
    }
    if (input.optionKey && !question.options.some((option) => option.key === input.optionKey)) {
      throw new BridgeError("VALIDATION_FAILED", "optionKey does not belong to this question.", 422);
    }
    const mentionedPrincipalIds = await this.validateQuestionMentions(
      repository,
      question,
      input.mentionedPrincipalIds ?? response.mentionedPrincipalIds,
    );
    const unchanged = response.answer === input.answer &&
      response.rationale === input.rationale &&
      response.optionKey === input.optionKey &&
      JSON.stringify(response.mentionedPrincipalIds ?? []) === JSON.stringify(mentionedPrincipalIds);
    if (unchanged) {
      throw new BridgeError("CONFLICT", "The response edit does not change the current answer.", 409);
    }
    const timestamp = this.now().toISOString();
    const revision: QuestionResponseRevision = {
      id: `rsv_${this.id()}`,
      answer: response.answer,
      rationale: response.rationale,
      ...(response.optionKey ? { optionKey: response.optionKey } : {}),
      mentionedPrincipalIds: response.mentionedPrincipalIds ?? [],
      editedById: principal.id,
      editedByType: principal.type,
      editedAt: timestamp,
    };
    const {
      optionKey: previousOptionKey,
      mentionedPrincipalIds: previousMentionedPrincipalIds,
      ...responseWithoutEditableMetadata
    } = response;
    const updatedResponse: QuestionResponse = {
      ...responseWithoutEditableMetadata,
      answer: input.answer,
      rationale: input.rationale,
      ...(input.optionKey ? { optionKey: input.optionKey } : {}),
      ...(mentionedPrincipalIds.length > 0 ? { mentionedPrincipalIds } : {}),
      revisionHistory: [...(response.revisionHistory ?? []), revision],
    };
    await repository.saveQuestion({
      ...question,
      responses: question.responses.map((candidate) => candidate.id === responseId ? updatedResponse : candidate),
      version: question.version + 1,
    });
    await this.audit(
      repository,
      principal,
      question.projectId,
      "response.edited",
      "response",
      response.id,
      timestamp,
      question.policyVersion,
      undefined,
      { policyRuleKey: question.policyRuleKey },
    );
    await this.notify(
      repository,
      principal,
      question.projectId,
      [
        ...question.ownerIds,
        ...mentionedPrincipalIds,
        ...question.responses.map((candidate) => candidate.authorId),
        ...question.comments.map((comment) => comment.authorId),
      ],
      {
        type: "question_response",
        title: "Proposed answer edited",
        body: `${principal.displayName} edited a proposed answer for “${question.title}”.`,
        targetType: "response",
        targetId: response.id,
        recipientRoles: question.ownerRoles,
        questionContext: {
          id: question.id,
          status: question.status,
          risk: question.risk,
          ownerIds: question.ownerIds,
        },
      },
    );
    return updatedResponse;
  }

  async editQuestionComment(
    principal: Principal,
    questionId: string,
    commentId: string,
    input: EditQuestionCommentInput,
  ): Promise<QuestionComment> {
    return this.tenantTransaction(principal, (repository) =>
      this.editQuestionCommentInTransaction(repository, principal, questionId, commentId, input),
    );
  }

  private async editQuestionCommentInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    questionId: string,
    commentId: string,
    input: EditQuestionCommentInput,
  ): Promise<QuestionComment> {
    assertHuman(principal, "Editing a question comment");
    const question = await this.requireQuestion(principal, questionId, repository);
    const comment = question.comments.find((candidate) => candidate.id === commentId);
    if (!comment) {
      throw new BridgeError("VALIDATION_FAILED", "commentId does not belong to this question.", 422);
    }
    if (!["open", "in_discussion"].includes(question.status)) {
      throw new BridgeError("CONFLICT", "Resolved questions do not accept comment edits.", 409);
    }
    if (comment.authorType !== "human" || comment.authorId !== principal.id) {
      throw new BridgeError("FORBIDDEN", "Only the original human comment author can edit this comment.", 403);
    }
    this.assertSecretSafe("question", input);
    if (question.version !== input.expectedVersion) {
      throw new BridgeError("CONFLICT", "The question changed after it was read.", 409, {
        expectedVersion: input.expectedVersion,
        currentVersion: question.version,
      });
    }
    const mentionedPrincipalIds = await this.validateQuestionMentions(
      repository,
      question,
      input.mentionedPrincipalIds ?? comment.mentionedPrincipalIds,
    );
    const unchanged = comment.body === input.body &&
      JSON.stringify(comment.mentionedPrincipalIds ?? []) === JSON.stringify(mentionedPrincipalIds);
    if (unchanged) {
      throw new BridgeError("CONFLICT", "The comment edit does not change the current comment.", 409);
    }
    const timestamp = this.now().toISOString();
    const revision: QuestionCommentRevision = {
      id: `csv_${this.id()}`,
      body: comment.body,
      mentionedPrincipalIds: comment.mentionedPrincipalIds ?? [],
      editedById: principal.id,
      editedByType: principal.type,
      editedAt: timestamp,
    };
    const {
      mentionedPrincipalIds: previousMentionedPrincipalIds,
      ...commentWithoutEditableMetadata
    } = comment;
    const updatedComment: QuestionComment = {
      ...commentWithoutEditableMetadata,
      body: input.body,
      ...(mentionedPrincipalIds.length > 0 ? { mentionedPrincipalIds } : {}),
      revisionHistory: [...(comment.revisionHistory ?? []), revision],
    };
    await repository.saveQuestion({
      ...question,
      comments: question.comments.map((candidate) => candidate.id === commentId ? updatedComment : candidate),
      version: question.version + 1,
    });
    await this.audit(
      repository,
      principal,
      question.projectId,
      "question.comment_edited",
      "question",
      question.id,
      timestamp,
      question.policyVersion,
      undefined,
      { policyRuleKey: question.policyRuleKey },
    );
    await this.notify(
      repository,
      principal,
      question.projectId,
      [
        ...question.ownerIds,
        ...mentionedPrincipalIds,
        ...question.responses.map((response) => response.authorId),
        ...question.comments.map((candidate) => candidate.authorId),
      ],
      {
        type: "question_comment",
        title: "Question clarification edited",
        body: `${principal.displayName} edited a clarification on “${question.title}”.`,
        targetType: "comment",
        targetId: comment.id,
        recipientRoles: question.ownerRoles,
        questionContext: {
          id: question.id,
          status: question.status,
          risk: question.risk,
          ownerIds: question.ownerIds,
        },
      },
    );
    return updatedComment;
  }

  async acceptAnswer(
    principal: Principal,
    questionId: string,
    input: AcceptAnswerInput,
  ): Promise<Decision> {
    return this.tenantTransaction(principal, (repository) =>
      this.acceptAnswerInTransaction(repository, principal, questionId, input),
    );
  }

  async overrideQuestionApproval(
    principal: Principal,
    questionId: string,
    input: OverrideQuestionApprovalInput,
  ): Promise<Decision> {
    return this.tenantTransaction(principal, (repository) => {
      const { expectedVersion, reason, ...acceptInput } = input;
      return this.acceptAnswerInTransaction(repository, principal, questionId, acceptInput, {
        expectedVersion,
        reason,
      });
    });
  }

  private async acceptAnswerInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    questionId: string,
    input: AcceptAnswerInput,
    override?: { readonly expectedVersion: number; readonly reason: string },
  ): Promise<Decision> {
    const question = await this.requireQuestion(principal, questionId, repository);
    if (override) {
      this.assertProjectOperator(principal, "Overriding protected approval", question.projectId);
      if (question.version !== override.expectedVersion) {
        throw new BridgeError("CONFLICT", "The question changed after it was read.", 409, {
          expectedVersion: override.expectedVersion,
          currentVersion: question.version,
        });
      }
      if (question.risk !== "protected") {
        throw new BridgeError("POLICY_BLOCKED", "Administrative approval override is limited to protected questions.", 403);
      }
      if (canAcceptQuestion(principal, question)) {
        throw new BridgeError("CONFLICT", "Protected approval requirements are already satisfied for this administrator; use ordinary acceptance.", 409);
      }
      this.assertSecretSafe("question", { ...input, reason: override.reason });
    } else {
      assertCanAccept(principal, question);
      this.assertSecretSafe("decision", input);
    }
    if (!["open", "in_discussion"].includes(question.status)) {
      throw new BridgeError("CONFLICT", "This question has already been resolved.", 409);
    }

    const selectedOption = input.optionKey
      ? question.options.find((option) => option.key === input.optionKey)
      : undefined;
    if (input.optionKey && !selectedOption) {
      throw new BridgeError("VALIDATION_FAILED", "optionKey does not belong to this question.", 422);
    }

    const timestampDate = this.now();
    const timestamp = timestampDate.toISOString();
    const response: QuestionResponse = {
      id: `rsp_${this.id()}`,
      questionId,
      authorId: principal.id,
      authorType: principal.type,
      answer: input.answer ?? selectedOption?.label ?? "",
      rationale: input.rationale,
      ...(input.optionKey ? { optionKey: input.optionKey } : {}),
      createdAt: timestamp,
    };
    const decision: Decision = {
      id: `dec_${this.id()}`,
      organizationId: question.organizationId,
      projectId: question.projectId,
      questionId,
      answer: response.answer,
      rationale: response.rationale,
      category: question.category,
      scope: { ...question.scope },
      ownerId: principal.id,
      sourceResponseId: response.id,
      status: "active",
      createdAt: timestamp,
      reviewAt: reviewDateFor(question.risk, timestampDate),
      version: 1,
    };

    await repository.saveDecision(decision);
    await repository.saveQuestion({
      ...question,
      status: "accepted",
      responses: [...question.responses, response],
      acceptedResponseId: response.id,
      decisionId: decision.id,
      ...(override ? {
        approvalOverride: {
          changedById: principal.id,
          changedByType: principal.type,
          reason: override.reason,
          createdAt: timestamp,
          questionVersion: question.version + 1,
        } satisfies QuestionApprovalOverride,
      } : {}),
      version: question.version + 1,
    });
    if (override) {
      await this.audit(
        repository,
        principal,
        question.projectId,
        "question.approval_overridden",
        "question",
        question.id,
        timestamp,
        question.policyVersion,
        override.reason,
        { policyRuleKey: question.policyRuleKey },
      );
    }
    await this.audit(
      repository, principal, question.projectId, "decision.accepted", "decision", decision.id, timestamp,
      question.policyVersion, undefined, { policyRuleKey: question.policyRuleKey },
    );
    await this.notify(
      repository,
      principal,
      question.projectId,
      [
        question.createdById,
        ...question.responses.map((response) => response.authorId),
        ...question.comments.map((comment) => comment.authorId),
      ],
      {
        type: "question_accepted",
        title: override ? "Question accepted with administrative override" : "Question accepted",
        body: override
          ? `${principal.displayName} accepted the decision for “${question.title}” with an audited administrative override.`
          : `${principal.displayName} accepted the decision for “${question.title}”.`,
        targetType: "decision",
        targetId: decision.id,
        recipientRoles: question.ownerRoles,
        questionContext: {
          id: question.id,
          status: "accepted",
          risk: question.risk,
          ownerIds: question.ownerIds,
        },
      },
    );
    await this.queueAutomaticRunContinuations(
      repository,
      principal,
      question.projectId,
      question.id,
      decision.id,
      timestamp,
    );
    return decision;
  }

  async listDecisions(
    principal: Principal,
    projectId: string,
    query: DecisionListQuery = { includeHistory: false, scope: {} },
  ): Promise<readonly Decision[]> {
    return this.tenantTransaction(principal, async (repository) => {
    await this.requireProject(principal, projectId, repository);
    const category = query.category?.toLocaleLowerCase("en");
    const scopeEntries = Object.entries(query.scope).filter((entry): entry is [keyof Scope, string] => Boolean(entry[1]));
    const candidates = query.search
      ? await repository.searchDecisions(projectId, query.search)
      : await repository.listDecisions(projectId);
    return candidates.filter((decision) => {
      if (query.status ? decision.status !== query.status : !query.includeHistory && decision.status !== "active") {
        return false;
      }
      if (category && decision.category.toLocaleLowerCase("en") !== category) return false;
      if (query.ownerId && decision.ownerId !== query.ownerId) return false;
      if (query.createdFrom && Date.parse(decision.createdAt) < Date.parse(query.createdFrom)) return false;
      if (query.createdTo && Date.parse(decision.createdAt) > Date.parse(query.createdTo)) return false;
      return scopeEntries.every(([key, value]) => decision.scope[key] === value);
    });
    });
  }

  async listDecisionConflicts(
    principal: Principal,
    projectId: string,
    query: DecisionConflictQuery,
  ): Promise<readonly DecisionConflict[]> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      const normalizedCategory = query.category?.normalize("NFKC").toLocaleLowerCase("en");
      const decisions = (await repository.listDecisions(projectId))
        .filter((decision) =>
          decision.status === "active" &&
          (!normalizedCategory || decision.category.normalize("NFKC").toLocaleLowerCase("en") === normalizedCategory) &&
          this.scopesOverlap(decision.scope, query.scope),
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      const conflicts: DecisionConflict[] = [];
      for (let leftIndex = 0; leftIndex < decisions.length; leftIndex += 1) {
        const left = decisions[leftIndex]!;
        for (let rightIndex = leftIndex + 1; rightIndex < decisions.length; rightIndex += 1) {
          const right = decisions[rightIndex]!;
          if (
            left.category.normalize("NFKC").toLocaleLowerCase("en") !==
              right.category.normalize("NFKC").toLocaleLowerCase("en") ||
            !this.scopesOverlap(left.scope, right.scope) ||
            this.normalizeQuestionText(left.answer) === this.normalizeQuestionText(right.answer)
          ) continue;
          const opposingLanguage = this.answersUseOpposingLanguage(left.answer, right.answer);
          const exactScope = this.scopesEqual(left.scope, right.scope);
          if (!exactScope && !opposingLanguage) continue;
          const signals: DecisionConflict["signals"] = [
            ...(exactScope ? ["different answers in exact scope" as const] : []),
            ...(opposingLanguage ? ["opposing language" as const] : []),
          ];
          const leftScopeEntries = Object.entries(left.scope).filter((entry): entry is [keyof Scope, string] => Boolean(entry[1]));
          const rightScopeEntries = Object.entries(right.scope).filter((entry): entry is [keyof Scope, string] => Boolean(entry[1]));
          const leftContainsRight = rightScopeEntries.every(([key, value]) => left.scope[key] === value);
          const rightContainsLeft = leftScopeEntries.every(([key, value]) => right.scope[key] === value);
          const pairIds = [left.id, right.id].sort((a, b) => a.localeCompare(b));
          conflicts.push({
            id: `dcf_${createHash("sha256").update(`${projectId}\u0000${pairIds.join("\u0000")}`).digest("hex").slice(0, 24)}`,
            category: left.category,
            confidence: opposingLanguage && exactScope ? "high" : "medium",
            scopeRelation: exactScope
              ? "exact"
              : leftContainsRight || rightContainsLeft
                ? "ancestor_descendant"
                : "partial",
            overlappingFields: leftScopeEntries
              .filter(([key, value]) => right.scope[key] === value)
              .map(([key]) => key),
            signals,
            left: {
              id: left.id,
              answer: left.answer,
              rationale: left.rationale,
              scope: { ...left.scope },
              ownerId: left.ownerId,
              createdAt: left.createdAt,
              version: left.version,
            },
            right: {
              id: right.id,
              answer: right.answer,
              rationale: right.rationale,
              scope: { ...right.scope },
              ownerId: right.ownerId,
              createdAt: right.createdAt,
              version: right.version,
            },
            advisory: true,
            humanResolutionRequired: true,
          });
        }
      }
      return conflicts
        .sort((left, right) =>
          Number(right.confidence === "high") - Number(left.confidence === "high") ||
          right.signals.length - left.signals.length ||
          left.id.localeCompare(right.id),
        )
        .slice(0, query.maxItems);
    });
  }

  async changeDecisionLifecycle(
    principal: Principal,
    decisionId: string,
    input: ChangeDecisionLifecycleInput,
  ): Promise<DecisionLifecycleChange> {
    return this.tenantTransaction(principal, (repository) =>
      this.changeDecisionLifecycleInTransaction(repository, principal, decisionId, input),
    );
  }

  async analyzeDecisionImpact(
    principal: Principal,
    decisionId: string,
    query: DecisionImpactQuery,
  ): Promise<DecisionLifecycleImpact> {
    return this.tenantTransaction(principal, async (repository) => {
      const decision = await this.requireDecision(principal, decisionId, repository);
      return this.calculateDecisionImpact(repository, decision, query);
    });
  }

  private async changeDecisionLifecycleInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    decisionId: string,
    input: ChangeDecisionLifecycleInput,
  ): Promise<DecisionLifecycleChange> {
    const decision = await this.requireDecision(principal, decisionId, repository);
    assertHuman(principal, "Changing a decision lifecycle");
    const project = await this.requireProject(principal, decision.projectId, repository);
    const mayManage = decision.ownerId === principal.id ||
      project.decisionOwnerIds.includes(principal.id) ||
      principalHasRole(principal, "project-admin", decision.projectId);
    if (!mayManage) {
      throw new BridgeError(
        "FORBIDDEN",
        "Only the decision owner, a configured project decision owner, or a project administrator can retire this decision.",
        403,
      );
    }
    this.assertSecretSafe("decision", input);
    if (decision.status !== "active") {
      throw new BridgeError("CONFLICT", "Only an active decision can change lifecycle state.", 409);
    }
    if (decision.version !== input.expectedVersion) {
      throw new BridgeError("CONFLICT", "The decision changed before this lifecycle action was applied.", 409, {
        currentVersion: decision.version,
      });
    }

    if (input.replacementDecisionId) {
      if (input.replacementDecisionId === decision.id) {
        throw new BridgeError("VALIDATION_FAILED", "A decision cannot replace itself.", 422);
      }
      const replacement = await this.requireDecision(principal, input.replacementDecisionId, repository);
      if (
        replacement.projectId !== decision.projectId ||
        replacement.status !== "active" ||
        replacement.category !== decision.category ||
        !this.scopesEqual(replacement.scope, decision.scope)
      ) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "A replacement decision must be active and have the same project, category, and exact scope.",
          422,
        );
      }
    }

    const timestamp = this.now().toISOString();
    const changed: Decision = {
      ...decision,
      status: input.status,
      lifecycleRationale: input.rationale,
      lifecycleChangedById: principal.id,
      lifecycleChangedAt: timestamp,
      ...(input.replacementDecisionId
        ? { replacementDecisionId: input.replacementDecisionId }
        : {}),
      version: decision.version + 1,
    };
    await repository.saveDecision(changed);

    const sourceQuestion = decision.questionId
      ? await repository.getQuestion(decision.questionId)
      : undefined;
    const impact = await this.calculateDecisionImpact(repository, decision, {
      maxDepth: 5,
      maxNodes: 200,
    });

    await this.audit(
      repository,
      principal,
      decision.projectId,
      `decision.${input.status}`,
      "decision",
      decision.id,
      timestamp,
      sourceQuestion?.policyVersion,
      undefined,
      sourceQuestion ? { policyRuleKey: sourceQuestion.policyRuleKey } : {},
    );
    await repository.saveOutboxEvent({
      id: `evt_${this.id()}`,
      correlationId: currentCorrelationId() ?? createCorrelationId(),
      organizationId: decision.organizationId,
      projectId: decision.projectId,
      type: "decision.lifecycle_changed",
      payload: {
        decisionId: decision.id,
        status: input.status,
        changedById: principal.id,
        ...(input.replacementDecisionId
          ? { replacementDecisionId: input.replacementDecisionId }
          : {}),
      },
      status: "pending",
      attempts: 0,
      availableAt: timestamp,
      createdAt: timestamp,
    });
    await this.notify(
      repository,
      principal,
      decision.projectId,
      [
        ...project.decisionOwnerIds,
        ...(sourceQuestion
          ? [
              sourceQuestion.createdById,
              ...sourceQuestion.ownerIds,
              ...sourceQuestion.responses.map((response) => response.authorId),
              ...sourceQuestion.comments.map((comment) => comment.authorId),
            ]
          : []),
      ],
      {
        type: "decision_lifecycle",
        title: `Decision ${input.status}`,
        body: `The decision “${decision.answer}” was ${input.status}.`,
        targetType: "decision",
        targetId: decision.id,
        ...(sourceQuestion ? { recipientRoles: sourceQuestion.ownerRoles } : {}),
        ...(sourceQuestion ? {
          questionContext: {
            id: sourceQuestion.id,
            status: sourceQuestion.status,
            risk: sourceQuestion.risk,
            ownerIds: sourceQuestion.ownerIds,
          },
        } : {}),
      },
    );
    return { decision: changed, impact };
  }

  async publishArtifact(
    principal: Principal,
    projectId: string,
    input: PublishArtifactInput,
  ): Promise<ArtifactPublication> {
    return this.tenantTransaction(principal, (repository) =>
      this.publishArtifactInTransaction(repository, principal, projectId, input),
    );
  }

  private async publishArtifactInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    projectId: string,
    input: PublishArtifactInput,
  ): Promise<ArtifactPublication> {
    const project = await this.requireProject(principal, projectId, repository);
    this.assertSecretSafe("artifact", input);
    const idempotencyKey = `artifact:${principal.organizationId}:${principal.id}:${input.idempotencyKey}`;
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existingVersionId = await repository.getIdempotentArtifactVersionId(idempotencyKey);
    if (existingVersionId) {
      const existingHash = await repository.getIdempotentArtifactRequestHash(idempotencyKey);
      if (existingHash !== requestHash) {
        this.recordIdempotency("artifact_publish", "conflict");
        throw new BridgeError("CONFLICT", "The idempotency key was reused with a different request.", 409);
      }
      const existingArtifact = await repository.getArtifactByVersionId(existingVersionId);
      const existingVersion = existingArtifact?.versions.find((version) => version.id === existingVersionId);
      if (!existingArtifact || !existingVersion) {
        this.recordIdempotency("artifact_publish", "conflict");
        throw new BridgeError("CONFLICT", "The idempotent specification version is no longer available.", 409);
      }
      this.recordIdempotency("artifact_publish", "replayed");
      return { artifact: existingArtifact, version: existingVersion };
    }

    for (const decisionId of input.citedDecisionIds) {
      const decision = await repository.getDecision(decisionId);
      if (!decision || decision.projectId !== projectId || decision.organizationId !== principal.organizationId) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          `Cited decision ${decisionId} does not belong to this project.`,
          422,
        );
      }
    }

    let existingArtifact: Artifact | undefined;
    if (input.artifactId) {
      existingArtifact = await repository.getArtifact(input.artifactId);
      if (
        !existingArtifact ||
        existingArtifact.projectId !== projectId ||
        existingArtifact.organizationId !== principal.organizationId
      ) {
        throw new BridgeError("ARTIFACT_NOT_FOUND", "Specification not found.", 404);
      }
      if (existingArtifact.type !== input.type) {
        throw new BridgeError("VALIDATION_FAILED", "A specification's type cannot change between versions.", 422);
      }
    }

    const timestamp = this.now().toISOString();
    const sourceRun = input.runId
      ? await this.requireLinkableRun(principal, input.runId, repository)
      : undefined;
    const artifactId = existingArtifact?.id ?? `art_${this.id()}`;
    const reviewerIds = await this.resolveArtifactReviewers(
      repository,
      project,
      input,
      existingArtifact,
    );
    if (input.requiredApprovals > reviewerIds.length) {
      throw new BridgeError(
        "VALIDATION_FAILED",
        "The required approval count cannot exceed the resolved specification reviewer count.",
        422,
        { requiredApprovals: input.requiredApprovals, resolvedReviewerCount: reviewerIds.length },
      );
    }
    const versionState: Omit<ArtifactVersion, "approvalStatus"> = {
      id: `av_${this.id()}`,
      artifactId,
      version: (existingArtifact?.versions.length ?? 0) + 1,
      summary: input.summary,
      body: input.body,
      contentSha256: createHash("sha256").update(input.body).digest("hex"),
      citedDecisionIds: [...input.citedDecisionIds],
      status: input.requestReview ? "in_review" : "draft",
      createdById: principal.id,
      createdByType: principal.type,
      createdAt: timestamp,
      reviews: [],
      requiredApprovals: input.requiredApprovals,
      ...(input.runId ? { runId: input.runId } : {}),
    };
    const version: ArtifactVersion = {
      ...versionState,
      approvalStatus: artifactApprovalStatus(versionState),
    };
    const artifact: Artifact = existingArtifact
      ? {
          ...existingArtifact,
          title: input.title,
          scope: { ...input.scope },
          reviewerIds,
          currentVersionId: version.id,
          versions: [...existingArtifact.versions, version],
        }
      : {
          id: artifactId,
          organizationId: principal.organizationId,
          projectId,
          title: input.title,
          type: input.type,
          scope: { ...input.scope },
          reviewerIds,
          createdById: principal.id,
          createdByType: principal.type,
          createdAt: timestamp,
          currentVersionId: version.id,
          versions: [version],
        };
    if (artifact.reviewerIds.length === 0) {
      throw new BridgeError("POLICY_BLOCKED", "No specification reviewer can be resolved.", 422);
    }

    await repository.saveArtifact(artifact);
    await repository.saveIdempotentArtifactVersion(idempotencyKey, version.id, requestHash);
    if (sourceRun) {
      await repository.saveRun({
        ...sourceRun,
        artifactVersionIds: [...new Set([...sourceRun.artifactVersionIds, version.id])],
        updatedAt: timestamp,
        version: sourceRun.version + 1,
      });
    }
    await this.audit(
      repository,
      principal,
      projectId,
      "artifact.version_published",
      "artifact_version",
      version.id,
      timestamp,
    );
    if (version.status === "in_review") {
      await this.notify(repository, principal, projectId, artifact.reviewerIds, {
        type: "artifact_review_requested",
        title: "Specification review requested",
        body: `${principal.displayName} submitted “${artifact.title}” for review.`,
        targetType: "artifact_version",
        targetId: version.id,
      });
    }
    this.recordIdempotency("artifact_publish", "created");
    return { artifact, version };
  }

  private async resolveArtifactReviewers(
    repository: BridgeRepository,
    project: Project,
    input: PublishArtifactInput,
    existingArtifact?: Artifact,
  ): Promise<readonly string[]> {
    const ownership = await repository.getProjectOwnershipConfiguration(project.id) ?? {
      organizationId: project.organizationId,
      projectId: project.id,
      roles: [],
      teams: [],
      rules: [],
      version: 0,
    };
    const directory = (await repository.listOrganizationPrincipals(project.organizationId))
      .filter((candidate) => {
        if (candidate.type !== "human") return false;
        try {
          assertProjectAccess(candidate, project);
          return true;
        } catch {
          return false;
        }
      });
    const activeHumans = new Map(directory.map((candidate) => [candidate.id, candidate]));
    const explicitIds = [...new Set(input.intendedReviewerIds)];
    const explicitRoles = this.normalizedRoles(input.intendedReviewerRoles ?? []);
    const explicitTeamKeys = [...new Set(
      (input.intendedReviewerTeamKeys ?? []).map(normalizeRoleName).filter(Boolean),
    )];
    const hasExplicitTargets = explicitIds.length + explicitRoles.length + explicitTeamKeys.length > 0;

    if (activeHumans.size > 0) {
      for (const reviewerId of explicitIds) {
        if (!activeHumans.has(reviewerId)) {
          throw new BridgeError(
            "VALIDATION_FAILED",
            "Specification reviewers must be active human members with access to this project.",
            422,
            { reviewerId },
          );
        }
      }
    }

    const teamMembers = new Map(ownership.teams.map((team) => [team.key, team.memberIds]));
    for (const teamKey of explicitTeamKeys) {
      if (!teamMembers.has(teamKey)) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "Specification reviewer teams must reference a configured project team.",
          422,
          { teamKey },
        );
      }
    }

    const resolveTargets = (
      principalIds: readonly string[],
      roles: readonly string[],
      teamKeys: readonly string[],
    ): readonly string[] => {
      const resolved = new Set([
        ...principalIds,
        ...teamKeys.flatMap((teamKey) => teamMembers.get(teamKey) ?? []),
      ]);
      for (const candidate of directory) {
        if (roles.some((role) => principalHasRole(candidate, role, project.id))) {
          resolved.add(candidate.id);
        }
      }
      if (activeHumans.size === 0) return [...resolved];
      return [...resolved].filter((reviewerId) => activeHumans.has(reviewerId));
    };

    if (hasExplicitTargets) {
      const resolved = resolveTargets(explicitIds, explicitRoles, explicitTeamKeys);
      if (resolved.length === 0) {
        throw new BridgeError("POLICY_BLOCKED", "No active human specification reviewer can be resolved.", 422);
      }
      return [...resolved].sort((left, right) => left.localeCompare(right));
    }

    if (existingArtifact) {
      const current = activeHumans.size === 0
        ? existingArtifact.reviewerIds
        : existingArtifact.reviewerIds.filter((reviewerId) => activeHumans.has(reviewerId));
      if (current.length > 0) return [...new Set(current)].sort((left, right) => left.localeCompare(right));
    }

    const matchingRules = ownership.rules
      .filter((rule) => !rule.category && this.ownershipRuleMatches(rule, "", input.scope))
      .sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key));
    const reviewerRule = matchingRules.find((rule) =>
      this.ownershipRouteSource(rule) === "scoped_ownership" && this.ownershipTargetCount(rule.reviewers) > 0) ??
      matchingRules.find((rule) =>
        this.ownershipRouteSource(rule) === "project_default" && this.ownershipTargetCount(rule.reviewers) > 0);
    if (reviewerRule) {
      const resolved = resolveTargets(
        reviewerRule.reviewers.principalIds,
        reviewerRule.reviewers.roles,
        reviewerRule.reviewers.teamKeys,
      );
      if (resolved.length > 0) return [...resolved].sort((left, right) => left.localeCompare(right));
    }

    const fallback = resolveTargets(project.decisionOwnerIds, [], []);
    if (fallback.length === 0) {
      throw new BridgeError("POLICY_BLOCKED", "No active human specification reviewer can be resolved.", 422);
    }
    return [...fallback].sort((left, right) => left.localeCompare(right));
  }

  async listArtifacts(principal: Principal, projectId: string): Promise<readonly Artifact[]> {
    return this.tenantTransaction(principal, async (repository) => {
      await this.requireProject(principal, projectId, repository);
      return repository.listArtifacts(projectId);
    });
  }

  async getArtifact(principal: Principal, artifactId: string): Promise<Artifact> {
    return this.tenantTransaction(principal, (repository) =>
      this.requireArtifact(principal, artifactId, repository));
  }

  async diffArtifactVersions(
    principal: Principal,
    artifactId: string,
    query: ArtifactVersionDiffQuery,
  ): Promise<ArtifactVersionDiff> {
    return this.tenantTransaction(principal, async (repository) => {
    const artifact = await this.requireArtifact(principal, artifactId, repository);
    const fromVersion = artifact.versions.find((version) => version.id === query.fromVersionId);
    const toVersion = artifact.versions.find((version) => version.id === query.toVersionId);
    if (!fromVersion || !toVersion) {
      throw new BridgeError(
        "ARTIFACT_NOT_FOUND",
        "Both specification versions must belong to the requested specification.",
        404,
      );
    }
    return buildArtifactVersionDiff(artifact.id, fromVersion, toVersion);
    });
  }

  private async requireArtifact(
    principal: Principal,
    artifactId: string,
    repository: BridgeRepository,
  ): Promise<Artifact> {
    const artifact = await repository.getArtifact(artifactId);
    if (!artifact) throw new BridgeError("ARTIFACT_NOT_FOUND", "Specification not found.", 404);
    await this.requireProjectForResource(
      principal,
      artifact.projectId,
      repository,
      "ARTIFACT_NOT_FOUND",
      "Specification not found.",
    );
    return artifact;
  }

  async reviewArtifactVersion(
    principal: Principal,
    versionId: string,
    input: ArtifactReviewInput,
  ): Promise<ArtifactReviewResult> {
    return this.tenantTransaction(principal, (repository) =>
      this.reviewArtifactVersionInTransaction(repository, principal, versionId, input),
    );
  }

  private async reviewArtifactVersionInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    versionId: string,
    input: ArtifactReviewInput,
  ): Promise<ArtifactReviewResult> {
    const artifact = await repository.getArtifactByVersionId(versionId);
    if (!artifact) throw new BridgeError("ARTIFACT_NOT_FOUND", "Specification version not found.", 404);
    await this.requireProjectForResource(
      principal,
      artifact.projectId,
      repository,
      "ARTIFACT_NOT_FOUND",
      "Specification version not found.",
    );
    assertCanReviewArtifact(principal, artifact);
    this.assertSecretSafe("artifact", input);
    const target = artifact.versions.find((version) => version.id === versionId);
    if (!target) throw new BridgeError("ARTIFACT_NOT_FOUND", "Specification version not found.", 404);
    if (artifact.currentVersionId !== versionId) {
      throw new BridgeError("CONFLICT", "Review feedback can be added only to the current specification version.", 409);
    }
    if (["approved", "superseded"].includes(target.status)) {
      throw new BridgeError("CONFLICT", "Approved or superseded specification versions no longer accept review feedback.", 409);
    }

    const timestamp = this.now().toISOString();
    const review: ArtifactReview = {
      id: `arv_${this.id()}`,
      artifactVersionId: versionId,
      reviewerId: principal.id,
      reviewerType: principal.type,
      status: input.status,
      body: input.body,
      createdAt: timestamp,
    };
    const reviews = [...target.reviews, review];
    const reviewedVersion: ArtifactVersion = {
      ...target,
      reviews,
      approvalStatus: artifactApprovalStatus({ ...target, reviews }),
    };
    const updatedArtifact: Artifact = {
      ...artifact,
      versions: artifact.versions.map((version) => version.id === versionId ? reviewedVersion : version),
    };
    await repository.saveArtifact(updatedArtifact);
    await this.audit(
      repository,
      principal,
      artifact.projectId,
      input.status === "changes_requested"
        ? "artifact.version_changes_requested"
        : "artifact.version_commented",
      "artifact_version",
      versionId,
      timestamp,
    );
    await this.notify(
      repository,
      principal,
      artifact.projectId,
      [artifact.createdById, ...artifact.reviewerIds],
      {
        type: "artifact_review_feedback",
        title: input.status === "changes_requested" ? "Specification changes requested" : "Specification review comment",
        body: `${principal.displayName} ${input.status === "changes_requested" ? "requested changes to" : "commented on"} “${artifact.title}”.`,
        targetType: "artifact_version",
        targetId: versionId,
      },
    );
    return { artifact: updatedArtifact, version: reviewedVersion, review };
  }

  async approveArtifactVersion(
    principal: Principal,
    versionId: string,
    input: ApproveArtifactVersionInput,
  ): Promise<ArtifactPublication> {
    return this.tenantTransaction(principal, (repository) =>
      this.approveArtifactVersionInTransaction(repository, principal, versionId, input),
    );
  }

  private async approveArtifactVersionInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    versionId: string,
    input: ApproveArtifactVersionInput,
  ): Promise<ArtifactPublication> {
    const artifact = await repository.getArtifactByVersionId(versionId);
    if (!artifact) throw new BridgeError("ARTIFACT_NOT_FOUND", "Specification version not found.", 404);
    const project = await this.requireProjectForResource(
      principal,
      artifact.projectId,
      repository,
      "ARTIFACT_NOT_FOUND",
      "Specification version not found.",
    );
    assertCanApproveArtifact(principal, artifact, project.decisionOwnerIds);
    this.assertSecretSafe("artifact", input);
    const target = artifact.versions.find((version) => version.id === versionId);
    if (!target) throw new BridgeError("ARTIFACT_NOT_FOUND", "Specification version not found.", 404);
    if (artifact.currentVersionId !== versionId) {
      throw new BridgeError("CONFLICT", "Only the current specification version can be approved.", 409);
    }
    if (!["draft", "in_review"].includes(target.status)) {
      throw new BridgeError("CONFLICT", "This specification version cannot be approved again.", 409);
    }
    if (target.reviews.some((review) => review.status === "changes_requested")) {
      throw new BridgeError(
        "CONFLICT",
        "This specification version has requested changes; publish a new version before approval.",
        409,
      );
    }
    if (target.reviews.some((review) => review.status === "approved" && review.reviewerId === principal.id)) {
      throw new BridgeError("CONFLICT", "This human reviewer already approved this specification version.", 409);
    }

    const timestamp = this.now().toISOString();
    const approval: ArtifactReview = {
      id: `arv_${this.id()}`,
      artifactVersionId: versionId,
      reviewerId: principal.id,
      reviewerType: principal.type,
      status: "approved",
      body: input.rationale,
      createdAt: timestamp,
    };
    const reviews = [...target.reviews, approval];
    const pendingState = {
      ...target,
      status: "in_review" as const,
      reviews,
    };
    const approvalStatus = artifactApprovalStatus(pendingState);
    if (!approvalStatus.satisfied) {
      const pendingVersion: ArtifactVersion = { ...pendingState, approvalStatus };
      const pendingArtifact: Artifact = {
        ...artifact,
        versions: artifact.versions.map((version) => version.id === versionId ? pendingVersion : version),
      };
      await repository.saveArtifact(pendingArtifact);
      await this.audit(
        repository,
        principal,
        artifact.projectId,
        "artifact.version_approval_recorded",
        "artifact_version",
        versionId,
        timestamp,
      );
      await this.notify(repository, principal, artifact.projectId, [artifact.createdById, ...artifact.reviewerIds], {
        type: "artifact_review_feedback",
        title: "Specification approval recorded",
        body: `${principal.displayName} approved “${artifact.title}”; ${approvalStatus.remainingCount} more approval${approvalStatus.remainingCount === 1 ? " is" : "s are"} required.`,
        targetType: "artifact_version",
        targetId: versionId,
      });
      return { artifact: pendingArtifact, version: pendingVersion };
    }

    const approvedVersion: ArtifactVersion = {
      ...pendingState,
      status: "approved",
      approvalStatus,
      approvedById: principal.id,
      approvalRationale: input.rationale,
      approvedAt: timestamp,
    };
    const versions: ArtifactVersion[] = artifact.versions.map((version) => {
      if (version.id === versionId) return approvedVersion;
      if (version.status === "approved") return { ...version, status: "superseded" };
      return version;
    });
    const updatedArtifact: Artifact = { ...artifact, approvedVersionId: versionId, versions };
    await repository.saveArtifact(updatedArtifact);
    await this.audit(
      repository,
      principal,
      artifact.projectId,
      "artifact.version_approved",
      "artifact_version",
      versionId,
      timestamp,
    );
    await this.notify(repository, principal, artifact.projectId, [artifact.createdById, ...artifact.reviewerIds], {
      type: "artifact_approved",
      title: "Specification approved",
      body: `${principal.displayName} approved “${artifact.title}”.`,
      targetType: "artifact_version",
      targetId: versionId,
    });
    return { artifact: updatedArtifact, version: approvedVersion };
  }

  async getContext(
    principal: Principal,
    projectId: string,
    query: ContextQuery,
  ): Promise<{ readonly contextSnapshotId: string; readonly items: readonly ContextItem[]; readonly truncated: boolean }> {
    const startedAt = performance.now();
    try {
      const { candidateCount, ...result } = await this.tenantTransaction(principal, (repository) =>
        this.getContextInTransaction(repository, principal, projectId, query),
      );
      this.metrics?.recordContextRetrieval({
        outcome: "success",
        durationMs: Math.max(0, performance.now() - startedAt),
        resultCount: result.items.length,
        candidateCount,
      });
      return result;
    } catch (error) {
      this.metrics?.recordContextRetrieval({
        outcome: "error",
        durationMs: Math.max(0, performance.now() - startedAt),
      });
      throw error;
    }
  }

  private async getContextInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    projectId: string,
    query: ContextQuery,
  ): Promise<{
    readonly contextSnapshotId: string;
    readonly items: readonly ContextItem[];
    readonly truncated: boolean;
    readonly candidateCount: number;
  }> {
    await this.requireProject(principal, projectId, repository);
    this.assertSecretSafe("context", query);
    const sourceRun = query.runId
      ? await this.requireLinkableRun(principal, query.runId, repository)
      : undefined;
    const activeDecisions = (await repository.listDecisions(projectId)).filter(
      (decision) => decision.status === "active",
    );
    const assumptions: Assumption[] = [];
    for (const assumption of await repository.listAssumptions(projectId)) {
      assumptions.push(await this.expireAssumptionIfDue(repository, principal, assumption));
    }
    const artifacts = await repository.listArtifacts(projectId);
    const normalizedWorkItem = query.scope.workItem?.trim().toLowerCase();
    const linkedIssue = normalizedWorkItem
      ? (await repository.listGithubIssues(projectId)).find((issue) =>
        issue.reference.toLowerCase() === normalizedWorkItem ||
        issue.canonicalUrl.toLowerCase() === normalizedWorkItem)
      : undefined;
    const linkedDecisionIds = new Set(linkedIssue?.decisionIds ?? []);
    const linkedArtifactVersionIds = new Set(linkedIssue?.artifactVersionIds ?? []);
    const taskTokens = new Set(query.task.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
    const scopeMatch = (scope: Scope): number => {
      let score = 0;
      for (const key of ["repository", "component", "branch", "environment", "workItem"] as const) {
        if (query.scope[key] && scope[key] === query.scope[key]) score += 4;
      }
      return score;
    };
    const decisionCandidates = activeDecisions
      .filter((decision) => query.categories.length === 0 || query.categories.includes(decision.category))
      .map((decision) => {
        const searchable = `${decision.answer} ${decision.rationale} ${decision.category}`.toLowerCase();
        const textScore = [...taskTokens].filter((token) => searchable.includes(token)).length;
        const item: ContextItem = {
          id: decision.id,
          type: "decision",
          title: decision.answer,
          summary: decision.rationale,
          scope: { ...decision.scope },
          authority: "approved",
          trustLevel: "untrusted_data",
          sourceUrl: this.recordUrl({
            view: "decisions",
            projectId,
            decisionId: decision.id,
          }),
          updatedAt: decision.createdAt,
        };
        return {
          item,
          score: 10 + scopeMatch(decision.scope) + textScore +
            (linkedDecisionIds.has(decision.id) ? 12 : 0),
        };
      });
    const artifactCandidates = artifacts.flatMap((artifact) => {
      const version = artifact.versions.find(
        (candidate) => candidate.id === artifact.approvedVersionId && candidate.status === "approved",
      );
      if (!version) return [];
      if (
        query.categories.length > 0 &&
        !query.categories.includes("specification") &&
        !query.categories.includes(artifact.type)
      ) {
        return [];
      }
      const searchable = `${artifact.title} ${artifact.type} ${version.summary} ${version.body}`.toLowerCase();
      const textScore = [...taskTokens].filter((token) => searchable.includes(token)).length;
      const item: ContextItem = {
        id: version.id,
        type: "artifact",
        title: artifact.title,
        summary: version.summary,
        scope: { ...artifact.scope },
        authority: "approved",
        trustLevel: "untrusted_data",
        sourceUrl: this.recordUrl({
          view: "specifications",
          projectId,
          artifactId: artifact.id,
          versionId: version.id,
        }),
        updatedAt: version.approvedAt ?? version.createdAt,
      };
      return [{
        item,
        score: 10 + scopeMatch(artifact.scope) + textScore +
          (linkedArtifactVersionIds.has(version.id) ? 12 : 0),
      }];
    });
    const assumptionCandidates = assumptions
      .filter((assumption) => ["active", "confirmed"].includes(assumption.status))
      .filter(
        (assumption) =>
          query.categories.length === 0 ||
          query.categories.includes("assumption") ||
          query.categories.includes(assumption.category),
      )
      .map((assumption) => {
        const searchable = `${assumption.statement} ${assumption.rationale} ${assumption.category}`.toLowerCase();
        const textScore = [...taskTokens].filter((token) => searchable.includes(token)).length;
        const item: ContextItem = {
          id: assumption.id,
          type: "assumption",
          title: assumption.statement,
          summary: assumption.rationale,
          scope: { ...assumption.scope },
          authority: assumption.status === "confirmed" ? "confirmed" : "assumption",
          trustLevel: "untrusted_data",
          sourceUrl: this.recordUrl({
            view: "assumptions",
            projectId,
            assumptionId: assumption.id,
          }),
          updatedAt: assumption.resolvedAt ?? assumption.createdAt,
          ...(assumption.status === "active" ? { expiresAt: assumption.expiresAt } : {}),
        };
        const authorityWeight = assumption.status === "confirmed" ? 8 : 4;
        return { item, score: authorityWeight + scopeMatch(assumption.scope) + textScore };
      });
    const scored = [...decisionCandidates, ...artifactCandidates, ...assumptionCandidates].sort(
      (left, right) => right.score - left.score || right.item.updatedAt.localeCompare(left.item.updatedAt),
    );
    const items = scored.slice(0, query.maxItems).map(({ item }) => item);
    const snapshot: ContextSnapshot = {
      id: `ctx_${this.id()}`,
      organizationId: principal.organizationId,
      projectId,
      principalId: principal.id,
      ...(query.runId ? { runId: query.runId } : {}),
      task: query.task,
      itemIds: items.map((item) => item.id),
      createdAt: this.now().toISOString(),
    };
    await repository.saveContextSnapshot(snapshot);
    if (sourceRun) {
      await repository.saveRun({
        ...sourceRun,
        contextSnapshotIds: [...new Set([...sourceRun.contextSnapshotIds, snapshot.id])],
        updatedAt: snapshot.createdAt,
        version: sourceRun.version + 1,
      });
    }
    await this.audit(
      repository,
      principal,
      projectId,
      "context.retrieved",
      "context_snapshot",
      snapshot.id,
      snapshot.createdAt,
    );
    return {
      contextSnapshotId: snapshot.id,
      items,
      truncated: scored.length > items.length,
      candidateCount: scored.length,
    };
  }

  private async requireRun(
    principal: Principal,
    runId: string,
    repository: BridgeRepository,
  ): Promise<AgentRun> {
    const run = await repository.getRun(runId);
    if (!run) throw new BridgeError("RUN_NOT_FOUND", "Agent run not found.", 404);
    await this.requireProjectForResource(
      principal,
      run.projectId,
      repository,
      "RUN_NOT_FOUND",
      "Agent run not found.",
    );
    return run;
  }

  private async requireAssumption(
    principal: Principal,
    assumptionId: string,
    repository: BridgeRepository,
  ): Promise<Assumption> {
    const assumption = await repository.getAssumption(assumptionId);
    if (!assumption) throw new BridgeError("ASSUMPTION_NOT_FOUND", "Assumption not found.", 404);
    await this.requireProjectForResource(
      principal,
      assumption.projectId,
      repository,
      "ASSUMPTION_NOT_FOUND",
      "Assumption not found.",
    );
    return assumption;
  }

  private async requireDecision(
    principal: Principal,
    decisionId: string,
    repository: BridgeRepository,
  ): Promise<Decision> {
    const decision = await repository.getDecision(decisionId);
    if (!decision) throw new BridgeError("DECISION_NOT_FOUND", "Decision not found.", 404);
    await this.requireProjectForResource(
      principal,
      decision.projectId,
      repository,
      "DECISION_NOT_FOUND",
      "Decision not found.",
    );
    return decision;
  }

  private async expireAssumptionIfDue(
    repository: BridgeRepository,
    principal: Principal,
    assumption: Assumption,
    options: { readonly notify?: boolean } = {},
  ): Promise<Assumption> {
    const timestamp = this.now().toISOString();
    if (assumption.status !== "active" || Date.parse(assumption.expiresAt) > Date.parse(timestamp)) {
      return assumption;
    }
    const expired: Assumption = {
      ...assumption,
      status: "expired",
      resolvedAt: timestamp,
      resolutionRationale: "Expired automatically at the configured assumption expiry.",
      version: assumption.version + 1,
    };
    await repository.saveAssumption(expired);
    await this.audit(
      repository,
      principal,
      assumption.projectId,
      "assumption.expired",
      "assumption",
      assumption.id,
      timestamp,
    );
    if (options.notify) {
      const project = await repository.getProject(assumption.projectId);
      if (project) {
        await this.notify(
          repository,
          principal,
          assumption.projectId,
          [...project.decisionOwnerIds, assumption.createdById],
          {
            type: "assumption_expired",
            title: "Assumption expired",
            body: `The assumption “${assumption.statement}” expired and is no longer supplied as agent context.`,
            targetType: "assumption",
            targetId: assumption.id,
          },
        );
      }
    }
    return expired;
  }

  private scopesEqual(left: Scope, right: Scope): boolean {
    return (["repository", "component", "branch", "environment", "workItem"] as const)
      .every((key) => left[key] === right[key]);
  }

  private async calculateDecisionImpact(
    repository: BridgeRepository,
    decision: Decision,
    query: DecisionImpactQuery,
  ): Promise<DecisionLifecycleImpact> {
    const [artifacts, assumptions, contextSnapshots, runs, questions] = await Promise.all([
      repository.listArtifacts(decision.projectId),
      repository.listAssumptions(decision.projectId),
      repository.listContextSnapshots(decision.projectId),
      repository.listRuns(decision.projectId),
      repository.listQuestions(decision.projectId),
    ]);
    const nodes = new Map<string, DecisionImpactNode>();
    const queue: DecisionImpactNode[] = [];
    const edges: DecisionImpactEdge[] = [];
    const edgeKeys = new Set<string>();
    const links = new Map<string, DecisionImpactLink>();
    let truncated = false;

    const root: DecisionImpactNode = {
      id: decision.id,
      type: "decision",
      label: decision.answer,
      depth: 0,
      path: [decision.id],
      scope: { ...decision.scope },
      status: decision.status,
    };
    nodes.set(root.id, root);
    queue.push(root);

    const connect = (
      from: DecisionImpactNode,
      target: Omit<DecisionImpactNode, "depth" | "path">,
      relation: DecisionImpactEdge["relation"],
    ): void => {
      const depth = from.depth + 1;
      const existing = nodes.get(target.id);
      if (!existing) {
        if (depth > query.maxDepth || nodes.size >= query.maxNodes) {
          truncated = true;
          return;
        }
        const node: DecisionImpactNode = {
          ...target,
          depth,
          path: [...from.path, target.id],
        };
        nodes.set(node.id, node);
        queue.push(node);
      }
      const edgeKey = `${from.id}\u0000${target.id}\u0000${relation}`;
      if (!edgeKeys.has(edgeKey) && nodes.has(target.id)) {
        edgeKeys.add(edgeKey);
        edges.push({ fromId: from.id, toId: target.id, relation });
      }
    };
    const recordLink = (
      source: DecisionImpactNode,
      type: DecisionImpactLink["type"],
      url: string,
    ): void => {
      const depth = source.depth + 1;
      if (depth > query.maxDepth) {
        truncated = true;
        return;
      }
      const key = `${source.id}\u0000${type}\u0000${url}`;
      if (!links.has(key)) links.set(key, { sourceId: source.id, type, url, depth });
    };
    const addSnapshotConsumers = (source: DecisionImpactNode, itemId: string): void => {
      for (const snapshot of contextSnapshots.filter((candidate) => candidate.itemIds.includes(itemId))) {
        connect(source, {
          id: snapshot.id,
          type: "context_snapshot",
          label: "Context snapshot",
        }, "consumed_in_context");
      }
    };
    const hasDownstream = (node: DecisionImpactNode): boolean => {
      if (node.type === "decision") {
        return Boolean(decision.questionId) ||
          artifacts.some((artifact) => artifact.versions.some((version) => version.citedDecisionIds.includes(decision.id))) ||
          assumptions.some((assumption) => assumption.confirmedDecisionId === decision.id) ||
          contextSnapshots.some((snapshot) => snapshot.itemIds.includes(decision.id));
      }
      if (node.type === "question") {
        const question = questions.find((candidate) => candidate.id === node.id);
        return Boolean(question?.runId || question?.relatedLinks?.length);
      }
      if (node.type === "artifact") {
        return artifacts.some((artifact) => artifact.id === node.id &&
          artifact.versions.some((version) => version.citedDecisionIds.includes(decision.id)));
      }
      if (node.type === "artifact_version") {
        return artifacts.some((artifact) => artifact.versions.some((version) =>
          version.id === node.id && Boolean(version.runId))) ||
          contextSnapshots.some((snapshot) => snapshot.itemIds.includes(node.id));
      }
      if (node.type === "assumption") {
        const assumption = assumptions.find((candidate) => candidate.id === node.id);
        return Boolean(assumption?.runId) || contextSnapshots.some((snapshot) => snapshot.itemIds.includes(node.id));
      }
      if (node.type === "context_snapshot") {
        return contextSnapshots.some((snapshot) => snapshot.id === node.id && Boolean(snapshot.runId));
      }
      const run = runs.find((candidate) => candidate.id === node.id);
      return Boolean(run && (
        runs.some((candidate) => candidate.continuesRunId === run.id) ||
        questions.some((question) => question.runId === run.id) ||
        assumptions.some((assumption) => assumption.runId === run.id) ||
        artifacts.some((artifact) => artifact.versions.some((version) => version.runId === run.id)) ||
        run.externalLinks.length > 0 ||
        run.resultLinks.length > 0
      ));
    };

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (node.depth >= query.maxDepth) {
        if (hasDownstream(node)) truncated = true;
        continue;
      }
      if (node.type === "decision") {
        const sourceQuestion = decision.questionId
          ? questions.find((question) => question.id === decision.questionId)
          : undefined;
        if (sourceQuestion) {
          connect(node, {
            id: sourceQuestion.id,
            type: "question",
            label: sourceQuestion.title,
            scope: { ...sourceQuestion.scope },
            status: sourceQuestion.status,
          }, "source_question");
        }
        for (const artifact of artifacts.filter((candidate) =>
          candidate.versions.some((version) => version.citedDecisionIds.includes(decision.id)))) {
          const currentStatus = artifact.versions.find((version) => version.id === artifact.currentVersionId)?.status;
          connect(node, {
            id: artifact.id,
            type: "artifact",
            label: artifact.title,
            scope: { ...artifact.scope },
            ...(currentStatus ? { status: currentStatus } : {}),
          }, "cited_by_artifact");
        }
        for (const assumption of assumptions.filter((candidate) => candidate.confirmedDecisionId === decision.id)) {
          connect(node, {
            id: assumption.id,
            type: "assumption",
            label: assumption.statement,
            scope: { ...assumption.scope },
            status: assumption.status,
          }, "confirmed_assumption");
        }
        addSnapshotConsumers(node, decision.id);
      } else if (node.type === "question") {
        const question = questions.find((candidate) => candidate.id === node.id);
        if (!question) continue;
        const sourceRun = question.runId ? runs.find((run) => run.id === question.runId) : undefined;
        if (sourceRun) {
          connect(node, {
            id: sourceRun.id,
            type: "run",
            label: sourceRun.taskSummary,
            scope: { ...sourceRun.scope },
            status: sourceRun.status,
          }, "created_in_run");
        }
        for (const link of question.relatedLinks ?? []) recordLink(node, link.type, link.url);
      } else if (node.type === "artifact") {
        const artifact = artifacts.find((candidate) => candidate.id === node.id);
        if (!artifact) continue;
        for (const version of artifact.versions.filter((candidate) => candidate.citedDecisionIds.includes(decision.id))) {
          connect(node, {
            id: version.id,
            type: "artifact_version",
            label: version.summary,
            scope: { ...artifact.scope },
            status: version.status,
          }, "contains_citing_version");
        }
      } else if (node.type === "artifact_version") {
        const artifact = artifacts.find((candidate) => candidate.versions.some((version) => version.id === node.id));
        const version = artifact?.versions.find((candidate) => candidate.id === node.id);
        const sourceRun = version?.runId ? runs.find((run) => run.id === version.runId) : undefined;
        if (sourceRun) {
          connect(node, {
            id: sourceRun.id,
            type: "run",
            label: sourceRun.taskSummary,
            scope: { ...sourceRun.scope },
            status: sourceRun.status,
          }, "created_in_run");
        }
        addSnapshotConsumers(node, node.id);
      } else if (node.type === "assumption") {
        const assumption = assumptions.find((candidate) => candidate.id === node.id);
        const sourceRun = assumption?.runId ? runs.find((run) => run.id === assumption.runId) : undefined;
        if (sourceRun) {
          connect(node, {
            id: sourceRun.id,
            type: "run",
            label: sourceRun.taskSummary,
            scope: { ...sourceRun.scope },
            status: sourceRun.status,
          }, "created_in_run");
        }
        addSnapshotConsumers(node, node.id);
      } else if (node.type === "context_snapshot") {
        const snapshot = contextSnapshots.find((candidate) => candidate.id === node.id);
        const consumerRun = snapshot?.runId ? runs.find((run) => run.id === snapshot.runId) : undefined;
        if (consumerRun) {
          connect(node, {
            id: consumerRun.id,
            type: "run",
            label: consumerRun.taskSummary,
            scope: { ...consumerRun.scope },
            status: consumerRun.status,
          }, "context_used_by_run");
        }
      } else if (node.type === "run") {
        const run = runs.find((candidate) => candidate.id === node.id);
        if (!run) continue;
        for (const continuation of runs.filter((candidate) => candidate.continuesRunId === run.id)) {
          connect(node, {
            id: continuation.id,
            type: "run",
            label: continuation.taskSummary,
            scope: { ...continuation.scope },
            status: continuation.status,
          }, "continued_by_run");
        }
        for (const question of questions.filter((candidate) => candidate.runId === run.id)) {
          connect(node, {
            id: question.id,
            type: "question",
            label: question.title,
            scope: { ...question.scope },
            status: question.status,
          }, "produced_question");
        }
        for (const assumption of assumptions.filter((candidate) => candidate.runId === run.id)) {
          connect(node, {
            id: assumption.id,
            type: "assumption",
            label: assumption.statement,
            scope: { ...assumption.scope },
            status: assumption.status,
          }, "produced_assumption");
        }
        for (const artifact of artifacts) {
          for (const version of artifact.versions.filter((candidate) => candidate.runId === run.id)) {
            connect(node, {
              id: version.id,
              type: "artifact_version",
              label: version.summary,
              scope: { ...artifact.scope },
              status: version.status,
            }, "produced_artifact_version");
          }
        }
        for (const url of run.externalLinks) recordLink(node, "run_external", url);
        for (const url of run.resultLinks) recordLink(node, "run_result", url);
      }
    }

    const impactNodes = [...nodes.values()];
    const valuesFor = (type: DecisionImpactNodeType): readonly string[] =>
      impactNodes.filter((node) => node.type === type).map((node) => node.id);
    const scopedValues = (key: keyof Scope): readonly string[] => [...new Set(
      impactNodes.flatMap((node) => node.scope?.[key] ? [node.scope[key]!] : []),
    )];
    return {
      artifactIds: valuesFor("artifact"),
      artifactVersionIds: valuesFor("artifact_version"),
      assumptionIds: valuesFor("assumption"),
      questionIds: valuesFor("question"),
      contextSnapshotIds: valuesFor("context_snapshot"),
      runIds: valuesFor("run"),
      workItems: scopedValues("workItem"),
      branches: scopedValues("branch"),
      repositories: scopedValues("repository"),
      links: [...links.values()],
      nodes: impactNodes,
      edges,
      maxDepthReached: Math.max(...impactNodes.map((node) => node.depth)),
      truncated,
    };
  }

  private scopesOverlap(left: Scope, right: Scope): boolean {
    return (["repository", "component", "branch", "environment", "workItem"] as const)
      .every((key) => !left[key] || !right[key] || left[key] === right[key]);
  }

  private answersUseOpposingLanguage(left: string, right: string): boolean {
    const normalize = (value: string) => ` ${this.normalizeQuestionText(value)} `;
    const leftText = normalize(left);
    const rightText = normalize(right);
    const opposingPairs = [
      ["enable", "disable"],
      ["enabled", "disabled"],
      ["allow", "deny"],
      ["allowed", "denied"],
      ["required", "optional"],
      ["always", "never"],
      ["retain", "delete"],
      ["include", "exclude"],
      ["synchronous", "asynchronous"],
      ["sync", "async"],
    ] as const;
    const has = (text: string, phrase: string) => text.includes(` ${phrase} `);
    return opposingPairs.some(([affirmative, negative]) =>
      (has(leftText, affirmative) && has(rightText, negative)) ||
      (has(leftText, negative) && has(rightText, affirmative)),
    );
  }

  private normalizePremise(value: string): string {
    return value
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  private areDirectNegations(left: string, right: string): boolean {
    const leftNormalized = this.normalizePremise(left);
    const rightNormalized = this.normalizePremise(right);
    const removeNegation = (value: string): string | undefined => {
      for (const prefix of ["do not ", "dont ", "not ", "never ", "avoid "]) {
        if (value.startsWith(prefix)) return value.slice(prefix.length);
      }
      return undefined;
    };
    return removeNegation(leftNormalized) === rightNormalized ||
      removeNegation(rightNormalized) === leftNormalized;
  }

  private async requireLinkableRun(
    principal: Principal,
    runId: string,
    repository: BridgeRepository,
  ): Promise<AgentRun> {
    const run = await this.requireRun(principal, runId, repository);
    const mayLink = run.agentId === principal.id ||
      (principal.type === "human" && principalHasRole(principal, "project-admin", run.projectId));
    if (!mayLink) {
      throw new BridgeError("FORBIDDEN", "Only the run principal can attach new run provenance.", 403);
    }
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      throw new BridgeError("CONFLICT", "New records cannot be attached to a terminal run.", 409);
    }
    return run;
  }

  private async blockingQuestions(
    repository: BridgeRepository,
    run: AgentRun,
  ): Promise<readonly Question[]> {
    const questions = await Promise.all(run.questionIds.map((questionId) => repository.getQuestion(questionId)));
    return questions.filter((question): question is Question => Boolean(question?.blocking));
  }

  private async assertContinuationKey(
    repository: BridgeRepository,
    runId: string,
    supplied: string,
  ): Promise<void> {
    const expected = await repository.getRunContinuationKey(runId);
    const expectedBytes = Buffer.from(expected ?? "");
    const suppliedBytes = Buffer.from(supplied);
    if (
      !expected ||
      expectedBytes.length !== suppliedBytes.length ||
      !timingSafeEqual(expectedBytes, suppliedBytes)
    ) {
      throw new BridgeError(
        "CONTINUATION_INVALID",
        "The continuation locator is invalid for this run.",
        403,
      );
    }
  }

  private assertOrganizationAdministrator(principal: Principal, action: string): void {
    assertHuman(principal, action);
    if (!principalHasRole(principal, "organization-admin")) {
      throw new BridgeError("FORBIDDEN", `${action} requires an organization administrator.`, 403);
    }
  }

  private assertDirectorySyncWriter(principal: Principal, action: string): void {
    if (principal.type === "human") {
      this.assertOrganizationAdministrator(principal, action);
      return;
    }
    if (principal.type !== "integration") {
      throw new BridgeError(
        "FORBIDDEN",
        `${action} requires an organization administrator or directory integration identity.`,
        403,
      );
    }
  }

  private filterAuditRecords(
    records: readonly AuditRecord[],
    query: Pick<AuditListQuery, "action" | "actorId" | "source" | "subjectType" | "subjectId" | "correlationId" | "createdFrom" | "createdTo">,
  ): readonly AuditRecord[] {
    return records
      .filter((event) =>
        (!query.action || event.action === query.action) &&
        (!query.actorId || event.actorId === query.actorId) &&
        (!query.source || event.source === query.source) &&
        (!query.subjectType || event.subjectType === query.subjectType) &&
        (!query.subjectId || event.subjectId === query.subjectId) &&
        (!query.correlationId || event.correlationId === query.correlationId) &&
        (!query.createdFrom || Date.parse(event.createdAt) >= Date.parse(query.createdFrom)) &&
        (!query.createdTo || Date.parse(event.createdAt) <= Date.parse(query.createdTo)),
      )
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  }

  private auditPage(records: readonly AuditRecord[], query: AuditListQuery): AuditPage {
    const matching = this.filterAuditRecords(records, query);
    const items = matching.slice(query.offset, query.offset + query.limit);
    const nextOffset = query.offset + items.length < matching.length
      ? query.offset + items.length
      : undefined;
    return {
      items,
      offset: query.offset,
      limit: query.limit,
      totalMatching: matching.length,
      ...(nextOffset === undefined ? {} : { nextOffset }),
    };
  }

  private renderAuditExport(
    scope: AuditRecord["scope"],
    scopeId: string,
    records: readonly AuditRecord[],
    format: AuditExportInput["format"],
    exportedAt: string,
  ): AuditExport {
    const safeTimestamp = exportedAt.replace(/[:.]/g, "-");
    if (format === "json") {
      return {
        filename: `bridge-${scope}-audit-${safeTimestamp}.json`,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ scope, scopeId, exportedAt, itemCount: records.length, items: records }, null, 2),
        itemCount: records.length,
      };
    }
    const fields: readonly (keyof AuditRecord)[] = [
      "id", "scope", "organizationId", "projectId", "correlationId", "actorId", "actorType",
      "source", "action", "subjectType", "subjectId", "reason", "policyVersion", "policyRuleKey",
      "assignmentId", "ownerRouteSource", "reviewerRouteSource", "beforeVersion", "afterVersion", "createdAt",
    ];
    const csvCell = (value: unknown): string => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const body = [
      fields.map(csvCell).join(","),
      ...records.map((record) => fields.map((field) => csvCell(record[field])).join(",")),
    ].join("\n");
    return {
      filename: `bridge-${scope}-audit-${safeTimestamp}.csv`,
      contentType: "text/csv; charset=utf-8",
      body,
      itemCount: records.length,
    };
  }

  private projectDataExportCount(
    total: number,
    offset: number,
    included: number,
  ): ProjectDataExportCount {
    const nextOffset = offset + included < total ? offset + included : undefined;
    return {
      total,
      included,
      offset,
      ...(nextOffset === undefined ? {} : { nextOffset }),
    };
  }

  private normalizeProjectOwnershipConfiguration(
    principal: Principal,
    project: Project,
    input: ReplaceProjectOwnershipInput,
    activeHumans: ReadonlyMap<string, Principal>,
    version: number,
  ): ProjectOwnershipConfiguration {
    const roles: ProjectRoleDefinition[] = [];
    const roleNames = new Set<string>();
    for (const role of input.roles) {
      const name = normalizeRoleName(role.name);
      if (!name || roleNames.has(name)) {
        throw new BridgeError("VALIDATION_FAILED", "Project role names must be unique after normalization.", 400);
      }
      roleNames.add(name);
      roles.push({ name, description: role.description.trim() });
    }

    const teams: ProjectTeam[] = [];
    const teamKeys = new Set<string>();
    for (const team of input.teams) {
      const key = normalizeRoleName(team.key);
      if (!key || teamKeys.has(key)) {
        throw new BridgeError("VALIDATION_FAILED", "Project team keys must be unique after normalization.", 400);
      }
      const memberIds = [...new Set(team.memberIds)];
      if (memberIds.length !== team.memberIds.length) {
        throw new BridgeError("VALIDATION_FAILED", "A project team member can appear only once.", 400);
      }
      for (const memberId of memberIds) {
        if (!activeHumans.has(memberId)) {
          throw new BridgeError(
            "VALIDATION_FAILED",
            "Project teams can contain only active human members with access to this project.",
            400,
            { memberId },
          );
        }
      }
      teamKeys.add(key);
      teams.push({ key, name: team.name.trim(), memberIds });
    }

    const rules: ProjectOwnershipRule[] = [];
    const ruleKeys = new Set<string>();
    for (const inputRule of input.rules) {
      const key = normalizeRoleName(inputRule.key);
      if (!key || ruleKeys.has(key)) {
        throw new BridgeError("VALIDATION_FAILED", "Ownership rule keys must be unique after normalization.", 400);
      }
      ruleKeys.add(key);
      const owners = this.normalizeOwnershipTargets(inputRule.owners, activeHumans, teamKeys);
      const reviewers = this.normalizeOwnershipTargets(inputRule.reviewers, activeHumans, teamKeys);
      if (this.ownershipTargetCount(owners) + this.ownershipTargetCount(reviewers) === 0) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "An ownership rule must configure at least one owner or reviewer target.",
          400,
        );
      }
      rules.push({
        key,
        name: inputRule.name.trim(),
        priority: inputRule.priority,
        ...(inputRule.category ? { category: inputRule.category.trim() } : {}),
        ...(inputRule.repository ? { repository: inputRule.repository.trim() } : {}),
        ...(inputRule.component ? { component: inputRule.component.trim() } : {}),
        owners,
        reviewers,
      });
    }
    this.assertOwnershipRulesUnambiguous(rules);

    const updatedAt = this.now().toISOString();
    return {
      organizationId: project.organizationId,
      projectId: project.id,
      roles: roles.sort((left, right) => left.name.localeCompare(right.name)),
      teams: teams.sort((left, right) => left.name.localeCompare(right.name)),
      rules: rules.sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key)),
      version,
      updatedById: principal.id,
      updatedAt,
    };
  }

  private normalizeOwnershipTargets(
    input: ReplaceProjectOwnershipInput["rules"][number]["owners"],
    activeHumans: ReadonlyMap<string, Principal>,
    teamKeys: ReadonlySet<string>,
  ): ProjectOwnershipRule["owners"] {
    const principalIds = [...new Set(input.principalIds)];
    if (principalIds.length !== input.principalIds.length) {
      throw new BridgeError("VALIDATION_FAILED", "An ownership target principal can appear only once.", 400);
    }
    for (const principalId of principalIds) {
      if (!activeHumans.has(principalId)) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "Ownership targets can include only active human members with access to this project.",
          400,
          { principalId },
        );
      }
    }
    const roles = this.normalizedRoles(input.roles);
    const normalizedTeamKeys = [...new Set(input.teamKeys.map(normalizeRoleName).filter(Boolean))];
    if (normalizedTeamKeys.length !== input.teamKeys.length) {
      throw new BridgeError("VALIDATION_FAILED", "An ownership target team can appear only once.", 400);
    }
    for (const teamKey of normalizedTeamKeys) {
      if (!teamKeys.has(teamKey)) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "Ownership rules must reference a configured project team.",
          400,
          { teamKey },
        );
      }
    }
    return { principalIds, roles, teamKeys: normalizedTeamKeys };
  }

  private ownershipTargetCount(target: ProjectOwnershipRule["owners"]): number {
    return target.principalIds.length + target.roles.length + target.teamKeys.length;
  }

  private normalizedOwnershipSelector(value: string | undefined): string | undefined {
    return value?.normalize("NFKC").trim().toLocaleLowerCase("en") || undefined;
  }

  private normalizedPolicyCategory(value: string | undefined): string | undefined {
    return value?.normalize("NFKC").trim().toLocaleLowerCase("en")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || undefined;
  }

  private ownershipRulesOverlap(left: ProjectOwnershipRule, right: ProjectOwnershipRule): boolean {
    return (["category", "repository", "component"] as const).every((field) => {
      const leftValue = this.normalizedOwnershipSelector(left[field]);
      const rightValue = this.normalizedOwnershipSelector(right[field]);
      return !leftValue || !rightValue || leftValue === rightValue;
    });
  }

  private assertOwnershipRulesUnambiguous(rules: readonly ProjectOwnershipRule[]): void {
    for (const [index, left] of rules.entries()) {
      for (const right of rules.slice(index + 1)) {
        if (left.priority !== right.priority || !this.ownershipRulesOverlap(left, right)) continue;
        const ownerConflict = this.ownershipTargetCount(left.owners) > 0 && this.ownershipTargetCount(right.owners) > 0;
        const reviewerConflict = this.ownershipTargetCount(left.reviewers) > 0 && this.ownershipTargetCount(right.reviewers) > 0;
        if (ownerConflict || reviewerConflict) {
          throw new BridgeError(
            "VALIDATION_FAILED",
            "Equal-priority ownership rules cannot overlap for the same responsibility.",
            400,
            { ruleKeys: [left.key, right.key], responsibility: ownerConflict ? "owner" : "reviewer" },
          );
        }
      }
    }
  }

  private normalizeProjectPolicyRules(
    inputRules: ReplaceProjectPolicyInput["rules"],
  ): readonly ProjectPolicyRule[] {
    const rules: ProjectPolicyRule[] = [];
    const keys = new Set<string>();
    for (const inputRule of inputRules) {
      const key = normalizeRoleName(inputRule.key);
      if (!key || keys.has(key)) {
        throw new BridgeError("VALIDATION_FAILED", "Project policy rule keys must be unique after normalization.", 400);
      }
      keys.add(key);
      const requiredOwnerRoles = this.normalizedRoles(inputRule.requiredOwnerRoles);
      const requiredReviewerRoles = this.normalizedRoles(inputRule.requiredReviewerRoles);
      const reviewerQuorum = this.normalizedReviewerQuorum(inputRule.reviewerQuorum, requiredReviewerRoles);
      if (requiredOwnerRoles.length !== inputRule.requiredOwnerRoles.length ||
        requiredReviewerRoles.length !== inputRule.requiredReviewerRoles.length) {
        throw new BridgeError("VALIDATION_FAILED", "Required policy roles must be unique after normalization.", 400);
      }
      if (inputRule.action === "assume_and_log" &&
        (inputRule.minimumRisk !== "low" || requiredOwnerRoles.length > 0 || requiredReviewerRoles.length > 0)) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "Assume-and-log policy cannot require elevated risk, owners, or reviewers.",
          400,
        );
      }
      if ((inputRule.action === "protected_approval") !== (inputRule.minimumRisk === "protected")) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "Protected risk and protected-approval action must be configured together.",
          400,
        );
      }
      if (inputRule.action !== "protected_approval" && (requiredReviewerRoles.length > 0 || Object.keys(reviewerQuorum).length > 0)) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "Required reviewer roles are supported only by protected-approval policy.",
          400,
        );
      }
      if (inputRule.action === "protected_approval" &&
        requiredOwnerRoles.length + requiredReviewerRoles.length === 0) {
        throw new BridgeError(
          "VALIDATION_FAILED",
          "Protected policy must require at least one human owner or reviewer role.",
          400,
        );
      }
      const category = this.normalizedPolicyCategory(inputRule.category);
      const defaultRule = category
        ? DEFAULT_PROTECTED_POLICY_RULES.find((rule) => rule.category === category)
        : undefined;
      if (defaultRule) {
        const missingDefaultRole = defaultRule.requiredOwnerRoles.some((role) => !requiredOwnerRoles.includes(role)) ||
          defaultRule.requiredReviewerRoles.some((role) => !requiredReviewerRoles.includes(role));
        if (inputRule.action !== "protected_approval" || inputRule.minimumRisk !== "protected" || missingDefaultRole) {
          throw new BridgeError(
            "POLICY_BLOCKED",
            "Pilot protected-category defaults may be strengthened but not weakened.",
            403,
            { category, defaultRuleKey: defaultRule.key },
          );
        }
      }
      rules.push({
        key,
        name: inputRule.name.trim(),
        priority: inputRule.priority,
        ...(category ? { category } : {}),
        scope: Object.fromEntries(
          Object.entries(inputRule.scope)
            .map(([field, value]) => [field, this.normalizedOwnershipSelector(value)])
            .filter((entry): entry is [string, string] => Boolean(entry[1])),
        ) as Scope,
        action: inputRule.action,
        minimumRisk: inputRule.minimumRisk,
        requiredOwnerRoles,
        requiredReviewerRoles,
        ...(Object.keys(reviewerQuorum).length > 0 ? { reviewerQuorum } : {}),
      });
    }
    for (const [index, left] of rules.entries()) {
      for (const right of rules.slice(index + 1)) {
        if (left.priority === right.priority && this.policyRulesOverlap(left, right)) {
          throw new BridgeError(
            "VALIDATION_FAILED",
            "Equal-priority project policy rules cannot overlap.",
            400,
            { ruleKeys: [left.key, right.key] },
          );
        }
      }
    }
    return rules.sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key));
  }

  private policyRulesOverlap(left: ProjectPolicyRule, right: ProjectPolicyRule): boolean {
    if (left.category && right.category && left.category !== right.category) return false;
    return (["repository", "component", "branch", "environment", "workItem"] as const).every((field) => {
      const leftValue = this.normalizedOwnershipSelector(left.scope[field]);
      const rightValue = this.normalizedOwnershipSelector(right.scope[field]);
      return !leftValue || !rightValue || leftValue === rightValue;
    });
  }

  private policyRuleMatches(rule: ProjectPolicyRule, category: string, scope: Scope): boolean {
    const normalizedCategory = this.normalizedPolicyCategory(category);
    if (rule.category && rule.category !== normalizedCategory) return false;
    return (["repository", "component", "branch", "environment", "workItem"] as const).every((field) => {
      const expected = this.normalizedOwnershipSelector(rule.scope[field]);
      return !expected || expected === this.normalizedOwnershipSelector(scope[field]);
    });
  }

  private higherRisk(left: Risk, right: Risk): Risk {
    return RISK_RANK[left] >= RISK_RANK[right] ? left : right;
  }

  private strongerAction(left: PolicyAction, right: PolicyAction): PolicyAction {
    return ACTION_RANK[left] >= ACTION_RANK[right] ? left : right;
  }

  private async evaluateProjectPolicy(
    repository: BridgeRepository,
    projectId: string,
    input: PolicyEvaluationInput,
  ): Promise<PolicyEvaluation> {
    const configuration = await repository.getProjectPolicyConfiguration(projectId);
    const configuredRule = configuration?.rules.find((rule) => this.policyRuleMatches(rule, input.category, input.scope));
    const defaultRule = DEFAULT_PROTECTED_POLICY_RULES.find((rule) =>
      this.policyRuleMatches(rule, input.category, input.scope));
    const baseAction: PolicyAction = input.operation === "assumption"
      ? input.declaredRisk === "low" && input.reversible ? "assume_and_log" : "block"
      : input.declaredRisk === "protected" ? "protected_approval"
        : input.blocking || input.declaredRisk === "high" ? "block" : "ask_async";
    let action = baseAction;
    let risk = input.declaredRisk;
    let policyRuleKey = input.operation === "assumption" ? "bridge-assumption-default" :
      baseAction === "ask_async" ? "bridge-question-async" :
        baseAction === "block" ? "bridge-question-blocking" : "bridge-agent-protected";
    let requiredOwnerRoles: readonly string[] = [];
    let requiredReviewerRoles: readonly string[] = baseAction === "protected_approval" ? ["security-reviewer"] : [];
    let requiredReviewerQuorum: Readonly<Record<string, number>> = {};

    if (defaultRule) {
      action = this.strongerAction(action, defaultRule.action);
      risk = this.higherRisk(risk, defaultRule.minimumRisk);
      policyRuleKey = defaultRule.key;
      requiredOwnerRoles = defaultRule.requiredOwnerRoles;
      requiredReviewerRoles = defaultRule.requiredReviewerRoles;
      requiredReviewerQuorum = defaultRule.reviewerQuorum ?? {};
    }
    if (configuredRule) {
      const beforeAction = action;
      const beforeRisk = risk;
      action = this.strongerAction(action, configuredRule.action);
      risk = this.higherRisk(risk, configuredRule.minimumRisk);
      if (ACTION_RANK[configuredRule.action] >= ACTION_RANK[beforeAction] &&
        RISK_RANK[configuredRule.minimumRisk] >= RISK_RANK[beforeRisk]) {
        policyRuleKey = configuredRule.key;
      }
      requiredOwnerRoles = this.normalizedRoles([
        ...requiredOwnerRoles,
        ...configuredRule.requiredOwnerRoles,
      ]);
      requiredReviewerRoles = this.normalizedRoles([
        ...requiredReviewerRoles,
        ...configuredRule.requiredReviewerRoles,
      ]);
      requiredReviewerQuorum = this.mergeReviewerQuorum(
        requiredReviewerQuorum,
        configuredRule.reviewerQuorum ?? {},
      );
    }
    if (action === "protected_approval") risk = "protected";
    return {
      action,
      risk,
      policyVersion: configuration?.version ?? 0,
      policyRuleKey,
      requiredOwnerRoles,
      requiredReviewerRoles,
      requiredReviewerQuorum,
    };
  }

  private ownershipRuleMatches(
    rule: ProjectOwnershipRule,
    category: string,
    scope: Scope,
  ): boolean {
    return (!rule.category || this.normalizedPolicyCategory(rule.category) === this.normalizedPolicyCategory(category)) &&
      (!rule.repository || this.normalizedOwnershipSelector(rule.repository) ===
        this.normalizedOwnershipSelector(scope.repository)) &&
      (!rule.component || this.normalizedOwnershipSelector(rule.component) ===
        this.normalizedOwnershipSelector(scope.component));
  }

  private ownershipRouteSource(rule: ProjectOwnershipRule): QuestionRouteSource {
    if (rule.repository || rule.component) return "scoped_ownership";
    if (rule.category) return "category_role";
    return "project_default";
  }

  private expandOwnershipTargets(
    targets: ProjectOwnershipRule["owners"],
    configuration: ProjectOwnershipConfiguration,
  ): { readonly principalIds: readonly string[]; readonly roles: readonly string[] } {
    const teamMembers = new Map(configuration.teams.map((team) => [team.key, team.memberIds]));
    return {
      principalIds: [...new Set([
        ...targets.principalIds,
        ...targets.teamKeys.flatMap((teamKey) => teamMembers.get(teamKey) ?? []),
      ])],
      roles: this.normalizedRoles(targets.roles),
    };
  }

  private async resolveQuestionRouting(
    repository: BridgeRepository,
    project: Project,
    input: CreateQuestionInput,
    policy: PolicyEvaluation,
  ): Promise<RoutingResolution> {
    const ownership = await repository.getProjectOwnershipConfiguration(project.id) ?? {
      organizationId: project.organizationId,
      projectId: project.id,
      roles: [],
      teams: [],
      rules: [],
      version: 0,
    };
    const rules = [...ownership.rules]
      .filter((rule) => this.ownershipRuleMatches(rule, input.category, input.scope))
      .sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key));
    const findRule = (
      lane: "owners" | "reviewers",
      source: "scoped_ownership" | "category_role" | "project_default",
    ) => rules.find((rule) =>
      this.ownershipRouteSource(rule) === source && this.ownershipTargetCount(rule[lane]) > 0);

    let ownerIds: readonly string[] = [...new Set(input.intendedOwnerIds)];
    let ownerRoles: readonly string[] = this.normalizedRoles(input.intendedOwnerRoles);
    let ownerSource: QuestionRouteSource = "admin_fallback";
    let ownerRuleKey: string | undefined;
    if (ownerIds.length > 0 || ownerRoles.length > 0) {
      ownerSource = "explicit_owner";
    } else {
      const ownerRule = findRule("owners", "scoped_ownership") ??
        findRule("owners", "category_role") ??
        findRule("owners", "project_default");
      if (ownerRule) {
        const expanded = this.expandOwnershipTargets(ownerRule.owners, ownership);
        ownerIds = expanded.principalIds;
        ownerRoles = expanded.roles;
        ownerSource = this.ownershipRouteSource(ownerRule);
        ownerRuleKey = ownerRule.key;
      } else if (policy.requiredOwnerRoles.length > 0) {
        ownerSource = "category_role";
      } else if (project.decisionOwnerIds.length > 0) {
        ownerIds = [...project.decisionOwnerIds];
        ownerSource = "project_default";
      }
    }
    ownerRoles = this.normalizedRoles([...ownerRoles, ...policy.requiredOwnerRoles]);

    const reviewerRule = findRule("reviewers", "scoped_ownership") ??
      findRule("reviewers", "category_role") ??
      findRule("reviewers", "project_default");
    const expandedReviewers = reviewerRule
      ? this.expandOwnershipTargets(reviewerRule.reviewers, ownership)
      : { principalIds: [], roles: [] };
    const reviewerIds = expandedReviewers.principalIds;
    const reviewerRoles = this.normalizedRoles([
      ...expandedReviewers.roles,
      ...policy.requiredReviewerRoles,
    ]);
    const reviewerSource: QuestionRouteSource = reviewerRule
      ? this.ownershipRouteSource(reviewerRule)
      : policy.requiredReviewerRoles.length > 0 ? "policy" : "none";
    return {
      ownerIds,
      ownerRoles,
      reviewerIds,
      reviewerRoles,
      explanation: {
        ownerSource,
        reviewerSource,
        ...(ownerRuleKey ? { ownerRuleKey } : {}),
        ...(reviewerRule ? { reviewerRuleKey: reviewerRule.key } : {}),
        ownershipVersion: ownership.version,
        policyVersion: policy.policyVersion,
      },
    };
  }

  private normalizedRoles(roles: readonly string[]): readonly string[] {
    return [...new Set(roles.map(normalizeRoleName).filter(Boolean))].sort((left, right) =>
      left.localeCompare(right));
  }

  private normalizedReviewerQuorum(
    quorum: Readonly<Record<string, number>> | undefined,
    requiredReviewerRoles: readonly string[],
  ): Readonly<Record<string, number>> {
    const allowedRoles = new Set(requiredReviewerRoles);
    const normalized = Object.fromEntries(
      Object.entries(quorum ?? {}).map(([role, count]) => {
        const normalizedRole = normalizeRoleName(role);
        if (!normalizedRole || !allowedRoles.has(normalizedRole)) {
          throw new BridgeError(
            "VALIDATION_FAILED",
            "Reviewer quorum can only be configured for a required reviewer role.",
            400,
            { role },
          );
        }
        if (!Number.isInteger(count) || count < 1 || count > 20) {
          throw new BridgeError("VALIDATION_FAILED", "Reviewer quorum must be between 1 and 20.", 400, { role });
        }
        return [normalizedRole, count] as const;
      }),
    );
    return normalized;
  }

  private mergeReviewerQuorum(
    left: Readonly<Record<string, number>>,
    right: Readonly<Record<string, number>>,
  ): Readonly<Record<string, number>> {
    const merged: Record<string, number> = { ...left };
    for (const [role, count] of Object.entries(right)) {
      merged[normalizeRoleName(role)] = Math.max(merged[normalizeRoleName(role)] ?? 1, count);
    }
    return merged;
  }

  private sameRoles(left: readonly string[], right: readonly string[]): boolean {
    return JSON.stringify(this.normalizedRoles(left)) === JSON.stringify(this.normalizedRoles(right));
  }

  private sameProjectMembershipConfiguration(
    existing: readonly ProjectMembership[],
    configured: readonly ProjectMembershipConfiguration[],
  ): boolean {
    const active = existing
      .filter((membership) => membership.status === "active")
      .map((membership) => ({ projectId: membership.projectId, roles: this.normalizedRoles(membership.roles) }))
      .sort((left, right) => left.projectId.localeCompare(right.projectId));
    const desired = configured
      .map((membership) => ({ projectId: membership.projectId, roles: this.normalizedRoles(membership.roles) }))
      .sort((left, right) => left.projectId.localeCompare(right.projectId));
    return JSON.stringify(active) === JSON.stringify(desired);
  }

  private async configuredProjectMemberships(
    principal: Principal,
    configured: readonly ProjectMembershipConfiguration[],
    repository: BridgeRepository,
  ): Promise<readonly ProjectMembershipConfiguration[]> {
    const projects = new Map(
      (await repository.listProjects(principal.organizationId)).map((project) => [project.id, project]),
    );
    const seenProjectIds = new Set<string>();
    return configured.map((membership) => {
      if (seenProjectIds.has(membership.projectId)) {
        throw new BridgeError("VALIDATION_FAILED", "Each project can appear only once.", 400);
      }
      seenProjectIds.add(membership.projectId);
      if (!projects.has(membership.projectId)) {
        throw new BridgeError(
          "PROJECT_NOT_FOUND",
          "A configured project was not found in this organization.",
          404,
        );
      }
      return { projectId: membership.projectId, roles: [...this.normalizedRoles(membership.roles)] };
    });
  }

  private organizationMember(
    identity: PrincipalIdentity,
    membership: OrganizationMembership,
    projectMemberships: readonly ProjectMembership[],
  ): OrganizationMember {
    return {
      id: identity.id,
      displayName: identity.displayName,
      oidcSubject: identity.oidcSubject,
      status: membership.status,
      roles: membership.roles,
      allProjects: membership.allProjects,
      provisioning: membership.provisioning,
      projectMemberships: [...projectMemberships].sort((left, right) =>
        left.projectId.localeCompare(right.projectId)),
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
      version: membership.version,
    };
  }

  private serviceIdentity(
    credential: ServiceCredential,
    identity: PrincipalIdentity,
    membership: OrganizationMembership,
    projectMemberships: readonly ProjectMembership[],
  ): ServiceIdentity {
    return {
      id: credential.id,
      principalId: identity.id,
      name: credential.name,
      type: identity.type,
      scopes: credential.scopes,
      roles: membership.roles,
      allProjects: membership.allProjects,
      projectMemberships: [...projectMemberships].sort((left, right) =>
        left.projectId.localeCompare(right.projectId)),
      createdAt: credential.createdAt,
      expiresAt: credential.expiresAt,
      ...(credential.rotatedAt ? { rotatedAt: credential.rotatedAt } : {}),
      ...(credential.revokedAt ? { revokedAt: credential.revokedAt } : {}),
      version: credential.version,
    };
  }

  private async auditOrganizationMember(
    repository: BridgeRepository,
    principal: Principal,
    action: OrganizationAuditEvent["action"],
    memberId: string,
    createdAt: string,
    versionTransition: AuditMetadata = {},
  ): Promise<void> {
    return this.auditOrganizationEvent(
      repository,
      principal,
      action,
      memberId,
      createdAt,
      "organization_membership",
      versionTransition,
    );
  }

  private async auditOrganizationEvent(
    repository: BridgeRepository,
    principal: Principal,
    action: OrganizationAuditEvent["action"],
    subjectId: string,
    createdAt: string,
    subjectType: OrganizationAuditEvent["subjectType"],
    versionTransition: AuditMetadata = {},
  ): Promise<void> {
    await repository.saveOrganizationAuditEvent({
      id: `oaud_${this.id()}`,
      correlationId: currentCorrelationId() ?? createCorrelationId(),
      organizationId: principal.organizationId,
      actorId: principal.id,
      actorType: principal.type,
      action,
      subjectType,
      subjectId,
      source: currentCorrelationContext()?.source ?? "application",
      ...(versionTransition.beforeVersion === undefined ? {} : { beforeVersion: versionTransition.beforeVersion }),
      ...(versionTransition.afterVersion === undefined ? {} : { afterVersion: versionTransition.afterVersion }),
      createdAt,
    });
  }

  private async requireProject(
    principal: Principal,
    projectId: string,
    repository: BridgeRepository = this.repository,
  ): Promise<Project> {
    return this.requireProjectForResource(
      principal,
      projectId,
      repository,
      "PROJECT_NOT_FOUND",
      "Project not found.",
    );
  }

  private async requireProjectForResource(
    principal: Principal,
    projectId: string,
    repository: BridgeRepository,
    notFoundCode: BridgeErrorCode,
    notFoundMessage: string,
  ): Promise<Project> {
    const project = await repository.getProject(projectId);
    if (!project) {
      throw new BridgeError(notFoundCode, notFoundMessage, 404);
    }
    try {
      assertProjectAccess(principal, project);
    } catch (error) {
      if (error instanceof BridgeError && error.code === "FORBIDDEN") {
        throw new BridgeError(notFoundCode, notFoundMessage, 404);
      }
      throw error;
    }
    return project;
  }

  private assertProjectOperator(principal: Principal, action: string, projectId?: string): void {
    assertHuman(principal, action);
    if (!principalHasRole(principal, "project-admin", projectId)) {
      throw new BridgeError("FORBIDDEN", `${action} requires a project administrator.`, 403);
    }
  }

  private assertIntegrationWriter(principal: Principal, action: string, projectId: string): void {
    if (principal.type === "human") {
      this.assertProjectOperator(principal, action, projectId);
      return;
    }
    if (!["ci", "integration"].includes(principal.type)) {
      throw new BridgeError(
        "FORBIDDEN",
        `${action} requires a project administrator or an integration service identity.`,
        403,
      );
    }
  }

  private githubPullRequestMatches(
    existing: GithubPullRequestContext,
    candidate: Pick<
      GithubPullRequestContext,
      | "repositoryId"
      | "number"
      | "title"
      | "state"
      | "canonicalUrl"
      | "headBranch"
      | "baseBranch"
      | "headSha"
      | "decisionIds"
      | "artifactVersionIds"
      | "sourceUpdatedAt"
    >,
  ): boolean {
    return existing.repositoryId === candidate.repositoryId &&
      existing.number === candidate.number &&
      existing.title === candidate.title &&
      existing.state === candidate.state &&
      existing.canonicalUrl === candidate.canonicalUrl &&
      existing.headBranch === candidate.headBranch &&
      existing.baseBranch === candidate.baseBranch &&
      existing.headSha === candidate.headSha &&
      existing.sourceUpdatedAt === candidate.sourceUpdatedAt &&
      JSON.stringify(existing.decisionIds) === JSON.stringify(candidate.decisionIds) &&
      JSON.stringify(existing.artifactVersionIds) === JSON.stringify(candidate.artifactVersionIds);
  }

  private async githubPullRequestView(
    repository: BridgeRepository,
    pullRequest: GithubPullRequestContext,
  ): Promise<GithubPullRequestContextView> {
    const decisions = (
      await Promise.all(pullRequest.decisionIds.map((decisionId) => repository.getDecision(decisionId)))
    )
      .filter((decision): decision is Decision =>
        decision !== undefined &&
        decision.projectId === pullRequest.projectId &&
        decision.status === "active")
      .map(({ id, answer, category, status, scope }) => ({
        id,
        answer,
        category,
        status,
        scope,
        trustLevel: "untrusted_data" as const,
      }));
    const artifactVersions = (
      await Promise.all(
        pullRequest.artifactVersionIds.map(async (versionId) => {
          const artifact = await repository.getArtifactByVersionId(versionId);
          const version = artifact?.versions.find((candidate) => candidate.id === versionId);
          if (
            !artifact ||
            artifact.projectId !== pullRequest.projectId ||
            !version ||
            !["approved", "superseded"].includes(version.status)
          ) return undefined;
          return {
            artifactId: artifact.id,
            artifactTitle: artifact.title,
            artifactType: artifact.type,
            versionId: version.id,
            version: version.version,
            status: version.status,
            summary: version.summary,
            trustLevel: "untrusted_data" as const,
          };
        }),
      )
    ).filter((version): version is GithubPullRequestContextView["artifactVersions"][number] =>
      version !== undefined);
    return {
      pullRequest,
      trustLevel: "untrusted_data",
      decisions,
      artifactVersions,
      humanApprovalChanged: false,
    };
  }

  private githubIssueMatches(
    existing: GithubIssueWorkItem,
    candidate: Pick<
      GithubIssueWorkItem,
      | "repositoryId"
      | "number"
      | "reference"
      | "title"
      | "state"
      | "canonicalUrl"
      | "labels"
      | "decisionIds"
      | "artifactVersionIds"
      | "sourceUpdatedAt"
    >,
  ): boolean {
    return existing.repositoryId === candidate.repositoryId &&
      existing.number === candidate.number &&
      existing.reference === candidate.reference &&
      existing.title === candidate.title &&
      existing.state === candidate.state &&
      existing.canonicalUrl === candidate.canonicalUrl &&
      existing.sourceUpdatedAt === candidate.sourceUpdatedAt &&
      JSON.stringify(existing.labels) === JSON.stringify(candidate.labels) &&
      JSON.stringify(existing.decisionIds) === JSON.stringify(candidate.decisionIds) &&
      JSON.stringify(existing.artifactVersionIds) === JSON.stringify(candidate.artifactVersionIds);
  }

  private async githubIssueView(
    repository: BridgeRepository,
    issue: GithubIssueWorkItem,
  ): Promise<GithubIssueContextView> {
    const decisions = (
      await Promise.all(issue.decisionIds.map((decisionId) => repository.getDecision(decisionId)))
    )
      .filter((decision): decision is Decision =>
        decision !== undefined &&
        decision.projectId === issue.projectId &&
        decision.status === "active")
      .map(({ id, answer, category, status, scope }) => ({
        id,
        answer,
        category,
        status,
        scope,
        trustLevel: "untrusted_data" as const,
      }));
    const artifactVersions = (
      await Promise.all(
        issue.artifactVersionIds.map(async (versionId) => {
          const artifact = await repository.getArtifactByVersionId(versionId);
          const version = artifact?.versions.find((candidate) => candidate.id === versionId);
          if (
            !artifact ||
            artifact.projectId !== issue.projectId ||
            !version ||
            !["approved", "superseded"].includes(version.status)
          ) return undefined;
          return {
            artifactId: artifact.id,
            artifactTitle: artifact.title,
            artifactType: artifact.type,
            versionId: version.id,
            version: version.version,
            status: version.status,
            summary: version.summary,
            trustLevel: "untrusted_data" as const,
          };
        }),
      )
    ).filter((version): version is GithubIssueContextView["artifactVersions"][number] =>
      version !== undefined);
    return {
      issue,
      trustLevel: "untrusted_data",
      decisions,
      artifactVersions,
      humanApprovalChanged: false,
    };
  }

  private async audit(
    repository: BridgeRepository,
    principal: Principal,
    projectId: string,
    action: string,
    subjectType: AuditEvent["subjectType"],
    subjectId: string,
    createdAt: string,
    policyVersion?: number,
    reason?: string,
    metadata: AuditMetadata = {},
  ): Promise<void> {
    await repository.saveAuditEvent({
      id: `aud_${this.id()}`,
      correlationId: currentCorrelationId() ?? createCorrelationId(),
      organizationId: principal.organizationId,
      projectId,
      actorId: principal.id,
      actorType: principal.type,
      action,
      subjectType,
      subjectId,
      source: currentCorrelationContext()?.source ?? "application",
      ...(reason ? { reason } : {}),
      ...(policyVersion === undefined ? {} : { policyVersion }),
      ...(metadata.policyRuleKey === undefined ? {} : { policyRuleKey: metadata.policyRuleKey }),
      ...(metadata.assignmentId === undefined ? {} : { assignmentId: metadata.assignmentId }),
      ...(metadata.ownerRouteSource === undefined ? {} : { ownerRouteSource: metadata.ownerRouteSource }),
      ...(metadata.reviewerRouteSource === undefined
        ? {}
        : { reviewerRouteSource: metadata.reviewerRouteSource }),
      ...(metadata.beforeVersion === undefined ? {} : { beforeVersion: metadata.beforeVersion }),
      ...(metadata.afterVersion === undefined ? {} : { afterVersion: metadata.afterVersion }),
      createdAt,
    });
  }

  private async notify(
    repository: BridgeRepository,
    principal: Principal,
    projectId: string,
    recipientIds: readonly string[],
    draft: NotificationDraft,
  ): Promise<void> {
    const recipients = await this.resolveNotificationRecipients(
      repository,
      principal,
      projectId,
      recipientIds,
      draft.recipientRoles ?? [],
    );
    for (const recipientId of recipients) {
      const createdAt = this.now().toISOString();
      const notificationId = `ntf_${this.id()}`;
      await repository.saveNotification({
        id: notificationId,
        organizationId: principal.organizationId,
        projectId,
        recipientId,
        type: draft.type,
        title: draft.title,
        body: draft.body,
        targetType: draft.targetType,
        targetId: draft.targetId,
        createdAt,
      });
      await repository.saveOutboxEvent({
        id: `evt_${this.id()}`,
        correlationId: currentCorrelationId() ?? createCorrelationId(),
        organizationId: principal.organizationId,
        projectId,
        type: "notification.created",
        payload: {
          notificationId,
          recipientId,
          notificationType: draft.type,
          targetType: draft.targetType,
          targetId: draft.targetId,
          ...(draft.questionContext ? { questionContext: draft.questionContext } : {}),
        },
        status: "pending",
        attempts: 0,
        availableAt: createdAt,
        createdAt,
      });
    }
  }

  private async queueAutomaticRunContinuations(
    repository: BridgeRepository,
    principal: Principal,
    projectId: string,
    resolvedQuestionId: string,
    triggeringDecisionId: string,
    createdAt: string,
  ): Promise<void> {
    const candidates = (await repository.listRuns(projectId)).filter((run) =>
      run.status === "waiting_for_human" &&
      run.continuationMode === "automatic" &&
      run.client === "codex" &&
      run.questionIds.includes(resolvedQuestionId));
    for (const run of candidates) {
      const vendorSessionId = await repository.getRunVendorSessionId(run.id);
      if (!vendorSessionId) continue;
      const blockingQuestions = await this.blockingQuestions(repository, run);
      if (blockingQuestions.some((question) => ["open", "in_discussion"].includes(question.status))) continue;
      await repository.saveOutboxEvent({
        id: `evt_${this.id()}`,
        correlationId: currentCorrelationId() ?? createCorrelationId(),
        organizationId: principal.organizationId,
        projectId,
        type: "run.continuation_ready",
        payload: {
          runId: run.id,
          client: "codex",
          vendorSessionId,
          triggeringDecisionId,
          runVersion: run.version,
        },
        status: "pending",
        attempts: 0,
        availableAt: createdAt,
        createdAt,
      });
      await this.audit(
        repository,
        principal,
        projectId,
        "run.continuation_queued",
        "run",
        run.id,
        createdAt,
      );
    }
  }

  private async resolveNotificationRecipients(
    repository: BridgeRepository,
    principal: Principal,
    projectId: string,
    recipientIds: readonly string[],
    recipientRoles: readonly string[],
  ): Promise<readonly string[]> {
    const recipients = new Set(
      recipientIds.filter((recipientId) => recipientId && recipientId !== principal.id),
    );
    const roles = [...new Set(recipientRoles.map(normalizeRoleName).filter(Boolean))];
    if (roles.length === 0) return [...recipients];

    const project = await repository.getProject(projectId);
    if (!project) return [...recipients];
    const directory = await repository.listOrganizationPrincipals(principal.organizationId);
    for (const candidate of directory) {
      if (candidate.type !== "human") continue;
      try {
        assertProjectAccess(candidate, project);
      } catch {
        continue;
      }
      if (roles.some((role) => principalHasRole(candidate, role, projectId))) {
        recipients.add(candidate.id);
      }
    }
    return [...recipients];
  }
}
