import { createHash } from "node:crypto";

import type {
  CreateQuestionInput,
  PublishArtifactInput,
  RecordAssumptionInput,
} from "@bridge/contracts";
import type { AuditEvent, Notification, Principal, Project } from "@bridge/domain";
import { BridgeMetrics } from "@bridge/observability";
import { describe, expect, it } from "vitest";

import { BridgeService, InMemoryBridgeRepository } from "./index.js";

const project: Project = {
  id: "prj_one",
  organizationId: "org_one",
  name: "Project One",
  decisionOwnerIds: ["usr_owner"],
};

const agent: Principal = {
  id: "agt_one",
  type: "agent",
  organizationId: "org_one",
  projectIds: [project.id],
  allProjects: true,
  roles: ["agent"],
  displayName: "Agent",
};

const owner: Principal = {
  id: "usr_owner",
  type: "human",
  organizationId: "org_one",
  projectIds: [project.id],
  allProjects: true,
  roles: ["project-admin", "security-reviewer"],
  displayName: "Owner",
};

const organizationAdmin: Principal = {
  ...owner,
  id: "usr_org_admin",
  roles: ["organization-admin"],
  displayName: "Organization Admin",
};

const outsider: Principal = {
  ...owner,
  id: "usr_outsider",
  organizationId: "org_two",
};

const qaLead: Principal = {
  id: "usr_qa_lead",
  type: "human",
  organizationId: "org_one",
  projectIds: [project.id],
  allProjects: true,
  roles: ["qa-lead", "qa"],
  displayName: "QA Lead",
};

const securityReviewer: Principal = {
  id: "usr_security_reviewer",
  type: "human",
  organizationId: "org_one",
  projectIds: [project.id],
  allProjects: true,
  roles: ["security-reviewer"],
  displayName: "Security Reviewer",
};

const contributor: Principal = {
  id: "usr_contributor",
  type: "human",
  organizationId: "org_one",
  projectIds: [project.id],
  allProjects: true,
  roles: ["contributor"],
  displayName: "Contributor",
};

const limitedOwner: Principal = {
  id: "usr_limited_owner",
  type: "human",
  organizationId: "org_one",
  projectIds: [project.id],
  allProjects: false,
  roles: ["contributor"],
  displayName: "Limited owner",
};

function questionInput(overrides: Partial<CreateQuestionInput> = {}): CreateQuestionInput {
  return {
    idempotencyKey: "question-key-001",
    title: "Which retry policy should the worker use?",
    type: "decision",
    category: "architecture",
    context: "The worker needs a consistent retry policy for transfer failures.",
    whyItMatters: "An incorrect policy can duplicate work or discard recoverable transfers.",
    intendedOwnerIds: [owner.id],
    intendedOwnerRoles: [],
    risk: "high",
    reversible: false,
    blocking: true,
    options: [
      { key: "transient", label: "Retry transient failures", tradeoffs: "Requires classification." },
      { key: "all", label: "Retry every failure", tradeoffs: "Can retry permanent failures." },
    ],
    recommendationKey: "transient",
    scope: { component: "transfers" },
    ...overrides,
  };
}

function artifactInput(overrides: Partial<PublishArtifactInput> = {}): PublishArtifactInput {
  return {
    idempotencyKey: "artifact-key-001",
    title: "Transfer retry policy",
    type: "adr",
    summary: "Defines classification and bounded retries for transfer failures.",
    body: "# Transfer retry policy\n\nRetry transient failures with bounded exponential backoff and idempotency keys.",
    intendedReviewerIds: [owner.id],
    citedDecisionIds: [],
    requestReview: true,
    scope: { component: "transfers" },
    ...overrides,
  };
}

function assumptionInput(overrides: Partial<RecordAssumptionInput> = {}): RecordAssumptionInput {
  return {
    idempotencyKey: "assumption-key-001",
    runId: "run_replace",
    statement: "Internal retry metrics may use the existing transfer namespace.",
    rationale: "The namespace is internal, reversible, and already used by adjacent transfer metrics.",
    category: "observability",
    risk: "low",
    confidence: "medium",
    reversible: true,
    reversalCost: "Rename the metric and update the internal dashboard query.",
    scope: { component: "transfers" },
    sourceLinks: [],
    ...overrides,
  };
}

async function runtime(metrics?: BridgeMetrics): Promise<{ repository: InMemoryBridgeRepository; service: BridgeService }> {
  const repository = new InMemoryBridgeRepository(metrics);
  await repository.saveProject(project);
  return {
    repository,
    service: new BridgeService(repository, {
      publicBaseUrl: "http://bridge.test/review",
      identityIssuer: "https://identity.example/",
      ...(metrics ? { metrics } : {}),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      id: (() => {
        let next = 0;
        return () => String(++next);
      })(),
      resumeKey: (() => {
        let next = 0;
        return () => `resume_test_${String(++next).padStart(32, "0")}`;
      })(),
    }),
  };
}

async function seedOrganizationAdministrator(repository: InMemoryBridgeRepository): Promise<void> {
  const timestamp = "2026-01-01T00:00:00.000Z";
  await repository.saveOrganization({
    id: project.organizationId,
    externalIdentityProviderId: "auth0-org-one",
    slug: "one",
    name: "Organization One",
    createdAt: timestamp,
  });
  await repository.savePrincipalIdentity({
    id: organizationAdmin.id,
    type: "human",
    displayName: organizationAdmin.displayName,
    oidcIssuer: "https://identity.example/",
    oidcSubject: "auth0|admin",
    createdAt: timestamp,
  });
  await repository.saveOrganizationMembership({
    organizationId: project.organizationId,
    principalId: organizationAdmin.id,
    status: "active",
    roles: organizationAdmin.roles,
    allProjects: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
  });
}

class FailingAuditRepository extends InMemoryBridgeRepository {
  failAction: string | undefined;

  override async saveAuditEvent(event: AuditEvent): Promise<void> {
    if (event.action === this.failAction) throw new Error(`Injected failure for ${event.action}`);
    await super.saveAuditEvent(event);
  }
}

