import cors from "@fastify/cors";
import { developmentAuthConfiguration, type AuthenticationProvider } from "@bridge/auth";
import {
  acceptAnswerInputSchema,
  overrideQuestionApprovalInputSchema,
  auditExportInputSchema,
  auditListQuerySchema,
  approveArtifactVersionInputSchema,
  artifactReviewInputSchema,
  artifactVersionDiffQuerySchema,
  changeDecisionLifecycleInputSchema,
  contextQuerySchema,
  continuationQuerySchema,
  createOrganizationMemberInputSchema,
  createServiceIdentityInputSchema,
  createQuestionInputSchema,
  decisionListQuerySchema,
  decisionConflictQuerySchema,
  decisionImpactQuerySchema,
  editQuestionCommentInputSchema,
  editQuestionResponseInputSchema,
  findQuestionMatchesInputSchema,
  githubPullRequestContextQuerySchema,
  githubPullRequestListQuerySchema,
  publishArtifactInputSchema,
  proposeAnswerInputSchema,
  questionClarificationInputSchema,
  questionAudienceViewQuerySchema,
  questionCommentInputSchema,
  questionDecisionDigestQuerySchema,
  notificationListQuerySchema,
  notificationPreferenceInputSchema,
  notificationReadAllInputSchema,
  outboxOperationsQuerySchema,
  projectAnalyticsQuerySchema,
  questionReviewInputSchema,
  reassignQuestionInputSchema,
  questionInboxQuerySchema,
  linkRepositoryInputSchema,
  recordAdapterDiagnosticInputSchema,
  recordAssumptionInputSchema,
  replaceProjectOwnershipInputSchema,
  replaceProjectPolicyInputSchema,
  registerProjectInputSchema,
  reportAgentRunInputSchema,
  resolveAssumptionInputSchema,
  replayOutboxEventInputSchema,
  startAgentRunInputSchema,
  syncGithubPullRequestInputSchema,
  updateOrganizationMemberInputSchema,
  revokeServiceIdentityInputSchema,
  rotateServiceIdentityInputSchema,
} from "@bridge/contracts";
import {
  assertPrincipalScope,
  bridgeScopes,
  BridgeError,
  type BridgeScope,
  type Principal,
} from "@bridge/domain";
import type { BridgeService, ProjectSupportView } from "@bridge/application";
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
  readonly authenticator?: AuthenticationProvider;
  readonly allowDevelopmentPrincipalHeader?: boolean;
  readonly corsOrigin?: string;
  readonly logger?: boolean;
  readonly metrics?: BridgeMetrics;
}

async function resolvePrincipal(
  request: FastifyRequest,
  options: BuildAppOptions,
): Promise<Principal> {
  if (options.authenticator) {
    const authorization = typeof request.headers.authorization === "string"
      ? request.headers.authorization
      : undefined;
    const cookie = typeof request.headers.cookie === "string" ? request.headers.cookie : undefined;
    const principal = await options.authenticator.authenticateRequest({
      ...(authorization ? { authorization } : {}),
      ...(cookie ? { cookie } : {}),
    });
    const requiredScope = requiredScopeForRequest(request);
    if (requiredScope) assertPrincipalScope(principal, requiredScope, "This API operation");
    return principal;
  }
  const principalId = request.headers["x-bridge-principal-id"];
  if (typeof principalId !== "string") {
    throw new BridgeError(
      "UNAUTHENTICATED",
      "Set x-bridge-principal-id for the local vertical slice.",
      401,
    );
  }
  const principal = options.principals[principalId];
  if (!principal) {
    throw new BridgeError("UNAUTHENTICATED", "Unknown local principal.", 401);
  }
  return principal;
}

type ScopedHttpMethod = "GET" | "HEAD" | "POST" | "PATCH";
type EndpointScopeRule = {
  readonly match: RegExp;
  readonly scopes: Partial<Record<ScopedHttpMethod, BridgeScope>>;
};

function readWriteScopes(read: BridgeScope, write: BridgeScope): EndpointScopeRule["scopes"] {
  return { GET: read, HEAD: read, POST: write, PATCH: write };
}

