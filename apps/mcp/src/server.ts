import { createPostgresBridgeStore } from "@bridge/database";
import { OidcAccessTokenVerifier } from "@bridge/auth";
import {
  BridgeMetrics,
  correlationIdHeader,
  createSafeLogger,
  resolveCorrelationId,
  runWithCorrelationContext,
} from "@bridge/observability";
import { createDemoRuntimeWithRepository, demoPrincipals } from "@bridge/test-support";
import type { Principal } from "@bridge/domain";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Request, Response } from "express";

import { resolveMcpPrincipal, sendMcpAuthenticationError } from "./auth.js";
import { createBridgeMcpServer } from "./bridge-server.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required by the standalone Bridge MCP server so MCP and the API share canonical state. Use the CLI-only adapter when PostgreSQL is unavailable.",
  );
}
const publicWebUrl = process.env.BRIDGE_PUBLIC_WEB_URL ?? "http://127.0.0.1:3000";
const host = process.env.BRIDGE_MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.BRIDGE_MCP_PORT ?? 4100);
const publicMcpUrl = process.env.BRIDGE_PUBLIC_MCP_URL ?? `http://${host}:${port}`;
const configuredOidcIssuer = process.env.BRIDGE_OIDC_ISSUER?.trim();
const configuredMcpAudience = process.env.BRIDGE_MCP_OIDC_AUDIENCE?.trim();
const oidcEnabled = Boolean(configuredOidcIssuer);
if (process.env.NODE_ENV === "production" && !oidcEnabled) {
  throw new Error("BRIDGE_OIDC_ISSUER is required by the standalone MCP server in production.");
}
if (oidcEnabled && !configuredMcpAudience) {
  throw new Error("BRIDGE_MCP_OIDC_AUDIENCE is required when MCP OIDC authentication is enabled.");
}
const metrics = new BridgeMetrics();
const postgresStore = createPostgresBridgeStore(databaseUrl, { metrics });
const runtime = await createDemoRuntimeWithRepository(postgresStore.repository, {
  seedFixtures: !oidcEnabled,
  seedQuestion: !oidcEnabled,
  seedArtifact: !oidcEnabled,
  serviceOptions: {
    publicBaseUrl: publicWebUrl,
    ...(configuredOidcIssuer ? { identityIssuer: configuredOidcIssuer } : {}),
    metrics,
  },
});
const principalId = process.env.BRIDGE_MCP_PRINCIPAL_ID ?? demoPrincipals.agent.id;
const developmentPrincipal = runtime.principals[principalId];
if (!oidcEnabled && !developmentPrincipal) {
  await postgresStore.close();
  throw new Error(`Unknown BRIDGE_MCP_PRINCIPAL_ID: ${principalId}`);
}
const verifier = configuredOidcIssuer && configuredMcpAudience
  ? new OidcAccessTokenVerifier(
      {
        issuer: configuredOidcIssuer,
        audience: configuredMcpAudience,
        organizationClaim: process.env.BRIDGE_OIDC_ORGANIZATION_CLAIM ?? "org_id",
        ...(process.env.BRIDGE_OIDC_JWKS_URI ? { jwksUri: process.env.BRIDGE_OIDC_JWKS_URI } : {}),
      },
      runtime.repository,
    )
  : undefined;
const app = createMcpExpressApp({ host });
const logger = createSafeLogger({ service: "bridge-mcp" });
const protectedResourceMetadataUrl = oidcEnabled
  ? `${publicMcpUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource/mcp`
  : undefined;

app.use((request: Request, response: Response, next) => {
  const correlationId = resolveCorrelationId(request.header(correlationIdHeader));
  response.setHeader(correlationIdHeader, correlationId);
  runWithCorrelationContext({ correlationId, source: "mcp" }, () => {
    const startedAt = performance.now();
    response.on("finish", () => {
      const durationMs = Math.max(0, performance.now() - startedAt);
      const operation = ["/health", "/health/live", "/health/ready", "/metrics", "/mcp"]
        .includes(request.path) ? request.path : "unmatched";
      metrics.recordHttpRequest({
        service: "mcp",
        operation,
        statusCode: response.statusCode,
        durationMs,
      });
      logger.info("request.completed", {
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs,
      });
    });
    next();
  });
});

const sendLiveness = (_request: Request, response: Response) => {
  response.status(200).json({ status: "ok", service: "bridge-mcp" });
};
app.get("/health", sendLiveness);
app.get("/health/live", sendLiveness);
app.get("/metrics", (_request: Request, response: Response) => {
  response.type("text/plain; version=0.0.4; charset=utf-8").send(metrics.renderPrometheus());
});
if (configuredOidcIssuer && configuredMcpAudience) {
  const protectedResourceMetadata = {
    resource: `${publicMcpUrl.replace(/\/$/, "")}/mcp`,
    authorization_servers: [configuredOidcIssuer],
    scopes_supported: ["bridge:read", "bridge:write", "bridge:admin"],
    bearer_methods_supported: ["header"],
  };
  app.get("/.well-known/oauth-protected-resource/mcp", (_request: Request, response: Response) => {
    response.json(protectedResourceMetadata);
  });
  app.get("/.well-known/oauth-protected-resource", (_request: Request, response: Response) => {
    response.json(protectedResourceMetadata);
  });
}
app.get("/health/ready", async (_request: Request, response: Response) => {
  const readiness = await runtime.service.checkReadiness();
  response
    .status(readiness.status === "ready" ? 200 : 503)
    .json({ service: "bridge-mcp", ...readiness });
});

app.post("/mcp", async (request: Request, response: Response) => {
  let principal: Principal;
  try {
    principal = await resolveMcpPrincipal(request, {
      ...(verifier ? { verifier } : {}),
      ...(developmentPrincipal ? { developmentPrincipal } : {}),
      production: process.env.NODE_ENV === "production",
    });
  } catch (error) {
    logger.error("request.authentication_failed", {
      method: request.method,
      path: request.path,
      statusCode: error instanceof Error && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 401,
      error,
    });
    sendMcpAuthenticationError(response, error, protectedResourceMetadataUrl);
    return;
  }
  const server = createBridgeMcpServer(runtime.service, principal, { publicWebUrl });
  const transport = new StreamableHTTPServerTransport();
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    // SDK 1.30's Node transport is structurally compatible, but its optional
    // callback accessors conflict with exactOptionalPropertyTypes.
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    logger.error("request.failed", {
      method: request.method,
      path: request.path,
      statusCode: 500,
      error,
    });
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_request: Request, response: Response) => {
  response.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed" },
    id: null,
  });
});

app.delete("/mcp", (_request: Request, response: Response) => {
  response.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed" },
    id: null,
  });
});

const httpServer = app.listen(port, host, () => {
  logger.info("service.started", { path: "/mcp", status: "ready" });
});

let closing = false;
async function closeServer(): Promise<void> {
  if (closing) return;
  closing = true;
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => error ? reject(error) : resolve());
  });
  await postgresStore.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void closeServer().catch((error: unknown) => {
      logger.error("service.shutdown_failed", { error });
      process.exitCode = 1;
    });
  });
}
