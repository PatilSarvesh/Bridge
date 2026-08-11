import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import postgres from "postgres";

export const restoreRequiredTables = [
  "bridge_organizations",
  "bridge_principal_identities",
  "bridge_service_credentials",
  "bridge_organization_memberships",
  "bridge_project_memberships",
  "bridge_projects",
  "bridge_agent_runs",
  "bridge_run_continuation_locators",
  "bridge_questions",
  "bridge_question_responses",
  "bridge_decisions",
  "bridge_assumptions",
  "bridge_artifacts",
  "bridge_artifact_versions",
  "bridge_context_snapshots",
  "bridge_audit_events",
  "bridge_organization_audit_events",
  "bridge_notifications",
  "bridge_outbox_events",
  "bridge_outbox_deliveries",
  "bridge_idempotency_records",
] as const;

export interface ArtifactContentRow {
  readonly id: string;
  readonly body: string;
  readonly contentSha256: string;
}

export interface RestoreVerificationReport {
  readonly passed: boolean;
  readonly migrationHistory: {
    readonly present: boolean;
    readonly appliedCount: number;
  };
  readonly missingTables: readonly string[];
  readonly rowCounts: Readonly<Record<string, number>>;
  readonly artifactContent: {
    readonly checkedCount: number;
    readonly hashMismatchIds: readonly string[];
  };
  readonly relationalIntegrity: {
    readonly tenantScopeMismatchCount: number;
    readonly artifactPointerMismatchCount: number;
  };
}

export function findArtifactHashMismatches(rows: readonly ArtifactContentRow[]): readonly string[] {
  return rows
    .filter((row) => createHash("sha256").update(row.body).digest("hex") !== row.contentSha256)
    .map((row) => row.id)
    .sort();
}

function databaseTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const protocol = url.protocol === "postgres:" ? "postgresql:" : url.protocol;
    const port = url.port || (url.protocol === "postgres:" || url.protocol === "postgresql:" ? "5432" : "");
    return `${protocol}//${url.hostname.toLowerCase()}:${port}${url.pathname}`;
  } catch {
    return connectionString.trim();
  }
}

export function isSameDatabaseTarget(left: string, right: string): boolean {
  return databaseTarget(left) === databaseTarget(right);
}

