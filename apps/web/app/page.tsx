"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_BRIDGE_API_URL ?? "http://127.0.0.1:4000";
const defaultPrincipalId = "usr_architect";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly decisionOwnerIds: readonly string[];
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

interface QuestionResponse {
  readonly id: string;
  readonly authorId: string;
  readonly answer: string;
  readonly rationale: string;
  readonly optionKey?: string;
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
  readonly createdAt: string;
}

interface Question {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly context: string;
  readonly whyItMatters: string;
  readonly risk: "low" | "medium" | "high" | "protected";
  readonly blocking: boolean;
  readonly options: readonly Option[];
  readonly recommendationKey?: string;
  readonly ownerIds: readonly string[];
  readonly ownerRoles: readonly string[];
  readonly status: string;
  readonly decisionId?: string;
  readonly responses: readonly QuestionResponse[];
  readonly reviews: readonly QuestionReview[];
  readonly comments: readonly QuestionComment[];
  readonly acceptedResponseId?: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly version: number;
  readonly inboxReasons?: readonly string[];
  readonly canAccept?: boolean;
}

type InboxFilterKey = "status" | "risk" | "category" | "role";
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
  readonly approvedById?: string;
  readonly approvalRationale?: string;
  readonly approvedAt?: string;
}

interface ArtifactReview {
  readonly id: string;
  readonly reviewerId: string;
  readonly status: "commented" | "changes_requested";
  readonly body: string;
  readonly createdAt: string;
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
    | "question_response"
    | "question_comment"
    | "question_review"
    | "question_accepted"
    | "decision_lifecycle"
    | "artifact_review_requested"
    | "artifact_review_feedback"
    | "artifact_approved";
  readonly title: string;
  readonly body: string;
  readonly targetType: "question" | "response" | "comment" | "review" | "decision" | "artifact" | "artifact_version";
  readonly targetId: string;
  readonly createdAt: string;
  readonly readAt?: string;
}

interface Decision {
  readonly id: string;
  readonly questionId: string;
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
  readonly assumptionIds: readonly string[];
  readonly runIds: readonly string[];
  readonly workItems: readonly string[];
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
  readonly resolutionRationale?: string;
  readonly version: number;
}

interface AgentRun {
  readonly id: string;
  readonly agentId: string;
  readonly client: string;
  readonly capability: string;
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
  readonly createdAt: string;
}

interface AuditPage {
  readonly items: readonly AuditRecord[];
  readonly offset: number;
  readonly limit: number;
  readonly totalMatching: number;
  readonly nextOffset?: number;
}

type AuditFilterKey = "action" | "actorId" | "subjectType" | "subjectId" | "correlationId" | "createdFrom" | "createdTo";
type AuditFilters = Partial<Record<AuditFilterKey, string>>;