function allMutationMethods(scope: BridgeScope): EndpointScopeRule["scopes"] {
  return { GET: scope, HEAD: scope, POST: scope, PATCH: scope };
}

const endpointScopeRules: readonly EndpointScopeRule[] = [
  {
    match: /^\/v1\/notifications(?:$|\/)/,
    scopes: readWriteScopes(bridgeScopes.notificationsRead, bridgeScopes.notificationsWrite),
  },
  {
    match: /^\/v1\/admin\/organization\//,
    scopes: allMutationMethods(bridgeScopes.organizationAdmin),
  },
  {
    match: /^\/v1\/admin\/projects\/[^/]+\//,
    scopes: allMutationMethods(bridgeScopes.projectAdmin),
  },
  {
    match: /^\/v1\/admin\/outbox\//,
    scopes: { POST: bridgeScopes.projectAdmin },
  },
  {
    match: /^\/v1\/principals$/,
    scopes: { GET: bridgeScopes.organizationRead, HEAD: bridgeScopes.organizationRead },
  },
  {
    match: /^\/v1\/projects(?:$|\/[^/]+$)/,
    scopes: { GET: bridgeScopes.projectsRead, HEAD: bridgeScopes.projectsRead, POST: bridgeScopes.projectsWrite },
  },
  {
    match: /^\/v1\/projects\/[^/]+\/repositories$/,
    scopes: readWriteScopes(bridgeScopes.repositoriesRead, bridgeScopes.repositoriesWrite),
  },
  {
    match: /^\/v1\/projects\/[^/]+\/integrations\/github\/pull-requests(?:$|\/)/,
    scopes: readWriteScopes(bridgeScopes.repositoriesRead, bridgeScopes.repositoriesWrite),
  },
  {
    match: /^\/v1\/projects\/[^/]+\/adapter-diagnostics$/,
    scopes: { POST: bridgeScopes.diagnosticsWrite },
  },
  {
    match: /^\/v1\/projects\/[^/]+\/context$/,
    scopes: { GET: bridgeScopes.contextRead, HEAD: bridgeScopes.contextRead },
  },
  {
    match: /^\/v1\/projects\/[^/]+\/runs$/,
    scopes: readWriteScopes(bridgeScopes.runsRead, bridgeScopes.runsWrite),
  },
  {
    match: /^\/v1\/runs\/[^/]+\/continuation$/,
    scopes: { POST: bridgeScopes.runsRead },
  },
  {
    match: /^\/v1\/runs\/[^/]+$/,
    scopes: { GET: bridgeScopes.runsRead, HEAD: bridgeScopes.runsRead, PATCH: bridgeScopes.runsWrite },
  },
  {
    match: /^\/v1\/projects\/[^/]+\/(?:decisions|decision-conflicts)$/,
    scopes: { GET: bridgeScopes.decisionsRead, HEAD: bridgeScopes.decisionsRead },
  },
  {
    match: /^\/v1\/decisions\/[^/]+\/(?:lifecycle|supersede|expire|revoke)$/,
    scopes: { POST: bridgeScopes.decisionsWrite },
  },
  {
    match: /^\/v1\/decisions\/[^/]+\/impact$/,
    scopes: { GET: bridgeScopes.decisionsRead, HEAD: bridgeScopes.decisionsRead },
  },
  {
    match: /^\/v1\/projects\/[^/]+\/questions\/matches$/,
    scopes: { POST: bridgeScopes.questionsRead },
  },
  {
    match: /^\/v1\/projects\/[^/]+\/(?:questions|inbox|question-digests)(?:$|\/)/,
    scopes: readWriteScopes(bridgeScopes.questionsRead, bridgeScopes.questionsWrite),
  },
  {
    match: /^\/v1\/questions\/[^/]+(?:\/|$)/,
    scopes: readWriteScopes(bridgeScopes.questionsRead, bridgeScopes.questionsWrite),
  },
  {
    match: /^\/v1\/projects\/[^/]+\/assumptions$/,
    scopes: readWriteScopes(bridgeScopes.assumptionsRead, bridgeScopes.assumptionsWrite),
  },
  {
    match: /^\/v1\/assumptions\/[^/]+$/,
    scopes: { GET: bridgeScopes.assumptionsRead, HEAD: bridgeScopes.assumptionsRead },
  },
  {
    match: /^\/v1\/assumptions\/[^/]+\/resolve$/,
    scopes: { POST: bridgeScopes.assumptionsWrite },
  },
  {
    match: /^\/v1\/projects\/[^/]+\/artifacts$/,
    scopes: readWriteScopes(bridgeScopes.artifactsRead, bridgeScopes.artifactsWrite),
  },
  {
    match: /^\/v1\/artifacts\/[^/]+(?:\/diff)?$/,
    scopes: { GET: bridgeScopes.artifactsRead, HEAD: bridgeScopes.artifactsRead },
  },
  {
    match: /^\/v1\/artifact-versions\/[^/]+\/(?:reviews|approve)$/,
    scopes: { POST: bridgeScopes.artifactsWrite },
  },
];

