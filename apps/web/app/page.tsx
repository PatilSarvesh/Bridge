"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BridgeIcon, type BridgeIconName } from "./bridge-icon";
import { MarkdownDocument } from "./markdown-document";
import { UserGuide } from "./user-guide";

const apiUrl = process.env.NEXT_PUBLIC_BRIDGE_API_URL ?? "http://127.0.0.1:4000";
const defaultPrincipalId = "usr_architect";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly decisionOwnerIds: readonly string[];
}

interface RepositoryRecord {
  readonly id: string;
  readonly provider: string;
  readonly owner: string;
  readonly name: string;
  readonly canonicalUrl: string;
  readonly createdAt: string;
}

interface ProjectRoleDefinition {
  readonly name: string;
  readonly description: string;
}

interface ProjectTeam {
  readonly key: string;
  readonly name: string;
  readonly memberIds: readonly string[];
}

interface OwnershipRuleTarget {
  readonly principalIds: readonly string[];
  readonly roles: readonly string[];
  readonly teamKeys: readonly string[];
}

interface ProjectOwnershipRule {
  readonly key: string;
  readonly name: string;
  readonly priority: number;
  readonly category?: string;
  readonly repository?: string;
  readonly component?: string;
  readonly owners: OwnershipRuleTarget;
  readonly reviewers: OwnershipRuleTarget;
}

interface ProjectOwnershipConfiguration {
  readonly organizationId: string;
  readonly projectId: string;
  readonly roles: readonly ProjectRoleDefinition[];
  readonly teams: readonly ProjectTeam[];
  readonly rules: readonly ProjectOwnershipRule[];
  readonly version: number;
  readonly updatedById?: string;
  readonly updatedAt?: string;
}

type PolicyAction = "assume_and_log" | "ask_async" | "block" | "protected_approval";
type Risk = "low" | "medium" | "high" | "protected";

interface ProjectPolicyRule {
  readonly key: string;
  readonly name: string;
  readonly priority: number;
  readonly category?: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly action: PolicyAction;
  readonly minimumRisk: Risk;
  readonly requiredOwnerRoles: readonly string[];
  readonly requiredReviewerRoles: readonly string[];
  readonly reviewerQuorum?: Readonly<Record<string, number>>;
}

interface ProjectPolicyConfiguration {
  readonly organizationId: string;
  readonly projectId: string;
  readonly rules: readonly ProjectPolicyRule[];
  readonly defaultRules: readonly ProjectPolicyRule[];
  readonly version: number;
  readonly updatedById?: string;
  readonly updatedAt?: string;
}

interface Principal {
  readonly id: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly projectRoles?: Readonly<Record<string, readonly string[]>>;
}

interface AuthenticationConfiguration {
  readonly mode: "development" | "oidc";
  readonly loginUrl?: string;
  readonly logoutUrl?: string;
}

interface OrganizationProjectMembership {
  readonly projectId: string;
  readonly status: "active" | "disabled";
  readonly roles: readonly string[];
  readonly version: number;
}

