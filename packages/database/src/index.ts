import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { BridgeMetrics } from "@bridge/observability";

import { PostgresBridgeRepository } from "./repository.js";
import * as schema from "./schema.js";
import { PostgresTransactionAdmission } from "./transaction-admission.js";

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
  readonly mode?: "application" | "maintenance";
  readonly maxConnections?: number;
}

export function createPostgresBridgeStore(
  connectionString: string,
  options: PostgresBridgeStoreOptions = {},
): PostgresBridgeStore {
  const maxConnections = options.maxConnections ?? 10;
  if (!Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 100) {
    throw new Error("PostgreSQL max connections must be an integer from 1 to 100.");
  }
  const mode = options.mode ?? "application";
  const client = postgres(connectionString, {
    max: maxConnections,
    prepare: false,
    onnotice: () => undefined,
  });
  const database = drizzle(client, { schema });
  const transactionAdmission = new PostgresTransactionAdmission(maxConnections, mode, options.metrics);
  return {
    repository: new PostgresBridgeRepository(
      database,
      false,
      options.metrics,
      undefined,
      mode === "maintenance",
      transactionAdmission,
    ),
    close: () => client.end(),
  };
}