async function resolveOptionalWebPrincipal(
  request: FastifyRequest,
  options: BuildAppOptions,
): Promise<Principal | undefined> {
  if (!options.authenticator) return undefined;
  const cookie = typeof request.headers.cookie === "string" ? request.headers.cookie : undefined;
  if (!cookie) return undefined;
  try {
    return await options.authenticator.authenticateRequest({ cookie });
  } catch (error) {
    if (error instanceof BridgeError && error.code === "UNAUTHENTICATED") return undefined;
    throw error;
  }
}

function requiredScopeForRequest(request: FastifyRequest): BridgeScope | undefined {
  const route = request.routeOptions.url ?? request.url?.split("?", 1)[0] ?? "";
  if (!route.startsWith("/v1/") || route.startsWith("/v1/auth/")) return undefined;
  const method = request.method as ScopedHttpMethod;
  const rule = endpointScopeRules.find((candidate) => candidate.match.test(route));
  if (rule?.scopes[method]) return rule.scopes[method];
  return method === "GET" || method === "HEAD"
    ? bridgeScopes.read
    : bridgeScopes.write;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const developmentPrincipalHeaderAllowed = options.allowDevelopmentPrincipalHeader ??
    process.env.NODE_ENV !== "production";
  if (!options.authenticator && !developmentPrincipalHeaderAllowed) {
    throw new Error("OIDC authentication is required when NODE_ENV=production.");
  }
  if (options.authenticator && process.env.NODE_ENV === "production" && !options.corsOrigin) {
    throw new Error("A fixed CORS origin is required for production OIDC sessions.");
  }
  const app = Fastify({ logger: false });
  const metrics = options.metrics ?? new BridgeMetrics();
  const safeLogger = options.logger ? createSafeLogger({ service: "bridge-api" }) : undefined;
  const requestStartedAt = new WeakMap<FastifyRequest, number>();
  await app.register(cors, {
    origin: options.corsOrigin ?? true,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "x-bridge-principal-id", correlationIdHeader],
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

  app.get("/v1/auth/config", async () => options.authenticator
    ? options.authenticator.publicConfiguration()
    : developmentAuthConfiguration());

  if (options.authenticator) {
    app.get<{ Querystring: { returnTo?: string } }>("/v1/auth/login", async (request, reply) => {
      const login = await options.authenticator!.beginWebLogin(request.query.returnTo);
      return reply
        .header("set-cookie", login.transactionCookie)
        .redirect(login.authorizationUrl);
    });
    app.get<{
      Querystring: { code?: string; state?: string; error?: string };
    }>("/v1/auth/callback", async (request, reply) => {
      if (request.query.error) {
        throw new BridgeError("UNAUTHENTICATED", "The identity provider did not complete sign-in.", 401);
      }
      const callback = await options.authenticator!.completeWebLogin({
        ...(request.query.code ? { code: request.query.code } : {}),
        ...(request.query.state ? { state: request.query.state } : {}),
        ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
      });
      await options.service.recordAuthenticationEvent(callback.principal, "authentication.succeeded");
      return reply
        .header("set-cookie", [callback.sessionCookie, callback.clearTransactionCookie])
        .redirect(callback.redirectUrl);
    });
    app.get<{ Querystring: { returnTo?: string } }>("/v1/auth/logout", async (request, reply) => {
      const principal = await resolveOptionalWebPrincipal(request, options);
      const logout = options.authenticator!.endWebSession(request.query.returnTo);
      if (principal) await options.service.recordAuthenticationEvent(principal, "authentication.logged_out");
      return reply
        .header("set-cookie", logout.clearSessionCookie)
        .redirect(logout.redirectUrl);
    });
  }

  app.get("/v1/auth/me", async (request) => {
    const principal = await resolvePrincipal(request, options);
    return {
      id: principal.id,
      type: principal.type,
      displayName: principal.displayName,
      organizationId: principal.organizationId,
      roles: principal.roles,
      projectRoles: principal.projectRoles ?? {},
      projectIds: principal.projectIds,
      allProjects: principal.allProjects ?? false,
      scopes: principal.scopes ?? [],
    };
  });

  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/v1/notifications",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const query = notificationListQuerySchema.parse({
        projectId: request.query.projectId,
        unreadOnly: request.query.unreadOnly === "true",
      });
      const items = await options.service.listNotifications(principal, query);
      return { items, unreadCount: items.filter((notification) => !notification.readAt).length };
    },
  );

  app.get("/v1/notifications/preferences", async (request) => {
    const principal = await resolvePrincipal(request, options);
    const items = await options.service.listNotificationPreferences(principal);
    return { items };
  });

  app.post<{ Body: unknown }>(
    "/v1/notifications/preferences",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = notificationPreferenceInputSchema.parse(request.body ?? {});
      return options.service.setNotificationPreference(principal, input);
    },
  );

  app.post<{ Params: { notificationId: string } }>(
    "/v1/notifications/:notificationId/read",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      return options.service.markNotificationRead(principal, request.params.notificationId);
    },
  );

  app.post<{ Body: unknown }>(
    "/v1/notifications/read-all",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = notificationReadAllInputSchema.parse(request.body ?? {});
      return options.service.markAllNotificationsRead(principal, input);
    },
  );

  app.get<{
    Params: { projectId: string };
    Querystring: Record<string, string | undefined>;
  }>("/v1/admin/projects/:projectId/outbox", async (request) => {
    const principal = await resolvePrincipal(request, options);
    const query = outboxOperationsQuerySchema.parse(request.query);
    return options.service.inspectProjectOutbox(principal, request.params.projectId, query);
  });

  app.get<{
    Params: { projectId: string };
    Querystring: Record<string, string | undefined>;
  }>("/v1/admin/projects/:projectId/analytics", async (request) => {
    const principal = await resolvePrincipal(request, options);
    const query = projectAnalyticsQuerySchema.parse(request.query);
    return options.service.getProjectAnalytics(principal, request.params.projectId, query);
  });

  app.get<{ Params: { projectId: string } }>(
    "/v1/admin/projects/:projectId/support",
    async (request): Promise<ProjectSupportView> => {
      const principal = await resolvePrincipal(request, options);
      return options.service.getProjectSupport(principal, request.params.projectId);
    },
  );

  app.get<{
    Params: { projectId: string };
    Querystring: Record<string, string | undefined>;
  }>("/v1/admin/projects/:projectId/audit", async (request) => {
    const principal = await resolvePrincipal(request, options);
    const query = auditListQuerySchema.parse(request.query);
    return options.service.listProjectAudit(principal, request.params.projectId, query);
  });

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/admin/projects/:projectId/audit/export",
    async (request, reply) => {
      const principal = await resolvePrincipal(request, options);
      const input = auditExportInputSchema.parse(request.body ?? {});
      const result = await options.service.exportProjectAudit(principal, request.params.projectId, input);
      return reply
        .header("content-disposition", `attachment; filename="${result.filename}"`)
        .type(result.contentType)
        .send(result.body);
    },
  );

  app.post<{ Params: { eventId: string }; Body: unknown }>(
    "/v1/admin/outbox/:eventId/replay",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = replayOutboxEventInputSchema.parse(request.body);
      return options.service.replayOutboxEvent(principal, request.params.eventId, input);
    },
  );

  app.get("/v1/principals", async (request) => {
    const principal = await resolvePrincipal(request, options);
    return {
      items: (await options.service.listOrganizationPrincipals(principal))
        .map((candidate) => ({
          id: candidate.id,
          displayName: candidate.displayName,
          roles: candidate.roles,
          projectRoles: candidate.projectRoles ?? {},
        })),
    };
  });

  app.get("/v1/admin/organization/members", async (request) => {
    const principal = await resolvePrincipal(request, options);
    const [items, projects] = await Promise.all([
      options.service.listOrganizationMembers(principal),
      options.service.listOrganizationProjectsForAdministration(principal),
    ]);
    return { items, projects };
  });

  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/v1/admin/organization/audit",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      return options.service.listOrganizationAudit(principal, auditListQuerySchema.parse(request.query));
    },
  );

  app.post<{ Body: unknown }>("/v1/admin/organization/audit/export", async (request, reply) => {
    const principal = await resolvePrincipal(request, options);
    const result = await options.service.exportOrganizationAudit(
      principal,
      auditExportInputSchema.parse(request.body ?? {}),
    );
    return reply
      .header("content-disposition", `attachment; filename="${result.filename}"`)
      .type(result.contentType)
      .send(result.body);
  });

  app.post<{ Body: unknown }>("/v1/admin/organization/members", async (request, reply) => {
    const principal = await resolvePrincipal(request, options);
    const input = createOrganizationMemberInputSchema.parse(request.body);
    const registration = await options.service.createOrganizationMember(principal, input);
    return reply
      .status(registration.disposition === "created" ? 201 : 200)
      .send(registration);
  });

  app.patch<{ Params: { memberId: string }; Body: unknown }>(
    "/v1/admin/organization/members/:memberId",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = updateOrganizationMemberInputSchema.parse(request.body);
      return options.service.updateOrganizationMember(principal, request.params.memberId, input);
    },
  );

  app.get("/v1/admin/organization/service-identities", async (request) => {
    const principal = await resolvePrincipal(request, options);
    return { items: await options.service.listServiceIdentities(principal) };
  });

  app.post<{ Body: unknown }>("/v1/admin/organization/service-identities", async (request, reply) => {
    const principal = await resolvePrincipal(request, options);
    const input = createServiceIdentityInputSchema.parse(request.body);
    const registration = await options.service.createServiceIdentity(principal, input);
    return reply.status(201).send(registration);
  });

  app.post<{
    Params: { serviceCredentialId: string };
    Body: unknown;
  }>("/v1/admin/organization/service-identities/:serviceCredentialId/revoke", async (request) => {
    const principal = await resolvePrincipal(request, options);
    const input = revokeServiceIdentityInputSchema.parse(request.body);
    return options.service.revokeServiceIdentity(principal, request.params.serviceCredentialId, input);
  });

  app.post<{
    Params: { serviceCredentialId: string };
    Body: unknown;
  }>("/v1/admin/organization/service-identities/:serviceCredentialId/rotate", async (request) => {
    const principal = await resolvePrincipal(request, options);
    const input = rotateServiceIdentityInputSchema.parse(request.body);
    return options.service.rotateServiceIdentity(principal, request.params.serviceCredentialId, input);
  });

  app.post<{ Body: unknown }>("/v1/projects", async (request, reply) => {
    const principal = await resolvePrincipal(request, options);
    const input = registerProjectInputSchema.parse(request.body);
    const registration = await options.service.registerProject(principal, input);
    return reply
      .status(registration.disposition === "created" ? 201 : 200)
      .send(registration);
  });

  app.get("/v1/projects", async (request) => {
    const principal = await resolvePrincipal(request, options);
    return { items: await options.service.listProjects(principal) };
  });

  app.get<{ Params: { projectId: string } }>("/v1/projects/:projectId", async (request) => {
    const principal = await resolvePrincipal(request, options);
    return options.service.getProject(principal, request.params.projectId);
  });

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/projects/:projectId/repositories",
    async (request, reply) => {
      const principal = await resolvePrincipal(request, options);
      const input = linkRepositoryInputSchema.parse(request.body);
      const registration = await options.service.linkRepository(principal, request.params.projectId, input);
      return reply
        .status(registration.disposition === "created" ? 201 : 200)
        .send(registration);
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/repositories",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      return { items: await options.service.listProjectRepositories(principal, request.params.projectId) };
    },
  );

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/projects/:projectId/integrations/github/pull-requests",
    async (request, reply) => {
      const principal = await resolvePrincipal(request, options);
      const input = syncGithubPullRequestInputSchema.parse(request.body);
      const registration = await options.service.syncGithubPullRequest(
        principal,
        request.params.projectId,
        input,
      );
      return reply
        .status(registration.disposition === "created" ? 201 : 200)
        .send(registration);
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: unknown }>(
    "/v1/projects/:projectId/integrations/github/pull-requests",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const query = githubPullRequestListQuerySchema.parse(request.query);
      return {
        items: await options.service.listGithubPullRequests(
          principal,
          request.params.projectId,
          query,
        ),
      };
    },
  );

  app.get<{
    Params: { projectId: string; pullRequestNumber: string };
    Querystring: unknown;
  }>(
    "/v1/projects/:projectId/integrations/github/pull-requests/:pullRequestNumber/context",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const pullRequestNumber = Number(request.params.pullRequestNumber);
      if (
        !Number.isInteger(pullRequestNumber) ||
        pullRequestNumber < 1 ||
        pullRequestNumber > 2_147_483_647
      ) {
        throw new BridgeError("VALIDATION_FAILED", "Pull-request number must be a positive integer.", 400);
      }
      const query = githubPullRequestContextQuerySchema.parse(request.query);
      return options.service.getGithubPullRequestContext(
        principal,
        request.params.projectId,
        pullRequestNumber,
        query,
      );
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/admin/projects/:projectId/ownership",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      return options.service.getProjectOwnershipConfiguration(principal, request.params.projectId);
    },
  );

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/admin/projects/:projectId/ownership",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = replaceProjectOwnershipInputSchema.parse(request.body);
      return options.service.replaceProjectOwnershipConfiguration(
        principal,
        request.params.projectId,
        input,
      );
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/admin/projects/:projectId/policy",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      return options.service.getProjectPolicyConfiguration(principal, request.params.projectId);
    },
  );

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/admin/projects/:projectId/policy",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = replaceProjectPolicyInputSchema.parse(request.body);
      return options.service.replaceProjectPolicyConfiguration(
        principal,
        request.params.projectId,
        input,
      );
    },
  );

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/projects/:projectId/adapter-diagnostics",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = recordAdapterDiagnosticInputSchema.parse(request.body);
      return options.service.recordAdapterDiagnostic(principal, request.params.projectId, input);
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/projects/:projectId/context",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
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
      const principal = await resolvePrincipal(request, options);
      const input = startAgentRunInputSchema.parse(request.body);
      const registration = await options.service.startRun(principal, request.params.projectId, input);
      return reply.status(201).send(registration);
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/runs",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      return { items: await options.service.listRuns(principal, request.params.projectId) };
    },
  );

  app.get<{ Params: { runId: string } }>("/v1/runs/:runId", async (request) => {
    const principal = await resolvePrincipal(request, options);
    return options.service.getRun(principal, request.params.runId);
  });

  app.patch<{ Params: { runId: string }; Body: unknown }>(
    "/v1/runs/:runId",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = reportAgentRunInputSchema.parse(request.body);
      return options.service.reportRun(principal, request.params.runId, input);
    },
  );

  app.post<{ Params: { runId: string }; Body: unknown }>(
    "/v1/runs/:runId/continuation",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
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
      const principal = await resolvePrincipal(request, options);
      const input = changeDecisionLifecycleInputSchema.parse(request.body);
      return options.service.changeDecisionLifecycle(principal, request.params.decisionId, input);
    },
  );

  app.get<{ Params: { decisionId: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/decisions/:decisionId/impact",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const query = decisionImpactQuerySchema.parse({
        maxDepth: request.query.maxDepth,
        maxNodes: request.query.maxNodes,
      });
      return options.service.analyzeDecisionImpact(principal, request.params.decisionId, query);
    },
  );

  for (const status of ["superseded", "expired", "revoked"] as const) {
    const action = status === "superseded" ? "supersede" : status === "expired" ? "expire" : "revoke";
    app.post<{ Params: { decisionId: string }; Body: unknown }>(
      `/v1/decisions/:decisionId/${action}`,
      async (request) => {
        const principal = await resolvePrincipal(request, options);
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
      const principal = await resolvePrincipal(request, options);
      const input = createQuestionInputSchema.parse(request.body);
      const question = await options.service.createQuestion(principal, request.params.projectId, input);
      const created = question.submissionDisposition === "created";
      return reply.status(created ? 201 : 200).send(question);
    },
  );

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/projects/:projectId/questions/matches",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
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
      const principal = await resolvePrincipal(request, options);
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
      const principal = await resolvePrincipal(request, options);
      return { items: await options.service.listAssumptions(principal, request.params.projectId) };
    },
  );

  app.get<{ Params: { assumptionId: string } }>(
    "/v1/assumptions/:assumptionId",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      return options.service.getAssumption(principal, request.params.assumptionId);
    },
  );

  app.post<{ Params: { assumptionId: string }; Body: unknown }>(
    "/v1/assumptions/:assumptionId/resolve",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = resolveAssumptionInputSchema.parse(request.body);
      return options.service.resolveAssumption(principal, request.params.assumptionId, input);
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/questions",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      return { items: await options.service.listQuestions(principal, request.params.projectId) };
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/projects/:projectId/inbox",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const filters = questionInboxQuerySchema.parse({
        status: request.query.status,
        risk: request.query.risk,
        category: request.query.category,
        role: request.query.role,
        due: request.query.due,
      });
      return {
        items: await options.service.listQuestionInbox(principal, request.params.projectId, filters),
      };
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/projects/:projectId/question-digests",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const query = questionDecisionDigestQuerySchema.parse({
        category: request.query.category,
        maxDigests: request.query.maxDigests,
        maxQuestionsPerDigest: request.query.maxQuestionsPerDigest,
      });
      return {
        items: await options.service.listQuestionDecisionDigests(
          principal,
          request.params.projectId,
          query,
        ),
      };
    },
  );

  app.get<{ Params: { questionId: string } }>("/v1/questions/:questionId", async (request) => {
    const principal = await resolvePrincipal(request, options);
    return options.service.getQuestion(principal, request.params.questionId);
  });

  app.get<{
    Params: { questionId: string };
    Querystring: Record<string, string | undefined>;
  }>("/v1/questions/:questionId/audience-view", async (request) => {
    const principal = await resolvePrincipal(request, options);
    const query = questionAudienceViewQuerySchema.parse({
      role: request.query.role,
      mode: request.query.mode,
    });
    return options.service.getQuestionAudienceView(principal, request.params.questionId, query);
  });

  app.post<{ Params: { questionId: string }; Body: unknown }>(
    "/v1/questions/:questionId/responses",
    async (request, reply) => {
      const principal = await resolvePrincipal(request, options);
      const input = proposeAnswerInputSchema.parse(request.body);
      const response = await options.service.proposeAnswer(principal, request.params.questionId, input);
      return reply.status(201).send(response);
    },
  );

  app.patch<{ Params: { questionId: string; responseId: string }; Body: unknown }>(
    "/v1/questions/:questionId/responses/:responseId",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = editQuestionResponseInputSchema.parse(request.body);
      return options.service.editQuestionResponse(
        principal,
        request.params.questionId,
        request.params.responseId,
        input,
      );
    },
  );

  app.post<{ Params: { questionId: string }; Body: unknown }>(
    "/v1/questions/:questionId/reviews",
    async (request, reply) => {
      const principal = await resolvePrincipal(request, options);
      const input = questionReviewInputSchema.parse(request.body);
      const review = await options.service.reviewQuestion(principal, request.params.questionId, input);
      return reply.status(201).send(review);
    },
  );

  app.post<{ Params: { questionId: string }; Body: unknown }>(
    "/v1/questions/:questionId/assignments",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = reassignQuestionInputSchema.parse(request.body);
      return options.service.reassignQuestion(principal, request.params.questionId, input);
    },
  );

  app.post<{ Params: { questionId: string }; Body: unknown }>(
    "/v1/questions/:questionId/comments",
    async (request, reply) => {
      const principal = await resolvePrincipal(request, options);
      const input = questionCommentInputSchema.parse(request.body);
      const comment = await options.service.addQuestionComment(principal, request.params.questionId, input);
      return reply.status(201).send(comment);
    },
  );

  app.patch<{ Params: { questionId: string; commentId: string }; Body: unknown }>(
    "/v1/questions/:questionId/comments/:commentId",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = editQuestionCommentInputSchema.parse(request.body);
      return options.service.editQuestionComment(
        principal,
        request.params.questionId,
        request.params.commentId,
        input,
      );
    },
  );

  app.post<{ Params: { questionId: string }; Body: unknown }>(
    "/v1/questions/:questionId/clarification",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = questionClarificationInputSchema.parse(request.body);
      return options.service.requestQuestionClarification(principal, request.params.questionId, input);
    },
  );

  app.post<{ Params: { questionId: string }; Body: unknown }>(
    "/v1/questions/:questionId/reopen",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const input = questionClarificationInputSchema.parse(request.body);
      return options.service.reopenQuestion(principal, request.params.questionId, input);
    },
  );

  app.post<{ Params: { questionId: string }; Body: unknown }>(
    "/v1/questions/:questionId/accept",
    async (request, reply) => {
      const principal = await resolvePrincipal(request, options);
      const input = acceptAnswerInputSchema.parse(request.body);
      const decision = await options.service.acceptAnswer(principal, request.params.questionId, input);
      return reply.status(201).send(decision);
    },
  );

  app.post<{ Params: { questionId: string }; Body: unknown }>(
    "/v1/questions/:questionId/override",
    async (request, reply) => {
      const principal = await resolvePrincipal(request, options);
      const input = overrideQuestionApprovalInputSchema.parse(request.body);
      const decision = await options.service.overrideQuestionApproval(principal, request.params.questionId, input);
      return reply.status(201).send(decision);
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/projects/:projectId/decisions",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
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

  app.get<{ Params: { projectId: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/projects/:projectId/decision-conflicts",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const query = decisionConflictQuerySchema.parse({
        category: request.query.category,
        scope: {
          ...(request.query.repository ? { repository: request.query.repository } : {}),
          ...(request.query.component ? { component: request.query.component } : {}),
          ...(request.query.branch ? { branch: request.query.branch } : {}),
          ...(request.query.environment ? { environment: request.query.environment } : {}),
          ...(request.query.workItem ? { workItem: request.query.workItem } : {}),
        },
        maxItems: request.query.maxItems,
      });
      return {
        items: await options.service.listDecisionConflicts(principal, request.params.projectId, query),
      };
    },
  );

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/v1/projects/:projectId/artifacts",
    async (request, reply) => {
      const principal = await resolvePrincipal(request, options);
      const input = publishArtifactInputSchema.parse(request.body);
      const publication = await options.service.publishArtifact(principal, request.params.projectId, input);
      return reply.status(201).send(publication);
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/artifacts",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      return { items: await options.service.listArtifacts(principal, request.params.projectId) };
    },
  );

  app.get<{ Params: { artifactId: string } }>("/v1/artifacts/:artifactId", async (request) => {
    const principal = await resolvePrincipal(request, options);
    return options.service.getArtifact(principal, request.params.artifactId);
  });

  app.get<{ Params: { artifactId: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/artifacts/:artifactId/diff",
    async (request) => {
      const principal = await resolvePrincipal(request, options);
      const query = artifactVersionDiffQuerySchema.parse(request.query);
      return options.service.diffArtifactVersions(principal, request.params.artifactId, query);
    },
  );

  app.post<{ Params: { versionId: string }; Body: unknown }>(
    "/v1/artifact-versions/:versionId/reviews",
    async (request, reply) => {
      const principal = await resolvePrincipal(request, options);
      const input = artifactReviewInputSchema.parse(request.body);
      const result = await options.service.reviewArtifactVersion(principal, request.params.versionId, input);
      return reply.status(201).send(result);
    },
  );

  app.post<{ Params: { versionId: string }; Body: unknown }>(
    "/v1/artifact-versions/:versionId/approve",
    async (request, reply) => {
      const principal = await resolvePrincipal(request, options);
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