describe("Bridge decision workflow", () => {
  it("registers a fresh project idempotently for fixed local principals", async () => {
    const { service } = await runtime();
    await expect(
      service.registerProject(agent, {
        idempotencyKey: "hospital-project-001",
        name: "Hospital Management System",
        decisionOwnerIds: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const first = await service.registerProject(owner, {
      idempotencyKey: "hospital-project-001",
      name: "Hospital Management System",
      decisionOwnerIds: [],
    });
    const replay = await service.registerProject(owner, {
      idempotencyKey: "hospital-project-001",
      name: "Hospital Management System",
      decisionOwnerIds: [],
    });
    expect(first).toMatchObject({
      disposition: "created",
      project: {
        id: expect.stringMatching(/^prj_/),
        name: "Hospital Management System",
        decisionOwnerIds: [owner.id],
      },
    });
    expect(replay).toEqual({ ...first, disposition: "idempotent_replay" });
    expect(await service.listProjects(agent)).toEqual([
      first.project,
      project,
    ]);
    expect(await service.listProjects(outsider)).toEqual([]);
  });

  it("creates, lists, audits, and version-updates organization members", async () => {
    const { repository, service } = await runtime();
    await seedOrganizationAdministrator(repository);
    const input = {
      oidcSubject: "auth0|qa-member",
      displayName: "QA Member",
      roles: ["Organization Member"],
      allProjects: false,
      projectMemberships: [{ projectId: project.id, roles: ["QA Lead", "qa-lead"] }],
    };

    const created = await service.createOrganizationMember(organizationAdmin, input);
    expect(created).toMatchObject({
      disposition: "created",
      member: {
        displayName: "QA Member",
        status: "active",
        roles: ["organization-member"],
        allProjects: false,
        version: 1,
        projectMemberships: [{
          projectId: project.id,
          status: "active",
          roles: ["qa-lead"],
          version: 1,
        }],
      },
    });
    await expect(service.createOrganizationMember(organizationAdmin, input)).resolves.toEqual({
      ...created,
      disposition: "idempotent_replay",
    });
    await expect(service.listOrganizationMembers(organizationAdmin)).resolves.toHaveLength(2);
    await expect(repository.listOrganizationAuditEvents(project.organizationId)).resolves.toMatchObject([
      { action: "organization_member.created", subjectId: created.member.id },
    ]);

    const updated = await service.updateOrganizationMember(organizationAdmin, created.member.id, {
      expectedVersion: 1,
      status: "active",
      roles: ["organization-member", "business-analyst"],
      allProjects: true,
      projectMemberships: [{ projectId: project.id, roles: ["project-admin"] }],
    });
    expect(updated).toMatchObject({
      version: 2,
      roles: ["business-analyst", "organization-member"],
      allProjects: true,
      projectMemberships: [{ status: "active", roles: ["project-admin"], version: 2 }],
    });
    await expect(service.updateOrganizationMember(organizationAdmin, created.member.id, {
      expectedVersion: 1,
      status: "disabled",
      roles: [],
      allProjects: false,
      projectMemberships: [],
    })).rejects.toMatchObject({ code: "CONFLICT", details: { currentVersion: 2 } });
    await expect(repository.listOrganizationAuditEvents(project.organizationId)).resolves.toMatchObject([
      { action: "organization_member.updated", subjectId: created.member.id },
      { action: "organization_member.created", subjectId: created.member.id },
    ]);
  });

  it("requires a human organization admin and protects tenant scope and the final admin", async () => {
    const { repository, service } = await runtime();
    await seedOrganizationAdministrator(repository);
    await expect(service.listOrganizationMembers(owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.createOrganizationMember(agent, {
      oidcSubject: "auth0|blocked",
      displayName: "Blocked Member",
      roles: [],
      allProjects: false,
      projectMemberships: [],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await repository.saveProject({ ...project, id: "prj_other", organizationId: "org_two" });
    await expect(service.createOrganizationMember(organizationAdmin, {
      oidcSubject: "auth0|cross-tenant",
      displayName: "Cross Tenant",
      roles: [],
      allProjects: false,
      projectMemberships: [{ projectId: "prj_other", roles: ["contributor"] }],
    })).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });

    await expect(service.updateOrganizationMember(organizationAdmin, organizationAdmin.id, {
      expectedVersion: 1,
      status: "disabled",
      roles: [],
      allProjects: false,
      projectMemberships: [],
    })).rejects.toMatchObject({ code: "LAST_ORGANIZATION_ADMIN" });
  });

  it("creates, resolves, lists, and revokes a scoped service identity", async () => {
    const { repository, service } = await runtime();
    await seedOrganizationAdministrator(repository);
    const registration = await service.createServiceIdentity(organizationAdmin, {
      name: "Hospital CI",
      type: "ci",
      roles: ["agent"],
      allProjects: false,
      projectMemberships: [{ projectId: project.id, roles: ["contributor"] }],
      scopes: ["bridge:read"],
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    expect(registration.token).toMatch(/^brg_srv_[A-Za-z0-9_-]{43}$/);
    expect(registration.serviceIdentity).toMatchObject({
      name: "Hospital CI",
      type: "ci",
      scopes: ["bridge:read"],
      projectMemberships: [{ projectId: project.id, status: "active" }],
      version: 1,
    });
    expect(JSON.stringify(registration.serviceIdentity)).not.toContain(registration.token);

    const resolution = await repository.resolveServiceToken(
      createHash("sha256").update(registration.token).digest("hex"),
    );
    expect(resolution?.principal).toMatchObject({
      id: registration.serviceIdentity.principalId,
      type: "ci",
      projectIds: [project.id],
    });
    await expect(service.listServiceIdentities(organizationAdmin)).resolves.toMatchObject([
      { id: registration.serviceIdentity.id, name: "Hospital CI", version: 1 },
    ]);

    const rotated = await service.rotateServiceIdentity(organizationAdmin, registration.serviceIdentity.id, {
      expectedVersion: 1,
    });
    expect(rotated).toMatchObject({
      serviceIdentity: { version: 2, rotatedAt: expect.any(String) },
      token: expect.stringMatching(/^brg_srv_[A-Za-z0-9_-]{43}$/),
    });
    await expect(repository.resolveServiceToken(
      createHash("sha256").update(registration.token).digest("hex"),
    )).resolves.toBeUndefined();
    await expect(repository.resolveServiceToken(
      createHash("sha256").update(rotated.token).digest("hex"),
    )).resolves.toMatchObject({ credential: { version: 2, rotatedAt: expect.any(String) } });
    await expect(repository.listOrganizationAuditEvents(project.organizationId)).resolves.toMatchObject([
      { action: "service_identity.rotated", subjectId: registration.serviceIdentity.id },
      { action: "service_identity.created", subjectId: registration.serviceIdentity.id },
    ]);
    await expect(service.rotateServiceIdentity(organizationAdmin, registration.serviceIdentity.id, {
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const revoked = await service.revokeServiceIdentity(organizationAdmin, registration.serviceIdentity.id, {
      expectedVersion: 2,
    });
    expect(revoked).toMatchObject({ version: 3, revokedAt: expect.any(String), rotatedAt: expect.any(String) });
    await expect(repository.resolveServiceToken(
      createHash("sha256").update(rotated.token).digest("hex"),
    )).resolves.toBeUndefined();
    await expect(service.revokeServiceIdentity(organizationAdmin, registration.serviceIdentity.id, {
      expectedVersion: 2,
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects high-confidence secrets before durable writes and records only controlled metrics", async () => {
    const metrics = new BridgeMetrics();
    const { repository, service } = await runtime(metrics);
    await seedOrganizationAdministrator(repository);
    const bridgeToken = `brg_srv_${"A".repeat(43)}`;
    const githubToken = `ghp_${"B".repeat(36)}`;
    const awsAccessKey = `AKIA${"E".repeat(16)}`;
    const privateKey = "-----BEGIN OPENSSH PRIVATE KEY-----";
    const secretUrl = `https://example.test/callback?access_token=${"C".repeat(32)}`;

    await expect(service.createServiceIdentity(organizationAdmin, {
      name: bridgeToken,
      type: "ci",
      roles: [],
      allProjects: false,
      projectMemberships: [],
      scopes: ["bridge:read"],
    })).rejects.toMatchObject({
      code: "SECRET_DETECTED",
      statusCode: 422,
      details: {
        contentType: "administration",
        fieldPath: "content.name",
        secretType: "bridge_service_token",
      },
    });
    await expect(service.startRun(agent, project.id, {
      idempotencyKey: "secret-run-001",
      client: "codex",
      capability: "cli",
      taskSummary: `Use ${bridgeToken} while implementing retries`,
      scope: { component: "transfers" },
      externalLinks: [],
    })).rejects.toMatchObject({
      code: "SECRET_DETECTED",
      details: { contentType: "run", fieldPath: "content.taskSummary" },
    });
    await expect(service.createQuestion(agent, project.id, questionInput({
      idempotencyKey: "secret-question-001",
      options: [
        { key: "transient", label: "Retry transient failures", tradeoffs: `Requires ${githubToken}` },
        { key: "all", label: "Retry every failure", tradeoffs: "Can retry permanent failures." },
      ],
    }))).rejects.toMatchObject({
      code: "SECRET_DETECTED",
      details: {
        contentType: "question",
        fieldPath: "content.options[0].tradeoffs",
        secretType: "github_token",
      },
    });
    await expect(service.recordAssumption(agent, project.id, assumptionInput({
      idempotencyKey: "secret-assumption-001",
      rationale: `The deployment notes referenced ${awsAccessKey}.`,
    }))).rejects.toMatchObject({
      code: "SECRET_DETECTED",
      details: {
        contentType: "assumption",
        fieldPath: "content.rationale",
        secretType: "aws_access_key",
      },
    });
    await expect(service.publishArtifact(agent, project.id, artifactInput({
      idempotencyKey: "secret-artifact-001",
      body: `# Unsafe specification\n\n${privateKey}`,
    }))).rejects.toMatchObject({
      code: "SECRET_DETECTED",
      details: { contentType: "artifact", fieldPath: "content.body", secretType: "private_key" },
    });
    await expect(service.getContext(agent, project.id, {
      task: `Review callback ${secretUrl}`,
      scope: {},
      categories: [],
      maxItems: 20,
    })).rejects.toMatchObject({
      code: "SECRET_DETECTED",
      details: { contentType: "context", fieldPath: "content.task", secretType: "secret_url_parameter" },
    });

    expect(await repository.listServiceCredentials(project.organizationId)).toEqual([]);
    expect(await repository.listRuns(project.id)).toEqual([]);
    expect(await repository.listAssumptions(project.id)).toEqual([]);
    expect(await repository.listQuestions(project.id)).toEqual([]);
    expect(await repository.listArtifacts(project.id)).toEqual([]);
    expect(await repository.listContextSnapshots(project.id)).toEqual([]);
    expect(metrics.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "bridge_content_secret_detections_total",
        labels: { content_type: "administration", secret_type: "bridge_service_token" },
        value: 1,
      }),
      expect.objectContaining({
        name: "bridge_content_secret_detections_total",
        labels: { content_type: "run", secret_type: "bridge_service_token" },
        value: 1,
      }),
      expect.objectContaining({
        name: "bridge_content_secret_detections_total",
        labels: { content_type: "question", secret_type: "github_token" },
        value: 1,
      }),
      expect.objectContaining({
        name: "bridge_content_secret_detections_total",
        labels: { content_type: "assumption", secret_type: "aws_access_key" },
        value: 1,
      }),
      expect.objectContaining({
        name: "bridge_content_secret_detections_total",
        labels: { content_type: "artifact", secret_type: "private_key" },
        value: 1,
      }),
      expect.objectContaining({
        name: "bridge_content_secret_detections_total",
        labels: { content_type: "context", secret_type: "secret_url_parameter" },
        value: 1,
      }),
    ]));
  });

  it("enforces secret blocking across run, assumption, decision, discussion, and review mutations", async () => {
    const { repository, service } = await runtime();
    const secret = `Authorization: Bearer ${"D".repeat(32)}`;
    const run = await service.startRun(agent, project.id, {
      idempotencyKey: "secret-mutation-run-001",
      client: "codex",
      capability: "cli",
      taskSummary: "Exercise content mutation policy",
      scope: { component: "transfers" },
      externalLinks: [],
    });
    await expect(service.reportRun(agent, run.run.id, {
      expectedVersion: 1,
      status: "failed",
      summary: `Failure output included ${secret}`,
      resultLinks: [],
    })).rejects.toMatchObject({ code: "SECRET_DETECTED", details: { contentType: "run" } });
    expect(await repository.getRun(run.run.id)).toMatchObject({ status: "running", version: 1 });

    const assumption = await service.recordAssumption(agent, project.id, assumptionInput({
      idempotencyKey: "secret-mutation-assumption-001",
      runId: run.run.id,
    }));
    await expect(service.resolveAssumption(owner, assumption.id, {
      expectedVersion: 1,
      status: "rejected",
      rationale: `The validation notes included ${secret}`,
    })).rejects.toMatchObject({ code: "SECRET_DETECTED", details: { contentType: "assumption" } });
    expect(await repository.getAssumption(assumption.id)).toMatchObject({ status: "active", version: 1 });

    const question = await service.createQuestion(agent, project.id, questionInput({
      idempotencyKey: "secret-mutation-question-001",
    }));
    await expect(service.addQuestionComment(owner, question.id, {
      expectedVersion: 1,
      body: `Clarification included ${secret}`,
    })).rejects.toMatchObject({ code: "SECRET_DETECTED", details: { contentType: "question" } });
    await expect(service.proposeAnswer(owner, question.id, {
      answer: "Retry transient failures only.",
      rationale: `The evidence included ${secret}`,
      optionKey: "transient",
    })).rejects.toMatchObject({ code: "SECRET_DETECTED", details: { contentType: "question" } });
    await expect(service.acceptAnswer(owner, question.id, {
      optionKey: "transient",
      rationale: `The approval notes included ${secret}`,
    })).rejects.toMatchObject({ code: "SECRET_DETECTED", details: { contentType: "decision" } });
    expect(await repository.getQuestion(question.id)).toMatchObject({
      status: "open",
      version: 1,
      comments: [],
      responses: [],
    });
    expect(await repository.listDecisions(project.id)).toEqual([]);

    const protectedQuestion = await service.createQuestion(agent, project.id, questionInput({
      idempotencyKey: "secret-mutation-protected-question-001",
      title: "Which credential retention policy should protect the worker?",
      category: "security",
      risk: "protected",
    }));
    await expect(service.reviewQuestion(owner, protectedQuestion.id, {
      expectedVersion: 1,
      status: "approved",
      rationale: `The security review included ${secret}`,
    })).rejects.toMatchObject({ code: "SECRET_DETECTED", details: { contentType: "question" } });
    expect(await repository.getQuestion(protectedQuestion.id)).toMatchObject({ version: 1, reviews: [] });

    const decisionQuestion = await service.createQuestion(agent, project.id, questionInput({
      idempotencyKey: "secret-mutation-decision-question-001",
      title: "Which retry policy should govern the settlement worker?",
    }));
    const decision = await service.acceptAnswer(owner, decisionQuestion.id, {
      optionKey: "transient",
      rationale: "Only transient failures should be retried with bounded exponential backoff.",
    });
    await expect(service.changeDecisionLifecycle(owner, decision.id, {
      expectedVersion: 1,
      status: "revoked",
      rationale: `The retirement rationale included ${secret}`,
    })).rejects.toMatchObject({ code: "SECRET_DETECTED", details: { contentType: "decision" } });
    expect(await repository.getDecision(decision.id)).toMatchObject({ status: "active", version: 1 });

    const publication = await service.publishArtifact(agent, project.id, artifactInput({
      idempotencyKey: "secret-mutation-artifact-001",
    }));
    await expect(service.reviewArtifactVersion(owner, publication.version.id, {
      status: "commented",
      body: `The review included ${secret}`,
    })).rejects.toMatchObject({ code: "SECRET_DETECTED", details: { contentType: "artifact" } });
    await expect(service.approveArtifactVersion(owner, publication.version.id, {
      rationale: `The approval included ${secret}`,
    })).rejects.toMatchObject({ code: "SECRET_DETECTED", details: { contentType: "artifact" } });
    expect(await repository.getArtifact(publication.artifact.id)).toMatchObject({
      versions: [expect.objectContaining({ status: "in_review", reviews: [] })],
    });
  });

  it("records, ranks, expires, and human-resolves visible assumptions", async () => {
    const metrics = new BridgeMetrics();
    const { repository, service } = await runtime(metrics);
    const registration = await service.startRun(agent, project.id, {
      idempotencyKey: "assumption-run-001",
      client: "codex",
      capability: "cli",
      taskSummary: "Instrument transfer retries",
      scope: { component: "transfers" },
      externalLinks: [],
    });
    const input = assumptionInput({ runId: registration.run.id });
    const assumption = await service.recordAssumption(agent, project.id, input);
    expect(await service.recordAssumption(agent, project.id, input)).toEqual(assumption);
    expect(assumption).toMatchObject({
      status: "active",
      expiresAt: "2026-01-08T00:00:00.000Z",
      version: 1,
    });
    expect(await service.getRun(agent, registration.run.id)).toMatchObject({
      assumptionIds: [assumption.id],
      version: 2,
    });

    const context = await service.getContext(agent, project.id, {
      runId: registration.run.id,
      task: "Instrument internal transfer retry metrics",
      scope: { component: "transfers" },
      categories: ["observability"],
      maxItems: 20,
    });
    expect(context.items).toEqual([
      expect.objectContaining({
        id: assumption.id,
        type: "assumption",
        authority: "assumption",
        expiresAt: assumption.expiresAt,
      }),
    ]);
    expect(new URL(context.items[0]!.sourceUrl).searchParams.get("assumptionId")).toBe(assumption.id);
    expect(metrics.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "bridge_context_requests_total",
        labels: { outcome: "success" },
        value: 1,
      }),
      expect.objectContaining({
        name: "bridge_database_transactions_total",
        labels: { backend: "memory", outcome: "success" },
      }),
    ]));
    expect(metrics.snapshot().histograms).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "bridge_context_result_count", count: 1, sum: 1 }),
      expect.objectContaining({ name: "bridge_context_candidate_count", count: 1, sum: 1 }),
    ]));
    await expect(
      service.resolveAssumption(agent, assumption.id, {
        expectedVersion: 1,
        status: "confirmed",
        rationale: "The agent cannot confirm its own temporary premise as team context.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const confirmed = await service.resolveAssumption(owner, assumption.id, {
      expectedVersion: 1,
      status: "confirmed",
      rationale: "The internal metric namespace is consistent with our observability conventions.",
    });
    expect(confirmed).toMatchObject({ status: "confirmed", resolvedById: owner.id, version: 2 });

    const expiring = await service.recordAssumption(
      agent,
      project.id,
      assumptionInput({
        idempotencyKey: "assumption-key-expiring",
        runId: registration.run.id,
        statement: "The temporary retry dashboard may omit percentile aggregation.",
        expiresAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    const laterService = new BridgeService(repository, {
      now: () => new Date("2026-01-03T00:00:00.000Z"),
      id: () => "later",
    });
    expect(await laterService.getAssumption(agent, expiring.id)).toMatchObject({
      status: "expired",
      version: 2,
    });
  });

  it("blocks protected, irreversible, excessive-expiry, and decision-conflicting assumptions", async () => {
    const { service } = await runtime();
    const registration = await service.startRun(agent, project.id, {
      idempotencyKey: "assumption-policy-run",
      client: "codex",
      capability: "cli",
      taskSummary: "Evaluate retry behavior",
      scope: { component: "transfers" },
      externalLinks: [],
    });
    await expect(
      service.recordAssumption(
        agent,
        project.id,
        assumptionInput({ runId: registration.run.id, category: "security" }),
      ),
    ).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    await expect(
      service.recordAssumption(
        agent,
        project.id,
        assumptionInput({ runId: registration.run.id, reversible: false }),
      ),
    ).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    await expect(
      service.recordAssumption(
        agent,
        project.id,
        assumptionInput({ runId: registration.run.id, expiresAt: "2026-02-01T00:00:00.000Z" }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const question = await service.createQuestion(
      agent,
      project.id,
      questionInput({ idempotencyKey: "assumption-conflict-question" }),
    );
    const decision = await service.acceptAnswer(owner, question.id, {
      optionKey: "transient",
      rationale: "Only transient failures should be retried with bounded exponential backoff.",
    });
    await expect(
      service.recordAssumption(
        agent,
        project.id,
        assumptionInput({
          idempotencyKey: "assumption-conflict-key",
          runId: registration.run.id,
          statement: "Do not retry transient failures",
          rationale: "This deliberately contradicts the accepted retry policy for test coverage.",
          category: decision.category,
          scope: decision.scope,
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", details: { decisionId: decision.id } });
  });

  it("records a blocked run and provides a safe durable continuation into a later run", async () => {
    const { service } = await runtime();
    const registration = await service.startRun(agent, project.id, {
      idempotencyKey: "run-key-001",
      client: "codex",
      capability: "cli",
      taskSummary: "Implement transfer retry behavior",
      scope: { component: "transfers" },
      externalLinks: [],
    });
    const replay = await service.startRun(agent, project.id, {
      idempotencyKey: "run-key-001",
      client: "codex",
      capability: "cli",
      taskSummary: "Implement transfer retry behavior",
      scope: { component: "transfers" },
      externalLinks: [],
    });
    expect(replay).toEqual(registration);

    await service.getContext(agent, project.id, {
      runId: registration.run.id,
      task: "Implement transfer retry behavior",
      scope: { component: "transfers" },
      categories: [],
      maxItems: 20,
    });
    const question = await service.createQuestion(
      agent,
      project.id,
      questionInput({ idempotencyKey: "run-question-001", runId: registration.run.id }),
    );
    expect(await service.getRun(agent, registration.run.id)).toMatchObject({
      status: "waiting_for_human",
      questionIds: [question.id],
      version: 3,
    });
    await expect(
      service.reportRun(agent, registration.run.id, {
        expectedVersion: 3,
        status: "completed",
        summary: "Incorrectly claim that the blocked task is complete.",
        resultLinks: [],
      }),
    ).rejects.toMatchObject({ code: "POLICY_BLOCKED" });

    const blocked = await service.getContinuation(
      agent,
      registration.run.id,
      registration.resumeContextKey,
    );
    expect(blocked).toMatchObject({ canContinue: false, remainingQuestionIds: [question.id] });
    await expect(
      service.startRun(agent, project.id, {
        idempotencyKey: "run-key-too-early",
        client: "codex",
        capability: "cli",
        taskSummary: "Continue transfer retry behavior",
        scope: { component: "transfers" },
        externalLinks: [],
        continuesRunId: registration.run.id,
        resumeContextKey: registration.resumeContextKey,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const decision = await service.acceptAnswer(owner, question.id, {
      optionKey: "transient",
      rationale: "Retry transient failures only with bounded exponential backoff.",
    });
    const ready = await service.getContinuation(
      agent,
      registration.run.id,
      registration.resumeContextKey,
    );
    expect(ready).toMatchObject({
      canContinue: true,
      remainingQuestionIds: [],
      acceptedDecisionIds: [decision.id],
    });

    const continued = await service.startRun(agent, project.id, {
      idempotencyKey: "run-key-002",
      client: "codex",
      capability: "cli",
      taskSummary: "Continue transfer retry behavior with the accepted answer",
      scope: { component: "transfers" },
      externalLinks: [],
      continuesRunId: registration.run.id,
      resumeContextKey: registration.resumeContextKey,
    });
    await service.getContext(agent, project.id, {
      runId: continued.run.id,
      task: "Implement the accepted transient retry behavior",
      scope: { component: "transfers" },
      categories: ["architecture"],
      maxItems: 20,
    });
    const publication = await service.publishArtifact(
      agent,
      project.id,
      artifactInput({ idempotencyKey: "run-artifact-001", runId: continued.run.id }),
    );
    const linked = await service.getRun(agent, continued.run.id);
    expect(linked).toMatchObject({
      continuesRunId: registration.run.id,
      contextSnapshotIds: [expect.stringMatching(/^ctx_/)],
      artifactVersionIds: [publication.version.id],
      version: 3,
    });
    const completed = await service.reportRun(agent, linked.id, {
      expectedVersion: linked.version,
      status: "completed",
      summary: "Implemented the accepted retry policy and published its architecture record.",
      resultLinks: ["https://example.test/pull/42"],
    });
    expect(completed).toMatchObject({ status: "completed", version: 4 });
  });

  it("rolls back every related write when an atomic workflow fails", async () => {
    const repository = new FailingAuditRepository();
    await repository.saveProject(project);
    const service = new BridgeService(repository, {
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      id: (() => {
        let next = 0;
        return () => String(++next);
      })(),
    });

    const run = await service.startRun(agent, project.id, {
      idempotencyKey: "rollback-run-001",
      client: "codex",
      capability: "cli",
      taskSummary: "Verify atomic rollback behavior",
      scope: { component: "transfers" },
      externalLinks: [],
    });
    repository.failAction = "assumption.recorded";
    await expect(
      service.recordAssumption(
        agent,
        project.id,
        assumptionInput({ idempotencyKey: "rollback-assumption-001", runId: run.run.id }),
      ),
    ).rejects.toThrow("Injected failure");
    expect(await repository.listAssumptions(project.id)).toEqual([]);
    expect(await repository.getRun(run.run.id)).toMatchObject({ assumptionIds: [], version: 1 });
    expect(
      await repository.findIdempotentAssumption(
        `assumption:${agent.organizationId}:${agent.id}:rollback-assumption-001`,
      ),
    ).toBeUndefined();

    repository.failAction = "question.created";
    await expect(service.createQuestion(agent, project.id, questionInput())).rejects.toThrow(
      "Injected failure",
    );
    expect(await repository.listQuestions(project.id)).toEqual([]);
    expect(await repository.findIdempotentQuestion(`${agent.organizationId}:${agent.id}:question-key-001`)).toBeUndefined();

    repository.failAction = undefined;
    const question = await service.createQuestion(agent, project.id, questionInput());
    repository.failAction = "decision.accepted";
    await expect(
      service.acceptAnswer(owner, question.id, {
        optionKey: "transient",
        rationale: "Only transient failures should be retried with bounded exponential backoff.",
      }),
    ).rejects.toThrow("Injected failure");
    expect(await repository.listDecisions(project.id)).toEqual([]);
    expect(await repository.getQuestion(question.id)).toMatchObject({ status: "open", version: 1 });

    repository.failAction = "artifact.version_published";
    await expect(service.publishArtifact(agent, project.id, artifactInput())).rejects.toThrow(
      "Injected failure",
    );
    expect(await repository.listArtifacts(project.id)).toEqual([]);

    repository.failAction = undefined;
    const publication = await service.publishArtifact(agent, project.id, artifactInput());
    repository.failAction = "artifact.version_approved";
    await expect(
      service.approveArtifactVersion(owner, publication.version.id, {
        rationale: "The specification accurately captures the accepted persistence behavior.",
      }),
    ).rejects.toThrow("Injected failure");
    const rolledBackArtifact = await repository.getArtifact(publication.artifact.id);
    expect(rolledBackArtifact?.approvedVersionId).toBeUndefined();
    expect(rolledBackArtifact?.versions).toEqual([
      expect.objectContaining({ id: publication.version.id, status: "in_review" }),
    ]);
  });

  it("replays an identical idempotent question and rejects key reuse with different input", async () => {
    const { service } = await runtime();
    const first = await service.createQuestion(agent, project.id, questionInput());
    const replay = await service.createQuestion(agent, project.id, questionInput());
    expect(replay.id).toBe(first.id);
    expect(first.submissionDisposition).toBe("created");
    expect(replay.submissionDisposition).toBe("idempotent_replay");

    await expect(
      service.createQuestion(agent, project.id, questionInput({ title: "A different question using the same key" })),
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("suggests related questions and reuses exact questions across agent runs", async () => {
    const { service } = await runtime();
    const firstRun = await service.startRun(agent, project.id, {
      idempotencyKey: "question-match-run-001",
      client: "codex",
      capability: "cli",
      taskSummary: "Implement retry classification",
      scope: { component: "transfers" },
      externalLinks: [],
    });
    const firstInput = questionInput({
      idempotencyKey: "question-match-001",
      runId: firstRun.run.id,
    });
    const first = await service.createQuestion(agent, project.id, firstInput);
    const matches = await service.findQuestionMatches(agent, project.id, {
      title: firstInput.title,
      type: firstInput.type,
      category: firstInput.category,
      context: firstInput.context,
      risk: firstInput.risk,
      reversible: firstInput.reversible,
      blocking: firstInput.blocking,
      scope: firstInput.scope,
      maxItems: 5,
    });
    expect(matches).toEqual([
      expect.objectContaining({ questionId: first.id, matchKind: "exact", score: 100 }),
    ]);

    const secondRun = await service.startRun(agent, project.id, {
      idempotencyKey: "question-match-run-002",
      client: "claude_code",
      capability: "cli",
      taskSummary: "Implement the same retry classification in another session",
      scope: { component: "transfers" },
      externalLinks: [],
    });
    const reusedPending = await service.createQuestion(
      agent,
      project.id,
      questionInput({
        idempotencyKey: "question-match-002",
        runId: secondRun.run.id,
        whyItMatters: "This second run should join the existing human review instead of interrupting twice.",
      }),
    );
    expect(reusedPending).toMatchObject({
      id: first.id,
      submissionDisposition: "reused_pending",
    });
    expect(await service.getRun(agent, secondRun.run.id)).toMatchObject({
      status: "waiting_for_human",
      questionIds: [first.id],
      version: 2,
    });

    const decision = await service.acceptAnswer(owner, first.id, {
      optionKey: "transient",
      rationale: "Only transient failures should be retried with bounded exponential backoff.",
    });
    const thirdRun = await service.startRun(agent, project.id, {
      idempotencyKey: "question-match-run-003",
      client: "cursor",
      capability: "instructions",
      taskSummary: "Reuse the accepted retry policy",
      scope: { component: "transfers" },
      externalLinks: [],
    });
    const reusedAccepted = await service.createQuestion(
      agent,
      project.id,
      questionInput({
        idempotencyKey: "question-match-003",
        runId: thirdRun.run.id,
      }),
    );
    expect(reusedAccepted).toMatchObject({
      id: first.id,
      decisionId: decision.id,
      submissionDisposition: "reused_accepted",
    });
    expect(await service.getRun(agent, thirdRun.run.id)).toMatchObject({
      status: "running",
      questionIds: [first.id],
      version: 2,
    });
  });

  it("requires human approval and exposes the accepted decision as later context", async () => {
    const { service } = await runtime();
    const question = await service.createQuestion(agent, project.id, questionInput());
    await expect(
      service.acceptAnswer(agent, question.id, {
        optionKey: "transient",
        rationale: "An agent cannot authorize the answer that it recommended to the team.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const decision = await service.acceptAnswer(owner, question.id, {
      optionKey: "transient",
      rationale: "Only transient failures should be retried with bounded exponential backoff.",
    });
    const context = await service.getContext(agent, project.id, {
      task: "Implement transient transfer retry behavior",
      scope: { component: "transfers" },
      categories: ["architecture"],
      maxItems: 20,
    });

    expect(decision.reviewAt).toBe("2026-06-30T00:00:00.000Z");
    expect(context.items.map((item) => item.id)).toEqual([decision.id]);
    const decisionUrl = new URL(context.items[0]!.sourceUrl);
    expect(decisionUrl.pathname).toBe("/review");
    expect(Object.fromEntries(decisionUrl.searchParams)).toMatchObject({
      view: "decisions",
      projectId: project.id,
      decisionId: decision.id,
    });
  });

  it("supersedes a decision with owner authority, provenance, impact, and context exclusion", async () => {
    const { repository, service } = await runtime();
    const run = await service.startRun(agent, project.id, {
      idempotencyKey: "decision-lifecycle-run-001",
      client: "codex",
      capability: "cli",
      taskSummary: "Replace the transfer retry policy",
      scope: { component: "transfers", workItem: "PAY-42" },
      externalLinks: [],
    });
    const scope = { component: "transfers", workItem: "PAY-42" };
    const originalQuestion = await service.createQuestion(agent, project.id, questionInput({
      idempotencyKey: "decision-lifecycle-original",
      runId: run.run.id,
      scope,
    }));
    const original = await service.acceptAnswer(owner, originalQuestion.id, {
      optionKey: "transient",
      rationale: "Only transient failures should initially be retried with bounded backoff.",
    });
    const consumerRun = await service.startRun(agent, project.id, {
      idempotencyKey: "decision-lifecycle-consumer-run",
      client: "codex",
      capability: "cli",
      taskSummary: "Consume the current transfer retry decision",
      scope,
      externalLinks: [],
    });
    await service.getContext(agent, project.id, {
      runId: consumerRun.run.id,
      task: "Implement the accepted transfer retry policy",
      scope,
      categories: ["architecture"],
      maxItems: 20,
    });
    const replacementQuestion = await service.createQuestion(agent, project.id, questionInput({
      idempotencyKey: "decision-lifecycle-replacement",
      title: "Which bounded retry policy should replace the initial transfer rule?",
      context: "New production evidence requires a narrower and observable transfer retry policy.",
      whyItMatters: "The initial accepted policy is now too broad for current operational evidence.",
      scope,
    }));
    const replacement = await service.acceptAnswer(owner, replacementQuestion.id, {
      answer: "Retry transient failures once before dead-lettering.",
      rationale: "Production evidence shows that one bounded retry prevents loops while preserving recovery.",
    });
    expect((await service.listDecisions(owner, project.id, {
      includeHistory: true,
      search: "transient failures",
      scope: {},
    })).map((decision) => decision.id)).toEqual([original.id, replacement.id]);
    const publication = await service.publishArtifact(agent, project.id, artifactInput({
      idempotencyKey: "decision-lifecycle-artifact",
      citedDecisionIds: [original.id],
      scope,
    }));

    await expect(service.changeDecisionLifecycle(contributor, original.id, {
      expectedVersion: original.version,
      status: "superseded",
      rationale: "A contributor cannot replace an owner-controlled project decision.",
      replacementDecisionId: replacement.id,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.changeDecisionLifecycle(owner, original.id, {
      expectedVersion: original.version + 1,
      status: "superseded",
      rationale: "This stale edit must fail optimistic concurrency validation.",
      replacementDecisionId: replacement.id,
    })).rejects.toMatchObject({ code: "CONFLICT", details: { currentVersion: 1 } });

    const changed = await service.changeDecisionLifecycle(owner, original.id, {
      expectedVersion: original.version,
      status: "superseded",
      rationale: "Production evidence replaces the initial policy with a narrower bounded retry rule.",
      replacementDecisionId: replacement.id,
    });
    expect(changed).toMatchObject({
      decision: {
        id: original.id,
        status: "superseded",
        replacementDecisionId: replacement.id,
        lifecycleChangedById: owner.id,
        lifecycleChangedAt: "2026-01-01T00:00:00.000Z",
        version: 2,
      },
      impact: {
        artifactIds: [publication.artifact.id],
        assumptionIds: [],
        runIds: [run.run.id, consumerRun.run.id],
        workItems: ["PAY-42"],
      },
    });
    const context = await service.getContext(agent, project.id, {
      task: "Implement transfer retry behavior",
      scope,
      categories: ["architecture"],
      maxItems: 20,
    });
    expect(context.items.map((item) => item.id)).toContain(replacement.id);
    expect(context.items.map((item) => item.id)).not.toContain(original.id);
    expect((await service.listDecisions(owner, project.id)).map((decision) => decision.id)).toEqual([
      replacement.id,
    ]);
    expect((await service.listDecisions(owner, project.id, {
      includeHistory: false,
      search: "production evidence",
      scope: {},
    })).map((decision) => decision.id)).toEqual([replacement.id]);
    expect(await service.listDecisions(owner, project.id, {
      includeHistory: false,
      search: "initially retried",
      scope: {},
    })).toEqual([]);
    expect((await service.listDecisions(owner, project.id, {
      includeHistory: true,
      search: "initially retried",
      scope: {},
    })).map((decision) => decision.id)).toEqual([original.id]);
    await expect(service.listDecisions(outsider, project.id, {
      includeHistory: true,
      search: "transient failures",
      scope: {},
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await service.listDecisions(owner, project.id, {
      includeHistory: true,
      scope: {},
    })).map((decision) => decision.id)).toEqual(expect.arrayContaining([original.id, replacement.id]));
    expect(await service.listDecisions(owner, project.id, {
      includeHistory: true,
      status: "superseded",
      category: "Architecture",
      ownerId: owner.id,
      createdFrom: "2026-01-01T00:00:00.000Z",
      createdTo: "2026-01-01T23:59:59.999Z",
      scope: { component: "transfers", workItem: "PAY-42" },
    })).toEqual([expect.objectContaining({ id: original.id, status: "superseded" })]);
    expect(await repository.listAuditEvents(project.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "decision.superseded", subjectId: original.id }),
    ]));
    expect(await repository.listOutboxEvents(project.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "decision.lifecycle_changed",
        payload: expect.objectContaining({
          decisionId: original.id,
          status: "superseded",
          replacementDecisionId: replacement.id,
          changedById: owner.id,
        }),
      }),
      expect.objectContaining({
        type: "notification.created",
        payload: expect.objectContaining({ notificationType: "decision_lifecycle", targetId: original.id }),
      }),
    ]));
    await expect(service.changeDecisionLifecycle(owner, original.id, {
      expectedVersion: 2,
      status: "revoked",
      rationale: "A retired decision cannot transition to a second terminal state.",
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("records human clarification comments as a threaded question discussion", async () => {
    const { service } = await runtime();
    const question = await service.createQuestion(agent, project.id, questionInput({
      idempotencyKey: "question-comments-001",
    }));

    await expect(
      service.addQuestionComment(agent, question.id, {
        expectedVersion: question.version,
        body: "An agent cannot impersonate a human clarification participant.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const root = await service.addQuestionComment(contributor, question.id, {
      expectedVersion: question.version,
      body: "Can we confirm whether the retry budget applies per transfer or per batch?",
    });
    expect(root).toMatchObject({
      questionId: question.id,
      authorId: contributor.id,
      body: "Can we confirm whether the retry budget applies per transfer or per batch?",
    });

    await expect(
      service.addQuestionComment(qaLead, question.id, {
        expectedVersion: question.version,
        body: "This parent version is stale and should be rejected deterministically.",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const reply = await service.addQuestionComment(qaLead, question.id, {
      expectedVersion: question.version + 1,
      parentCommentId: root.id,
      body: "The budget is per transfer, with a separate bounded batch ceiling in the worker.",
    });
    expect(reply.parentCommentId).toBe(root.id);

    await expect(
      service.addQuestionComment(contributor, question.id, {
        expectedVersion: question.version + 2,
        parentCommentId: "qcm_missing",
        body: "This parent does not belong to the question.",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const detail = await service.getQuestion(contributor, question.id);
    expect(detail).toMatchObject({ status: "in_discussion", version: 3 });
    expect(detail.comments).toEqual([
      expect.objectContaining({ id: root.id, body: root.body }),
      expect.objectContaining({ id: reply.id, parentCommentId: root.id }),
    ]);
  });

  it("delivers human notifications and supports scoped read state", async () => {
    const { repository, service } = await runtime();
    const question = await service.createQuestion(agent, project.id, questionInput({
      idempotencyKey: "question-notification-001",
    }));

    const assigned = await service.listNotifications(owner, { projectId: project.id });
    expect(assigned).toEqual([
      expect.objectContaining({
        recipientId: owner.id,
        type: "question_assigned",
        targetType: "question",
        targetId: question.id,
      }),
    ]);
    const outbox = await repository.listOutboxEvents(project.id);
    expect(outbox).toEqual([
      expect.objectContaining({
        type: "notification.created",
        status: "pending",
        attempts: 0,
        payload: expect.objectContaining({
          notificationId: assigned[0]!.id,
          recipientId: owner.id,
        }),
      }),
    ]);
    await expect(service.listNotifications(agent, { projectId: project.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const comment = await service.addQuestionComment(contributor, question.id, {
      expectedVersion: question.version,
      body: "Can the owner confirm the retry budget boundary?",
    });
    const withComment = await service.listNotifications(owner, { projectId: project.id, unreadOnly: true });
    expect(withComment.map((notification) => notification.type)).toEqual(
      expect.arrayContaining(["question_assigned", "question_comment"]),
    );
    const commentNotification = withComment.find((notification) => notification.targetId === comment.id);
    expect(commentNotification).toMatchObject({ type: "question_comment" });
    expect(commentNotification?.readAt).toBeUndefined();

    await expect(service.markNotificationRead(contributor, assigned[0]!.id)).rejects.toMatchObject({
      code: "NOTIFICATION_NOT_FOUND",
    });
    const read = await service.markNotificationRead(owner, assigned[0]!.id);
    expect(read.readAt).toBeDefined();
    const marked = await service.markAllNotificationsRead(owner, { projectId: project.id });
    expect(marked.markedCount).toBe(1);
    expect(await service.listNotifications(owner, { projectId: project.id, unreadOnly: true })).toEqual([]);

    const inaccessibleProject: Project = {
      id: "prj_hidden",
      organizationId: project.organizationId,
      name: "Hidden Project",
      decisionOwnerIds: [limitedOwner.id],
    };
    await repository.saveProject(inaccessibleProject);
    const inaccessibleNotification: Notification = {
      id: "ntf_hidden",
      organizationId: inaccessibleProject.organizationId,
      projectId: inaccessibleProject.id,
      recipientId: limitedOwner.id,
      type: "question_assigned",
      title: "Hidden project question",
      body: "This must not cross the project boundary.",
      targetType: "question",
      targetId: "qst_hidden",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await repository.saveNotification(inaccessibleNotification);
    expect(await service.listNotifications(limitedOwner)).toEqual([]);
    expect(await service.markAllNotificationsRead(limitedOwner)).toEqual({ markedCount: 0 });
  });

  it("lets project administrators inspect delivery metrics and safely replay dead letters", async () => {
    const { repository, service } = await runtime();
    await service.createQuestion(agent, project.id, questionInput({
      idempotencyKey: "question-outbox-operations-001",
    }));
    const [pending] = await repository.listOutboxEvents(project.id);
    expect(pending).toBeDefined();

    const initial = await service.inspectProjectOutbox(owner, project.id, { limit: 50 });
    expect(initial).toMatchObject({
      totalMatching: 1,
      metrics: {
        total: 1,
        statusCounts: { pending: 1, processing: 0, processed: 0, failed: 0, dead_letter: 0 },
        failedCount: 0,
        totalAttempts: 0,
        readyCount: 1,
        expiredLeaseCount: 0,
        oldestReadyAgeMs: 0,
      },
    });
    await expect(service.inspectProjectOutbox(contributor, project.id, { limit: 50 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.inspectProjectOutbox(agent, project.id, { limit: 50 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.replayOutboxEvent(owner, pending!.id, { expectedAttempts: 0 }))
      .rejects.toMatchObject({ code: "CONFLICT" });

    const [claimed] = await repository.claimOutboxEvents("2026-01-01T00:00:00.000Z", 1);
    expect(claimed).toMatchObject({ id: pending!.id, status: "processing", attempts: 1 });
    await repository.failOutboxEvent(
      pending!.id,
      "provider unavailable",
      "2026-01-01T00:00:00.000Z",
      true,
    );
    await repository.saveOutboxDelivery({
      id: "odl_failed_delivery",
      organizationId: project.organizationId,
      projectId: project.id,
      outboxEventId: pending!.id,
      channel: "email",
      destinationHash: "a".repeat(64),
      status: "failed",
      attemptCount: 1,
      preference: "immediate",
      lastError: "provider unavailable",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const failures = await service.inspectProjectOutbox(owner, project.id, {
      status: "dead_letter",
      type: "notification.created",
      limit: 10,
    });
    expect(failures).toMatchObject({
      totalMatching: 1,
      items: [expect.objectContaining({ id: pending!.id, attempts: 1, lastError: "provider unavailable" })],
      deliveries: [expect.objectContaining({
        outboxEventId: pending!.id,
        channel: "email",
        status: "failed",
        destinationHash: "a".repeat(64),
      })],
      metrics: {
        failedCount: 1,
        totalAttempts: 1,
        readyCount: 0,
        expiredLeaseCount: 0,
        deliveryStatusCounts: { delivered: 0, failed: 1, suppressed: 0, deferred: 0 },
      },
    });
    await expect(service.replayOutboxEvent(owner, pending!.id, { expectedAttempts: 2 }))
      .rejects.toMatchObject({ code: "CONFLICT", details: { currentAttempts: 1 } });
    await expect(service.replayOutboxEvent(outsider, pending!.id, { expectedAttempts: 1 }))
      .rejects.toMatchObject({ code: "OUTBOX_EVENT_NOT_FOUND" });

    const replayed = await service.replayOutboxEvent(owner, pending!.id, { expectedAttempts: 1 });
    expect(replayed).toEqual({
      ...pending,
      status: "pending",
      attempts: 0,
      availableAt: "2026-01-01T00:00:00.000Z",
    });
    await expect(service.replayOutboxEvent(owner, pending!.id, { expectedAttempts: 1 }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repository.listAuditEvents(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: owner.id,
          action: "outbox.replayed",
          subjectType: "outbox_event",
          subjectId: pending!.id,
        }),
      ]),
    );
  });

  it("elevates security questions and prevents cross-tenant access", async () => {
    const { service } = await runtime();
    await expect(
      service.createQuestion(
        agent,
        project.id,
        questionInput({ category: "security", risk: "low", fallback: "Use the recommended option" }),
      ),
    ).rejects.toMatchObject({ code: "POLICY_BLOCKED" });

    await expect(service.listQuestions(outsider, project.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("personalizes the question inbox by owner, role, project admin, and protected review", async () => {
    const { service } = await runtime();
    const directQuestion = await service.createQuestion(
      agent,
      project.id,
      questionInput({ idempotencyKey: "inbox-direct-question", title: "Which owner should review transfer retries?" }),
    );
    const roleQuestion = await service.createQuestion(
      agent,
      project.id,
      questionInput({
        idempotencyKey: "inbox-role-question",
        title: "Which QA evidence should block the release?",
        category: "qa",
        intendedOwnerIds: [],
        intendedOwnerRoles: ["QA Lead"],
      }),
    );
    const protectedQuestion = await service.createQuestion(
      agent,
      project.id,
      questionInput({
        idempotencyKey: "inbox-protected-question",
        title: "Which privacy retention policy should apply?",
        category: "privacy",
        risk: "high",
        intendedOwnerIds: [qaLead.id],
      }),
    );

    const qaInbox = await service.listQuestionInbox(qaLead, project.id);
    expect(qaInbox.map((question) => question.id)).toEqual(
      expect.arrayContaining([roleQuestion.id, protectedQuestion.id]),
    );
    expect(qaInbox.find((question) => question.id === roleQuestion.id)).toMatchObject({
      inboxReasons: ["role_owner"],
      canAccept: true,
    });
    expect(qaInbox.find((question) => question.id === protectedQuestion.id)).toMatchObject({
      inboxReasons: ["direct_owner"],
      canAccept: false,
    });

    const adminInbox = await service.listQuestionInbox(owner, project.id);
    expect(adminInbox.map((question) => question.id)).toEqual(
      expect.arrayContaining([directQuestion.id, roleQuestion.id, protectedQuestion.id]),
    );
    expect(adminInbox.find((question) => question.id === protectedQuestion.id)?.inboxReasons).toEqual(
      expect.arrayContaining(["project_admin", "protected_review"]),
    );
    expect((await service.listQuestionInbox(owner, project.id, { category: "qa" })).map((question) => question.id)).toEqual([
      roleQuestion.id,
    ]);
    expect((await service.listQuestionInbox(owner, project.id, { role: "QA Lead" })).map((question) => question.id)).toEqual([
      roleQuestion.id,
    ]);
    expect((await service.listQuestionInbox(owner, project.id, { risk: "protected" })).map((question) => question.id)).toEqual([
      protectedQuestion.id,
    ]);
    expect(await service.listQuestionInbox(contributor, project.id)).toEqual([]);
  });

  it("records a separate protected-question review before owner acceptance", async () => {
    const { service } = await runtime();
    const protectedQuestion = await service.createQuestion(
      agent,
      project.id,
      questionInput({
        idempotencyKey: "question-security-review-approved",
        title: "Which privacy retention policy should apply?",
        category: "privacy",
        risk: "high",
        intendedOwnerIds: [qaLead.id],
      }),
    );

    await expect(
      service.reviewQuestion(contributor, protectedQuestion.id, {
        expectedVersion: protectedQuestion.version,
        status: "approved",
        rationale: "A contributor cannot provide the required security review authority.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const review = await service.reviewQuestion(securityReviewer, protectedQuestion.id, {
      expectedVersion: protectedQuestion.version,
      status: "approved",
      rationale: "The retention policy is bounded, documented, and appropriate for protected data.",
    });
    expect(review).toMatchObject({
      questionId: protectedQuestion.id,
      reviewerId: securityReviewer.id,
      reviewerRole: "security-reviewer",
      status: "approved",
    });
    await expect(
      service.reviewQuestion(securityReviewer, protectedQuestion.id, {
        expectedVersion: protectedQuestion.version + 1,
        status: "approved",
        rationale: "A reviewer can only submit one append-only review in this slice.",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const decision = await service.acceptAnswer(qaLead, protectedQuestion.id, {
      optionKey: "transient",
      rationale: "The owner accepts the policy after the separate security reviewer approval.",
    });
    expect(decision.ownerId).toBe(qaLead.id);

    const rejectedQuestion = await service.createQuestion(
      agent,
      project.id,
      questionInput({
        idempotencyKey: "question-security-review-rejected",
        title: "Which privacy audit rule should block release?",
        category: "privacy",
        risk: "high",
        intendedOwnerIds: [qaLead.id],
      }),
    );
    await service.reviewQuestion(securityReviewer, rejectedQuestion.id, {
      expectedVersion: rejectedQuestion.version,
      status: "rejected",
      rationale: "The proposed privacy control is incomplete and needs a stronger audit trail.",
    });
    await expect(
      service.acceptAnswer(qaLead, rejectedQuestion.id, {
        optionKey: "transient",
        rationale: "This must remain blocked until security review is approved.",
      }),
    ).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
  });

  it("versions specifications, requires human approval, and returns only approved versions as context", async () => {
    const { service } = await runtime();
    const first = await service.publishArtifact(agent, project.id, artifactInput());
    const replay = await service.publishArtifact(agent, project.id, artifactInput());
    expect(replay.version.id).toBe(first.version.id);
    await expect(
      service.approveArtifactVersion(agent, first.version.id, {
        rationale: "The publishing agent cannot approve its own generated specification.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await service.reviewArtifactVersion(owner, first.version.id, {
      status: "commented",
      body: "The bounded retry behavior is clear and ready for approval.",
    });

    await service.approveArtifactVersion(owner, first.version.id, {
      rationale: "The retry policy is bounded, observable, and consistent with the component decision.",
    });
    const firstContext = await service.getContext(agent, project.id, {
      task: "Implement the transfer retry policy",
      scope: { component: "transfers" },
      categories: ["specification"],
      maxItems: 20,
    });
    expect(firstContext.items).toEqual([
      expect.objectContaining({ id: first.version.id, type: "artifact", authority: "approved" }),
    ]);
    expect(Object.fromEntries(new URL(firstContext.items[0]!.sourceUrl).searchParams)).toMatchObject({
      view: "specifications",
      projectId: project.id,
      artifactId: first.artifact.id,
      versionId: first.version.id,
    });

    const second = await service.publishArtifact(agent, project.id, artifactInput({
      artifactId: first.artifact.id,
      idempotencyKey: "artifact-key-002",
      summary: "Adds jitter and a maximum attempt count to the transfer retry policy.",
      body: "# Transfer retry policy\n\nRetry transient failures with bounded exponential backoff, jitter, and five attempts.",
    }));
    await service.approveArtifactVersion(owner, second.version.id, {
      rationale: "Jitter and a fixed attempt limit reduce synchronized load and bound execution time.",
    });
    const diff = await service.diffArtifactVersions(owner, first.artifact.id, {
      fromVersionId: first.version.id,
      toVersionId: second.version.id,
    });
    expect(diff).toMatchObject({
      artifactId: first.artifact.id,
      from: { id: first.version.id, version: 1, status: "superseded" },
      to: { id: second.version.id, version: 2, status: "approved" },
      counts: { unchanged: 2, added: 1, removed: 1 },
      exact: true,
      truncated: false,
      totalLines: 4,
    });
    expect(diff.lines).toEqual([
      expect.objectContaining({ kind: "unchanged", oldLineNumber: 1, newLineNumber: 1, text: "# Transfer retry policy" }),
      expect.objectContaining({ kind: "unchanged", oldLineNumber: 2, newLineNumber: 2, text: "" }),
      expect.objectContaining({ kind: "removed", oldLineNumber: 3, text: expect.stringContaining("idempotency keys") }),
      expect.objectContaining({ kind: "added", newLineNumber: 3, text: expect.stringContaining("five attempts") }),
    ]);
    await expect(service.diffArtifactVersions(outsider, first.artifact.id, {
      fromVersionId: first.version.id,
      toVersionId: second.version.id,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const artifact = await service.getArtifact(agent, first.artifact.id);
    expect(artifact.versions).toEqual([
      expect.objectContaining({
        id: first.version.id,
        status: "superseded",
        body: "# Transfer retry policy\n\nRetry transient failures with bounded exponential backoff and idempotency keys.",
      }),
      expect.objectContaining({
        id: second.version.id,
        status: "approved",
        body: "# Transfer retry policy\n\nRetry transient failures with bounded exponential backoff, jitter, and five attempts.",
      }),
    ]);
  });

  it("bounds large specification diffs without changing immutable content", async () => {
    const { service } = await runtime();
    const oldBody = ["# Large specification", ...Array.from({ length: 1_100 }, (_, index) => `old-line-${index}`)].join("\n");
    const newBody = ["# Large specification", ...Array.from({ length: 1_100 }, (_, index) => `new-line-${index}`)].join("\n");
    const first = await service.publishArtifact(agent, project.id, artifactInput({
      idempotencyKey: "artifact-large-diff-001",
      summary: "Defines the original large generated specification for bounded diff verification.",
      body: oldBody,
    }));
    const second = await service.publishArtifact(agent, project.id, artifactInput({
      artifactId: first.artifact.id,
      idempotencyKey: "artifact-large-diff-002",
      summary: "Defines the replacement large generated specification for bounded diff verification.",
      body: newBody,
    }));

    const diff = await service.diffArtifactVersions(owner, first.artifact.id, {
      fromVersionId: first.version.id,
      toVersionId: second.version.id,
    });
    expect(diff).toMatchObject({
      counts: { unchanged: 1, removed: 1_100, added: 1_100 },
      exact: false,
      truncated: true,
      totalLines: 2_201,
    });
    expect(diff.lines).toHaveLength(2_000);
    const artifact = await service.getArtifact(owner, first.artifact.id);
    expect(artifact.versions.map((version) => version.body)).toEqual([oldBody, newBody]);
  });

  it("records specification feedback and requires a new version after requested changes", async () => {
    const { repository, service } = await runtime();
    const first = await service.publishArtifact(agent, project.id, artifactInput({
      idempotencyKey: "artifact-review-feedback-001",
    }));

    await expect(service.reviewArtifactVersion(contributor, first.version.id, {
      status: "commented",
      body: "A contributor who is not a configured reviewer cannot submit formal review feedback.",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const comment = await service.reviewArtifactVersion(owner, first.version.id, {
      status: "commented",
      body: "Please clarify how retry metrics distinguish transient and permanent failures.",
    });
    expect(comment).toMatchObject({
      review: { reviewerId: owner.id, status: "commented" },
      version: { reviews: [expect.objectContaining({ status: "commented" })] },
    });
    const requested = await service.reviewArtifactVersion(owner, first.version.id, {
      status: "changes_requested",
      body: "Add the retry classification rules and the dead-letter observability requirement.",
    });
    expect(requested.version.reviews).toHaveLength(2);
    await expect(service.approveArtifactVersion(owner, first.version.id, {
      rationale: "The original version cannot be approved after actionable changes were requested.",
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const replacement = await service.publishArtifact(agent, project.id, artifactInput({
      artifactId: first.artifact.id,
      idempotencyKey: "artifact-review-feedback-002",
      summary: "Adds retry classification and dead-letter observability requirements.",
      body: "# Transfer retry policy\n\nClassify transient failures, use bounded backoff, and emit dead-letter metrics for permanent failures.",
    }));
    expect(replacement.version.reviews).toEqual([]);
    await expect(service.reviewArtifactVersion(owner, first.version.id, {
      status: "commented",
      body: "Historical versions cannot receive new formal review feedback.",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await service.approveArtifactVersion(owner, replacement.version.id, {
      rationale: "The new immutable version addresses the requested classification and observability changes.",
    });
    const artifact = await service.getArtifact(agent, first.artifact.id);
    expect(artifact.versions).toEqual([
      expect.objectContaining({
        id: first.version.id,
        status: "in_review",
        reviews: [
          expect.objectContaining({ status: "commented" }),
          expect.objectContaining({ status: "changes_requested" }),
        ],
      }),
      expect.objectContaining({ id: replacement.version.id, status: "approved", reviews: [] }),
    ]);
    expect(await repository.listAuditEvents(project.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "artifact.version_commented", subjectId: first.version.id }),
      expect.objectContaining({ action: "artifact.version_changes_requested", subjectId: first.version.id }),
    ]));
    expect(await repository.listOutboxEvents(project.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "notification.created",
        payload: expect.objectContaining({
          notificationType: "artifact_review_feedback",
          targetId: first.version.id,
        }),
      }),
    ]));
  });

  it("derives project-admin analytics by run cohort without returning stored content", async () => {
    const { service } = await runtime();
    const firstRun = await service.startRun(agent, project.id, {
      idempotencyKey: "analytics-run-codex-001",
      client: "codex",
      capability: "cli",
      taskSummary: "Create the transfer retry policy",
      scope: { component: "transfers" },
      externalLinks: [],
    });
    await service.getContext(agent, project.id, {
      runId: firstRun.run.id,
      task: "Find existing transfer retry policy",
      scope: { component: "transfers" },
      categories: [],
      maxItems: 20,
    });
    const question = await service.createQuestion(agent, project.id, questionInput({
      idempotencyKey: "analytics-question-001",
      runId: firstRun.run.id,
    }));
    await service.proposeAnswer(contributor, question.id, {
      answer: "Retry only failures classified as transient.",
      rationale: "Permanent failures need operator review rather than repeated execution.",
      optionKey: "transient",
    });
    const decision = await service.acceptAnswer(owner, question.id, {
      optionKey: "transient",
      rationale: "Bounded retries for transient failures avoid duplicate work and retry loops.",
    });
    const assumption = await service.recordAssumption(agent, project.id, assumptionInput({
      idempotencyKey: "analytics-assumption-001",
      runId: firstRun.run.id,
    }));
    await service.resolveAssumption(owner, assumption.id, {
      expectedVersion: assumption.version,
      status: "rejected",
      rationale: "The proposed namespace conflicts with the existing production metric contract.",
    });
    const artifact = await service.publishArtifact(agent, project.id, artifactInput({
      idempotencyKey: "analytics-artifact-001",
      runId: firstRun.run.id,
      citedDecisionIds: [decision.id],
    }));
    await service.approveArtifactVersion(owner, artifact.version.id, {
      rationale: "The specification follows the accepted retry decision and remains operationally bounded.",
    });

    const secondRun = await service.startRun(agent, project.id, {
      idempotencyKey: "analytics-run-codex-002",
      client: "codex",
      capability: "cli",
      taskSummary: "Reuse the approved transfer retry policy",
      scope: { component: "transfers" },
      externalLinks: [],
    });
    await service.getContext(agent, project.id, {
      runId: secondRun.run.id,
      task: "Apply the approved transfer retry policy",
      scope: { component: "transfers" },
      categories: [],
      maxItems: 20,
    });
    const reused = await service.createQuestion(agent, project.id, questionInput({
      idempotencyKey: "analytics-question-reuse-001",
      runId: secondRun.run.id,
    }));
    expect(reused.submissionDisposition).toBe("reused_accepted");
    await service.startRun(agent, project.id, {
      idempotencyKey: "analytics-run-claude-001",
      client: "claude_code",
      capability: "instructions",
      taskSummary: "Observe the governed project context",
      scope: { component: "transfers" },
      externalLinks: [],
    });

    const analytics = await service.getProjectAnalytics(owner, project.id, {});
    expect(analytics).toMatchObject({
      projectId: project.id,
      cohort: { runCount: 3 },
      activity: {
        contextRetrievals: 2,
        questionSubmissions: 2,
        questionsCreated: 1,
        questionsReused: 1,
        questionsRoutedOnCreation: 1,
        responsesProposed: 2,
        decisionsAccepted: 1,
        decisionReuseOccurrences: 1,
        assumptionsRecorded: 1,
        assumptionsResolved: 1,
        specificationVersionsPublished: 1,
        specificationVersionsApproved: 1,
      },
      outcomes: {
        runsWithContextRate: 2 / 3,
        questionReuseRate: 0.5,
        firstAssignmentRoutingRate: 1,
        decisionAcceptanceRate: 1,
        acceptedDecisionReuseCount: 1,
        assumptionResolutionRate: 1,
        assumptionStatusCounts: { active: 0, confirmed: 0, rejected: 1, expired: 0, superseded: 0 },
        specificationApprovalRate: 1,
        medianQuestionResolutionMs: 0,
        medianSpecificationApprovalMs: 0,
      },
      guardrails: {
        questionsPerRun: 2 / 3,
        blockingQuestions: 1,
        unroutedBlockingQuestions: 0,
        contextItemsReturned: 2,
        contextItemsPerRetrieval: 1,
      },
      byClient: [
        expect.objectContaining({ client: "claude_code", runCount: 1, contextRetrievals: 0 }),
        expect.objectContaining({
          client: "codex",
          runCount: 2,
          contextRetrievals: 2,
          questionsReused: 1,
          decisionReuseOccurrences: 1,
        }),
      ],
    });
    const serialized = JSON.stringify(analytics);
    expect(serialized).not.toContain(question.title);
    expect(serialized).not.toContain(artifact.version.body);
    expect(serialized).not.toContain(firstRun.run.taskSummary);
    expect(analytics.privacy.excluded).toEqual(expect.arrayContaining([
      expect.stringContaining("hidden reasoning"),
      expect.stringContaining("specification titles"),
    ]));

    const claudeOnly = await service.getProjectAnalytics(owner, project.id, { client: "claude_code" });
    expect(claudeOnly).toMatchObject({
      cohort: { runCount: 1, client: "claude_code" },
      activity: { contextRetrievals: 0, questionSubmissions: 0, decisionsAccepted: 0 },
      byClient: [expect.objectContaining({ client: "claude_code", runCount: 1 })],
    });
    await expect(service.getProjectAnalytics(contributor, project.id, {}))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.getProjectAnalytics(agent, project.id, {}))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.getProjectAnalytics(outsider, project.id, {}))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("resolves OIDC identities only through active organization and project memberships", async () => {
    const repository = new InMemoryBridgeRepository();
    const timestamp = "2026-01-01T00:00:00.000Z";
    await repository.saveOrganization({
      id: project.organizationId,
      externalIdentityProviderId: "auth0-org-one",
      slug: "one",
      name: "Organization One",
      createdAt: timestamp,
    });
    await repository.saveProject(project);
    await repository.savePrincipalIdentity({
      id: "usr_oidc",
      type: "human",
      displayName: "OIDC Member",
      oidcIssuer: "https://identity.example/",
      oidcSubject: "auth0|member",
      createdAt: timestamp,
    });
    await repository.saveOrganizationMembership({
      organizationId: project.organizationId,
      principalId: "usr_oidc",
      status: "active",
      roles: ["organization-member"],
      allProjects: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    });
    await repository.saveProjectMembership({
      organizationId: project.organizationId,
      projectId: project.id,
      principalId: "usr_oidc",
      status: "active",
      roles: ["project-admin"],
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    });

    await expect(repository.resolveOidcPrincipal({
      issuer: "https://identity.example/",
      subject: "auth0|member",
      organizationExternalId: "auth0-org-one",
    })).resolves.toMatchObject({
      id: "usr_oidc",
      organizationId: project.organizationId,
      projectIds: [project.id],
      roles: ["organization-member"],
      projectRoles: { [project.id]: ["project-admin"] },
    });

    await repository.saveOrganizationMembership({
      organizationId: project.organizationId,
      principalId: "usr_oidc",
      status: "disabled",
      roles: ["organization-member"],
      allProjects: false,
      createdAt: timestamp,
      updatedAt: "2026-01-02T00:00:00.000Z",
      version: 2,
    });
    await expect(repository.resolveOidcPrincipal({
      issuer: "https://identity.example/",
      subject: "auth0|member",
      organizationExternalId: "auth0-org-one",
    })).resolves.toBeUndefined();
  });
});
