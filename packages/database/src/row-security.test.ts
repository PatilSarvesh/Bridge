import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const protectedTables = [
  "bridge_agent_runs",
  "bridge_artifact_versions",
  "bridge_artifacts",
  "bridge_assumptions",
  "bridge_audit_events",
  "bridge_context_snapshots",
  "bridge_decisions",
  "bridge_idempotency_records",
  "bridge_notifications",
  "bridge_organization_audit_events",
  "bridge_organization_memberships",
  "bridge_outbox_deliveries",
  "bridge_outbox_events",
  "bridge_project_memberships",
  "bridge_projects",
  "bridge_question_responses",
  "bridge_questions",
  "bridge_run_continuation_locators",
] as const;

async function migrationSql(): Promise<string> {
  return readFile(
    new URL("../drizzle/0020_tenant_row_security.sql", import.meta.url),
    "utf8",
  );
}

describe("tenant row-security migration", () => {
  it("enables and forces a fail-closed tenant policy on every protected table", async () => {
    const migration = await migrationSql();

    for (const table of protectedTables) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`CREATE POLICY "${table}_tenant" ON "${table}"`);
    }

    expect(migration.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(protectedTables.length);
    expect(migration.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(protectedTables.length);
    expect(migration.match(/CREATE POLICY /g)).toHaveLength(protectedTables.length);
    expect(migration).toContain("current_setting('bridge.organization_id', true)");
    expect(migration).not.toContain("bridge.maintenance");
  });

  it("backfills idempotency tenant ownership before enforcing non-null scope", async () => {
    const migration = await migrationSql();
    const addColumn = migration.indexOf(
      'ADD COLUMN "organization_id" text',
    );
    const backfill = migration.indexOf(
      'UPDATE "bridge_idempotency_records" AS "record"',
    );
    const enforceNotNull = migration.indexOf(
      'ALTER COLUMN "organization_id" SET NOT NULL',
    );
    const discardOrphans = migration.indexOf(
      'DELETE FROM "bridge_idempotency_records" WHERE "organization_id" IS NULL',
    );
    const tenantPrimaryKey = migration.indexOf(
      'PRIMARY KEY("organization_id","key")',
    );

    expect(addColumn).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeGreaterThan(addColumn);
    expect(discardOrphans).toBeGreaterThan(backfill);
    expect(enforceNotNull).toBeGreaterThan(discardOrphans);
    expect(tenantPrimaryKey).toBeGreaterThan(enforceNotNull);
    expect(migration).not.toContain('"record"."kind"');
  });
});
