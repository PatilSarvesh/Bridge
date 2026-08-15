import { BridgeService, InMemoryBridgeRepository } from "@bridge/application";
import type { AuthenticationProvider } from "@bridge/auth";
import { BridgeError, type Principal, type Project } from "@bridge/domain";
import { BridgeMetrics } from "@bridge/observability";
import { createDemoRuntime, demoPrincipals, demoProject } from "@bridge/test-support";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "./app.js";

describe("Bridge API vertical slice", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("fails closed when production starts without OIDC", async () => {
    const runtime = await createDemoRuntime();
    vi.stubEnv("NODE_ENV", "production");
    await expect(buildApp({ service: runtime.service, principals: runtime.principals }))
      .rejects.toThrow("OIDC authentication is required");
  });

  it("enforces explicit read/write scopes for non-human bearer principals", async () => {
    const runtime = await createDemoRuntime();
    let currentPrincipal: Principal = {
      ...demoPrincipals.agent,
      scopes: [],
    };
    const authenticator: AuthenticationProvider = {
      mode: "oidc",
      publicConfiguration: () => ({ mode: "oidc" }),
      authenticateRequest: async () => currentPrincipal,
      beginWebLogin: async () => {
        throw new Error("not used");
      },
      completeWebLogin: async () => {
        throw new Error("not used");
      },
      endWebSession: () => {
        throw new Error("not used");
      },
    };
    const app = await buildApp({ service: runtime.service, principals: runtime.principals, authenticator });
    apps.push(app);

    const missingRead = await app.inject({ method: "GET", url: "/v1/projects" });
    expect(missingRead.statusCode).toBe(403);
    expect(missingRead.json()).toMatchObject({
      code: "FORBIDDEN",
      details: { requiredScope: "bridge:read" },
    });

    currentPrincipal = { ...currentPrincipal, scopes: ["bridge:read"] };
    const read = await app.inject({ method: "GET", url: "/v1/projects" });
    expect(read.statusCode).toBe(200);

    currentPrincipal = { ...currentPrincipal, scopes: ["bridge:write"] };
    const missingReadWithWriteOnly = await app.inject({ method: "GET", url: "/v1/projects" });
    expect(missingReadWithWriteOnly.statusCode).toBe(403);
    const write = await app.inject({
      method: "POST",
      url: "/v1/projects",
      payload: {},
    });
    expect(write.statusCode).toBe(400);

    currentPrincipal = { ...currentPrincipal, scopes: ["bridge:admin"] };
    expect((await app.inject({ method: "GET", url: "/v1/projects" })).statusCode).toBe(200);

    currentPrincipal = { ...demoPrincipals.architect, scopes: [] };
    expect((await app.inject({ method: "GET", url: "/v1/projects" })).statusCode).toBe(200);
  });

  it("distinguishes liveness from dependency-backed readiness without leaking failures", async () => {
    const metrics = new BridgeMetrics();
    const runtime = await createDemoRuntime({ serviceOptions: { metrics } });
    const app = await buildApp({ service: runtime.service, principals: runtime.principals, metrics });
    apps.push(app);

    const compatibility = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-bridge-correlation-id": "web_health-001" },
    });
    const live = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { "x-bridge-correlation-id": "x".repeat(200) },
    });
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(compatibility).toMatchObject({ statusCode: 200 });
    expect(compatibility.json()).toEqual({ status: "ok", service: "bridge-api" });
    expect(compatibility.headers["x-bridge-correlation-id"]).toBe("web_health-001");
    expect(live.json()).toEqual({ status: "ok", service: "bridge-api" });
    expect(live.headers["x-bridge-correlation-id"]).toMatch(/^cor_[0-9a-f]{32}$/);
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      service: "bridge-api",
      status: "ready",
      checks: [{ name: "repository", status: "ready", backend: "memory" }],
    });

    const denied = await app.inject({ method: "GET", url: "/v1/principals" });
    expect(denied.statusCode).toBe(401);
    const scrape = await app.inject({ method: "GET", url: "/metrics" });
    expect(scrape.statusCode).toBe(200);
    expect(scrape.headers["content-type"]).toContain("text/plain");
    expect(scrape.body).toContain('bridge_authorization_denials_total{operation="/v1/principals",service="api",status="401"} 1');
    expect(scrape.body).not.toContain(demoProject.id);

    class UnavailableRepository extends InMemoryBridgeRepository {
      override async checkHealth(): Promise<{ readonly backend: string }> {
        throw new Error("SENSITIVE_INTERNAL_DETAIL");
      }
    }
    const unavailableApp = await buildApp({
      service: new BridgeService(new UnavailableRepository()),
      principals: runtime.principals,
    });
    apps.push(unavailableApp);
    const unavailable = await unavailableApp.inject({ method: "GET", url: "/health/ready" });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      service: "bridge-api",
      status: "not_ready",
      checks: [{
        name: "repository",
        status: "failed",
        message: "Repository dependency is unavailable.",
      }],
    });
    expect(unavailable.body).not.toContain("SENSITIVE_INTERNAL_DETAIL");
  });

  it("lists same-organization fixed human principals for the prototype reviewer switcher", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/principals",
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ items: Array<{ id: string; roles: string[] }> }>().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: demoPrincipals.architect.id }),
        expect.objectContaining({ id: demoPrincipals.qaLead.id, roles: expect.arrayContaining(["qa-lead"]) }),
      ]),
    );
    expect(response.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id))
      .not.toContain(demoPrincipals.outsider.id);
  });

  it("returns resource-specific not-found responses for cross-tenant and unassigned ID guesses", async () => {
    const runtime = await createDemoRuntime({ seedQuestion: true, seedArtifact: true });
    const unassigned: Principal = {
      ...demoPrincipals.contributor,
      id: "usr_unassigned_api",
      projectIds: [],
      allProjects: false,
      projectRoles: {},
      displayName: "Unassigned user",
    };
    const app = await buildApp({
      service: runtime.service,
      principals: { ...runtime.principals, [unassigned.id]: unassigned },
    });
    apps.push(app);
    expect(runtime.sampleRunId).toBeDefined();
    expect(runtime.sampleQuestionId).toBeDefined();
    expect(runtime.sampleArtifactId).toBeDefined();

    const resources = [
      {
        actual: `/v1/projects/${demoProject.id}`,
        absent: "/v1/projects/prj_absent",
        code: "PROJECT_NOT_FOUND",
      },
      {
        actual: `/v1/runs/${runtime.sampleRunId}`,
        absent: "/v1/runs/run_absent",
        code: "RUN_NOT_FOUND",
      },
      {
        actual: `/v1/questions/${runtime.sampleQuestionId}`,
        absent: "/v1/questions/que_absent",
        code: "QUESTION_NOT_FOUND",
      },
      {
        actual: `/v1/artifacts/${runtime.sampleArtifactId}`,
        absent: "/v1/artifacts/art_absent",
        code: "ARTIFACT_NOT_FOUND",
      },
    ];

    for (const principalId of [demoPrincipals.outsider.id, unassigned.id]) {
      for (const resource of resources) {
        const actual = await app.inject({
          method: "GET",
          url: resource.actual,
          headers: { "x-bridge-principal-id": principalId },
        });
        const absent = await app.inject({
          method: "GET",
          url: resource.absent,
          headers: { "x-bridge-principal-id": principalId },
        });
        expect(actual.statusCode).toBe(404);
        expect(absent.statusCode).toBe(404);
        expect(actual.json()).toMatchObject({ code: resource.code });
        expect(absent.json()).toMatchObject({ code: resource.code });
        expect(actual.body).not.toContain("Payments Platform");
        expect(actual.body).not.toContain("transfer retry");
      }
    }
  });

  it("lets a human organization admin provision and version-update project membership", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);
    const adminHeader = { "x-bridge-principal-id": demoPrincipals.architect.id };

    const denied = await app.inject({
      method: "GET",
      url: "/v1/admin/organization/members",
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
    });
    expect(denied.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/organization/members",
      headers: adminHeader,
      payload: {
        oidcSubject: "auth0|api-member",
        displayName: "API Member",
        roles: ["organization-member"],
        allProjects: false,
        projectMemberships: [{ projectId: demoProject.id, roles: ["QA Lead"] }],
      },
    });
    expect(created.statusCode).toBe(201);
    const member = created.json<{ member: { id: string; version: number } }>().member;

    const preflight = await app.inject({
      method: "OPTIONS",
      url: `/v1/admin/organization/members/${member.id}`,
      headers: {
        origin: "http://127.0.0.1:3000",
        "access-control-request-method": "PATCH",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toContain("PATCH");

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/admin/organization/members/${member.id}`,
      headers: adminHeader,
      payload: {
        expectedVersion: member.version,
        status: "disabled",
        roles: ["organization-member"],
        allProjects: false,
        projectMemberships: [],
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ status: "disabled", version: 2 });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/organization/members",
      headers: adminHeader,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: member.id, status: "disabled" })]),
      projects: [expect.objectContaining({ id: demoProject.id })],
    });
  });

  it("restricts audit views and returns metadata-only JSON and CSV exports", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);
    const adminHeader = { "x-bridge-principal-id": demoPrincipals.architect.id };
    await runtime.repository.saveAuditEvent({
      id: "aud_api_audit_view",
      correlationId: "api_audit_view_001",
      organizationId: demoProject.organizationId,
      projectId: demoProject.id,
      actorId: demoPrincipals.agent.id,
      actorType: demoPrincipals.agent.type,
      action: "question.created",
      subjectType: "question",
      subjectId: "que_api_audit_view",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const createdMember = await app.inject({
      method: "POST",
      url: "/v1/admin/organization/members",
      headers: adminHeader,
      payload: {
        oidcSubject: "auth0|audit-api-member",
        displayName: "Audit API Member",
        roles: ["organization-member"],
        allProjects: false,
        projectMemberships: [],
      },
    });
    expect(createdMember.statusCode).toBe(201);

    const projectView = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/audit?limit=1&offset=0`,
      headers: adminHeader,
    });
    expect(projectView.statusCode).toBe(200);
    expect(projectView.json()).toMatchObject({ offset: 0, limit: 1, items: [expect.objectContaining({
      scope: "project",
      projectId: demoProject.id,
    })] });

    const contributorDenied = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/audit`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
    });
    expect(contributorDenied.statusCode).toBe(403);
    const outsiderDenied = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/audit`,
      headers: { "x-bridge-principal-id": demoPrincipals.outsider.id },
    });
    expect(outsiderDenied.statusCode).toBe(404);
    expect(outsiderDenied.json()).toMatchObject({ code: "PROJECT_NOT_FOUND" });
    const invalidRange = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/audit?createdFrom=2026-02-01T00%3A00%3A00.000Z&createdTo=2026-01-01T00%3A00%3A00.000Z`,
      headers: adminHeader,
    });
    expect(invalidRange.statusCode).toBe(400);

    const question = runtime.sampleQuestionId
      ? await runtime.repository.getQuestion(runtime.sampleQuestionId)
      : undefined;
    const jsonExport = await app.inject({
      method: "POST",
      url: `/v1/admin/projects/${demoProject.id}/audit/export`,
      headers: adminHeader,
      payload: { format: "json", maxItems: 100 },
    });
    expect(jsonExport.statusCode).toBe(200);
    expect(jsonExport.headers["content-disposition"]).toContain("bridge-project-audit-");
    expect(jsonExport.headers["content-type"]).toContain("application/json");
    expect(jsonExport.body).toContain('"scope": "project"');
    if (question) {
      expect(jsonExport.body).not.toContain(question.title);
      expect(jsonExport.body).not.toContain(question.context);
    }

    const organizationView = await app.inject({
      method: "GET",
      url: "/v1/admin/organization/audit?action=organization_member.created",
      headers: adminHeader,
    });
    expect(organizationView.statusCode).toBe(200);
    expect(organizationView.json()).toMatchObject({
      totalMatching: 1,
      items: [expect.objectContaining({ scope: "organization", action: "organization_member.created" })],
    });
    const organizationDenied = await app.inject({
      method: "GET",
      url: "/v1/admin/organization/audit",
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
    });
    expect(organizationDenied.statusCode).toBe(403);

    const csvExport = await app.inject({
      method: "POST",
      url: "/v1/admin/organization/audit/export",
      headers: adminHeader,
      payload: { format: "csv", maxItems: 100 },
    });
    expect(csvExport.statusCode).toBe(200);
    expect(csvExport.headers["content-type"]).toContain("text/csv");
    expect(csvExport.body).toContain('"action"');
    expect(csvExport.body).toContain('"organization_member.created"');
    await expect(runtime.repository.listOrganizationAuditEvents(demoProject.organizationId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "audit.exported", subjectType: "audit_export" }),
      ]),
    );
  });

  it("provisions a one-time service token and supports versioned revocation", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);
    const adminHeader = { "x-bridge-principal-id": demoPrincipals.architect.id };

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/organization/service-identities",
      headers: adminHeader,
      payload: {
        name: "Hospital CI",
        type: "ci",
        roles: ["agent"],
        allProjects: false,
        projectMemberships: [{ projectId: demoProject.id, roles: ["contributor"] }],
        scopes: ["bridge:read"],
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<{ token: string; serviceIdentity: { id: string; version: number } }>();
    expect(body.token).toMatch(/^brg_srv_/);
    expect(body.serviceIdentity.version).toBe(1);
    expect(created.body).not.toContain("tokenHash");

    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/organization/service-identities",
      headers: adminHeader,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(body.token);
    expect(listed.body).not.toContain("tokenHash");
    expect(listed.json()).toMatchObject({
      items: [expect.objectContaining({ id: body.serviceIdentity.id, name: "Hospital CI", version: 1 })],
    });

    const rotated = await app.inject({
      method: "POST",
      url: `/v1/admin/organization/service-identities/${body.serviceIdentity.id}/rotate`,
      headers: adminHeader,
      payload: { expectedVersion: 1 },
    });
    expect(rotated.statusCode).toBe(200);
    const rotatedBody = rotated.json<{ token: string; serviceIdentity: { version: number; rotatedAt: string } }>();
    expect(rotatedBody.token).toMatch(/^brg_srv_/);
    expect(rotatedBody.token).not.toBe(body.token);
    expect(rotatedBody.serviceIdentity).toMatchObject({ version: 2, rotatedAt: expect.any(String) });
    expect(rotated.body).not.toContain("tokenHash");

    const revoked = await app.inject({
      method: "POST",
      url: `/v1/admin/organization/service-identities/${body.serviceIdentity.id}/revoke`,
      headers: adminHeader,
      payload: { expectedVersion: 2 },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ version: 3, rotatedAt: expect.any(String), revokedAt: expect.any(String) });
  });

  it("rejects secret-bearing content without storing or reflecting the credential", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);
    const secret = `brg_srv_${"A".repeat(43)}`;
    const before = await runtime.repository.listQuestions(demoProject.id);

    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/questions`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-secret-question-001",
        title: "Which credential policy should the worker follow?",
        type: "decision",
        category: "security",
        context: `The proposed implementation embeds ${secret} in durable configuration.`,
        whyItMatters: "Persisting a bearer credential would expose privileged access to later readers.",
        intendedOwnerIds: [demoPrincipals.architect.id],
        risk: "protected",
        reversible: false,
        blocking: true,
        options: [
          { key: "secret-manager", label: "Use a secret manager", tradeoffs: "Requires deployment integration." },
          { key: "environment", label: "Use an environment variable", tradeoffs: "Requires runtime injection." },
        ],
        recommendationKey: "secret-manager",
        scope: { component: "worker" },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: "SECRET_DETECTED",
      message: "Potential credential detected in content. Remove it and retry; Bridge did not store this request.",
      details: {
        contentType: "question",
        fieldPath: "content.context",
        secretType: "bridge_service_token",
      },
    });
    expect(response.body).not.toContain(secret);
    expect(await runtime.repository.listQuestions(demoProject.id)).toEqual(before);
  });

  it("lists and marks scoped human notifications without exposing them to agents", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const created = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/questions`,
      headers: {
        "x-bridge-principal-id": demoPrincipals.agent.id,
        "x-bridge-correlation-id": "cli_question-001",
      },
      payload: {
        idempotencyKey: "api-notification-question-001",
        title: "Which audit evidence should block the release?",
        type: "decision",
        category: "qa",
        context: "The release pipeline needs a clear evidence threshold before deployment.",
        whyItMatters: "An unclear threshold can ship defects or block safe releases without evidence.",
        intendedOwnerIds: [demoPrincipals.qaLead.id],
        risk: "high",
        reversible: false,
        blocking: true,
        options: [
          { key: "critical-only", label: "Critical failures only", tradeoffs: "Protects release flow while blocking serious defects." },
          { key: "any-failure", label: "Any failure", tradeoffs: "Maximizes caution but can delay unrelated releases." },
        ],
        recommendationKey: "critical-only",
        scope: { component: "release-pipeline" },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["x-bridge-correlation-id"]).toBe("cli_question-001");
    const question = created.json<{ id: string }>();
    expect(await runtime.repository.listAuditEvents(demoProject.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectId: question.id,
          action: "question.created",
          correlationId: "cli_question-001",
        }),
      ]),
    );
    expect(await runtime.repository.listOutboxEvents(demoProject.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correlationId: "cli_question-001",
          payload: expect.objectContaining({ targetId: question.id }),
        }),
      ]),
    );

    const notifications = await app.inject({
      method: "GET",
      url: `/v1/notifications?projectId=${demoProject.id}`,
      headers: { "x-bridge-principal-id": demoPrincipals.qaLead.id },
    });
    expect(notifications.statusCode).toBe(200);
    const listed = notifications.json<{ items: Array<{ id: string; type: string; targetId: string }>; unreadCount: number }>();
    expect(listed).toMatchObject({ unreadCount: 1, items: [expect.objectContaining({ type: "question_assigned", targetId: question.id })] });

    const agentNotifications = await app.inject({
      method: "GET",
      url: `/v1/notifications?projectId=${demoProject.id}`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
    });
    expect(agentNotifications.statusCode).toBe(403);

    const marked = await app.inject({
      method: "POST",
      url: `/v1/notifications/${listed.items[0]!.id}/read`,
      headers: { "x-bridge-principal-id": demoPrincipals.qaLead.id },
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json<{ readAt?: string }>().readAt).toBeDefined();

    const unread = await app.inject({
      method: "GET",
      url: `/v1/notifications?projectId=${demoProject.id}&unreadOnly=true`,
      headers: { "x-bridge-principal-id": demoPrincipals.qaLead.id },
    });
    expect(unread.statusCode).toBe(200);
    expect(unread.json<{ items: unknown[]; unreadCount: number }>()).toMatchObject({ items: [], unreadCount: 0 });
  });

  it("exposes project-admin delivery metrics and optimistic dead-letter replay", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);
    await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/questions`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-outbox-operations-001",
        title: "Which delivery retry threshold should notify operators?",
        type: "decision",
        category: "operations",
        context: "The notification delivery queue requires an operator-visible retry threshold.",
        whyItMatters: "Unbounded retries hide permanent failures while premature dead letters lose notifications.",
        intendedOwnerIds: [demoPrincipals.architect.id],
        risk: "high",
        reversible: false,
        blocking: true,
        options: [
          { key: "three", label: "Three attempts", tradeoffs: "Surfaces failures quickly but tolerates fewer transient outages." },
          { key: "five", label: "Five attempts", tradeoffs: "Tolerates longer outages but delays operator action." },
        ],
        recommendationKey: "five",
        scope: { component: "notification-worker" },
      },
    });
    const [pending] = await runtime.repository.listOutboxEvents(demoProject.id);
    expect(pending).toBeDefined();
    await runtime.repository.claimOutboxEvents(pending!.availableAt, 1);
    await runtime.repository.failOutboxEvent(
      pending!.id,
      "provider unavailable",
      pending!.availableAt,
      true,
    );
    await runtime.repository.saveOutboxDelivery({
      id: "odl_api_delivery",
      organizationId: pending!.organizationId,
      projectId: pending!.projectId,
      outboxEventId: pending!.id,
      channel: "email",
      destinationHash: "b".repeat(64),
      status: "failed",
      attemptCount: 1,
      preference: "immediate",
      lastError: "provider unavailable",
      createdAt: pending!.createdAt,
      updatedAt: pending!.createdAt,
    });

    const inspection = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/outbox?status=dead_letter&limit=10`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(inspection.statusCode).toBe(200);
    expect(inspection.json()).toMatchObject({
      totalMatching: 1,
      items: [expect.objectContaining({ id: pending!.id, status: "dead_letter", attempts: 1 })],
      deliveries: [expect.objectContaining({
        outboxEventId: pending!.id,
        channel: "email",
        status: "failed",
      })],
      metrics: {
        statusCounts: { pending: 0, processing: 0, processed: 0, failed: 0, dead_letter: 1 },
        failedCount: 1,
        totalAttempts: 1,
        deliveryStatusCounts: { delivered: 0, failed: 1, suppressed: 0, deferred: 0 },
      },
    });

    const denied = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/outbox`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
    });
    expect(denied.statusCode).toBe(403);
    const invalid = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/outbox?status=stuck`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(invalid.statusCode).toBe(400);

    const conflict = await app.inject({
      method: "POST",
      url: `/v1/admin/outbox/${pending!.id}/replay`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: { expectedAttempts: 2 },
    });
    expect(conflict.statusCode).toBe(409);
    const replayed = await app.inject({
      method: "POST",
      url: `/v1/admin/outbox/${pending!.id}/replay`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: { expectedAttempts: 1 },
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toMatchObject({ id: pending!.id, status: "pending", attempts: 0 });
  });

  it("exposes privacy-safe project analytics only to project administrators", async () => {
    const runtime = await createDemoRuntime({ seedQuestion: true, seedArtifact: true });
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/analytics?client=codex&startedFrom=2025-01-01T00:00:00.000Z`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      projectId: demoProject.id,
      cohort: { client: "codex", runCount: 1, startedFrom: "2025-01-01T00:00:00.000Z" },
      activity: {
        questionSubmissions: 1,
        questionsCreated: 1,
        specificationVersionsPublished: 0,
      },
      byClient: [expect.objectContaining({ client: "codex", runCount: 1 })],
      privacy: {
        derivedFrom: expect.any(Array),
        excluded: expect.arrayContaining([expect.stringContaining("raw prompts")]),
      },
    });
    expect(response.body).not.toContain("Which transfer failures should trigger an automatic retry?");
    expect(response.body).not.toContain("Retry transient failures with bounded exponential backoff");

    const denied = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/analytics`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
    });
    expect(denied.statusCode).toBe(403);
    const agentDenied = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/analytics`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
    });
    expect(agentDenied.statusCode).toBe(403);
    const invalidRange = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/analytics?startedFrom=2026-02-01T00:00:00.000Z&startedTo=2026-01-01T00:00:00.000Z`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(invalidRange.statusCode).toBe(400);
  });

  it("exposes project support signals only to project operators", async () => {
    const runtime = await createDemoRuntime({ seedQuestion: true });
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const diagnostic = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/adapter-diagnostics`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        client: "codex",
        capabilities: ["instructions", "cli"],
        mcpStatus: "not_configured",
        checks: [
          { name: "api", status: "pass" },
          { name: "project-config", status: "pass" },
        ],
      },
    });
    expect(diagnostic.statusCode).toBe(200);
    expect(diagnostic.json()).toMatchObject({
      projectId: demoProject.id,
      client: "codex",
      status: "pass",
      mcpStatus: "not_configured",
    });
    const malformedDiagnostic = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/adapter-diagnostics`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        client: "codex",
        capabilities: ["cli", "cli"],
        mcpStatus: "not_configured",
        checks: [{ name: "api", status: "pass" }],
      },
    });
    expect(malformedDiagnostic.statusCode).toBe(400);
    const crossTenant = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/adapter-diagnostics`,
      headers: { "x-bridge-principal-id": demoPrincipals.outsider.id },
      payload: {
        client: "codex",
        capabilities: ["cli"],
        mcpStatus: "not_configured",
        checks: [{ name: "api", status: "pass" }],
      },
    });
    expect(crossTenant.statusCode).toBe(404);

    const response = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/support`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      projectId: demoProject.id,
      routing: { unroutedQuestions: [] },
      decisions: { overdueProtected: [] },
      delivery: { pendingCount: 1, failedCount: 0, deadLetterEvents: [] },
      adapters: {
        items: [expect.objectContaining({ client: "codex", capabilities: ["cli"] })],
        mcpDiagnostics: "observed_from_doctor",
      },
      diagnostics: [expect.objectContaining({ client: "codex", mcpStatus: "not_configured" })],
    });

    const denied = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/${demoProject.id}/support`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
    });
    expect(denied.statusCode).toBe(403);
    expect(response.body).not.toContain("Which transfer failures should trigger an automatic retry?");
  });

  it("returns a personalized question inbox while keeping the shared question list available", async () => {
    const runtime = await createDemoRuntime({ seedQuestion: true });
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const created = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/questions`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-inbox-role-question",
        title: "Which QA evidence should block the release?",
        type: "decision",
        category: "qa",
        context: "The release pipeline needs a QA evidence threshold before deployment.",
        whyItMatters: "A weak threshold can ship defects while an excessive threshold can block safe releases.",
        intendedOwnerIds: [],
        intendedOwnerRoles: ["QA Lead"],
        risk: "high",
        reversible: false,
        blocking: true,
        options: [
          { key: "critical-only", label: "Block on critical failures", tradeoffs: "Keeps release flow moving while protecting critical paths." },
          { key: "any-failure", label: "Block on any failure", tradeoffs: "Maximizes caution but may delay fixes unrelated to the release." },
        ],
        recommendationKey: "critical-only",
        scope: { component: "release-pipeline" },
      },
    });
    expect(created.statusCode).toBe(201);
    const roleQuestionId = created.json<{ id: string }>().id;

    const qaInbox = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/inbox`,
      headers: { "x-bridge-principal-id": demoPrincipals.qaLead.id },
    });
    expect(qaInbox.statusCode).toBe(200);
    expect(qaInbox.json<{ items: Array<{ id: string; canAccept: boolean; inboxReasons: string[] }> }>().items)
      .toEqual([
        expect.objectContaining({ id: roleQuestionId, canAccept: true, inboxReasons: ["role_owner"] }),
      ]);

    const filteredInbox = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/inbox?category=QA&role=QA%20Lead`,
      headers: { "x-bridge-principal-id": demoPrincipals.qaLead.id },
    });
    expect(filteredInbox.json<{ items: Array<{ id: string }> }>().items).toEqual([
      expect.objectContaining({ id: roleQuestionId }),
    ]);

    const invalidFilter = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/inbox?risk=urgent`,
      headers: { "x-bridge-principal-id": demoPrincipals.qaLead.id },
    });
    expect(invalidFilter.statusCode).toBe(400);

    const contributorInbox = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/inbox`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
    });
    expect(contributorInbox.json<{ items: unknown[] }>().items).toEqual([]);

    const sharedQuestions = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/questions`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
    });
    expect(sharedQuestions.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id)).toEqual(
      expect.arrayContaining([runtime.sampleQuestionId, roleQuestionId]),
    );
  });

  it("registers and lists a fresh project for the local prototype", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);
    const payload = {
      idempotencyKey: "api-hospital-project-001",
      name: "Hospital Management System",
      decisionOwnerIds: [],
    };

    const denied = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload,
    });
    expect(denied.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload,
    });
    expect(created.statusCode).toBe(201);
    const registration = created.json<{
      disposition: string;
      project: { id: string; name: string };
    }>();
    expect(registration).toMatchObject({
      disposition: "created",
      project: { name: "Hospital Management System" },
    });

    const replay = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ project: { id: string } }>().project.id).toBe(registration.project.id);

    const projects = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
    });
    expect(projects.json<{ items: Array<{ id: string }> }>().items.map((project) => project.id))
      .toContain(registration.project.id);

    const repositoryPayload = {
      idempotencyKey: "api-repository-link-001",
      provider: "github",
      owner: "bridge-org",
      name: "bridge",
      canonicalUrl: "https://github.com/bridge-org/bridge",
    };
    const deniedRepository = await app.inject({
      method: "POST",
      url: `/v1/projects/${registration.project.id}/repositories`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: repositoryPayload,
    });
    expect(deniedRepository.statusCode).toBe(403);

    const linkedRepository = await app.inject({
      method: "POST",
      url: `/v1/projects/${registration.project.id}/repositories`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: repositoryPayload,
    });
    expect(linkedRepository.statusCode).toBe(201);
    expect(linkedRepository.json()).toMatchObject({
      disposition: "created",
      repository: {
        provider: "github",
        owner: "bridge-org",
        name: "bridge",
      },
    });

    const repositoryReplay = await app.inject({
      method: "POST",
      url: `/v1/projects/${registration.project.id}/repositories`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: repositoryPayload,
    });
    expect(repositoryReplay.statusCode).toBe(200);
    expect(repositoryReplay.json<{ repository: { id: string } }>().repository.id)
      .toBe(linkedRepository.json<{ repository: { id: string } }>().repository.id);

    const visibleRepositories = await app.inject({
      method: "GET",
      url: `/v1/projects/${registration.project.id}/repositories`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
    });
    expect(visibleRepositories.statusCode).toBe(200);
    expect(visibleRepositories.json<{ items: Array<{ canonicalUrl: string }> }>().items)
      .toEqual([{ ...linkedRepository.json<{ repository: Record<string, unknown> }>().repository }]);
  });

  it("supports the fresh Hospital project question-and-specification acceptance journey", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: {
        idempotencyKey: "acceptance-hospital-project",
        name: "Hospital Management System",
        decisionOwnerIds: [],
      },
    });
    const projectId = projectResponse.json<{ project: { id: string } }>().project.id;
    const runResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/runs`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "acceptance-hospital-run",
        client: "codex",
        capability: "cli",
        taskSummary: "Build a production-quality Hospital Management System",
        scope: { repository: "hospital-management-system", component: "platform" },
        externalLinks: [],
      },
    });
    const runId = runResponse.json<{ run: { id: string } }>().run.id;

    const questionResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/questions`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "acceptance-patient-identity-question",
        runId,
        title: "Which patient identity policy should the hospital system enforce?",
        type: "decision",
        category: "privacy",
        context: "The platform needs one patient identity policy across registration and clinical care.",
        whyItMatters: "Incorrect matching can merge patients or expose protected health information.",
        intendedOwnerIds: [demoPrincipals.architect.id],
        risk: "protected",
        reversible: false,
        blocking: true,
        options: [
          {
            key: "enterprise-mrn",
            label: "Enterprise medical record number",
            tradeoffs: "One identifier with duplicate-detection governance.",
          },
          {
            key: "facility-mrn",
            label: "Facility-specific record numbers",
            tradeoffs: "Local autonomy with cross-facility reconciliation.",
          },
        ],
        recommendationKey: "enterprise-mrn",
        scope: { repository: "hospital-management-system", component: "patient-registry" },
      },
    });
    expect(questionResponse.statusCode).toBe(201);

    const specificationTypes = ["prd", "adr", "api_contract", "test_plan"] as const;
    for (const type of specificationTypes) {
      const publication = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/artifacts`,
        headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
        payload: {
          idempotencyKey: `acceptance-hospital-${type}`,
          title: `Hospital Management System ${type}`,
          type,
          summary: `Initial ${type} for the greenfield hospital platform.`,
          body: `# Hospital Management System ${type}\n\nInitial governed specification for the hospital platform.`,
          intendedReviewerIds: [demoPrincipals.architect.id],
          citedDecisionIds: [],
          requestReview: true,
          scope: { repository: "hospital-management-system", component: "platform" },
          runId,
        },
      });
      expect(publication.statusCode).toBe(201);
    }

    const [projectsResponse, questionsResponse, artifactsResponse, finalRunResponse] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/v1/projects",
        headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      }),
      app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/questions`,
        headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      }),
      app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/artifacts`,
        headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      }),
      app.inject({
        method: "GET",
        url: `/v1/runs/${runId}`,
        headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      }),
    ]);
    expect(projectsResponse.json<{ items: Array<{ id: string; name: string }> }>().items)
      .toContainEqual(expect.objectContaining({ id: projectId, name: "Hospital Management System" }));
    expect(questionsResponse.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect(artifactsResponse.json<{ items: Array<{ type: string }> }>().items.map((item) => item.type).sort())
      .toEqual([...specificationTypes].sort());
    expect(finalRunResponse.json<{
      status: string;
      questionIds: string[];
      artifactVersionIds: string[];
    }>()).toMatchObject({
      status: "waiting_for_human",
      questionIds: [expect.any(String)],
      artifactVersionIds: [expect.any(String), expect.any(String), expect.any(String), expect.any(String)],
    });
  });

  it("exposes version-checked decision lifecycle routes and affected-record evidence", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);
    const questionInput = (idempotencyKey: string, title: string, context: string) => ({
      idempotencyKey,
      title,
      type: "decision" as const,
      category: "architecture",
      context,
      whyItMatters: "The active decision must remain traceable when production evidence requires replacement.",
      intendedOwnerIds: [demoPrincipals.architect.id],
      intendedOwnerRoles: [],
      risk: "high" as const,
      reversible: false,
      blocking: true,
      options: [
        { key: "bounded", label: "Use bounded retries", tradeoffs: "Limits retry loops while retaining recovery." },
        { key: "none", label: "Do not retry", tradeoffs: "Avoids loops but discards transient recovery." },
      ],
      recommendationKey: "bounded",
      scope: { component: "settlement", workItem: "PAY-77" },
    });
    const originalQuestion = await runtime.service.createQuestion(
      demoPrincipals.agent,
      demoProject.id,
      questionInput(
        "api-decision-lifecycle-original",
        "Which settlement retry policy should be authoritative?",
        "Settlement failures need one authoritative initial retry policy for production processing.",
      ),
    );
    const original = await runtime.service.acceptAnswer(demoPrincipals.architect, originalQuestion.id, {
      optionKey: "bounded",
      rationale: "Bounded retries recover transient settlement failures without creating an unlimited loop.",
    });
    const replacementQuestion = await runtime.service.createQuestion(
      demoPrincipals.agent,
      demoProject.id,
      questionInput(
        "api-decision-lifecycle-replacement",
        "Which revised settlement retry policy should replace the first?",
        "Production evidence now supports a more precise bounded settlement retry policy.",
      ),
    );
    const replacement = await runtime.service.acceptAnswer(demoPrincipals.architect, replacementQuestion.id, {
      answer: "Retry settlement failures once, then dead-letter.",
      rationale: "One retry matches observed recovery while preventing repeated settlement processing.",
    });

    const denied = await app.inject({
      method: "POST",
      url: `/v1/decisions/${original.id}/supersede`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
      payload: {
        expectedVersion: original.version,
        rationale: "A contributor cannot supersede the authoritative settlement decision.",
        replacementDecisionId: replacement.id,
      },
    });
    expect(denied.statusCode).toBe(403);

    const changed = await app.inject({
      method: "POST",
      url: `/v1/decisions/${original.id}/supersede`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: {
        expectedVersion: original.version,
        rationale: "Production evidence requires the newer, more precise settlement retry decision.",
        replacementDecisionId: replacement.id,
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({
      decision: { id: original.id, status: "superseded", replacementDecisionId: replacement.id, version: 2 },
      impact: { artifactIds: [], assumptionIds: [], runIds: [], workItems: ["PAY-77"] },
    });

    const active = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/decisions`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(active.json<{ items: Array<{ id: string }> }>().items).toEqual([
      expect.objectContaining({ id: replacement.id }),
    ]);

    const searched = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/decisions?search=dead-letter+settlement`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(searched.statusCode).toBe(200);
    expect(searched.json<{ items: Array<{ id: string }> }>().items).toEqual([
      expect.objectContaining({ id: replacement.id }),
    ]);

    const history = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/decisions?includeHistory=true&search=bounded+retries&status=superseded&category=Architecture&ownerId=${demoPrincipals.architect.id}&component=settlement&workItem=PAY-77`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(history.json<{ items: Array<{ id: string; status: string }> }>().items).toEqual([
      expect.objectContaining({ id: original.id, status: "superseded" }),
    ]);

    const invalidDates = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/decisions?createdFrom=2026-08-10T00%3A00%3A00.000Z&createdTo=2026-08-09T00%3A00%3A00.000Z`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(invalidDates.statusCode).toBe(400);

    const invalidHistoryFlag = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/decisions?includeHistory=yes`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(invalidHistoryFlag.statusCode).toBe(400);

    const invalidSearch = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/decisions?search=x`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(invalidSearch.statusCode).toBe(400);
  });

  it("routes role-owned questions to a matching fixed human principal", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const created = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/questions`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-role-owned-question-001",
        title: "Which patient registration test policy should be required?",
        type: "decision",
        category: "qa",
        context: "The hospital registration flow needs a consistent test policy before release.",
        whyItMatters: "Missing critical-path coverage can allow patient intake regressions into production.",
        intendedOwnerIds: [],
        intendedOwnerRoles: ["QA Lead"],
        risk: "high",
        reversible: true,
        blocking: true,
        options: [
          { key: "critical-path", label: "Require critical-path coverage", tradeoffs: "Adds release work but protects intake behavior." },
          { key: "smoke-only", label: "Require smoke coverage only", tradeoffs: "Faster release with less regression confidence." },
        ],
        recommendationKey: "critical-path",
        scope: { repository: "hospital-management-system", component: "patient-registration" },
      },
    });
    expect(created.statusCode).toBe(201);
    const question = created.json<{ id: string; ownerIds: string[]; ownerRoles: string[] }>();
    expect(question).toMatchObject({ ownerIds: [], ownerRoles: ["qa-lead"] });

    const contributorDenied = await app.inject({
      method: "POST",
      url: `/v1/questions/${question.id}/accept`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
      payload: { optionKey: "critical-path", rationale: "A contributor without the assigned QA role cannot accept this decision." },
    });
    expect(contributorDenied.statusCode).toBe(403);

    const accepted = await app.inject({
      method: "POST",
      url: `/v1/questions/${question.id}/accept`,
      headers: { "x-bridge-principal-id": demoPrincipals.qaLead.id },
      payload: { optionKey: "critical-path", rationale: "The QA lead accepts critical-path coverage for patient registration." },
    });
    expect(accepted.statusCode).toBe(201);
  });

  it("records a run-linked assumption and requires human resolution", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const startResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/runs`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-assumption-run-001",
        client: "codex",
        capability: "cli",
        taskSummary: "Instrument transfer retry metrics",
        scope: { component: "transfers" },
        externalLinks: [],
      },
    });
    const runId = startResponse.json<{ run: { id: string } }>().run.id;
    const createResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/assumptions`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-assumption-001",
        runId,
        statement: "Internal retry metrics may use the existing transfer namespace.",
        rationale: "The namespace is internal, reversible, and used by adjacent transfer metrics.",
        category: "observability",
        risk: "low",
        confidence: "medium",
        reversible: true,
        reversalCost: "Rename the metric and update its internal dashboard query.",
        scope: { component: "transfers" },
        sourceLinks: [],
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const assumption = createResponse.json<{ id: string; version: number }>();

    const denied = await app.inject({
      method: "POST",
      url: `/v1/assumptions/${assumption.id}/resolve`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        expectedVersion: assumption.version,
        status: "confirmed",
        rationale: "An agent cannot elevate its own assumption to confirmed project context.",
      },
    });
    expect(denied.statusCode).toBe(403);

    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/assumptions/${assumption.id}/resolve`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: {
        expectedVersion: assumption.version,
        status: "confirmed",
        rationale: "The namespace is consistent with the project's internal observability conventions.",
      },
    });
    expect(confirmed.json<{ status: string }>().status).toBe("confirmed");

    const context = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/context?task=instrument%20retry%20metrics&categories=observability&component=transfers`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
    });
    expect(context.json<{ items: Array<{ id: string; authority: string }> }>().items).toEqual([
      expect.objectContaining({ id: assumption.id, authority: "confirmed" }),
    ]);
  });

  it("exposes a durable run continuation after its blocking answer is accepted", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const startResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/runs`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-run-test-001",
        client: "codex",
        capability: "cli",
        taskSummary: "Implement transfer retry handling",
        scope: { component: "transfers" },
        externalLinks: [],
      },
    });
    expect(startResponse.statusCode).toBe(201);
    const registration = startResponse.json<{
      run: { id: string };
      resumeContextKey: string;
    }>();

    const questionResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/questions`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-run-question-001",
        runId: registration.run.id,
        title: "Which transfer failures should be retried automatically?",
        type: "decision",
        category: "architecture",
        context: "The worker currently retries every transfer failure without classification.",
        whyItMatters: "Permanent failures should not consume capacity or hide user action.",
        intendedOwnerIds: [demoPrincipals.architect.id],
        risk: "high",
        reversible: false,
        blocking: true,
        options: [
          { key: "transient", label: "Retry transient failures", tradeoffs: "Requires classification." },
          { key: "all", label: "Retry all failures", tradeoffs: "May retry permanent errors." },
        ],
        recommendationKey: "transient",
        scope: { component: "transfers" },
      },
    });
    const question = questionResponse.json<{ id: string }>();

    const blocked = await app.inject({
      method: "POST",
      url: `/v1/runs/${registration.run.id}/continuation`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: { resumeContextKey: registration.resumeContextKey },
    });
    expect(blocked.json<{ canContinue: boolean }>().canContinue).toBe(false);

    await app.inject({
      method: "POST",
      url: `/v1/questions/${question.id}/accept`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: {
        optionKey: "transient",
        rationale: "Only transient failures should be retried using a bounded policy.",
      },
    });
    const ready = await app.inject({
      method: "POST",
      url: `/v1/runs/${registration.run.id}/continuation`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: { resumeContextKey: registration.resumeContextKey },
    });
    expect(ready.json<{ canContinue: boolean; acceptedDecisionIds: string[] }>()).toMatchObject({
      canContinue: true,
      acceptedDecisionIds: [expect.any(String)],
    });
  });

  it("supports shared responses before the owner accepts a question and returns the decision as context", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const createResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/questions`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-test-question-001",
        title: "Which transfer failures should be retried automatically?",
        type: "decision",
        category: "architecture",
        context: "The transfer implementation currently retries every failed request.",
        whyItMatters: "Permanent failures should not create repeated load or hide the actual issue.",
        intendedOwnerIds: [demoPrincipals.architect.id],
        risk: "high",
        reversible: false,
        blocking: true,
        options: [
          { key: "transient", label: "Retry transient failures", tradeoffs: "Requires classification." },
          { key: "all", label: "Retry all failures", tradeoffs: "May retry invalid requests." },
        ],
        recommendationKey: "transient",
        scope: { component: "transfers" },
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const question = createResponse.json<{ id: string }>();

    const proposedResponse = await app.inject({
      method: "POST",
      url: `/v1/questions/${question.id}/responses`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
      payload: {
        optionKey: "transient",
        answer: "Retry transient failures only.",
        rationale: "Permanent failures should remain visible to the caller instead of consuming retry capacity.",
      },
    });
    expect(proposedResponse.statusCode).toBe(201);
    expect(proposedResponse.json<{ authorId: string; optionKey?: string }>()).toMatchObject({
      authorId: demoPrincipals.contributor.id,
      optionKey: "transient",
    });

    const discussion = await app.inject({
      method: "GET",
      url: `/v1/questions/${question.id}`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(discussion.json<{ responses: Array<{ authorId: string }> }>().responses).toEqual([
      expect.objectContaining({ authorId: demoPrincipals.contributor.id }),
    ]);

    const acceptResponse = await app.inject({
      method: "POST",
      url: `/v1/questions/${question.id}/accept`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: {
        optionKey: "transient",
        rationale: "Retry only failures that may succeed later, with bounded backoff and idempotency.",
      },
    });
    expect(acceptResponse.statusCode).toBe(201);

    const contextResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/context?task=implement%20transient%20transfer%20retries&component=transfers`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
    });
    expect(contextResponse.statusCode).toBe(200);
    expect(contextResponse.json<{ items: Array<{ title: string }> }>().items[0]?.title).toBe(
      "Retry transient failures",
    );
  });

  it("records threaded clarification comments with optimistic version checks", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const created = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/questions`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-comment-question-001",
        title: "Which export retention window should the service use?",
        type: "decision",
        category: "privacy",
        context: "The export service needs a bounded retention policy before deletion.",
        whyItMatters: "An unclear retention policy can keep sensitive data longer than intended.",
        intendedOwnerIds: [demoPrincipals.architect.id],
        risk: "high",
        reversible: false,
        blocking: true,
        options: [
          { key: "seven-days", label: "Seven days", tradeoffs: "Short retention with more re-exports." },
          { key: "thirty-days", label: "Thirty days", tradeoffs: "More recovery time with greater exposure." },
        ],
        recommendationKey: "seven-days",
        scope: { component: "export" },
      },
    });
    const question = created.json<{ id: string; version: number }>();

    const agentComment = await app.inject({
      method: "POST",
      url: `/v1/questions/${question.id}/comments`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: { expectedVersion: question.version, body: "Agents cannot impersonate human clarification participants." },
    });
    expect(agentComment.statusCode).toBe(403);

    const rootComment = await app.inject({
      method: "POST",
      url: `/v1/questions/${question.id}/comments`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
      payload: {
        expectedVersion: question.version,
        body: "Does this retention window apply to exports created by support as well?",
      },
    });
    expect(rootComment.statusCode).toBe(201);
    const root = rootComment.json<{ id: string }>();

    const reply = await app.inject({
      method: "POST",
      url: `/v1/questions/${question.id}/comments`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: {
        expectedVersion: question.version + 1,
        parentCommentId: root.id,
        body: "Yes. The same policy applies to support-created exports and is enforced at deletion time.",
      },
    });
    expect(reply.statusCode).toBe(201);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/questions/${question.id}`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ status: string; comments: Array<{ id: string; parentCommentId?: string }> }>()).toMatchObject({
      status: "in_discussion",
      comments: [
        expect.objectContaining({ id: root.id }),
        expect.objectContaining({ parentCommentId: root.id }),
      ],
    });

    const missingParent = await app.inject({
      method: "POST",
      url: `/v1/questions/${question.id}/comments`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
      payload: {
        expectedVersion: question.version + 2,
        parentCommentId: "qcm_missing",
        body: "This should reject a parent comment from another question.",
      },
    });
    expect(missingParent.statusCode).toBe(422);
  });

  it("finds and reuses an exact project question instead of creating another interruption", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);
    const input = {
      idempotencyKey: "api-question-match-001",
      title: "Which transfer failures should be retried automatically?",
      type: "decision",
      category: "architecture",
      context: "The transfer worker retries every failed request without classifying the failure.",
      whyItMatters: "Permanent failures should not consume capacity or hide required user action.",
      intendedOwnerIds: [demoPrincipals.architect.id],
      risk: "high",
      reversible: false,
      blocking: true,
      options: [
        { key: "transient", label: "Retry transient failures", tradeoffs: "Requires classification." },
        { key: "all", label: "Retry all failures", tradeoffs: "May retry invalid work." },
      ],
      recommendationKey: "transient",
      scope: { component: "transfers" },
    };
    const first = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/questions`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: input,
    });
    expect(first.statusCode).toBe(201);
    const firstQuestion = first.json<{ id: string; submissionDisposition: string }>();
    expect(firstQuestion.submissionDisposition).toBe("created");

    const matches = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/questions/matches`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: input,
    });
    expect(matches.json<{ items: Array<{ questionId: string; matchKind: string }> }>().items).toEqual([
      expect.objectContaining({ questionId: firstQuestion.id, matchKind: "exact" }),
    ]);

    const reused = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/questions`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: { ...input, idempotencyKey: "api-question-match-002" },
    });
    expect(reused.statusCode).toBe(200);
    expect(reused.json<{ id: string; submissionDisposition: string }>()).toMatchObject({
      id: firstQuestion.id,
      submissionDisposition: "reused_pending",
    });
  });

  it("prevents an agent from accepting its own recommendation", async () => {
    const runtime = await createDemoRuntime({ seedQuestion: true });
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: `/v1/questions/${runtime.sampleQuestionId}/accept`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        optionKey: "transient-only",
        rationale: "The agent should not be able to authorize this decision itself.",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe("FORBIDDEN");
  });

  it("records a separate protected security review before the owner accepts", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const created = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/questions`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-protected-review-question",
        title: "Which privacy retention policy should apply?",
        type: "decision",
        category: "privacy",
        context: "The hospital platform needs a bounded retention policy for protected patient data.",
        whyItMatters: "Unreviewed retention rules can create privacy and compliance exposure.",
        intendedOwnerIds: [demoPrincipals.qaLead.id],
        intendedOwnerRoles: [],
        risk: "protected",
        reversible: false,
        blocking: true,
        options: [
          { key: "transient", label: "Retain only the governed period", tradeoffs: "Limits exposure but requires deletion controls." },
          { key: "all", label: "Retain indefinitely", tradeoffs: "Simplifies retrieval but increases privacy risk." },
        ],
        recommendationKey: "transient",
        scope: { component: "patient-records" },
      },
    });
    expect(created.statusCode).toBe(201);
    const question = created.json<{ id: string; version: number }>();

    const denied = await app.inject({
      method: "POST",
      url: `/v1/questions/${question.id}/reviews`,
      headers: { "x-bridge-principal-id": demoPrincipals.qaLead.id },
      payload: {
        expectedVersion: question.version,
        status: "approved",
        rationale: "The owner cannot replace the separate security reviewer in this workflow.",
      },
    });
    expect(denied.statusCode).toBe(403);

    const review = await app.inject({
      method: "POST",
      url: `/v1/questions/${question.id}/reviews`,
      headers: { "x-bridge-principal-id": demoPrincipals.securityReviewer.id },
      payload: {
        expectedVersion: question.version,
        status: "approved",
        rationale: "The retention policy is bounded and includes an enforceable deletion control.",
      },
    });
    expect(review.statusCode).toBe(201);
    expect(review.json<{ reviewerId: string; status: string }>()).toMatchObject({
      reviewerId: demoPrincipals.securityReviewer.id,
      status: "approved",
    });

    const accepted = await app.inject({
      method: "POST",
      url: `/v1/questions/${question.id}/accept`,
      headers: { "x-bridge-principal-id": demoPrincipals.qaLead.id },
      payload: {
        optionKey: "transient",
        rationale: "The owner accepts the protected policy after separate security review approval.",
      },
    });
    expect(accepted.statusCode).toBe(201);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/questions/${question.id}`,
      headers: { "x-bridge-principal-id": demoPrincipals.qaLead.id },
    });
    expect(detail.json<{ reviews: Array<{ reviewerId: string; status: string }> }>().reviews).toEqual([
      expect.objectContaining({ reviewerId: demoPrincipals.securityReviewer.id, status: "approved" }),
    ]);
  });

  it("allows exactly one protected acceptance across concurrent REST requests", async () => {
    const runtime = await createDemoRuntime();
    const question = await runtime.service.createQuestion(demoPrincipals.agent, demoProject.id, {
      idempotencyKey: "api-concurrent-protected-question",
      title: "Which protected-data deletion policy should apply?",
      type: "decision",
      category: "privacy",
      context: "The implementation needs one reviewed deletion policy.",
      whyItMatters: "Concurrent requests must not produce multiple authoritative decisions.",
      intendedOwnerIds: [demoPrincipals.qaLead.id],
      intendedOwnerRoles: [],
      risk: "protected",
      reversible: false,
      blocking: true,
      options: [
        { key: "governed", label: "Use governed deletion", tradeoffs: "Requires review evidence." },
        { key: "unbounded", label: "Keep data indefinitely", tradeoffs: "Creates privacy exposure." },
      ],
      recommendationKey: "governed",
      scope: { component: "patient-records" },
    });
    await runtime.service.reviewQuestion(demoPrincipals.securityReviewer, question.id, {
      expectedVersion: question.version,
      status: "approved",
      rationale: "The governed deletion option contains the required human-reviewed control.",
    });
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const requests = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/questions/${question.id}/accept`,
        headers: { "x-bridge-principal-id": demoPrincipals.qaLead.id },
        payload: { optionKey: "governed", rationale: "First concurrent human acceptance." },
      }),
      app.inject({
        method: "POST",
        url: `/v1/questions/${question.id}/accept`,
        headers: { "x-bridge-principal-id": demoPrincipals.qaLead.id },
        payload: { optionKey: "governed", rationale: "Second concurrent human acceptance." },
      }),
    ]);

    expect(requests.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect((await runtime.service.listDecisions(demoPrincipals.qaLead, demoProject.id, {
      includeHistory: true,
      scope: {},
    })).filter((decision) => decision.questionId === question.id)).toHaveLength(1);
  });

  it("publishes an agent specification, accepts only human approval, and includes it in context", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);

    const publishResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/artifacts`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-artifact-test-001",
        title: "Transfer retry policy",
        type: "adr",
        summary: "Defines bounded retry behavior for transient transfer failures.",
        body: "# Transfer retry policy\n\nRetry transient failures using bounded exponential backoff and idempotency keys.",
        intendedReviewerIds: [demoPrincipals.architect.id],
        citedDecisionIds: [],
        requestReview: true,
        scope: { component: "transfers" },
      },
    });
    expect(publishResponse.statusCode).toBe(201);
    const publication = publishResponse.json<{ artifact: { id: string }; version: { id: string } }>();

    const deniedResponse = await app.inject({
      method: "POST",
      url: `/v1/artifact-versions/${publication.version.id}/approve`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: { rationale: "An agent must not approve its own generated specification version." },
    });
    expect(deniedResponse.statusCode).toBe(403);

    const approveResponse = await app.inject({
      method: "POST",
      url: `/v1/artifact-versions/${publication.version.id}/approve`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: { rationale: "The policy is bounded, observable, and safe for the transfer component." },
    });
    expect(approveResponse.statusCode).toBe(201);

    const contextResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${demoProject.id}/context?task=implement%20transfer%20retry&categories=specification&component=transfers`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
    });
    expect(contextResponse.statusCode).toBe(200);
    expect(contextResponse.json<{ items: Array<{ id: string; type: string }> }>().items).toEqual([
      expect.objectContaining({ id: publication.version.id, type: "artifact" }),
    ]);

    const replacementResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/artifacts`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-artifact-test-002",
        artifactId: publication.artifact.id,
        title: "Transfer retry policy",
        type: "adr",
        summary: "Adds jitter and a maximum attempt count to bounded transfer retry behavior.",
        body: "# Transfer retry policy\n\nRetry transient failures using bounded exponential backoff, jitter, and five attempts.",
        intendedReviewerIds: [demoPrincipals.architect.id],
        citedDecisionIds: [],
        requestReview: true,
        scope: { component: "transfers" },
      },
    });
    expect(replacementResponse.statusCode).toBe(201);
    const replacement = replacementResponse.json<{ version: { id: string } }>();

    const diffResponse = await app.inject({
      method: "GET",
      url: `/v1/artifacts/${publication.artifact.id}/diff?fromVersionId=${publication.version.id}&toVersionId=${replacement.version.id}`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(diffResponse.statusCode).toBe(200);
    expect(diffResponse.json()).toMatchObject({
      artifactId: publication.artifact.id,
      from: { id: publication.version.id, version: 1 },
      to: { id: replacement.version.id, version: 2 },
      counts: { unchanged: 2, removed: 1, added: 1 },
      exact: true,
      truncated: false,
      lines: [
        expect.objectContaining({ kind: "unchanged" }),
        expect.objectContaining({ kind: "unchanged" }),
        expect.objectContaining({ kind: "removed" }),
        expect.objectContaining({ kind: "added" }),
      ],
    });

    const deniedDiff = await app.inject({
      method: "GET",
      url: `/v1/artifacts/${publication.artifact.id}/diff?fromVersionId=${publication.version.id}&toVersionId=${replacement.version.id}`,
      headers: { "x-bridge-principal-id": demoPrincipals.outsider.id },
    });
    expect(deniedDiff.statusCode).toBe(404);
    expect(deniedDiff.json()).toMatchObject({ code: "ARTIFACT_NOT_FOUND" });

    const invalidDiff = await app.inject({
      method: "GET",
      url: `/v1/artifacts/${publication.artifact.id}/diff?fromVersionId=${publication.version.id}`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(invalidDiff.statusCode).toBe(400);
  });

  it("records reviewer comments and blocks approval after requested specification changes", async () => {
    const runtime = await createDemoRuntime();
    const app = await buildApp({ service: runtime.service, principals: runtime.principals });
    apps.push(app);
    const published = await app.inject({
      method: "POST",
      url: `/v1/projects/${demoProject.id}/artifacts`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
      payload: {
        idempotencyKey: "api-artifact-review-feedback-001",
        title: "Settlement retry contract",
        type: "adr",
        summary: "Defines retry and dead-letter behavior for settlement processing.",
        body: "# Settlement retry contract\n\nRetry transient settlement failures with bounded backoff.",
        intendedReviewerIds: [demoPrincipals.architect.id],
        citedDecisionIds: [],
        requestReview: true,
        scope: { component: "settlement" },
      },
    });
    const publication = published.json<{ artifact: { id: string }; version: { id: string } }>();

    const denied = await app.inject({
      method: "POST",
      url: `/v1/artifact-versions/${publication.version.id}/reviews`,
      headers: { "x-bridge-principal-id": demoPrincipals.contributor.id },
      payload: { status: "commented", body: "A non-reviewer cannot submit formal feedback." },
    });
    expect(denied.statusCode).toBe(403);

    const requested = await app.inject({
      method: "POST",
      url: `/v1/artifact-versions/${publication.version.id}/reviews`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: {
        status: "changes_requested",
        body: "Add the dead-letter threshold and the required settlement failure metrics.",
      },
    });
    expect(requested.statusCode).toBe(201);
    expect(requested.json()).toMatchObject({
      review: { reviewerId: demoPrincipals.architect.id, status: "changes_requested" },
      version: { reviews: [expect.objectContaining({ status: "changes_requested" })] },
    });

    const blockedApproval = await app.inject({
      method: "POST",
      url: `/v1/artifact-versions/${publication.version.id}/approve`,
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
      payload: { rationale: "This exact version must remain blocked until requested changes are published." },
    });
    expect(blockedApproval.statusCode).toBe(409);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/artifacts/${publication.artifact.id}`,
      headers: { "x-bridge-principal-id": demoPrincipals.agent.id },
    });
    expect(detail.json<{ versions: Array<{ reviews: Array<{ status: string }> }> }>().versions[0]?.reviews)
      .toEqual([expect.objectContaining({ status: "changes_requested" })]);
  });

  it("uses authenticated sessions or bearer tokens instead of the development principal header", async () => {
    const runtime = await createDemoRuntime();
    const authenticator: AuthenticationProvider = {
      mode: "oidc",
      publicConfiguration: () => ({
        mode: "oidc",
        loginUrl: "https://api.bridge.example/v1/auth/login",
        logoutUrl: "https://api.bridge.example/v1/auth/logout",
      }),
      authenticateRequest: async ({ authorization, cookie }) => {
        if (authorization === "Bearer valid-token" || cookie === "bridge_session=valid") {
          return demoPrincipals.architect;
        }
        throw new BridgeError("UNAUTHENTICATED", "Authentication is required.", 401);
      },
      beginWebLogin: async () => ({
        authorizationUrl: "https://identity.example/authorize?state=safe-state",
        transactionCookie: "bridge_oidc_transaction=encrypted; HttpOnly; SameSite=Lax; Secure",
      }),
      completeWebLogin: async () => ({
        redirectUrl: "https://bridge.example/",
        sessionCookie: "bridge_session=encrypted; HttpOnly; SameSite=Lax; Secure",
        clearTransactionCookie: "bridge_oidc_transaction=; Max-Age=0",
      }),
      endWebSession: () => ({
        redirectUrl: "https://identity.example/v2/logout",
        clearSessionCookie: "bridge_session=; Max-Age=0",
      }),
    };
    const app = await buildApp({
      service: runtime.service,
      principals: runtime.principals,
      authenticator,
    });
    apps.push(app);

    const config = await app.inject({ method: "GET", url: "/v1/auth/config" });
    expect(config.json()).toMatchObject({ mode: "oidc", loginUrl: expect.stringContaining("/login") });
    const developmentHeader = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { "x-bridge-principal-id": demoPrincipals.architect.id },
    });
    expect(developmentHeader.statusCode).toBe(401);

    const bearer = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(bearer.statusCode).toBe(200);
    expect(bearer.json<{ items: Project[] }>().items)
      .toEqual([expect.objectContaining({ id: demoProject.id })]);

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: "bridge_session=valid" },
    });
    expect(me.json()).toMatchObject({
      id: demoPrincipals.architect.id,
      organizationId: demoProject.organizationId,
      projectRoles: {},
    });

    const login = await app.inject({ method: "GET", url: "/v1/auth/login" });
    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toContain("identity.example/authorize");
    expect(login.headers["set-cookie"]).toContain("HttpOnly");
  });
});
