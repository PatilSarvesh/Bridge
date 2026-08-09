import { createPostgresBridgeStore } from "@bridge/database";
import { createDemoRuntimeWithRepository, demoPrincipals } from "@bridge/test-support";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Request, Response } from "express";

import { createBridgeMcpServer } from "./bridge-server.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required by the standalone Bridge MCP server so MCP and the API share canonical state. Use the CLI-only adapter when PostgreSQL is unavailable.",
  );
}
const publicWebUrl = process.env.BRIDGE_PUBLIC_WEB_URL ?? "http://127.0.0.1:3000";
const postgresStore = createPostgresBridgeStore(databaseUrl);
const runtime = await createDemoRuntimeWithRepository(postgresStore.repository, {
  seedQuestion: true,
  seedArtifact: true,
  serviceOptions: { publicBaseUrl: publicWebUrl },
});
const principalId = process.env.BRIDGE_MCP_PRINCIPAL_ID ?? demoPrincipals.agent.id;
const principal = runtime.principals[principalId];
if (!principal) {
  await postgresStore.close();
  throw new Error(`Unknown BRIDGE_MCP_PRINCIPAL_ID: ${principalId}`);
}
const host = process.env.BRIDGE_MCP_HOST ?? "127.0.0.1";
const app = createMcpExpressApp({ host });

const sendLiveness = (_request: Request, response: Response) => {
  response.status(200).json({ status: "ok", service: "bridge-mcp" });
};
app.get("/health", sendLiveness);
app.get("/health/live", sendLiveness);
app.get("/health/ready", async (_request: Request, response: Response) => {
  const readiness = await runtime.service.checkReadiness();
  response
    .status(readiness.status === "ready" ? 200 : 503)
    .json({ service: "bridge-mcp", ...readiness });
});

app.post("/mcp", async (request: Request, response: Response) => {
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
    console.error("Bridge MCP request failed", error);
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

const port = Number(process.env.BRIDGE_MCP_PORT ?? 4100);
const httpServer = app.listen(port, host, () => {
  console.log(`Bridge MCP listening on http://${host}:${port}/mcp`);
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
      console.error("Bridge MCP shutdown failed", error);
      process.exitCode = 1;
    });
  });
}
