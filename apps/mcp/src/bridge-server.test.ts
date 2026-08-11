import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDemoRuntime, demoPrincipals, demoProject } from "@bridge/test-support";
import { afterEach, describe, expect, it } from "vitest";

import { createBridgeMcpServer } from "./bridge-server.js";

describe("Bridge MCP tools", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((close) => close()));
  });

  it("carries an accepted human decision into a later agent context request", async () => {
    const runtime = await createDemoRuntime();
    const server = createBridgeMcpServer(runtime.service, demoPrincipals.agent, {
      publicWebUrl: "http://bridge.test/review",
    });
    const client = new Client({ name: "bridge-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

    const startResult = await client.callTool({
      name: "bridge_start_run",
      arguments: {
        projectId: demoProject.id,
        idempotencyKey: "mcp-test-run-001",
        client: "codex",
        capability: "mcp",
        taskSummary: "Implement transfer retry handling",
        scope: { component: "transfers" },
        externalLinks: [],
      },
    });
    const registration = startResult.structuredContent as {
      run: { id: string };
      resumeContextKey: string;
      runUrl: string;
    };
    expect(Object.fromEntries(new URL(registration.runUrl).searchParams)).toMatchObject({
      view: "runs",
      projectId: demoProject.id,
      runId: registration.run.id,
    });

    const assumptionResult = await client.callTool({
      name: "bridge_record_assumption",
      arguments: {
        projectId: demoProject.id,
        idempotencyKey: "mcp-test-assumption-001",
        runId: registration.run.id,
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
    const assumptionId = (assumptionResult.structuredContent as {
      assumption: { id: string };
    }).assumption.id;
    const getAssumptionResult = await client.callTool({
      name: "bridge_get_assumption",
      arguments: { assumptionId },
    });
    expect(getAssumptionResult.structuredContent).toEqual(
      expect.objectContaining({
        assumption: expect.objectContaining({ id: assumptionId, status: "active" }),
      }),
    );
    const assumptionContextResult = await client.callTool({
      name: "bridge_get_context",
      arguments: {
        projectId: demoProject.id,
        runId: registration.run.id,
        task: "Instrument internal retry metrics",
        scope: { component: "transfers" },
        categories: ["observability"],
        maxItems: 20,
      },
    });
    expect(assumptionContextResult.structuredContent).toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ id: assumptionId, authority: "assumption" })],
      }),
    );

    const createResult = await client.callTool({
      name: "bridge_create_question",
      arguments: {
        projectId: demoProject.id,
        idempotencyKey: "mcp-test-question-001",
        runId: registration.run.id,
        title: "Which failures should the transfer worker retry?",
        type: "decision",
        category: "architecture",
        context: "The transfer worker currently retries every failed operation without classification.",
        whyItMatters: "Permanent validation failures should not consume retry capacity or hide user action.",
        intendedOwnerIds: [demoPrincipals.architect.id],
        risk: "high",
        reversible: false,
        blocking: true,
        options: [
          { key: "transient", label: "Retry transient failures only", tradeoffs: "Requires classification." },
          { key: "all", label: "Retry all failures", tradeoffs: "May retry invalid work." },
        ],
        recommendationKey: "transient",
        scope: { component: "transfers" },
      },
    });
    const createdQuestion = createResult.structuredContent as { questionId: string; reviewUrl: string };
    const questionId = createdQuestion.questionId;
    expect(Object.fromEntries(new URL(createdQuestion.reviewUrl).searchParams)).toMatchObject({
      view: "questions",
      projectId: demoProject.id,
      questionId,
    });

    const matchResult = await client.callTool({
      name: "bridge_find_question_matches",
      arguments: {
        projectId: demoProject.id,
        title: "Which failures should the transfer worker retry?",
        type: "decision",
        category: "architecture",
        context: "The transfer worker currently retries every failed operation without classification.",
        risk: "high",
        reversible: false,
        blocking: true,
        scope: { component: "transfers" },
        maxItems: 5,
      },
    });
    expect(matchResult.structuredContent).toEqual({
      items: [expect.objectContaining({ questionId, matchKind: "exact", score: 100 })],
    });

    await runtime.service.acceptAnswer(demoPrincipals.architect, questionId, {
      optionKey: "transient",
      rationale: "Retry only transient failures using a bounded policy and idempotency keys.",
    });

    const decisionSearchResult = await client.callTool({
      name: "bridge_search_decisions",
      arguments: {
        projectId: demoProject.id,
        query: "bounded policy",
      },
    });
    expect(decisionSearchResult.structuredContent).toEqual({
      items: [expect.objectContaining({ category: "architecture", status: "active" })],
    });

    const contextResult = await client.callTool({
      name: "bridge_get_context",
      arguments: {
        projectId: demoProject.id,
        runId: registration.run.id,
        task: "Implement transient transfer retry policy",
        scope: { component: "transfers" },
        categories: ["architecture"],
        maxItems: 20,
      },
    });
    const context = contextResult.structuredContent as { items: Array<{ title: string }> };
    expect(context.items[0]?.title).toBe("Retry transient failures only");

    const publishResult = await client.callTool({
      name: "bridge_publish_artifact",
      arguments: {
        projectId: demoProject.id,
        idempotencyKey: "mcp-artifact-test-001",
        runId: registration.run.id,
        title: "Transfer retry policy",
        type: "adr",
        summary: "Defines bounded retry behavior for transient transfer failures.",
        body: "# Transfer retry policy\n\nRetry transient failures using bounded exponential backoff and idempotency keys.",
        intendedReviewerIds: [demoPrincipals.architect.id],
        citedDecisionIds: [
          (await runtime.service.listDecisions(demoPrincipals.agent, demoProject.id))[0]?.id,
        ].filter(Boolean),
        requestReview: true,
        scope: { component: "transfers" },
      },
    });
    const published = publishResult.structuredContent as {
      artifact: { id: string };
      version: { id: string };
      reviewUrl: string;
    };
    expect(Object.fromEntries(new URL(published.reviewUrl).searchParams)).toMatchObject({
      view: "specifications",
      projectId: demoProject.id,
      artifactId: published.artifact.id,
    });
    await runtime.service.approveArtifactVersion(demoPrincipals.architect, published.version.id, {
      rationale: "The specification accurately records the accepted retry decision and its operational bounds.",
    });

    const specificationContextResult = await client.callTool({
      name: "bridge_get_context",
      arguments: {
        projectId: demoProject.id,
        runId: registration.run.id,
        task: "Implement the transfer retry specification",
        scope: { component: "transfers" },
        categories: ["specification"],
        maxItems: 20,
      },
    });
    const specificationContext = specificationContextResult.structuredContent as {
      items: Array<{ id: string; type: string }>;
    };
    expect(specificationContext.items).toEqual([
      expect.objectContaining({ id: published.version.id, type: "artifact" }),
    ]);

    const continuationResult = await client.callTool({
      name: "bridge_get_continuation",
      arguments: {
        runId: registration.run.id,
        resumeContextKey: registration.resumeContextKey,
      },
    });
    expect(continuationResult.structuredContent).toEqual(
      expect.objectContaining({ canContinue: true, acceptedDecisionIds: [expect.any(String)] }),
    );
  });

  it("lists the current human reviewer's routed inbox with filters", async () => {
    const runtime = await createDemoRuntime();
    const question = await runtime.service.createQuestion(demoPrincipals.agent, demoProject.id, {
      idempotencyKey: "mcp-inbox-question-001",
      title: "Which retention window should the patient export use?",
      type: "approval",
      category: "privacy",
      context: "The export endpoint needs a bounded retention window before deletion.",
      whyItMatters: "An unbounded export could retain sensitive patient data longer than policy allows.",
      intendedOwnerIds: [],
      intendedOwnerRoles: ["qa-lead"],
      risk: "protected",
      reversible: false,
      blocking: true,
      options: [
        { key: "seven-days", label: "Seven days", tradeoffs: "Short retention with more re-exports." },
        { key: "thirty-days", label: "Thirty days", tradeoffs: "More recovery time with greater exposure." },
      ],
      recommendationKey: "seven-days",
      scope: { component: "patient-export" },
    });
    const server = createBridgeMcpServer(runtime.service, demoPrincipals.qaLead);
    const client = new Client({ name: "bridge-inbox-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

    const inboxResult = await client.callTool({
      name: "bridge_list_inbox",
      arguments: {
        projectId: demoProject.id,
        risk: "protected",
        role: "qa-lead",
      },
    });

    expect(inboxResult.structuredContent).toEqual({
      items: [
        expect.objectContaining({
          id: question.id,
          risk: "protected",
          ownerRoles: ["qa-lead"],
          inboxReasons: ["role_owner"],
          canAccept: false,
          reviews: [],
        }),
      ],
    });

    const agentServer = createBridgeMcpServer(runtime.service, demoPrincipals.agent);
    const agentClient = new Client({ name: "bridge-agent-inbox-test-client", version: "0.1.0" });
    const [agentClientTransport, agentServerTransport] = InMemoryTransport.createLinkedPair();
    await agentServer.connect(agentServerTransport);
    await agentClient.connect(agentClientTransport);
    cleanup.push(async () => {
      await agentClient.close();
      await agentServer.close();
    });
    const agentInboxResult = await agentClient.callTool({
      name: "bridge_list_inbox",
      arguments: { projectId: demoProject.id },
    });
    expect(agentInboxResult.structuredContent).toEqual({ items: [] });
  });

  it("enforces bearer capabilities for authenticated non-human MCP principals", async () => {
    const runtime = await createDemoRuntime();
    const readOnlyAgent = { ...demoPrincipals.agent, scopes: ["bridge:read"] } as const;
    const server = createBridgeMcpServer(runtime.service, readOnlyAgent);
    const client = new Client({ name: "bridge-scope-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

    const readResult = await client.callTool({
      name: "bridge_list_artifacts",
      arguments: { projectId: demoProject.id },
    });
    expect(readResult.isError).not.toBe(true);

    const writeResult = await client.callTool({
      name: "bridge_start_run",
      arguments: {
        projectId: demoProject.id,
        idempotencyKey: "mcp-scope-write-denial-001",
        client: "codex",
        capability: "mcp",
        taskSummary: "Attempt a write with a read-only MCP token",
        scope: { component: "transfers" },
        externalLinks: [],
      },
    });
    expect(writeResult.isError).toBe(true);
    expect((writeResult.content as Array<{ readonly text?: string }>)[0])
      .toMatchObject({ text: expect.stringContaining("bridge:write") });

    const noScopeServer = createBridgeMcpServer(runtime.service, { ...demoPrincipals.agent, scopes: [] });
    const noScopeClient = new Client({ name: "bridge-missing-scope-test-client", version: "0.1.0" });
    const [noScopeClientTransport, noScopeServerTransport] = InMemoryTransport.createLinkedPair();
    await noScopeServer.connect(noScopeServerTransport);
    await noScopeClient.connect(noScopeClientTransport);
    cleanup.push(async () => {
      await noScopeClient.close();
      await noScopeServer.close();
    });
    const noScopeResult = await noScopeClient.callTool({
      name: "bridge_list_artifacts",
      arguments: { projectId: demoProject.id },
    });
    expect(noScopeResult.isError).toBe(true);
    expect((noScopeResult.content as Array<{ readonly text?: string }>)[0])
      .toMatchObject({ text: expect.stringContaining("bridge:read") });
  });
});
