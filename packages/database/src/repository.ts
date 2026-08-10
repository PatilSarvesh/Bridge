import type { BridgeRepository } from "@bridge/application";
import { BridgeError } from "@bridge/domain";
import {
  type BridgeMetrics,
  currentCorrelationId,
  runWithCorrelationContextIfAbsent,
} from "@bridge/observability";
import type {
  AgentRun,
  Assumption,
  Artifact,
  AuditEvent,
  ContextSnapshot,
  Decision,
  Notification,
  Organization,
  OrganizationMembership,
  OutboxDelivery,
  OutboxEvent,
  Principal,
  PrincipalIdentity,
  Project,
  ProjectMembership,
  Question,
} from "@bridge/domain";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  artifactFromRows,
  assumptionFromRow,
  assumptionToRow,
  artifactToRow,
  artifactVersionToRow,
  auditEventFromRow,
  auditEventToRow,
  contextSnapshotToRow,
  contextSnapshotFromRow,
  decisionFromRow,
  decisionToRow,
  notificationFromRow,
  notificationToRow,
  organizationFromRow,
  organizationMembershipFromRow,
  organizationMembershipToRow,
  organizationToRow,
  outboxDeliveryFromRow,
  outboxDeliveryToRow,
  outboxEventFromRow,
  outboxEventToRow,
  principalIdentityFromRow,
  principalIdentityToRow,
  projectMembershipFromRow,
  projectMembershipToRow,
  projectFromRow,
  projectToRow,
  questionFromRows,
  questionToRow,
  responseToRow,
  runFromRow,
  runToRow,
} from "./mappers.js";
import * as schema from "./schema.js";
import {
  artifacts,
  agentRuns,
  assumptions,
  artifactVersions,
  auditEvents,
  contextSnapshots,
  decisions,
  idempotencyRecords,
  projects,
  questionResponses,
  questions,
  runContinuationLocators,
  notifications,
  organizations,
  organizationMemberships,
  outboxDeliveries,
  outboxEvents,
  principalIdentities,
  projectMemberships,
} from "./schema.js";

type BridgeDatabase = PostgresJsDatabase<typeof schema>;
type IdempotencyKind = (typeof schema.idempotencyKindEnum.enumValues)[number];

