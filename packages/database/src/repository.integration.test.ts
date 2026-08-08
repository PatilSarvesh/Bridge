import { randomUUID } from "node:crypto";

import { BridgeService } from "@bridge/application";
import type { Principal, Project } from "@bridge/domain";
import { describe, expect, it } from "vitest";

import { createPostgresBridgeStore } from "./index.js";
import { migrateDatabase } from "./migrate.js";

const databaseUrl = process.env.BRIDGE_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgresBridgeRepository", () => {
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
    let artifactVersionId: string;
    let assumptionId: string;
    let runId: string;
    try {
      await firstStore.repository.saveProject(project);
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
      const decision = await service.acceptAnswer(owner, question.id, {
        optionKey: "postgres",
        rationale: "PostgreSQL provides durable transactions and concurrency controls.",
      });
      decisionId = decision.id;

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
      await service.approveArtifactVersion(owner, publication.version.id, {
        rationale: "The specification accurately implements the accepted persistence decision.",
      });
      artifactVersionId = publication.version.id;
    } finally {
      await firstStore.close();
    }

    const secondStore = createPostgresBridgeStore(databaseUrl);
    try {
      const service = new BridgeService(secondStore.repository);
      expect(await service.getRun(agent, runId)).toMatchObject({
        id: runId,
        status: "waiting_for_human",
        questionIds: [expect.any(String)],
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
        expect.arrayContaining([decisionId, artifactVersionId, assumptionId]),
      );
    } finally {
      await secondStore.close();
    }
  });
});
