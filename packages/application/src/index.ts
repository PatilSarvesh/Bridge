import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type {
  AcceptAnswerInput,
  ApproveArtifactVersionInput,
  ArtifactReviewInput,
  ChangeDecisionLifecycleInput,
  ContextQuery,
  CreateQuestionInput,
  FindQuestionMatchesInput,
  PublishArtifactInput,
  ProposeAnswerInput,
  QuestionCommentInput,
  RecordAssumptionInput,
  RegisterProjectInput,
  ReportAgentRunInput,
  ResolveAssumptionInput,
  Scope,
  StartAgentRunInput,
  NotificationListQuery,
  NotificationReadAllInput,
  QuestionReviewInput,
  QuestionInboxQuery,
  QuestionSubmissionDisposition,
} from "@bridge/contracts";
import {
  assertCanApproveArtifact,
  assertCanReviewArtifact,
  assertCanAccept,
  assertHuman,
  assertProjectAccess,
  canAcceptQuestion,
  questionInboxReasons,
  BridgeError,
  normalizeRoleName,
  reviewDateFor,
  type AgentRun,
  type Assumption,
  type AuditEvent,
  type Artifact,
  type ArtifactReview,
  type ArtifactVersion,
  type ContextItem,
  type ContextSnapshot,
  type Decision,
  type Principal,
  type Project,
  type Question,
  type QuestionComment,
  type QuestionInboxItem,
  type QuestionReview,
  type QuestionResponse,
  type Notification,
  type OutboxEvent,
} from "@bridge/domain";

export interface BridgeRepository {
  transaction<T>(work: (repository: BridgeRepository) => Promise<T>): Promise<T>;
  getProject(projectId: string): Promise<Project | undefined>;
  listProjects(organizationId: string): Promise<readonly Project[]>;
  saveProject(project: Project): Promise<void>;
  getRun(runId: string): Promise<AgentRun | undefined>;
  listRuns(projectId: string): Promise<readonly AgentRun[]>;
  saveRun(run: AgentRun): Promise<void>;
  findIdempotentRun(key: string): Promise<AgentRun | undefined>;
  getIdempotentRunRequestHash(key: string): Promise<string | undefined>;
  saveIdempotentRun(key: string, runId: string, requestHash: string): Promise<void>;
  getRunContinuationKey(runId: string): Promise<string | undefined>;
  saveRunContinuationKey(runId: string, resumeContextKey: string): Promise<void>;
  getAssumption(assumptionId: string): Promise<Assumption | undefined>;
  listAssumptions(projectId: string): Promise<readonly Assumption[]>;
  saveAssumption(assumption: Assumption): Promise<void>;
  findIdempotentAssumption(key: string): Promise<Assumption | undefined>;
  getIdempotentAssumptionRequestHash(key: string): Promise<string | undefined>;
  saveIdempotentAssumption(key: string, assumptionId: string, requestHash: string): Promise<void>;
  getQuestion(questionId: string): Promise<Question | undefined>;
  listQuestions(projectId: string): Promise<readonly Question[]>;
  saveQuestion(question: Question): Promise<void>;
  findIdempotentQuestion(key: string): Promise<Question | undefined>;
  saveIdempotentQuestion(key: string, questionId: string, requestHash: string): Promise<void>;
  getIdempotentRequestHash(key: string): Promise<string | undefined>;
  getDecision(decisionId: string): Promise<Decision | undefined>;
  listDecisions(projectId: string): Promise<readonly Decision[]>;
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
  getNotification(notificationId: string): Promise<Notification | undefined>;
  listNotifications(
    organizationId: string,
    recipientId: string,
    projectId?: string,
    unreadOnly?: boolean,
  ): Promise<readonly Notification[]>;
  saveNotification(notification: Notification): Promise<void>;
  listOutboxEvents(projectId?: string): Promise<readonly OutboxEvent[]>;
  saveOutboxEvent(event: OutboxEvent): Promise<void>;
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
  readonly assumptionIds: readonly string[];
  readonly runIds: readonly string[];
  readonly workItems: readonly string[];
}