function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export class PostgresBridgeRepository implements BridgeRepository {
  constructor(
    private readonly database: BridgeDatabase,
    private readonly lockAggregateReads = false,
    private readonly metrics?: BridgeMetrics,
  ) {}

  async checkHealth(): Promise<{ readonly backend: string }> {
    await this.database.execute(sql`select 1`);
    return { backend: "postgresql" };
  }

  async transaction<T>(work: (repository: BridgeRepository) => Promise<T>): Promise<T> {
    if (!currentCorrelationId()) {
      return runWithCorrelationContextIfAbsent("application", () => this.transaction(work));
    }
    if (this.lockAggregateReads) return work(this);

    const startedAt = performance.now();
    let outcome: "success" | "error" = "success";

    try {
      return await this.database.transaction(async (transaction) =>
        work(new PostgresBridgeRepository(transaction as unknown as BridgeDatabase, true, this.metrics)),
        { isolationLevel: "serializable" },
      );
    } catch (error) {
      outcome = "error";
      const code = databaseErrorCode(error);
      if (code === "23505") {
        throw new BridgeError("CONFLICT", "A concurrent operation already created this record.", 409);
      }
      if (code === "40001" || code === "40P01") {
        throw new BridgeError("CONFLICT", "The operation conflicted with another update; retry it.", 409);
      }
      throw error;
    } finally {
      this.metrics?.recordDatabaseTransaction({
        backend: "postgresql",
        outcome,
        durationMs: Math.max(0, performance.now() - startedAt),
      });
    }
  }

  async getOrganizationByExternalId(
    externalIdentityProviderId: string,
  ): Promise<Organization | undefined> {
    const [row] = await this.database
      .select()
      .from(organizations)
      .where(eq(organizations.externalIdentityProviderId, externalIdentityProviderId))
      .limit(1);
    return row ? organizationFromRow(row) : undefined;
  }

  async saveOrganization(organization: Organization): Promise<void> {
    const row = organizationToRow(organization);
    await this.database.insert(organizations).values(row).onConflictDoUpdate({
      target: organizations.id,
      set: {
        externalIdentityProviderId: row.externalIdentityProviderId,
        slug: row.slug,
        name: row.name,
      },
    });
  }

  async getPrincipalIdentityByOidc(
    issuer: string,
    subject: string,
  ): Promise<PrincipalIdentity | undefined> {
    const [row] = await this.database
      .select()
      .from(principalIdentities)
      .where(and(
        eq(principalIdentities.oidcIssuer, issuer),
        eq(principalIdentities.oidcSubject, subject),
      ))
      .limit(1);
    return row ? principalIdentityFromRow(row) : undefined;
  }

  async savePrincipalIdentity(identity: PrincipalIdentity): Promise<void> {
    const row = principalIdentityToRow(identity);
    await this.database.insert(principalIdentities).values(row).onConflictDoUpdate({
      target: principalIdentities.id,
      set: {
        type: row.type,
        displayName: row.displayName,
        oidcIssuer: row.oidcIssuer,
        oidcSubject: row.oidcSubject,
      },
    });
  }

  async getOrganizationMembership(
    organizationId: string,
    principalId: string,
  ): Promise<OrganizationMembership | undefined> {
    const [row] = await this.database
      .select()
      .from(organizationMemberships)
      .where(and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.principalId, principalId),
      ))
      .limit(1);
    return row ? organizationMembershipFromRow(row) : undefined;
  }

  async saveOrganizationMembership(membership: OrganizationMembership): Promise<void> {
    const row = organizationMembershipToRow(membership);
    await this.database.insert(organizationMemberships).values(row).onConflictDoUpdate({
      target: [organizationMemberships.organizationId, organizationMemberships.principalId],
      set: {
        status: row.status,
        roles: row.roles,
        allProjects: row.allProjects,
        updatedAt: row.updatedAt,
      },
    });
  }

  async listProjectMemberships(
    organizationId: string,
    principalId: string,
  ): Promise<readonly ProjectMembership[]> {
    const rows = await this.database
      .select()
      .from(projectMemberships)
      .where(and(
        eq(projectMemberships.organizationId, organizationId),
        eq(projectMemberships.principalId, principalId),
      ))
      .orderBy(asc(projectMemberships.projectId));
    return rows.map(projectMembershipFromRow);
  }

  async saveProjectMembership(membership: ProjectMembership): Promise<void> {
    const row = projectMembershipToRow(membership);
    await this.database.insert(projectMemberships).values(row).onConflictDoUpdate({
      target: [
        projectMemberships.organizationId,
        projectMemberships.projectId,
        projectMemberships.principalId,
      ],
      set: {
        status: row.status,
        roles: row.roles,
        updatedAt: row.updatedAt,
      },
    });
  }

  async resolveOidcPrincipal(identity: {
    readonly issuer: string;
    readonly subject: string;
    readonly organizationExternalId: string;
  }): Promise<Principal | undefined> {
    const [principalIdentity, organization] = await Promise.all([
      this.getPrincipalIdentityByOidc(identity.issuer, identity.subject),
      this.getOrganizationByExternalId(identity.organizationExternalId),
    ]);
    if (!principalIdentity || !organization) return undefined;
    const organizationMembership = await this.getOrganizationMembership(
      organization.id,
      principalIdentity.id,
    );
    if (!organizationMembership || organizationMembership.status !== "active") return undefined;
    const memberships = (await this.listProjectMemberships(
      organization.id,
      principalIdentity.id,
    )).filter((membership) => membership.status === "active");
    return {
      id: principalIdentity.id,
      type: principalIdentity.type,
      organizationId: organization.id,
      projectIds: memberships.map((membership) => membership.projectId),
      allProjects: organizationMembership.allProjects,
      roles: organizationMembership.roles,
      projectRoles: Object.fromEntries(
        memberships.map((membership) => [membership.projectId, membership.roles]),
      ),
      displayName: principalIdentity.displayName,
    };
  }

  async listOrganizationPrincipals(organizationId: string): Promise<readonly Principal[]> {
    const rows = await this.database
      .select({
        identity: principalIdentities,
        membership: organizationMemberships,
      })
      .from(organizationMemberships)
      .innerJoin(
        principalIdentities,
        eq(organizationMemberships.principalId, principalIdentities.id),
      )
      .where(and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.status, "active"),
      ));
    const principals = await Promise.all(rows.map(async (row): Promise<Principal> => {
      const memberships = (await this.listProjectMemberships(organizationId, row.identity.id))
        .filter((membership) => membership.status === "active");
      return {
        id: row.identity.id,
        type: row.identity.type,
        organizationId,
        projectIds: memberships.map((membership) => membership.projectId),
        allProjects: row.membership.allProjects,
        roles: row.membership.roles,
        projectRoles: Object.fromEntries(
          memberships.map((membership) => [membership.projectId, membership.roles]),
        ),
        displayName: row.identity.displayName,
      };
    }));
    return principals.sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    const [row] = await this.database.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    return row ? projectFromRow(row) : undefined;
  }

  async listProjects(organizationId: string): Promise<readonly Project[]> {
    const rows = await this.database
      .select()
      .from(projects)
      .where(eq(projects.organizationId, organizationId))
      .orderBy(asc(projects.name));
    return rows.map(projectFromRow);
  }

  async saveProject(project: Project): Promise<void> {
    const row = projectToRow(project);
    await this.database
      .insert(projects)
      .values(row)
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          organizationId: row.organizationId,
          name: row.name,
          decisionOwnerIds: row.decisionOwnerIds,
        },
      });
  }

  async getRun(runId: string): Promise<AgentRun | undefined> {
    const query = this.database.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
    const rows = this.lockAggregateReads ? await query.for("update") : await query;
    return rows[0] ? runFromRow(rows[0]) : undefined;
  }

  async listRuns(projectId: string): Promise<readonly AgentRun[]> {
    const rows = await this.database
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.projectId, projectId))
      .orderBy(desc(agentRuns.startedAt));
    return rows.map(runFromRow);
  }

  async saveRun(run: AgentRun): Promise<void> {
    const row = runToRow(run);
    await this.database
      .insert(agentRuns)
      .values(row)
      .onConflictDoUpdate({
        target: agentRuns.id,
        set: {
          status: row.status,
          contextSnapshotIds: row.contextSnapshotIds,
          questionIds: row.questionIds,
          artifactVersionIds: row.artifactVersionIds,
          assumptionIds: row.assumptionIds,
          resultLinks: row.resultLinks,
          updatedAt: row.updatedAt,
          endedAt: row.endedAt,
          summary: row.summary,
          version: row.version,
        },
      });
  }

  async findIdempotentRun(key: string): Promise<AgentRun | undefined> {
    const record = await this.getIdempotencyRecord(key, "run");
    return record ? this.getRun(record.resourceId) : undefined;
  }

  async getIdempotentRunRequestHash(key: string): Promise<string | undefined> {
    return (await this.getIdempotencyRecord(key, "run"))?.requestHash;
  }

  async saveIdempotentRun(key: string, runId: string, requestHash: string): Promise<void> {
    await this.saveIdempotencyRecord(key, "run", runId, requestHash);
  }

  async getRunContinuationKey(runId: string): Promise<string | undefined> {
    const [row] = await this.database
      .select({ resumeContextKey: runContinuationLocators.resumeContextKey })
      .from(runContinuationLocators)
      .where(eq(runContinuationLocators.runId, runId))
      .limit(1);
    return row?.resumeContextKey;
  }

  async saveRunContinuationKey(runId: string, resumeContextKey: string): Promise<void> {
    await this.database
      .insert(runContinuationLocators)
      .values({ runId, resumeContextKey })
      .onConflictDoNothing({ target: runContinuationLocators.runId });
  }

  async getAssumption(assumptionId: string): Promise<Assumption | undefined> {
    const query = this.database
      .select()
      .from(assumptions)
      .where(eq(assumptions.id, assumptionId))
      .limit(1);
    const rows = this.lockAggregateReads ? await query.for("update") : await query;
    return rows[0] ? assumptionFromRow(rows[0]) : undefined;
  }

  async listAssumptions(projectId: string): Promise<readonly Assumption[]> {
    const query = this.database
      .select()
      .from(assumptions)
      .where(eq(assumptions.projectId, projectId))
      .orderBy(desc(assumptions.createdAt));
    const rows = this.lockAggregateReads ? await query.for("update") : await query;
    return rows.map(assumptionFromRow);
  }

  async saveAssumption(assumption: Assumption): Promise<void> {
    const row = assumptionToRow(assumption);
    await this.database
      .insert(assumptions)
      .values(row)
      .onConflictDoUpdate({
        target: assumptions.id,
        set: {
          status: row.status,
          resolvedById: row.resolvedById,
          resolvedAt: row.resolvedAt,
          resolutionRationale: row.resolutionRationale,
          confirmedDecisionId: row.confirmedDecisionId,
          supersedingAssumptionId: row.supersedingAssumptionId,
          version: row.version,
        },
      });
  }

  async findIdempotentAssumption(key: string): Promise<Assumption | undefined> {
    const record = await this.getIdempotencyRecord(key, "assumption");
    return record ? this.getAssumption(record.resourceId) : undefined;
  }

  async getIdempotentAssumptionRequestHash(key: string): Promise<string | undefined> {
    return (await this.getIdempotencyRecord(key, "assumption"))?.requestHash;
  }

  async saveIdempotentAssumption(
    key: string,
    assumptionId: string,
    requestHash: string,
  ): Promise<void> {
    await this.saveIdempotencyRecord(key, "assumption", assumptionId, requestHash);
  }

  async getQuestion(questionId: string): Promise<Question | undefined> {
    const query = this.database.select().from(questions).where(eq(questions.id, questionId)).limit(1);
    const rows = this.lockAggregateReads ? await query.for("update") : await query;
    const row = rows[0];
    if (!row) return undefined;
    const responses = await this.database
      .select()
      .from(questionResponses)
      .where(eq(questionResponses.questionId, questionId))
      .orderBy(asc(questionResponses.createdAt));
    return questionFromRows(row, responses);
  }

  async listQuestions(projectId: string): Promise<readonly Question[]> {
    const rows = await this.database
      .select()
      .from(questions)
      .where(eq(questions.projectId, projectId))
      .orderBy(desc(questions.createdAt));
    if (rows.length === 0) return [];
    const responses = await this.database
      .select()
      .from(questionResponses)
      .where(inArray(questionResponses.questionId, rows.map((row) => row.id)))
      .orderBy(asc(questionResponses.createdAt));
    return rows.map((row) => questionFromRows(row, responses));
  }

  async saveQuestion(question: Question): Promise<void> {
    const row = questionToRow(question);
    await this.database
      .insert(questions)
      .values(row)
      .onConflictDoUpdate({
        target: questions.id,
        set: {
          status: row.status,
          reviews: row.reviews,
          comments: row.comments,
          acceptedResponseId: row.acceptedResponseId,
          decisionId: row.decisionId,
          version: row.version,
        },
      });

    if (question.responses.length > 0) {
      await this.database
        .insert(questionResponses)
        .values(question.responses.map(responseToRow))
        .onConflictDoNothing({ target: questionResponses.id });
    }
  }

  async findIdempotentQuestion(key: string): Promise<Question | undefined> {
    const record = await this.getIdempotencyRecord(key, "question");
    return record ? this.getQuestion(record.resourceId) : undefined;
  }

  async saveIdempotentQuestion(key: string, questionId: string, requestHash: string): Promise<void> {
    await this.saveIdempotencyRecord(key, "question", questionId, requestHash);
  }

  async getIdempotentRequestHash(key: string): Promise<string | undefined> {
    return (await this.getIdempotencyRecord(key, "question"))?.requestHash;
  }

  async getDecision(decisionId: string): Promise<Decision | undefined> {
    const query = this.database.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1);
    const rows = this.lockAggregateReads ? await query.for("update") : await query;
    const row = rows[0];
    return row ? decisionFromRow(row) : undefined;
  }

  async listDecisions(projectId: string): Promise<readonly Decision[]> {
    const rows = await this.database
      .select()
      .from(decisions)
      .where(eq(decisions.projectId, projectId))
      .orderBy(desc(decisions.createdAt));
    return rows.map(decisionFromRow);
  }

  async searchDecisions(projectId: string, search: string): Promise<readonly Decision[]> {
    const document = sql`(
      setweight(to_tsvector('simple', coalesce(${decisions.answer}, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(${decisions.rationale}, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(${decisions.category}, '')), 'C')
    )`;
    const query = sql`websearch_to_tsquery('simple', ${search})`;
    const rows = await this.database
      .select()
      .from(decisions)
      .where(and(eq(decisions.projectId, projectId), sql`${document} @@ ${query}`))
      .orderBy(desc(sql<number>`ts_rank_cd(${document}, ${query})`), desc(decisions.createdAt));
    return rows.map(decisionFromRow);
  }

  async saveDecision(decision: Decision): Promise<void> {
    const row = decisionToRow(decision);
    await this.database
      .insert(decisions)
      .values(row)
      .onConflictDoUpdate({
        target: decisions.id,
        set: {
          status: row.status,
          lifecycleRationale: row.lifecycleRationale,
          lifecycleChangedById: row.lifecycleChangedById,
          lifecycleChangedAt: row.lifecycleChangedAt,
          replacementDecisionId: row.replacementDecisionId,
          version: row.version,
        },
      });
  }

  async getArtifact(artifactId: string): Promise<Artifact | undefined> {
    const query = this.database.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
    const rows = this.lockAggregateReads ? await query.for("update") : await query;
    const row = rows[0];
    if (!row) return undefined;
    const versions = await this.database
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifactId))
      .orderBy(asc(artifactVersions.version));
    return artifactFromRows(row, versions);
  }

  async getArtifactByVersionId(versionId: string): Promise<Artifact | undefined> {
    const [version] = await this.database
      .select({ artifactId: artifactVersions.artifactId })
      .from(artifactVersions)
      .where(eq(artifactVersions.id, versionId))
      .limit(1);
    return version ? this.getArtifact(version.artifactId) : undefined;
  }

  async listArtifacts(projectId: string): Promise<readonly Artifact[]> {
    const rows = await this.database
      .select()
      .from(artifacts)
      .where(eq(artifacts.projectId, projectId))
      .orderBy(desc(artifacts.createdAt));
    if (rows.length === 0) return [];
    const versions = await this.database
      .select()
      .from(artifactVersions)
      .where(inArray(artifactVersions.artifactId, rows.map((row) => row.id)))
      .orderBy(asc(artifactVersions.version));
    return rows.map((row) => artifactFromRows(row, versions));
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    const row = artifactToRow(artifact);
    await this.database
      .insert(artifacts)
      .values(row)
      .onConflictDoUpdate({
        target: artifacts.id,
        set: {
          title: row.title,
          scope: row.scope,
          reviewerIds: row.reviewerIds,
          currentVersionId: row.currentVersionId,
          approvedVersionId: row.approvedVersionId,
        },
      });

    for (const version of artifact.versions) {
      const versionRow = artifactVersionToRow(version);
      await this.database
        .insert(artifactVersions)
        .values(versionRow)
        .onConflictDoUpdate({
          target: artifactVersions.id,
          set: {
            status: versionRow.status,
            reviews: versionRow.reviews,
            approvedById: versionRow.approvedById,
            approvalRationale: versionRow.approvalRationale,
            approvedAt: versionRow.approvedAt,
          },
        });
    }
  }

  async getIdempotentArtifactVersionId(key: string): Promise<string | undefined> {
    return (await this.getIdempotencyRecord(key, "artifact_version"))?.resourceId;
  }

  async getIdempotentArtifactRequestHash(key: string): Promise<string | undefined> {
    return (await this.getIdempotencyRecord(key, "artifact_version"))?.requestHash;
  }

  async saveIdempotentArtifactVersion(
    key: string,
    versionId: string,
    requestHash: string,
  ): Promise<void> {
    await this.saveIdempotencyRecord(key, "artifact_version", versionId, requestHash);
  }

  async saveContextSnapshot(snapshot: ContextSnapshot): Promise<void> {
    await this.database
      .insert(contextSnapshots)
      .values(contextSnapshotToRow(snapshot))
      .onConflictDoNothing({ target: contextSnapshots.id });
  }

  async listContextSnapshots(projectId: string): Promise<readonly ContextSnapshot[]> {
    const rows = await this.database
      .select()
      .from(contextSnapshots)
      .where(eq(contextSnapshots.projectId, projectId))
      .orderBy(desc(contextSnapshots.createdAt));
    return rows.map(contextSnapshotFromRow);
  }

  async saveAuditEvent(event: AuditEvent): Promise<void> {
    await this.database
      .insert(auditEvents)
      .values(auditEventToRow(event))
      .onConflictDoNothing({ target: auditEvents.id });
  }

  async listAuditEvents(projectId: string): Promise<readonly AuditEvent[]> {
    const rows = await this.database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.projectId, projectId))
      .orderBy(asc(auditEvents.createdAt));
    return rows.map(auditEventFromRow);
  }

  async getNotification(notificationId: string): Promise<Notification | undefined> {
    const [row] = await this.database.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1);
    return row ? notificationFromRow(row) : undefined;
  }

  async listNotifications(
    organizationId: string,
    recipientId: string,
    projectId?: string,
    unreadOnly = false,
  ): Promise<readonly Notification[]> {
    const conditions = [
      eq(notifications.organizationId, organizationId),
      eq(notifications.recipientId, recipientId),
      ...(projectId ? [eq(notifications.projectId, projectId)] : []),
      ...(unreadOnly ? [isNull(notifications.readAt)] : []),
    ];
    const rows = await this.database
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt));
    return rows.map(notificationFromRow);
  }

  async saveNotification(notification: Notification): Promise<void> {
    const row = notificationToRow(notification);
    await this.database
      .insert(notifications)
      .values(row)
      .onConflictDoUpdate({
        target: notifications.id,
        set: { readAt: row.readAt },
      });
  }

  async listOutboxEvents(projectId?: string): Promise<readonly OutboxEvent[]> {
    const query = this.database
      .select()
      .from(outboxEvents)
      .where(projectId ? eq(outboxEvents.projectId, projectId) : undefined)
      .orderBy(asc(outboxEvents.createdAt));
    const rows = await query;
    return rows.map(outboxEventFromRow);
  }

  async getOutboxEvent(eventId: string): Promise<OutboxEvent | undefined> {
    const query = this.database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId))
      .limit(1);
    const rows = this.lockAggregateReads ? await query.for("update") : await query;
    return rows[0] ? outboxEventFromRow(rows[0]) : undefined;
  }

  async saveOutboxEvent(event: OutboxEvent): Promise<void> {
    const row = outboxEventToRow(event);
    await this.database
      .insert(outboxEvents)
      .values(row)
      .onConflictDoUpdate({
        target: outboxEvents.id,
        set: {
          correlationId: row.correlationId,
          organizationId: row.organizationId,
          projectId: row.projectId,
          type: row.type,
          payload: row.payload,
          status: row.status,
          attempts: row.attempts,
          availableAt: row.availableAt,
          leaseUntil: row.leaseUntil,
          createdAt: row.createdAt,
          processedAt: row.processedAt,
          lastError: row.lastError,
        },
      });
  }

  async listOutboxDeliveries(projectId: string): Promise<readonly OutboxDelivery[]> {
    const rows = await this.database
      .select()
      .from(outboxDeliveries)
      .where(eq(outboxDeliveries.projectId, projectId))
      .orderBy(asc(outboxDeliveries.updatedAt));
    return rows.map(outboxDeliveryFromRow);
  }

  async getOutboxDelivery(
    eventId: string,
    channel: OutboxDelivery["channel"],
  ): Promise<OutboxDelivery | undefined> {
    const query = this.database
      .select()
      .from(outboxDeliveries)
      .where(and(eq(outboxDeliveries.outboxEventId, eventId), eq(outboxDeliveries.channel, channel)))
      .limit(1);
    const rows = this.lockAggregateReads ? await query.for("update") : await query;
    return rows[0] ? outboxDeliveryFromRow(rows[0]) : undefined;
  }

  async saveOutboxDelivery(delivery: OutboxDelivery): Promise<void> {
    const row = outboxDeliveryToRow(delivery);
    await this.database
      .insert(outboxDeliveries)
      .values(row)
      .onConflictDoUpdate({
        target: [outboxDeliveries.outboxEventId, outboxDeliveries.channel],
        set: {
          destinationHash: row.destinationHash,
          status: row.status,
          attemptCount: row.attemptCount,
          preference: row.preference,
          providerMessageId: row.providerMessageId,
          lastError: row.lastError,
          updatedAt: row.updatedAt,
        },
      });
  }

  async claimOutboxEvents(now: string, limit: number): Promise<readonly OutboxEvent[]> {
    if (limit <= 0) return [];
    if (this.lockAggregateReads) return this.claimOutboxEventsInTransaction(this.database, now, limit);

    return this.database.transaction(
      async (transaction) =>
        new PostgresBridgeRepository(transaction as unknown as BridgeDatabase, true).claimOutboxEvents(
          now,
          limit,
        ),
    );
  }

  private async claimOutboxEventsInTransaction(
    database: BridgeDatabase,
    now: string,
    limit: number,
  ): Promise<readonly OutboxEvent[]> {
    const rows = await database
      .select()
      .from(outboxEvents)
      .where(
        and(
          or(
            eq(outboxEvents.status, "pending"),
            eq(outboxEvents.status, "failed"),
            and(eq(outboxEvents.status, "processing"), lte(outboxEvents.leaseUntil, now)),
          ),
          lte(outboxEvents.availableAt, now),
          or(isNull(outboxEvents.leaseUntil), lte(outboxEvents.leaseUntil, now)),
        ),
      )
      .orderBy(asc(outboxEvents.availableAt), asc(outboxEvents.createdAt))
      .limit(limit)
      .for("update");
    if (rows.length === 0) return [];

    const leaseUntil = new Date(Date.parse(now) + 5 * 60 * 1_000).toISOString();
    const events = rows.map((row) => {
      const event = outboxEventFromRow(row);
      const { lastError: _lastError, processedAt: _processedAt, leaseUntil: _leaseUntil, ...base } = event;
      return {
        ...base,
        status: "processing" as const,
        attempts: event.attempts + 1,
        leaseUntil,
      };
    });
    for (const event of events) {
      await database
        .update(outboxEvents)
        .set({
          status: event.status,
          attempts: event.attempts,
          leaseUntil: event.leaseUntil,
          processedAt: null,
          lastError: null,
        })
        .where(eq(outboxEvents.id, event.id));
    }
    return events;
  }

  async completeOutboxEvent(eventId: string, processedAt: string): Promise<void> {
    await this.database
      .update(outboxEvents)
      .set({ status: "processed", processedAt, leaseUntil: null, lastError: null })
      .where(eq(outboxEvents.id, eventId));
  }

  async failOutboxEvent(
    eventId: string,
    lastError: string,
    availableAt: string,
    deadLetter: boolean,
  ): Promise<void> {
    await this.database
      .update(outboxEvents)
      .set({
        status: deadLetter ? "dead_letter" : "failed",
        availableAt,
        leaseUntil: null,
        processedAt: null,
        lastError,
      })
      .where(eq(outboxEvents.id, eventId));
  }

  private async getIdempotencyRecord(key: string, kind: IdempotencyKind) {
    const query = this.database
      .select()
      .from(idempotencyRecords)
      .where(and(eq(idempotencyRecords.key, key), eq(idempotencyRecords.kind, kind)))
      .limit(1);
    const rows = this.lockAggregateReads ? await query.for("update") : await query;
    return rows[0];
  }

  private async saveIdempotencyRecord(
    key: string,
    kind: IdempotencyKind,
    resourceId: string,
    requestHash: string,
  ): Promise<void> {
    const inserted = await this.database
      .insert(idempotencyRecords)
      .values({ key, kind, resourceId, requestHash })
      .onConflictDoNothing({ target: idempotencyRecords.key })
      .returning({ key: idempotencyRecords.key });
    if (inserted.length === 0) {
      throw new BridgeError(
        "CONFLICT",
        "A concurrent request claimed this idempotency key; retry to retrieve its result.",
        409,
      );
    }
  }
}
