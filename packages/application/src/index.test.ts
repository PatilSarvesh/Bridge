import type {
  CreateQuestionInput,
  PublishArtifactInput,
  RecordAssumptionInput,
} from "@bridge/contracts";
import type { AuditEvent, Notification, Principal, Project } from "@bridge/domain";
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

async function runtime(): Promise<{ repository: InMemoryBridgeRepository; service: BridgeService }> {
  const repository = new InMemoryBridgeRepository();
  await repository.saveProject(project);
  return {
    repository,
    service: new BridgeService(repository, {
      publicBaseUrl: "http://bridge.test/review",
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

  it("records, ranks, expires, and human-resolves visible assumptions", async () => {
    const { repository, service } = await runtime();
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
    const artifact = await service.getArtifact(agent, first.artifact.id);
    expect(artifact.versions).toEqual([
      expect.objectContaining({ id: first.version.id, status: "superseded" }),
      expect.objectContaining({ id: second.version.id, status: "approved" }),
    ]);
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
});
