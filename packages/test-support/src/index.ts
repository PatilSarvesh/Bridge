import {
  BridgeService,
  InMemoryBridgeRepository,
  type BridgeRepository,
  type BridgeServiceOptions,
} from "@bridge/application";
import type { Organization, Principal, PrincipalIdentity, Project } from "@bridge/domain";

import { seedShowcaseData } from "./showcase.js";

export { showcaseIds } from "./showcase.js";

export const demoOidcIssuer = "https://bridge.local/";

export const demoOrganization: Organization = {
  id: "org_acme",
  externalIdentityProviderId: "dev_org_acme",
  slug: "acme",
  name: "Acme",
  createdAt: "2026-01-01T00:00:00.000Z",
};

export const outsiderOrganization: Organization = {
  id: "org_other",
  externalIdentityProviderId: "dev_org_other",
  slug: "other",
  name: "Other Organization",
  createdAt: "2026-01-01T00:00:00.000Z",
};

export const demoProject: Project = {
  id: "prj_payments",
  organizationId: "org_acme",
  name: "Payments Platform",
  decisionOwnerIds: ["usr_architect"],
};

export const demoPrincipals = {
  agent: {
    id: "agt_codex",
    type: "agent",
    organizationId: "org_acme",
    projectIds: [demoProject.id],
    allProjects: true,
    roles: ["agent"],
    displayName: "Codex",
  },
  architect: {
    id: "usr_architect",
    type: "human",
    organizationId: "org_acme",
    projectIds: [demoProject.id],
    allProjects: true,
    roles: ["architecture-owner", "organization-admin", "project-admin", "security-reviewer", "data-privacy-owner"],
    displayName: "Sarvesh Patil",
  },
  contributor: {
    id: "usr_contributor",
    type: "human",
    organizationId: "org_acme",
    projectIds: [demoProject.id],
    allProjects: true,
    roles: ["contributor"],
    displayName: "Developer",
  },
  qaLead: {
    id: "usr_qa_lead",
    type: "human",
    organizationId: "org_acme",
    projectIds: [demoProject.id],
    allProjects: true,
    roles: ["qa-lead", "qa", "data-privacy-owner"],
    displayName: "QA Lead",
  },
  securityReviewer: {
    id: "usr_security_reviewer",
    type: "human",
    organizationId: "org_acme",
    projectIds: [demoProject.id],
    allProjects: true,
    roles: ["security-reviewer"],
    displayName: "Security Reviewer",
  },
  businessAnalyst: {
    id: "usr_business_analyst",
    type: "human",
    organizationId: "org_acme",
    projectIds: [demoProject.id],
    allProjects: true,
    roles: ["business-analyst", "ba"],
    displayName: "Business Analyst",
  },
  outsider: {
    id: "usr_outsider",
    type: "human",
    organizationId: "org_other",
    projectIds: [demoProject.id],
    allProjects: true,
    roles: ["project-admin"],
    displayName: "Outsider",
  },
} as const satisfies Record<string, Principal>;

export type DemoPrincipalName = keyof typeof demoPrincipals;

export const demoPrincipalsById: Readonly<Record<string, Principal>> = Object.fromEntries(
  Object.values(demoPrincipals).map((principal) => [principal.id, principal]),
);

export interface DemoRuntime {
  readonly repository: BridgeRepository;
  readonly service: BridgeService;
  readonly principals: Readonly<Record<string, Principal>>;
  readonly sampleQuestionId?: string;
  readonly sampleRunId?: string;
  readonly sampleArtifactId?: string;
  readonly sampleArtifactVersionId?: string;
}

export interface DemoRuntimeOptions {
  readonly seedFixtures?: boolean;
  readonly seedQuestion?: boolean;
  readonly seedArtifact?: boolean;
  readonly seedShowcase?: boolean;
  readonly serviceOptions?: BridgeServiceOptions;
}

export async function createDemoRuntime(
  options: DemoRuntimeOptions = {},
): Promise<DemoRuntime> {
  const repository = new InMemoryBridgeRepository(options.serviceOptions?.metrics);
  return createDemoRuntimeWithRepository(repository, options);
}

