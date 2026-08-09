import cors from "@fastify/cors";
import {
  acceptAnswerInputSchema,
  approveArtifactVersionInputSchema,
  artifactReviewInputSchema,
  artifactVersionDiffQuerySchema,
  changeDecisionLifecycleInputSchema,
  contextQuerySchema,
  continuationQuerySchema,
  createQuestionInputSchema,
  decisionListQuerySchema,
  findQuestionMatchesInputSchema,
  publishArtifactInputSchema,
  proposeAnswerInputSchema,
  questionCommentInputSchema,
  notificationListQuerySchema,
  notificationReadAllInputSchema,
  outboxOperationsQuerySchema,
  projectAnalyticsQuerySchema,
  questionReviewInputSchema,
  questionInboxQuerySchema,
  recordAssumptionInputSchema,
  registerProjectInputSchema,
  reportAgentRunInputSchema,
  resolveAssumptionInputSchema,
  replayOutboxEventInputSchema,
  startAgentRunInputSchema,
} from "@bridge/contracts";
import { BridgeError, type Principal } from "@bridge/domain";
import type { BridgeService } from "@bridge/application";
import {
  BridgeMetrics,
  correlationIdHeader,
  createSafeLogger,
  resolveCorrelationId,
  runWithCorrelationContext,
} from "@bridge/observability";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ZodError } from "zod";

export interface BuildAppOptions {
  readonly service: BridgeService;
  readonly principals: Readonly<Record<string, Principal>>;
  readonly logger?: boolean;
  readonly metrics?: BridgeMetrics;
}

