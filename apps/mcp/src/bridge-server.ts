import type { BridgeService } from "@bridge/application";
import {
  continuationQuerySchema,
  contextQuerySchema,
  createQuestionInputSchema,
  findQuestionMatchesInputSchema,
  publishArtifactInputSchema,
  questionInboxQuerySchema,
  recordAssumptionInputSchema,
  reportAgentRunInputSchema,
  startAgentRunInputSchema,
} from "@bridge/contracts";
import type { Principal } from "@bridge/domain";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

export interface BridgeMcpServerOptions {
  readonly publicWebUrl?: string;
}

export function createBridgeMcpServer(
  service: BridgeService,
  principal: Principal,
  options: BridgeMcpServerOptions = {},
): McpServer {
  const publicWebUrl = options.publicWebUrl ?? "http://127.0.0.1:3000";
  const recordUrl = (parameters: Readonly<Record<string, string>>): string => {
    const url = new URL(publicWebUrl);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return url.toString();
  };
  const server = new McpServer(
    { name: "bridge", version: "0.1.0" },
    {
      instructions:
        "Start consequential work with bridge_start_run and retain its run ID and continuation locator outside committed repository files. Pass the run ID when retrieving context, recording assumptions, creating questions, and publishing specifications so provenance stays linked. Search approved decisions and use bridge_find_question_matches before asking. Record only low-risk reversible uncertainty as a visible, expiring assumption; create a structured question for anything more consequential. Exact matching unresolved questions or active accepted decisions are reused automatically; related matches are suggestions only. Never represent an assumption, agent recommendation, or generated specification as human approval, and never continue or report completion while protected or blocking work lacks an accepted human decision. Use bridge_get_continuation for a durable handoff, start a later run with continuesRunId and resumeContextKey, and report the final run status with bridge_report_run. Store concise metadata and outcomes only; never send raw conversations or hidden reasoning.",
    },
  );

  server.registerTool(
    "bridge_start_run",
    {
      title: "Start a Bridge agent run",
      description: "Register a metadata-only unit of agent work and receive its durable continuation locator.",
      inputSchema: {
        projectId: z.string().min(1),
        ...startAgentRunInputSchema.shape,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, ...rawInput }) => {
      const input = startAgentRunInputSchema.parse(rawInput);
      const registration = await service.startRun(principal, projectId, input);
      return result({
        ...registration,
        runUrl: recordUrl({
          view: "runs",
          projectId,
          runId: registration.run.id,
        }),
      });
    },
  );

  server.registerTool(
    "bridge_report_run",
    {
      title: "Report Bridge agent run status",
      description: "Transition a run using its expected version and record only a concise outcome summary.",
      inputSchema: {
        runId: z.string().min(1),
        ...reportAgentRunInputSchema.shape,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ runId, ...rawInput }) => {
      const input = reportAgentRunInputSchema.parse(rawInput);
      return result({ run: await service.reportRun(principal, runId, input) });
    },
  );

  server.registerTool(
    "bridge_get_run",
    {
      title: "Get Bridge agent run",
      description: "Retrieve run status and its linked context, questions, and specification versions.",
      inputSchema: { runId: z.string().min(1) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ runId }) => result({ run: await service.getRun(principal, runId) }),
  );

  server.registerTool(
    "bridge_get_continuation",
    {
      title: "Get Bridge durable continuation",
      description: "Resolve accepted decisions and remaining blockers for a prior run using its locator.",
      inputSchema: {
        runId: z.string().min(1),
        ...continuationQuerySchema.shape,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ runId, resumeContextKey }) =>
      result({ ...(await service.getContinuation(principal, runId, resumeContextKey)) }),
  );

  server.registerTool(
    "bridge_get_context",
    {
      title: "Get Bridge project context",
      description: "Retrieve current approved decisions relevant to a task and project scope.",
      inputSchema: {
        projectId: z.string().min(1),
        ...contextQuerySchema.shape,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, ...rawQuery }) => {
      const query = contextQuerySchema.parse(rawQuery);
      return result(await service.getContext(principal, projectId, query));
    },
  );

  server.registerTool(
    "bridge_record_assumption",
    {
      title: "Record a Bridge assumption",
      description: "Record a low-risk reversible premise with expiry and source-run provenance.",
      inputSchema: {
        projectId: z.string().min(1),
        ...recordAssumptionInputSchema.shape,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, ...rawInput }) => {
      const input = recordAssumptionInputSchema.parse(rawInput);
      const assumption = await service.recordAssumption(principal, projectId, input);
      return result({
        assumption,
        reviewUrl: recordUrl({
          view: "assumptions",
          projectId,
          assumptionId: assumption.id,
        }),
      });
    },
  );

  server.registerTool(
    "bridge_get_assumption",
    {
      title: "Get a Bridge assumption",
      description: "Retrieve the current lifecycle state and provenance of an assumption.",
      inputSchema: { assumptionId: z.string().min(1) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ assumptionId }) =>
      result({ assumption: await service.getAssumption(principal, assumptionId) }),
  );

  server.registerTool(
    "bridge_list_assumptions",
    {
      title: "List Bridge assumptions",
      description: "List visible project assumptions, including their expiry and resolution state.",
      inputSchema: { projectId: z.string().min(1) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId }) =>
      result({ items: await service.listAssumptions(principal, projectId) }),
  );

  server.registerTool(
    "bridge_search_decisions",
    {
      title: "Search Bridge decisions",
      description: "Search active approved decisions before creating a new question.",
      inputSchema: {
        projectId: z.string().min(1),
        query: z.string().min(2).max(500),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, query }) => {
      const needle = query.toLowerCase();
      const decisions = (await service.listDecisions(principal, projectId)).filter((decision) =>
        `${decision.answer} ${decision.rationale} ${decision.category}`.toLowerCase().includes(needle),
      );
      return result({ items: decisions });
    },
  );

  server.registerTool(
    "bridge_find_question_matches",
    {
      title: "Find related Bridge questions",
      description: "Check unresolved questions and active accepted decisions before asking the team again.",
      inputSchema: {
        projectId: z.string().min(1),
        ...findQuestionMatchesInputSchema.shape,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, ...rawInput }) => {
      const input = findQuestionMatchesInputSchema.parse(rawInput);
      const items = await service.findQuestionMatches(principal, projectId, input);
      return result({ items });
    },
  );

  server.registerTool(
    "bridge_create_question",
    {
      title: "Create a Bridge question",
      description: "Create and route a structured project question when approved context does not resolve ambiguity.",
      inputSchema: {
        projectId: z.string().min(1),
        ...createQuestionInputSchema.shape,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, ...rawInput }) => {
      const input = createQuestionInputSchema.parse(rawInput);
      const question = await service.createQuestion(principal, projectId, input);
      return result({
        questionId: question.id,
        status: question.status,
        ownerIds: question.ownerIds,
        ownerRoles: question.ownerRoles,
        blocking: question.blocking,
        risk: question.risk,
        submissionDisposition: question.submissionDisposition,
        reviewUrl: recordUrl({
          view: "questions",
          projectId,
          questionId: question.id,
        }),
      });
    },
  );

  server.registerTool(
    "bridge_get_question",
    {
      title: "Get Bridge question",
      description: "Get a question, its current status, and the accepted decision ID when resolved.",
      inputSchema: { questionId: z.string().min(1) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ questionId }) => {
      const question = await service.getQuestion(principal, questionId);
      return result({ question });
    },
  );

  server.registerTool(
    "bridge_list_pending",
    {
      title: "List pending Bridge questions",
      description: "List unresolved questions for a project and optionally a specific agent run.",
      inputSchema: {
        projectId: z.string().min(1),
        runId: z.string().min(1).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, runId }) => {
      const questions = (await service.listQuestions(principal, projectId)).filter(
        (question) =>
          ["open", "in_discussion"].includes(question.status) && (!runId || question.runId === runId),
      );
      return result({ items: questions });
    },
  );

  server.registerTool(
    "bridge_list_inbox",
    {
      title: "List Bridge reviewer inbox",
      description:
        "List unresolved questions routed to the current human principal, including protected questions requiring security review.",
      inputSchema: {
        projectId: z.string().min(1),
        ...questionInboxQuerySchema.shape,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, ...rawFilters }) => {
      const filters = questionInboxQuerySchema.parse(rawFilters);
      return result({ items: await service.listQuestionInbox(principal, projectId, filters) });
    },
  );

  server.registerTool(
    "bridge_publish_artifact",
    {
      title: "Publish a Bridge specification version",
      description: "Publish an immutable PRD, ADR, API contract, or test plan draft for human review.",
      inputSchema: {
        projectId: z.string().min(1),
        ...publishArtifactInputSchema.shape,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, ...rawInput }) => {
      const input = publishArtifactInputSchema.parse(rawInput);
      const publication = await service.publishArtifact(principal, projectId, input);
      return result({
        artifact: publication.artifact,
        version: publication.version,
        reviewUrl: recordUrl({
          view: "specifications",
          projectId,
          artifactId: publication.artifact.id,
        }),
      });
    },
  );

  server.registerTool(
    "bridge_get_artifact",
    {
      title: "Get a Bridge specification",
      description: "Retrieve a specification and its immutable version history.",
      inputSchema: { artifactId: z.string().min(1) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ artifactId }) => result({ artifact: await service.getArtifact(principal, artifactId) }),
  );

  server.registerTool(
    "bridge_list_artifacts",
    {
      title: "List Bridge specifications",
      description: "List project specifications and their current review state.",
      inputSchema: { projectId: z.string().min(1) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId }) => result({ items: await service.listArtifacts(principal, projectId) }),
  );

  return server;
}