interface OrganizationMember {
  readonly id: string;
  readonly displayName: string;
  readonly oidcSubject: string;
  readonly status: "active" | "disabled";
  readonly roles: readonly string[];
  readonly allProjects: boolean;
  readonly projectMemberships: readonly OrganizationProjectMembership[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

interface Option {
  readonly key: string;
  readonly label: string;
  readonly tradeoffs: string;
}

interface QuestionLink {
  readonly type: "repository" | "work_item" | "branch" | "artifact" | "run" | "external";
  readonly label: string;
  readonly url: string;
}

interface QuestionResponseRevision {
  readonly id: string;
  readonly answer: string;
  readonly rationale: string;
  readonly optionKey?: string;
  readonly mentionedPrincipalIds: readonly string[];
  readonly editedById: string;
  readonly editedAt: string;
}

interface QuestionResponse {
  readonly id: string;
  readonly authorId: string;
  readonly answer: string;
  readonly rationale: string;
  readonly optionKey?: string;
  readonly mentionedPrincipalIds?: readonly string[];
  readonly revisionHistory?: readonly QuestionResponseRevision[];
  readonly createdAt: string;
}

interface QuestionReview {
  readonly id: string;
  readonly reviewerId: string;
  readonly reviewerRole: string;
  readonly status: "approved" | "rejected";
  readonly rationale: string;
  readonly createdAt: string;
}

interface QuestionComment {
  readonly id: string;
  readonly parentCommentId?: string;
  readonly authorId: string;
  readonly body: string;
  readonly mentionedPrincipalIds?: readonly string[];
  readonly revisionHistory?: readonly QuestionCommentRevision[];
  readonly createdAt: string;
}

interface QuestionCommentRevision {
  readonly id: string;
  readonly body: string;
  readonly mentionedPrincipalIds: readonly string[];
  readonly editedById: string;
  readonly editedAt: string;
}

interface QuestionApprovalOverride {
  readonly changedById: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly questionVersion: number;
}

interface QuestionApprovalRequirement {
  readonly role: string;
  readonly requiredCount: number;
  readonly approvedCount: number;
  readonly rejectedCount: number;
  readonly remainingCount: number;
  readonly status: "satisfied" | "pending" | "rejected";
  readonly reviewerIds: readonly string[];
}

interface QuestionApprovalStatus {
  readonly requirements: readonly QuestionApprovalRequirement[];
  readonly satisfied: boolean;
  readonly overridden: boolean;
}

interface QuestionRoutingExplanation {
  readonly ownerSource: string;
  readonly reviewerSource: string;
  readonly ownerRuleKey?: string;
  readonly reviewerRuleKey?: string;
  readonly ownershipVersion: number;
  readonly policyVersion: number;
}

interface QuestionAssignmentHistoryEntry {
  readonly id: string;
  readonly kind: "initial" | "reassigned";
  readonly changedById: string;
  readonly ownerIds: readonly string[];
  readonly ownerRoles: readonly string[];
  readonly reviewerIds: readonly string[];
  readonly reviewerRoles: readonly string[];
  readonly route: QuestionRoutingExplanation;
  readonly reason?: string;
  readonly createdAt: string;
  readonly questionVersion: number;
}

interface Question {
  readonly id: string;
  readonly runId?: string;
  readonly title: string;
  readonly category: string;
  readonly context: string;
  readonly whyItMatters: string;
  readonly risk: "low" | "medium" | "high" | "protected";
  readonly policyAction: PolicyAction;
  readonly policyVersion: number;
  readonly policyRuleKey: string;
  readonly blocking: boolean;
  readonly dueAt?: string;
  readonly blockingEscalatedAt?: string;
  readonly options: readonly Option[];
  readonly relatedLinks?: readonly QuestionLink[];
  readonly recommendationKey?: string;
  readonly ownerIds: readonly string[];
  readonly ownerRoles: readonly string[];
  readonly requiredOwnerRoles: readonly string[];
  readonly reviewerIds: readonly string[];
  readonly reviewerRoles: readonly string[];
  readonly requiredReviewerRoles: readonly string[];
  readonly requiredReviewerQuorum?: Readonly<Record<string, number>>;
  readonly routing: QuestionRoutingExplanation;
  readonly assignmentHistory: readonly QuestionAssignmentHistoryEntry[];
  readonly status: string;
  readonly decisionId?: string;
  readonly responses: readonly QuestionResponse[];
  readonly reviews: readonly QuestionReview[];
  readonly comments: readonly QuestionComment[];
  readonly approvalOverride?: QuestionApprovalOverride;
  readonly acceptedResponseId?: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly version: number;
  readonly inboxReasons: readonly string[];
  readonly canAccept: boolean;
  readonly reviewRoles: readonly string[];
  readonly canReassign: boolean;
  readonly canOverrideApproval: boolean;
  readonly canRequestClarification: boolean;
  readonly canReopen: boolean;
  readonly editableResponseIds: readonly string[];
  readonly editableCommentIds: readonly string[];
  readonly approvalStatus: QuestionApprovalStatus;
  readonly dueStatus: "overdue" | "due_soon" | "scheduled" | "none";
}

interface QuestionAudienceView {
  readonly questionId: string;
  readonly questionVersion: number;
  readonly role: string;
  readonly mode: "explain" | "rewrite";
  readonly source: {
    readonly title: string;
    readonly context: string;
    readonly whyItMatters: string;
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

interface QuestionDecisionDigest {
  readonly id: string;
  readonly category: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly questionCount: number;
  readonly remainingQuestionCount: number;
  readonly earliestDueAt?: string;
  readonly groupingReasons: readonly string[];
  readonly questions: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly dueAt?: string;
    readonly dueStatus: Question["dueStatus"];
    readonly canAccept: boolean;
  }[];
  readonly humanApprovalRequired: true;
  readonly batchAcceptanceAvailable: false;
}

type InboxFilterKey = "status" | "risk" | "category" | "role" | "due";
type InboxFilters = Partial<Record<InboxFilterKey, string>>;
type DecisionFilterKey = "search" | "status" | "category" | "ownerId" | "component" | "createdFrom" | "createdTo";
type DecisionFilters = Partial<Record<DecisionFilterKey, string>> & { readonly includeHistory?: boolean };

interface ArtifactVersion {
  readonly id: string;
  readonly version: number;
  readonly summary: string;
  readonly body: string;
  readonly status: "draft" | "in_review" | "approved" | "superseded";
  readonly createdById: string;
  readonly createdAt: string;
  readonly reviews: readonly ArtifactReview[];
  readonly requiredApprovals: number;
  readonly approvalStatus: ArtifactApprovalStatus;
  readonly reviewerAssignment?: ArtifactReviewerAssignment;
  readonly approvedById?: string;
  readonly approvalRationale?: string;
  readonly approvedAt?: string;
}

interface ArtifactReviewerAssignment {
  readonly id: string;
  readonly reviewerIds: readonly string[];
  readonly routeSource: "explicit_reviewer" | "retained_reviewers" | "scoped_ownership" | "project_default" | "decision_owner_fallback";
  readonly ownershipVersion: number;
  readonly ownershipRuleKey?: string;
  readonly sourceAssignmentId?: string;
  readonly requestedReviewerIds: readonly string[];
  readonly requestedReviewerRoles: readonly string[];
  readonly requestedReviewerTeamKeys: readonly string[];
  readonly createdAt: string;
}

interface ArtifactReview {
  readonly id: string;
  readonly reviewerId: string;
  readonly status: "commented" | "changes_requested" | "approved";
  readonly body: string;
  readonly createdAt: string;
}

interface ArtifactApprovalStatus {
  readonly requiredCount: number;
  readonly approvedCount: number;
  readonly remainingCount: number;
  readonly status: "pending" | "blocked" | "satisfied";
  readonly satisfied: boolean;
  readonly reviewerIds: readonly string[];
}

interface Artifact {
  readonly id: string;
  readonly title: string;
  readonly type: "prd" | "adr" | "api_contract" | "test_plan";
  readonly scope: Readonly<Record<string, string>>;
  readonly reviewerIds: readonly string[];
  readonly currentVersionId: string;
  readonly approvedVersionId?: string;
  readonly versions: readonly ArtifactVersion[];
}

interface ArtifactDiffLine {
  readonly kind: "unchanged" | "added" | "removed";
  readonly text: string;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
}

interface ArtifactVersionDiff {
  readonly artifactId: string;
  readonly from: Pick<ArtifactVersion, "id" | "version" | "summary" | "status" | "createdById" | "createdAt">;
  readonly to: Pick<ArtifactVersion, "id" | "version" | "summary" | "status" | "createdById" | "createdAt">;
  readonly lines: readonly ArtifactDiffLine[];
  readonly counts: { readonly unchanged: number; readonly added: number; readonly removed: number };
  readonly exact: boolean;
  readonly truncated: boolean;
  readonly totalLines: number;
}

interface Notification {
  readonly id: string;
  readonly projectId: string;
  readonly recipientId: string;
  readonly type:
    | "question_assigned"
    | "question_blocking_escalation"
    | "question_response"
    | "question_comment"
    | "question_review"
    | "question_accepted"
    | "decision_lifecycle"
    | "assumption_expired"
    | "artifact_review_requested"
    | "artifact_review_feedback"
    | "artifact_approved";
  readonly title: string;
  readonly body: string;
  readonly targetType: "question" | "response" | "comment" | "review" | "decision" | "assumption" | "artifact" | "artifact_version";
  readonly targetId: string;
  readonly createdAt: string;
  readonly readAt?: string;
}

type NotificationDeliveryPreference = "immediate" | "digest" | "muted";

interface NotificationPreference {
  readonly channel: "email";
  readonly preference: NotificationDeliveryPreference;
  readonly updatedAt: string;
}

interface Decision {
  readonly id: string;
  readonly questionId?: string;
  readonly answer: string;
  readonly rationale: string;
  readonly category: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly ownerId: string;
  readonly status: "active" | "superseded" | "expired" | "revoked";
  readonly createdAt: string;
  readonly reviewAt: string;
  readonly lifecycleRationale?: string;
  readonly lifecycleChangedById?: string;
  readonly lifecycleChangedAt?: string;
  readonly replacementDecisionId?: string;
  readonly version: number;
}

interface DecisionLifecycleImpact {
  readonly artifactIds: readonly string[];
  readonly artifactVersionIds: readonly string[];
  readonly assumptionIds: readonly string[];
  readonly questionIds: readonly string[];
  readonly contextSnapshotIds: readonly string[];
  readonly runIds: readonly string[];
  readonly workItems: readonly string[];
  readonly branches: readonly string[];
  readonly repositories: readonly string[];
  readonly links: readonly { readonly sourceId: string; readonly type: string; readonly url: string; readonly depth: number }[];
  readonly nodes: readonly {
    readonly id: string;
    readonly type: "decision" | "question" | "artifact" | "artifact_version" | "assumption" | "context_snapshot" | "run";
    readonly label: string;
    readonly depth: number;
    readonly path: readonly string[];
    readonly status?: string;
  }[];
  readonly edges: readonly { readonly fromId: string; readonly toId: string; readonly relation: string }[];
  readonly maxDepthReached: number;
  readonly truncated: boolean;
}

interface DecisionConflict {
  readonly id: string;
  readonly category: string;
  readonly confidence: "high" | "medium";
  readonly scopeRelation: "exact" | "ancestor_descendant" | "partial";
  readonly overlappingFields: readonly string[];
  readonly signals: readonly string[];
  readonly left: Pick<Decision, "id" | "answer" | "rationale" | "scope" | "ownerId" | "createdAt" | "version">;
  readonly right: Pick<Decision, "id" | "answer" | "rationale" | "scope" | "ownerId" | "createdAt" | "version">;
  readonly advisory: true;
  readonly humanResolutionRequired: true;
}

interface Assumption {
  readonly id: string;
  readonly runId?: string;
  readonly statement: string;
  readonly rationale: string;
  readonly category: string;
  readonly risk: "low" | "medium" | "high" | "protected";
  readonly confidence: "low" | "medium" | "high";
  readonly reversible: boolean;
  readonly reversalCost: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly sourceLinks: readonly string[];
  readonly status: "active" | "confirmed" | "rejected" | "expired" | "superseded";
  readonly createdById: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly resolvedById?: string;
  readonly resolutionRationale?: string;
  readonly confirmedDecisionId?: string;
  readonly version: number;
}

interface AgentRun {
  readonly id: string;
  readonly agentId: string;
  readonly client: string;
  readonly capability: string;
  readonly continuationMode: "manual" | "automatic";
  readonly taskSummary: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly status: "running" | "waiting_for_human" | "completed" | "failed" | "cancelled";
  readonly contextSnapshotIds: readonly string[];
  readonly questionIds: readonly string[];
  readonly artifactVersionIds: readonly string[];
  readonly assumptionIds: readonly string[];
  readonly resultLinks: readonly string[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly endedAt?: string;
  readonly summary?: string;
  readonly continuesRunId?: string;
  readonly version: number;
}

type AgentClient = "codex" | "claude_code" | "cursor" | "copilot" | "custom" | "unknown";
type AnalyticsFilterKey = "client" | "startedFrom" | "startedTo";
type AnalyticsFilters = Partial<Record<AnalyticsFilterKey, string>>;

interface ProjectAnalytics {
  readonly projectId: string;
  readonly generatedAt: string;
  readonly cohort: {
    readonly runCount: number;
    readonly client?: AgentClient;
    readonly startedFrom?: string;
    readonly startedTo?: string;
  };
  readonly activity: {
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
  };
  readonly outcomes: {
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
  };
  readonly guardrails: {
    readonly questionsPerRun: number;
    readonly blockingQuestions: number;
    readonly unroutedBlockingQuestions: number;
    readonly contextItemsReturned: number;
    readonly contextItemsPerRetrieval: number;
  };
  readonly byClient: readonly {
    readonly client: AgentClient;
    readonly runCount: number;
    readonly contextRetrievals: number;
    readonly questionSubmissions: number;
    readonly questionsReused: number;
    readonly decisionsAccepted: number;
    readonly decisionReuseOccurrences: number;
    readonly assumptionsRecorded: number;
  }[];
  readonly privacy: {
    readonly derivedFrom: readonly string[];
    readonly excluded: readonly string[];
  };
}

interface ProjectSupport {
  readonly projectId: string;
  readonly generatedAt: string;
  readonly routing: {
    readonly unroutedQuestions: readonly {
      readonly id: string;
      readonly title: string;
      readonly category: string;
      readonly risk: Question["risk"];
      readonly blocking: boolean;
      readonly status: string;
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
      readonly status: string;
      readonly reviewAt: string;
    }[];
  };
  readonly assumptions: {
    readonly expiring: readonly {
      readonly id: string;
      readonly category: string;
      readonly risk: string;
      readonly confidence: string;
      readonly expiresAt: string;
      readonly overdue: boolean;
      readonly createdById: string;
      readonly runId?: string;
    }[];
  };
  readonly runs: {
    readonly blocked: readonly {
      readonly id: string;
      readonly client: string;
      readonly capability: string;
      readonly status: string;
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
      readonly type: string;
      readonly attempts: number;
      readonly createdAt: string;
      readonly availableAt: string;
      readonly hasError: boolean;
    }[];
  };
  readonly adapters: {
    readonly items: readonly {
      readonly client: string;
      readonly runCount: number;
      readonly capabilities: readonly string[];
      readonly lastObservedAt?: string;
      readonly lastSuccessfulMcpRunAt?: string;
    }[];
    readonly mcpDiagnostics: "observed_from_runs" | "observed_from_doctor" | "not_reported";
    readonly note: string;
  };
  readonly diagnostics: readonly {
    readonly client: string;
    readonly status: "pass" | "fail";
    readonly capabilities: readonly string[];
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

interface AuditRecord {
  readonly id: string;
  readonly scope: "organization" | "project";
  readonly correlationId: string;
  readonly organizationId: string;
  readonly projectId?: string;
  readonly actorId: string;
  readonly actorType: string;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly source?: "web" | "api" | "cli" | "mcp" | "application" | "worker" | "integration";
  readonly reason?: string;
  readonly policyVersion?: number;
  readonly policyRuleKey?: string;
  readonly assignmentId?: string;
  readonly ownerRouteSource?: string;
  readonly reviewerRouteSource?: string;
  readonly beforeVersion?: number;
  readonly afterVersion?: number;
  readonly createdAt: string;
}

interface AuditPage {
  readonly items: readonly AuditRecord[];
  readonly offset: number;
  readonly limit: number;
  readonly totalMatching: number;
  readonly nextOffset?: number;
}

type AuditFilterKey = "action" | "actorId" | "source" | "subjectType" | "subjectId" | "correlationId" | "createdFrom" | "createdTo";
type AuditFilters = Partial<Record<AuditFilterKey, string>>;

type View =
  | "inbox"
  | "questions"
  | "specifications"
  | "notifications"
  | "decisions"
  | "assumptions"
  | "runs"
  | "guide"
  | "repositories"
  | "ownership"
  | "policy"
  | "organization"
  | "analytics"
  | "audit"
  | "support";

interface NavigationItem {
  readonly view: View;
  readonly label: string;
  readonly icon: BridgeIconName;
  readonly access?: "project-admin" | "organization-admin";
}

const primaryNavigation: readonly NavigationItem[] = [
  { view: "inbox", label: "Inbox", icon: "inbox" },
  { view: "questions", label: "Questions", icon: "questions" },
  { view: "decisions", label: "Decisions", icon: "decisions" },
  { view: "specifications", label: "Specifications", icon: "specifications" },
  { view: "assumptions", label: "Assumptions", icon: "assumptions" },
  { view: "runs", label: "Agent runs", icon: "runs" },
  { view: "guide", label: "User guide", icon: "guide" },
];

const administrationNavigation: readonly NavigationItem[] = [
  { view: "repositories", label: "Repositories", icon: "repositories", access: "project-admin" },
  { view: "ownership", label: "Ownership", icon: "ownership", access: "project-admin" },
  { view: "policy", label: "Policy", icon: "policy", access: "project-admin" },
  { view: "organization", label: "Organization", icon: "organization", access: "organization-admin" },
  { view: "analytics", label: "Analytics", icon: "analytics" },
  { view: "audit", label: "Audit", icon: "audit", access: "project-admin" },
  { view: "support", label: "Support", icon: "support", access: "project-admin" },
];

function displayInitials(value: string | undefined): string {
  const parts = (value ?? "Bridge member").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "B";
}

function displayIdentityName(identifier: string, principals: readonly Principal[]): string {
  const principal = principals.find((candidate) => candidate.id === identifier);
  if (principal) return principal.displayName;
  const [prefix, ...parts] = identifier.split("_");
  const readable: readonly string[] = parts.length > 0 ? parts : [prefix ?? identifier];
  const name = readable.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
  return prefix === "agt" ? `${name} agent` : name;
}

async function bridgeFetch<T>(
  path: string,
  init?: RequestInit,
  actingPrincipalId = defaultPrincipalId,
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      "x-bridge-correlation-id": `web_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-bridge-principal-id": actingPrincipalId,
      ...init?.headers,
    },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String(body.message)
        : "Bridge request failed.";
    throw new Error(message);
  }
  return body as T;
}

async function bridgeDownload(
  path: string,
  body: unknown,
  actingPrincipalId: string,
): Promise<void> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-bridge-correlation-id": `web_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-bridge-principal-id": actingPrincipalId,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => undefined) as { readonly message?: string } | undefined;
    throw new Error(errorBody?.message ?? "Bridge export failed.");
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "bridge-audit-export";
  const href = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function currentVersion(artifact: Artifact | undefined): ArtifactVersion | undefined {
  return artifact?.versions.find((version) => version.id === artifact.currentVersionId);
}

function displayedArtifactStatus(version: ArtifactVersion | undefined): string {
  return version?.reviews.some((review) => review.status === "changes_requested")
    ? "changes_requested"
    : version?.status ?? "draft";
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function formatDuration(value: number | undefined): string {
  if (value === undefined) return "Not available";
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`;
  return `${(value / 60_000).toFixed(1)} min`;
}

function sameScope(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}

function roleList(value: string): readonly string[] {
  return [...new Set(value.split(",").map((role) => role.trim()).filter(Boolean))];
}

function normalizedRole(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function Home() {
  const requestedDecisionIdRef = useRef<string | undefined>(undefined);
  const [view, setView] = useState<View>("inbox");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [principals, setPrincipals] = useState<readonly Principal[]>([]);
  const [authentication, setAuthentication] = useState<AuthenticationConfiguration>();
  const [authenticationReady, setAuthenticationReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [activePrincipalId, setActivePrincipalId] = useState(defaultPrincipalId);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [questions, setQuestions] = useState<readonly Question[]>([]);
  const [inboxQuestions, setInboxQuestions] = useState<readonly Question[]>([]);
  const [questionDigests, setQuestionDigests] = useState<readonly QuestionDecisionDigest[]>([]);
  const [inboxFilters, setInboxFilters] = useState<InboxFilters>({});
  const [inboxFiltersReady, setInboxFiltersReady] = useState(false);
  const [decisionFilters, setDecisionFilters] = useState<DecisionFilters>({});
  const [decisionSearchDraft, setDecisionSearchDraft] = useState("");
  const [artifacts, setArtifacts] = useState<readonly Artifact[]>([]);
  const [notifications, setNotifications] = useState<readonly Notification[]>([]);
  const [notificationPreference, setNotificationPreference] = useState<NotificationDeliveryPreference>("immediate");
  const [decisions, setDecisions] = useState<readonly Decision[]>([]);
  const [decisionConflicts, setDecisionConflicts] = useState<readonly DecisionConflict[]>([]);
  const [assumptions, setAssumptions] = useState<readonly Assumption[]>([]);
  const [assumptionStatusFilter, setAssumptionStatusFilter] = useState<Assumption["status"] | "all">("all");
  const [runs, setRuns] = useState<readonly AgentRun[]>([]);
  const [repositories, setRepositories] = useState<readonly RepositoryRecord[]>([]);
  const [ownershipConfiguration, setOwnershipConfiguration] = useState<ProjectOwnershipConfiguration>();
  const [ownershipDraft, setOwnershipDraft] = useState<ProjectOwnershipConfiguration>();
  const [policyConfiguration, setPolicyConfiguration] = useState<ProjectPolicyConfiguration>();
  const [policyDraft, setPolicyDraft] = useState<ProjectPolicyConfiguration>();
  const [repositoryProvider, setRepositoryProvider] = useState("");
  const [repositoryOwner, setRepositoryOwner] = useState("");
  const [repositoryName, setRepositoryName] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [analytics, setAnalytics] = useState<ProjectAnalytics>();
  const [support, setSupport] = useState<ProjectSupport>();
  const [auditPage, setAuditPage] = useState<AuditPage>();
  const [auditScope, setAuditScope] = useState<"project" | "organization">("project");
  const [auditFilters, setAuditFilters] = useState<AuditFilters>({});
  const [organizationMembers, setOrganizationMembers] = useState<readonly OrganizationMember[]>([]);
  const [organizationProjects, setOrganizationProjects] = useState<readonly Project[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>();
  const [memberStatus, setMemberStatus] = useState<OrganizationMember["status"]>("active");
  const [memberRoles, setMemberRoles] = useState("");
  const [memberAllProjects, setMemberAllProjects] = useState(false);
  const [memberProjectRoles, setMemberProjectRoles] = useState<Record<string, string | undefined>>({});
  const [newMemberSubject, setNewMemberSubject] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberRoles, setNewMemberRoles] = useState("organization-member");
  const [newMemberAllProjects, setNewMemberAllProjects] = useState(false);
  const [newMemberProjectId, setNewMemberProjectId] = useState("");
  const [newMemberProjectRoles, setNewMemberProjectRoles] = useState("contributor");
  const [analyticsFilters, setAnalyticsFilters] = useState<AnalyticsFilters>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>();
  const [selectedDecisionId, setSelectedDecisionId] = useState<string>();
  const [selectedAssumptionId, setSelectedAssumptionId] = useState<string>();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [selectedOption, setSelectedOption] = useState<string>();
  const [questionAudienceRole, setQuestionAudienceRole] = useState("");
  const [questionAudienceView, setQuestionAudienceView] = useState<QuestionAudienceView>();
  const [questionAudienceLoading, setQuestionAudienceLoading] = useState(false);
  const [responseOption, setResponseOption] = useState<string>();
  const [responseAnswer, setResponseAnswer] = useState("");
  const [responseRationale, setResponseRationale] = useState("");
  const [responseMentionIds, setResponseMentionIds] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentMentionIds, setCommentMentionIds] = useState("");
  const [replyToCommentId, setReplyToCommentId] = useState<string>();
  const [editingResponseId, setEditingResponseId] = useState<string>();
  const [editResponseOption, setEditResponseOption] = useState<string>();
  const [editResponseAnswer, setEditResponseAnswer] = useState("");
  const [editResponseRationale, setEditResponseRationale] = useState("");
  const [editResponseMentionIds, setEditResponseMentionIds] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string>();
  const [editCommentBody, setEditCommentBody] = useState("");
  const [editCommentMentionIds, setEditCommentMentionIds] = useState("");
  const [clarificationReason, setClarificationReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [reviewStatus, setReviewStatus] = useState<"approved" | "rejected">("approved");
  const [reviewRationale, setReviewRationale] = useState("");
  const [overrideRationale, setOverrideRationale] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [rationale, setRationale] = useState(
    "Retry only transient failures with bounded exponential backoff and idempotency keys.",
  );
  const [approvalRationale, setApprovalRationale] = useState(
    "The specification accurately records the accepted approach and its operational constraints.",
  );
  const [artifactReviewStatus, setArtifactReviewStatus] = useState<"commented" | "changes_requested">("commented");
  const [artifactReviewBody, setArtifactReviewBody] = useState("");
  const [artifactDiffFromVersionId, setArtifactDiffFromVersionId] = useState("");
  const [artifactDiffToVersionId, setArtifactDiffToVersionId] = useState("");
  const [artifactDiff, setArtifactDiff] = useState<ArtifactVersionDiff>();
  const [artifactDiffLoading, setArtifactDiffLoading] = useState(false);
  const [decisionLifecycleStatus, setDecisionLifecycleStatus] = useState<"superseded" | "expired" | "revoked">("revoked");
  const [replacementDecisionId, setReplacementDecisionId] = useState("");
  const [decisionLifecycleRationale, setDecisionLifecycleRationale] = useState("");
  const [decisionLifecycleImpact, setDecisionLifecycleImpact] = useState<DecisionLifecycleImpact>();
  const [decisionImpactLoading, setDecisionImpactLoading] = useState(false);
  const [assumptionResolutionStatus, setAssumptionResolutionStatus] = useState<"confirmed" | "rejected" | "expired">("confirmed");
  const [assumptionResolutionRationale, setAssumptionResolutionRationale] = useState("");
  const [assumptionCreateDecision, setAssumptionCreateDecision] = useState(false);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [artifactsLoading, setArtifactsLoading] = useState(true);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationPreferenceLoading, setNotificationPreferenceLoading] = useState(false);
  const [notificationPreferenceSaving, setNotificationPreferenceSaving] = useState(false);
  const [referenceDataLoading, setReferenceDataLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [supportLoading, setSupportLoading] = useState(false);
  const [repositoriesLoading, setRepositoriesLoading] = useState(false);
  const [ownershipLoading, setOwnershipLoading] = useState(false);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditExporting, setAuditExporting] = useState(false);
  const [projectDataExporting, setProjectDataExporting] = useState(false);
  const [organizationMembersLoading, setOrganizationMembersLoading] = useState(false);
  const [memberSubmitting, setMemberSubmitting] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [principalsLoading, setPrincipalsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const activePrincipal = useMemo(
    () => principals.find((principal) => principal.id === activePrincipalId),
    [activePrincipalId, principals],
  );
  const activeRoles = useMemo(() => [...new Set([
    ...(activePrincipal?.roles ?? []),
    ...(selectedProjectId ? activePrincipal?.projectRoles?.[selectedProjectId] ?? [] : []),
  ])], [activePrincipal, selectedProjectId]);
  const isOrganizationAdmin = activePrincipal?.roles.some(
    (role) => normalizedRole(role) === "organization-admin",
  ) ?? false;
  const isProjectAdmin = isOrganizationAdmin ||
    activeRoles.some((role) => normalizedRole(role) === "project-admin");
  const selectedOrganizationMember = useMemo(
    () => organizationMembers.find((member) => member.id === selectedMemberId) ?? organizationMembers[0],
    [organizationMembers, selectedMemberId],
  );

  const loadAuthentication = useCallback(async () => {
    setAuthenticationReady(false);
    try {
      const configuration = await bridgeFetch<AuthenticationConfiguration>("/v1/auth/config");
      setAuthentication(configuration);
      if (configuration.mode === "development") {
        setSignedIn(true);
        return;
      }
      try {
        const principal = await bridgeFetch<Principal>("/v1/auth/me");
        setPrincipals([principal]);
        setActivePrincipalId(principal.id);
        setSignedIn(true);
      } catch {
        setSignedIn(false);
      }
    } catch (requestError) {
      setSignedIn(false);
      setError(requestError instanceof Error ? requestError.message : "Unable to load authentication configuration.");
    } finally {
      setAuthenticationReady(true);
    }
  }, []);

  const updateAnalyticsFilter = useCallback((key: AnalyticsFilterKey, value: string) => {
    setAnalyticsFilters((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }, []);

  const updateAuditFilter = useCallback((key: AuditFilterKey, value: string) => {
    setAuditFilters((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }, []);

  const inboxFilterOptions = useMemo(() => ({
    categories: [...new Set(questions.map((question) => question.category))].sort((left, right) => left.localeCompare(right)),
    roles: [...new Set(questions.flatMap((question) => [...question.ownerRoles, ...question.reviewerRoles]))]
      .sort((left, right) => left.localeCompare(right)),
  }), [questions]);
  const hasInboxFilters = Object.values(inboxFilters).some(Boolean);
  const hasDecisionFilters = Boolean(decisionFilters.includeHistory) ||
    Object.entries(decisionFilters).some(([key, value]) => key !== "includeHistory" && Boolean(value));

  const loadPrincipals = useCallback(async () => {
    setPrincipalsLoading(true);
    setError(undefined);
    try {
      const response = await bridgeFetch<{ items: readonly Principal[] }>(
        "/v1/principals",
        undefined,
        defaultPrincipalId,
      );
      setPrincipals(response.items);
      setActivePrincipalId((current) =>
        response.items.some((principal) => principal.id === current)
          ? current
          : response.items[0]?.id ?? defaultPrincipalId,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load local reviewers.");
    } finally {
      setPrincipalsLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    setError(undefined);
    try {
      const response = await bridgeFetch<{ items: readonly Project[] }>(
        "/v1/projects",
        undefined,
        activePrincipalId,
      );
      setProjects(response.items);
      setSelectedProjectId((current) =>
        current && response.items.some((project) => project.id === current)
          ? current
          : response.items[0]?.id,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load Bridge projects.");
    } finally {
      setProjectsLoading(false);
    }
  }, [activePrincipalId]);

  const loadRepositories = useCallback(async () => {
    if (!selectedProjectId) {
      setRepositories([]);
      setRepositoriesLoading(false);
      return;
    }
    setRepositoriesLoading(true);
    setError(undefined);
    try {
      const response = await bridgeFetch<{ items: readonly RepositoryRecord[] }>(
        `/v1/projects/${selectedProjectId}/repositories`,
        undefined,
        activePrincipalId,
      );
      setRepositories(response.items);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load project repositories.");
    } finally {
      setRepositoriesLoading(false);
    }
  }, [activePrincipalId, selectedProjectId]);

  const linkRepository = async () => {
    if (!selectedProjectId || !repositoryProvider.trim() || !repositoryOwner.trim() ||
      !repositoryName.trim() || !repositoryUrl.trim()) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(
        `/v1/projects/${selectedProjectId}/repositories`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: `web-repository-${crypto.randomUUID().replaceAll("-", "")}`,
            provider: repositoryProvider,
            owner: repositoryOwner,
            name: repositoryName,
            canonicalUrl: repositoryUrl,
          }),
        },
        activePrincipalId,
      );
      setRepositoryProvider("");
      setRepositoryOwner("");
      setRepositoryName("");
      setRepositoryUrl("");
      await loadRepositories();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to link project repository.");
    } finally {
      setSubmitting(false);
    }
  };

  const loadOwnership = useCallback(async () => {
    if (!selectedProjectId) {
      setOwnershipConfiguration(undefined);
      setOwnershipDraft(undefined);
      setOwnershipLoading(false);
      return;
    }
    setOwnershipLoading(true);
    setError(undefined);
    try {
      const configuration = await bridgeFetch<ProjectOwnershipConfiguration>(
        `/v1/admin/projects/${selectedProjectId}/ownership`,
        undefined,
        activePrincipalId,
      );
      setOwnershipConfiguration(configuration);
      setOwnershipDraft(configuration);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load project ownership configuration.");
    } finally {
      setOwnershipLoading(false);
    }
  }, [activePrincipalId, selectedProjectId]);

  const saveOwnership = async () => {
    if (!selectedProjectId || !ownershipConfiguration || !ownershipDraft) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const saved = await bridgeFetch<ProjectOwnershipConfiguration>(
        `/v1/admin/projects/${selectedProjectId}/ownership`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedVersion: ownershipConfiguration.version,
            roles: ownershipDraft.roles,
            teams: ownershipDraft.teams,
            rules: ownershipDraft.rules,
          }),
        },
        activePrincipalId,
      );
      setOwnershipConfiguration(saved);
      setOwnershipDraft(saved);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save project ownership configuration.");
    } finally {
      setSubmitting(false);
    }
  };

  const addOwnershipRole = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ownershipDraft) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("roleName") ?? "").trim();
    const description = String(form.get("roleDescription") ?? "").trim();
    if (!name || !description) return;
    setOwnershipDraft({ ...ownershipDraft, roles: [...ownershipDraft.roles, { name, description }] });
    event.currentTarget.reset();
  };

  const addOwnershipTeam = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ownershipDraft) return;
    const form = new FormData(event.currentTarget);
    const key = normalizedRole(String(form.get("teamKey") ?? ""));
    const name = String(form.get("teamName") ?? "").trim();
    const memberIds = roleList(String(form.get("teamMembers") ?? ""));
    if (!key || !name || memberIds.length === 0) return;
    setOwnershipDraft({ ...ownershipDraft, teams: [...ownershipDraft.teams, { key, name, memberIds }] });
    event.currentTarget.reset();
  };

  const addOwnershipRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ownershipDraft) return;
    const form = new FormData(event.currentTarget);
    const key = normalizedRole(String(form.get("ruleKey") ?? ""));
    const name = String(form.get("ruleName") ?? "").trim();
    const priority = Number(form.get("rulePriority"));
    const category = String(form.get("ruleCategory") ?? "").trim();
    const repository = String(form.get("ruleRepository") ?? "").trim();
    const component = String(form.get("ruleComponent") ?? "").trim();
    const owners: OwnershipRuleTarget = {
      principalIds: roleList(String(form.get("ownerPrincipalIds") ?? "")),
      roles: roleList(String(form.get("ownerRoles") ?? "")),
      teamKeys: roleList(String(form.get("ownerTeamKeys") ?? "")).map(normalizedRole),
    };
    const reviewers: OwnershipRuleTarget = {
      principalIds: roleList(String(form.get("reviewerPrincipalIds") ?? "")),
      roles: roleList(String(form.get("reviewerRoles") ?? "")),
      teamKeys: roleList(String(form.get("reviewerTeamKeys") ?? "")).map(normalizedRole),
    };
    const targetCount = [...owners.principalIds, ...owners.roles, ...owners.teamKeys,
      ...reviewers.principalIds, ...reviewers.roles, ...reviewers.teamKeys].length;
    if (!key || !name || !Number.isInteger(priority) || targetCount === 0) return;
    setOwnershipDraft({
      ...ownershipDraft,
      rules: [...ownershipDraft.rules, {
        key,
        name,
        priority,
        ...(category ? { category } : {}),
        ...(repository ? { repository } : {}),
        ...(component ? { component } : {}),
        owners,
        reviewers,
      }],
    });
    event.currentTarget.reset();
  };

  const loadPolicy = useCallback(async () => {
    if (!selectedProjectId) {
      setPolicyConfiguration(undefined);
      setPolicyDraft(undefined);
      setPolicyLoading(false);
      return;
    }
    setPolicyLoading(true);
    setError(undefined);
    try {
      const configuration = await bridgeFetch<ProjectPolicyConfiguration>(
        `/v1/admin/projects/${selectedProjectId}/policy`,
        undefined,
        activePrincipalId,
      );
      setPolicyConfiguration(configuration);
      setPolicyDraft(configuration);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load project policy configuration.");
    } finally {
      setPolicyLoading(false);
    }
  }, [activePrincipalId, selectedProjectId]);

  const savePolicy = async () => {
    if (!selectedProjectId || !policyConfiguration || !policyDraft) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const saved = await bridgeFetch<ProjectPolicyConfiguration>(
        `/v1/admin/projects/${selectedProjectId}/policy`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedVersion: policyConfiguration.version,
            rules: policyDraft.rules,
          }),
        },
        activePrincipalId,
      );
      setPolicyConfiguration(saved);
      setPolicyDraft(saved);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save project policy configuration.");
    } finally {
      setSubmitting(false);
    }
  };

  const addPolicyRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!policyDraft) return;
    const form = new FormData(event.currentTarget);
    const key = normalizedRole(String(form.get("policyKey") ?? ""));
    const name = String(form.get("policyName") ?? "").trim();
    const priority = Number(form.get("policyPriority"));
    const category = String(form.get("policyCategory") ?? "").trim();
    const scope = Object.fromEntries([
      ["repository", String(form.get("policyRepository") ?? "").trim()],
      ["component", String(form.get("policyComponent") ?? "").trim()],
      ["branch", String(form.get("policyBranch") ?? "").trim()],
      ["environment", String(form.get("policyEnvironment") ?? "").trim()],
      ["workItem", String(form.get("policyWorkItem") ?? "").trim()],
    ].filter((entry): entry is [string, string] => Boolean(entry[1])));
    const action = String(form.get("policyAction")) as PolicyAction;
    const minimumRisk = String(form.get("policyRisk")) as Risk;
    if (!key || !name || !Number.isInteger(priority) || !action || !minimumRisk) return;
    const reviewerQuorum = Object.fromEntries(
      roleList(String(form.get("policyReviewerQuorum") ?? ""))
        .map((entry) => entry.split("=", 2))
        .filter((entry): entry is [string, string] => entry.length === 2 && Number.isInteger(Number(entry[1])) && Number(entry[1]) >= 1)
        .map(([role, count]) => [normalizedRole(role), Number(count)]),
    );
    setPolicyDraft({
      ...policyDraft,
      rules: [...policyDraft.rules, {
        key,
        name,
        priority,
        ...(category ? { category } : {}),
        scope,
        action,
        minimumRisk,
        requiredOwnerRoles: roleList(String(form.get("policyOwnerRoles") ?? "")),
        requiredReviewerRoles: roleList(String(form.get("policyReviewerRoles") ?? "")),
        reviewerQuorum,
      }],
    });
    event.currentTarget.reset();
  };

  const loadQuestions = useCallback(async () => {
    if (!inboxFiltersReady) return;
    if (!selectedProjectId) {
      setQuestions([]);
      setInboxQuestions([]);
      setQuestionDigests([]);
      setQuestionsLoading(false);
      return;
    }
    setQuestionsLoading(true);
    setError(undefined);
    try {
      const inboxQuery = new URLSearchParams(
        Object.entries(inboxFilters).filter((entry): entry is [string, string] => Boolean(entry[1])),
      ).toString();
      const [questionsResponse, inboxResponse, digestResponse] = await Promise.all([
        bridgeFetch<{ items: readonly Question[] }>(
          `/v1/projects/${selectedProjectId}/questions`,
          undefined,
          activePrincipalId,
        ),
        bridgeFetch<{ items: readonly Question[] }>(
          `/v1/projects/${selectedProjectId}/inbox${inboxQuery ? `?${inboxQuery}` : ""}`,
          undefined,
          activePrincipalId,
        ),
        bridgeFetch<{ items: readonly QuestionDecisionDigest[] }>(
          `/v1/projects/${selectedProjectId}/question-digests`,
          undefined,
          activePrincipalId,
        ),
      ]);
      setQuestions(questionsResponse.items);
      setInboxQuestions(inboxResponse.items);
      setQuestionDigests(digestResponse.items);
      setSelectedId((current) =>
        current && questionsResponse.items.some((question) => question.id === current)
          ? current
          : questionsResponse.items[0]?.id,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load Bridge questions.");
    } finally {
      setQuestionsLoading(false);
    }
  }, [activePrincipalId, inboxFilters, inboxFiltersReady, selectedProjectId]);

  const loadArtifacts = useCallback(async () => {
    if (!selectedProjectId) {
      setArtifacts([]);
      setArtifactsLoading(false);
      return;
    }
    setArtifactsLoading(true);
    setError(undefined);
    try {
      const response = await bridgeFetch<{ items: readonly Artifact[] }>(
        `/v1/projects/${selectedProjectId}/artifacts`,
        undefined,
        activePrincipalId,
      );
      setArtifacts(response.items);
      setSelectedArtifactId((current) =>
        current && response.items.some((artifact) => artifact.id === current)
          ? current
          : response.items[0]?.id,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load specifications.");
    } finally {
      setArtifactsLoading(false);
    }
  }, [activePrincipalId, selectedProjectId]);

  const loadNotifications = useCallback(async () => {
    if (!selectedProjectId) {
      setNotifications([]);
      setNotificationsLoading(false);
      return;
    }
    setNotificationsLoading(true);
    setError(undefined);
    try {
      const response = await bridgeFetch<{ items: readonly Notification[] }>(
        `/v1/notifications?projectId=${encodeURIComponent(selectedProjectId)}`,
        undefined,
        activePrincipalId,
      );
      setNotifications(response.items);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load notifications.");
    } finally {
      setNotificationsLoading(false);
    }
  }, [activePrincipalId, selectedProjectId]);

  const loadNotificationPreference = useCallback(async () => {
    setNotificationPreferenceLoading(true);
    setError(undefined);
    try {
      const response = await bridgeFetch<{ items: readonly NotificationPreference[] }>(
        "/v1/notifications/preferences",
        undefined,
        activePrincipalId,
      );
      setNotificationPreference(
        response.items.find((item) => item.channel === "email")?.preference ?? "immediate",
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load notification preferences.");
    } finally {
      setNotificationPreferenceLoading(false);
    }
  }, [activePrincipalId]);

  const saveNotificationPreference = useCallback(async (preference: NotificationDeliveryPreference) => {
    setNotificationPreferenceSaving(true);
    setError(undefined);
    try {
      const saved = await bridgeFetch<NotificationPreference>(
        "/v1/notifications/preferences",
        {
          method: "POST",
          body: JSON.stringify({ channel: "email", preference }),
        },
        activePrincipalId,
      );
      setNotificationPreference(saved.preference);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save notification preferences.");
    } finally {
      setNotificationPreferenceSaving(false);
    }
  }, [activePrincipalId]);

  const loadReferenceData = useCallback(async () => {
    if (!selectedProjectId) {
      setDecisions([]);
      setDecisionConflicts([]);
      setAssumptions([]);
      setRuns([]);
      setReferenceDataLoading(false);
      return;
    }
    setReferenceDataLoading(true);
    setError(undefined);
    try {
      const decisionParameters = new URLSearchParams();
      if (decisionFilters.includeHistory) decisionParameters.set("includeHistory", "true");
      if (decisionFilters.search) decisionParameters.set("search", decisionFilters.search);
      if (decisionFilters.status) decisionParameters.set("status", decisionFilters.status);
      if (decisionFilters.category) decisionParameters.set("category", decisionFilters.category);
      if (decisionFilters.ownerId) decisionParameters.set("ownerId", decisionFilters.ownerId);
      if (decisionFilters.component) decisionParameters.set("component", decisionFilters.component);
      if (decisionFilters.createdFrom) decisionParameters.set("createdFrom", `${decisionFilters.createdFrom}T00:00:00.000Z`);
      if (decisionFilters.createdTo) decisionParameters.set("createdTo", `${decisionFilters.createdTo}T23:59:59.999Z`);
      const decisionQuery = decisionParameters.toString();
      const [decisionResponse, conflictResponse, assumptionResponse, runResponse] = await Promise.all([
        bridgeFetch<{ items: readonly Decision[] }>(
          `/v1/projects/${selectedProjectId}/decisions${decisionQuery ? `?${decisionQuery}` : ""}`,
          undefined,
          activePrincipalId,
        ),
        bridgeFetch<{ items: readonly DecisionConflict[] }>(
          `/v1/projects/${selectedProjectId}/decision-conflicts`,
          undefined,
          activePrincipalId,
        ),
        bridgeFetch<{ items: readonly Assumption[] }>(
          `/v1/projects/${selectedProjectId}/assumptions`,
          undefined,
          activePrincipalId,
        ),
        bridgeFetch<{ items: readonly AgentRun[] }>(
          `/v1/projects/${selectedProjectId}/runs`,
          undefined,
          activePrincipalId,
        ),
      ]);
      setDecisions(decisionResponse.items);
      setDecisionConflicts(conflictResponse.items);
      setAssumptions(assumptionResponse.items);
      setRuns(runResponse.items);
      setSelectedDecisionId((current) => {
        const requested = requestedDecisionIdRef.current;
        if (requested) {
          if (decisionResponse.items.some((decision) => decision.id === requested)) {
            requestedDecisionIdRef.current = undefined;
            return requested;
          }
          if (!decisionFilters.includeHistory) return requested;
          requestedDecisionIdRef.current = undefined;
        }
        return current && decisionResponse.items.some((decision) => decision.id === current)
          ? current
          : decisionResponse.items[0]?.id;
      });
      setSelectedAssumptionId((current) =>
        current && assumptionResponse.items.some((assumption) => assumption.id === current)
          ? current
          : assumptionResponse.items[0]?.id,
      );
      setSelectedRunId((current) =>
        current && runResponse.items.some((run) => run.id === current)
          ? current
          : runResponse.items[0]?.id,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load project records.");
    } finally {
      setReferenceDataLoading(false);
    }
  }, [activePrincipalId, decisionFilters, selectedProjectId]);

  const loadAnalytics = useCallback(async () => {
    if (!selectedProjectId) {
      setAnalytics(undefined);
      setAnalyticsLoading(false);
      return;
    }
    setAnalyticsLoading(true);
    setError(undefined);
    try {
      const parameters = new URLSearchParams();
      if (analyticsFilters.client) parameters.set("client", analyticsFilters.client);
      if (analyticsFilters.startedFrom) {
        parameters.set("startedFrom", `${analyticsFilters.startedFrom}T00:00:00.000Z`);
      }
      if (analyticsFilters.startedTo) {
        parameters.set("startedTo", `${analyticsFilters.startedTo}T23:59:59.999Z`);
      }
      const query = parameters.toString();
      setAnalytics(await bridgeFetch<ProjectAnalytics>(
        `/v1/admin/projects/${selectedProjectId}/analytics${query ? `?${query}` : ""}`,
        undefined,
        activePrincipalId,
      ));
    } catch (requestError) {
      setAnalytics(undefined);
      setError(requestError instanceof Error ? requestError.message : "Unable to load project analytics.");
    } finally {
      setAnalyticsLoading(false);
    }
  }, [activePrincipalId, analyticsFilters, selectedProjectId]);

  const loadSupport = useCallback(async () => {
    if (!selectedProjectId) {
      setSupport(undefined);
      setSupportLoading(false);
      return;
    }
    if (!isProjectAdmin && !isOrganizationAdmin) {
      setSupport(undefined);
      setSupportLoading(false);
      return;
    }
    setSupportLoading(true);
    setError(undefined);
    try {
      setSupport(await bridgeFetch<ProjectSupport>(
        `/v1/admin/projects/${selectedProjectId}/support`,
        undefined,
        activePrincipalId,
      ));
    } catch (requestError) {
      setSupport(undefined);
      setError(requestError instanceof Error ? requestError.message : "Unable to load pilot support signals.");
    } finally {
      setSupportLoading(false);
    }
  }, [activePrincipalId, isOrganizationAdmin, isProjectAdmin, selectedProjectId]);

  const auditParameters = useCallback((offset?: number): URLSearchParams => {
    const parameters = new URLSearchParams();
    for (const key of ["action", "actorId", "source", "subjectType", "subjectId", "correlationId"] as const) {
      if (auditFilters[key]) parameters.set(key, auditFilters[key]);
    }
    if (auditFilters.createdFrom) parameters.set("createdFrom", `${auditFilters.createdFrom}T00:00:00.000Z`);
    if (auditFilters.createdTo) parameters.set("createdTo", `${auditFilters.createdTo}T23:59:59.999Z`);
    if (offset !== undefined) parameters.set("offset", String(offset));
    parameters.set("limit", "50");
    return parameters;
  }, [auditFilters]);

  const loadAudit = useCallback(async (offset = 0) => {
    if ((auditScope === "organization" && !isOrganizationAdmin) || (auditScope === "project" && !isProjectAdmin)) {
      setAuditPage(undefined);
      return;
    }
    if (auditScope === "project" && !selectedProjectId) {
      setAuditPage(undefined);
      return;
    }
    setAuditLoading(true);
    setError(undefined);
    try {
      const path = auditScope === "organization"
        ? "/v1/admin/organization/audit"
        : `/v1/admin/projects/${selectedProjectId}/audit`;
      setAuditPage(await bridgeFetch<AuditPage>(
        `${path}?${auditParameters(offset).toString()}`,
        undefined,
        activePrincipalId,
      ));
    } catch (requestError) {
      setAuditPage(undefined);
      setError(requestError instanceof Error ? requestError.message : "Unable to load audit events.");
    } finally {
      setAuditLoading(false);
    }
  }, [activePrincipalId, auditParameters, auditScope, isOrganizationAdmin, isProjectAdmin, selectedProjectId]);

  const exportAudit = useCallback(async (format: "json" | "csv") => {
    if (auditScope === "project" && !selectedProjectId) return;
    setAuditExporting(true);
    setError(undefined);
    try {
      const filterBody: Record<string, string | number> = { format, maxItems: 1_000 };
      for (const key of ["action", "actorId", "source", "subjectType", "subjectId", "correlationId"] as const) {
        if (auditFilters[key]) filterBody[key] = auditFilters[key];
      }
      if (auditFilters.createdFrom) filterBody.createdFrom = `${auditFilters.createdFrom}T00:00:00.000Z`;
      if (auditFilters.createdTo) filterBody.createdTo = `${auditFilters.createdTo}T23:59:59.999Z`;
      const path = auditScope === "organization"
        ? "/v1/admin/organization/audit/export"
        : `/v1/admin/projects/${selectedProjectId}/audit/export`;
      await bridgeDownload(path, filterBody, activePrincipalId);
      await loadAudit(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to export audit events.");
    } finally {
      setAuditExporting(false);
    }
  }, [activePrincipalId, auditFilters, auditScope, loadAudit, selectedProjectId]);

  const exportProjectData = useCallback(async () => {
    if (!selectedProjectId) return;
    setProjectDataExporting(true);
    setError(undefined);
    try {
      await bridgeDownload(
        `/v1/admin/projects/${selectedProjectId}/export`,
        {},
        activePrincipalId,
      );
      await loadAudit(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to export project data.");
    } finally {
      setProjectDataExporting(false);
    }
  }, [activePrincipalId, loadAudit, selectedProjectId]);

  const loadOrganizationMembers = useCallback(async () => {
    if (!isOrganizationAdmin) {
      setOrganizationMembers([]);
      setOrganizationProjects([]);
      setOrganizationMembersLoading(false);
      return;
    }
    setOrganizationMembersLoading(true);
    setError(undefined);
    try {
      const response = await bridgeFetch<{
        items: readonly OrganizationMember[];
        projects: readonly Project[];
      }>("/v1/admin/organization/members", undefined, activePrincipalId);
      setOrganizationMembers(response.items);
      setOrganizationProjects(response.projects);
      setSelectedMemberId((current) =>
        current && response.items.some((member) => member.id === current)
          ? current
          : response.items[0]?.id,
      );
    } catch (requestError) {
      setOrganizationMembers([]);
      setOrganizationProjects([]);
      setError(requestError instanceof Error ? requestError.message : "Unable to load organization members.");
    } finally {
      setOrganizationMembersLoading(false);
    }
  }, [activePrincipalId, isOrganizationAdmin]);

  const createOrganizationMember = useCallback(async () => {
    setMemberSubmitting(true);
    setError(undefined);
    try {
      const registration = await bridgeFetch<{ member: OrganizationMember }>(
        "/v1/admin/organization/members",
        {
          method: "POST",
          body: JSON.stringify({
            oidcSubject: newMemberSubject,
            displayName: newMemberName,
            roles: roleList(newMemberRoles),
            allProjects: newMemberAllProjects,
            projectMemberships: newMemberProjectId
              ? [{ projectId: newMemberProjectId, roles: roleList(newMemberProjectRoles) }]
              : [],
          }),
        },
        activePrincipalId,
      );
      setNewMemberSubject("");
      setNewMemberName("");
      setNewMemberRoles("organization-member");
      setNewMemberAllProjects(false);
      setNewMemberProjectId("");
      setNewMemberProjectRoles("contributor");
      await loadOrganizationMembers();
      setSelectedMemberId(registration.member.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to create organization member.");
    } finally {
      setMemberSubmitting(false);
    }
  }, [
    activePrincipalId,
    loadOrganizationMembers,
    newMemberAllProjects,
    newMemberName,
    newMemberProjectId,
    newMemberProjectRoles,
    newMemberRoles,
    newMemberSubject,
  ]);

  const updateOrganizationMember = useCallback(async () => {
    if (!selectedOrganizationMember) return;
    setMemberSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch<OrganizationMember>(
        `/v1/admin/organization/members/${selectedOrganizationMember.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            expectedVersion: selectedOrganizationMember.version,
            status: memberStatus,
            roles: roleList(memberRoles),
            allProjects: memberAllProjects,
            projectMemberships: Object.entries(memberProjectRoles)
              .filter((entry): entry is [string, string] => entry[1] !== undefined)
              .map(([projectId, roles]) => ({ projectId, roles: roleList(roles) })),
          }),
        },
        activePrincipalId,
      );
      await loadOrganizationMembers();
      setSelectedMemberId(selectedOrganizationMember.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to update organization member.");
    } finally {
      setMemberSubmitting(false);
    }
  }, [
    activePrincipalId,
    loadOrganizationMembers,
    memberAllProjects,
    memberProjectRoles,
    memberRoles,
    memberStatus,
    selectedOrganizationMember,
  ]);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const requestedView = parameters.get("view");
    if (["inbox", "questions", "specifications", "notifications", "decisions", "assumptions", "runs", "guide", "repositories", "ownership", "policy", "organization", "analytics", "audit", "support"].includes(requestedView ?? "")) {
      setView(requestedView as View);
    }
    const projectId = parameters.get("projectId");
    const questionId = parameters.get("questionId");
    const artifactId = parameters.get("artifactId");
    const decisionId = parameters.get("decisionId");
    const assumptionId = parameters.get("assumptionId");
    const runId = parameters.get("runId");
    if (projectId) setSelectedProjectId(projectId);
    if (questionId) setSelectedId(questionId);
    if (artifactId) setSelectedArtifactId(artifactId);
    if (decisionId) {
      requestedDecisionIdRef.current = decisionId;
      setSelectedDecisionId(decisionId);
      setDecisionFilters((current) => ({ ...current, includeHistory: true }));
    }
    if (assumptionId) setSelectedAssumptionId(assumptionId);
    if (runId) setSelectedRunId(runId);
    const restoredInboxFilters = Object.fromEntries([
      ["status", parameters.get("inboxStatus")],
      ["risk", parameters.get("inboxRisk")],
      ["category", parameters.get("inboxCategory")],
      ["role", parameters.get("inboxRole")],
      ["due", parameters.get("inboxDue")],
    ].filter((entry): entry is [InboxFilterKey, string] => Boolean(entry[1])));
    setInboxFilters(restoredInboxFilters);
    setInboxFiltersReady(true);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  useEffect(() => {
    if (!inboxFiltersReady) return;
    const url = new URL(window.location.href);
    const parameterNames: Record<InboxFilterKey, string> = {
      status: "inboxStatus",
      risk: "inboxRisk",
      category: "inboxCategory",
      role: "inboxRole",
      due: "inboxDue",
    };
    for (const [key, parameterName] of Object.entries(parameterNames) as [InboxFilterKey, string][]) {
      const value = inboxFilters[key];
      if (value) url.searchParams.set(parameterName, value);
      else url.searchParams.delete(parameterName);
    }
    window.history.replaceState(window.history.state, "", url);
  }, [inboxFilters, inboxFiltersReady]);

  useEffect(() => {
    void loadAuthentication();
  }, [loadAuthentication]);

  useEffect(() => {
    if (authenticationReady && signedIn) void loadPrincipals();
  }, [authenticationReady, loadPrincipals, signedIn]);

  useEffect(() => {
    if (authenticationReady && signedIn) void loadProjects();
  }, [authenticationReady, loadProjects, signedIn]);

  useEffect(() => {
    if (!authenticationReady || !signedIn) return;
    void loadQuestions();
    void loadArtifacts();
    void loadNotifications();
    void loadReferenceData();
  }, [authenticationReady, loadArtifacts, loadNotifications, loadQuestions, loadReferenceData, signedIn]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "notifications") void loadNotificationPreference();
  }, [authenticationReady, loadNotificationPreference, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "analytics") void loadAnalytics();
  }, [authenticationReady, loadAnalytics, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "support") void loadSupport();
  }, [authenticationReady, loadSupport, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "repositories") void loadRepositories();
  }, [authenticationReady, loadRepositories, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "ownership") void loadOwnership();
  }, [authenticationReady, loadOwnership, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "policy") void loadPolicy();
  }, [authenticationReady, loadPolicy, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "audit") void loadAudit(0);
  }, [authenticationReady, loadAudit, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "organization") void loadOrganizationMembers();
  }, [authenticationReady, loadOrganizationMembers, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "organization" && !isOrganizationAdmin) {
      setError(undefined);
      setView("inbox");
    }
  }, [authenticationReady, isOrganizationAdmin, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "audit" && !principalsLoading && !isOrganizationAdmin && !isProjectAdmin) {
      setError(undefined);
      setView("inbox");
    }
  }, [authenticationReady, isOrganizationAdmin, isProjectAdmin, principalsLoading, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "support" && !principalsLoading && !isOrganizationAdmin && !isProjectAdmin) {
      setError(undefined);
      setView("inbox");
    }
  }, [authenticationReady, isOrganizationAdmin, isProjectAdmin, principalsLoading, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "repositories" && !principalsLoading && !isOrganizationAdmin && !isProjectAdmin) {
      setError(undefined);
      setView("inbox");
    }
  }, [authenticationReady, isOrganizationAdmin, isProjectAdmin, principalsLoading, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "ownership" && !principalsLoading && !isOrganizationAdmin && !isProjectAdmin) {
      setError(undefined);
      setView("inbox");
    }
  }, [authenticationReady, isOrganizationAdmin, isProjectAdmin, principalsLoading, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "policy" && !principalsLoading && !isOrganizationAdmin && !isProjectAdmin) {
      setError(undefined);
      setView("inbox");
    }
  }, [authenticationReady, isOrganizationAdmin, isProjectAdmin, principalsLoading, signedIn, view]);

  useEffect(() => {
    if (!isOrganizationAdmin && auditScope === "organization") setAuditScope("project");
    if (!isProjectAdmin && isOrganizationAdmin && auditScope === "project") setAuditScope("organization");
  }, [auditScope, isOrganizationAdmin, isProjectAdmin]);

  const markNotificationRead = useCallback(async (notificationId: string) => {
    const updated = await bridgeFetch<Notification>(`/v1/notifications/${notificationId}/read`, {
      method: "POST",
    }, activePrincipalId);
    setNotifications((current) => current.map((notification) =>
      notification.id === updated.id ? updated : notification,
    ));
    return updated;
  }, [activePrincipalId]);

  const markAllNotificationsRead = useCallback(async () => {
    await bridgeFetch<{ markedCount: number }>("/v1/notifications/read-all", {
      method: "POST",
      body: JSON.stringify({ projectId: selectedProjectId }),
    }, activePrincipalId);
    await loadNotifications();
  }, [activePrincipalId, loadNotifications, selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  const visibleQuestions = view === "inbox" ? inboxQuestions : questions;
  const selectedQuestion = useMemo(
    () => visibleQuestions.find((question) => question.id === selectedId) ?? visibleQuestions[0],
    [selectedId, visibleQuestions],
  );
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId),
    [artifacts, selectedArtifactId],
  );
  const selectedArtifactVersion = currentVersion(selectedArtifact);
  const selectedArtifactReviewerIds = selectedArtifactVersion?.reviewerAssignment?.reviewerIds ??
    selectedArtifact?.reviewerIds ?? [];
  const canReviewSelectedArtifact = Boolean(
    selectedArtifact && activePrincipal &&
    (selectedArtifactReviewerIds.includes(activePrincipalId) || activeRoles.includes("project-admin")),
  );
  const selectedArtifactHasChangesRequested = Boolean(
    selectedArtifactVersion?.reviews.some((review) => review.status === "changes_requested"),
  );
  const activePrincipalApprovedSelectedArtifact = Boolean(
    selectedArtifactVersion?.approvalStatus.reviewerIds.includes(activePrincipalId),
  );
  const selectedDecision = useMemo(
    () => decisions.find((decision) => decision.id === selectedDecisionId) ?? decisions[0],
    [decisions, selectedDecisionId],
  );
  const selectedDecisionConflicts = useMemo(
    () => selectedDecision
      ? decisionConflicts.filter((conflict) =>
          conflict.left.id === selectedDecision.id || conflict.right.id === selectedDecision.id)
      : [],
    [decisionConflicts, selectedDecision],
  );
  const visibleAssumptions = useMemo(
    () => assumptionStatusFilter === "all"
      ? assumptions
      : assumptions.filter((assumption) => assumption.status === assumptionStatusFilter),
    [assumptionStatusFilter, assumptions],
  );
  const selectedAssumption = useMemo(
    () => visibleAssumptions.find((assumption) => assumption.id === selectedAssumptionId) ?? visibleAssumptions[0],
    [selectedAssumptionId, visibleAssumptions],
  );
  const canResolveSelectedAssumption = Boolean(
    selectedAssumption &&
    (selectedProject?.decisionOwnerIds.includes(activePrincipalId) || isProjectAdmin),
  );
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0],
    [runs, selectedRunId],
  );
  const viewTitle: Record<View, string> = {
    inbox: "Inbox",
    questions: "Questions",
    specifications: "Specifications",
    notifications: "Notifications",
    decisions: "Decisions",
    assumptions: "Assumptions",
    runs: "Agent Runs",
    guide: "User Guide",
    repositories: "Repositories",
    ownership: "Ownership",
    policy: "Policy",
    organization: "Organization",
    analytics: "Analytics",
    audit: "Audit",
    support: "Support",
  };

  useEffect(() => {
    if (selectedQuestion) {
      setSelectedOption(selectedQuestion.recommendationKey ?? selectedQuestion.options[0]?.key);
      setResponseOption(undefined);
      setResponseAnswer("");
      setResponseRationale("");
      setResponseMentionIds("");
      setCommentBody("");
      setCommentMentionIds("");
      setReplyToCommentId(undefined);
      setEditingResponseId(undefined);
      setEditResponseOption(undefined);
      setEditResponseAnswer("");
      setEditResponseRationale("");
      setEditResponseMentionIds("");
      setEditingCommentId(undefined);
      setEditCommentBody("");
      setEditCommentMentionIds("");
      setClarificationReason("");
      setReopenReason("");
      setReviewStatus("approved");
      setReviewRationale("");
      setOverrideRationale("");
      setOverrideReason("");
      setQuestionAudienceRole(
        activeRoles.find((role) => !["organization-member", "organization-admin"].includes(normalizedRole(role))) ??
          activeRoles[0] ??
          "project contributor",
      );
      setQuestionAudienceView(undefined);
    }
  }, [activeRoles, selectedQuestion]);

  useEffect(() => {
    setDecisionLifecycleStatus("revoked");
    setReplacementDecisionId("");
    setDecisionLifecycleRationale("");
    setDecisionLifecycleImpact(undefined);
  }, [selectedDecision?.id]);

  useEffect(() => {
    setArtifactReviewStatus("commented");
    setArtifactReviewBody("");
  }, [selectedArtifactVersion?.id]);

  useEffect(() => {
    if (!selectedOrganizationMember) return;
    setMemberStatus(selectedOrganizationMember.status);
    setMemberRoles(selectedOrganizationMember.roles.join(", "));
    setMemberAllProjects(selectedOrganizationMember.allProjects);
    setMemberProjectRoles(Object.fromEntries(
      selectedOrganizationMember.projectMemberships
        .filter((membership) => membership.status === "active")
        .map((membership) => [membership.projectId, membership.roles.join(", ")]),
    ));
  }, [selectedOrganizationMember]);

  useEffect(() => {
    const versions = selectedArtifact?.versions ?? [];
    const toVersion = versions.at(-1);
    const fromVersion = versions.at(-2) ?? toVersion;
    setArtifactDiffFromVersionId(fromVersion?.id ?? "");
    setArtifactDiffToVersionId(toVersion?.id ?? "");
    setArtifactDiff(undefined);
  }, [activePrincipalId, selectedArtifact?.currentVersionId, selectedArtifact?.id, selectedArtifact?.versions.length]);

  const loadQuestionAudienceView = async (mode: "explain" | "rewrite") => {
    if (!selectedQuestion || questionAudienceRole.trim().length < 2) return;
    setQuestionAudienceLoading(true);
    setError(undefined);
    try {
      const parameters = new URLSearchParams({ role: questionAudienceRole.trim(), mode });
      setQuestionAudienceView(await bridgeFetch<QuestionAudienceView>(
        `/v1/questions/${selectedQuestion.id}/audience-view?${parameters.toString()}`,
        undefined,
        activePrincipalId,
      ));
    } catch (requestError) {
      setQuestionAudienceView(undefined);
      setError(requestError instanceof Error ? requestError.message : "Unable to explain this question for the selected role.");
    } finally {
      setQuestionAudienceLoading(false);
    }
  };

  const proposeAnswer = async () => {
    if (!selectedQuestion || responseAnswer.trim().length < 2 || responseRationale.trim().length < 2) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(`/v1/questions/${selectedQuestion.id}/responses`, {
        method: "POST",
        body: JSON.stringify({
          answer: responseAnswer,
          rationale: responseRationale,
          ...(responseOption ? { optionKey: responseOption } : {}),
          mentionedPrincipalIds: roleList(responseMentionIds),
        }),
      }, activePrincipalId);
      setResponseAnswer("");
      setResponseRationale("");
      setResponseOption(undefined);
      setResponseMentionIds("");
      await Promise.all([loadQuestions(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to add your response.");
    } finally {
      setSubmitting(false);
    }
  };

  const beginResponseEdit = (response: QuestionResponse) => {
    setEditingResponseId(response.id);
    setEditResponseOption(response.optionKey);
    setEditResponseAnswer(response.answer);
    setEditResponseRationale(response.rationale);
    setEditResponseMentionIds((response.mentionedPrincipalIds ?? []).join(", "));
  };

  const saveResponseEdit = async () => {
    if (
      !selectedQuestion ||
      !editingResponseId ||
      editResponseAnswer.trim().length < 2 ||
      editResponseRationale.trim().length < 2
    ) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(`/v1/questions/${selectedQuestion.id}/responses/${editingResponseId}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: selectedQuestion.version,
          answer: editResponseAnswer,
          rationale: editResponseRationale,
          ...(editResponseOption ? { optionKey: editResponseOption } : {}),
          mentionedPrincipalIds: roleList(editResponseMentionIds),
        }),
      }, activePrincipalId);
      setEditingResponseId(undefined);
      await Promise.all([loadQuestions(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to edit the proposed answer.");
    } finally {
      setSubmitting(false);
    }
  };

  const reviewQuestion = async () => {
    if (!selectedQuestion || selectedQuestion.risk !== "protected" || reviewRationale.trim().length < 10) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(`/v1/questions/${selectedQuestion.id}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: selectedQuestion.version,
          status: reviewStatus,
          rationale: reviewRationale,
        }),
      }, activePrincipalId);
      setReviewRationale("");
      await Promise.all([loadQuestions(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to record security review.");
    } finally {
      setSubmitting(false);
    }
  };

  const overrideQuestionApproval = async () => {
    if (
      !selectedQuestion ||
      !selectedQuestion.canOverrideApproval ||
      overrideRationale.trim().length < 10 ||
      overrideReason.trim().length < 10
    ) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(`/v1/questions/${selectedQuestion.id}/override`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: selectedQuestion.version,
          ...(selectedOption ? { optionKey: selectedOption } : {}),
          rationale: overrideRationale,
          reason: overrideReason,
        }),
      }, activePrincipalId);
      setOverrideRationale("");
      setOverrideReason("");
      await Promise.all([loadQuestions(), loadNotifications(), loadReferenceData()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to record the administrative override.");
    } finally {
      setSubmitting(false);
    }
  };

  const reassignQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedQuestion) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const reason = String(form.get("assignmentReason") ?? "").trim();
    if (reason.length < 10) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(`/v1/questions/${selectedQuestion.id}/assignments`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: selectedQuestion.version,
          ownerIds: roleList(String(form.get("assignmentOwnerIds") ?? "")),
          ownerRoles: roleList(String(form.get("assignmentOwnerRoles") ?? "")),
          reviewerIds: roleList(String(form.get("assignmentReviewerIds") ?? "")),
          reviewerRoles: roleList(String(form.get("assignmentReviewerRoles") ?? "")),
          reason,
        }),
      }, activePrincipalId);
      formElement.reset();
      await Promise.all([loadQuestions(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to reassign the question.");
    } finally {
      setSubmitting(false);
    }
  };

  const addQuestionComment = async () => {
    if (!selectedQuestion || commentBody.trim().length < 2) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(`/v1/questions/${selectedQuestion.id}/comments`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: selectedQuestion.version,
          body: commentBody,
          ...(replyToCommentId ? { parentCommentId: replyToCommentId } : {}),
          mentionedPrincipalIds: roleList(commentMentionIds),
        }),
      }, activePrincipalId);
      setCommentBody("");
      setCommentMentionIds("");
      setReplyToCommentId(undefined);
      await Promise.all([loadQuestions(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to add clarification comment.");
    } finally {
      setSubmitting(false);
    }
  };

  const beginCommentEdit = (comment: QuestionComment) => {
    setEditingCommentId(comment.id);
    setEditCommentBody(comment.body);
    setEditCommentMentionIds((comment.mentionedPrincipalIds ?? []).join(", "));
  };

  const saveCommentEdit = async () => {
    if (!selectedQuestion || !editingCommentId || editCommentBody.trim().length < 2) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(`/v1/questions/${selectedQuestion.id}/comments/${editingCommentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: selectedQuestion.version,
          body: editCommentBody,
          mentionedPrincipalIds: roleList(editCommentMentionIds),
        }),
      }, activePrincipalId);
      setEditingCommentId(undefined);
      await Promise.all([loadQuestions(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to edit the clarification comment.");
    } finally {
      setSubmitting(false);
    }
  };

  const requestQuestionClarification = async () => {
    if (!selectedQuestion || !selectedQuestion.canRequestClarification || clarificationReason.trim().length < 10) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(`/v1/questions/${selectedQuestion.id}/clarification`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: selectedQuestion.version, reason: clarificationReason }),
      }, activePrincipalId);
      setClarificationReason("");
      await Promise.all([loadQuestions(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to request clarification.");
    } finally {
      setSubmitting(false);
    }
  };

  const reopenQuestion = async () => {
    if (!selectedQuestion || !selectedQuestion.canReopen || reopenReason.trim().length < 10) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(`/v1/questions/${selectedQuestion.id}/reopen`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: selectedQuestion.version, reason: reopenReason }),
      }, activePrincipalId);
      setReopenReason("");
      await Promise.all([loadQuestions(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to reopen the question discussion.");
    } finally {
      setSubmitting(false);
    }
  };

  const acceptDecision = async () => {
    if (!selectedQuestion || !selectedOption || rationale.trim().length < 10) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(`/v1/questions/${selectedQuestion.id}/accept`, {
        method: "POST",
        body: JSON.stringify({ optionKey: selectedOption, rationale }),
      }, activePrincipalId);
      await Promise.all([loadQuestions(), loadNotifications(), loadReferenceData()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to accept decision.");
    } finally {
      setSubmitting(false);
    }
  };

  const approveSpecification = async () => {
    if (!selectedArtifactVersion || approvalRationale.trim().length < 10) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(`/v1/artifact-versions/${selectedArtifactVersion.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ rationale: approvalRationale }),
      }, activePrincipalId);
      setApprovalRationale("");
      await Promise.all([loadArtifacts(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to approve specification.");
    } finally {
      setSubmitting(false);
    }
  };

  const reviewSpecification = async () => {
    if (
      !selectedArtifactVersion ||
      !canReviewSelectedArtifact ||
      artifactReviewBody.trim().length < (artifactReviewStatus === "changes_requested" ? 10 : 2)
    ) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch(`/v1/artifact-versions/${selectedArtifactVersion.id}/reviews`, {
        method: "POST",
        body: JSON.stringify({ status: artifactReviewStatus, body: artifactReviewBody }),
      }, activePrincipalId);
      setArtifactReviewStatus("commented");
      setArtifactReviewBody("");
      await Promise.all([loadArtifacts(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to record specification feedback.");
    } finally {
      setSubmitting(false);
    }
  };

  const loadArtifactDiff = async () => {
    if (
      !selectedArtifact ||
      !artifactDiffFromVersionId ||
      !artifactDiffToVersionId ||
      artifactDiffFromVersionId === artifactDiffToVersionId
    ) return;
    setArtifactDiffLoading(true);
    setError(undefined);
    try {
      const parameters = new URLSearchParams({
        fromVersionId: artifactDiffFromVersionId,
        toVersionId: artifactDiffToVersionId,
      });
      const result = await bridgeFetch<ArtifactVersionDiff>(
        `/v1/artifacts/${selectedArtifact.id}/diff?${parameters.toString()}`,
        undefined,
        activePrincipalId,
      );
      setArtifactDiff(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to compare specification versions.");
    } finally {
      setArtifactDiffLoading(false);
    }
  };

  const changeDecisionLifecycle = async () => {
    if (
      !selectedDecision ||
      selectedDecision.status !== "active" ||
      decisionLifecycleRationale.trim().length < 10 ||
      (decisionLifecycleStatus === "superseded" && !replacementDecisionId)
    ) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await bridgeFetch<{ decision: Decision; impact: DecisionLifecycleImpact }>(
        `/v1/decisions/${selectedDecision.id}/${decisionLifecycleStatus === "superseded" ? "supersede" : decisionLifecycleStatus === "expired" ? "expire" : "revoke"}`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedVersion: selectedDecision.version,
            rationale: decisionLifecycleRationale,
            ...(decisionLifecycleStatus === "superseded" ? { replacementDecisionId } : {}),
          }),
        },
        activePrincipalId,
      );
      setDecisionLifecycleImpact(response.impact);
      await Promise.all([loadReferenceData(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to change the decision lifecycle.");
    } finally {
      setSubmitting(false);
    }
  };

  const loadDecisionImpact = async () => {
    if (!selectedDecision) return;
    setDecisionImpactLoading(true);
    setError(undefined);
    try {
      setDecisionLifecycleImpact(await bridgeFetch<DecisionLifecycleImpact>(
        `/v1/decisions/${selectedDecision.id}/impact`,
        undefined,
        activePrincipalId,
      ));
    } catch (requestError) {
      setDecisionLifecycleImpact(undefined);
      setError(requestError instanceof Error ? requestError.message : "Unable to analyze decision impact.");
    } finally {
      setDecisionImpactLoading(false);
    }
  };

  const resolveAssumption = async () => {
    if (
      !selectedAssumption ||
      selectedAssumption.status !== "active" ||
      assumptionResolutionRationale.trim().length < 10 ||
      (assumptionResolutionStatus !== "confirmed" && assumptionCreateDecision)
    ) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await bridgeFetch<Assumption>(`/v1/assumptions/${selectedAssumption.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: selectedAssumption.version,
          status: assumptionResolutionStatus,
          rationale: assumptionResolutionRationale,
          ...(assumptionResolutionStatus === "confirmed" && assumptionCreateDecision
            ? { createDecision: true }
            : {}),
        }),
      }, activePrincipalId);
      setAssumptionResolutionRationale("");
      setAssumptionCreateDecision(false);
      await Promise.all([loadReferenceData(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to resolve the assumption.");
    } finally {
      setSubmitting(false);
    }
  };

  const updateInboxFilter = (key: InboxFilterKey, value: string) => {
    setInboxFilters((current) => ({
      ...current,
      ...(value ? { [key]: value } : { [key]: undefined }),
    }));
  };

  const updateDecisionFilter = (key: DecisionFilterKey, value: string) => {
    setDecisionFilters((current) => ({
      ...current,
      ...(value ? { [key]: value } : { [key]: undefined }),
    }));
  };

  const pendingQuestions = inboxQuestions.length;
  const pendingSpecifications = artifacts.filter((artifact) =>
    ["draft", "in_review"].includes(currentVersion(artifact)?.status ?? ""),
  ).length;
  const pendingNotifications = notifications.filter((notification) => !notification.readAt).length;
  const navigationCounts: Partial<Record<View, number>> = {
    inbox: pendingQuestions,
    specifications: pendingSpecifications,
  };
  const visibleAdministrationNavigation = administrationNavigation.filter((item) => {
    if (item.access === "organization-admin") return isOrganizationAdmin;
    if (item.access === "project-admin") return isOrganizationAdmin || isProjectAdmin;
    return true;
  });
  const isAdministrationView = visibleAdministrationNavigation.some((item) => item.view === view);
  const navigateTo = (destination: View) => {
    setView(destination);
    if (!administrationNavigation.some((item) => item.view === destination) || window.matchMedia("(max-width: 640px)").matches) {
      setSettingsOpen(false);
    }
  };

  const openNotification = async (notification: Notification) => {
    setError(undefined);
    try {
      await markNotificationRead(notification.id);
      if (notification.targetType === "decision") {
        setView("decisions");
        requestedDecisionIdRef.current = notification.targetId;
        setDecisionSearchDraft("");
        setDecisionFilters({ includeHistory: true });
        setSelectedDecisionId(notification.targetId);
      } else if (notification.targetType === "assumption") {
        setView("assumptions");
        setAssumptionStatusFilter("all");
        setSelectedAssumptionId(notification.targetId);
      } else if (notification.targetType === "artifact" || notification.targetType === "artifact_version") {
        setView("specifications");
        const artifact = notification.targetType === "artifact"
          ? artifacts.find((candidate) => candidate.id === notification.targetId)
          : artifacts.find((candidate) => candidate.versions.some((version) => version.id === notification.targetId));
        if (artifact) setSelectedArtifactId(artifact.id);
      } else {
        setView("questions");
        const question = notification.targetType === "question"
          ? questions.find((candidate) => candidate.id === notification.targetId)
          : questions.find((candidate) =>
            candidate.responses.some((response) => response.id === notification.targetId) ||
            candidate.comments.some((comment) => comment.id === notification.targetId) ||
            candidate.reviews.some((review) => review.id === notification.targetId) ||
            candidate.decisionId === notification.targetId,
          );
        if (question) setSelectedId(question.id);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to open notification.");
    }
  };

  if (!authenticationReady) {
    return <main className="auth-shell"><div className="auth-card">Loading Bridge…</div></main>;
  }

  if (authentication?.mode === "oidc" && !signedIn) {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-labelledby="bridge-sign-in-title">
          <div className="auth-mark" aria-hidden="true">B</div>
          <small>Shared decisions and specifications</small>
          <h1 id="bridge-sign-in-title">Sign in to Bridge</h1>
          <p>Your identity provider verifies you. Bridge then applies active organization and project memberships on every request.</p>
          {error ? <div className="error" role="alert">{error}</div> : null}
          <a className="auth-action" href={authentication.loginUrl}>Continue with SSO</a>
          <small>Access is denied when your Bridge organization membership is missing or disabled.</small>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><BridgeIcon name="bridge" size={19} /></span>
          <span className="brand-wordmark"><strong>Bridge</strong><small>Decision control plane</small></span>
        </div>
        <div className="project">
          <label htmlFor="bridge-project"><BridgeIcon name="repositories" size={15} /><small>Current project</small></label>
          <select
            id="bridge-project"
            value={selectedProjectId ?? ""}
            disabled={projectsLoading || projects.length === 0}
            onChange={(event) => setSelectedProjectId(event.target.value)}
          >
            {projects.length === 0 ? <option value="">No projects</option> : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>
        <nav aria-label="Bridge navigation">
          <span className="nav-label">Workspace</span>
          <div className="nav-group nav-primary">
            {primaryNavigation.map((item) => (
              <button
                key={item.view}
                type="button"
                aria-label={
                  navigationCounts[item.view] !== undefined
                    ? `${item.label}, ${navigationCounts[item.view]} pending`
                    : item.label
                }
                aria-current={view === item.view ? "page" : undefined}
                onClick={() => navigateTo(item.view)}
              >
                <BridgeIcon name={item.icon} />
                <span className="nav-copy">{item.label}</span>
                {navigationCounts[item.view] !== undefined ? <span className="nav-badge">{navigationCounts[item.view]}</span> : null}
              </button>
            ))}
          </div>

          <details
            className="nav-settings"
            open={settingsOpen}
            onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
          >
            <summary aria-label="Admin and settings">
              <BridgeIcon name="settings" />
              <span className="nav-copy">Admin & settings</span>
              <BridgeIcon name="chevron" size={15} className="nav-chevron" />
            </summary>
            <div className="nav-group nav-group-admin">
              {visibleAdministrationNavigation.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  aria-label={item.label}
                  aria-current={view === item.view ? "page" : undefined}
                  onClick={() => navigateTo(item.view)}
                >
                  <BridgeIcon name={item.icon} />
                  <span className="nav-copy">{item.label}</span>
                </button>
              ))}
            </div>
          </details>
        </nav>
        <div className="identity">
          <div className="identity-summary">
            <span className="avatar">{displayInitials(activePrincipal?.displayName)}</span>
            <span><strong>{activePrincipal?.displayName ?? "Bridge member"}</strong><small>{authentication?.mode === "oidc" ? "Authenticated member" : "Development identity"}</small></span>
          </div>
          {authentication?.mode === "development" ? (
            <div className="reviewer">
              <label htmlFor="bridge-reviewer"><small>Preview authority as</small></label>
              <select
                id="bridge-reviewer"
                value={activePrincipalId}
                disabled={principalsLoading || principals.length === 0}
                onChange={(event) => setActivePrincipalId(event.target.value)}
              >
                {principals.length === 0 ? <option value="">No reviewers</option> : null}
                {principals.map((principal) => (
                  <option key={principal.id} value={principal.id}>{principal.displayName}</option>
                ))}
              </select>
              <small title={activeRoles.join(" · ")}>{activeRoles.length} active role{activeRoles.length === 1 ? "" : "s"}</small>
            </div>
          ) : null}
          {authentication?.mode === "oidc" && authentication.logoutUrl ? (
            <a href={authentication.logoutUrl}>Sign out</a>
          ) : null}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <small>{isAdministrationView ? "Administration" : "Workspace"}</small>
            <strong>{viewTitle[view]}</strong>
          </div>
          <div className="topbar-actions">
            <span className="topbar-project"><BridgeIcon name="bridge" size={15} />{view === "guide"
              ? "Connect a project with CLI or REST"
              : view === "organization"
                ? "Member access and roles"
              : view === "support"
                ? "Pilot health and operator signals"
              : view === "audit" && auditScope === "organization"
                ? "Organization metadata events"
                : selectedProject?.name ?? "Select a project"}</span>
            <button
              className="topbar-icon-button"
              type="button"
              aria-label={`Notifications${pendingNotifications > 0 ? `, ${pendingNotifications} unread` : ""}`}
              aria-current={view === "notifications" ? "page" : undefined}
              onClick={() => navigateTo("notifications")}
            >
              <BridgeIcon name="bell" size={19} />
              {pendingNotifications > 0 ? <span>{pendingNotifications}</span> : null}
            </button>
            <span className="topbar-avatar" title={activePrincipal?.displayName}>{displayInitials(activePrincipal?.displayName)}</span>
          </div>
        </header>
        <div className="content">
          {error ? <div className="error" role="alert">{error}</div> : null}

          {view === "guide" ? (
            <UserGuide />
          ) : view === "support" ? (
            <>
              <div className="title-row">
                <div>
                  <h1>Pilot support signals</h1>
                  <p>Operator-only project health derived from routing, decision review, durable delivery, and recorded agent runs.</p>
                </div>
                <button className="secondary" type="button" disabled={supportLoading} onClick={() => void loadSupport()}>Refresh</button>
              </div>
              {supportLoading ? <div className="empty">Loading project support signals…</div> : null}
              {!supportLoading && !support ? <div className="empty">Select a project to load support signals.</div> : null}
              {!supportLoading && support ? (
                <div className="support-stack">
                  <div className="analytics-grid" aria-label="Support summary">
                    <article className="analytics-card">
                      <strong>{support.routing.unroutedQuestions.length}</strong>
                      <span>unrouted active questions</span>
                    </article>
                    <article className="analytics-card">
                      <strong>{support.decisions.overdueProtected.length}</strong>
                      <span>overdue protected decisions</span>
                    </article>
                    <article className="analytics-card">
                      <strong>{support.assumptions.expiring.length}</strong>
                      <span>assumptions expiring within seven days</span>
                    </article>
                    <article className="analytics-card">
                      <strong>{support.runs.blocked.length}</strong>
                      <span>runs waiting for human input</span>
                    </article>
                    <article className="analytics-card">
                      <strong>{support.delivery.deadLetterEvents.length}</strong>
                      <span>dead-letter jobs · {support.delivery.failedCount} failed total</span>
                    </article>
                    <article className="analytics-card">
                      <strong>{support.adapters.items.length}</strong>
                      <span>observed agent clients</span>
                    </article>
                  </div>

                  <section className="analytics-panel support-panel">
                    <div className="analytics-panel-heading">
                      <div><h2>Unresolved routing</h2><p>Questions without a direct owner or role assignment remain visible for administrator action.</p></div>
                      <small>{support.routing.unroutedQuestions.length} items</small>
                    </div>
                    {support.routing.unroutedQuestions.length === 0 ? <div className="empty">No active questions are currently unrouted.</div> : (
                      <div className="support-list">
                        {support.routing.unroutedQuestions.map((question) => (
                          <button
                            type="button"
                            key={question.id}
                            className="support-row"
                            onClick={() => {
                              setSelectedId(question.id);
                              setView("questions");
                            }}
                          >
                            <span className={`risk risk-${question.risk}`} aria-hidden="true" />
                            <span><strong>{question.title}</strong><small>{question.category} · {question.status.replaceAll("_", " ")} · {question.blocking ? "blocking" : "non-blocking"}</small></span>
                            <span className={`status status-${question.risk}`}>{question.risk}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="analytics-panel support-panel">
                    <div className="analytics-panel-heading">
                      <div><h2>Overdue protected decisions</h2><p>Protected decisions past their review date need an explicit human lifecycle decision.</p></div>
                      <small>{support.decisions.overdueProtected.length} items</small>
                    </div>
                    {support.decisions.overdueProtected.length === 0 ? <div className="empty">No protected decisions are overdue.</div> : (
                      <div className="support-list">
                        {support.decisions.overdueProtected.map((decision) => (
                          <button
                            type="button"
                            key={decision.id}
                            className="support-row"
                            onClick={() => {
                              setSelectedDecisionId(decision.id);
                              setDecisionFilters((current) => ({ ...current, includeHistory: true }));
                              setView("decisions");
                            }}
                          >
                            <span className="risk risk-protected" aria-hidden="true" />
                            <span><strong>{decision.category} decision</strong><small>Owner {displayIdentityName(decision.ownerId, principals)} · review due {new Date(decision.reviewAt).toLocaleDateString()}</small></span>
                            <span className="status status-rejected">overdue</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="analytics-panel support-panel">
                    <div className="analytics-panel-heading">
                      <div><h2>Assumptions nearing expiry</h2><p>Active assumptions due within seven days are listed without exposing their governed statement; overdue items may indicate a delayed maintenance cycle.</p></div>
                      <small>{support.assumptions.expiring.length} items</small>
                    </div>
                    {support.assumptions.expiring.length === 0 ? <div className="empty">No active assumptions are due within seven days.</div> : (
                      <div className="support-list">
                        {support.assumptions.expiring.map((assumption) => (
                          <button
                            type="button"
                            key={assumption.id}
                            className="support-row"
                            onClick={() => {
                              setSelectedAssumptionId(assumption.id);
                              setAssumptionStatusFilter("all");
                              setView("assumptions");
                            }}
                          >
                            <span className={assumption.overdue ? "risk risk-protected" : "risk"} aria-hidden="true" />
                            <span><strong>{assumption.category} assumption</strong><small>{assumption.overdue ? "overdue" : `expires ${new Date(assumption.expiresAt).toLocaleDateString()}`} · {assumption.confidence} confidence · created by {displayIdentityName(assumption.createdById, principals)}</small></span>
                            <span className={assumption.overdue ? "status status-rejected" : "status"}>{assumption.overdue ? "overdue" : "expiring"}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="analytics-panel support-panel">
                    <div className="analytics-panel-heading">
                      <div><h2>Runs waiting for human input</h2><p>These runs remain blocked until their linked questions are resolved; open a run to inspect its governed handoff.</p></div>
                      <small>{support.runs.blocked.length} items</small>
                    </div>
                    {support.runs.blocked.length === 0 ? <div className="empty">No runs are currently waiting for human input.</div> : (
                      <div className="support-list">
                        {support.runs.blocked.map((run) => (
                          <button
                            type="button"
                            key={run.id}
                            className="support-row"
                            onClick={() => {
                              setSelectedRunId(run.id);
                              setView("runs");
                            }}
                          >
                            <span className="risk" aria-hidden="true" />
                            <span><strong>Agent run</strong><small title={run.id}>{run.client.replaceAll("_", " ")} · {run.capability.replaceAll("_", " ")} · {run.remainingBlockingQuestionCount} blocking question{run.remainingBlockingQuestionCount === 1 ? "" : "s"} · updated {new Date(run.updatedAt).toLocaleDateString()}</small></span>
                            <span className="status">waiting</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="analytics-panel support-panel">
                    <div className="analytics-panel-heading">
                      <div><h2>Delivery operations</h2><p>Dead letters contain only operational identifiers here; inspect and replay through the existing project-admin outbox controls.</p></div>
                      <small>{support.delivery.pendingCount} pending or processing</small>
                    </div>
                    {support.delivery.deadLetterEvents.length === 0 ? <div className="empty">No dead-letter jobs are currently recorded.</div> : (
                      <div className="analytics-table-wrap">
                        <table className="analytics-table support-table">
                          <thead><tr><th>Event</th><th>Type</th><th>Attempts</th><th>Created</th><th>Error</th></tr></thead>
                          <tbody>{support.delivery.deadLetterEvents.map((event) => (
                            <tr key={event.id}>
                              <td><code>{event.id}</code></td>
                              <td>{event.type}</td>
                              <td>{event.attempts}</td>
                              <td>{new Date(event.createdAt).toLocaleString()}</td>
                              <td>{event.hasError ? "Recorded" : "None"}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section className="analytics-panel support-panel">
                    <div className="analytics-panel-heading">
                      <div><h2>Agent adapter observations</h2><p>{support.adapters.note}</p></div>
                      <small>{support.adapters.mcpDiagnostics === "observed_from_runs" ? "MCP observed from runs" : support.adapters.mcpDiagnostics === "observed_from_doctor" ? "Doctor reported" : "MCP not reported"}</small>
                    </div>
                    {support.adapters.items.length === 0 ? <div className="empty">No agent runs have reported adapter capability yet.</div> : (
                      <div className="analytics-table-wrap">
                        <table className="analytics-table support-table">
                          <thead><tr><th>Client</th><th>Capabilities</th><th>Runs</th><th>Last observed</th><th>Last completed MCP run</th></tr></thead>
                          <tbody>{support.adapters.items.map((adapter) => (
                            <tr key={adapter.client}>
                              <td><strong>{adapter.client.replaceAll("_", " ")}</strong></td>
                              <td>{adapter.capabilities.join(", ")}</td>
                              <td>{adapter.runCount}</td>
                              <td>{adapter.lastObservedAt ? new Date(adapter.lastObservedAt).toLocaleString() : "Not available"}</td>
                              <td>{adapter.lastSuccessfulMcpRunAt ? new Date(adapter.lastSuccessfulMcpRunAt).toLocaleString() : "Not observed"}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                    <p className="support-note">Run metadata is derived from agent runs; repository-specific checks are recorded separately by <code>bridge doctor</code>.</p>
                  </section>

                  <section className="analytics-panel support-panel">
                    <div className="analytics-panel-heading">
                      <div><h2>Repository diagnostics</h2><p>Latest bounded <code>bridge doctor</code> results are stored per adapter. Review the health summary and failed check names here; Bridge never stores URLs, errors, or repository content.</p></div>
                      <small>{support.diagnostics.filter((diagnostic) => diagnostic.status === "pass").length} of {support.diagnostics.length} healthy</small>
                    </div>
                    {support.diagnostics.length === 0 ? <div className="empty">No bridge doctor reports are recorded.</div> : (
                      <div className="support-diagnostic-grid" aria-label="Repository diagnostics by adapter">
                        {support.diagnostics.map((diagnostic) => (
                          <article className={`support-diagnostic-card support-diagnostic-card-${diagnostic.status}`} key={diagnostic.client}>
                            <div className="support-diagnostic-heading">
                              <div className="support-diagnostic-title">
                                <span className="support-diagnostic-kicker">Adapter</span>
                                <h3>{diagnostic.client.replaceAll("_", " ")}</h3>
                              </div>
                              <span className={diagnostic.status === "pass" ? "status status-approved" : "status status-rejected"}>
                                {diagnostic.status === "pass" ? "healthy" : "needs attention"}
                              </span>
                            </div>
                            <dl className="support-diagnostic-meta">
                              <div><dt>MCP</dt><dd>{diagnostic.mcpStatus.replaceAll("_", " ")}</dd></div>
                              <div><dt>Checks</dt><dd>{diagnostic.passedCheckCount} / {diagnostic.checkCount} passing</dd></div>
                              <div><dt>Observed</dt><dd><time dateTime={diagnostic.observedAt}>{new Date(diagnostic.observedAt).toLocaleString()}</time></dd></div>
                            </dl>
                            <div className={`support-diagnostic-checks ${diagnostic.failingCheckNames.length > 0 ? "is-failing" : "is-passing"}`}>
                              {diagnostic.failingCheckNames.length > 0 ? (
                                <>
                                  <strong>Needs attention</strong>
                                  <ul className="support-diagnostic-check-list">
                                    {diagnostic.failingCheckNames.map((name) => <li key={name}>{name.replaceAll("-", " ")}</li>)}
                                  </ul>
                                </>
                              ) : (
                                <>
                                  <strong>All recorded checks passed</strong>
                                  <span>{diagnostic.checkCount} check{diagnostic.checkCount === 1 ? "" : "s"} verified</span>
                                </>
                              )}
                            </div>
                            <p className="support-diagnostic-capabilities">
                              <span>Capabilities</span>
                              {diagnostic.capabilities.map((capability) => capability.replaceAll("_", " ")).join(", ") || "No capabilities reported"}
                            </p>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}
            </>
          ) : view === "repositories" ? (
            <>
              <div className="title-row">
                <div>
                  <h1>Project repositories</h1>
                  <p>Manage repository metadata for this project. Bridge stores the canonical link and does not fetch repository source.</p>
                </div>
                <button className="secondary" type="button" disabled={repositoriesLoading} onClick={() => void loadRepositories()}>Refresh</button>
              </div>
              <details className="panel-disclosure">
                <summary><span><strong>Link a repository</strong><small>Add canonical metadata without fetching source.</small></span><em>Administrator action</em></summary>
                <form
                  className="panel-disclosure-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void linkRepository();
                  }}
                >
                  <div className="member-form-grid">
                    <label>Provider<input value={repositoryProvider} onChange={(event) => setRepositoryProvider(event.target.value)} placeholder="github" required /></label>
                    <label>Owner<input value={repositoryOwner} onChange={(event) => setRepositoryOwner(event.target.value)} placeholder="bridge-org" required /></label>
                    <label>Repository name<input value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} placeholder="bridge" required /></label>
                    <label>Canonical URL<input type="url" value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/bridge-org/bridge" required /></label>
                  </div>
                  <div className="member-form-actions">
                    <small>Provider connectivity and source synchronization remain outside this metadata-only workflow.</small>
                    <button className="primary" type="submit" disabled={submitting || !selectedProjectId}>Link repository</button>
                  </div>
                </form>
              </details>
              <section className="organization-panel">
                <div className="organization-panel-heading">
                  <div><h2>Linked repositories</h2><p>Repository identity is unique within the organization and provider scope.</p></div>
                  <small>{repositories.length} linked</small>
                </div>
                {repositoriesLoading ? <div className="empty">Loading project repositories…</div> : null}
                {!repositoriesLoading && repositories.length === 0 ? <div className="empty">No repositories are linked to this project.</div> : null}
                {!repositoriesLoading && repositories.length > 0 ? (
                  <div className="analytics-table-wrap">
                    <table className="analytics-table">
                      <thead><tr><th>Provider</th><th>Repository</th><th>Canonical URL</th><th>Linked</th></tr></thead>
                      <tbody>{repositories.map((repository) => (
                        <tr key={repository.id}>
                          <td><strong>{repository.provider}</strong></td>
                          <td>{repository.owner}/{repository.name}</td>
                          <td><a href={repository.canonicalUrl} target="_blank" rel="noreferrer">{repository.canonicalUrl}</a></td>
                          <td>{new Date(repository.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            </>
          ) : view === "ownership" ? (
            <>
              <div className="title-row">
                <div>
                  <h1>Project ownership</h1>
                  <p>Define project roles, human teams, and explainable owner/reviewer rules. Changes are saved as one versioned configuration.</p>
                </div>
                <div className="member-form-actions">
                  <button className="secondary" type="button" disabled={ownershipLoading} onClick={() => void loadOwnership()}>Refresh</button>
                  <button
                    className="primary"
                    type="button"
                    disabled={submitting || !ownershipConfiguration || !ownershipDraft || JSON.stringify(ownershipConfiguration) === JSON.stringify(ownershipDraft)}
                    onClick={() => void saveOwnership()}
                  >Save configuration</button>
                </div>
              </div>
              {ownershipLoading ? <div className="empty">Loading project ownership…</div> : null}
              {!ownershipLoading && ownershipDraft ? (
                <div className="organization-stack">
                  <section className="organization-panel">
                    <div className="organization-panel-heading">
                      <div><h2>Role definitions</h2><p>Role names are normalized when saved. Member assignment remains in Organization access.</p></div>
                      <small>{ownershipDraft.roles.length} roles</small>
                    </div>
                    <details className="inline-create-disclosure">
                      <summary>Add role definition</summary>
                      <form className="member-form-grid" onSubmit={addOwnershipRole}>
                        <label>Role name<input name="roleName" placeholder="QA Lead" required minLength={2} /></label>
                        <label>Description<input name="roleDescription" placeholder="Owns quality and release-readiness decisions" required minLength={2} /></label>
                        <div className="member-form-actions"><span /><button className="secondary" type="submit">Add role</button></div>
                      </form>
                    </details>
                    {ownershipDraft.roles.length === 0 ? <div className="empty">No custom project roles are defined.</div> : (
                      <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Role</th><th>Description</th><th /></tr></thead><tbody>
                        {ownershipDraft.roles.map((role) => <tr key={role.name}><td><strong>{role.name}</strong></td><td>{role.description}</td><td><button className="secondary" type="button" onClick={() => setOwnershipDraft({ ...ownershipDraft, roles: ownershipDraft.roles.filter((candidate) => candidate !== role) })}>Remove</button></td></tr>)}
                      </tbody></table></div>
                    )}
                  </section>

                  <section className="organization-panel">
                    <div className="organization-panel-heading">
                      <div><h2>Human teams</h2><p>Teams contain active human members with access to this project; agents cannot satisfy human ownership.</p></div>
                      <small>{ownershipDraft.teams.length} teams</small>
                    </div>
                    <details className="inline-create-disclosure">
                      <summary>Add human team</summary>
                      <form className="member-form-grid" onSubmit={addOwnershipTeam}>
                        <label>Team key<input name="teamKey" placeholder="quality" required pattern="[a-z0-9][a-z0-9-]*" /></label>
                        <label>Team name<input name="teamName" placeholder="Quality" required /></label>
                        <label>Member IDs<input name="teamMembers" placeholder="usr_qa_lead, usr_architect" required /></label>
                        <div className="member-form-actions"><small>Available humans: {principals.map((principal) => principal.id).join(", ") || "none"}</small><button className="secondary" type="submit">Add team</button></div>
                      </form>
                    </details>
                    {ownershipDraft.teams.length === 0 ? <div className="empty">No project teams are configured.</div> : (
                      <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Team</th><th>Members</th><th /></tr></thead><tbody>
                        {ownershipDraft.teams.map((team) => <tr key={team.key}><td><strong>{team.name}</strong><small>{team.key}</small></td><td>{team.memberIds.join(", ")}</td><td><button className="secondary" type="button" onClick={() => setOwnershipDraft({ ...ownershipDraft, teams: ownershipDraft.teams.filter((candidate) => candidate !== team) })}>Remove</button></td></tr>)}
                      </tbody></table></div>
                    )}
                  </section>

                  <section className="organization-panel">
                    <div className="organization-panel-heading">
                      <div><h2>Ownership rules</h2><p>An empty match applies project-wide. Equal-priority overlapping owner or reviewer rules are rejected.</p></div>
                      <small>{ownershipDraft.rules.length} rules</small>
                    </div>
                    <details className="inline-create-disclosure">
                      <summary>Add ownership rule</summary>
                    <form className="member-form-grid" onSubmit={addOwnershipRule}>
                      <label>Rule key<input name="ruleKey" placeholder="transfer-quality" required pattern="[a-z0-9][a-z0-9-]*" /></label>
                      <label>Rule name<input name="ruleName" placeholder="Transfer quality ownership" required /></label>
                      <label>Priority<input name="rulePriority" type="number" min={1} max={1000} defaultValue={100} required /></label>
                      <label>Category<input name="ruleCategory" placeholder="quality" /></label>
                      <label>Repository<input name="ruleRepository" placeholder="payments-api" /></label>
                      <label>Component<input name="ruleComponent" placeholder="transfers" /></label>
                      <label>Owner member IDs<input name="ownerPrincipalIds" placeholder="usr_architect" /></label>
                      <label>Owner roles<input name="ownerRoles" placeholder="qa-lead" /></label>
                      <label>Owner team keys<input name="ownerTeamKeys" placeholder="quality" /></label>
                      <label>Reviewer member IDs<input name="reviewerPrincipalIds" placeholder="usr_security_reviewer" /></label>
                      <label>Reviewer roles<input name="reviewerRoles" placeholder="architecture-reviewer" /></label>
                      <label>Reviewer team keys<input name="reviewerTeamKeys" placeholder="architecture" /></label>
                      <div className="member-form-actions"><small>Use comma-separated values. Configure at least one owner or reviewer target.</small><button className="secondary" type="submit">Add rule</button></div>
                    </form>
                    </details>
                    {ownershipDraft.rules.length === 0 ? <div className="empty">No ownership rules are configured; project defaults remain unchanged.</div> : (
                      <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Rule</th><th>Match</th><th>Owners</th><th>Reviewers</th><th /></tr></thead><tbody>
                        {ownershipDraft.rules.map((rule) => <tr key={rule.key}>
                          <td><strong>{rule.name}</strong><small>Priority {rule.priority} · {rule.key}</small></td>
                          <td>{[rule.category && `category ${rule.category}`, rule.repository && `repository ${rule.repository}`, rule.component && `component ${rule.component}`].filter(Boolean).join(" · ") || "Project-wide"}</td>
                          <td>{[...rule.owners.principalIds, ...rule.owners.roles, ...rule.owners.teamKeys.map((key) => `team:${key}`)].join(", ") || "None"}</td>
                          <td>{[...rule.reviewers.principalIds, ...rule.reviewers.roles, ...rule.reviewers.teamKeys.map((key) => `team:${key}`)].join(", ") || "None"}</td>
                          <td><button className="secondary" type="button" onClick={() => setOwnershipDraft({ ...ownershipDraft, rules: ownershipDraft.rules.filter((candidate) => candidate !== rule) })}>Remove</button></td>
                        </tr>)}
                      </tbody></table></div>
                    )}
                  </section>
                  <div className="member-form-actions">
                    <small>Version {ownershipConfiguration?.version ?? 0}{ownershipConfiguration?.updatedAt ? ` · last saved ${new Date(ownershipConfiguration.updatedAt).toLocaleString()}` : " · not saved yet"}</small>
                    <button
                      className="primary"
                      type="button"
                      disabled={submitting || !ownershipConfiguration || JSON.stringify(ownershipConfiguration) === JSON.stringify(ownershipDraft)}
                      onClick={() => void saveOwnership()}
                    >Save configuration</button>
                  </div>
                </div>
              ) : null}
            </>
          ) : view === "policy" ? (
            <>
              <div className="title-row">
                <div>
                  <h1>Project policy</h1>
                  <p>Configure limited category/scope rules for risk, interruption, ownership, and protected review. Bridge safety floors cannot be weakened.</p>
                </div>
                <div className="member-form-actions">
                  <button className="secondary" type="button" disabled={policyLoading} onClick={() => void loadPolicy()}>Refresh</button>
                  <button
                    className="primary"
                    type="button"
                    disabled={submitting || !policyConfiguration || !policyDraft || JSON.stringify(policyConfiguration) === JSON.stringify(policyDraft)}
                    onClick={() => void savePolicy()}
                  >Save policy</button>
                </div>
              </div>
              {policyLoading ? <div className="empty">Loading project policy…</div> : null}
              {!policyLoading && policyDraft ? (
                <div className="organization-stack">
                  <section className="organization-panel">
                    <div className="organization-panel-heading">
                      <div><h2>Pilot safety floors</h2><p>These protected categories always block and retain their required human authority. Custom rules may only add stricter requirements.</p></div>
                      <small>{policyDraft.defaultRules.length} defaults</small>
                    </div>
                    <div className="policy-floor-summary" aria-label="Pilot safety floor summary">
                      <div><strong>{policyDraft.defaultRules.length}</strong><span>enforced categories</span></div>
                      <div><strong>{new Set(policyDraft.defaultRules.flatMap((rule) => rule.requiredOwnerRoles)).size}</strong><span>accountable owner roles</span></div>
                      <div><strong>{new Set(policyDraft.defaultRules.flatMap((rule) => rule.requiredReviewerRoles)).size}</strong><span>required reviewer roles</span></div>
                    </div>
                    <details className="inline-table-disclosure">
                      <summary>View every enforced floor <span>{policyDraft.defaultRules.length}</span></summary>
                    <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Category</th><th>Action</th><th>Owners</th><th>Reviewers</th></tr></thead><tbody>
                      {policyDraft.defaultRules.map((rule) => <tr key={rule.key}>
                        <td><strong>{rule.category}</strong><small>{rule.key}</small></td>
                        <td>{rule.action.replaceAll("_", " ")} · {rule.minimumRisk}</td>
                        <td>{rule.requiredOwnerRoles.join(", ") || "Policy owner"}</td>
                        <td>{[...rule.requiredReviewerRoles, ...Object.entries(rule.reviewerQuorum ?? {}).map(([role, count]) => `${role} ×${count}`)].join(", ") || "No separate reviewer"}</td>
                      </tr>)}
                    </tbody></table></div>
                    </details>
                  </section>

                  <section className="organization-panel">
                    <div className="organization-panel-heading">
                      <div><h2>Project rules</h2><p>Lower priority numbers win. Empty category/scope fields match broadly; equal-priority overlaps are rejected.</p></div>
                      <small>{policyDraft.rules.length} custom rules</small>
                    </div>
                    <details className="inline-create-disclosure">
                      <summary>Add project rule</summary>
                    <form className="member-form-grid" onSubmit={addPolicyRule}>
                      <label>Rule key<input name="policyKey" placeholder="transfer-quality" required pattern="[a-z0-9][a-z0-9-]*" /></label>
                      <label>Rule name<input name="policyName" placeholder="Block transfer quality changes" required /></label>
                      <label>Priority<input name="policyPriority" type="number" min={1} max={1000} defaultValue={100} required /></label>
                      <label>Category<input name="policyCategory" placeholder="quality" /></label>
                      <label>Repository<input name="policyRepository" placeholder="payments-api" /></label>
                      <label>Component<input name="policyComponent" placeholder="transfers" /></label>
                      <label>Branch<input name="policyBranch" placeholder="main" /></label>
                      <label>Environment<input name="policyEnvironment" placeholder="production" /></label>
                      <label>Work item<input name="policyWorkItem" placeholder="PAY-142" /></label>
                      <label>Interruption action<select name="policyAction" defaultValue="block"><option value="assume_and_log">Assume and log</option><option value="ask_async">Ask asynchronously</option><option value="block">Block</option><option value="protected_approval">Protected approval</option></select></label>
                      <label>Minimum risk<select name="policyRisk" defaultValue="high"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="protected">Protected</option></select></label>
                      <label>Required owner roles<input name="policyOwnerRoles" placeholder="qa-lead, component-owner" /></label>
                      <label>Required reviewer roles<input name="policyReviewerRoles" placeholder="architecture-reviewer" /></label>
                      <label>Reviewer quorum<input name="policyReviewerQuorum" placeholder="security-reviewer=2" /></label>
                      <div className="member-form-actions"><small>Use comma-separated normalized role names. Quorum uses role=count pairs and is valid only for required reviewer roles on protected approval rules.</small><button className="secondary" type="submit">Add rule</button></div>
                    </form>
                    </details>
                    {policyDraft.rules.length === 0 ? <div className="empty">No custom rules are configured; Bridge defaults remain active.</div> : (
                      <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Rule</th><th>Match</th><th>Effect</th><th>Authority</th><th /></tr></thead><tbody>
                        {policyDraft.rules.map((rule) => <tr key={rule.key}>
                          <td><strong>{rule.name}</strong><small>Priority {rule.priority} · {rule.key}</small></td>
                          <td>{[rule.category && `category ${rule.category}`, ...Object.entries(rule.scope).map(([field, value]) => `${field} ${value}`)].filter(Boolean).join(" · ") || "Project-wide"}</td>
                          <td>{rule.action.replaceAll("_", " ")} · minimum {rule.minimumRisk}</td>
                          <td>{[...rule.requiredOwnerRoles.map((role) => `owner:${role}`), ...rule.requiredReviewerRoles.map((role) => `reviewer:${role}`), ...Object.entries(rule.reviewerQuorum ?? {}).map(([role, count]) => `quorum:${role}=${count}`)].join(", ") || "No added roles"}</td>
                          <td><button className="secondary" type="button" onClick={() => setPolicyDraft({ ...policyDraft, rules: policyDraft.rules.filter((candidate) => candidate !== rule) })}>Remove</button></td>
                        </tr>)}
                      </tbody></table></div>
                    )}
                  </section>
                  <div className="member-form-actions">
                    <small>Version {policyConfiguration?.version ?? 0}{policyConfiguration?.updatedAt ? ` · last saved ${new Date(policyConfiguration.updatedAt).toLocaleString()}` : " · no custom policy saved yet"}</small>
                    <button className="primary" type="button" disabled={submitting || !policyConfiguration || JSON.stringify(policyConfiguration) === JSON.stringify(policyDraft)} onClick={() => void savePolicy()}>Save policy</button>
                  </div>
                </div>
              ) : null}
            </>
          ) : view === "organization" ? (
            <>
              <div className="title-row">
                <div>
                  <h1>Organization members</h1>
                  <p>Provision OIDC identities, suspend access, and assign organization or project roles with optimistic version checks.</p>
                </div>
                <button className="secondary" type="button" onClick={() => void loadOrganizationMembers()}>Refresh</button>
              </div>
              {organizationMembersLoading ? <div className="empty">Loading organization members…</div> : null}
              {!organizationMembersLoading ? (
                <div className="organization-stack">
                  <details className="panel-disclosure">
                    <summary><span><strong>Add an OIDC member</strong><small>Provision a human identity and bounded project access.</small></span><em>Organization administrator</em></summary>
                  <form
                    className="panel-disclosure-form member-create-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void createOrganizationMember();
                    }}
                  >
                    <p className="panel-form-intro">The subject must match the configured identity provider exactly.</p>
                    <div className="member-form-grid">
                      <label>Display name<input value={newMemberName} onChange={(event) => setNewMemberName(event.target.value)} required minLength={2} /></label>
                      <label>OIDC subject<input value={newMemberSubject} onChange={(event) => setNewMemberSubject(event.target.value)} required placeholder="auth0|user-id" /></label>
                      <label>Organization roles<input value={newMemberRoles} onChange={(event) => setNewMemberRoles(event.target.value)} placeholder="organization-member, business-analyst" /></label>
                      <label>Initial project
                        <select value={newMemberProjectId} onChange={(event) => setNewMemberProjectId(event.target.value)}>
                          <option value="">No initial project</option>
                          {organizationProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                        </select>
                      </label>
                      <label>Initial project roles<input value={newMemberProjectRoles} onChange={(event) => setNewMemberProjectRoles(event.target.value)} disabled={!newMemberProjectId} /></label>
                      <label className="checkbox-label"><input type="checkbox" checked={newMemberAllProjects} onChange={(event) => setNewMemberAllProjects(event.target.checked)} />Access every organization project</label>
                    </div>
                    <div className="member-form-actions">
                      <small>Role names are normalized and duplicates are removed. Creating members never grants approval to an agent identity.</small>
                      <button className="primary" type="submit" disabled={memberSubmitting || !newMemberName.trim() || !newMemberSubject.trim()}>Add member</button>
                    </div>
                  </form>
                  </details>

                  <section className="organization-panel">
                    <div className="organization-panel-heading">
                      <div><h2>Directory and access</h2><p>Disabled memberships fail authentication on the next request.</p></div>
                      <small>{organizationMembers.length} members</small>
                    </div>
                    {organizationMembers.length === 0 ? <div className="empty">No organization members are configured.</div> : (
                      <div className="member-directory-layout">
                        <div className="member-list" aria-label="Organization members">
                          {organizationMembers.map((member) => (
                            <button
                              key={member.id}
                              type="button"
                              className={selectedOrganizationMember?.id === member.id ? "member-row selected" : "member-row"}
                              onClick={() => setSelectedMemberId(member.id)}
                            >
                              <span><strong>{member.displayName}</strong><small>{member.roles.join(" · ") || "No organization roles"}</small></span>
                              <span className={`status status-${member.status}`}>{member.status}</span>
                            </button>
                          ))}
                        </div>
                        {selectedOrganizationMember ? (
                          <form
                            className="member-editor"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void updateOrganizationMember();
                            }}
                          >
                            <div className="member-editor-heading">
                              <div><h3>{selectedOrganizationMember.displayName}</h3><small>OIDC subject · {selectedOrganizationMember.oidcSubject}</small></div>
                              <small>Version {selectedOrganizationMember.version}</small>
                            </div>
                            <label>Status
                              <select value={memberStatus} onChange={(event) => setMemberStatus(event.target.value as OrganizationMember["status"])}>
                                <option value="active">Active</option>
                                <option value="disabled">Disabled</option>
                              </select>
                            </label>
                            <label>Organization roles<input value={memberRoles} onChange={(event) => setMemberRoles(event.target.value)} placeholder="organization-member" /></label>
                            <label className="checkbox-label"><input type="checkbox" checked={memberAllProjects} onChange={(event) => setMemberAllProjects(event.target.checked)} />Access every organization project</label>
                            <fieldset className="project-membership-editor">
                              <legend>Project memberships and roles</legend>
                              {organizationProjects.length === 0 ? <small>No projects are registered.</small> : organizationProjects.map((project) => {
                                const enabled = memberProjectRoles[project.id] !== undefined;
                                return (
                                  <div key={project.id} className="project-membership-row">
                                    <label className="checkbox-label"><input
                                      type="checkbox"
                                      checked={enabled}
                                      onChange={(event) => setMemberProjectRoles((current) => ({
                                        ...current,
                                        [project.id]: event.target.checked ? current[project.id] ?? "contributor" : undefined,
                                      }))}
                                    />{project.name}</label>
                                    <input
                                      aria-label={`${project.name} roles`}
                                      value={memberProjectRoles[project.id] ?? ""}
                                      disabled={!enabled}
                                      placeholder="contributor, qa-lead"
                                      onChange={(event) => setMemberProjectRoles((current) => ({ ...current, [project.id]: event.target.value }))}
                                    />
                                  </div>
                                );
                              })}
                            </fieldset>
                            <div className="member-form-actions">
                              <small>The final active organization administrator cannot be disabled or demoted.</small>
                              <button className="primary" type="submit" disabled={memberSubmitting}>Save access</button>
                            </div>
                          </form>
                        ) : null}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}
            </>
          ) : view === "notifications" ? (
            <>
              <div className="title-row">
                <div>
                  <h1>Notifications for this project</h1>
                  <p>Questions, discussion, protected reviews, and specification changes that need your attention.</p>
                </div>
                <button
                  className="secondary"
                  type="button"
                  disabled={notificationsLoading || pendingNotifications === 0}
                  onClick={() => void markAllNotificationsRead()}
                >Mark all read</button>
              </div>
              <div className="notification-preference-panel" aria-label="Notification preferences">
                <div>
                  <strong>Email delivery</strong>
                  <p>Protected review email remains immediate.</p>
                </div>
                <label>
                  <span>Default preference</span>
                  <select
                    value={notificationPreference}
                    disabled={notificationPreferenceLoading || notificationPreferenceSaving}
                    onChange={(event) => void saveNotificationPreference(event.target.value as NotificationDeliveryPreference)}
                  >
                    <option value="immediate">Immediate</option>
                    <option value="digest">Digest</option>
                    <option value="muted">Muted</option>
                  </select>
                </label>
              </div>
              {notificationsLoading ? <div className="empty">Loading notifications…</div> : null}
              {!notificationsLoading && notifications.length === 0 ? (
                <div className="empty">No notifications for this project yet.</div>
              ) : null}
              {!notificationsLoading && notifications.length > 0 ? (
                <div className="notification-list" aria-label="Notifications">
                  {notifications.map((notification) => (
                    <button
                      type="button"
                      key={notification.id}
                      className={notification.readAt ? "notification-row" : "notification-row unread"}
                      onClick={() => void openNotification(notification)}
                    >
                      <span className="notification-dot" aria-hidden="true" />
                      <span className="notification-copy">
                        <strong>{notification.title}</strong>
                        <span>{notification.body}</span>
                        <small>{new Date(notification.createdAt).toLocaleString()} · {notification.type.replaceAll("_", " ")}</small>
                      </span>
                      <span className="notification-state">{notification.readAt ? "Read" : "Unread"}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : view === "audit" ? (
            <>
              <div className="title-row">
                <div>
                  <h1>Audit events</h1>
                  <p>Permission-restricted operational metadata. Record bodies, prompts, answers, credentials, and private reasoning are excluded.</p>
                </div>
                <div className="audit-actions">
                  <details className="action-menu">
                    <summary>Export</summary>
                    <div>
                      {auditScope === "project" && isProjectAdmin ? (
                        <button
                          type="button"
                          disabled={projectDataExporting}
                          title="Downloads bounded decision and specification content plus project audit records."
                          onClick={() => void exportProjectData()}
                        >Export project data</button>
                      ) : null}
                      <button type="button" disabled={auditExporting} onClick={() => void exportAudit("json")}>Audit as JSON</button>
                      <button type="button" disabled={auditExporting} onClick={() => void exportAudit("csv")}>Audit as CSV</button>
                    </div>
                  </details>
                  <button className="secondary" type="button" disabled={auditLoading} onClick={() => void loadAudit(0)}>Refresh</button>
                </div>
              </div>
              <details className="filter-disclosure">
                <summary>Filter audit events <span>Optional</span></summary>
              <div className="audit-filter-panel" aria-label="Audit filters">
                <label>Scope
                  <select
                    value={auditScope}
                    onChange={(event) => {
                      setAuditScope(event.target.value as "project" | "organization");
                      setAuditPage(undefined);
                    }}
                  >
                    {isProjectAdmin ? <option value="project">Selected project</option> : null}
                    {isOrganizationAdmin ? <option value="organization">Organization administration</option> : null}
                  </select>
                </label>
                <label>Action<input value={auditFilters.action ?? ""} onChange={(event) => updateAuditFilter("action", event.target.value)} placeholder="question.created" /></label>
                <label>Actor ID<input value={auditFilters.actorId ?? ""} onChange={(event) => updateAuditFilter("actorId", event.target.value)} /></label>
                <label>Source
                  <select value={auditFilters.source ?? ""} onChange={(event) => updateAuditFilter("source", event.target.value)}>
                    <option value="">Any source</option>
                    <option value="web">Web</option>
                    <option value="api">REST API</option>
                    <option value="cli">CLI</option>
                    <option value="mcp">MCP</option>
                    <option value="application">Application</option>
                    <option value="worker">Worker</option>
                    <option value="integration">Integration</option>
                  </select>
                </label>
                <label>Subject type<input value={auditFilters.subjectType ?? ""} onChange={(event) => updateAuditFilter("subjectType", event.target.value)} placeholder="artifact_version" /></label>
                <label>Subject ID<input value={auditFilters.subjectId ?? ""} onChange={(event) => updateAuditFilter("subjectId", event.target.value)} /></label>
                <label>Correlation ID<input value={auditFilters.correlationId ?? ""} onChange={(event) => updateAuditFilter("correlationId", event.target.value)} /></label>
                <label>Created from<input type="date" value={auditFilters.createdFrom ?? ""} onChange={(event) => updateAuditFilter("createdFrom", event.target.value)} /></label>
                <label>Created to<input type="date" value={auditFilters.createdTo ?? ""} onChange={(event) => updateAuditFilter("createdTo", event.target.value)} /></label>
              </div>
              </details>
              {auditLoading ? <div className="empty">Loading audit metadata…</div> : null}
              {!auditLoading && auditPage?.items.length === 0 ? <div className="empty">No audit events match these filters.</div> : null}
              {!auditLoading && auditPage && auditPage.items.length > 0 ? (
                <section className="analytics-panel audit-panel">
                  <div className="analytics-panel-heading">
                    <div><h2>Immutable event stream</h2><p>{auditPage.totalMatching} matching events · showing {auditPage.offset + 1}–{auditPage.offset + auditPage.items.length}</p></div>
                    <small>{auditScope === "project" ? selectedProject?.name : "Organization administration"}</small>
                  </div>
                  <div className="analytics-table-wrap">
                    <table className="analytics-table audit-table">
                      <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Subject</th><th>Reason</th><th>Correlation</th></tr></thead>
                      <tbody>{auditPage.items.map((event) => (
                        <tr key={event.id}>
                          <td>{new Date(event.createdAt).toLocaleString()}</td>
                          <td>
                            <strong>{event.action}</strong>
                            {event.policyVersion !== undefined || event.policyRuleKey || event.beforeVersion !== undefined || event.afterVersion !== undefined ? (
                              <small>
                                {event.policyVersion === undefined ? "" : `policy v${event.policyVersion}`}
                                {event.policyRuleKey ? ` · rule ${event.policyRuleKey}` : ""}
                                {event.beforeVersion === undefined && event.afterVersion === undefined ? "" : ` · v${event.beforeVersion ?? 0} → v${event.afterVersion ?? "?"}`}
                              </small>
                            ) : null}
                            {event.assignmentId ? (
                              <>
                                <code title={`Assignment ${event.assignmentId}`}>{event.assignmentId}</code>
                                <small>
                                  assignment
                                  {event.ownerRouteSource ? ` · owner via ${event.ownerRouteSource.replaceAll("_", " ")}` : ""}
                                  {event.reviewerRouteSource ? ` · reviewer via ${event.reviewerRouteSource.replaceAll("_", " ")}` : ""}
                                </small>
                              </>
                            ) : null}
                          </td>
                          <td><code>{event.actorId}</code><small>{event.actorType}{event.source ? ` · ${event.source}` : " · legacy source unavailable"}</small></td>
                          <td><strong>{event.subjectType}</strong><code>{event.subjectId}</code></td>
                          <td>{event.reason ?? "—"}</td>
                          <td><code>{event.correlationId}</code></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <div className="audit-pagination">
                    <button className="secondary" type="button" disabled={auditLoading || auditPage.offset === 0} onClick={() => void loadAudit(Math.max(0, auditPage.offset - auditPage.limit))}>Previous</button>
                    <span>Offset {auditPage.offset} of {auditPage.totalMatching}</span>
                    <button className="secondary" type="button" disabled={auditLoading || auditPage.nextOffset === undefined} onClick={() => void loadAudit(auditPage.nextOffset ?? auditPage.offset)}>Next</button>
                  </div>
                </section>
              ) : null}
            </>
          ) : view === "analytics" ? (
            <>
              <div className="title-row">
                <div>
                  <h1>Privacy-conscious pilot analytics</h1>
                  <p>Lifecycle counts and outcomes derived from governed records without exposing prompts, answers, specifications, or hidden reasoning.</p>
                </div>
                <button className="secondary" type="button" onClick={() => void loadAnalytics()}>Refresh</button>
              </div>
              <details className="filter-disclosure">
                <summary>Filter analytics cohort <span>Optional</span></summary>
              <div className="filter-bar" aria-label="Analytics cohort filters">
                <label htmlFor="analytics-client">Agent client</label>
                <select
                  id="analytics-client"
                  value={analyticsFilters.client ?? ""}
                  onChange={(event) => updateAnalyticsFilter("client", event.target.value)}
                >
                  <option value="">All clients</option>
                  {(["codex", "claude_code", "cursor", "copilot", "custom", "unknown"] as const).map((client) => (
                    <option key={client} value={client}>{client.replaceAll("_", " ")}</option>
                  ))}
                </select>
                <label htmlFor="analytics-from">Runs from</label>
                <input
                  id="analytics-from"
                  type="date"
                  value={analyticsFilters.startedFrom ?? ""}
                  onChange={(event) => updateAnalyticsFilter("startedFrom", event.target.value)}
                />
                <label htmlFor="analytics-to">Runs to</label>
                <input
                  id="analytics-to"
                  type="date"
                  value={analyticsFilters.startedTo ?? ""}
                  onChange={(event) => updateAnalyticsFilter("startedTo", event.target.value)}
                />
                <button className="secondary" type="button" onClick={() => setAnalyticsFilters({})}>Clear filters</button>
              </div>
              </details>
              {analyticsLoading ? <div className="empty">Calculating project analytics…</div> : null}
              {!analyticsLoading && analytics ? (
                <div className="analytics-stack">
                  <div className="analytics-grid" aria-label="Pilot outcome summary">
                    <article className="analytics-card">
                      <small>Runs in cohort</small>
                      <strong>{analytics.cohort.runCount}</strong>
                      <span>{analytics.cohort.client?.replaceAll("_", " ") ?? "all agent clients"}</span>
                    </article>
                    <article className="analytics-card">
                      <small>Runs retrieving context</small>
                      <strong>{formatPercent(analytics.outcomes.runsWithContextRate)}</strong>
                      <span>{analytics.activity.contextRetrievals} retrievals</span>
                    </article>
                    <article className="analytics-card">
                      <small>Question reuse rate</small>
                      <strong>{formatPercent(analytics.outcomes.questionReuseRate)}</strong>
                      <span>{analytics.activity.questionsReused} existing questions reused</span>
                    </article>
                    <article className="analytics-card">
                      <small>Accepted decisions reused</small>
                      <strong>{analytics.outcomes.acceptedDecisionReuseCount}</strong>
                      <span>{analytics.activity.decisionReuseOccurrences} retrieval occurrences</span>
                    </article>
                    <article className="analytics-card">
                      <small>Median decision time</small>
                      <strong>{formatDuration(analytics.outcomes.medianQuestionResolutionMs)}</strong>
                      <span>{formatPercent(analytics.outcomes.decisionAcceptanceRate)} of created questions accepted</span>
                    </article>
                    <article className="analytics-card">
                      <small>Specification approval</small>
                      <strong>{formatPercent(analytics.outcomes.specificationApprovalRate)}</strong>
                      <span>median {formatDuration(analytics.outcomes.medianSpecificationApprovalMs)}</span>
                    </article>
                  </div>

                  <section className="analytics-panel">
                    <div className="analytics-panel-heading">
                      <div><h2>Governed activity</h2><p>Counts follow runs selected by the cohort filters.</p></div>
                      <small>Generated {new Date(analytics.generatedAt).toLocaleString()}</small>
                    </div>
                    <div className="analytics-activity-grid">
                      {[
                        ["Context retrievals", analytics.activity.contextRetrievals],
                        ["Question submissions", analytics.activity.questionSubmissions],
                        ["Questions created", analytics.activity.questionsCreated],
                        ["Questions reused", analytics.activity.questionsReused],
                        ["Routed on creation", analytics.activity.questionsRoutedOnCreation],
                        ["Responses proposed", analytics.activity.responsesProposed],
                        ["Decisions accepted", analytics.activity.decisionsAccepted],
                        ["Assumptions resolved", analytics.activity.assumptionsResolved],
                        ["Specification versions approved", analytics.activity.specificationVersionsApproved],
                      ].map(([label, value]) => (
                        <div key={label}><span>{label}</span><strong>{value}</strong></div>
                      ))}
                    </div>
                  </section>

                  <section className="analytics-panel">
                    <div className="analytics-panel-heading">
                      <div><h2>Guardrails</h2><p>Signals that should stay bounded during the pilot.</p></div>
                    </div>
                    <div className="analytics-activity-grid">
                      <div><span>Questions per run</span><strong>{analytics.guardrails.questionsPerRun.toFixed(2)}</strong></div>
                      <div><span>Blocking questions</span><strong>{analytics.guardrails.blockingQuestions}</strong></div>
                      <div><span>Unrouted blocking questions</span><strong>{analytics.guardrails.unroutedBlockingQuestions}</strong></div>
                      <div><span>Context items per retrieval</span><strong>{analytics.guardrails.contextItemsPerRetrieval.toFixed(2)}</strong></div>
                      <div><span>First-assignment routing</span><strong>{formatPercent(analytics.outcomes.firstAssignmentRoutingRate)}</strong></div>
                      <div><span>Assumption resolution</span><strong>{formatPercent(analytics.outcomes.assumptionResolutionRate)}</strong></div>
                    </div>
                  </section>

                  <section className="analytics-panel">
                    <div className="analytics-panel-heading">
                      <div><h2>Agent client breakdown</h2><p>Controlled client names only; task and user content are excluded.</p></div>
                    </div>
                    {analytics.byClient.length === 0 ? <div className="empty">No runs match this cohort.</div> : (
                      <div className="analytics-table-wrap">
                        <table className="analytics-table">
                          <thead><tr><th>Client</th><th>Runs</th><th>Context</th><th>Questions</th><th>Reused questions</th><th>Accepted decisions</th><th>Decision reuse</th></tr></thead>
                          <tbody>
                            {analytics.byClient.map((row) => (
                              <tr key={row.client}>
                                <th>{row.client.replaceAll("_", " ")}</th>
                                <td>{row.runCount}</td>
                                <td>{row.contextRetrievals}</td>
                                <td>{row.questionSubmissions}</td>
                                <td>{row.questionsReused}</td>
                                <td>{row.decisionsAccepted}</td>
                                <td>{row.decisionReuseOccurrences}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section className="analytics-panel privacy-panel">
                    <div className="analytics-panel-heading">
                      <div><h2>What analytics collects</h2><p>This view calculates metadata in place and does not create a second content store.</p></div>
                    </div>
                    <div className="privacy-columns">
                      <div><h3>Derived from</h3><ul>{analytics.privacy.derivedFrom.map((item) => <li key={item}>{item}</li>)}</ul></div>
                      <div><h3>Explicitly excluded</h3><ul>{analytics.privacy.excluded.map((item) => <li key={item}>{item}</li>)}</ul></div>
                    </div>
                  </section>
                </div>
              ) : null}
            </>
          ) : view === "decisions" ? (
            <>
              <div className="title-row">
                <div><h1>Accepted project decisions</h1><p>Only human-accepted answers appear here as authoritative context.</p></div>
                <button className="secondary" type="button" onClick={() => void loadReferenceData()}>Refresh</button>
              </div>
              <details className="filter-disclosure">
                <summary>Filter decisions <span>{hasDecisionFilters ? "Filters active" : "Optional"}</span></summary>
                <div className="filter-bar" aria-label="Decision filters">
                <label htmlFor="decision-search">Search</label>
                <input
                  id="decision-search"
                  value={decisionSearchDraft}
                  placeholder="Answer, rationale, category"
                  onChange={(event) => setDecisionSearchDraft(event.target.value)}
                  onKeyDown={(event) => {
                    const search = decisionSearchDraft.trim();
                    if (event.key === "Enter" && (search.length === 0 || search.length >= 2)) {
                      updateDecisionFilter("search", search);
                    }
                  }}
                />
                <button
                  className="secondary"
                  type="button"
                  disabled={decisionSearchDraft.trim().length === 1}
                  onClick={() => updateDecisionFilter("search", decisionSearchDraft.trim())}
                >Search</button>
                <label htmlFor="decision-history">View</label>
                <select
                  id="decision-history"
                  value={decisionFilters.includeHistory ? "history" : "active"}
                  onChange={(event) => {
                    const includeHistory = event.target.value === "history";
                    setDecisionFilters((current) => {
                      const { status: _status, ...withoutStatus } = current;
                      return includeHistory
                        ? { ...current, includeHistory: true }
                        : { ...withoutStatus, includeHistory: false };
                    });
                  }}
                >
                  <option value="active">Active only</option>
                  <option value="history">Include history</option>
                </select>
                <label htmlFor="decision-status">Status</label>
                <select
                  id="decision-status"
                  value={decisionFilters.status ?? ""}
                  disabled={!decisionFilters.includeHistory}
                  onChange={(event) => updateDecisionFilter("status", event.target.value)}
                >
                  <option value="">Any status</option>
                  <option value="active">Active</option>
                  <option value="superseded">Superseded</option>
                  <option value="expired">Expired</option>
                  <option value="revoked">Revoked</option>
                </select>
                <label htmlFor="decision-category">Category</label>
                <select
                  id="decision-category"
                  value={decisionFilters.category ?? ""}
                  onChange={(event) => updateDecisionFilter("category", event.target.value)}
                >
                  <option value="">All categories</option>
                  {[...new Set(questions.map((question) => question.category))].sort().map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
                <label htmlFor="decision-owner">Owner</label>
                <select
                  id="decision-owner"
                  value={decisionFilters.ownerId ?? ""}
                  onChange={(event) => updateDecisionFilter("ownerId", event.target.value)}
                >
                  <option value="">All owners</option>
                  {principals.map((principal) => <option key={principal.id} value={principal.id}>{principal.displayName}</option>)}
                </select>
                <label htmlFor="decision-component">Component</label>
                <input
                  id="decision-component"
                  value={decisionFilters.component ?? ""}
                  placeholder="Exact component"
                  onChange={(event) => updateDecisionFilter("component", event.target.value)}
                />
                <label htmlFor="decision-from">From</label>
                <input
                  id="decision-from"
                  type="date"
                  value={decisionFilters.createdFrom ?? ""}
                  onChange={(event) => updateDecisionFilter("createdFrom", event.target.value)}
                />
                <label htmlFor="decision-to">To</label>
                <input
                  id="decision-to"
                  type="date"
                  value={decisionFilters.createdTo ?? ""}
                  onChange={(event) => updateDecisionFilter("createdTo", event.target.value)}
                />
                {hasDecisionFilters ? (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      setDecisionSearchDraft("");
                      setDecisionFilters({});
                    }}
                  >Clear</button>
                ) : null}
                </div>
              </details>
              {referenceDataLoading ? <div className="empty">Loading decisions…</div> : null}
              {!referenceDataLoading && decisions.length === 0 ? (
                <div className="empty">
                  {decisionFilters.search
                    ? `No decisions match “${decisionFilters.search}”.`
                    : "No decisions have been accepted for this project."}
                </div>
              ) : null}
              {!referenceDataLoading && decisions.length > 0 ? (
                <div className="decision-layout">
                  <div className="question-list" aria-label="Accepted decisions">
                    {decisions.map((decision) => (
                      <button
                        type="button"
                        key={decision.id}
                        className={decision.id === selectedDecision?.id ? "question-row record-row selected" : "question-row record-row"}
                        onClick={() => setSelectedDecisionId(decision.id)}
                      >
                        <span className="document-mark" aria-hidden="true"><BridgeIcon name="decisions" size={16} /></span>
                        <span className="record-row-copy"><strong>{decision.answer}</strong><small>{decision.category} · {decision.scope.component ?? "project"}{decisionConflicts.some((conflict) => conflict.left.id === decision.id || conflict.right.id === decision.id) ? " · potential conflict" : ""}</small></span>
                        <span className={`status status-${decision.status}`}>{decision.status}</span>
                      </button>
                    ))}
                  </div>
                  {selectedDecision ? (
                    <article className="question-detail record-detail">
                      <header className="record-detail-header">
                        <div className="record-title-block">
                          <span className="record-eyebrow">Project decision · {selectedDecision.category.replaceAll("_", " ")}</span>
                          <h2>{selectedDecision.answer}</h2>
                          <div className="record-chip-row" aria-label="Decision scope">
                            {Object.entries(selectedDecision.scope).length > 0
                              ? Object.entries(selectedDecision.scope).map(([key, value]) => <span className="record-chip" key={key}>{key}: {value}</span>)
                              : <span className="record-chip">Project-wide scope</span>}
                          </div>
                        </div>
                        <span className={`status status-${selectedDecision.status}`}>{selectedDecision.status}</span>
                      </header>
                      <div className="record-detail-body">
                      <section className="record-section record-summary-section">
                        <div className="record-section-heading">
                          <div><span>Why this was accepted</span><h3>Decision rationale</h3></div>
                        </div>
                        <p className="record-lead">{selectedDecision.rationale}</p>
                      </section>
                      <section className="record-section">
                        <div className="record-section-heading">
                          <div><span>Human authority</span><h3>Ownership and review</h3></div>
                        </div>
                        <dl className="record-meta-grid">
                          <div><dt>Accepted by</dt><dd title={selectedDecision.ownerId}>{displayIdentityName(selectedDecision.ownerId, principals)}</dd></div>
                          <div><dt>Accepted at</dt><dd>{new Date(selectedDecision.createdAt).toLocaleString()}</dd></div>
                          <div><dt>Review due</dt><dd>{new Date(selectedDecision.reviewAt).toLocaleDateString()}</dd></div>
                          <div><dt>Decision version</dt><dd>Version {selectedDecision.version}</dd></div>
                        </dl>
                      </section>
                      {selectedDecisionConflicts.length > 0 ? (
                        <section className="record-section">
                          <div className="record-section-heading">
                            <div><span>Advisory signal</span><h3>Potential active conflicts</h3></div>
                            <small>{selectedDecisionConflicts.length} found</small>
                          </div>
                          <p className="muted-copy">A human owner must inspect the scope and rationale before changing either decision.</p>
                          <div className="conflict-list">
                            {selectedDecisionConflicts.map((conflict) => {
                              const other = conflict.left.id === selectedDecision.id ? conflict.right : conflict.left;
                              return (
                                <article className="conflict-card" key={conflict.id}>
                                  <div><strong>{conflict.confidence} confidence</strong><span>{conflict.scopeRelation.replaceAll("_", " ")} scope · {conflict.signals.join(" · ")}</span></div>
                                  <p>{other.answer}</p>
                                  <button
                                    className="text-button"
                                    type="button"
                                    onClick={() => {
                                      setDecisionFilters({ includeHistory: true });
                                      setSelectedDecisionId(other.id);
                                    }}
                                  >Open other active decision</button>
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      ) : null}
                      {selectedDecision.lifecycleChangedAt ? (
                        <section className="record-section">
                          <div className="record-section-heading"><div><span>Recorded evidence</span><h3>Lifecycle history</h3></div></div>
                          <div className="record-evidence">
                            <p>{selectedDecision.lifecycleRationale}</p>
                            <dl className="record-meta-grid">
                              <div><dt>Changed by</dt><dd title={selectedDecision.lifecycleChangedById}>{displayIdentityName(selectedDecision.lifecycleChangedById ?? "Bridge worker", principals)}</dd></div>
                              <div><dt>Changed at</dt><dd>{new Date(selectedDecision.lifecycleChangedAt).toLocaleString()}</dd></div>
                              {selectedDecision.replacementDecisionId ? <div><dt>Replacement</dt><dd title={selectedDecision.replacementDecisionId}>Linked decision</dd></div> : null}
                            </dl>
                          </div>
                        </section>
                      ) : null}
                      <section className="record-section">
                        <div className="record-action-panel">
                          <div>
                            <span>Before making a change</span>
                            <h3>Understand downstream impact</h3>
                            <p>Preview direct and transitive records that may need review. Analysis is read-only and does not alter human authority.</p>
                          </div>
                          <button className="secondary" type="button" disabled={decisionImpactLoading} onClick={() => void loadDecisionImpact()}>
                            {decisionImpactLoading ? "Analyzing…" : "Analyze impact"}
                          </button>
                        </div>
                        {decisionLifecycleImpact ? (
                          <div className="impact-analysis" aria-live="polite">
                            <p className="impact">
                              {decisionLifecycleImpact.artifactIds.length} specification(s), {decisionLifecycleImpact.assumptionIds.length} assumption(s), {decisionLifecycleImpact.questionIds.length} question(s), {decisionLifecycleImpact.runIds.length} agent run(s), and {decisionLifecycleImpact.workItems.length} work item(s).
                            </p>
                            <div className="spec-meta">
                              <span>Dependency depth {decisionLifecycleImpact.maxDepthReached}</span>
                              <span>{decisionLifecycleImpact.nodes.length} records</span>
                              <span>{decisionLifecycleImpact.edges.length} links</span>
                              {decisionLifecycleImpact.truncated ? <span>Bound reached; narrow or rerun with API limits</span> : <span>Complete within configured bounds</span>}
                            </div>
                            <div className="impact-paths">
                              {decisionLifecycleImpact.nodes.filter((node) => node.depth > 0).slice(0, 8).map((node) => (
                                <div key={node.id}><strong>Level {node.depth} · {node.type.replaceAll("_", " ")}</strong><span>{node.label}</span></div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </section>
                      {selectedDecision.status === "active" ? (
                        <details className="detail-disclosure lifecycle-disclosure">
                          <summary><span>Lifecycle controls</span><small>Revoke, expire, or supersede</small></summary>
                          <div className="response-form lifecycle-form">
                          <p>These actions remove this decision from active authoritative context. A human rationale is always required.</p>
                          <label htmlFor="decision-lifecycle-status">Lifecycle action</label>
                          <select
                            id="decision-lifecycle-status"
                            value={decisionLifecycleStatus}
                            onChange={(event) => setDecisionLifecycleStatus(event.target.value as typeof decisionLifecycleStatus)}
                          >
                            <option value="revoked">Revoke</option>
                            <option value="expired">Expire</option>
                            <option value="superseded">Supersede with replacement</option>
                          </select>
                          {decisionLifecycleStatus === "superseded" ? (
                            <>
                              <label htmlFor="replacement-decision">Active replacement</label>
                              <select
                                id="replacement-decision"
                                value={replacementDecisionId}
                                onChange={(event) => setReplacementDecisionId(event.target.value)}
                              >
                                <option value="">Select a replacement decision</option>
                                {decisions.filter((candidate) =>
                                  candidate.id !== selectedDecision.id &&
                                  candidate.status === "active" &&
                                  candidate.category === selectedDecision.category &&
                                  sameScope(candidate.scope, selectedDecision.scope)
                                ).map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>{candidate.answer}</option>
                                ))}
                              </select>
                            </>
                          ) : null}
                          <label htmlFor="decision-lifecycle-rationale">Rationale</label>
                          <textarea
                            id="decision-lifecycle-rationale"
                            value={decisionLifecycleRationale}
                            placeholder="Explain why this decision is no longer authoritative."
                            onChange={(event) => setDecisionLifecycleRationale(event.target.value)}
                          />
                          <button
                            className="secondary lifecycle-action"
                            type="button"
                            disabled={submitting || decisionLifecycleRationale.trim().length < 10 || (decisionLifecycleStatus === "superseded" && !replacementDecisionId)}
                            onClick={() => void changeDecisionLifecycle()}
                          >Apply lifecycle change</button>
                          </div>
                        </details>
                      ) : null}
                      <footer className="record-footer">
                        <span>{selectedDecision.questionId ? "Trace this decision back to the human-reviewed question." : "Created from a human-confirmed assumption."}</span>
                        {selectedDecision.questionId ? (
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => {
                            setSelectedId(selectedDecision.questionId);
                            setView("questions");
                          }}
                        >Open source question</button>
                        ) : null}
                      </footer>
                      </div>
                    </article>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : view === "assumptions" ? (
            <>
              <div className="title-row">
                <div><h1>Visible project assumptions</h1><p>Assumptions are temporary premises with explicit risk, expiry, and reversal cost.</p></div>
                <label>Show
                  <select value={assumptionStatusFilter} onChange={(event) => setAssumptionStatusFilter(event.target.value as Assumption["status"] | "all")}>
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="rejected">Rejected</option>
                    <option value="expired">Expired</option>
                    <option value="superseded">Superseded</option>
                  </select>
                </label>
                <button className="secondary" type="button" onClick={() => void loadReferenceData()}>Refresh</button>
              </div>
              {referenceDataLoading ? <div className="empty">Loading assumptions…</div> : null}
              {!referenceDataLoading && assumptions.length === 0 ? <div className="empty">No assumptions have been recorded for this project.</div> : null}
              {!referenceDataLoading && assumptions.length > 0 && visibleAssumptions.length === 0 ? <div className="empty">No assumptions match this status.</div> : null}
              {!referenceDataLoading && visibleAssumptions.length > 0 ? (
                <div className="decision-layout">
                  <div className="question-list" aria-label="Project assumptions">
                    {visibleAssumptions.map((assumption) => (
                      <button
                        type="button"
                        key={assumption.id}
                        className={assumption.id === selectedAssumption?.id ? "question-row selected" : "question-row"}
                        onClick={() => setSelectedAssumptionId(assumption.id)}
                      >
                        <span className={`risk risk-${assumption.risk}`} aria-hidden="true" />
                        <span><strong>{assumption.statement}</strong><small>{assumption.category} · confidence {assumption.confidence}</small></span>
                        <span className={`status status-${assumption.status}`}>{assumption.status}</span>
                      </button>
                    ))}
                  </div>
                  {selectedAssumption ? (
                    <article className="question-detail record-detail">
                      <header className="record-detail-header">
                        <div className="record-title-block">
                          <span className="record-eyebrow">Project assumption · version {selectedAssumption.version}</span>
                          <h2>{selectedAssumption.statement}</h2>
                          <div className="record-chip-row" aria-label="Assumption attributes">
                            <span className="record-chip">{selectedAssumption.category.replaceAll("_", " ")}</span>
                            <span className="record-chip">{selectedAssumption.risk} risk</span>
                            <span className="record-chip">{selectedAssumption.confidence} confidence</span>
                            <span className="record-chip">{selectedAssumption.reversible ? "Reversible" : "Not reversible"}</span>
                          </div>
                        </div>
                        <span className={`status status-${selectedAssumption.status}`}>{selectedAssumption.status}</span>
                      </header>
                      <div className="record-detail-body">
                      <section className="record-section record-summary-section">
                        <div className="record-section-heading"><div><span>Temporary premise</span><h3>Why the team is using this assumption</h3></div></div>
                        <p className="record-lead">{selectedAssumption.rationale}</p>
                      </section>
                      <section className="record-section">
                        <div className="record-section-heading"><div><span>Risk boundary</span><h3>Expiry and reversibility</h3></div></div>
                        <div className="assumption-cost"><span>Reversal cost</span><strong>{selectedAssumption.reversalCost}</strong></div>
                        <dl className="record-meta-grid">
                          <div><dt>Risk</dt><dd>{selectedAssumption.risk}</dd></div>
                          <div><dt>Confidence</dt><dd>{selectedAssumption.confidence}</dd></div>
                          <div><dt>Expires</dt><dd>{new Date(selectedAssumption.expiresAt).toLocaleString()}</dd></div>
                          <div><dt>Created by</dt><dd title={selectedAssumption.createdById}>{displayIdentityName(selectedAssumption.createdById, principals)}</dd></div>
                          <div><dt>Scope</dt><dd>{Object.entries(selectedAssumption.scope).map(([key, value]) => `${key}: ${value}`).join(" · ") || "Project-wide"}</dd></div>
                        </dl>
                      </section>
                      {selectedAssumption.sourceLinks.length > 0 ? (
                        <section className="record-section"><div className="record-section-heading"><div><span>Evidence</span><h3>Directly linked work</h3></div></div><div className="record-link-list">{selectedAssumption.sourceLinks.map((link) => <a key={link} href={link} target="_blank" rel="noreferrer">{link}</a>)}</div></section>
                      ) : null}
                      {selectedAssumption.resolutionRationale ? (
                        <section className="record-section">
                          <div className="record-section-heading"><div><span>Human outcome</span><h3>Resolution</h3></div></div>
                          <div className="record-evidence">
                            <p>{selectedAssumption.resolutionRationale}</p>
                            <dl className="record-meta-grid">
                              <div><dt>Resolved by</dt><dd title={selectedAssumption.resolvedById}>{displayIdentityName(selectedAssumption.resolvedById ?? "Bridge worker", principals)}</dd></div>
                              {selectedAssumption.confirmedDecisionId ? <div><dt>Authoritative decision</dt><dd>Linked and active</dd></div> : null}
                            </dl>
                          </div>
                        </section>
                      ) : null}
                      {canResolveSelectedAssumption && selectedAssumption.status === "active" ? (
                        <details className="detail-disclosure assumption-resolution-disclosure">
                          <summary><span>Resolve this assumption</span><small>Human action</small></summary>
                          <div className="response-form assumption-resolution-form">
                          <p className="muted-copy">Confirm, reject, or expire this temporary premise. Only confirmation can create an authoritative decision.</p>
                          <label htmlFor="assumption-resolution-status">Resolution</label>
                          <select
                            id="assumption-resolution-status"
                            value={assumptionResolutionStatus}
                            onChange={(event) => {
                              const status = event.target.value as typeof assumptionResolutionStatus;
                              setAssumptionResolutionStatus(status);
                              if (status !== "confirmed") setAssumptionCreateDecision(false);
                            }}
                          >
                            <option value="confirmed">Confirm</option>
                            <option value="rejected">Reject</option>
                            <option value="expired">Mark expired</option>
                          </select>
                          <label htmlFor="assumption-resolution-rationale">Rationale</label>
                          <textarea
                            id="assumption-resolution-rationale"
                            value={assumptionResolutionRationale}
                            placeholder="Explain the human resolution. Rejection requires actionable rationale."
                            onChange={(event) => setAssumptionResolutionRationale(event.target.value)}
                          />
                          {assumptionResolutionStatus === "confirmed" ? (
                            <label><input type="checkbox" checked={assumptionCreateDecision} onChange={(event) => setAssumptionCreateDecision(event.target.checked)} /> Create an authoritative decision</label>
                          ) : null}
                          <button
                            className="primary"
                            type="button"
                            disabled={submitting || assumptionResolutionRationale.trim().length < 10}
                            onClick={() => void resolveAssumption()}
                          >Apply resolution</button>
                          </div>
                        </details>
                      ) : null}
                      {(selectedAssumption.runId || selectedAssumption.confirmedDecisionId) ? (
                        <footer className="record-footer">
                          <span>Trace this assumption to its originating run or accepted decision.</span>
                          <div className="record-footer-actions">
                            {selectedAssumption.runId ? (
                              <button className="secondary" type="button" onClick={() => { setSelectedRunId(selectedAssumption.runId); setView("runs"); }}>Open source run</button>
                            ) : null}
                            {selectedAssumption.confirmedDecisionId ? (
                              <button className="secondary" type="button" onClick={() => { setSelectedDecisionId(selectedAssumption.confirmedDecisionId); setDecisionFilters({ includeHistory: true }); setView("decisions"); }}>Open confirmed decision</button>
                            ) : null}
                          </div>
                        </footer>
                      ) : null}
                      </div>
                    </article>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : view === "runs" ? (
            <>
              <div className="title-row">
                <div><h1>Agent runs and durable handoffs</h1><p>Runs link questions, assumptions, context snapshots, specifications, and completion outcomes.</p></div>
                <button className="secondary" type="button" onClick={() => void loadReferenceData()}>Refresh</button>
              </div>
              {referenceDataLoading ? <div className="empty">Loading agent runs…</div> : null}
              {!referenceDataLoading && runs.length === 0 ? <div className="empty">No agent runs have been registered for this project.</div> : null}
              {!referenceDataLoading && runs.length > 0 ? (
                <div className="decision-layout">
                  <div className="question-list" aria-label="Agent runs">
                    {runs.map((run) => (
                      <button
                        type="button"
                        key={run.id}
                        className={run.id === selectedRun?.id ? "question-row record-row selected" : "question-row record-row"}
                        onClick={() => setSelectedRunId(run.id)}
                      >
                        <span className="document-mark" aria-hidden="true"><BridgeIcon name="runs" size={16} /></span>
                        <span className="record-row-copy"><strong>{run.taskSummary}</strong><small>{run.client.replaceAll("_", " ")} · {run.capability.replaceAll("_", " ")} · {run.continuationMode} continuation · version {run.version}</small></span>
                        <span className={`status status-${run.status}`}>{run.status.replaceAll("_", " ")}</span>
                      </button>
                    ))}
                  </div>
                  {selectedRun ? (
                    <article className="question-detail record-detail">
                      <header className="record-detail-header">
                        <div className="record-title-block">
                          <span className="record-eyebrow">Agent run · version {selectedRun.version}</span>
                          <h2>{selectedRun.taskSummary}</h2>
                          <div className="record-chip-row" aria-label="Run attributes">
                            <span className="record-chip">{selectedRun.client.replaceAll("_", " ")}</span>
                            <span className="record-chip">{selectedRun.capability.replaceAll("_", " ")}</span>
                            <span className="record-chip">{selectedRun.continuationMode} continuation</span>
                          </div>
                        </div>
                        <span className={`status status-${selectedRun.status}`}>{selectedRun.status.replaceAll("_", " ")}</span>
                      </header>
                      <div className="record-detail-body">
                      <section className={`record-state record-state-${selectedRun.status}`}>
                        <span className="record-state-icon"><BridgeIcon name={selectedRun.status === "waiting_for_human" ? "questions" : "runs"} size={20} /></span>
                        <div>
                          <strong>{selectedRun.status === "waiting_for_human" ? "Waiting for a human decision" : selectedRun.status === "running" ? "Work is in progress" : selectedRun.status === "completed" ? "Run completed" : selectedRun.status === "failed" ? "Run needs investigation" : "Run was cancelled"}</strong>
                          <p>{selectedRun.status === "waiting_for_human"
                            ? "Bridge has paused continuation at the human-approval boundary. The agent cannot approve or answer on the reviewer’s behalf."
                            : selectedRun.status === "running"
                              ? "The agent can continue within the approved context and policy boundaries."
                              : selectedRun.summary ?? "The durable run record preserves this outcome for later handoff."}</p>
                        </div>
                      </section>
                      <section className="record-section">
                        <div className="record-section-heading"><div><span>Traceability</span><h3>Run provenance</h3></div></div>
                        <dl className="record-meta-grid">
                          <div><dt>Agent</dt><dd title={selectedRun.agentId}>{displayIdentityName(selectedRun.agentId, principals)}</dd></div>
                          <div><dt>Started</dt><dd>{new Date(selectedRun.startedAt).toLocaleString()}</dd></div>
                          <div><dt>Last update</dt><dd>{new Date(selectedRun.updatedAt).toLocaleString()}</dd></div>
                          <div><dt>Scope</dt><dd>{Object.entries(selectedRun.scope).map(([key, value]) => `${key}: ${value}`).join(" · ") || "Project-wide"}</dd></div>
                          {selectedRun.endedAt ? <div><dt>Ended</dt><dd>{new Date(selectedRun.endedAt).toLocaleString()}</dd></div> : null}
                          {selectedRun.continuesRunId ? <div><dt>Continues run</dt><dd title={selectedRun.continuesRunId}>Linked predecessor</dd></div> : null}
                        </dl>
                      </section>
                      <section className="record-section">
                        <div className="record-section-heading"><div><span>Durable handoff</span><h3>Linked records</h3></div><small>Select a question to review it</small></div>
                        <div className="record-stat-grid">
                          <div className="record-stat"><strong>{selectedRun.contextSnapshotIds.length}</strong><span>Context snapshots</span></div>
                          {selectedRun.questionIds[0] ? (
                            <button
                              className="record-stat record-stat-button"
                              type="button"
                              onClick={() => {
                                setSelectedId(selectedRun.questionIds[0]);
                                setView("questions");
                              }}
                            ><strong>{selectedRun.questionIds.length}</strong><span>Questions</span><small>Open first question →</small></button>
                          ) : <div className="record-stat"><strong>0</strong><span>Questions</span></div>}
                          <div className="record-stat"><strong>{selectedRun.assumptionIds.length}</strong><span>Assumptions</span></div>
                          <div className="record-stat"><strong>{selectedRun.artifactVersionIds.length}</strong><span>Specification versions</span></div>
                        </div>
                      </section>
                      {selectedRun.summary ? (
                        <section className="record-section">
                          <div className="record-section-heading"><div><span>Recorded handoff</span><h3>Outcome summary</h3></div></div>
                          <p className="record-lead">{selectedRun.summary}</p>
                        </section>
                      ) : null}
                      {selectedRun.resultLinks.length > 0 ? (
                        <section className="record-section">
                          <div className="record-section-heading"><div><span>External evidence</span><h3>Result links</h3></div></div>
                          <div className="record-link-list">{selectedRun.resultLinks.map((link) => <a key={link} href={link} target="_blank" rel="noreferrer">{link}</a>)}</div>
                        </section>
                      ) : null}
                      </div>
                    </article>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : view !== "specifications" ? (
            <>
              <div className="title-row">
                <div>
                    <h1>{view === "inbox" ? "Needs your attention" : "All project questions"}</h1>
                    <p>{view === "inbox"
                    ? "Review the decisions and specifications waiting for a human response."
                    : "Shared questions remain visible to the whole project team; use My Inbox for questions routed to you."}</p>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void Promise.all([loadProjects(), loadQuestions(), loadArtifacts(), loadNotifications()])}
                >Refresh</button>
              </div>

              {view === "inbox" ? (
                <details className="filter-disclosure">
                  <summary>Filter inbox <span>{hasInboxFilters ? "Filters active" : "Optional"}</span></summary>
                  <div className="filter-bar" aria-label="Inbox filters">
                  <label htmlFor="inbox-status">State</label>
                  <select
                    id="inbox-status"
                    value={inboxFilters.status ?? ""}
                    onChange={(event) => updateInboxFilter("status", event.target.value)}
                  >
                    <option value="">All states</option>
                    <option value="open">Open</option>
                    <option value="in_discussion">In discussion</option>
                  </select>
                  <label htmlFor="inbox-risk">Risk</label>
                  <select
                    id="inbox-risk"
                    value={inboxFilters.risk ?? ""}
                    onChange={(event) => updateInboxFilter("risk", event.target.value)}
                  >
                    <option value="">All risk</option>
                    <option value="protected">Protected</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                  <label htmlFor="inbox-category">Category</label>
                  <select
                    id="inbox-category"
                    value={inboxFilters.category ?? ""}
                    onChange={(event) => updateInboxFilter("category", event.target.value)}
                  >
                    <option value="">All categories</option>
                    {inboxFilterOptions.categories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                  <label htmlFor="inbox-role">Role</label>
                  <select
                    id="inbox-role"
                    value={inboxFilters.role ?? ""}
                    onChange={(event) => updateInboxFilter("role", event.target.value)}
                  >
                    <option value="">All roles</option>
                    {inboxFilterOptions.roles.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                  <label htmlFor="inbox-due">Due</label>
                  <select
                    id="inbox-due"
                    value={inboxFilters.due ?? ""}
                    onChange={(event) => updateInboxFilter("due", event.target.value)}
                  >
                    <option value="">Any due date</option>
                    <option value="overdue">Overdue</option>
                    <option value="next_7_days">Next 7 days</option>
                    <option value="scheduled">All scheduled</option>
                    <option value="none">No due date</option>
                  </select>
                  {hasInboxFilters ? (
                    <button className="secondary" type="button" onClick={() => setInboxFilters({})}>Clear filters</button>
                  ) : null}
                  </div>
                </details>
              ) : null}

              {view === "inbox" && questionDigests.length > 0 ? (
                <details className="digest-disclosure">
                  <summary>Low-risk decision digests <span>{questionDigests.length} related {questionDigests.length === 1 ? "group" : "groups"}</span></summary>
                  <div className="digest-list">
                    {questionDigests.map((digest) => (
                      <article className="digest-card" key={digest.id}>
                        <div className="digest-heading">
                          <div><strong>{digest.category}</strong><small>{Object.entries(digest.scope).map(([field, value]) => `${field}: ${value}`).join(" · ") || "Project-wide"}</small></div>
                          <span>{digest.questionCount} questions</span>
                        </div>
                        <p>Grouped because these items are low risk, non-blocking, and share the same category and scope. Each still needs an individual human decision.</p>
                        <div className="digest-questions">
                          {digest.questions.map((question) => (
                            <button
                              className="text-button"
                              type="button"
                              key={question.id}
                              onClick={() => {
                                setInboxFilters({ risk: "low", category: digest.category });
                                setSelectedId(question.id);
                              }}
                            >
                              {question.title}{question.dueAt ? ` · ${new Date(question.dueAt).toLocaleDateString()}` : ""}
                            </button>
                          ))}
                        </div>
                        {digest.remainingQuestionCount > 0 ? <small>+ {digest.remainingQuestionCount} more in this digest</small> : null}
                      </article>
                    ))}
                  </div>
                </details>
              ) : null}

              {questionsLoading ? <div className="empty">Loading Bridge questions…</div> : null}
              {!questionsLoading && visibleQuestions.length === 0 ? (
                <div className="empty empty-state">
                  <span className="empty-icon"><BridgeIcon name={view === "inbox" ? "sparkle" : "questions"} size={23} /></span>
                  <h2>{view === "inbox"
                    ? hasInboxFilters ? "Nothing matches these filters" : "Your queue is clear"
                    : "No project questions yet"}</h2>
                  <p>{view === "inbox"
                    ? hasInboxFilters
                      ? "Clear a filter or browse the shared project queue to widen the view."
                      : "No question currently needs your authority. Shared work remains available in Questions."
                    : "Questions raised by agents and teammates will appear here with owner, risk, and approval context."}</p>
                  {view === "inbox" ? (
                    <button className="secondary" type="button" onClick={() => navigateTo("questions")}>Browse all questions</button>
                  ) : null}
                </div>
              ) : null}

              {!questionsLoading && visibleQuestions.length > 0 ? (
                <div className="decision-layout">
                  <div className="question-list" aria-label="Question inbox">
                    {visibleQuestions.map((question) => (
                      <button
                        type="button"
                        key={question.id}
                        className={question.id === selectedId ? "question-row selected" : "question-row"}
                        onClick={() => setSelectedId(question.id)}
                      >
                        <span className={`risk risk-${question.risk}`} aria-hidden="true" />
                        <span><strong>{question.title}</strong><small>{question.category} · {question.scope.component ?? "project"}{question.dueAt ? ` · ${question.dueStatus.replaceAll("_", " ")} ${new Date(question.dueAt).toLocaleDateString()}` : ""}{question.blockingEscalatedAt ? " · escalated" : ""}</small></span>
                        <span className={`status status-${question.status}`}>{question.status.replaceAll("_", " ")}</span>
                      </button>
                    ))}
                  </div>

                  {selectedQuestion ? (
                    <article className="question-detail record-detail question-workspace-detail">
                      <header className="record-detail-header">
                        <div className="record-title-block">
                          <span className="record-eyebrow">Governed question · {selectedQuestion.category.replaceAll("_", " ")}</span>
                          <h2>{selectedQuestion.title}</h2>
                          <div className="record-chip-row" aria-label="Question attributes">
                            <span className="record-chip">{selectedQuestion.risk} risk</span>
                            <span className="record-chip">{selectedQuestion.scope.component ?? "Project-wide"}</span>
                            <span className="record-chip">{selectedQuestion.policyAction.replaceAll("_", " ")}</span>
                          </div>
                        </div>
                        <span className={`status status-${selectedQuestion.status}`}>{selectedQuestion.status}</span>
                      </header>
                      <div className="record-detail-body">
                      <section className="record-section question-context-section">
                        <div className="record-section-heading"><div><span>Decision context</span><h3>What needs to be resolved</h3></div></div>
                        <p className="record-lead">{selectedQuestion.context}</p>
                        <div className="question-impact-panel"><span>Why it matters</span><p>{selectedQuestion.whyItMatters}</p></div>
                        <dl className="record-meta-grid question-authority-grid">
                          <div><dt>Accountable owner</dt><dd>{[...selectedQuestion.ownerIds.map((id) => displayIdentityName(id, principals)), ...selectedQuestion.ownerRoles].join(" · ") || "Project administrator"}</dd></div>
                          <div><dt>Review lane</dt><dd>{[...selectedQuestion.reviewerIds.map((id) => displayIdentityName(id, principals)), ...selectedQuestion.reviewerRoles].join(" · ") || "No separate reviewer"}</dd></div>
                          <div><dt>Policy</dt><dd title={selectedQuestion.policyRuleKey}>{selectedQuestion.policyAction.replaceAll("_", " ")} · version {selectedQuestion.policyVersion}</dd></div>
                          <div><dt>Scope</dt><dd>{Object.entries(selectedQuestion.scope).map(([field, value]) => `${field}: ${value}`).join(" · ") || "Project-wide"}</dd></div>
                          {selectedQuestion.dueAt ? <div><dt>Due</dt><dd>{new Date(selectedQuestion.dueAt).toLocaleString()} · {selectedQuestion.dueStatus.replaceAll("_", " ")}</dd></div> : null}
                          {selectedQuestion.blockingEscalatedAt ? <div><dt>Escalated</dt><dd>{new Date(selectedQuestion.blockingEscalatedAt).toLocaleString()}</dd></div> : null}
                        </dl>
                        {selectedQuestion.approvalStatus.requirements.length > 0 ? (
                          <div className="question-approval-progress">
                            <span>Human approval progress</span>
                            <strong>
                            {selectedQuestion.approvalStatus.requirements.map((requirement) =>
                              `${requirement.role} ${requirement.approvedCount}/${requirement.requiredCount} ${requirement.status}`).join(" · ")}
                            </strong>
                          </div>
                        ) : null}
                        {view === "inbox" && selectedQuestion.inboxReasons?.length ? (
                          <div className="inbox-reason">
                            <strong>Inbox routing:</strong> {selectedQuestion.inboxReasons.map((reason) => reason.replaceAll("_", " ")).join(" · ")}
                            {selectedQuestion.canAccept === false ? " · security review is also required before acceptance" : ""}
                          </div>
                        ) : null}
                      </section>

                      <details className="detail-disclosure detail-toolbox">
                        <summary>Context, provenance & routing <span className="section-count">{selectedQuestion.canRequestClarification || selectedQuestion.canReopen ? "4 tools" : "3 tools"}</span></summary>
                        <div className="detail-tool-grid">
                      <details className="nested-tool">
                        <summary>Explain for my role</summary>
                        <div className="audience-controls">
                          <label htmlFor="question-audience-role">Audience role
                            <select
                              id="question-audience-role"
                              value={questionAudienceRole}
                              onChange={(event) => {
                                setQuestionAudienceRole(event.target.value);
                                setQuestionAudienceView(undefined);
                              }}
                            >
                              {activeRoles.length === 0 ? <option value="project contributor">Project contributor</option> : null}
                              {activeRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                            </select>
                          </label>
                          <div className="audience-actions">
                            <button className="secondary" type="button" disabled={questionAudienceLoading} onClick={() => void loadQuestionAudienceView("explain")}>
                              {questionAudienceLoading ? "Loading…" : "Explain"}
                            </button>
                            <button className="secondary" type="button" disabled={questionAudienceLoading} onClick={() => void loadQuestionAudienceView("rewrite")}>
                              Rewrite for role
                            </button>
                          </div>
                        </div>
                        {questionAudienceView ? (
                          <div className="audience-view" aria-live="polite">
                            <small>Derived {questionAudienceView.mode} for {questionAudienceView.role}. The recorded question and human approval authority are unchanged.</small>
                            <h3>{questionAudienceView.presentation.title}</h3>
                            <p>{questionAudienceView.presentation.context}</p>
                            <div className="audience-focus"><strong>Focus on:</strong> {questionAudienceView.presentation.focusAreas.join(" · ")}</div>
                            <div className="impact"><strong>Why it matters:</strong> {questionAudienceView.presentation.whyItMatters}</div>
                            <p><strong>Review prompt:</strong> {questionAudienceView.presentation.reviewPrompt}</p>
                          </div>
                        ) : null}
                      </details>

                      <details className="nested-tool">
                        <summary>Provenance <span className="section-count">{selectedQuestion.runId ? "linked" : "direct"}</span></summary>
                        <div className="owner-routing"><strong>Scope:</strong> {Object.entries(selectedQuestion.scope).map(([field, value]) => `${field} ${value}`).join(" · ") || "Project-wide"}</div>
                        {selectedQuestion.runId ? (
                          <div className="owner-routing">
                            <strong>Agent run:</strong> <code>{selectedQuestion.runId}</code>
                            {runs.some((run) => run.id === selectedQuestion.runId) ? (
                              <button
                                className="text-button"
                                type="button"
                                onClick={() => {
                                  setSelectedRunId(selectedQuestion.runId);
                                  setView("runs");
                                }}
                              >Open run</button>
                            ) : <span className="muted-copy">Run details are outside the current list.</span>}
                          </div>
                        ) : <div className="muted-copy">No agent run was linked to this question.</div>}
                        {selectedQuestion.relatedLinks && selectedQuestion.relatedLinks.length > 0 ? (
                          <div className="owner-routing">
                            <strong>Related work:</strong>
                            <div className="link-list">
                              {selectedQuestion.relatedLinks.map((link) => (
                                <a key={`${link.type}-${link.url}`} href={link.url} target="_blank" rel="noreferrer">
                                  {link.label} <small>({link.type.replaceAll("_", " ")})</small>
                                </a>
                              ))}
                            </div>
                          </div>
                        ) : <div className="muted-copy">No related work links were supplied.</div>}
                      </details>

                      {selectedQuestion.canRequestClarification || selectedQuestion.canReopen ? (
                        <details className="nested-tool">
                          <summary>Discussion controls</summary>
                          {selectedQuestion.canRequestClarification ? (
                            <div className="response-form">
                              <h3>Request clarification</h3>
                              <p className="muted-copy">This moves an open question into discussion and records why the owner needs more information.</p>
                              <label htmlFor="clarification-reason">Reason</label>
                              <textarea
                                id="clarification-reason"
                                value={clarificationReason}
                                onChange={(event) => setClarificationReason(event.target.value)}
                                placeholder="Explain what information is still needed."
                              />
                              <button className="secondary" type="button" disabled={submitting || clarificationReason.trim().length < 10} onClick={() => void requestQuestionClarification()}>
                                {submitting ? "Requesting…" : "Request clarification"}
                              </button>
                            </div>
                          ) : null}
                          {selectedQuestion.canReopen ? (
                            <div className="response-form">
                              <h3>Reopen discussion</h3>
                              <p className="muted-copy">Only cancelled or expired questions can be reopened. An accepted decision remains authoritative until its own lifecycle changes.</p>
                              <label htmlFor="reopen-reason">Reason</label>
                              <textarea
                                id="reopen-reason"
                                value={reopenReason}
                                onChange={(event) => setReopenReason(event.target.value)}
                                placeholder="Explain why this unresolved question needs discussion again."
                              />
                              <button className="secondary" type="button" disabled={submitting || reopenReason.trim().length < 10} onClick={() => void reopenQuestion()}>
                                {submitting ? "Reopening…" : "Reopen discussion"}
                              </button>
                            </div>
                          ) : null}
                        </details>
                      ) : null}

                      <details className="nested-tool">
                        <summary>Assignment routing <span className="section-count">{selectedQuestion.assignmentHistory.length}</span></summary>
                        <div className="owner-routing"><strong>Current route:</strong> owner via {selectedQuestion.routing.ownerSource.replaceAll("_", " ")}{selectedQuestion.routing.ownerRuleKey ? ` (${selectedQuestion.routing.ownerRuleKey})` : ""} · reviewer via {selectedQuestion.routing.reviewerSource.replaceAll("_", " ")}{selectedQuestion.routing.reviewerRuleKey ? ` (${selectedQuestion.routing.reviewerRuleKey})` : ""} · ownership v{selectedQuestion.routing.ownershipVersion} · policy v{selectedQuestion.routing.policyVersion}</div>
                        <div className="response-list">
                          {selectedQuestion.assignmentHistory.map((assignment) => (
                            <article className="response-card" key={assignment.id}>
                              <div className="response-heading"><strong>{assignment.kind === "initial" ? "Initial route" : "Reassigned"}</strong><small>{new Date(assignment.createdAt).toLocaleString()}</small></div>
                              <small>By {assignment.changedById} · question v{assignment.questionVersion}</small>
                              <div className="response-rationale"><strong>Owners:</strong> {[...assignment.ownerIds, ...assignment.ownerRoles].join(", ") || "Administrator fallback"}</div>
                              <div className="response-rationale"><strong>Reviewers:</strong> {[...assignment.reviewerIds, ...assignment.reviewerRoles].join(", ") || "None"}</div>
                              {assignment.reason ? <div className="response-rationale"><strong>Reason:</strong> {assignment.reason}</div> : null}
                            </article>
                          ))}
                        </div>
                        {selectedQuestion.canReassign ? (
                          <form className="member-form-grid" onSubmit={(event) => void reassignQuestion(event)}>
                            <label>Owner member IDs<input name="assignmentOwnerIds" defaultValue={selectedQuestion.ownerIds.join(", ")} placeholder="usr_architect" /></label>
                            <label>Owner roles<input name="assignmentOwnerRoles" defaultValue={selectedQuestion.ownerRoles.join(", ")} placeholder="qa-lead" /></label>
                            <label>Reviewer member IDs<input name="assignmentReviewerIds" defaultValue={selectedQuestion.reviewerIds.join(", ")} placeholder="usr_qa_lead" /></label>
                            <label>Reviewer roles<input name="assignmentReviewerRoles" defaultValue={selectedQuestion.reviewerRoles.join(", ")} placeholder="architecture-reviewer" /></label>
                            <label>Reason<textarea name="assignmentReason" minLength={10} required placeholder="Explain why accountable ownership or review changed." /></label>
                            <div className="member-form-actions"><small>Active humans: {principals.map((principal) => principal.id).join(", ") || "none"}. Required policy roles are retained automatically.</small><button className="secondary" type="submit" disabled={submitting}>Reassign</button></div>
                          </form>
                        ) : null}
                      </details>
                        </div>
                      </details>

                      <section className="record-section question-options-section">
                        <div className="record-section-heading"><div><span>Available paths</span><h3>Compare options</h3></div><small>The recommendation remains advisory</small></div>
                        <div className="options">
                          {selectedQuestion.options.map((option) => (
                            <button
                              type="button"
                              className={option.key === selectedOption ? "option selected" : "option"}
                              key={option.key}
                              aria-pressed={option.key === selectedOption}
                              onClick={() => setSelectedOption(option.key)}
                              disabled={selectedQuestion.status === "accepted"}
                            >
                              <strong>{option.label}{option.key === selectedQuestion.recommendationKey ? <em>Agent recommendation</em> : null}</strong>
                              <span>{option.tradeoffs}</span>
                            </button>
                          ))}
                        </div>
                      </section>

                      <details className="detail-disclosure">
                        <summary>Team discussion <span className="section-count">{selectedQuestion.responses.length}</span></summary>
                        {selectedQuestion.responses.length === 0 ? (
                          <p className="muted-copy">No responses yet. Share your perspective so the decision owner can compare the trade-offs.</p>
                        ) : (
                          <div className="response-list">
                            {selectedQuestion.responses.map((response) => {
                              const responseOptionLabel = response.optionKey
                                ? selectedQuestion.options.find((option) => option.key === response.optionKey)?.label
                                : undefined;
                              const responseEditing = editingResponseId === response.id;
                              return (
                                <article className="response-card" key={response.id}>
                                  <div className="response-heading">
                                    <strong>{response.authorId}</strong>
                                    <small>{new Date(response.createdAt).toLocaleString()}</small>
                                  </div>
                                  {responseEditing ? (
                                    <div className="response-form">
                                      <label>Optional option
                                        <select value={editResponseOption ?? ""} onChange={(event) => setEditResponseOption(event.target.value || undefined)}>
                                          <option value="">Free-form answer</option>
                                          {selectedQuestion.options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                                        </select>
                                      </label>
                                      <label>Answer<textarea value={editResponseAnswer} onChange={(event) => setEditResponseAnswer(event.target.value)} /></label>
                                      <label>Why<textarea value={editResponseRationale} onChange={(event) => setEditResponseRationale(event.target.value)} /></label>
                                      <label>Mention human IDs (optional)<input value={editResponseMentionIds} onChange={(event) => setEditResponseMentionIds(event.target.value)} placeholder="usr_qa_lead, usr_architect" /></label>
                                      <div className="member-form-actions">
                                        <button className="secondary" type="button" disabled={submitting} onClick={() => void saveResponseEdit()}>Save edit</button>
                                        <button className="text-button" type="button" onClick={() => setEditingResponseId(undefined)}>Cancel</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      {responseOptionLabel ? <span className="response-option">Selected: {responseOptionLabel}</span> : null}
                                      <p>{response.answer}</p>
                                      <div className="response-rationale"><strong>Rationale:</strong> {response.rationale}</div>
                                      {response.mentionedPrincipalIds && response.mentionedPrincipalIds.length > 0 ? <small>Mentioned: {response.mentionedPrincipalIds.join(", ")}</small> : null}
                                      {response.revisionHistory && response.revisionHistory.length > 0 ? (
                                        <details className="nested-disclosure">
                                          <summary>Edit history <span className="section-count">{response.revisionHistory.length}</span></summary>
                                          {response.revisionHistory.map((revision) => (
                                            <div className="history-item" key={revision.id}><small>{new Date(revision.editedAt).toLocaleString()} · edited by {revision.editedById}</small><p>{revision.answer}</p><div className="response-rationale"><strong>Previous rationale:</strong> {revision.rationale}</div></div>
                                          ))}
                                        </details>
                                      ) : null}
                                      {selectedQuestion.editableResponseIds.includes(response.id) ? <button className="text-button" type="button" onClick={() => beginResponseEdit(response)}>Edit response</button> : null}
                                    </>
                                  )}
                                </article>
                              );
                            })}
                          </div>
                        )}
                        {selectedQuestion.status !== "accepted" ? (
                          <div className="response-form">
                            <label htmlFor="response-option">Optional option</label>
                            <select
                              id="response-option"
                              value={responseOption ?? ""}
                              onChange={(event) => setResponseOption(event.target.value || undefined)}
                            >
                              <option value="">Free-form answer</option>
                              {selectedQuestion.options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                            </select>
                            <label htmlFor="response-answer">Your answer</label>
                            <textarea
                              id="response-answer"
                              value={responseAnswer}
                              onChange={(event) => setResponseAnswer(event.target.value)}
                              placeholder="Share the answer you recommend."
                            />
                            <label htmlFor="response-rationale">Why</label>
                            <textarea
                              id="response-rationale"
                              value={responseRationale}
                              onChange={(event) => setResponseRationale(event.target.value)}
                              placeholder="Explain the trade-off or evidence behind your answer."
                            />
                            <label htmlFor="response-mentions">Mention human IDs (optional)</label>
                            <input
                              id="response-mentions"
                              value={responseMentionIds}
                              onChange={(event) => setResponseMentionIds(event.target.value)}
                              placeholder="usr_qa_lead, usr_architect"
                            />
                            <button
                              className="secondary"
                              type="button"
                              disabled={submitting || responseAnswer.trim().length < 2 || responseRationale.trim().length < 2}
                              onClick={() => void proposeAnswer()}
                            >
                              {submitting ? "Adding response…" : "Add response"}
                            </button>
                          </div>
                        ) : null}
                      </details>

                      <details className="detail-disclosure">
                        <summary>Clarifications <span className="section-count">{selectedQuestion.comments.length}</span></summary>
                        {selectedQuestion.comments.length === 0 ? (
                          <p className="muted-copy">No clarification thread yet. Ask a focused follow-up so the team can resolve missing context without reopening the agent session.</p>
                        ) : (
                          <div className="comment-list">
                            {selectedQuestion.comments.map((comment) => {
                              const parent = comment.parentCommentId
                                ? selectedQuestion.comments.find((candidate) => candidate.id === comment.parentCommentId)
                                : undefined;
                              const commentEditing = editingCommentId === comment.id;
                              return (
                                <article className={comment.parentCommentId ? "comment-card comment-reply" : "comment-card"} key={comment.id}>
                                  <div className="response-heading">
                                    <strong>{comment.authorId}</strong>
                                    <small>{new Date(comment.createdAt).toLocaleString()}</small>
                                  </div>
                                  {parent ? <small>Reply to {parent.authorId}</small> : null}
                                  {commentEditing ? (
                                    <div className="response-form">
                                      <label>Comment<textarea value={editCommentBody} onChange={(event) => setEditCommentBody(event.target.value)} /></label>
                                      <label>Mention human IDs (optional)<input value={editCommentMentionIds} onChange={(event) => setEditCommentMentionIds(event.target.value)} placeholder="usr_qa_lead, usr_architect" /></label>
                                      <div className="member-form-actions">
                                        <button className="secondary" type="button" disabled={submitting} onClick={() => void saveCommentEdit()}>Save edit</button>
                                        <button className="text-button" type="button" onClick={() => setEditingCommentId(undefined)}>Cancel</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <p>{comment.body}</p>
                                      {comment.mentionedPrincipalIds && comment.mentionedPrincipalIds.length > 0 ? <small>Mentioned: {comment.mentionedPrincipalIds.join(", ")}</small> : null}
                                      {comment.revisionHistory && comment.revisionHistory.length > 0 ? (
                                        <details className="nested-disclosure">
                                          <summary>Edit history <span className="section-count">{comment.revisionHistory.length}</span></summary>
                                          {comment.revisionHistory.map((revision) => (
                                            <div className="history-item" key={revision.id}><small>{new Date(revision.editedAt).toLocaleString()} · edited by {revision.editedById}</small><p>{revision.body}</p></div>
                                          ))}
                                        </details>
                                      ) : null}
                                      {selectedQuestion.editableCommentIds.includes(comment.id) ? <button className="text-button" type="button" onClick={() => beginCommentEdit(comment)}>Edit comment</button> : null}
                                      {selectedQuestion.status !== "accepted" ? (
                                        <button className="text-button" type="button" onClick={() => setReplyToCommentId(comment.id)}>
                                          Reply
                                        </button>
                                      ) : null}
                                    </>
                                  )}
                                </article>
                              );
                            })}
                          </div>
                        )}
                        {selectedQuestion.status !== "accepted" ? (
                          <div className="response-form">
                            {replyToCommentId ? (
                              <div className="replying-to">
                                Replying to {selectedQuestion.comments.find((comment) => comment.id === replyToCommentId)?.authorId ?? "comment"}
                                <button className="text-button" type="button" onClick={() => setReplyToCommentId(undefined)}>Cancel reply</button>
                              </div>
                            ) : null}
                            <label htmlFor="comment-body">Clarification or comment</label>
                            <textarea
                              id="comment-body"
                              value={commentBody}
                              onChange={(event) => setCommentBody(event.target.value)}
                              placeholder="Ask a focused follow-up or add evidence for the decision owner."
                            />
                            <label htmlFor="comment-mentions">Mention human IDs (optional)</label>
                            <input
                              id="comment-mentions"
                              value={commentMentionIds}
                              onChange={(event) => setCommentMentionIds(event.target.value)}
                              placeholder="usr_qa_lead, usr_architect"
                            />
                            <button
                              className="secondary"
                              type="button"
                              disabled={submitting || commentBody.trim().length < 2}
                              onClick={() => void addQuestionComment()}
                            >
                              {submitting ? "Posting comment…" : replyToCommentId ? "Post reply" : "Post clarification"}
                            </button>
                          </div>
                        ) : null}
                      </details>

                      {selectedQuestion.risk === "protected" ? (
                        <details className="detail-disclosure">
                          <summary>Protected policy review <span className="section-count">{selectedQuestion.reviews.length}</span></summary>
                          {selectedQuestion.reviews.length === 0 ? (
                            <p className="muted-copy">{selectedQuestion.requiredReviewerRoles.length > 0 ? `No policy review has been recorded. Required human roles: ${selectedQuestion.requiredReviewerRoles.join(", ")}.` : "This protected policy is satisfied by its required owner role and has no separate reviewer role."}</p>
                          ) : (
                            <div className="response-list">
                              {selectedQuestion.reviews.map((review) => (
                                <article className="response-card" key={review.id}>
                                  <div className="response-heading">
                                    <strong>{review.reviewerId}</strong>
                                    <span className={`status status-${review.status}`}>{review.status}</span>
                                  </div>
                                  <small>{new Date(review.createdAt).toLocaleString()} · {review.reviewerRole}</small>
                                  <div className="response-rationale"><strong>Rationale:</strong> {review.rationale}</div>
                                </article>
                              ))}
                            </div>
                          )}
                          {selectedQuestion.reviewRoles.length > 0 ? (
                            <div className="response-form">
                              <label htmlFor="review-status">Review outcome</label>
                              <select
                                id="review-status"
                                value={reviewStatus}
                                onChange={(event) => setReviewStatus(event.target.value as "approved" | "rejected")}
                              >
                                <option value="approved">Approve policy review</option>
                                <option value="rejected">Reject policy review</option>
                              </select>
                              <label htmlFor="review-rationale">Policy review rationale</label>
                              <textarea
                                id="review-rationale"
                                value={reviewRationale}
                                onChange={(event) => setReviewRationale(event.target.value)}
                                placeholder="Explain the evidence or gap for the required role."
                              />
                              <button
                                className="secondary"
                                type="button"
                                disabled={submitting || reviewRationale.trim().length < 10}
                                onClick={() => void reviewQuestion()}
                              >
                                {submitting ? "Recording review…" : "Record policy review"}
                              </button>
                            </div>
                          ) : null}
                          {selectedQuestion.approvalOverride ? (
                            <div className="accepted">
                              <strong>Administrative override recorded.</strong>{" "}
                              {selectedQuestion.approvalOverride.changedById} · {new Date(selectedQuestion.approvalOverride.createdAt).toLocaleString()}
                              <div>{selectedQuestion.approvalOverride.reason}</div>
                            </div>
                          ) : null}
                          {selectedQuestion.canOverrideApproval ? (
                            <div className="response-form">
                              <h3>Administrative approval override</h3>
                              <p className="muted-copy">Use only when the protected requirement cannot be satisfied through the configured human reviewer route. This action is audited under your identity.</p>
                              <label htmlFor="override-rationale">Decision rationale</label>
                              <textarea
                                id="override-rationale"
                                value={overrideRationale}
                                onChange={(event) => setOverrideRationale(event.target.value)}
                                placeholder="Explain the decision and the evidence supporting it."
                              />
                              <label htmlFor="override-reason">Override reason</label>
                              <textarea
                                id="override-reason"
                                value={overrideReason}
                                onChange={(event) => setOverrideReason(event.target.value)}
                                placeholder="Explain why the configured approval requirement cannot be completed."
                              />
                              <button
                                className="secondary"
                                type="button"
                                disabled={submitting || overrideRationale.trim().length < 10 || overrideReason.trim().length < 10}
                                onClick={() => void overrideQuestionApproval()}
                              >
                                {submitting ? "Recording override…" : "Accept with administrative override"}
                              </button>
                            </div>
                          ) : null}
                        </details>
                      ) : null}

                      {selectedQuestion.status === "accepted" ? (
                        <div className="accepted"><strong>Decision accepted.</strong> Future agent context requests can retrieve {selectedQuestion.decisionId}.</div>
                      ) : !selectedQuestion.canAccept ? (
                        <div className="owner-routing"><strong>Shared review only.</strong> Add a response here; the configured owner or required security reviewer must accept the decision from My Inbox.</div>
                      ) : (
                        <section className="approval-panel">
                          <div className="approval-heading">
                            <span><BridgeIcon name="decisions" size={20} /></span>
                            <div><h3>Human approval</h3><p>Accepting creates the authoritative Bridge decision. The agent recommendation remains advisory.</p></div>
                          </div>
                          <label htmlFor="rationale">Required decision rationale</label>
                          <textarea id="rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} />
                          <button className="primary" type="button" disabled={submitting || !selectedOption} onClick={() => void acceptDecision()}>
                            {submitting ? "Creating decision…" : "Accept selected answer"}
                          </button>
                        </section>
                      )}
                      </div>
                    </article>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="title-row">
                <div><span className="page-eyebrow">Governed documents</span><h1>Specification reviews</h1><p>Read agent-published drafts as clear documents, then review or approve one immutable version.</p></div>
                <button className="secondary" type="button" onClick={() => void Promise.all([loadArtifacts(), loadNotifications()])}>Refresh</button>
              </div>

              {artifactsLoading ? <div className="empty">Loading specifications…</div> : null}
              {!artifactsLoading && artifacts.length === 0 ? <div className="empty">No specifications have been published.</div> : null}

              {!artifactsLoading && artifacts.length > 0 ? (
                <div className="decision-layout specification-layout">
                  <div className="question-list specification-list" aria-label="Specification reviews">
                    {artifacts.map((artifact) => {
                      const version = currentVersion(artifact);
                      const displayedStatus = displayedArtifactStatus(version);
                      return (
                        <button
                          type="button"
                          key={artifact.id}
                          className={artifact.id === selectedArtifactId ? "question-row specification-row selected" : "question-row specification-row"}
                          onClick={() => setSelectedArtifactId(artifact.id)}
                        >
                          <span className="document-mark" aria-hidden="true"><BridgeIcon name="specifications" size={16} /></span>
                          <span><strong>{artifact.title}</strong><small>{artifact.type.replaceAll("_", " ")} · version {version?.version ?? "?"}</small></span>
                          <span className={`status status-${displayedStatus}`}>{displayedStatus.replaceAll("_", " ")}</span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedArtifact && selectedArtifactVersion ? (
                    <article className="question-detail specification-detail">
                      <header className="specification-header">
                        <div className="specification-title-block">
                          <span className="specification-type"><BridgeIcon name="specifications" size={15} />{selectedArtifact.type.replaceAll("_", " ")}</span>
                          <h2>{selectedArtifact.title}</h2>
                          <small title={selectedArtifact.id}>Immutable governed record · published {new Date(selectedArtifactVersion.createdAt).toLocaleDateString()}</small>
                        </div>
                        <div className="specification-state">
                          <span className={`status status-${displayedArtifactStatus(selectedArtifactVersion)}`}>{displayedArtifactStatus(selectedArtifactVersion).replaceAll("_", " ")}</span>
                          <span>Version {selectedArtifactVersion.version}</span>
                        </div>
                      </header>

                      <section className="specification-overview" aria-labelledby="review-brief-title">
                        <div className="spec-brief">
                          <div className="spec-brief-copy">
                            <span>Review brief</span>
                            <h3 id="review-brief-title">Agent summary</h3>
                            <p>{selectedArtifactVersion.summary}</p>
                          </div>
                          <div className="spec-approval-meter">
                            <span>Human approval</span>
                            <strong>{selectedArtifactVersion.approvalStatus.approvedCount}<small> / {selectedArtifactVersion.approvalStatus.requiredCount}</small></strong>
                            <div aria-hidden="true"><span style={{ width: `${Math.min(100, (selectedArtifactVersion.approvalStatus.approvedCount / Math.max(1, selectedArtifactVersion.approvalStatus.requiredCount)) * 100)}%` }} /></div>
                            <small>{selectedArtifactVersion.approvalStatus.remainingCount === 0 ? "Quorum complete" : `${selectedArtifactVersion.approvalStatus.remainingCount} remaining`}</small>
                          </div>
                        </div>
                        <dl className="spec-meta-line">
                          <div><dt>Publisher</dt><dd title={selectedArtifactVersion.createdById}>{displayIdentityName(selectedArtifactVersion.createdById, principals)}</dd></div>
                          <div><dt>Human reviewers</dt><dd title={selectedArtifactReviewerIds.join(", ")}>{selectedArtifactReviewerIds.map((reviewerId) => displayIdentityName(reviewerId, principals)).join(", ") || "Not assigned"}</dd></div>
                          <div><dt>Scope</dt><dd>{selectedArtifact.scope.component ?? selectedArtifact.scope.repository ?? "Project"}</dd></div>
                          <div><dt>Version</dt><dd>{selectedArtifactVersion.version}</dd></div>
                        </dl>
                        <details className="spec-routing-disclosure">
                          <summary>
                            <span>Reviewer assignment</span>
                            <small>{selectedArtifactVersion.reviewerAssignment?.routeSource.replaceAll("_", " ") ?? "Legacy record"}</small>
                          </summary>
                          {selectedArtifactVersion.reviewerAssignment ? (
                            <dl>
                              <div><dt>Route</dt><dd className="routing-source">{selectedArtifactVersion.reviewerAssignment.routeSource.replaceAll("_", " ")}</dd></div>
                              <div><dt>Ownership version</dt><dd>{selectedArtifactVersion.reviewerAssignment.ownershipVersion}</dd></div>
                              <div><dt>Route detail</dt><dd title={selectedArtifactVersion.reviewerAssignment.sourceAssignmentId ?? selectedArtifactVersion.reviewerAssignment.ownershipRuleKey}>{selectedArtifactVersion.reviewerAssignment.sourceAssignmentId ?? selectedArtifactVersion.reviewerAssignment.ownershipRuleKey ?? "Direct or fallback"}</dd></div>
                              <div><dt>Assignment</dt><dd title={selectedArtifactVersion.reviewerAssignment.id}>{selectedArtifactVersion.reviewerAssignment.id}</dd></div>
                            </dl>
                          ) : (
                            <p>This version predates immutable reviewer routing. Bridge is showing the artifact's current reviewer list as a compatibility fallback.</p>
                          )}
                        </details>
                      </section>

                      <section className="specification-reader" aria-labelledby="specification-document-title">
                        <div className="spec-reader-heading">
                          <span className="reader-mark"><BridgeIcon name="specifications" size={18} /></span>
                          <div><span>Readable document</span><h3 id="specification-document-title">Specification content</h3></div>
                          <span className="reader-mode">Rendered Markdown</span>
                        </div>
                        <div className="spec-paper"><MarkdownDocument headingLevelOffset={1} omitLeadingHeading source={selectedArtifactVersion.body} /></div>
                        <details className="spec-source-disclosure">
                          <summary>View immutable Markdown source <span>Technical view</span></summary>
                          <pre className="spec-source">{selectedArtifactVersion.body}</pre>
                        </details>
                      </section>

                      <div className="specification-controls">

                      <details className="detail-disclosure">
                        <summary>Review feedback <span className="section-count">{selectedArtifactVersion.reviews.length}</span></summary>
                        {selectedArtifactVersion.reviews.length === 0 ? (
                          <p className="muted-copy">No reviewer feedback has been recorded for this version.</p>
                        ) : (
                          <div className="response-list">
                            {selectedArtifactVersion.reviews.map((review) => (
                              <article className="response-card" key={review.id}>
                                <div className="response-heading">
                                  <strong>{review.reviewerId}</strong>
                                  <span className={`status status-${review.status}`}>{review.status.replaceAll("_", " ")}</span>
                                </div>
                                <small>{new Date(review.createdAt).toLocaleString()}</small>
                                <p>{review.body}</p>
                              </article>
                            ))}
                          </div>
                        )}
                        {canReviewSelectedArtifact && ["draft", "in_review"].includes(selectedArtifactVersion.status) ? (
                          <div className="response-form">
                            <label htmlFor="artifact-review-status">Review action</label>
                            <select
                              id="artifact-review-status"
                              value={artifactReviewStatus}
                              onChange={(event) => setArtifactReviewStatus(event.target.value as typeof artifactReviewStatus)}
                            >
                              <option value="commented">Add review comment</option>
                              <option value="changes_requested">Request changes</option>
                            </select>
                            <label htmlFor="artifact-review-body">Feedback</label>
                            <textarea
                              id="artifact-review-body"
                              value={artifactReviewBody}
                              onChange={(event) => setArtifactReviewBody(event.target.value)}
                              placeholder="Add evidence or describe an actionable specification change."
                            />
                            <button
                              className="secondary"
                              type="button"
                              disabled={submitting || artifactReviewBody.trim().length < (artifactReviewStatus === "changes_requested" ? 10 : 2)}
                              onClick={() => void reviewSpecification()}
                            >{submitting ? "Recording feedback…" : artifactReviewStatus === "changes_requested" ? "Request changes" : "Post review comment"}</button>
                          </div>
                        ) : null}
                      </details>

                      <details className="detail-disclosure">
                        <summary>Compare immutable versions</summary>
                        {selectedArtifact.versions.length < 2 ? (
                          <p className="muted-copy">Publish another version to compare specification changes.</p>
                        ) : (
                          <>
                            <div className="diff-controls">
                              <label htmlFor="artifact-diff-from">From</label>
                              <select
                                id="artifact-diff-from"
                                value={artifactDiffFromVersionId}
                                onChange={(event) => {
                                  setArtifactDiffFromVersionId(event.target.value);
                                  setArtifactDiff(undefined);
                                }}
                              >
                                {selectedArtifact.versions.map((version) => (
                                  <option key={version.id} value={version.id}>
                                    Version {version.version} · {displayedArtifactStatus(version).replaceAll("_", " ")}
                                  </option>
                                ))}
                              </select>
                              <label htmlFor="artifact-diff-to">To</label>
                              <select
                                id="artifact-diff-to"
                                value={artifactDiffToVersionId}
                                onChange={(event) => {
                                  setArtifactDiffToVersionId(event.target.value);
                                  setArtifactDiff(undefined);
                                }}
                              >
                                {selectedArtifact.versions.map((version) => (
                                  <option key={version.id} value={version.id}>
                                    Version {version.version} · {displayedArtifactStatus(version).replaceAll("_", " ")}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="secondary"
                                type="button"
                                disabled={
                                  artifactDiffLoading ||
                                  !artifactDiffFromVersionId ||
                                  !artifactDiffToVersionId ||
                                  artifactDiffFromVersionId === artifactDiffToVersionId
                                }
                                onClick={() => void loadArtifactDiff()}
                              >{artifactDiffLoading ? "Comparing…" : "Compare"}</button>
                            </div>
                            {artifactDiff ? (
                              <div className="artifact-diff">
                                <div className="diff-summary">
                                  <strong>Version {artifactDiff.from.version} → {artifactDiff.to.version}</strong>
                                  <span className="diff-added">+{artifactDiff.counts.added}</span>
                                  <span className="diff-removed">−{artifactDiff.counts.removed}</span>
                                  <span>{artifactDiff.counts.unchanged} unchanged</span>
                                </div>
                                <div className="diff-version-meta">
                                  <span>
                                    <strong>From version {artifactDiff.from.version}</strong>
                                    {artifactDiff.from.summary}
                                    <small>{artifactDiff.from.createdById} · {new Date(artifactDiff.from.createdAt).toLocaleString()}</small>
                                  </span>
                                  <span>
                                    <strong>To version {artifactDiff.to.version}</strong>
                                    {artifactDiff.to.summary}
                                    <small>{artifactDiff.to.createdById} · {new Date(artifactDiff.to.createdAt).toLocaleString()}</small>
                                  </span>
                                </div>
                                {!artifactDiff.exact ? (
                                  <div className="impact"><strong>Large comparison.</strong> The changed middle is shown as bounded removals and additions to protect server and browser performance.</div>
                                ) : null}
                                {artifactDiff.truncated ? (
                                  <div className="impact"><strong>Display limited.</strong> Showing {artifactDiff.lines.length} of {artifactDiff.totalLines} diff lines.</div>
                                ) : null}
                                <div className="diff-view" role="table" aria-label={`Specification diff from version ${artifactDiff.from.version} to ${artifactDiff.to.version}`}>
                                  {artifactDiff.lines.map((line, index) => (
                                    <div className={`diff-line diff-line-${line.kind}`} role="row" key={`${line.kind}-${index}`}>
                                      <span className="diff-line-number" role="cell">{line.oldLineNumber ?? ""}</span>
                                      <span className="diff-line-number" role="cell">{line.newLineNumber ?? ""}</span>
                                      <span className="diff-marker" aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
                                      <code role="cell">{line.text || " "}</code>
                                    </div>
                                  ))}
                                </div>
                                <p className="muted-copy">Changed Markdown appears as adjacent removed and added lines. Stored version bodies remain immutable.</p>
                              </div>
                            ) : null}
                          </>
                        )}
                      </details>

                      <details className="detail-disclosure">
                        <summary>Version history</summary>
                        <div className="version-list">
                          {[...selectedArtifact.versions].reverse().map((version) => (
                            <div key={version.id}>
                              <strong>Version {version.version}</strong>
                              <span className={`status status-${displayedArtifactStatus(version)}`}>{displayedArtifactStatus(version).replaceAll("_", " ")}</span>
                              <small>{version.id}</small>
                            </div>
                          ))}
                        </div>
                      </details>

                      {selectedArtifactVersion.status === "approved" ? (
                        <div className="accepted">
                          <strong>Specification approved by {selectedArtifactVersion.approvedById}.</strong>
                          {selectedArtifactVersion.approvalRationale}
                        </div>
                      ) : selectedArtifactHasChangesRequested ? (
                        <div className="impact">
                          <strong>Changes requested.</strong> This immutable version cannot be approved. Publish a new version that addresses the feedback.
                        </div>
                      ) : canReviewSelectedArtifact && activePrincipalApprovedSelectedArtifact ? (
                        <div className="impact">
                          <strong>Your approval is recorded.</strong> {selectedArtifactVersion.approvalStatus.remainingCount} more distinct human approval{selectedArtifactVersion.approvalStatus.remainingCount === 1 ? " is" : "s are"} required.
                        </div>
                      ) : canReviewSelectedArtifact ? (
                        <section className="approval-panel specification-approval-panel">
                          <div className="approval-heading">
                            <span><BridgeIcon name="decisions" size={20} /></span>
                            <div><h3>Human specification approval</h3><p>Your approval applies only to immutable version {selectedArtifactVersion.version}. Agent publication does not grant approval authority.</p></div>
                          </div>
                          <label htmlFor="approval-rationale">Required approval rationale</label>
                          <textarea
                            id="approval-rationale"
                            value={approvalRationale}
                            onChange={(event) => setApprovalRationale(event.target.value)}
                          />
                          <button
                            className="primary"
                            type="button"
                            disabled={submitting || approvalRationale.trim().length < 10}
                            onClick={() => void approveSpecification()}
                          >
                            {submitting ? "Recording approval…" : `Record approval for version ${selectedArtifactVersion.version}`}
                          </button>
                        </section>
                      ) : (
                        <div className="owner-routing"><strong>Shared review only.</strong> A configured specification reviewer or project administrator must approve this version.</div>
                      )}
                      </div>
                    </article>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
