import { randomUUID } from "node:crypto";

import { BridgeService, type BridgeRepository } from "@bridge/application";
import type { Principal, Project } from "@bridge/domain";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { createPostgresBridgeStore } from "./index.js";
import { migrateDatabase } from "./migrate.js";

const databaseUrl = process.env.BRIDGE_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function inTenant<T>(
  repository: BridgeRepository,
  organizationId: string,
  work: (scopedRepository: BridgeRepository) => Promise<T>,
): Promise<T> {
  return repository.transaction(work, { organizationId });
}

describeWithDatabase("PostgresBridgeRepository", () => {
  it("enforces transaction-local organization scope with forced row security", async () => {
    if (!databaseUrl) return;
    await migrateDatabase(databaseUrl);

    const suffix = randomUUID().replaceAll("-", "");
    const organizationIds = [`org_rls_a_${suffix}`, `org_rls_b_${suffix}`] as const;
    const projectIds = [`prj_rls_a_${suffix}`, `prj_rls_b_${suffix}`] as const;
    const store = createPostgresBridgeStore(databaseUrl);
    const client = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
    let testRole: string | undefined;
    try {
      for (const [index, organizationId] of organizationIds.entries()) {
        await store.repository.saveOrganization({
          id: organizationId,
          externalIdentityProviderId: `rls-${organizationId}`,
          slug: `rls-${index}-${suffix}`,
          name: `RLS Organization ${index + 1}`,
          createdAt: "2026-01-01T00:00:00.000Z",
        });
        await inTenant(store.repository, organizationId, (repository) => repository.saveProject({
          id: projectIds[index]!,
          organizationId,
          name: `RLS Project ${index + 1}`,
          decisionOwnerIds: [],
        }));
      }

      const protectedTables = [
        "bridge_agent_runs",
        "bridge_adapter_diagnostics",
        "bridge_project_repositories",
        "bridge_project_ownership_configurations",
        "bridge_artifact_versions",
        "bridge_artifacts",
        "bridge_assumptions",
        "bridge_audit_events",
        "bridge_context_snapshots",
        "bridge_decisions",
        "bridge_idempotency_records",
        "bridge_notifications",
        "bridge_organization_audit_events",
        "bridge_organization_memberships",
        "bridge_outbox_deliveries",
        "bridge_outbox_events",
        "bridge_project_memberships",
        "bridge_projects",
        "bridge_question_responses",
        "bridge_questions",
        "bridge_run_continuation_locators",
      ];
      const policyState = await client<{
        relname: string;
        enabled: boolean;
        forced: boolean;
      }[]>`
        select relname, relrowsecurity as enabled, relforcerowsecurity as forced
        from pg_class
        where relname in ${client(protectedTables)}
        order by relname
      `;
      expect(policyState).toHaveLength(protectedTables.length);
      expect(policyState.every((table) => table.enabled && table.forced)).toBe(true);

      const [runtimeRole] = await client<{ bypassesRls: boolean }[]>`
        select (rolsuper or rolbypassrls) as "bypassesRls"
        from pg_roles
        where rolname = current_user
      `;
      if (runtimeRole?.bypassesRls) {
        testRole = `bridge_rls_test_${suffix}`;
        await client`create role ${client(testRole)} nologin nobypassrls`;
        await client`grant usage on schema public to ${client(testRole)}`;
        await client`grant select, insert, update on table bridge_projects to ${client(testRole)}`;
      }

      await expect(client.begin(async (transaction) => {
        if (testRole) await transaction`set local role ${transaction(testRole)}`;
        await transaction`select set_config('bridge.organization_id', ${organizationIds[0]}, true)`;
        await transaction`
          insert into bridge_projects (id, organization_id, name, decision_owner_ids)
          values (
            ${`prj_rls_cross_write_${suffix}`},
            ${organizationIds[1]},
            'Cross-tenant write',
            '[]'::jsonb
          )
        `;
      })).rejects.toMatchObject({ code: "42501" });

      await client.begin(async (transaction) => {
        if (testRole) await transaction`set local role ${transaction(testRole)}`;

        const unscoped = await transaction<{ id: string }[]>`
          select id from bridge_projects where id in ${transaction(projectIds)} order by id
        `;
        expect(unscoped).toEqual([]);

        await transaction`select set_config('bridge.organization_id', ${organizationIds[0]}, true)`;
        const firstTenant = await transaction<{ id: string }[]>`
          select id from bridge_projects where id in ${transaction(projectIds)} order by id
        `;
        expect(firstTenant).toEqual([{ id: projectIds[0] }]);
        const crossTenantUpdate = await transaction<{ id: string }[]>`
          update bridge_projects
          set name = 'Cross-tenant update'
          where id = ${projectIds[1]}
          returning id
        `;
        expect(crossTenantUpdate).toEqual([]);

        await transaction`select set_config('bridge.organization_id', ${organizationIds[1]}, true)`;
        const secondTenant = await transaction<{ id: string }[]>`
          select id from bridge_projects where id in ${transaction(projectIds)} order by id
        `;
        expect(secondTenant).toEqual([{ id: projectIds[1] }]);
      });

      await expect(store.repository.transaction(
        () => Promise.resolve(undefined),
        { organizationId: organizationIds[0], maintenance: true },
      )).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(store.repository.transaction(
        () => Promise.resolve(undefined),
        { maintenance: true },
      )).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      if (testRole) {
        await client`drop owned by ${client(testRole)}`;
        await client`drop role if exists ${client(testRole)}`;
      }
      await Promise.all([store.close(), client.end()]);
    }
  });

  it("protects bootstrap directories behind bounded security-definer lookups", async () => {
    if (!databaseUrl) return;
    await migrateDatabase(databaseUrl);

    const suffix = randomUUID().replaceAll("-", "");
    const organizationId = `org_bootstrap_${suffix}`;
    const principalId = `usr_bootstrap_${suffix}`;
    const credentialId = `svc_bootstrap_${suffix}`;
    const externalIdentityProviderId = `bootstrap-${suffix}`;
    const tokenHash = `hash-${suffix}`;
    const store = createPostgresBridgeStore(databaseUrl);
    const client = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
    let testRole: string | undefined;
    try {
      await store.repository.saveOrganization({
        id: organizationId,
        externalIdentityProviderId,
        slug: `bootstrap-${suffix}`,
        name: "Bootstrap Directory Test",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      await store.repository.savePrincipalIdentity({
        id: principalId,
        type: "agent",
        displayName: "Bootstrap Agent",
        oidcIssuer: "https://identity.example/",
        oidcSubject: `bootstrap|${suffix}`,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      await inTenant(store.repository, organizationId, (repository) => repository.saveOrganizationMembership({
        organizationId,
        principalId,
        status: "active",
        roles: ["agent"],
        allProjects: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      }));
      await store.repository.saveServiceCredential({
        id: credentialId,
        organizationId,
        principalId,
        name: "Bootstrap token",
        tokenHash,
        scopes: ["bridge:read"],
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        version: 1,
      });

      expect((await store.repository.getOrganizationByExternalId(externalIdentityProviderId))?.id)
        .toBe(organizationId);
      expect((await store.repository.getPrincipalIdentityByOidc(
        "https://identity.example/",
        `bootstrap|${suffix}`,
      ))?.id).toBe(principalId);
      expect((await store.repository.getServiceCredentialByTokenHash(tokenHash))?.id)
        .toBe(credentialId);
      await inTenant(store.repository, organizationId, async (repository) => {
        expect((await repository.getPrincipalIdentity(principalId))?.id).toBe(principalId);
        expect((await repository.getServiceCredential(credentialId))?.id).toBe(credentialId);
        expect((await repository.listServiceCredentials(organizationId)).map((credential) => credential.id))
          .toEqual([credentialId]);
      });

      const [runtimeRole] = await client<{ bypassesRls: boolean; canCreateRole: boolean }[]>`
        select (rolsuper or rolbypassrls) as "bypassesRls", rolcreaterole as "canCreateRole"
        from pg_roles
        where rolname = current_user
      `;
      if (runtimeRole?.bypassesRls || runtimeRole?.canCreateRole) {
        testRole = `bridge_bootstrap_test_${suffix}`;
        const testRoleName = testRole;
        await client`create role ${client(testRoleName)} nologin nobypassrls`;
        await client`grant usage on schema public to ${client(testRoleName)}`;
        await client`grant execute on function public.bridge_lookup_principal_identity_by_oidc(text, text) to ${client(testRoleName)}`;
        await client`grant execute on function public.bridge_lookup_organization_by_external_id(text) to ${client(testRoleName)}`;
        await client`grant execute on function public.bridge_lookup_service_token(text) to ${client(testRoleName)}`;
        await client`grant execute on function public.bridge_get_principal_identity(text) to ${client(testRoleName)}`;
        await client`grant execute on function public.bridge_get_service_credential(text) to ${client(testRoleName)}`;
        await client`grant execute on function public.bridge_list_service_credentials(text) to ${client(testRoleName)}`;

        for (const table of [
          "bridge_organizations",
          "bridge_principal_identities",
          "bridge_service_credentials",
        ]) {
          await expect(client.begin(async (transaction) => {
            await transaction`set local role ${transaction(testRoleName)}`;
            await transaction.unsafe(`select id from public.${table} limit 1`);
          })).rejects.toMatchObject({ code: "42501" });
        }

        await client.begin(async (transaction) => {
          await transaction`set local role ${transaction(testRoleName)}`;
          const organization = await transaction<{ id: string }[]>`
            select id from public.bridge_lookup_organization_by_external_id(${externalIdentityProviderId})
          `;
          expect(organization).toEqual([{ id: organizationId }]);
          const token = await transaction<{ id: string; principal_id: string }[]>`
            select id, principal_id from public.bridge_lookup_service_token(${tokenHash})
          `;
          expect(token).toEqual([{ id: credentialId, principal_id: principalId }]);
          await transaction`select set_config('bridge.organization_id', ${organizationId}, true)`;
          const identity = await transaction<{ id: string }[]>`
            select id from public.bridge_get_principal_identity(${principalId})
          `;
          expect(identity).toEqual([{ id: principalId }]);
          const credentials = await transaction<{ id: string }[]>`
            select id from public.bridge_list_service_credentials(${organizationId})
          `;
          expect(credentials).toEqual([{ id: credentialId }]);
        });
      }
    } finally {
      if (testRole) {
        await client`drop owned by ${client(testRole)}`;
        await client`drop role if exists ${client(testRole)}`;
      }
      await Promise.all([store.close(), client.end()]);
    }
  });

  it("persists run provenance, assumptions, decisions, and approved specifications across connections", async () => {
    if (!databaseUrl) return;
    await migrateDatabase(databaseUrl);

    const suffix = randomUUID();
    const project: Project = {
      id: `prj_${suffix}`,
      organizationId: `org_${suffix}`,
      name: "PostgreSQL Integration Test",
      decisionOwnerIds: [`usr_${suffix}`],
    };
    const owner: Principal = {
      id: project.decisionOwnerIds[0]!,
      type: "human",
      organizationId: project.organizationId,
      projectIds: [project.id],
      roles: ["project-admin", "security-reviewer"],
      displayName: "Integration Owner",
    };
    const agent: Principal = {
      id: `agt_${suffix}`,
      type: "agent",
      organizationId: project.organizationId,
      projectIds: [project.id],
      roles: ["agent"],
      displayName: "Integration Agent",
    };

    const firstStore = createPostgresBridgeStore(databaseUrl);
    let decisionId: string;
    let replacementDecisionId: string;
    let artifactVersionId: string;
    let artifactId: string;
    let assumptionId: string;
    let runId: string;
    let questionId: string;
    let replacementQuestionId: string;
    let contextConsumerRunId: string;
    let deliveryEventId: string;
    try {
      await firstStore.repository.saveOrganization({
        id: project.organizationId,
        externalIdentityProviderId: `auth0-${project.organizationId}`,
        slug: `integration-${suffix}`,
        name: "PostgreSQL Integration Organization",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      await inTenant(firstStore.repository, project.organizationId, (repository) =>
        repository.saveProject(project));
      await firstStore.repository.savePrincipalIdentity({
        id: owner.id,
        type: owner.type,
        displayName: owner.displayName,
        oidcIssuer: "https://identity.example/",
        oidcSubject: `auth0|${owner.id}`,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      await inTenant(firstStore.repository, project.organizationId, (repository) =>
        repository.saveOrganizationMembership({
        organizationId: project.organizationId,
        principalId: owner.id,
        status: "active",
        roles: ["organization-member"],
        allProjects: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
        }));
      await inTenant(firstStore.repository, project.organizationId, (repository) =>
        repository.saveProjectMembership({
        organizationId: project.organizationId,
        projectId: project.id,
        principalId: owner.id,
        status: "active",
        roles: owner.roles,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
        }));
      expect(await inTenant(firstStore.repository, project.organizationId, (repository) =>
        repository.saveOrganizationMembership({
        organizationId: project.organizationId,
        principalId: owner.id,
        status: "active",
        roles: ["organization-member", "project-admin"],
        allProjects: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        version: 2,
        }, 1))).toBe(true);
      expect(await inTenant(firstStore.repository, project.organizationId, (repository) =>
        repository.saveOrganizationMembership({
        organizationId: project.organizationId,
        principalId: owner.id,
        status: "disabled",
        roles: [],
        allProjects: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
        version: 3,
        }, 1))).toBe(false);
      await inTenant(firstStore.repository, project.organizationId, (repository) =>
        repository.saveOrganizationAuditEvent({
        id: `oaud_${suffix}`,
        correlationId: `cor_${suffix}`,
        organizationId: project.organizationId,
        actorId: owner.id,
        actorType: "human",
        action: "organization_member.updated",
        subjectType: "organization_membership",
        subjectId: owner.id,
        createdAt: "2026-01-02T00:00:00.000Z",
        }));
      await inTenant(firstStore.repository, project.organizationId, (repository) =>
        repository.saveOrganizationAuditEvent({
        id: `oaud_export_${suffix}`,
        correlationId: `cor_export_${suffix}`,
        organizationId: project.organizationId,
        actorId: owner.id,
        actorType: "human",
        action: "audit.exported",
        subjectType: "audit_export",
        subjectId: `aex_${suffix}`,
        createdAt: "2026-01-03T00:00:00.000Z",
        }));
      await expect(inTenant(firstStore.repository, project.organizationId, (repository) =>
        repository.listOrganizationAuditEvents(project.organizationId)))
        .resolves.toEqual(expect.arrayContaining([
          expect.objectContaining({ subjectId: owner.id, action: "organization_member.updated" }),
          expect.objectContaining({ subjectId: `aex_${suffix}`, action: "audit.exported" }),
        ]));
      const service = new BridgeService(firstStore.repository);
      const registration = await service.startRun(agent, project.id, {
        idempotencyKey: `run-${suffix}`,
        client: "codex",
        capability: "cli",
        taskSummary: "Verify durable PostgreSQL run provenance",
        scope: { component: "persistence" },
        externalLinks: [],
      });
      runId = registration.run.id;
      const question = await service.createQuestion(agent, project.id, {
        idempotencyKey: `question-${suffix}`,
        runId,
        title: "Which durable repository should Bridge use for this project?",
        type: "decision",
        category: "architecture",
        context: "The integration test must preserve accepted context after reconnecting.",
        whyItMatters: "Durability is the reason for replacing the in-memory repository.",
        intendedOwnerIds: [owner.id],
        intendedOwnerRoles: [],
        risk: "high",
        reversible: false,
        blocking: true,
        options: [
          { key: "postgres", label: "PostgreSQL", tradeoffs: "Requires a managed database." },
          { key: "memory", label: "In-memory", tradeoffs: "Loses state on restart." },
        ],
        recommendationKey: "postgres",
        scope: { component: "persistence" },
      });
      questionId = question.id;
      const decision = await service.acceptAnswer(owner, question.id, {
        optionKey: "postgres",
        rationale: "PostgreSQL provides durable transactions and concurrency controls.",
      });
      decisionId = decision.id;

      const contextConsumer = await service.startRun(agent, project.id, {
        idempotencyKey: `context-consumer-run-${suffix}`,
        client: "codex",
        capability: "cli",
        taskSummary: "Consume the current persistence decision",
        scope: { component: "persistence" },
        externalLinks: [],
      });
      contextConsumerRunId = contextConsumer.run.id;
      await service.getContext(agent, project.id, {
        runId: contextConsumerRunId,
        task: "Implement the accepted PostgreSQL persistence policy",
        scope: { component: "persistence" },
        categories: ["architecture"],
        maxItems: 20,
      });

      const assumption = await service.recordAssumption(agent, project.id, {
        idempotencyKey: `assumption-${suffix}`,
        runId,
        statement: "Persistence integration metrics may use the existing Bridge namespace.",
        rationale: "The namespace is internal, reversible, and consistent with adjacent integration metrics.",
        category: "observability",
        risk: "low",
        confidence: "medium",
        reversible: true,
        reversalCost: "Rename the metric and update its internal dashboard query.",
        scope: { component: "persistence" },
        sourceLinks: [],
      });
      assumptionId = assumption.id;

      const publication = await service.publishArtifact(agent, project.id, {
        idempotencyKey: `artifact-${suffix}`,
        runId,
        title: "Persistence architecture",
        type: "adr",
        summary: "Uses PostgreSQL behind the Bridge repository contract.",
        body: "# Persistence architecture\n\nUse PostgreSQL behind the Bridge repository contract.",
        intendedReviewerIds: [owner.id],
        citedDecisionIds: [decision.id],
        requestReview: true,
        scope: { component: "persistence" },
      });
      await service.reviewArtifactVersion(owner, publication.version.id, {
        status: "commented",
        body: "The persistence boundary is clear; retain the reconnect behavior in the final version.",
      });
      await service.approveArtifactVersion(owner, publication.version.id, {
        rationale: "The specification accurately implements the accepted persistence decision.",
      });
      artifactVersionId = publication.version.id;
      artifactId = publication.artifact.id;

      const replacementQuestion = await service.createQuestion(agent, project.id, {
        idempotencyKey: `replacement-question-${suffix}`,
        runId,
        title: "Which revised durable repository policy should replace the first?",
        type: "decision",
        category: "architecture",
        context: "New operational evidence requires a more precise PostgreSQL durability policy.",
        whyItMatters: "The previous accepted rule must leave active context without losing its history.",
        intendedOwnerIds: [owner.id],
        intendedOwnerRoles: [],
        risk: "high",
        reversible: false,
        blocking: true,
        options: [
          { key: "postgres-ha", label: "Highly available PostgreSQL", tradeoffs: "Adds operational cost and resilience." },
          { key: "postgres-single", label: "Single-node PostgreSQL", tradeoffs: "Costs less with a larger recovery window." },
        ],
        recommendationKey: "postgres-ha",
        scope: { component: "persistence" },
      });
      replacementQuestionId = replacementQuestion.id;
      const replacement = await service.acceptAnswer(owner, replacementQuestion.id, {
        optionKey: "postgres-ha",
        rationale: "Highly available PostgreSQL preserves the required durable transaction boundary during node failure.",
      });
      replacementDecisionId = replacement.id;
      const lifecycle = await service.changeDecisionLifecycle(owner, decision.id, {
        expectedVersion: decision.version,
        status: "superseded",
        rationale: "The highly available PostgreSQL decision replaces the original generic persistence rule.",
        replacementDecisionId: replacement.id,
      });
      expect(lifecycle).toMatchObject({
        decision: { status: "superseded", version: 2, replacementDecisionId: replacement.id },
        impact: { artifactIds: [publication.artifact.id], runIds: [runId, contextConsumerRunId] },
      });
      const deliveryEvent = (await inTenant(firstStore.repository, project.organizationId, (repository) =>
        repository.listOutboxEvents(project.id)))
        .find((event) => event.type === "notification.created");
      if (!deliveryEvent) throw new Error("Expected a notification delivery event.");
      deliveryEventId = deliveryEvent.id;
      await inTenant(firstStore.repository, project.organizationId, (repository) =>
        repository.saveOutboxDelivery({
        id: `odl_${suffix}`,
        organizationId: project.organizationId,
        projectId: project.id,
        outboxEventId: deliveryEvent.id,
        channel: "email",
        destinationHash: "c".repeat(64),
        status: "delivered",
        attemptCount: 1,
        preference: "immediate",
        providerMessageId: `provider-${suffix}`,
        createdAt: deliveryEvent.createdAt,
        updatedAt: deliveryEvent.createdAt,
        }));
    } finally {
      await firstStore.close();
    }

    const secondStore = createPostgresBridgeStore(databaseUrl);
    try {
      const service = new BridgeService(secondStore.repository);
      await expect(secondStore.repository.resolveOidcPrincipal({
        issuer: "https://identity.example/",
        subject: `auth0|${owner.id}`,
        organizationExternalId: `auth0-${project.organizationId}`,
      })).resolves.toMatchObject({
        id: owner.id,
        projectIds: [project.id],
        projectRoles: { [project.id]: owner.roles },
      });
      expect(await service.getRun(agent, runId)).toMatchObject({
        id: runId,
        status: "waiting_for_human",
        questionIds: [questionId, replacementQuestionId],
        assumptionIds: [assumptionId],
        artifactVersionIds: [artifactVersionId],
      });
      const context = await service.getContext(agent, project.id, {
        runId,
        task: "Continue implementing PostgreSQL persistence",
        scope: { component: "persistence" },
        categories: [],
        maxItems: 20,
      });
      expect(context.items.map((item) => item.id)).toEqual(
        expect.arrayContaining([replacementDecisionId, artifactVersionId, assumptionId]),
      );
      expect(context.items.map((item) => item.id)).not.toContain(decisionId);
      expect(await service.listDecisions(owner, project.id, { includeHistory: true, scope: {} })).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: decisionId,
          status: "superseded",
          replacementDecisionId,
          version: 2,
        }),
      ]));
      expect(await service.listDecisions(owner, project.id, {
        includeHistory: false,
        search: "node failure",
        scope: {},
      })).toEqual([expect.objectContaining({ id: replacementDecisionId, status: "active" })]);
      expect(await service.listDecisions(owner, project.id, {
        includeHistory: false,
        search: "concurrency controls",
        scope: {},
      })).toEqual([]);
      expect(await service.listDecisions(owner, project.id, {
        includeHistory: true,
        search: "concurrency controls",
        scope: {},
      })).toEqual([expect.objectContaining({ id: decisionId, status: "superseded" })]);
      expect(await service.getArtifact(owner, artifactId)).toMatchObject({
        versions: [expect.objectContaining({
          id: artifactVersionId,
          reviews: [expect.objectContaining({ status: "commented", reviewerId: owner.id })],
        })],
      });
      const persistedOutbox = await inTenant(secondStore.repository, project.organizationId, (repository) =>
        repository.listOutboxEvents(project.id));
      expect(persistedOutbox).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "decision.lifecycle_changed",
          payload: expect.objectContaining({ decisionId, replacementDecisionId }),
        }),
      ]));
      const questionEvent = persistedOutbox.find((event) =>
        event.type === "notification.created" &&
        "targetId" in event.payload &&
        event.payload.targetId === questionId,
      );
      const questionAudit = (await inTenant(secondStore.repository, project.organizationId, (repository) =>
        repository.listAuditEvents(project.id)))
        .find((event) => event.action === "question.created" && event.subjectId === questionId);
      expect(questionAudit?.correlationId).toMatch(/^cor_[0-9a-f]{32}$/);
      expect(questionEvent?.correlationId).toBe(questionAudit?.correlationId);
      expect(await inTenant(secondStore.repository, project.organizationId, (repository) =>
        repository.listOutboxDeliveries(project.id))).toEqual([
        expect.objectContaining({
          outboxEventId: deliveryEventId,
          channel: "email",
          status: "delivered",
          destinationHash: "c".repeat(64),
          providerMessageId: `provider-${suffix}`,
        }),
      ]);
    } finally {
      await secondStore.close();
    }
  });
});
