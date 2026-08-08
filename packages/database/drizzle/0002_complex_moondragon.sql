CREATE TYPE "public"."bridge_assumption_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."bridge_assumption_status" AS ENUM('active', 'confirmed', 'rejected', 'expired', 'superseded');--> statement-breakpoint
ALTER TYPE "public"."bridge_idempotency_kind" ADD VALUE 'assumption';--> statement-breakpoint
CREATE TABLE "bridge_assumptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"run_id" text,
	"statement" text NOT NULL,
	"rationale" text NOT NULL,
	"category" text NOT NULL,
	"risk" "bridge_risk" NOT NULL,
	"confidence" "bridge_assumption_confidence" NOT NULL,
	"reversible" boolean NOT NULL,
	"reversal_cost" text NOT NULL,
	"scope" jsonb NOT NULL,
	"source_links" jsonb NOT NULL,
	"status" "bridge_assumption_status" NOT NULL,
	"created_by_id" text NOT NULL,
	"created_by_type" "bridge_principal_type" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_by_id" text,
	"resolved_at" timestamp with time zone,
	"resolution_rationale" text,
	"confirmed_decision_id" text,
	"superseding_assumption_id" text,
	"version" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD COLUMN "assumption_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_project_id_bridge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."bridge_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_run_id_bridge_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bridge_agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_confirmed_decision_id_bridge_decisions_id_fk" FOREIGN KEY ("confirmed_decision_id") REFERENCES "public"."bridge_decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_superseding_assumption_id_bridge_assumptions_id_fk" FOREIGN KEY ("superseding_assumption_id") REFERENCES "public"."bridge_assumptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_assumptions_project_created_idx" ON "bridge_assumptions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "bridge_assumptions_project_status_expiry_idx" ON "bridge_assumptions" USING btree ("project_id","status","expires_at");--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_organization_project_id_unique" UNIQUE ("organization_id", "project_id", "id");--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD CONSTRAINT "bridge_decisions_organization_project_id_unique" UNIQUE ("organization_id", "project_id", "id");--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "bridge_projects" ("organization_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_run_scope_fk" FOREIGN KEY ("organization_id", "project_id", "run_id") REFERENCES "bridge_agent_runs" ("organization_id", "project_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_confirmed_decision_scope_fk" FOREIGN KEY ("organization_id", "project_id", "confirmed_decision_id") REFERENCES "bridge_decisions" ("organization_id", "project_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_superseding_scope_fk" FOREIGN KEY ("organization_id", "project_id", "superseding_assumption_id") REFERENCES "bridge_assumptions" ("organization_id", "project_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_policy_check" CHECK ("risk" = 'low' AND "reversible" = true AND lower("category") NOT IN ('security', 'privacy', 'authentication', 'legal', 'production-deletion'));--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_time_check" CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '30 days' AND ("resolved_at" IS NULL OR "resolved_at" >= "created_at"));--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_positive_version_check" CHECK ("version" > 0);--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_json_shape_check" CHECK (jsonb_typeof("scope") = 'object' AND jsonb_typeof("source_links") = 'array');--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ADD CONSTRAINT "bridge_assumptions_resolution_check" CHECK (
	("status" = 'active' AND "resolved_by_id" IS NULL AND "resolved_at" IS NULL AND "resolution_rationale" IS NULL AND "confirmed_decision_id" IS NULL AND "superseding_assumption_id" IS NULL)
	OR ("status" = 'confirmed' AND "resolved_by_id" IS NOT NULL AND "resolved_at" IS NOT NULL AND "resolution_rationale" IS NOT NULL AND "superseding_assumption_id" IS NULL)
	OR ("status" = 'rejected' AND "resolved_by_id" IS NOT NULL AND "resolved_at" IS NOT NULL AND "resolution_rationale" IS NOT NULL AND "confirmed_decision_id" IS NULL AND "superseding_assumption_id" IS NULL)
	OR ("status" = 'expired' AND "resolved_at" IS NOT NULL AND "resolution_rationale" IS NOT NULL AND "confirmed_decision_id" IS NULL AND "superseding_assumption_id" IS NULL)
	OR ("status" = 'superseded' AND "resolved_by_id" IS NOT NULL AND "resolved_at" IS NOT NULL AND "resolution_rationale" IS NOT NULL AND "confirmed_decision_id" IS NULL AND "superseding_assumption_id" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" DROP CONSTRAINT "bridge_agent_runs_json_shape_check";--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD CONSTRAINT "bridge_agent_runs_json_shape_check" CHECK (jsonb_typeof("scope") = 'object' AND jsonb_typeof("context_snapshot_ids") = 'array' AND jsonb_typeof("question_ids") = 'array' AND jsonb_typeof("artifact_version_ids") = 'array' AND jsonb_typeof("assumption_ids") = 'array' AND jsonb_typeof("external_links") = 'array' AND jsonb_typeof("result_links") = 'array');--> statement-breakpoint
ALTER TABLE "bridge_audit_events" DROP CONSTRAINT "bridge_audit_events_subject_type_check";--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD CONSTRAINT "bridge_audit_events_subject_type_check" CHECK ("subject_type" IN ('question', 'response', 'decision', 'assumption', 'artifact', 'artifact_version', 'context_snapshot', 'run'));
