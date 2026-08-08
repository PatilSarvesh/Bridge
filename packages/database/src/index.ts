import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { PostgresBridgeRepository } from "./repository.js";
import * as schema from "./schema.js";

export { PostgresBridgeRepository } from "./repository.js";
export { migrateDatabase } from "./migrate.js";
export * from "./schema.js";

export interface PostgresBridgeStore {
  readonly repository: PostgresBridgeRepository;
  close(): Promise<void>;
}

export function createPostgresBridgeStore(connectionString: string): PostgresBridgeStore {
  const client = postgres(connectionString, {
    max: 10,
    prepare: false,
    onnotice: () => undefined,
  });
  const database = drizzle(client, { schema });
  return {
    repository: new PostgresBridgeRepository(database),
    close: () => client.end(),
  };
}