export async function verifyRestoredDatabase(
  connectionString: string,
): Promise<RestoreVerificationReport> {
  const client = postgres(connectionString, {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
  });
  try {
    const tableRows = await client<{ readonly tableName: string }[]>`
      select table_name as "tableName"
      from information_schema.tables
      where table_schema = 'public' and table_name like 'bridge_%'
    `;
    const presentTables = new Set(tableRows.map((row) => row.tableName));
    const missingTables = restoreRequiredTables.filter((table) => !presentTables.has(table));
    const [migrationTable] = await client<{
      readonly name: string | null;
    }[]>`
      select to_regclass('drizzle.__drizzle_migrations')::text as name
    `;
    const migrationHistory = migrationTable?.name
      ? {
          present: true,
          appliedCount: (await client<{ readonly count: number }[]>`
            select count(*)::integer as count from drizzle.__drizzle_migrations
          `)[0]?.count ?? 0,
        }
      : { present: false, appliedCount: 0 };

    if (missingTables.length > 0) {
      return {
        passed: false,
        migrationHistory,
        missingTables,
        rowCounts: {},
        artifactContent: { checkedCount: 0, hashMismatchIds: [] },
        relationalIntegrity: { tenantScopeMismatchCount: 0, artifactPointerMismatchCount: 0 },
      };
    }

    const countRows = await client<{ readonly tableName: string; readonly count: number }[]>`
      select 'bridge_organizations' as "tableName", count(*)::integer as count from bridge_organizations
      union all select 'bridge_principal_identities', count(*)::integer from bridge_principal_identities
      union all select 'bridge_service_credentials', count(*)::integer from bridge_service_credentials
      union all select 'bridge_organization_memberships', count(*)::integer from bridge_organization_memberships
      union all select 'bridge_project_memberships', count(*)::integer from bridge_project_memberships
      union all select 'bridge_projects', count(*)::integer from bridge_projects
      union all select 'bridge_agent_runs', count(*)::integer from bridge_agent_runs
      union all select 'bridge_questions', count(*)::integer from bridge_questions
      union all select 'bridge_decisions', count(*)::integer from bridge_decisions
      union all select 'bridge_assumptions', count(*)::integer from bridge_assumptions
      union all select 'bridge_artifacts', count(*)::integer from bridge_artifacts
      union all select 'bridge_artifact_versions', count(*)::integer from bridge_artifact_versions
      union all select 'bridge_audit_events', count(*)::integer from bridge_audit_events
      union all select 'bridge_organization_audit_events', count(*)::integer from bridge_organization_audit_events
      union all select 'bridge_notifications', count(*)::integer from bridge_notifications
      union all select 'bridge_outbox_events', count(*)::integer from bridge_outbox_events
      union all select 'bridge_outbox_deliveries', count(*)::integer from bridge_outbox_deliveries
    `;
    const rowCounts = Object.fromEntries(
      countRows.map((row) => [row.tableName, row.count]),
    );
    const artifactRows = await client<ArtifactContentRow[]>`
      select id, body, content_sha256 as "contentSha256"
      from bridge_artifact_versions
    `;
    const hashMismatchIds = findArtifactHashMismatches(artifactRows);
    const [integrity] = await client<{
      readonly tenantScopeMismatchCount: number;
      readonly artifactPointerMismatchCount: number;
    }[]>`
      select
        (
          (select count(*) from bridge_agent_runs record join bridge_projects project on project.id = record.project_id where record.organization_id <> project.organization_id) +
          (select count(*) from bridge_questions record join bridge_projects project on project.id = record.project_id where record.organization_id <> project.organization_id) +
          (select count(*) from bridge_decisions record join bridge_projects project on project.id = record.project_id where record.organization_id <> project.organization_id) +
          (select count(*) from bridge_assumptions record join bridge_projects project on project.id = record.project_id where record.organization_id <> project.organization_id) +
          (select count(*) from bridge_artifacts record join bridge_projects project on project.id = record.project_id where record.organization_id <> project.organization_id) +
          (select count(*) from bridge_context_snapshots record join bridge_projects project on project.id = record.project_id where record.organization_id <> project.organization_id) +
          (select count(*) from bridge_audit_events record join bridge_projects project on project.id = record.project_id where record.organization_id <> project.organization_id) +
          (select count(*) from bridge_notifications record join bridge_projects project on project.id = record.project_id where record.organization_id <> project.organization_id) +
          (select count(*) from bridge_outbox_events record join bridge_projects project on project.id = record.project_id where record.organization_id <> project.organization_id) +
          (select count(*) from bridge_project_memberships record join bridge_projects project on project.id = record.project_id where record.organization_id <> project.organization_id) +
          (select count(*) from bridge_outbox_deliveries delivery join bridge_outbox_events event on event.id = delivery.outbox_event_id where delivery.organization_id <> event.organization_id or delivery.project_id <> event.project_id)
        )::integer as "tenantScopeMismatchCount",
        (
          select count(*)::integer
          from bridge_artifacts artifact
          left join bridge_artifact_versions current_version
            on current_version.id = artifact.current_version_id
            and current_version.artifact_id = artifact.id
          left join bridge_artifact_versions approved_version
            on approved_version.id = artifact.approved_version_id
            and approved_version.artifact_id = artifact.id
          where current_version.id is null
            or (artifact.approved_version_id is not null and approved_version.id is null)
        ) as "artifactPointerMismatchCount"
    `;
    const relationalIntegrity = integrity ?? {
      tenantScopeMismatchCount: 1,
      artifactPointerMismatchCount: 1,
    };
    const passed = migrationHistory.present &&
      migrationHistory.appliedCount > 0 &&
      hashMismatchIds.length === 0 &&
      relationalIntegrity.tenantScopeMismatchCount === 0 &&
      relationalIntegrity.artifactPointerMismatchCount === 0;

    return {
      passed,
      migrationHistory,
      missingTables,
      rowCounts,
      artifactContent: { checkedCount: artifactRows.length, hashMismatchIds },
      relationalIntegrity,
    };
  } finally {
    await client.end();
  }
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  const connectionString = process.env.BRIDGE_RESTORE_DATABASE_URL;
  if (!connectionString) {
    console.error(
      "BRIDGE_RESTORE_DATABASE_URL is required and must point to an isolated restored database.",
    );
    process.exitCode = 1;
  } else if (
    process.env.DATABASE_URL &&
    isSameDatabaseTarget(connectionString, process.env.DATABASE_URL)
  ) {
    console.error(
      "BRIDGE_RESTORE_DATABASE_URL must not target the same database as DATABASE_URL.",
    );
    process.exitCode = 1;
  } else {
    try {
      const report = await verifyRestoredDatabase(connectionString);
      console.log(JSON.stringify(report, null, 2));
      if (!report.passed) process.exitCode = 1;
    } catch {
      console.error(
        "Restore verification could not complete. Check isolated-database connectivity and migration state.",
      );
      process.exitCode = 1;
    }
  }
}