export interface DecisionLifecycleChange {
  readonly decision: Decision;
  readonly impact: DecisionLifecycleImpact;
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

interface NotificationDraft {
  readonly type: Notification["type"];
  readonly title: string;
  readonly body: string;
  readonly targetType: Notification["targetType"];
  readonly targetId: string;
}

export type QuestionSubmission = Question & {
  readonly submissionDisposition: QuestionSubmissionDisposition;
};

export class InMemoryBridgeRepository implements BridgeRepository {
  private readonly projects = new Map<string, Project>();
  private readonly runs = new Map<string, AgentRun>();
  private readonly assumptions = new Map<string, Assumption>();
  private readonly questions = new Map<string, Question>();
  private readonly decisions = new Map<string, Decision>();
  private readonly artifacts = new Map<string, Artifact>();
  private readonly contextSnapshots = new Map<string, ContextSnapshot>();
  private readonly auditEvents = new Map<string, AuditEvent>();
  private readonly notifications = new Map<string, Notification>();
  private readonly outboxEvents = new Map<string, OutboxEvent>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly artifactIdempotency = new Map<string, ArtifactIdempotencyRecord>();
  private readonly runIdempotency = new Map<string, RunIdempotencyRecord>();
  private readonly assumptionIdempotency = new Map<string, AssumptionIdempotencyRecord>();
  private readonly runContinuationKeys = new Map<string, string>();
  private transactionTail: Promise<void> = Promise.resolve();

  async transaction<T>(work: (repository: BridgeRepository) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const snapshot = {
      projects: new Map(this.projects),
      runs: new Map(this.runs),
      assumptions: new Map(this.assumptions),
      questions: new Map(this.questions),
      decisions: new Map(this.decisions),
      artifacts: new Map(this.artifacts),
      contextSnapshots: new Map(this.contextSnapshots),
      auditEvents: new Map(this.auditEvents),
      notifications: new Map(this.notifications),
      outboxEvents: new Map(this.outboxEvents),
      idempotency: new Map(this.idempotency),
      artifactIdempotency: new Map(this.artifactIdempotency),
      runIdempotency: new Map(this.runIdempotency),
      assumptionIdempotency: new Map(this.assumptionIdempotency),
      runContinuationKeys: new Map(this.runContinuationKeys),
    };

    try {
      return await work(this);
    } catch (error) {
      this.restoreMap(this.projects, snapshot.projects);
      this.restoreMap(this.runs, snapshot.runs);
      this.restoreMap(this.assumptions, snapshot.assumptions);
      this.restoreMap(this.questions, snapshot.questions);
      this.restoreMap(this.decisions, snapshot.decisions);
      this.restoreMap(this.artifacts, snapshot.artifacts);
      this.restoreMap(this.contextSnapshots, snapshot.contextSnapshots);
      this.restoreMap(this.auditEvents, snapshot.auditEvents);
      this.restoreMap(this.notifications, snapshot.notifications);
      this.restoreMap(this.outboxEvents, snapshot.outboxEvents);
      this.restoreMap(this.idempotency, snapshot.idempotency);
      this.restoreMap(this.artifactIdempotency, snapshot.artifactIdempotency);
      this.restoreMap(this.runIdempotency, snapshot.runIdempotency);
      this.restoreMap(this.assumptionIdempotency, snapshot.assumptionIdempotency);
      this.restoreMap(this.runContinuationKeys, snapshot.runContinuationKeys);
      throw error;
    } finally {
      release();
    }
  }

