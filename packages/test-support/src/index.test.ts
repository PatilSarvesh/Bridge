import { InMemoryBridgeRepository } from "@bridge/application";
import { describe, expect, it } from "vitest";

import { createDemoRuntimeWithRepository, demoProject } from "./index.js";

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
});
