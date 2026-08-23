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

describe("project repository row security migration", () => {
  it("forces tenant isolation for repository records", async () => {
    const migration = await readFile(
      new URL("../drizzle/0025_calm_vengeance.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain('ALTER TABLE "bridge_project_repositories" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "bridge_project_repositories" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY "bridge_project_repositories_tenant" ON "bridge_project_repositories"');
    expect(migration).toContain("bridge_project_repositories_organization_project_fk");
  });
});

describe("project ownership row security migration", () => {
  it("forces tenant isolation for project ownership configuration", async () => {
    const migration = await readFile(
      new URL("../drizzle/0026_thin_sheva_callister.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain('ALTER TABLE "bridge_project_ownership_configurations" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "bridge_project_ownership_configurations" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY "bridge_project_ownership_configurations_tenant" ON "bridge_project_ownership_configurations"');
    expect(migration).toContain("bridge_project_ownership_configurations_project_fk");
  });
});

describe("project policy row security migration", () => {
  it("forces tenant isolation for project policy configuration", async () => {
    const migration = await readFile(
      new URL("../drizzle/0027_vengeful_lady_ursula.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain('ALTER TABLE "bridge_project_policy_configurations" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "bridge_project_policy_configurations" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY "bridge_project_policy_configurations_tenant" ON "bridge_project_policy_configurations"');
    expect(migration).toContain("bridge_project_policy_configurations_project_fk");
  });
});

describe("notification preference row security migrations", () => {
  it("enables a tenant policy and forces isolation for preference records", async () => {
    const createMigration = await readFile(
      new URL("../drizzle/0037_aberrant_ezekiel.sql", import.meta.url),
      "utf8",
    );
    const forceMigration = await readFile(
      new URL("../drizzle/0041_force_notification_preferences_rls.sql", import.meta.url),
      "utf8",
    );

    expect(createMigration).toContain(
      'ALTER TABLE "bridge_notification_preferences" ENABLE ROW LEVEL SECURITY',
    );
    expect(createMigration).toContain(
      'CREATE POLICY "bridge_notification_preferences_tenant" ON "bridge_notification_preferences"',
    );
    expect(forceMigration).toContain(
      'ALTER TABLE "bridge_notification_preferences" FORCE ROW LEVEL SECURITY',
    );
  });
});

describe("GitHub pull-request context row security migration", () => {
  it("forces tenant isolation for pull-request metadata", async () => {
    const migration = await readFile(
      new URL("../drizzle/0042_even_wallop.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(
      'ALTER TABLE "bridge_github_pull_requests" ENABLE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'ALTER TABLE "bridge_github_pull_requests" FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'CREATE POLICY "bridge_github_pull_requests_tenant" ON "bridge_github_pull_requests"',
    );
    expect(migration).toContain("bridge_github_pull_requests_organization_project_fk");
  });
});

describe("GitHub issue work-item row security migration", () => {
  it("forces tenant isolation for issue metadata", async () => {
    const migration = await readFile(
      new URL("../drizzle/0043_misty_dragon_man.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain('ALTER TABLE "bridge_github_issues" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "bridge_github_issues" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'CREATE POLICY "bridge_github_issues_tenant" ON "bridge_github_issues"',
    );
    expect(migration).toContain("bridge_github_issues_organization_project_fk");
  });
});
