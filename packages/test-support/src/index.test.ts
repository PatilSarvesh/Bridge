import { InMemoryBridgeRepository } from "@bridge/application";
import { describe, expect, it } from "vitest";

import { createDemoRuntimeWithRepository, demoProject, showcaseIds } from "./index.js";

describe("demo runtime seeding", () => {
  it("reuses the seeded run and historical idempotency shapes across restarts", async () => {
    const repository = new InMemoryBridgeRepository();
    const first = await createDemoRuntimeWithRepository(repository, {
      seedQuestion: true,
      seedArtifact: true,
    });
    const second = await createDemoRuntimeWithRepository(repository, {
      seedQuestion: true,
      seedArtifact: true,
    });

    expect(second.sampleRunId).toBe(first.sampleRunId);
    expect(second.sampleQuestionId).toBe(first.sampleQuestionId);
    expect(second.sampleArtifactId).toBe(first.sampleArtifactId);
    expect(second.sampleArtifactVersionId).toBe(first.sampleArtifactVersionId);
    expect(await repository.listRuns(demoProject.id)).toHaveLength(1);
    expect(await repository.listQuestions(demoProject.id)).toEqual([
      expect.objectContaining({ id: first.sampleQuestionId, runId: first.sampleRunId }),
    ]);
    const artifacts = await repository.listArtifacts(demoProject.id);
    expect(artifacts).toEqual([
      expect.objectContaining({
        id: first.sampleArtifactId,
        versions: [expect.objectContaining({ id: first.sampleArtifactVersionId })],
      }),
    ]);
    expect(artifacts[0]?.versions[0]).not.toHaveProperty("runId");
  });

  it("seeds comprehensive development showcase data once without replacing local state", async () => {
    const repository = new InMemoryBridgeRepository();
    const first = await createDemoRuntimeWithRepository(repository, { seedShowcase: true });
    const seededQuestion = await repository.getQuestion(showcaseIds.questions.discussion);
    expect(seededQuestion?.responses[0]?.revisionHistory).toHaveLength(1);
    expect(seededQuestion?.comments[0]?.revisionHistory).toHaveLength(1);

    await repository.saveQuestion({
      ...seededQuestion!,
      title: "Locally edited showcase question remains untouched",
    });
    const second = await createDemoRuntimeWithRepository(repository, { seedShowcase: true });

    expect(await repository.listRuns(demoProject.id)).toHaveLength(5);
    expect(await repository.listQuestions(demoProject.id)).toHaveLength(7);
    expect(await repository.listDecisions(demoProject.id)).toHaveLength(5);
    expect(await repository.listAssumptions(demoProject.id)).toHaveLength(6);
    expect(await repository.listArtifacts(demoProject.id)).toHaveLength(4);
    expect(await repository.listProjectRepositories(demoProject.id)).toHaveLength(2);
    expect((await repository.getQuestion(showcaseIds.questions.discussion))?.title)
      .toBe("Locally edited showcase question remains untouched");

    const support = await second.service.getProjectSupport(
      second.principals.usr_architect!,
      demoProject.id,
    );
    expect(support.routing.unroutedQuestions).toHaveLength(1);
    expect(support.decisions.overdueProtected).toHaveLength(1);
    expect(support.assumptions.expiring).toHaveLength(1);
    expect(support.runs.blocked).toHaveLength(1);
    expect(support.delivery.deadLetterEvents).toHaveLength(1);
    expect(support.diagnostics).toHaveLength(2);

    const artifacts = await first.service.listArtifacts(first.principals.usr_architect!, demoProject.id);
    expect(artifacts.map((artifact) => artifact.type).sort())
      .toEqual(["adr", "api_contract", "prd", "test_plan"]);
    expect(artifacts.flatMap((artifact) => artifact.versions).map((version) => version.status))
      .toEqual(expect.arrayContaining(["draft", "in_review", "approved", "superseded"]));
  });
});
