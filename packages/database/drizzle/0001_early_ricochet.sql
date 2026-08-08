CREATE TYPE "public"."bridge_agent_run_capability" AS ENUM('instructions', 'cli', 'mcp', 'hooks', 'orchestrated');--> statement-breakpoint
CREATE TYPE "public"."bridge_agent_run_client" AS ENUM('codex', 'claude_code', 'cursor', 'copilot', 'custom', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."bridge_agent_run_status" AS ENUM('running', 'waiting_for_human', 'completed', 'failed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."bridge_idempotency_kind" ADD VALUE 'run';--> statement-breakpoint
CREATE TABLE "bridge_agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_type" "bridge_principal_type" NOT NULL,
	"client" "bridge_agent_run_client" NOT NULL,
	"capability" "bridge_agent_run_capability" NOT NULL,
	"task_summary" text NOT NULL,
	"scope" jsonb NOT NULL,
	"status" "bridge_agent_run_status" NOT NULL,
	"context_snapshot_ids" jsonb NOT NULL,
	"question_ids" jsonb NOT NULL,
	"artifact_version_ids" jsonb NOT NULL,
	"external_links" jsonb NOT NULL,
	"result_links" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"summary" text,
	"continues_run_id" text,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridge_run_continuation_locators" (
	"run_id" text PRIMARY KEY NOT NULL,
	"resume_context_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_run_continuation_locators_resume_context_key_unique" UNIQUE("resume_context_key")
);
--> statement-breakpoint
ALTER TABLE "bridge_artifact_versions" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "bridge_context_snapshots" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD CONSTRAINT "bridge_agent_runs_project_id_bridge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."bridge_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_run_continuation_locators" ADD CONSTRAINT "bridge_run_continuation_locators_run_id_bridge_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bridge_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_agent_runs_project_started_idx" ON "bridge_agent_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "bridge_agent_runs_project_status_idx" ON "bridge_agent_runs" USING btree ("project_id","status");--> statement-breakpoint
ALTER TABLE "bridge_artifact_versions" ADD CONSTRAINT "bridge_artifact_versions_run_id_bridge_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bridge_agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_context_snapshots" ADD CONSTRAINT "bridge_context_snapshots_run_id_bridge_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bridge_agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
WITH "legacy_run_source" AS (
	SELECT DISTINCT ON ("run_id")
		"run_id",
		"organization_id",
		"project_id",
		"created_by_id",
		"created_by_type",
		"scope"
	FROM "bridge_questions"
	WHERE "run_id" IS NOT NULL
	ORDER BY "run_id", "created_at" ASC
)
INSERT INTO "bridge_agent_runs" (
	"id", "organization_id", "project_id", "agent_id", "agent_type", "client", "capability",
	"task_summary", "scope", "status", "context_snapshot_ids", "question_ids",
	"artifact_version_ids", "external_links", "result_links", "started_at", "updated_at", "version"
)
SELECT
	"source"."run_id",
	"source"."organization_id",
	"source"."project_id",
	"source"."created_by_id",
	CASE WHEN "source"."created_by_type" = 'human' THEN 'integration'::"bridge_principal_type" ELSE "source"."created_by_type" END,
	'unknown'::"bridge_agent_run_client",
	'instructions'::"bridge_agent_run_capability",
	'Imported legacy Bridge run ' || "source"."run_id",
	"source"."scope",
	CASE WHEN EXISTS (
		SELECT 1 FROM "bridge_questions" "pending"
		WHERE "pending"."run_id" = "source"."run_id"
			AND "pending"."organization_id" = "source"."organization_id"
			AND "pending"."project_id" = "source"."project_id"
			AND "pending"."blocking" = true
			AND "pending"."status" IN ('open', 'in_discussion')
	) THEN 'waiting_for_human'::"bridge_agent_run_status" ELSE 'running'::"bridge_agent_run_status" END,
	'[]'::jsonb,
	COALESCE((
		SELECT jsonb_agg("linked"."id" ORDER BY "linked"."created_at")
		FROM "bridge_questions" "linked"
		WHERE "linked"."run_id" = "source"."run_id"
			AND "linked"."organization_id" = "source"."organization_id"
			AND "linked"."project_id" = "source"."project_id"
	), '[]'::jsonb),
	'[]'::jsonb,
	'[]'::jsonb,
	'[]'::jsonb,
	(SELECT min("started"."created_at") FROM "bridge_questions" "started"
		WHERE "started"."run_id" = "source"."run_id"
			AND "started"."organization_id" = "source"."organization_id"
			AND "started"."project_id" = "source"."project_id"),
	(SELECT max("updated"."created_at") FROM "bridge_questions" "updated"
		WHERE "updated"."run_id" = "source"."run_id"
			AND "updated"."organization_id" = "source"."organization_id"
			AND "updated"."project_id" = "source"."project_id"),
	1
FROM "legacy_run_source" "source";--> statement-breakpoint
INSERT INTO "bridge_run_continuation_locators" ("run_id", "resume_context_key")
SELECT "id", 'legacy_' || md5("id" || ':' || "project_id") FROM "bridge_agent_runs"
ON CONFLICT ("run_id") DO NOTHING;--> statement-breakpoint
UPDATE "bridge_questions" "question"
SET "run_id" = NULL
WHERE "question"."run_id" IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM "bridge_agent_runs" "run"
		WHERE "run"."id" = "question"."run_id"
			AND "run"."organization_id" = "question"."organization_id"
			AND "run"."project_id" = "question"."project_id"
	);--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_run_id_bridge_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bridge_agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD CONSTRAINT "bridge_agent_runs_organization_project_id_unique" UNIQUE ("organization_id", "project_id", "id");--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD CONSTRAINT "bridge_agent_runs_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "bridge_projects" ("organization_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD CONSTRAINT "bridge_agent_runs_continues_run_fk" FOREIGN KEY ("organization_id", "project_id", "continues_run_id") REFERENCES "bridge_agent_runs" ("organization_id", "project_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_run_scope_fk" FOREIGN KEY ("organization_id", "project_id", "run_id") REFERENCES "bridge_agent_runs" ("organization_id", "project_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_context_snapshots" ADD CONSTRAINT "bridge_context_snapshots_run_scope_fk" FOREIGN KEY ("organization_id", "project_id", "run_id") REFERENCES "bridge_agent_runs" ("organization_id", "project_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD CONSTRAINT "bridge_agent_runs_agent_type_check" CHECK ("agent_type" <> 'human');--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD CONSTRAINT "bridge_agent_runs_positive_version_check" CHECK ("version" > 0);--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD CONSTRAINT "bridge_agent_runs_time_check" CHECK ("updated_at" >= "started_at" AND ("ended_at" IS NULL OR "ended_at" >= "started_at"));--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD CONSTRAINT "bridge_agent_runs_terminal_check" CHECK ((("status" = 'completed' OR "status" = 'failed' OR "status" = 'cancelled') AND "ended_at" IS NOT NULL) OR (("status" = 'running' OR "status" = 'waiting_for_human') AND "ended_at" IS NULL));--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD CONSTRAINT "bridge_agent_runs_summary_check" CHECK (("status" <> 'completed' AND "status" <> 'failed') OR "summary" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD CONSTRAINT "bridge_agent_runs_json_shape_check" CHECK (jsonb_typeof("scope") = 'object' AND jsonb_typeof("context_snapshot_ids") = 'array' AND jsonb_typeof("question_ids") = 'array' AND jsonb_typeof("artifact_version_ids") = 'array' AND jsonb_typeof("external_links") = 'array' AND jsonb_typeof("result_links") = 'array');--> statement-breakpoint
ALTER TABLE "bridge_audit_events" DROP CONSTRAINT "bridge_audit_events_subject_type_check";--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD CONSTRAINT "bridge_audit_events_subject_type_check" CHECK ("subject_type" IN ('question', 'response', 'decision', 'artifact', 'artifact_version', 'context_snapshot', 'run'));
