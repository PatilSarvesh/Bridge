import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://bridge:bridge@127.0.0.1:5432/bridge",
  },
  strict: true,
  verbose: true,
});