export async function createDemoRuntimeWithRepository(
  repository: BridgeRepository,
  options: DemoRuntimeOptions = {},
): Promise<DemoRuntime> {
  const service = new BridgeService(repository, {
    identityIssuer: demoOidcIssuer,
    ...options.serviceOptions,
  });
  if (options.seedFixtures === false) {
    return {
      repository,
      service,
      principals: demoPrincipalsById,
    };
  }
  await repository.saveOrganization(demoOrganization);
  await repository.saveOrganization(outsiderOrganization);
  await repository.transaction(
    (scopedRepository) => scopedRepository.saveProject(demoProject),
    { organizationId: demoProject.organizationId },
  );
  const timestamp = "2026-01-01T00:00:00.000Z";
  for (const principal of Object.values(demoPrincipals)) {
    const identity: PrincipalIdentity = {
      id: principal.id,
      type: principal.type,
      displayName: principal.displayName,
      oidcIssuer: demoOidcIssuer,
      oidcSubject: principal.id,
      createdAt: timestamp,
    };
    await repository.savePrincipalIdentity(identity);
    await repository.transaction(async (scopedRepository) => {
      await scopedRepository.saveOrganizationMembership({
        organizationId: principal.organizationId,
        principalId: principal.id,
        status: "active",
        roles: principal.roles,
        allProjects: principal.allProjects ?? false,
        provisioning: "manual",
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      });
      if (principal.organizationId === demoProject.organizationId) {
        await scopedRepository.saveProjectMembership({
          organizationId: principal.organizationId,
          projectId: demoProject.id,
          principalId: principal.id,
          status: "active",
          roles: principal.roles,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
        });
      }
    }, { organizationId: principal.organizationId });
  }
  let sampleRunId: string | undefined;
  let sampleQuestionId: string | undefined;
  let sampleArtifactId: string | undefined;
  let sampleArtifactVersionId: string | undefined;
  if (options.seedQuestion || options.seedArtifact) {
    const legacyQuestion = (await service.listQuestions(demoPrincipals.agent, demoProject.id)).find(
      (question) =>
        question.title === "Which transfer failures should trigger an automatic retry?" &&
        question.runId !== undefined,
    );
    const legacyRun = legacyQuestion?.runId
      ? await service.getRun(demoPrincipals.agent, legacyQuestion.runId)
      : undefined;
    if (legacyRun) {
      sampleRunId = legacyRun.id;
    } else {
      const registration = await service.startRun(demoPrincipals.agent, demoProject.id, {
        idempotencyKey: "demo-transfer-retry-run",
        client: "codex",
        capability: "cli",
        taskSummary: "Define and implement the transfer retry policy",
        scope: {
          repository: "payments-api",
          component: "transfers",
          branch: "feature/transfer-retry",
          workItem: "PAY-142",
        },
        externalLinks: [],
      });
      sampleRunId = registration.run.id;
    }
  }
  if (options.seedQuestion) {
    const question = await service.createQuestion(demoPrincipals.agent, demoProject.id, {
      idempotencyKey: "demo-transfer-retry-question",
      ...(sampleRunId ? { runId: sampleRunId } : {}),
      title: "Which transfer failures should trigger an automatic retry?",
      type: "decision",
      category: "architecture",
      context: "The current implementation treats every non-success response as retryable.",
      whyItMatters: "Retrying permanent failures can create repeated load and delay actionable user feedback.",
      intendedOwnerIds: [demoPrincipals.architect.id],
      intendedOwnerRoles: [],
      risk: "high",
      reversible: false,
      blocking: true,
      options: [
        {
          key: "transient-only",
          label: "Retry transient failures only",
          tradeoffs: "Requires error classification but avoids useless retries.",
        },
        {
          key: "all-failures",
          label: "Retry all failures",
          tradeoffs: "Simpler implementation but may repeatedly retry invalid requests.",
        },
      ],
      recommendationKey: "transient-only",
      fallback: null,
      scope: {
        repository: "payments-api",
        component: "transfers",
        branch: "feature/transfer-retry",
        environment: "production",
        workItem: "PAY-142",
      },
    });
    sampleQuestionId = question.id;
  }
  if (options.seedArtifact) {
    const publication = await service.publishArtifact(demoPrincipals.agent, demoProject.id, {
      idempotencyKey: "demo-transfer-retry-adr-v1",
      title: "Transfer retry policy",
      type: "adr",
      summary: "Defines how the transfer worker classifies and retries transient failures.",
      body: `# Transfer retry policy

## Context

The transfer worker needs a bounded, observable retry policy that does not retry permanent failures.

## Proposed decision

Classify failures before retrying and use bounded exponential backoff with idempotency keys.`,
      intendedReviewerIds: [demoPrincipals.architect.id],
      requiredApprovals: 1,
      citedDecisionIds: [],
      requestReview: true,
      scope: {
        repository: "payments-api",
        component: "transfers",
        workItem: "PAY-142",
      },
    });
    sampleArtifactId = publication.artifact.id;
    sampleArtifactVersionId = publication.version.id;
  }
  if (options.seedShowcase) {
    await seedShowcaseData({
      repository,
      project: demoProject,
      principals: {
        agent: demoPrincipals.agent,
        architect: demoPrincipals.architect,
        contributor: demoPrincipals.contributor,
        qaLead: demoPrincipals.qaLead,
        securityReviewer: demoPrincipals.securityReviewer,
        businessAnalyst: demoPrincipals.businessAnalyst,
      },
    });
  }
  return {
    repository,
    service,
    principals: demoPrincipalsById,
    ...(sampleQuestionId ? { sampleQuestionId } : {}),
    ...(sampleRunId ? { sampleRunId } : {}),
    ...(sampleArtifactId ? { sampleArtifactId } : {}),
    ...(sampleArtifactVersionId ? { sampleArtifactVersionId } : {}),
  };
}
