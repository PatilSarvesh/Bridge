import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { BridgeMetrics } from "@bridge/observability";

import { PostgresBridgeRepository } from "./repository.js";
import * as schema from "./schema.js";

export { PostgresBridgeRepository } from "./repository.js";
export { migrateDatabase } from "./migrate.js";
export { verifyRestoredDatabase } from "./verify-restore.js";
export type { RestoreVerificationReport } from "./verify-restore.js";
export * from "./schema.js";

export interface PostgresBridgeStore {
  readonly repository: PostgresBridgeRepository;
  close(): Promise<void>;
}

export interface PostgresBridgeStoreOptions {
  readonly metrics?: BridgeMetrics;
}

export function createPostgresBridgeStore(
  connectionString: string,
  options: PostgresBridgeStoreOptions = {},
): PostgresBridgeStore {
  const client = postgres(connectionString, {
    max: 10,
    prepare: false,
    onnotice: () => undefined,
  });
  const database = drizzle(client, { schema });
  return {
    repository: new PostgresBridgeRepository(database, false, options.metrics),
    close: () => client.end(),
  };
}
