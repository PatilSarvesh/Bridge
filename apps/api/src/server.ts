import { createPostgresBridgeStore } from "@bridge/database";
import { createDemoRuntime, createDemoRuntimeWithRepository } from "@bridge/test-support";

import { buildApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
const publicWebUrl = process.env.BRIDGE_PUBLIC_WEB_URL ?? "http://127.0.0.1:3000";
const postgresStore = databaseUrl ? createPostgresBridgeStore(databaseUrl) : undefined;
const runtime = postgresStore
  ? await createDemoRuntimeWithRepository(postgresStore.repository, {
      seedQuestion: true,
      seedArtifact: true,
      serviceOptions: { publicBaseUrl: publicWebUrl },
    })
  : await createDemoRuntime({
      seedQuestion: true,
      seedArtifact: true,
      serviceOptions: { publicBaseUrl: publicWebUrl },
    });
const app = await buildApp({ service: runtime.service, principals: runtime.principals, logger: true });

if (postgresStore) {
  app.addHook("onClose", async () => postgresStore.close());
}

const port = Number(process.env.BRIDGE_API_PORT ?? 4000);
const host = process.env.BRIDGE_API_HOST ?? "127.0.0.1";
await app.listen({ host, port });
