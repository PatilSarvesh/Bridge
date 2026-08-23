import type {
  BridgeRepository,
  QuestionMatchCandidateQuery,
  RepositoryTransactionContext,
} from "@bridge/application";
import { BridgeError } from "@bridge/domain";
import {
  type BridgeMetrics,
  currentCorrelationId,
  runWithCorrelationContextIfAbsent,
} from "@bridge/observability";
import type {
  AdapterDiagnostic,
  AgentRun,
  Assumption,
  Artifact,
  AuditEvent,
  ContextSnapshot,
  Decision,
  DirectoryGroup,
  DirectoryGroupMember,
  GithubPullRequestContext,
  GithubIssueWorkItem,
  Notification,
  NotificationPreference,
  Organization,
  OrganizationAuditEvent,
  OrganizationMembership,
  OutboxDelivery,
  OutboxEvent,
  Principal,
  PrincipalIdentity,
  Project,
  ProjectMembership,
  ProjectOwnershipConfiguration,
  ProjectPolicyConfiguration,
  RepositoryRecord,
  Question,
  ServiceCredential,
  ServiceTokenResolution,
} from "@bridge/domain";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  artifactFromRows,
  adapterDiagnosticFromRow,
  adapterDiagnosticToRow,
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
  directoryGroupFromRow,
  directoryGroupMemberFromRow,
  directoryGroupMemberToRow,
  directoryGroupToRow,
  githubPullRequestFromRow,
  githubPullRequestToRow,
  githubIssueFromRow,
  githubIssueToRow,
  notificationFromRow,
  notificationPreferenceFromRow,
  notificationPreferenceToRow,
  notificationToRow,
  organizationAuditEventFromRow,
  organizationAuditEventToRow,
  organizationMembershipFromRow,
  organizationMembershipToRow,
  organizationToRow,
  outboxDeliveryFromRow,
  outboxDeliveryToRow,
  outboxEventFromRow,
  outboxEventToRow,
  organizationFromRow,
  principalIdentityToRow,
  projectMembershipFromRow,
  projectMembershipToRow,
  projectOwnershipConfigurationFromRow,
  projectOwnershipConfigurationToRow,
  projectPolicyConfigurationFromRow,
  projectPolicyConfigurationToRow,
  projectFromRow,
  projectToRow,
  repositoryRecordFromRow,
  repositoryRecordToRow,
  serviceCredentialToRow,
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
  adapterDiagnostics,
  assumptions,
  artifactVersions,
  auditEvents,
  contextSnapshots,
  decisions,
  directoryGroups,
  directoryGroupMembers,
  githubPullRequests,
  githubIssues,
  idempotencyRecords,
  projects,
  projectRepositories,
  questionResponses,
  questions,
  runContinuationLocators,
  notifications,
  notificationPreferences,
  organizations,
  organizationAuditEvents,
  organizationMemberships,
  outboxDeliveries,
  outboxEvents,
  principalIdentities,
  projectMemberships,
  projectOwnershipConfigurations,
  projectPolicyConfigurations,
  serviceCredentials,
} from "./schema.js";

function questionSearchTsQuery(value: string): string {
  const lexemes = value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .split(/[^\p{L}\p{N}_]+/gu)
    .filter((lexeme) => lexeme.length > 0 && lexeme.length <= 100);
  return [...new Set(lexemes)].slice(0, 128).join(" | ") || "__bridge_no_match__";
}

type BridgeDatabase = PostgresJsDatabase<typeof schema>;
type IdempotencyKind = (typeof schema.idempotencyKindEnum.enumValues)[number];

interface PrincipalIdentityLookupRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly type: PrincipalIdentity["type"];
  readonly display_name: string;
  readonly oidc_issuer: string;
  readonly oidc_subject: string;
  readonly created_at: string;
}

interface OrganizationLookupRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly external_identity_provider_id: string;
  readonly slug: string;
  readonly name: string;
  readonly created_at: string;
}

interface ServiceCredentialLookupRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly organization_id: string;
  readonly principal_id: string;
  readonly name: string;
  readonly token_hash: string;
  readonly scopes: readonly string[];
  readonly created_at: string;
  readonly expires_at: string;
  readonly rotated_at: string | null;
  readonly revoked_at: string | null;
  readonly version: number;
}

interface ServiceTokenLookupRow extends ServiceCredentialLookupRow {
  readonly principal_type: PrincipalIdentity["type"];
  readonly principal_display_name: string;
  readonly principal_oidc_issuer: string;
  readonly principal_oidc_subject: string;
  readonly principal_created_at: string;
}

function principalIdentityFromLookupRow(row: PrincipalIdentityLookupRow): PrincipalIdentity {
  return {
    id: row.id,
    type: row.type,
    displayName: row.display_name,
    oidcIssuer: row.oidc_issuer,
    oidcSubject: row.oidc_subject,
    createdAt: row.created_at,
  };
}