  private restoreMap<Key, Value>(target: Map<Key, Value>, source: Map<Key, Value>): void {
    target.clear();
    for (const [key, value] of source) target.set(key, value);
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

  async saveRunContinuationKey(runId: string, resumeContextKey: string): Promise<void> {
    this.runContinuationKeys.set(runId, resumeContextKey);
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

  async listOutboxEvents(projectId?: string): Promise<readonly OutboxEvent[]> {
    return [...this.outboxEvents.values()]
      .filter((event) => !projectId || event.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async saveOutboxEvent(event: OutboxEvent): Promise<void> {
    this.outboxEvents.set(event.id, event);
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
  readonly now?: () => Date;
  readonly id?: () => string;
  readonly resumeKey?: () => string;
}

export class BridgeService {
  private readonly publicBaseUrl: string;
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly resumeKey: () => string;

  constructor(
    private readonly repository: BridgeRepository,
    options: BridgeServiceOptions = {},
  ) {
    this.publicBaseUrl = options.publicBaseUrl ?? "http://localhost:3000";
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
    this.resumeKey = options.resumeKey ?? (() => randomBytes(32).toString("base64url"));
  }

  private recordUrl(parameters: Readonly<Record<string, string>>): string {
    const url = new URL(this.publicBaseUrl);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return url.toString();
  }

  async registerProject(
    principal: Principal,
    input: RegisterProjectInput,
  ): Promise<ProjectRegistration> {
    return this.repository.transaction(async (repository) => {
      assertHuman(principal, "Registering a project");
      if (!principal.roles.includes("project-admin")) {
        throw new BridgeError("FORBIDDEN", "Project registration requires a project administrator.", 403);
      }
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
          throw new BridgeError(
            "CONFLICT",
            "The project registration key was reused with different project details.",
            409,
          );
        }
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
      return { project, disposition: "created" };
    });
  }

  async listProjects(principal: Principal): Promise<readonly Project[]> {
    const projects = await this.repository.listProjects(principal.organizationId);
    return projects.filter((project) => {
      try {
        assertProjectAccess(principal, project);
        return true;
      } catch {
        return false;
      }
    });
  }

  async getProject(principal: Principal, projectId: string): Promise<Project> {
    return this.requireProject(principal, projectId);
  }

  async listNotifications(
    principal: Principal,
    query: Partial<NotificationListQuery> = {},
  ): Promise<readonly Notification[]> {
    assertHuman(principal, "Reading notifications");
    if (query.projectId) await this.requireProject(principal, query.projectId);
    const notifications = await this.repository.listNotifications(
      principal.organizationId,
      principal.id,
      query.projectId,
      query.unreadOnly,
    );
    if (query.projectId) return notifications;
    const accessibleProjectIds = new Set(
      (await this.repository.listProjects(principal.organizationId))
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
  }

  async markNotificationRead(principal: Principal, notificationId: string): Promise<Notification> {
    return this.repository.transaction(async (repository) => {
      assertHuman(principal, "Marking a notification read");
      const notification = await repository.getNotification(notificationId);
      if (
        !notification ||
        notification.organizationId !== principal.organizationId ||
        notification.recipientId !== principal.id
      ) {
        throw new BridgeError("NOTIFICATION_NOT_FOUND", "Notification not found.", 404);
      }
      await this.requireProject(principal, notification.projectId, repository);
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
    return this.repository.transaction(async (repository) => {
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

  async startRun(
    principal: Principal,
    projectId: string,
    input: StartAgentRunInput,
  ): Promise<RunRegistration> {
    return this.repository.transaction((repository) =>
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

    const idempotencyKey = `run:${principal.organizationId}:${principal.id}:${input.idempotencyKey}`;
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = await repository.findIdempotentRun(idempotencyKey);
    if (existing) {
      const existingHash = await repository.getIdempotentRunRequestHash(idempotencyKey);
      if (existingHash !== requestHash) {
        throw new BridgeError("CONFLICT", "The idempotency key was reused with a different request.", 409);
      }
      const existingKey = await repository.getRunContinuationKey(existing.id);
      if (!existingKey) {
        throw new BridgeError("CONFLICT", "The run continuation locator is no longer available.", 409);
      }
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
    await repository.saveRunContinuationKey(run.id, resumeContextKey);
    await repository.saveIdempotentRun(idempotencyKey, run.id, requestHash);
    await this.audit(repository, principal, projectId, "run.started", "run", run.id, timestamp);
    return { run, resumeContextKey };
  }

  async listRuns(principal: Principal, projectId: string): Promise<readonly AgentRun[]> {
    await this.requireProject(principal, projectId);
    return this.repository.listRuns(projectId);
  }

  async getRun(principal: Principal, runId: string): Promise<AgentRun> {
    return this.requireRun(principal, runId, this.repository);
  }

  async reportRun(
    principal: Principal,
    runId: string,
    input: ReportAgentRunInput,
  ): Promise<AgentRun> {
    return this.repository.transaction((repository) =>
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
      (principal.type === "human" && principal.roles.includes("project-admin"));
    if (!mayOperate) {
      throw new BridgeError("FORBIDDEN", "Only the run principal or a project administrator can update this run.", 403);
    }
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
    return this.repository.transaction(async (repository) => {
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
    return this.repository.transaction((repository) =>
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
    const protectedCategories = new Set([
      "security",
      "privacy",
      "authentication",
      "legal",
      "production-deletion",
    ]);
    if (protectedCategories.has(input.category.toLowerCase())) {
      throw new BridgeError(
        "POLICY_BLOCKED",
        "Protected uncertainty requires an explicit human decision and cannot be recorded as an assumption.",
        403,
      );
    }
    if (input.risk !== "low" || !input.reversible) {
      throw new BridgeError(
        "POLICY_BLOCKED",
        "Only low-risk, reversible uncertainty can be recorded as an assumption.",
        403,
      );
    }
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
        throw new BridgeError("CONFLICT", "The idempotency key was reused with a different request.", 409);
      }
      return existing;
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
    await this.audit(repository, principal, projectId, "assumption.recorded", "assumption", assumption.id, timestamp);
    return assumption;
  }

  async listAssumptions(principal: Principal, projectId: string): Promise<readonly Assumption[]> {
    return this.repository.transaction(async (repository) => {
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
    return this.repository.transaction(async (repository) => {
      const assumption = await this.requireAssumption(principal, assumptionId, repository);
      return this.expireAssumptionIfDue(repository, principal, assumption);
    });
  }

  async resolveAssumption(
    principal: Principal,
    assumptionId: string,
    input: ResolveAssumptionInput,
  ): Promise<Assumption> {
    return this.repository.transaction(async (repository) => {
      assertHuman(principal, "Resolving an assumption");
      const assumption = await this.requireAssumption(principal, assumptionId, repository);
      const project = await this.requireProject(principal, assumption.projectId, repository);
      if (!project.decisionOwnerIds.includes(principal.id) && !principal.roles.includes("project-admin")) {
        throw new BridgeError(
          "FORBIDDEN",
          "Only a configured decision owner or project administrator can resolve an assumption.",
          403,
        );
      }
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

      const timestamp = this.now().toISOString();
      const updated: Assumption = {
        ...assumption,
        status: input.status,
        resolvedById: principal.id,
        resolvedAt: timestamp,
        resolutionRationale: input.rationale,
        ...(input.confirmedDecisionId ? { confirmedDecisionId: input.confirmedDecisionId } : {}),
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
    return this.repository.transaction((repository) =>
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
    const protectedCategories = new Set(["security", "privacy", "authentication", "legal", "production-deletion"]);
    const effectiveRisk = protectedCategories.has(input.category) ? "protected" : input.risk;
    if (effectiveRisk === "protected" && input.fallback) {
      throw new BridgeError(
        "POLICY_BLOCKED",
        "Protected questions cannot define an automatic fallback.",
        403,
      );
    }

    const idempotencyKey = `${principal.organizationId}:${principal.id}:${input.idempotencyKey}`;
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = await repository.findIdempotentQuestion(idempotencyKey);
    if (existing) {
      const existingHash = await repository.getIdempotentRequestHash(idempotencyKey);
      if (existingHash !== requestHash) {
        throw new BridgeError("CONFLICT", "The idempotency key was reused with a different request.", 409);
      }
      return { ...existing, submissionDisposition: "idempotent_replay" };
    }

    const timestamp = this.now().toISOString();
    const ownerRoles = [...new Set(input.intendedOwnerRoles.map(normalizeRoleName).filter(Boolean))];
    const ownerIds = input.intendedOwnerIds.length > 0
      ? [...input.intendedOwnerIds]
      : ownerRoles.length > 0
        ? []
        : [...project.decisionOwnerIds];
    if (ownerIds.length === 0 && ownerRoles.length === 0) {
      throw new BridgeError("POLICY_BLOCKED", "No decision owner or assigned role can be resolved for this question.", 422);
    }
    const sourceRun = input.runId
      ? await this.requireLinkableRun(principal, input.runId, repository)
      : undefined;

    const effectiveBlocking = input.blocking || effectiveRisk === "protected";
    const reusable = await this.findReusableQuestion(
      repository,
      projectId,
      input,
      effectiveRisk,
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
      );
      return {
        ...reusable,
        submissionDisposition: reusable.status === "accepted" ? "reused_accepted" : "reused_pending",
      };
    }

    const question: Question = {
      id: `qst_${this.id()}`,
      organizationId: principal.organizationId,
      projectId,
      ...(input.runId ? { runId: input.runId } : {}),
      title: input.title,
      type: input.type,
      category: input.category,
      context: input.context,
      whyItMatters: input.whyItMatters,
      risk: effectiveRisk,
      reversible: input.reversible,
      blocking: effectiveBlocking,
      ownerIds: [...ownerIds],
      ownerRoles,
      options: input.options.map((option) => ({ ...option })),
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
    await this.audit(repository, principal, projectId, "question.created", "question", question.id, timestamp);
    await this.notify(repository, principal, projectId, question.ownerIds, {
      type: "question_assigned",
      title: "Question needs your review",
      body: `${principal.displayName} routed “${question.title}” to you.`,
      targetType: "question",
      targetId: question.id,
    });
    return { ...question, submissionDisposition: "created" };
  }

  async findQuestionMatches(
    principal: Principal,
    projectId: string,
    input: FindQuestionMatchesInput,
  ): Promise<readonly QuestionMatch[]> {
    await this.requireProject(principal, projectId);
    return this.calculateQuestionMatches(this.repository, projectId, input);
  }

  private async calculateQuestionMatches(
    repository: BridgeRepository,
    projectId: string,
    input: FindQuestionMatchesInput,
  ): Promise<readonly QuestionMatch[]> {
    const questions = await repository.listQuestions(projectId);
    const matches: QuestionMatch[] = [];
    for (const question of questions) {
      if (!["open", "in_discussion", "accepted"].includes(question.status)) continue;
      if (question.status === "accepted") {
        const decision = question.decisionId
          ? await repository.getDecision(question.decisionId)
          : undefined;
        if (!decision || decision.status !== "active") continue;
      }

      const titleSimilarity = this.tokenSimilarity(input.title, question.title);
      const contextSimilarity = this.tokenSimilarity(input.context, question.context);
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
    effectiveRisk: Question["risk"],
    effectiveBlocking: boolean,
  ): Promise<Question | undefined> {
    const questions = await repository.listQuestions(projectId);
    const requestedRoles = [...new Set(input.intendedOwnerRoles.map(normalizeRoleName).filter(Boolean))].sort();
    const candidates = questions.filter((question) =>
      ["open", "in_discussion", "accepted"].includes(question.status) &&
      question.type === input.type &&
      this.normalizeQuestionText(question.category) === this.normalizeQuestionText(input.category) &&
      this.normalizeQuestionText(question.title) === this.normalizeQuestionText(input.title) &&
      this.normalizeQuestionText(question.context) === this.normalizeQuestionText(input.context) &&
      this.scopesEqual(question.scope, input.scope) &&
      question.risk === effectiveRisk &&
      question.reversible === input.reversible &&
      question.blocking === effectiveBlocking &&
      JSON.stringify([...question.ownerRoles].map(normalizeRoleName).filter(Boolean).sort()) ===
        JSON.stringify(requestedRoles)
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

  async listQuestions(principal: Principal, projectId: string): Promise<readonly Question[]> {
    await this.requireProject(principal, projectId);
    return this.repository.listQuestions(projectId);
  }

  async listQuestionInbox(
    principal: Principal,
    projectId: string,
    filters: QuestionInboxQuery = {},
  ): Promise<readonly QuestionInboxItem[]> {
    await this.requireProject(principal, projectId);
    const questions = await this.repository.listQuestions(projectId);
    const normalizedCategory = filters.category?.normalize("NFKC").toLocaleLowerCase("en");
    const normalizedRole = filters.role ? normalizeRoleName(filters.role) : undefined;
    return questions
      .filter((question) =>
        (!filters.status || question.status === filters.status) &&
        (!filters.risk || question.risk === filters.risk) &&
        (!normalizedCategory || question.category.normalize("NFKC").toLocaleLowerCase("en") === normalizedCategory) &&
        (!normalizedRole || question.ownerRoles.some((role) => normalizeRoleName(role) === normalizedRole)),
      )
      .map((question) => ({
        ...question,
        inboxReasons: questionInboxReasons(principal, question),
        canAccept: canAcceptQuestion(principal, question),
      }))
      .filter((question) => question.inboxReasons.length > 0)
      .sort((left, right) => {
        const riskRank = { protected: 4, high: 3, medium: 2, low: 1 } as const;
        const riskDifference = riskRank[right.risk] - riskRank[left.risk];
        if (riskDifference !== 0) return riskDifference;
        if (left.blocking !== right.blocking) return left.blocking ? -1 : 1;
        const discussionDifference = Number(right.status === "in_discussion") - Number(left.status === "in_discussion");
        if (discussionDifference !== 0) return discussionDifference;
        return Date.parse(right.createdAt) - Date.parse(left.createdAt);
      });
  }

  async getQuestion(principal: Principal, questionId: string): Promise<Question> {
    return this.requireQuestion(principal, questionId, this.repository);
  }

  async reviewQuestion(
    principal: Principal,
    questionId: string,
    input: QuestionReviewInput,
  ): Promise<QuestionReview> {
    return this.repository.transaction((repository) =>
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
      throw new BridgeError("POLICY_BLOCKED", "Separate security review is required only for protected questions.", 422);
    }
    if (!principal.roles.some((role) => normalizeRoleName(role) === "security-reviewer")) {
      throw new BridgeError("FORBIDDEN", "Only a configured security reviewer can review a protected question.", 403);
    }
    if (question.version !== input.expectedVersion) {
      throw new BridgeError("CONFLICT", "The question changed after it was read.", 409, {
        expectedVersion: input.expectedVersion,
        currentVersion: question.version,
      });
    }
    if (!["open", "in_discussion"].includes(question.status)) {
      throw new BridgeError("CONFLICT", "Only an unresolved question can receive a security review.", 409);
    }
    if (question.reviews.some((review) => review.reviewerId === principal.id)) {
      throw new BridgeError("CONFLICT", "This reviewer has already reviewed the question.", 409);
    }

    const timestamp = this.now().toISOString();
    const review: QuestionReview = {
      id: `qrv_${this.id()}`,
      questionId,
      reviewerId: principal.id,
      reviewerType: principal.type,
      reviewerRole: "security-reviewer",
      status: input.status,
      rationale: input.rationale,
      createdAt: timestamp,
    };
    await repository.saveQuestion({
      ...question,
      reviews: [...question.reviews, review],
      version: question.version + 1,
    });
    await this.audit(repository, principal, question.projectId, "question.reviewed", "question", question.id, timestamp);
    await this.notify(repository, principal, question.projectId, [...question.ownerIds, question.createdById], {
      type: "question_review",
      title: "Protected question review recorded",
      body: `${principal.displayName} marked “${question.title}” ${review.status}.`,
      targetType: "review",
      targetId: review.id,
    });
    return review;
  }

  async addQuestionComment(
    principal: Principal,
    questionId: string,
    input: QuestionCommentInput,
  ): Promise<QuestionComment> {
    return this.repository.transaction((repository) =>
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

    const timestamp = this.now().toISOString();
    const comment: QuestionComment = {
      id: `qcm_${this.id()}`,
      questionId,
      ...(input.parentCommentId ? { parentCommentId: input.parentCommentId } : {}),
      authorId: principal.id,
      authorType: principal.type,
      body: input.body,
      createdAt: timestamp,
    };
    await repository.saveQuestion({
      ...question,
      status: "in_discussion",
      comments: [...question.comments, comment],
      version: question.version + 1,
    });
    await this.audit(repository, principal, question.projectId, "question.comment_added", "question", question.id, timestamp);
    await this.notify(
      repository,
      principal,
      question.projectId,
      [
        ...question.ownerIds,
        ...question.responses.map((response) => response.authorId),
        ...question.comments.map((existing) => existing.authorId),
      ],
      {
        type: "question_comment",
        title: "New question clarification",
        body: `${principal.displayName} added a clarification to “${question.title}”.`,
        targetType: "comment",
        targetId: comment.id,
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
    await this.requireProject(principal, question.projectId, repository);
    return question;
  }

  async proposeAnswer(
    principal: Principal,
    questionId: string,
    input: ProposeAnswerInput,
  ): Promise<QuestionResponse> {
    return this.repository.transaction((repository) =>
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
    if (!["open", "in_discussion"].includes(question.status)) {
      throw new BridgeError("CONFLICT", "This question no longer accepts responses.", 409);
    }
    if (input.optionKey && !question.options.some((option) => option.key === input.optionKey)) {
      throw new BridgeError("VALIDATION_FAILED", "optionKey does not belong to this question.", 422);
    }

    const timestamp = this.now().toISOString();
    const response: QuestionResponse = {
      id: `rsp_${this.id()}`,
      questionId,
      authorId: principal.id,
      authorType: principal.type,
      answer: input.answer,
      rationale: input.rationale,
      ...(input.optionKey ? { optionKey: input.optionKey } : {}),
      createdAt: timestamp,
    };
    await repository.saveQuestion({
      ...question,
      status: "in_discussion",
      responses: [...question.responses, response],
      version: question.version + 1,
    });
    await this.audit(repository, principal, question.projectId, "response.proposed", "response", response.id, timestamp);
    await this.notify(repository, principal, question.projectId, question.ownerIds, {
      type: "question_response",
      title: "New proposed answer",
      body: `${principal.displayName} proposed an answer for “${question.title}”.`,
      targetType: "response",
      targetId: response.id,
    });
    return response;
  }

  async acceptAnswer(
    principal: Principal,
    questionId: string,
    input: AcceptAnswerInput,
  ): Promise<Decision> {
    return this.repository.transaction((repository) =>
      this.acceptAnswerInTransaction(repository, principal, questionId, input),
    );
  }

  private async acceptAnswerInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    questionId: string,
    input: AcceptAnswerInput,
  ): Promise<Decision> {
    const question = await this.requireQuestion(principal, questionId, repository);
    assertCanAccept(principal, question);
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
      version: question.version + 1,
    });
    await this.audit(repository, principal, question.projectId, "decision.accepted", "decision", decision.id, timestamp);
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
        title: "Question accepted",
        body: `${principal.displayName} accepted the decision for “${question.title}”.`,
        targetType: "decision",
        targetId: decision.id,
      },
    );
    return decision;
  }

  async listDecisions(principal: Principal, projectId: string): Promise<readonly Decision[]> {
    await this.requireProject(principal, projectId);
    return this.repository.listDecisions(projectId);
  }

  async changeDecisionLifecycle(
    principal: Principal,
    decisionId: string,
    input: ChangeDecisionLifecycleInput,
  ): Promise<DecisionLifecycleChange> {
    return this.repository.transaction((repository) =>
      this.changeDecisionLifecycleInTransaction(repository, principal, decisionId, input),
    );
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
      principal.roles.some((role) => normalizeRoleName(role) === "project-admin");
    if (!mayManage) {
      throw new BridgeError(
        "FORBIDDEN",
        "Only the decision owner, a configured project decision owner, or a project administrator can retire this decision.",
        403,
      );
    }
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

    const [artifacts, assumptions, sourceQuestion, contextSnapshots] = await Promise.all([
      repository.listArtifacts(decision.projectId),
      repository.listAssumptions(decision.projectId),
      repository.getQuestion(decision.questionId),
      repository.listContextSnapshots(decision.projectId),
    ]);
    const affectedArtifacts = artifacts.filter((artifact) =>
      artifact.versions.some((version) => version.citedDecisionIds.includes(decision.id)),
    );
    const affectedAssumptions = assumptions.filter(
      (assumption) => assumption.confirmedDecisionId === decision.id,
    );
    const impact: DecisionLifecycleImpact = {
      artifactIds: affectedArtifacts.map((artifact) => artifact.id),
      assumptionIds: affectedAssumptions.map((assumption) => assumption.id),
      runIds: [...new Set([
        ...(sourceQuestion?.runId ? [sourceQuestion.runId] : []),
        ...affectedArtifacts.flatMap((artifact) =>
          artifact.versions.flatMap((version) => version.runId ? [version.runId] : []),
        ),
        ...affectedAssumptions.flatMap((assumption) => assumption.runId ? [assumption.runId] : []),
        ...contextSnapshots.flatMap((snapshot) =>
          snapshot.runId && snapshot.itemIds.includes(decision.id) ? [snapshot.runId] : [],
        ),
      ])],
      workItems: decision.scope.workItem ? [decision.scope.workItem] : [],
    };

    await this.audit(
      repository,
      principal,
      decision.projectId,
      `decision.${input.status}`,
      "decision",
      decision.id,
      timestamp,
    );
    await repository.saveOutboxEvent({
      id: `evt_${this.id()}`,
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
      },
    );
    return { decision: changed, impact };
  }

  async publishArtifact(
    principal: Principal,
    projectId: string,
    input: PublishArtifactInput,
  ): Promise<ArtifactPublication> {
    return this.repository.transaction((repository) =>
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
    const idempotencyKey = `artifact:${principal.organizationId}:${principal.id}:${input.idempotencyKey}`;
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existingVersionId = await repository.getIdempotentArtifactVersionId(idempotencyKey);
    if (existingVersionId) {
      const existingHash = await repository.getIdempotentArtifactRequestHash(idempotencyKey);
      if (existingHash !== requestHash) {
        throw new BridgeError("CONFLICT", "The idempotency key was reused with a different request.", 409);
      }
      const existingArtifact = await repository.getArtifactByVersionId(existingVersionId);
      const existingVersion = existingArtifact?.versions.find((version) => version.id === existingVersionId);
      if (!existingArtifact || !existingVersion) {
        throw new BridgeError("CONFLICT", "The idempotent specification version is no longer available.", 409);
      }
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
    const version: ArtifactVersion = {
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
      ...(input.runId ? { runId: input.runId } : {}),
    };
    const artifact: Artifact = existingArtifact
      ? {
          ...existingArtifact,
          title: input.title,
          scope: { ...input.scope },
          reviewerIds:
            input.intendedReviewerIds.length > 0
              ? [...input.intendedReviewerIds]
              : existingArtifact.reviewerIds,
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
          reviewerIds:
            input.intendedReviewerIds.length > 0
              ? [...input.intendedReviewerIds]
              : [...project.decisionOwnerIds],
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
    return { artifact, version };
  }

  async listArtifacts(principal: Principal, projectId: string): Promise<readonly Artifact[]> {
    await this.requireProject(principal, projectId);
    return this.repository.listArtifacts(projectId);
  }

  async getArtifact(principal: Principal, artifactId: string): Promise<Artifact> {
    return this.requireArtifact(principal, artifactId, this.repository);
  }

  private async requireArtifact(
    principal: Principal,
    artifactId: string,
    repository: BridgeRepository,
  ): Promise<Artifact> {
    const artifact = await repository.getArtifact(artifactId);
    if (!artifact) throw new BridgeError("ARTIFACT_NOT_FOUND", "Specification not found.", 404);
    await this.requireProject(principal, artifact.projectId, repository);
    return artifact;
  }

  async reviewArtifactVersion(
    principal: Principal,
    versionId: string,
    input: ArtifactReviewInput,
  ): Promise<ArtifactReviewResult> {
    return this.repository.transaction((repository) =>
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
    await this.requireProject(principal, artifact.projectId, repository);
    assertCanReviewArtifact(principal, artifact);
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
    const reviewedVersion: ArtifactVersion = {
      ...target,
      reviews: [...target.reviews, review],
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
    return this.repository.transaction((repository) =>
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
    await this.requireProject(principal, artifact.projectId, repository);
    assertCanApproveArtifact(principal, artifact);
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

    const timestamp = this.now().toISOString();
    const approvedVersion: ArtifactVersion = {
      ...target,
      status: "approved",
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
    return this.repository.transaction((repository) =>
      this.getContextInTransaction(repository, principal, projectId, query),
    );
  }

  private async getContextInTransaction(
    repository: BridgeRepository,
    principal: Principal,
    projectId: string,
    query: ContextQuery,
  ): Promise<{ readonly contextSnapshotId: string; readonly items: readonly ContextItem[]; readonly truncated: boolean }> {
    await this.requireProject(principal, projectId, repository);
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
          sourceUrl: this.recordUrl({
            view: "decisions",
            projectId,
            decisionId: decision.id,
          }),
          updatedAt: decision.createdAt,
        };
        return { item, score: 10 + scopeMatch(decision.scope) + textScore };
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
        sourceUrl: this.recordUrl({
          view: "specifications",
          projectId,
          artifactId: artifact.id,
          versionId: version.id,
        }),
        updatedAt: version.approvedAt ?? version.createdAt,
      };
      return [{ item, score: 10 + scopeMatch(artifact.scope) + textScore }];
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
    return { contextSnapshotId: snapshot.id, items, truncated: scored.length > items.length };
  }

  private async requireRun(
    principal: Principal,
    runId: string,
    repository: BridgeRepository,
  ): Promise<AgentRun> {
    const run = await repository.getRun(runId);
    if (!run) throw new BridgeError("RUN_NOT_FOUND", "Agent run not found.", 404);
    await this.requireProject(principal, run.projectId, repository);
    return run;
  }

  private async requireAssumption(
    principal: Principal,
    assumptionId: string,
    repository: BridgeRepository,
  ): Promise<Assumption> {
    const assumption = await repository.getAssumption(assumptionId);
    if (!assumption) throw new BridgeError("ASSUMPTION_NOT_FOUND", "Assumption not found.", 404);
    await this.requireProject(principal, assumption.projectId, repository);
    return assumption;
  }

  private async requireDecision(
    principal: Principal,
    decisionId: string,
    repository: BridgeRepository,
  ): Promise<Decision> {
    const decision = await repository.getDecision(decisionId);
    if (!decision) throw new BridgeError("DECISION_NOT_FOUND", "Decision not found.", 404);
    await this.requireProject(principal, decision.projectId, repository);
    return decision;
  }

  private async expireAssumptionIfDue(
    repository: BridgeRepository,
    principal: Principal,
    assumption: Assumption,
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
    return expired;
  }

  private scopesEqual(left: Scope, right: Scope): boolean {
    return (["repository", "component", "branch", "environment", "workItem"] as const)
      .every((key) => left[key] === right[key]);
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
      (principal.type === "human" && principal.roles.includes("project-admin"));
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

  private async requireProject(
    principal: Principal,
    projectId: string,
    repository: BridgeRepository = this.repository,
  ): Promise<Project> {
    const project = await repository.getProject(projectId);
    if (!project) {
      throw new BridgeError("PROJECT_NOT_FOUND", "Project not found.", 404);
    }
    assertProjectAccess(principal, project);
    return project;
  }

  private async audit(
    repository: BridgeRepository,
    principal: Principal,
    projectId: string,
    action: string,
    subjectType: AuditEvent["subjectType"],
    subjectId: string,
    createdAt: string,
  ): Promise<void> {
    await repository.saveAuditEvent({
      id: `aud_${this.id()}`,
      organizationId: principal.organizationId,
      projectId,
      actorId: principal.id,
      actorType: principal.type,
      action,
      subjectType,
      subjectId,
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
    const recipients = [...new Set(recipientIds)].filter((recipientId) => recipientId && recipientId !== principal.id);
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
        organizationId: principal.organizationId,
        projectId,
        type: "notification.created",
        payload: {
          notificationId,
          recipientId,
          notificationType: draft.type,
          targetType: draft.targetType,
          targetId: draft.targetId,
        },
        status: "pending",
        attempts: 0,
        availableAt: createdAt,
        createdAt,
      });
    }
  }
}
