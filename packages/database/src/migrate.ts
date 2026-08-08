import { fileURLToPath, pathToFileURL } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function migrateDatabase(connectionString: string): Promise<void> {
  const client = postgres(connectionString, { max: 1, prepare: false });
  try {
    const database = drizzle(client);
    const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
    await migrate(database, { migrationsFolder });
  } finally {
    await client.end();
  }
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to run Bridge migrations.");
  await migrateDatabase(connectionString);
  console.log("Bridge database migrations completed.");
}