function organizationFromLookupRow(row: OrganizationLookupRow): Organization {
  return {
    id: row.id,
    externalIdentityProviderId: row.external_identity_provider_id,
    slug: row.slug,
    name: row.name,
    createdAt: row.created_at,
  };
}

function serviceCredentialFromLookupRow(row: ServiceCredentialLookupRow): ServiceCredential {
  return {
    id: row.id,
    organizationId: row.organization_id,
    principalId: row.principal_id,
    name: row.name,
    tokenHash: row.token_hash,
    scopes: row.scopes,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...(row.rotated_at === null ? {} : { rotatedAt: row.rotated_at }),
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
    version: row.version,
  };
}

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
    private readonly transactionContext?: RepositoryTransactionContext,
    private readonly allowMaintenance = false,
  ) {}

  private async lookupServiceToken(tokenHash: string): Promise<ServiceTokenLookupRow | undefined> {
    const rows = await this.database.execute<ServiceTokenLookupRow>(sql`
      select * from public.bridge_lookup_service_token(${tokenHash})
    `);
    return rows[0];
  }

  async checkHealth(): Promise<{ readonly backend: string }> {
    const rows = await this.database.execute<{ readonly bypassesRls: boolean }>(sql`
      select (rolsuper or rolbypassrls) as "bypassesRls"
      from pg_roles
      where rolname = current_user
    `);
    const bypassesRls = rows[0]?.bypassesRls;
    if (bypassesRls === undefined) {
      throw new Error("The active PostgreSQL role could not be inspected.");
    }
    if (this.allowMaintenance ? !bypassesRls : bypassesRls) {
      throw new Error(this.allowMaintenance
        ? "The maintenance PostgreSQL role must have BYPASSRLS."
        : "The application PostgreSQL role must be non-superuser and NOBYPASSRLS.");
    }
    return { backend: "postgresql" };
  }

  async transaction<T>(
    work: (repository: BridgeRepository) => Promise<T>,
    context?: RepositoryTransactionContext,
  ): Promise<T> {
    if (!currentCorrelationId()) {
      return runWithCorrelationContextIfAbsent("application", () => this.transaction(work, context));
    }
    if (context?.organizationId && context.maintenance) {
      throw new BridgeError("VALIDATION_FAILED", "A database transaction cannot be tenant and maintenance scoped.", 500);
    }
    if (context?.maintenance && !this.allowMaintenance) {
      throw new BridgeError("FORBIDDEN", "The database connection is not configured for maintenance access.", 403);
    }
    if (this.lockAggregateReads) {
      if (
        context?.organizationId &&
        this.transactionContext?.organizationId !== context.organizationId
      ) {
        throw new BridgeError("FORBIDDEN", "A nested database transaction cannot change tenant scope.", 403);
      }
      if (context?.maintenance && !this.transactionContext?.maintenance) {
        throw new BridgeError("FORBIDDEN", "A nested database transaction cannot elevate to maintenance access.", 403);
      }
      return work(this);
    }

    const startedAt = performance.now();
    let outcome: "success" | "error" = "success";

    try {
      return await this.database.transaction(async (transaction) => {
        const scopedDatabase = transaction as unknown as BridgeDatabase;
        if (context?.organizationId) {
          await scopedDatabase.execute(
            sql`select set_config('bridge.organization_id', ${context.organizationId}, true)`,
          );
        }
        return work(new PostgresBridgeRepository(
          scopedDatabase,
          true,
          this.metrics,
          context,
          this.allowMaintenance,
        ));
      }, { isolationLevel: "serializable" });
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
    const rows = await this.database.execute<OrganizationLookupRow>(sql`
      select * from public.bridge_lookup_organization_by_external_id(${externalIdentityProviderId})
    `);
    return rows[0] ? organizationFromLookupRow(rows[0]) : undefined;
  }

  async listOrganizations(): Promise<readonly Organization[]> {
    const rows = await this.database
      .select()
      .from(organizations)
      .orderBy(asc(organizations.id));
    return rows.map(organizationFromRow);
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
    const rows = await this.database.execute<PrincipalIdentityLookupRow>(sql`
      select * from public.bridge_lookup_principal_identity_by_oidc(${issuer}, ${subject})
    `);
    return rows[0] ? principalIdentityFromLookupRow(rows[0]) : undefined;
  }

  async getPrincipalIdentity(principalId: string): Promise<PrincipalIdentity | undefined> {
    const rows = await this.database.execute<PrincipalIdentityLookupRow>(sql`
      select * from public.bridge_get_principal_identity(${principalId})
    `);
    return rows[0] ? principalIdentityFromLookupRow(rows[0]) : undefined;
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

  async getServiceCredential(serviceCredentialId: string): Promise<ServiceCredential | undefined> {
    const rows = await this.database.execute<ServiceCredentialLookupRow>(sql`
      select * from public.bridge_get_service_credential(${serviceCredentialId})
    `);
    return rows[0] ? serviceCredentialFromLookupRow(rows[0]) : undefined;
  }

  async getServiceCredentialByTokenHash(tokenHash: string): Promise<ServiceCredential | undefined> {
    const row = await this.lookupServiceToken(tokenHash);
    return row ? serviceCredentialFromLookupRow(row) : undefined;
  }

  async listServiceCredentials(organizationId: string): Promise<readonly ServiceCredential[]> {
    const rows = await this.database.execute<ServiceCredentialLookupRow>(sql`
      select * from public.bridge_list_service_credentials(${organizationId})
    `);
    return rows.map(serviceCredentialFromLookupRow);
  }

  async saveServiceCredential(credential: ServiceCredential): Promise<void> {
    const row = serviceCredentialToRow(credential);
    await this.database.insert(serviceCredentials).values(row).onConflictDoUpdate({
      target: serviceCredentials.id,
      set: {
        name: row.name,
        scopes: row.scopes,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        version: row.version,
      },
    });
  }

  async revokeServiceCredential(
    credential: ServiceCredential,
    expectedVersion?: number,
  ): Promise<boolean> {
    const row = serviceCredentialToRow(credential);
    const expectedVersionCondition = expectedVersion === undefined
      ? sql``
      : sql`and version = ${expectedVersion}`;
    const updated = await this.database.execute(sql`
      update public.bridge_service_credentials
      set revoked_at = ${row.revokedAt}, version = ${row.version}
      where id = ${credential.id}
        and organization_id = nullif(current_setting('bridge.organization_id', true), '')
        ${expectedVersionCondition}
    `);
    return updated.count === 1;
  }

  async rotateServiceCredential(
    credential: ServiceCredential,
    expectedVersion?: number,
  ): Promise<boolean> {
    const row = serviceCredentialToRow(credential);
    const expectedVersionCondition = expectedVersion === undefined
      ? sql``
      : sql`and version = ${expectedVersion}`;
    const updated = await this.database.execute(sql`
      update public.bridge_service_credentials
      set token_hash = ${row.tokenHash}, rotated_at = ${row.rotatedAt}, version = ${row.version}
      where id = ${credential.id}
        and organization_id = nullif(current_setting('bridge.organization_id', true), '')
        ${expectedVersionCondition}
    `);
    return updated.count === 1;
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

  async listOrganizationMemberships(
    organizationId: string,
  ): Promise<readonly OrganizationMembership[]> {
    const rows = await this.database
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, organizationId))
      .orderBy(asc(organizationMemberships.principalId));
    return rows.map(organizationMembershipFromRow);
  }

  async saveOrganizationMembership(
    membership: OrganizationMembership,
    expectedVersion?: number,
  ): Promise<boolean> {
    const row = organizationMembershipToRow(membership);
    if (expectedVersion !== undefined) {
      const updated = await this.database.update(organizationMemberships).set({
        status: row.status,
        roles: row.roles,
        allProjects: row.allProjects,
        provisioning: row.provisioning,
        updatedAt: row.updatedAt,
        version: row.version,
      }).where(and(
        eq(organizationMemberships.organizationId, membership.organizationId),
        eq(organizationMemberships.principalId, membership.principalId),
        eq(organizationMemberships.version, expectedVersion),
      )).returning({ principalId: organizationMemberships.principalId });
      return updated.length === 1;
    }
    await this.database.insert(organizationMemberships).values(row).onConflictDoUpdate({
      target: [organizationMemberships.organizationId, organizationMemberships.principalId],
      set: {
        status: row.status,
        roles: row.roles,
        allProjects: row.allProjects,
        provisioning: row.provisioning,
        updatedAt: row.updatedAt,
        version: row.version,
      },
    });
    return true;
  }

  async getDirectoryGroup(groupId: string): Promise<DirectoryGroup | undefined> {
    const [row] = await this.database
      .select()
      .from(directoryGroups)
      .where(eq(directoryGroups.id, groupId))
      .limit(1);
    return row ? directoryGroupFromRow(row) : undefined;
  }

  async listDirectoryGroups(organizationId: string): Promise<readonly DirectoryGroup[]> {
    const rows = await this.database
      .select()
      .from(directoryGroups)
      .where(eq(directoryGroups.organizationId, organizationId))
      .orderBy(asc(directoryGroups.displayName), asc(directoryGroups.id));
    return rows.map(directoryGroupFromRow);
  }

  async saveDirectoryGroup(group: DirectoryGroup, expectedVersion?: number): Promise<boolean> {
    const row = directoryGroupToRow(group);
    if (expectedVersion === undefined) {
      const inserted = await this.database
        .insert(directoryGroups)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: directoryGroups.id });
      return inserted.length === 1;
    }
    const updated = await this.database
      .update(directoryGroups)
      .set({
        status: row.status,
        sourceUpdatedAt: row.sourceUpdatedAt,
        updatedAt: row.updatedAt,
        version: row.version,
      })
      .where(and(
        eq(directoryGroups.id, group.id),
        eq(directoryGroups.organizationId, group.organizationId),
        eq(directoryGroups.version, expectedVersion),
      ))
      .returning({ id: directoryGroups.id });
    return updated.length === 1;
  }

  async listDirectoryGroupMembers(groupId: string): Promise<readonly DirectoryGroupMember[]> {
    const rows = await this.database
      .select()
      .from(directoryGroupMembers)
      .where(eq(directoryGroupMembers.groupId, groupId))
      .orderBy(asc(directoryGroupMembers.externalSubject));
    return rows.map(directoryGroupMemberFromRow);
  }

  async listDirectoryGroupMembersForPrincipal(
    organizationId: string,
    principalId: string,
  ): Promise<readonly DirectoryGroupMember[]> {
    const rows = await this.database
      .select()
      .from(directoryGroupMembers)
      .where(and(
        eq(directoryGroupMembers.organizationId, organizationId),
        eq(directoryGroupMembers.principalId, principalId),
      ))
      .orderBy(asc(directoryGroupMembers.groupId));
    return rows.map(directoryGroupMemberFromRow);
  }

  async saveDirectoryGroupMember(
    member: DirectoryGroupMember,
    expectedVersion?: number,
  ): Promise<boolean> {
    const row = directoryGroupMemberToRow(member);
    if (expectedVersion === undefined) {
      const inserted = await this.database
        .insert(directoryGroupMembers)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: directoryGroupMembers.id });
      return inserted.length === 1;
    }
    const updated = await this.database
      .update(directoryGroupMembers)
      .set({
        principalId: row.principalId,
        displayName: row.displayName,
        status: row.status,
        updatedAt: row.updatedAt,
        version: row.version,
      })
      .where(and(
        eq(directoryGroupMembers.id, member.id),
        eq(directoryGroupMembers.organizationId, member.organizationId),
        eq(directoryGroupMembers.version, expectedVersion),
      ))
      .returning({ id: directoryGroupMembers.id });
    return updated.length === 1;
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

  async saveProjectMembership(
    membership: ProjectMembership,
    expectedVersion?: number,
  ): Promise<boolean> {
    const row = projectMembershipToRow(membership);
    if (expectedVersion !== undefined) {
      const updated = await this.database.update(projectMemberships).set({
        status: row.status,
        roles: row.roles,
        updatedAt: row.updatedAt,
        version: row.version,
      }).where(and(
        eq(projectMemberships.organizationId, membership.organizationId),
        eq(projectMemberships.projectId, membership.projectId),
        eq(projectMemberships.principalId, membership.principalId),
        eq(projectMemberships.version, expectedVersion),
      )).returning({ principalId: projectMemberships.principalId });
      return updated.length === 1;
    }
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
        version: row.version,
      },
    });
    return true;
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
    return this.transaction(async (repository) => {
      const organizationMembership = await repository.getOrganizationMembership(
        organization.id,
        principalIdentity.id,
      );
      if (!organizationMembership || organizationMembership.status !== "active") return undefined;
      const memberships = (await repository.listProjectMemberships(
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
    }, { organizationId: organization.id });
  }

  async resolveServiceToken(tokenHash: string): Promise<ServiceTokenResolution | undefined> {
    const lookup = await this.lookupServiceToken(tokenHash);
    const credential = lookup ? serviceCredentialFromLookupRow(lookup) : undefined;
    const expiresAt = credential ? Date.parse(credential.expiresAt) : Number.NaN;
    if (!lookup || !credential || credential.revokedAt || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return undefined;
    return this.transaction(async (repository) => {
      const organizationMembership = await repository.getOrganizationMembership(
        credential.organizationId,
        lookup.principal_id,
      );
      if (lookup.principal_type === "human" || !organizationMembership ||
        organizationMembership.status !== "active") return undefined;
      const memberships = (await repository.listProjectMemberships(
        credential.organizationId,
        lookup.principal_id,
      )).filter((membership) => membership.status === "active");
      return {
        credential,
        principal: {
          id: lookup.principal_id,
          type: lookup.principal_type,
          organizationId: credential.organizationId,
          projectIds: memberships.map((membership) => membership.projectId),
          allProjects: organizationMembership.allProjects,
          roles: organizationMembership.roles,
          projectRoles: Object.fromEntries(
            memberships.map((membership) => [membership.projectId, membership.roles]),
          ),
          displayName: lookup.principal_display_name,
        },
      };
    }, { organizationId: credential.organizationId });
  }

  async listOrganizationPrincipals(organizationId: string): Promise<readonly Principal[]> {
    const memberships = (await this.listOrganizationMemberships(organizationId))
      .filter((membership) => membership.status === "active");
    const principals = await Promise.all(memberships.map(async (membership): Promise<Principal | undefined> => {
      const identity = await this.getPrincipalIdentity(membership.principalId);
      if (!identity) return undefined;
      const projectMemberships = (await this.listProjectMemberships(organizationId, identity.id))
        .filter((membership) => membership.status === "active");
      return {
        id: identity.id,
        type: identity.type,
        organizationId,
        projectIds: projectMemberships.map((membership) => membership.projectId),
        allProjects: membership.allProjects,
        roles: membership.roles,
        projectRoles: Object.fromEntries(
          projectMemberships.map((membership) => [membership.projectId, membership.roles]),
        ),
        displayName: identity.displayName,
      };
    }));
    return principals
      .filter((principal): principal is Principal => principal !== undefined)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
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

  async getRepositoryRecord(repositoryId: string): Promise<RepositoryRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(projectRepositories)
      .where(eq(projectRepositories.id, repositoryId))
      .limit(1);
    return row ? repositoryRecordFromRow(row) : undefined;
  }

  async listProjectRepositories(projectId: string): Promise<readonly RepositoryRecord[]> {
    const rows = await this.database
      .select()
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, projectId))
      .orderBy(asc(projectRepositories.name), asc(projectRepositories.id));
    return rows.map(repositoryRecordFromRow);
  }

  async saveRepositoryRecord(repository: RepositoryRecord): Promise<void> {
    const row = repositoryRecordToRow(repository);
    await this.database
      .insert(projectRepositories)
      .values(row)
      .onConflictDoUpdate({
        target: projectRepositories.id,
        set: {
          organizationId: row.organizationId,
          projectId: row.projectId,
          provider: row.provider,
          owner: row.owner,
          name: row.name,
          canonicalUrl: row.canonicalUrl,
          createdAt: row.createdAt,
        },
      });
  }

  async getGithubPullRequest(
    pullRequestId: string,
  ): Promise<GithubPullRequestContext | undefined> {
    const [row] = await this.database
      .select()
      .from(githubPullRequests)
      .where(eq(githubPullRequests.id, pullRequestId))
      .limit(1);
    return row ? githubPullRequestFromRow(row) : undefined;
  }

  async listGithubPullRequests(projectId: string): Promise<readonly GithubPullRequestContext[]> {
    const rows = await this.database
      .select()
      .from(githubPullRequests)
      .where(eq(githubPullRequests.projectId, projectId))
      .orderBy(desc(githubPullRequests.sourceUpdatedAt), asc(githubPullRequests.id));
    return rows.map(githubPullRequestFromRow);
  }

  async saveGithubPullRequest(
    pullRequest: GithubPullRequestContext,
    expectedVersion?: number,
  ): Promise<boolean> {
    const row = githubPullRequestToRow(pullRequest);
    if (expectedVersion === undefined) {
      const inserted = await this.database
        .insert(githubPullRequests)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: githubPullRequests.id });
      return inserted.length === 1;
    }
    const updated = await this.database
      .update(githubPullRequests)
      .set({
        title: row.title,
        state: row.state,
        canonicalUrl: row.canonicalUrl,
        headBranch: row.headBranch,
        baseBranch: row.baseBranch,
        headSha: row.headSha,
        decisionIds: row.decisionIds,
        artifactVersionIds: row.artifactVersionIds,
        sourceUpdatedAt: row.sourceUpdatedAt,
        updatedAt: row.updatedAt,
        version: row.version,
      })
      .where(and(
        eq(githubPullRequests.id, pullRequest.id),
        eq(githubPullRequests.organizationId, pullRequest.organizationId),
        eq(githubPullRequests.projectId, pullRequest.projectId),
        eq(githubPullRequests.version, expectedVersion),
      ))
      .returning({ id: githubPullRequests.id });
    return updated.length === 1;
  }

  async getGithubIssue(issueId: string): Promise<GithubIssueWorkItem | undefined> {
    const [row] = await this.database
      .select()
      .from(githubIssues)
      .where(eq(githubIssues.id, issueId))
      .limit(1);
    return row ? githubIssueFromRow(row) : undefined;
  }

  async listGithubIssues(projectId: string): Promise<readonly GithubIssueWorkItem[]> {
    const rows = await this.database
      .select()
      .from(githubIssues)
      .where(eq(githubIssues.projectId, projectId))
      .orderBy(desc(githubIssues.sourceUpdatedAt), asc(githubIssues.id));
    return rows.map(githubIssueFromRow);
  }

  async saveGithubIssue(issue: GithubIssueWorkItem, expectedVersion?: number): Promise<boolean> {
    const row = githubIssueToRow(issue);
    if (expectedVersion === undefined) {
      const inserted = await this.database
        .insert(githubIssues)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: githubIssues.id });
      return inserted.length === 1;
    }
    const updated = await this.database
      .update(githubIssues)
      .set({
        reference: row.reference,
        title: row.title,
        state: row.state,
        canonicalUrl: row.canonicalUrl,
        labels: row.labels,
        decisionIds: row.decisionIds,
        artifactVersionIds: row.artifactVersionIds,
        sourceUpdatedAt: row.sourceUpdatedAt,
        updatedAt: row.updatedAt,
        version: row.version,
      })
      .where(and(
        eq(githubIssues.id, issue.id),
        eq(githubIssues.organizationId, issue.organizationId),
        eq(githubIssues.projectId, issue.projectId),
        eq(githubIssues.version, expectedVersion),
      ))
      .returning({ id: githubIssues.id });
    return updated.length === 1;
  }

  async getProjectOwnershipConfiguration(
    projectId: string,
  ): Promise<ProjectOwnershipConfiguration | undefined> {
    const [row] = await this.database
      .select()
      .from(projectOwnershipConfigurations)
      .where(eq(projectOwnershipConfigurations.projectId, projectId))
      .limit(1);
    return row ? projectOwnershipConfigurationFromRow(row) : undefined;
  }

  async saveProjectOwnershipConfiguration(
    configuration: ProjectOwnershipConfiguration,
    expectedVersion: number,
  ): Promise<boolean> {
    const row = projectOwnershipConfigurationToRow(configuration);
    if (expectedVersion === 0) {
      const inserted = await this.database
        .insert(projectOwnershipConfigurations)
        .values(row)
        .onConflictDoNothing()
        .returning({ projectId: projectOwnershipConfigurations.projectId });
      return inserted.length === 1;
    }
    const updated = await this.database
      .update(projectOwnershipConfigurations)
      .set({
        roles: row.roles,
        teams: row.teams,
        rules: row.rules,
        version: row.version,
        updatedById: row.updatedById,
        updatedAt: row.updatedAt,
      })
      .where(and(
        eq(projectOwnershipConfigurations.organizationId, configuration.organizationId),
        eq(projectOwnershipConfigurations.projectId, configuration.projectId),
        eq(projectOwnershipConfigurations.version, expectedVersion),
      ))
      .returning({ projectId: projectOwnershipConfigurations.projectId });
    return updated.length === 1;
  }

  async getProjectPolicyConfiguration(
    projectId: string,
  ): Promise<ProjectPolicyConfiguration | undefined> {
    const [row] = await this.database
      .select()
      .from(projectPolicyConfigurations)
      .where(eq(projectPolicyConfigurations.projectId, projectId))
      .limit(1);
    return row ? projectPolicyConfigurationFromRow(row) : undefined;
  }

  async saveProjectPolicyConfiguration(
    configuration: ProjectPolicyConfiguration,
    expectedVersion: number,
  ): Promise<boolean> {
    const row = projectPolicyConfigurationToRow(configuration);
    if (expectedVersion === 0) {
      const inserted = await this.database
        .insert(projectPolicyConfigurations)
        .values(row)
        .onConflictDoNothing()
        .returning({ projectId: projectPolicyConfigurations.projectId });
      return inserted.length === 1;
    }
    const updated = await this.database
      .update(projectPolicyConfigurations)
      .set({
        rules: row.rules,
        version: row.version,
        updatedById: row.updatedById,
        updatedAt: row.updatedAt,
      })
      .where(and(
        eq(projectPolicyConfigurations.organizationId, configuration.organizationId),
        eq(projectPolicyConfigurations.projectId, configuration.projectId),
        eq(projectPolicyConfigurations.version, expectedVersion),
      ))
      .returning({ projectId: projectPolicyConfigurations.projectId });
    return updated.length === 1;
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

  async listAdapterDiagnostics(projectId: string): Promise<readonly AdapterDiagnostic[]> {
    const rows = await this.database
      .select()
      .from(adapterDiagnostics)
      .where(eq(adapterDiagnostics.projectId, projectId))
      .orderBy(asc(adapterDiagnostics.client));
    return rows.map(adapterDiagnosticFromRow);
  }

  async saveAdapterDiagnostic(diagnostic: AdapterDiagnostic): Promise<void> {
    const row = adapterDiagnosticToRow(diagnostic);
    await this.database
      .insert(adapterDiagnostics)
      .values(row)
      .onConflictDoUpdate({
        target: [adapterDiagnostics.organizationId, adapterDiagnostics.projectId, adapterDiagnostics.client],
        set: {
          reportedById: row.reportedById,
          reportedByType: row.reportedByType,
          correlationId: row.correlationId,
          capabilities: row.capabilities,
          mcpStatus: row.mcpStatus,
          checks: row.checks,
          status: row.status,
          observedAt: row.observedAt,
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

  async getRunVendorSessionId(runId: string): Promise<string | undefined> {
    const [row] = await this.database
      .select({ vendorSessionId: runContinuationLocators.vendorSessionId })
      .from(runContinuationLocators)
      .where(eq(runContinuationLocators.runId, runId))
      .limit(1);
    return row?.vendorSessionId ?? undefined;
  }

  async saveRunContinuationKey(
    runId: string,
    resumeContextKey: string,
    vendorSessionId?: string,
  ): Promise<void> {
    await this.database
      .insert(runContinuationLocators)
      .values({ runId, resumeContextKey, vendorSessionId })
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

  async searchQuestionMatchCandidates(
    projectId: string,
    candidateQuery: QuestionMatchCandidateQuery,
  ): Promise<readonly Question[]> {
    const searchText = `${candidateQuery.title} ${candidateQuery.context}`;
    const tsQuery = questionSearchTsQuery(searchText);
    const document = sql`(
      setweight(to_tsvector('simple', coalesce(${questions.projectId}, '')), 'D') ||
      setweight(to_tsvector('simple', coalesce(${questions.title}, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(${questions.context}, '')), 'B')
    )`;
    const query = sql`to_tsquery('simple', ${tsQuery})`;
    const projectQuery = sql`plainto_tsquery('simple', ${projectId})`;
    const scopedTitle = `${projectId}:${candidateQuery.title}`;
    const scopedContext = `${projectId}:${candidateQuery.context}`;
    const rows = await this.database
      .select()
      .from(questions)
      .where(and(
        eq(questions.projectId, projectId),
        inArray(questions.status, ["open", "in_discussion", "accepted"]),
        or(
          sql`${document} @@ (${projectQuery} && ${query})`,
          sql`lower(${questions.projectId} || ':' || ${questions.title}) % lower(${scopedTitle})`,
          sql`lower(${questions.projectId} || ':' || ${questions.context}) % lower(${scopedContext})`,
        ),
      ))
      .orderBy(
        desc(sql<number>`greatest(
          ts_rank_cd(${document}, ${query}),
          similarity(lower(${questions.title}), lower(${candidateQuery.title})),
          similarity(lower(${questions.context}), lower(${candidateQuery.context}))
        )`),
        desc(questions.createdAt),
      );
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
          blockingEscalatedAt: row.blockingEscalatedAt,
          reviews: row.reviews,
          comments: row.comments,
          relatedLinks: row.relatedLinks,
          routing: row.routing,
          assignmentHistory: row.assignmentHistory,
          ownerIds: row.ownerIds,
          ownerRoles: row.ownerRoles,
          reviewerIds: row.reviewerIds,
          reviewerRoles: row.reviewerRoles,
          requiredReviewerRoles: row.requiredReviewerRoles,
          requiredReviewerQuorum: row.requiredReviewerQuorum,
          approvalOverride: row.approvalOverride,
          acceptedResponseId: row.acceptedResponseId,
          decisionId: row.decisionId,
          version: row.version,
        },
      });

    if (question.responses.length > 0) {
      await this.database
        .insert(questionResponses)
        .values(question.responses.map(responseToRow))
        .onConflictDoUpdate({
          target: questionResponses.id,
          set: {
            answer: sql.raw(`excluded.${questionResponses.answer.name}`),
            rationale: sql.raw(`excluded.${questionResponses.rationale.name}`),
            optionKey: sql.raw(`excluded.${questionResponses.optionKey.name}`),
            mentionedPrincipalIds: sql.raw(`excluded.${questionResponses.mentionedPrincipalIds.name}`),
            revisionHistory: sql.raw(`excluded.${questionResponses.revisionHistory.name}`),
          },
        });
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

  async saveOrganizationAuditEvent(event: OrganizationAuditEvent): Promise<void> {
    await this.database
      .insert(organizationAuditEvents)
      .values(organizationAuditEventToRow(event))
      .onConflictDoNothing({ target: organizationAuditEvents.id });
  }

  async listOrganizationAuditEvents(
    organizationId: string,
  ): Promise<readonly OrganizationAuditEvent[]> {
    const rows = await this.database
      .select()
      .from(organizationAuditEvents)
      .where(eq(organizationAuditEvents.organizationId, organizationId))
      .orderBy(desc(organizationAuditEvents.createdAt), desc(organizationAuditEvents.id));
    return rows.map(organizationAuditEventFromRow);
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

  async getNotificationPreference(
    organizationId: string,
    principalId: string,
    channel: NotificationPreference["channel"],
  ): Promise<NotificationPreference | undefined> {
    const [row] = await this.database
      .select()
      .from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.organizationId, organizationId),
        eq(notificationPreferences.principalId, principalId),
        eq(notificationPreferences.channel, channel),
      ))
      .limit(1);
    return row ? notificationPreferenceFromRow(row) : undefined;
  }

  async listNotificationPreferences(
    organizationId: string,
    principalId: string,
  ): Promise<readonly NotificationPreference[]> {
    const rows = await this.database
      .select()
      .from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.organizationId, organizationId),
        eq(notificationPreferences.principalId, principalId),
      ))
      .orderBy(asc(notificationPreferences.channel));
    return rows.map(notificationPreferenceFromRow);
  }

  async saveNotificationPreference(preference: NotificationPreference): Promise<void> {
    const row = notificationPreferenceToRow(preference);
    await this.database
      .insert(notificationPreferences)
      .values(row)
      .onConflictDoUpdate({
        target: [
          notificationPreferences.organizationId,
          notificationPreferences.principalId,
          notificationPreferences.channel,
        ],
        set: {
          preference: row.preference,
          updatedAt: row.updatedAt,
        },
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
          dedupeKey: row.dedupeKey,
          destinationHash: row.destinationHash,
          status: row.status,
          attemptCount: row.attemptCount,
          preference: row.preference,
          providerMessageId: row.providerMessageId,
          lastError: row.lastError,
          updatedAt: row.updatedAt,
          digestAvailableAt: row.digestAvailableAt,
          digestLeaseUntil: row.digestLeaseUntil,
        },
      });
  }

  async claimDeferredEmailDeliveries(
    now: string,
    limit: number,
    leaseMs = 5 * 60 * 1_000,
  ): Promise<readonly OutboxDelivery[]> {
    if (limit <= 0) return [];
    if (!this.allowMaintenance) {
      throw new BridgeError(
        "FORBIDDEN",
        "Claiming cross-tenant email digest work requires a maintenance database connection.",
        403,
      );
    }
    if (this.lockAggregateReads) {
      return this.claimDeferredEmailDeliveriesInTransaction(this.database, now, limit, leaseMs);
    }
    return this.database.transaction(
      async (transaction) =>
        new PostgresBridgeRepository(
          transaction as unknown as BridgeDatabase,
          true,
          this.metrics,
          { maintenance: true },
          true,
        ).claimDeferredEmailDeliveries(now, limit, leaseMs),
    );
  }

  private async claimDeferredEmailDeliveriesInTransaction(
    database: BridgeDatabase,
    now: string,
    limit: number,
    leaseMs: number,
  ): Promise<readonly OutboxDelivery[]> {
    const rows = await database
      .select()
      .from(outboxDeliveries)
      .where(and(
        eq(outboxDeliveries.channel, "email"),
        eq(outboxDeliveries.status, "deferred"),
        lte(outboxDeliveries.digestAvailableAt, now),
        or(isNull(outboxDeliveries.digestLeaseUntil), lte(outboxDeliveries.digestLeaseUntil, now)),
      ))
      .orderBy(asc(outboxDeliveries.digestAvailableAt), asc(outboxDeliveries.createdAt))
      .limit(limit)
      .for("update");
    if (rows.length === 0) return [];

    const digestLeaseUntil = new Date(Date.parse(now) + leaseMs).toISOString();
    const deliveries = rows.map((row) => ({
      ...outboxDeliveryFromRow(row),
      attemptCount: row.attemptCount + 1,
      digestLeaseUntil,
    }));
    for (const delivery of deliveries) {
      await database
        .update(outboxDeliveries)
        .set({
          attemptCount: delivery.attemptCount,
          digestLeaseUntil,
          updatedAt: now,
        })
        .where(eq(outboxDeliveries.id, delivery.id));
    }
    return deliveries;
  }

  async claimOutboxEvents(now: string, limit: number): Promise<readonly OutboxEvent[]> {
    if (limit <= 0) return [];
    if (!this.allowMaintenance) {
      throw new BridgeError("FORBIDDEN", "Claiming cross-tenant delivery work requires a maintenance database connection.", 403);
    }
    if (this.lockAggregateReads) return this.claimOutboxEventsInTransaction(this.database, now, limit);

    return this.database.transaction(
      async (transaction) =>
        new PostgresBridgeRepository(
          transaction as unknown as BridgeDatabase,
          true,
          this.metrics,
          { maintenance: true },
          true,
        ).claimOutboxEvents(now, limit),
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
    if (!this.allowMaintenance) {
      throw new BridgeError("FORBIDDEN", "Completing cross-tenant delivery work requires a maintenance database connection.", 403);
    }
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
    if (!this.allowMaintenance) {
      throw new BridgeError("FORBIDDEN", "Failing cross-tenant delivery work requires a maintenance database connection.", 403);
    }
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
    const organizationId = this.transactionContext?.organizationId;
    if (!organizationId) {
      throw new BridgeError(
        "FORBIDDEN",
        "Reading an idempotency record requires a tenant-scoped database transaction.",
        403,
      );
    }
    const query = this.database
      .select()
      .from(idempotencyRecords)
      .where(and(
        eq(idempotencyRecords.organizationId, organizationId),
        eq(idempotencyRecords.key, key),
        eq(idempotencyRecords.kind, kind),
      ))
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
    const organizationId = this.transactionContext?.organizationId;
    if (!organizationId) {
      throw new BridgeError(
        "FORBIDDEN",
        "Saving an idempotency record requires a tenant-scoped database transaction.",
        403,
      );
    }
    const inserted = await this.database
      .insert(idempotencyRecords)
      .values({ key, organizationId, kind, resourceId, requestHash })
      .onConflictDoNothing({
        target: [idempotencyRecords.organizationId, idempotencyRecords.key],
      })
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