function resolvePrincipal(
  request: FastifyRequest,
  principals: Readonly<Record<string, Principal>>,
): Principal {
  const principalId = request.headers["x-bridge-principal-id"];
  if (typeof principalId !== "string") {
    throw new BridgeError(
      "UNAUTHENTICATED",
      "Set x-bridge-principal-id for the local vertical slice.",
      401,
    );
  }
  const principal = principals[principalId];
  if (!principal) {
    throw new BridgeError("UNAUTHENTICATED", "Unknown local principal.", 401);
  }
  return principal;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const metrics = options.metrics ?? new BridgeMetrics();
  const safeLogger = options.logger ? createSafeLogger({ service: "bridge-api" }) : undefined;
  const requestStartedAt = new WeakMap<FastifyRequest, number>();
  await app.register(cors, {
    origin: true,
    allowedHeaders: ["content-type", "x-bridge-principal-id", correlationIdHeader],
    exposedHeaders: [correlationIdHeader],
  });

  app.addHook("onRequest", (request, reply, done) => {
    const supplied = request.headers[correlationIdHeader];
    const correlationId = resolveCorrelationId(typeof supplied === "string" ? supplied : undefined);
    reply.header(correlationIdHeader, correlationId);
    requestStartedAt.set(request, performance.now());
    runWithCorrelationContext({ correlationId, source: "api" }, done);
  });

  app.addHook("onResponse", (request, reply, done) => {
    const durationMs = Math.max(0, performance.now() - (requestStartedAt.get(request) ?? performance.now()));
    const operation = request.routeOptions.url || "unmatched";
    metrics.recordHttpRequest({
      service: "api",
      operation,
      statusCode: reply.statusCode,
      durationMs,
    });
    safeLogger?.info("request.completed", {
      method: request.method,
      route: operation,
      statusCode: reply.statusCode,
      durationMs,
    });
    done();
  });

  app.setErrorHandler((error, request, reply) => {
    safeLogger?.error("request.failed", {
      method: request.method,
      route: request.routeOptions.url,
      statusCode: error instanceof BridgeError
        ? error.statusCode
        : error instanceof ZodError ? 400 : 500,
      error,
    });
    if (error instanceof BridgeError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Request validation failed.",
        details: { issues: error.issues },
      });
    }
    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  });

  const liveness = async () => ({ status: "ok", service: "bridge-api" });
  app.get("/health", liveness);
  app.get("/health/live", liveness);
  app.get("/metrics", async (_request, reply) => reply
    .type("text/plain; version=0.0.4; charset=utf-8")
    .send(metrics.renderPrometheus()));
  app.get("/health/ready", async (_request, reply) => {
    const readiness = await options.service.checkReadiness();
    return reply
      .status(readiness.status === "ready" ? 200 : 503)
      .send({ service: "bridge-api", ...readiness });
  });

  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/v1/notifications",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      const query = notificationListQuerySchema.parse({
        projectId: request.query.projectId,
        unreadOnly: request.query.unreadOnly === "true",
      });
      const items = await options.service.listNotifications(principal, query);
      return { items, unreadCount: items.filter((notification) => !notification.readAt).length };
    },
  );

  app.post<{ Params: { notificationId: string } }>(
    "/v1/notifications/:notificationId/read",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      return options.service.markNotificationRead(principal, request.params.notificationId);
    },
  );

  app.post<{ Body: unknown }>(
    "/v1/notifications/read-all",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = notificationReadAllInputSchema.parse(request.body ?? {});
      return options.service.markAllNotificationsRead(principal, input);
    },
  );

  app.get<{
    Params: { projectId: string };
    Querystring: Record<string, string | undefined>;
  }>("/v1/admin/projects/:projectId/outbox", async (request) => {
    const principal = resolvePrincipal(request, options.principals);
    const query = outboxOperationsQuerySchema.parse(request.query);
    return options.service.inspectProjectOutbox(principal, request.params.projectId, query);
  });

  app.get<{
    Params: { projectId: string };
    Querystring: Record<string, string | undefined>;
  }>("/v1/admin/projects/:projectId/analytics", async (request) => {
    const principal = resolvePrincipal(request, options.principals);
    const query = projectAnalyticsQuerySchema.parse(request.query);
    return options.service.getProjectAnalytics(principal, request.params.projectId, query);
  });

  app.post<{ Params: { eventId: string }; Body: unknown }>(
    "/v1/admin/outbox/:eventId/replay",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = replayOutboxEventInputSchema.parse(request.body);
      return options.service.replayOutboxEvent(principal, request.params.eventId, input);
    },
  );

  app.get("/v1/principals", async (request) => {
    const principal = resolvePrincipal(request, options.principals);
    return {
      items: Object.values(options.principals)
        .filter((candidate) => candidate.type === "human" && candidate.organizationId === principal.organizationId)
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
        .map((candidate) => ({
          id: candidate.id,
          displayName: candidate.displayName,
          roles: candidate.roles,
        })),
    };
  });

  app.post<{ Body: unknown }>("/v1/projects", async (request, reply) => {
    const principal = resolvePrincipal(request, options.principals);
    const input = registerProjectInputSchema.parse(request.body);
    const registration = await options.service.registerProject(principal, input);
    return reply
      .status(registration.disposition === "created" ? 201 : 200)
      .send(registration);
  });

  app.get("/v1/projects", async (request) => {
    const principal = resolvePrincipal(request, options.principals);
    return { items: await options.service.listProjects(principal) };
  });

  app.get<{ Params: { projectId: string } }>("/v1/projects/:projectId", async (request) => {
    const principal = resolvePrincipal(request, options.principals);
    return options.service.getProject(principal, request.params.projectId);
  });

  app.get<{ Params: { projectId: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/projects/:projectId/context",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      const query = contextQuerySchema.parse({
        runId: request.query.runId,
        task: request.query.task,
        scope: {
          ...(request.query.repository ? { repository: request.query.repository } : {}),
          ...(request.query.component ? { component: request.query.component } : {}),
          ...(request.query.branch ? { branch: request.query.branch } : {}),
          ...(request.query.environment ? { environment: request.query.environment } : {}),
          ...(request.query.workItem ? { workItem: request.query.workItem } : {}),
        },
        categories: request.query.categories?.split(",").filter(Boolean) ?? [],
        maxItems: request.query.maxItems ? Number(request.query.maxItems) : 20,
      });
      return options.service.getContext(principal, request.params.projectId, query);
    },
  );

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/projects/:projectId/runs",
    async (request, reply) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = startAgentRunInputSchema.parse(request.body);
      const registration = await options.service.startRun(principal, request.params.projectId, input);
      return reply.status(201).send(registration);
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/runs",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      return { items: await options.service.listRuns(principal, request.params.projectId) };
    },
  );

  app.get<{ Params: { runId: string } }>("/v1/runs/:runId", async (request) => {
    const principal = resolvePrincipal(request, options.principals);
    return options.service.getRun(principal, request.params.runId);
  });

  app.patch<{ Params: { runId: string }; Body: unknown }>(
    "/v1/runs/:runId",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = reportAgentRunInputSchema.parse(request.body);
      return options.service.reportRun(principal, request.params.runId, input);
    },
  );

  app.post<{ Params: { runId: string }; Body: unknown }>(
    "/v1/runs/:runId/continuation",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = continuationQuerySchema.parse(request.body);
      return options.service.getContinuation(
        principal,
        request.params.runId,
        input.resumeContextKey,
      );
    },
  );

  app.post<{ Params: { decisionId: string }; Body: unknown }>(
    "/v1/decisions/:decisionId/lifecycle",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = changeDecisionLifecycleInputSchema.parse(request.body);
      return options.service.changeDecisionLifecycle(principal, request.params.decisionId, input);
    },
  );

  for (const status of ["superseded", "expired", "revoked"] as const) {
    const action = status === "superseded" ? "supersede" : status === "expired" ? "expire" : "revoke";
    app.post<{ Params: { decisionId: string }; Body: unknown }>(
      `/v1/decisions/:decisionId/${action}`,
      async (request) => {
        const principal = resolvePrincipal(request, options.principals);
        const body = typeof request.body === "object" && request.body !== null
          ? request.body as Record<string, unknown>
          : {};
        const input = changeDecisionLifecycleInputSchema.parse({ ...body, status });
        return options.service.changeDecisionLifecycle(principal, request.params.decisionId, input);
      },
    );
  }

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/projects/:projectId/questions",
    async (request, reply) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = createQuestionInputSchema.parse(request.body);
      const question = await options.service.createQuestion(principal, request.params.projectId, input);
      const created = question.submissionDisposition === "created";
      return reply.status(created ? 201 : 200).send(question);
    },
  );

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/projects/:projectId/questions/matches",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = findQuestionMatchesInputSchema.parse(request.body);
      return {
        items: await options.service.findQuestionMatches(
          principal,
          request.params.projectId,
          input,
        ),
      };
    },
  );

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/projects/:projectId/assumptions",
    async (request, reply) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = recordAssumptionInputSchema.parse(request.body);
      const assumption = await options.service.recordAssumption(
        principal,
        request.params.projectId,
        input,
      );
      return reply.status(201).send(assumption);
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/assumptions",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      return { items: await options.service.listAssumptions(principal, request.params.projectId) };
    },
  );

  app.get<{ Params: { assumptionId: string } }>(
    "/v1/assumptions/:assumptionId",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      return options.service.getAssumption(principal, request.params.assumptionId);
    },
  );

  app.post<{ Params: { assumptionId: string }; Body: unknown }>(
    "/v1/assumptions/:assumptionId/resolve",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = resolveAssumptionInputSchema.parse(request.body);
      return options.service.resolveAssumption(principal, request.params.assumptionId, input);
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/questions",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      return { items: await options.service.listQuestions(principal, request.params.projectId) };
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/projects/:projectId/inbox",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      const filters = questionInboxQuerySchema.parse({
        status: request.query.status,
        risk: request.query.risk,
        category: request.query.category,
        role: request.query.role,
      });
      return {
        items: await options.service.listQuestionInbox(principal, request.params.projectId, filters),
      };
    },
  );

  app.get<{ Params: { questionId: string } }>("/v1/questions/:questionId", async (request) => {
    const principal = resolvePrincipal(request, options.principals);
    return options.service.getQuestion(principal, request.params.questionId);
  });

  app.post<{ Params: { questionId: string }; Body: unknown }>(
    "/v1/questions/:questionId/responses",
    async (request, reply) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = proposeAnswerInputSchema.parse(request.body);
      const response = await options.service.proposeAnswer(principal, request.params.questionId, input);
      return reply.status(201).send(response);
    },
  );

  app.post<{ Params: { questionId: string }; Body: unknown }>(
    "/v1/questions/:questionId/reviews",
    async (request, reply) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = questionReviewInputSchema.parse(request.body);
      const review = await options.service.reviewQuestion(principal, request.params.questionId, input);
      return reply.status(201).send(review);
    },
  );

  app.post<{ Params: { questionId: string }; Body: unknown }>(
    "/v1/questions/:questionId/comments",
    async (request, reply) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = questionCommentInputSchema.parse(request.body);
      const comment = await options.service.addQuestionComment(principal, request.params.questionId, input);
      return reply.status(201).send(comment);
    },
  );

  app.post<{ Params: { questionId: string }; Body: unknown }>(
    "/v1/questions/:questionId/accept",
    async (request, reply) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = acceptAnswerInputSchema.parse(request.body);
      const decision = await options.service.acceptAnswer(principal, request.params.questionId, input);
      return reply.status(201).send(decision);
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/projects/:projectId/decisions",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      const query = decisionListQuerySchema.parse({
        includeHistory: request.query.includeHistory === undefined
          ? undefined
          : request.query.includeHistory === "true"
            ? true
            : request.query.includeHistory === "false"
              ? false
              : request.query.includeHistory,
        search: request.query.search,
        status: request.query.status,
        category: request.query.category,
        ownerId: request.query.ownerId,
        createdFrom: request.query.createdFrom,
        createdTo: request.query.createdTo,
        scope: {
          ...(request.query.repository ? { repository: request.query.repository } : {}),
          ...(request.query.component ? { component: request.query.component } : {}),
          ...(request.query.branch ? { branch: request.query.branch } : {}),
          ...(request.query.environment ? { environment: request.query.environment } : {}),
          ...(request.query.workItem ? { workItem: request.query.workItem } : {}),
        },
      });
      return { items: await options.service.listDecisions(principal, request.params.projectId, query) };
    },
  );

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/projects/:projectId/artifacts",
    async (request, reply) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = publishArtifactInputSchema.parse(request.body);
      const publication = await options.service.publishArtifact(principal, request.params.projectId, input);
      return reply.status(201).send(publication);
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/artifacts",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      return { items: await options.service.listArtifacts(principal, request.params.projectId) };
    },
  );

  app.get<{ Params: { artifactId: string } }>("/v1/artifacts/:artifactId", async (request) => {
    const principal = resolvePrincipal(request, options.principals);
    return options.service.getArtifact(principal, request.params.artifactId);
  });

  app.get<{ Params: { artifactId: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/artifacts/:artifactId/diff",
    async (request) => {
      const principal = resolvePrincipal(request, options.principals);
      const query = artifactVersionDiffQuerySchema.parse(request.query);
      return options.service.diffArtifactVersions(principal, request.params.artifactId, query);
    },
  );

  app.post<{ Params: { versionId: string }; Body: unknown }>(
    "/v1/artifact-versions/:versionId/reviews",
    async (request, reply) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = artifactReviewInputSchema.parse(request.body);
      const result = await options.service.reviewArtifactVersion(principal, request.params.versionId, input);
      return reply.status(201).send(result);
    },
  );

  app.post<{ Params: { versionId: string }; Body: unknown }>(
    "/v1/artifact-versions/:versionId/approve",
    async (request, reply) => {
      const principal = resolvePrincipal(request, options.principals);
      const input = approveArtifactVersionInputSchema.parse(request.body);
      const publication = await options.service.approveArtifactVersion(
        principal,
        request.params.versionId,
        input,
      );
      return reply.status(201).send(publication);
    },
  );

  return app;
}