type View =
  | "inbox"
  | "questions"
  | "specifications"
  | "notifications"
  | "decisions"
  | "assumptions"
  | "runs"
  | "organization"
  | "analytics"
  | "audit"
  | "support";

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
  const [principals, setPrincipals] = useState<readonly Principal[]>([]);
  const [authentication, setAuthentication] = useState<AuthenticationConfiguration>();
  const [authenticationReady, setAuthenticationReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [activePrincipalId, setActivePrincipalId] = useState(defaultPrincipalId);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [questions, setQuestions] = useState<readonly Question[]>([]);
  const [inboxQuestions, setInboxQuestions] = useState<readonly Question[]>([]);
  const [inboxFilters, setInboxFilters] = useState<InboxFilters>({});
  const [decisionFilters, setDecisionFilters] = useState<DecisionFilters>({});
  const [decisionSearchDraft, setDecisionSearchDraft] = useState("");
  const [artifacts, setArtifacts] = useState<readonly Artifact[]>([]);
  const [notifications, setNotifications] = useState<readonly Notification[]>([]);
  const [decisions, setDecisions] = useState<readonly Decision[]>([]);
  const [assumptions, setAssumptions] = useState<readonly Assumption[]>([]);
  const [runs, setRuns] = useState<readonly AgentRun[]>([]);
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
  const [responseOption, setResponseOption] = useState<string>();
  const [responseAnswer, setResponseAnswer] = useState("");
  const [responseRationale, setResponseRationale] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [replyToCommentId, setReplyToCommentId] = useState<string>();
  const [reviewStatus, setReviewStatus] = useState<"approved" | "rejected">("approved");
  const [reviewRationale, setReviewRationale] = useState("");
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
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [artifactsLoading, setArtifactsLoading] = useState(true);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [referenceDataLoading, setReferenceDataLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [supportLoading, setSupportLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditExporting, setAuditExporting] = useState(false);
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
  const isProjectAdmin = activeRoles.some((role) => normalizedRole(role) === "project-admin");
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
    roles: [...new Set(questions.flatMap((question) => question.ownerRoles))].sort((left, right) => left.localeCompare(right)),
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

  const loadQuestions = useCallback(async () => {
    if (!selectedProjectId) {
      setQuestions([]);
      setInboxQuestions([]);
      setQuestionsLoading(false);
      return;
    }
    setQuestionsLoading(true);
    setError(undefined);
    try {
      const inboxQuery = new URLSearchParams(
        Object.entries(inboxFilters).filter((entry): entry is [string, string] => Boolean(entry[1])),
      ).toString();
      const [questionsResponse, inboxResponse] = await Promise.all([
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
      ]);
      setQuestions(questionsResponse.items);
      setInboxQuestions(inboxResponse.items);
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
  }, [activePrincipalId, inboxFilters, selectedProjectId]);

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

  const loadReferenceData = useCallback(async () => {
    if (!selectedProjectId) {
      setDecisions([]);
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
      const [decisionResponse, assumptionResponse, runResponse] = await Promise.all([
        bridgeFetch<{ items: readonly Decision[] }>(
          `/v1/projects/${selectedProjectId}/decisions${decisionQuery ? `?${decisionQuery}` : ""}`,
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
    for (const key of ["action", "actorId", "subjectType", "subjectId", "correlationId"] as const) {
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
      for (const key of ["action", "actorId", "subjectType", "subjectId", "correlationId"] as const) {
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
    if (["inbox", "questions", "specifications", "notifications", "decisions", "assumptions", "runs", "organization", "analytics", "audit", "support"].includes(requestedView ?? "")) {
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
  }, []);

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
    if (authenticationReady && signedIn && view === "analytics") void loadAnalytics();
  }, [authenticationReady, loadAnalytics, signedIn, view]);

  useEffect(() => {
    if (authenticationReady && signedIn && view === "support") void loadSupport();
  }, [authenticationReady, loadSupport, signedIn, view]);

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
  const selectedQuestionInboxItem = useMemo(
    () => (selectedQuestion ? inboxQuestions.find((question) => question.id === selectedQuestion.id) : undefined),
    [inboxQuestions, selectedQuestion],
  );
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId),
    [artifacts, selectedArtifactId],
  );
  const selectedArtifactVersion = currentVersion(selectedArtifact);
  const canReviewSelectedArtifact = Boolean(
    selectedArtifact && activePrincipal &&
    (selectedArtifact.reviewerIds.includes(activePrincipalId) || activeRoles.includes("project-admin")),
  );
  const selectedArtifactHasChangesRequested = Boolean(
    selectedArtifactVersion?.reviews.some((review) => review.status === "changes_requested"),
  );
  const selectedDecision = useMemo(
    () => decisions.find((decision) => decision.id === selectedDecisionId) ?? decisions[0],
    [decisions, selectedDecisionId],
  );
  const selectedAssumption = useMemo(
    () => assumptions.find((assumption) => assumption.id === selectedAssumptionId) ?? assumptions[0],
    [assumptions, selectedAssumptionId],
  );
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0],
    [runs, selectedRunId],
  );
  const viewTitle: Record<View, string> = {
    inbox: "My Inbox",
    questions: "Questions",
    specifications: "Specifications",
    notifications: "Notifications",
    decisions: "Decisions",
    assumptions: "Assumptions",
    runs: "Agent Runs",
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
      setCommentBody("");
      setReplyToCommentId(undefined);
      setReviewStatus("approved");
      setReviewRationale("");
    }
  }, [selectedQuestion]);

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
        }),
      }, activePrincipalId);
      setResponseAnswer("");
      setResponseRationale("");
      setResponseOption(undefined);
      await Promise.all([loadQuestions(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to add your response.");
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
        }),
      }, activePrincipalId);
      setCommentBody("");
      setReplyToCommentId(undefined);
      await Promise.all([loadQuestions(), loadNotifications()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to add clarification comment.");
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
        <div className="brand"><span>B</span> Bridge</div>
        <div className="project">
          <label htmlFor="bridge-project"><small>Project</small></label>
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
        {authentication?.mode === "development" ? (
          <div className="reviewer">
            <label htmlFor="bridge-reviewer"><small>Reviewing as</small></label>
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
            <small>{activeRoles.join(" · ") || "Loading reviewer roles…"}</small>
          </div>
        ) : null}
        <nav aria-label="Bridge navigation">
          <button
            type="button"
            aria-current={view === "inbox" ? "page" : undefined}
            onClick={() => setView("inbox")}
          >Inbox <span>{pendingQuestions}</span></button>
          <button
            type="button"
            aria-current={view === "notifications" ? "page" : undefined}
            onClick={() => setView("notifications")}
          >Notifications <span>{pendingNotifications}</span></button>
          <button
            type="button"
            aria-current={view === "questions" ? "page" : undefined}
            onClick={() => setView("questions")}
          >Questions</button>
          <button
            type="button"
            aria-current={view === "decisions" ? "page" : undefined}
            onClick={() => setView("decisions")}
          >Decisions</button>
          <button
            type="button"
            aria-current={view === "specifications" ? "page" : undefined}
            onClick={() => setView("specifications")}
          >Specifications <span>{pendingSpecifications}</span></button>
          <button
            type="button"
            aria-current={view === "assumptions" ? "page" : undefined}
            onClick={() => setView("assumptions")}
          >Assumptions</button>
          <button
            type="button"
            aria-current={view === "runs" ? "page" : undefined}
            onClick={() => setView("runs")}
          >Agent Runs</button>
          {isOrganizationAdmin ? (
            <button
              type="button"
              aria-current={view === "organization" ? "page" : undefined}
              onClick={() => setView("organization")}
            >Organization</button>
          ) : null}
          <button
            type="button"
            aria-current={view === "analytics" ? "page" : undefined}
            onClick={() => setView("analytics")}
          >Analytics</button>
          {isOrganizationAdmin || isProjectAdmin ? (
            <button
              type="button"
              aria-current={view === "audit" ? "page" : undefined}
              onClick={() => setView("audit")}
            >Audit</button>
          ) : null}
          {isOrganizationAdmin || isProjectAdmin ? (
            <button
              type="button"
              aria-current={view === "support" ? "page" : undefined}
              onClick={() => setView("support")}
            >Support</button>
          ) : null}
        </nav>
        <div className="identity">
          <strong>{activePrincipal?.displayName ?? "Bridge member"}</strong>
          <small>{authentication?.mode === "oidc" ? "Authenticated member" : "Development identity"}</small>
          {authentication?.mode === "oidc" && authentication.logoutUrl ? (
            <a href={authentication.logoutUrl}>Sign out</a>
          ) : null}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <strong>{viewTitle[view]}</strong>
          <span>{view === "organization"
            ? "Member access and roles"
            : view === "support"
              ? "Pilot health and operator signals"
            : view === "audit" && auditScope === "organization"
              ? "Organization metadata events"
              : selectedProject?.name ?? "Select a project"}</span>
        </header>
        <div className="content">
          {error ? <div className="error" role="alert">{error}</div> : null}

          {view === "support" ? (
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
                            <span><strong>{decision.category} decision</strong><small>Owner {decision.ownerId} · review due {new Date(decision.reviewAt).toLocaleDateString()}</small></span>
                            <span className="status status-rejected">overdue</span>
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
                      <div><h2>Repository diagnostics</h2><p>Latest bounded <code>bridge doctor</code> results are stored per adapter. Bridge keeps check names, statuses, capabilities, and timestamps—not URLs, errors, or repository content.</p></div>
                      <small>{support.diagnostics.length} adapter{support.diagnostics.length === 1 ? "" : "s"}</small>
                    </div>
                    {support.diagnostics.length === 0 ? <div className="empty">No bridge doctor reports are recorded.</div> : (
                      <div className="analytics-table-wrap">
                        <table className="analytics-table support-table">
                          <thead><tr><th>Client</th><th>Status</th><th>MCP</th><th>Checks</th><th>Observed</th></tr></thead>
                          <tbody>{support.diagnostics.map((diagnostic) => (
                            <tr key={diagnostic.client}>
                              <td><strong>{diagnostic.client.replaceAll("_", " ")}</strong><small>{diagnostic.capabilities.join(", ") || "No capabilities"}</small></td>
                              <td><span className={diagnostic.status === "pass" ? "status status-approved" : "status status-rejected"}>{diagnostic.status}</span></td>
                              <td>{diagnostic.mcpStatus.replaceAll("_", " ")}</td>
                              <td>{diagnostic.checks.map((check) => `${check.name}: ${check.status}`).join(" · ")}</td>
                              <td>{new Date(diagnostic.observedAt).toLocaleString()}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                  </section>
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
                  <form
                    className="organization-panel member-create-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void createOrganizationMember();
                    }}
                  >
                    <div className="organization-panel-heading">
                      <div><h2>Add an OIDC member</h2><p>The subject must match the configured identity provider exactly.</p></div>
                    </div>
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
                              <div><h3>{selectedOrganizationMember.displayName}</h3><small>{selectedOrganizationMember.oidcSubject}</small></div>
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
                  <button className="secondary" type="button" disabled={auditExporting} onClick={() => void exportAudit("json")}>Export JSON</button>
                  <button className="secondary" type="button" disabled={auditExporting} onClick={() => void exportAudit("csv")}>Export CSV</button>
                  <button className="secondary" type="button" disabled={auditLoading} onClick={() => void loadAudit(0)}>Refresh</button>
                </div>
              </div>
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
                <label>Subject type<input value={auditFilters.subjectType ?? ""} onChange={(event) => updateAuditFilter("subjectType", event.target.value)} placeholder="artifact_version" /></label>
                <label>Subject ID<input value={auditFilters.subjectId ?? ""} onChange={(event) => updateAuditFilter("subjectId", event.target.value)} /></label>
                <label>Correlation ID<input value={auditFilters.correlationId ?? ""} onChange={(event) => updateAuditFilter("correlationId", event.target.value)} /></label>
                <label>Created from<input type="date" value={auditFilters.createdFrom ?? ""} onChange={(event) => updateAuditFilter("createdFrom", event.target.value)} /></label>
                <label>Created to<input type="date" value={auditFilters.createdTo ?? ""} onChange={(event) => updateAuditFilter("createdTo", event.target.value)} /></label>
              </div>
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
                      <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Subject</th><th>Correlation</th></tr></thead>
                      <tbody>{auditPage.items.map((event) => (
                        <tr key={event.id}>
                          <td>{new Date(event.createdAt).toLocaleString()}</td>
                          <td><strong>{event.action}</strong><small>{event.actorType}</small></td>
                          <td><code>{event.actorId}</code></td>
                          <td><strong>{event.subjectType}</strong><code>{event.subjectId}</code></td>
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
                        className={decision.id === selectedDecision?.id ? "question-row selected" : "question-row"}
                        onClick={() => setSelectedDecisionId(decision.id)}
                      >
                        <span className="document-mark" aria-hidden="true">✓</span>
                        <span><strong>{decision.answer}</strong><small>{decision.category} · {decision.scope.component ?? "project"}</small></span>
                        <span className={`status status-${decision.status}`}>{decision.status}</span>
                      </button>
                    ))}
                  </div>
                  {selectedDecision ? (
                    <article className="question-detail">
                      <div className="detail-heading">
                        <div><small>{selectedDecision.id} · {selectedDecision.category}</small><h2>{selectedDecision.answer}</h2></div>
                        <span className={`status status-${selectedDecision.status}`}>{selectedDecision.status}</span>
                      </div>
                      <section><h3>Decision rationale</h3><p>{selectedDecision.rationale}</p></section>
                      <section>
                        <h3>Authority and review</h3>
                        <div className="spec-meta">
                          <span>Accepted by {selectedDecision.ownerId}</span>
                          <span>Accepted {new Date(selectedDecision.createdAt).toLocaleString()}</span>
                          <span>Review by {new Date(selectedDecision.reviewAt).toLocaleDateString()}</span>
                        </div>
                      </section>
                      {selectedDecision.lifecycleChangedAt ? (
                        <section>
                          <h3>Lifecycle history</h3>
                          <p>{selectedDecision.lifecycleRationale}</p>
                          <div className="spec-meta">
                            <span>Changed by {selectedDecision.lifecycleChangedById}</span>
                            <span>{new Date(selectedDecision.lifecycleChangedAt).toLocaleString()}</span>
                            {selectedDecision.replacementDecisionId ? <span>Replacement {selectedDecision.replacementDecisionId}</span> : null}
                          </div>
                        </section>
                      ) : null}
                      {selectedDecision.status === "active" ? (
                        <section className="response-form">
                          <h3>Retire this decision</h3>
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
                            className="primary"
                            type="button"
                            disabled={submitting || decisionLifecycleRationale.trim().length < 10 || (decisionLifecycleStatus === "superseded" && !replacementDecisionId)}
                            onClick={() => void changeDecisionLifecycle()}
                          >Apply lifecycle change</button>
                        </section>
                      ) : null}
                      {decisionLifecycleImpact ? (
                        <section>
                          <h3>Potentially affected records</h3>
                          <p className="impact">
                            {decisionLifecycleImpact.artifactIds.length} specification(s), {decisionLifecycleImpact.assumptionIds.length} assumption(s), {decisionLifecycleImpact.runIds.length} agent run(s), and {decisionLifecycleImpact.workItems.length} work item(s).
                          </p>
                        </section>
                      ) : null}
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => {
                          setSelectedId(selectedDecision.questionId);
                          setView("questions");
                        }}
                      >Open source question</button>
                    </article>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : view === "assumptions" ? (
            <>
              <div className="title-row">
                <div><h1>Visible project assumptions</h1><p>Assumptions are temporary premises with explicit risk, expiry, and reversal cost.</p></div>
                <button className="secondary" type="button" onClick={() => void loadReferenceData()}>Refresh</button>
              </div>
              {referenceDataLoading ? <div className="empty">Loading assumptions…</div> : null}
              {!referenceDataLoading && assumptions.length === 0 ? <div className="empty">No assumptions have been recorded for this project.</div> : null}
              {!referenceDataLoading && assumptions.length > 0 ? (
                <div className="decision-layout">
                  <div className="question-list" aria-label="Project assumptions">
                    {assumptions.map((assumption) => (
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
                    <article className="question-detail">
                      <div className="detail-heading">
                        <div><small>{selectedAssumption.id} · version {selectedAssumption.version}</small><h2>{selectedAssumption.statement}</h2></div>
                        <span className={`status status-${selectedAssumption.status}`}>{selectedAssumption.status}</span>
                      </div>
                      <section><h3>Rationale</h3><p>{selectedAssumption.rationale}</p></section>
                      <section>
                        <h3>Risk and reversibility</h3>
                        <div className="impact"><strong>Reversal cost:</strong> {selectedAssumption.reversalCost}</div>
                        <div className="spec-meta">
                          <span>Risk: {selectedAssumption.risk}</span>
                          <span>Confidence: {selectedAssumption.confidence}</span>
                          <span>Expires: {new Date(selectedAssumption.expiresAt).toLocaleString()}</span>
                          <span>Created by {selectedAssumption.createdById}</span>
                        </div>
                      </section>
                      {selectedAssumption.resolutionRationale ? (
                        <section><h3>Resolution</h3><p>{selectedAssumption.resolutionRationale}</p></section>
                      ) : null}
                      {selectedAssumption.runId ? (
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => {
                            setSelectedRunId(selectedAssumption.runId);
                            setView("runs");
                          }}
                        >Open source run</button>
                      ) : null}
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
                        className={run.id === selectedRun?.id ? "question-row selected" : "question-row"}
                        onClick={() => setSelectedRunId(run.id)}
                      >
                        <span className="document-mark" aria-hidden="true">↻</span>
                        <span><strong>{run.taskSummary}</strong><small>{run.client} · {run.capability} · version {run.version}</small></span>
                        <span className={`status status-${run.status}`}>{run.status.replaceAll("_", " ")}</span>
                      </button>
                    ))}
                  </div>
                  {selectedRun ? (
                    <article className="question-detail">
                      <div className="detail-heading">
                        <div><small>{selectedRun.id} · {selectedRun.client}</small><h2>{selectedRun.taskSummary}</h2></div>
                        <span className={`status status-${selectedRun.status}`}>{selectedRun.status.replaceAll("_", " ")}</span>
                      </div>
                      <section>
                        <h3>Run provenance</h3>
                        <div className="spec-meta">
                          <span>Agent: {selectedRun.agentId}</span>
                          <span>Capability: {selectedRun.capability}</span>
                          <span>Started: {new Date(selectedRun.startedAt).toLocaleString()}</span>
                          <span>Updated: {new Date(selectedRun.updatedAt).toLocaleString()}</span>
                        </div>
                      </section>
                      <section>
                        <h3>Linked records</h3>
                        <div className="spec-meta">
                          <span>{selectedRun.contextSnapshotIds.length} context snapshots</span>
                          <span>{selectedRun.questionIds.length} questions</span>
                          <span>{selectedRun.assumptionIds.length} assumptions</span>
                          <span>{selectedRun.artifactVersionIds.length} specification versions</span>
                        </div>
                      </section>
                      {selectedRun.summary ? <section><h3>Outcome</h3><p>{selectedRun.summary}</p></section> : null}
                      {selectedRun.questionIds[0] ? (
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => {
                            setSelectedId(selectedRun.questionIds[0]);
                            setView("questions");
                          }}
                        >Open linked question</button>
                      ) : null}
                    </article>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : view !== "specifications" ? (
            <>
              <div className="title-row">
                <div>
                  <h1>{view === "inbox" ? "Decisions needing your authority" : "All project questions"}</h1>
                  <p>{view === "inbox"
                    ? "Agent recommendations remain advisory until a human owner accepts an answer."
                    : "Shared questions remain visible to the whole project team; use My Inbox for questions routed to you."}</p>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void Promise.all([loadProjects(), loadQuestions(), loadArtifacts(), loadNotifications()])}
                >Refresh</button>
              </div>

              {view === "inbox" ? (
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
                  {hasInboxFilters ? (
                    <button className="secondary" type="button" onClick={() => setInboxFilters({})}>Clear filters</button>
                  ) : null}
                </div>
              ) : null}

              {questionsLoading ? <div className="empty">Loading Bridge questions…</div> : null}
              {!questionsLoading && visibleQuestions.length === 0 ? (
                <div className="empty">
                  {view === "inbox"
                    ? hasInboxFilters
                      ? "No questions match these inbox filters. Clear a filter or open Questions to browse the shared project queue."
                      : "No questions need your authority right now. Open Questions to browse the shared project queue."
                    : "No questions have been raised for this project."}
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
                        <span><strong>{question.title}</strong><small>{question.category} · {question.scope.component ?? "project"}</small></span>
                        <span className={`status status-${question.status}`}>{question.status.replaceAll("_", " ")}</span>
                      </button>
                    ))}
                  </div>

                  {selectedQuestion ? (
                    <article className="question-detail">
                      <div className="detail-heading">
                        <div><small>{selectedQuestion.id} · {selectedQuestion.category}</small><h2>{selectedQuestion.title}</h2></div>
                        <span className={`status status-${selectedQuestion.status}`}>{selectedQuestion.status}</span>
                      </div>

                      <section>
                        <h3>Context and impact</h3>
                        <p>{selectedQuestion.context}</p>
                        <div className="impact"><strong>Why it matters:</strong> {selectedQuestion.whyItMatters}</div>
                        {selectedQuestion.ownerRoles.length > 0 ? (
                          <div className="owner-routing"><strong>Assigned roles:</strong> {selectedQuestion.ownerRoles.join(", ")}</div>
                        ) : null}
                        {view === "inbox" && selectedQuestion.inboxReasons?.length ? (
                          <div className="inbox-reason">
                            <strong>Inbox routing:</strong> {selectedQuestion.inboxReasons.map((reason) => reason.replaceAll("_", " ")).join(" · ")}
                            {selectedQuestion.canAccept === false ? " · security review is also required before acceptance" : ""}
                          </div>
                        ) : null}
                      </section>

                      <section>
                        <h3>Options</h3>
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

                      <section>
                        <h3>Team discussion <span className="section-count">{selectedQuestion.responses.length}</span></h3>
                        {selectedQuestion.responses.length === 0 ? (
                          <p className="muted-copy">No responses yet. Share your perspective so the decision owner can compare the trade-offs.</p>
                        ) : (
                          <div className="response-list">
                            {selectedQuestion.responses.map((response) => {
                              const responseOptionLabel = response.optionKey
                                ? selectedQuestion.options.find((option) => option.key === response.optionKey)?.label
                                : undefined;
                              return (
                                <article className="response-card" key={response.id}>
                                  <div className="response-heading">
                                    <strong>{response.authorId}</strong>
                                    <small>{new Date(response.createdAt).toLocaleString()}</small>
                                  </div>
                                  {responseOptionLabel ? <span className="response-option">Selected: {responseOptionLabel}</span> : null}
                                  <p>{response.answer}</p>
                                  <div className="response-rationale"><strong>Rationale:</strong> {response.rationale}</div>
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
                      </section>

                      <section>
                        <h3>Clarifications <span className="section-count">{selectedQuestion.comments.length}</span></h3>
                        {selectedQuestion.comments.length === 0 ? (
                          <p className="muted-copy">No clarification thread yet. Ask a focused follow-up so the team can resolve missing context without reopening the agent session.</p>
                        ) : (
                          <div className="comment-list">
                            {selectedQuestion.comments.map((comment) => {
                              const parent = comment.parentCommentId
                                ? selectedQuestion.comments.find((candidate) => candidate.id === comment.parentCommentId)
                                : undefined;
                              return (
                                <article className={comment.parentCommentId ? "comment-card comment-reply" : "comment-card"} key={comment.id}>
                                  <div className="response-heading">
                                    <strong>{comment.authorId}</strong>
                                    <small>{new Date(comment.createdAt).toLocaleString()}</small>
                                  </div>
                                  {parent ? <small>Reply to {parent.authorId}</small> : null}
                                  <p>{comment.body}</p>
                                  {selectedQuestion.status !== "accepted" ? (
                                    <button className="text-button" type="button" onClick={() => setReplyToCommentId(comment.id)}>
                                      Reply
                                    </button>
                                  ) : null}
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
                      </section>

                      {selectedQuestion.risk === "protected" ? (
                        <section>
                          <h3>Security review <span className="section-count">{selectedQuestion.reviews.length}</span></h3>
                          {selectedQuestion.reviews.length === 0 ? (
                            <p className="muted-copy">No security review has been recorded. A separate security reviewer must approve or reject this protected question before the owner can accept it.</p>
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
                          {selectedQuestion.status !== "accepted" && activeRoles.includes("security-reviewer") && !selectedQuestion.reviews.some((review) => review.reviewerId === activePrincipalId) ? (
                            <div className="response-form">
                              <label htmlFor="review-status">Review outcome</label>
                              <select
                                id="review-status"
                                value={reviewStatus}
                                onChange={(event) => setReviewStatus(event.target.value as "approved" | "rejected")}
                              >
                                <option value="approved">Approve security review</option>
                                <option value="rejected">Reject security review</option>
                              </select>
                              <label htmlFor="review-rationale">Security review rationale</label>
                              <textarea
                                id="review-rationale"
                                value={reviewRationale}
                                onChange={(event) => setReviewRationale(event.target.value)}
                                placeholder="Explain the security evidence or gap."
                              />
                              <button
                                className="secondary"
                                type="button"
                                disabled={submitting || reviewRationale.trim().length < 10}
                                onClick={() => void reviewQuestion()}
                              >
                                {submitting ? "Recording review…" : "Record security review"}
                              </button>
                            </div>
                          ) : null}
                        </section>
                      ) : null}

                      {selectedQuestion.status === "accepted" ? (
                        <div className="accepted"><strong>Decision accepted.</strong> Future agent context requests can retrieve {selectedQuestion.decisionId}.</div>
                      ) : !selectedQuestionInboxItem?.canAccept ? (
                        <div className="owner-routing"><strong>Shared review only.</strong> Add a response here; the configured owner or required security reviewer must accept the decision from My Inbox.</div>
                      ) : (
                        <section>
                          <label htmlFor="rationale"><h3>Required decision rationale</h3></label>
                          <textarea id="rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} />
                          <button className="primary" type="button" disabled={submitting || !selectedOption} onClick={() => void acceptDecision()}>
                            {submitting ? "Creating decision…" : "Accept selected answer"}
                          </button>
                        </section>
                      )}
                    </article>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="title-row">
                <div><h1>Review agent-generated specifications</h1><p>Draft bodies are immutable; approval applies to one explicit version.</p></div>
                <button className="secondary" type="button" onClick={() => void Promise.all([loadArtifacts(), loadNotifications()])}>Refresh</button>
              </div>

              {artifactsLoading ? <div className="empty">Loading specifications…</div> : null}
              {!artifactsLoading && artifacts.length === 0 ? <div className="empty">No specifications have been published.</div> : null}

              {!artifactsLoading && artifacts.length > 0 ? (
                <div className="decision-layout">
                  <div className="question-list" aria-label="Specification reviews">
                    {artifacts.map((artifact) => {
                      const version = currentVersion(artifact);
                      const displayedStatus = displayedArtifactStatus(version);
                      return (
                        <button
                          type="button"
                          key={artifact.id}
                          className={artifact.id === selectedArtifactId ? "question-row selected" : "question-row"}
                          onClick={() => setSelectedArtifactId(artifact.id)}
                        >
                          <span className="document-mark" aria-hidden="true">§</span>
                          <span><strong>{artifact.title}</strong><small>{artifact.type.replaceAll("_", " ")} · version {version?.version ?? "?"}</small></span>
                          <span className={`status status-${displayedStatus}`}>{displayedStatus.replaceAll("_", " ")}</span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedArtifact && selectedArtifactVersion ? (
                    <article className="question-detail specification-detail">
                      <div className="detail-heading">
                        <div><small>{selectedArtifact.id} · {selectedArtifact.type.replaceAll("_", " ")} · version {selectedArtifactVersion.version}</small><h2>{selectedArtifact.title}</h2></div>
                        <span className={`status status-${displayedArtifactStatus(selectedArtifactVersion)}`}>{displayedArtifactStatus(selectedArtifactVersion).replaceAll("_", " ")}</span>
                      </div>

                      <section>
                        <h3>Version summary</h3>
                        <p>{selectedArtifactVersion.summary}</p>
                        <div className="spec-meta">
                          <span>Published by {selectedArtifactVersion.createdById}</span>
                          <span>Reviewers: {selectedArtifact.reviewerIds.join(", ")}</span>
                          <span>Scope: {selectedArtifact.scope.component ?? selectedArtifact.scope.repository ?? "project"}</span>
                        </div>
                      </section>

                      <section>
                        <h3>Specification body</h3>
                        <pre className="spec-body">{selectedArtifactVersion.body}</pre>
                      </section>

                      <section>
                        <h3>Review feedback <span className="section-count">{selectedArtifactVersion.reviews.length}</span></h3>
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
                      </section>

                      <section>
                        <h3>Compare immutable versions</h3>
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
                      </section>

                      <section>
                        <h3>Version history</h3>
                        <div className="version-list">
                          {[...selectedArtifact.versions].reverse().map((version) => (
                            <div key={version.id}>
                              <strong>Version {version.version}</strong>
                              <span className={`status status-${displayedArtifactStatus(version)}`}>{displayedArtifactStatus(version).replaceAll("_", " ")}</span>
                              <small>{version.id}</small>
                            </div>
                          ))}
                        </div>
                      </section>

                      {selectedArtifactVersion.status === "approved" ? (
                        <div className="accepted">
                          <strong>Specification approved by {selectedArtifactVersion.approvedById}.</strong>
                          {selectedArtifactVersion.approvalRationale}
                        </div>
                      ) : selectedArtifactHasChangesRequested ? (
                        <div className="impact">
                          <strong>Changes requested.</strong> This immutable version cannot be approved. Publish a new version that addresses the feedback.
                        </div>
                      ) : canReviewSelectedArtifact ? (
                        <section>
                          <label htmlFor="approval-rationale"><h3>Required approval rationale</h3></label>
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
                            {submitting ? "Approving version…" : `Approve version ${selectedArtifactVersion.version}`}
                          </button>
                        </section>
                      ) : (
                        <div className="owner-routing"><strong>Shared review only.</strong> A configured specification reviewer or project administrator must approve this version.</div>
                      )}
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
