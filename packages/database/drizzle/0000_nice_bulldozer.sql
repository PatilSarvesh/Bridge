CREATE TYPE "public"."bridge_artifact_type" AS ENUM('prd', 'adr', 'api_contract', 'test_plan');--> statement-breakpoint
CREATE TYPE "public"."bridge_artifact_version_status" AS ENUM('draft', 'in_review', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."bridge_decision_status" AS ENUM('active', 'superseded', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."bridge_idempotency_kind" AS ENUM('question', 'artifact_version');--> statement-breakpoint
CREATE TYPE "public"."bridge_principal_type" AS ENUM('human', 'agent', 'ci', 'integration');--> statement-breakpoint
CREATE TYPE "public"."bridge_question_status" AS ENUM('open', 'in_discussion', 'accepted', 'duplicate', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."bridge_question_type" AS ENUM('information', 'decision', 'approval', 'review', 'assumption_challenge', 'blocker');--> statement-breakpoint
CREATE TYPE "public"."bridge_risk" AS ENUM('low', 'medium', 'high', 'protected');--> statement-breakpoint
CREATE TABLE "bridge_artifact_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"version" integer NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"content_sha256" text NOT NULL,
	"cited_decision_ids" jsonb NOT NULL,
	"status" "bridge_artifact_version_status" NOT NULL,
	"created_by_id" text NOT NULL,
	"created_by_type" "bridge_principal_type" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"approved_by_id" text,
	"approval_rationale" text,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bridge_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"type" "bridge_artifact_type" NOT NULL,
	"scope" jsonb NOT NULL,
	"reviewer_ids" jsonb NOT NULL,
	"created_by_id" text NOT NULL,
	"created_by_type" "bridge_principal_type" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"current_version_id" text NOT NULL,
	"approved_version_id" text
);
--> statement-breakpoint
CREATE TABLE "bridge_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_type" "bridge_principal_type" NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridge_context_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"task" text NOT NULL,
	"item_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridge_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"question_id" text NOT NULL,
	"answer" text NOT NULL,
	"rationale" text NOT NULL,
	"category" text NOT NULL,
	"scope" jsonb NOT NULL,
	"owner_id" text NOT NULL,
	"source_response_id" text NOT NULL,
	"status" "bridge_decision_status" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"review_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridge_idempotency_records" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" "bridge_idempotency_kind" NOT NULL,
	"request_hash" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridge_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"decision_owner_ids" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridge_question_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"author_id" text NOT NULL,
	"author_type" "bridge_principal_type" NOT NULL,
	"answer" text NOT NULL,
	"rationale" text NOT NULL,
	"option_key" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridge_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"run_id" text,
	"title" text NOT NULL,
	"type" "bridge_question_type" NOT NULL,
	"category" text NOT NULL,
	"context" text NOT NULL,
	"why_it_matters" text NOT NULL,
	"risk" "bridge_risk" NOT NULL,
	"reversible" boolean NOT NULL,
	"blocking" boolean NOT NULL,
	"owner_ids" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"recommendation_key" text,
	"fallback" text,
	"scope" jsonb NOT NULL,
	"created_by_id" text NOT NULL,
	"created_by_type" "bridge_principal_type" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"status" "bridge_question_status" NOT NULL,
	"accepted_response_id" text,
	"decision_id" text,
	"version" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bridge_artifact_versions" ADD CONSTRAINT "bridge_artifact_versions_artifact_id_bridge_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."bridge_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_artifacts" ADD CONSTRAINT "bridge_artifacts_project_id_bridge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."bridge_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD CONSTRAINT "bridge_audit_events_project_id_bridge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."bridge_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_context_snapshots" ADD CONSTRAINT "bridge_context_snapshots_project_id_bridge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."bridge_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD CONSTRAINT "bridge_decisions_project_id_bridge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."bridge_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD CONSTRAINT "bridge_decisions_question_id_bridge_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."bridge_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_question_responses" ADD CONSTRAINT "bridge_question_responses_question_id_bridge_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."bridge_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_project_id_bridge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."bridge_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_artifact_versions_number_unique" ON "bridge_artifact_versions" USING btree ("artifact_id","version");--> statement-breakpoint
CREATE INDEX "bridge_artifact_versions_artifact_status_idx" ON "bridge_artifact_versions" USING btree ("artifact_id","status");--> statement-breakpoint
CREATE INDEX "bridge_artifacts_project_created_idx" ON "bridge_artifacts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "bridge_audit_events_project_created_idx" ON "bridge_audit_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "bridge_context_snapshots_project_created_idx" ON "bridge_context_snapshots" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_decisions_question_unique" ON "bridge_decisions" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "bridge_decisions_project_status_idx" ON "bridge_decisions" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "bridge_idempotency_resource_idx" ON "bridge_idempotency_records" USING btree ("kind","resource_id");--> statement-breakpoint
CREATE INDEX "bridge_question_responses_question_created_idx" ON "bridge_question_responses" USING btree ("question_id","created_at");--> statement-breakpoint
CREATE INDEX "bridge_questions_project_created_idx" ON "bridge_questions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "bridge_questions_project_status_idx" ON "bridge_questions" USING btree ("project_id","status");--> statement-breakpoint
ALTER TABLE "bridge_projects" ADD CONSTRAINT "bridge_projects_organization_id_id_unique" UNIQUE ("organization_id", "id");--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_organization_project_id_unique" UNIQUE ("organization_id", "project_id", "id");--> statement-breakpoint
ALTER TABLE "bridge_question_responses" ADD CONSTRAINT "bridge_question_responses_question_id_id_unique" UNIQUE ("question_id", "id");--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD CONSTRAINT "bridge_decisions_question_id_id_unique" UNIQUE ("question_id", "id");--> statement-breakpoint
ALTER TABLE "bridge_artifact_versions" ADD CONSTRAINT "bridge_artifact_versions_artifact_id_id_unique" UNIQUE ("artifact_id", "id");--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "bridge_projects" ("organization_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD CONSTRAINT "bridge_decisions_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "bridge_projects" ("organization_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_artifacts" ADD CONSTRAINT "bridge_artifacts_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "bridge_projects" ("organization_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_context_snapshots" ADD CONSTRAINT "bridge_context_snapshots_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "bridge_projects" ("organization_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD CONSTRAINT "bridge_audit_events_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "bridge_projects" ("organization_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD CONSTRAINT "bridge_decisions_question_scope_fk" FOREIGN KEY ("organization_id", "project_id", "question_id") REFERENCES "bridge_questions" ("organization_id", "project_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD CONSTRAINT "bridge_decisions_source_response_fk" FOREIGN KEY ("question_id", "source_response_id") REFERENCES "bridge_question_responses" ("question_id", "id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_accepted_response_fk" FOREIGN KEY ("id", "accepted_response_id") REFERENCES "bridge_question_responses" ("question_id", "id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_decision_fk" FOREIGN KEY ("id", "decision_id") REFERENCES "bridge_decisions" ("question_id", "id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "bridge_artifacts" ADD CONSTRAINT "bridge_artifacts_current_version_fk" FOREIGN KEY ("id", "current_version_id") REFERENCES "bridge_artifact_versions" ("artifact_id", "id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "bridge_artifacts" ADD CONSTRAINT "bridge_artifacts_approved_version_fk" FOREIGN KEY ("id", "approved_version_id") REFERENCES "bridge_artifact_versions" ("artifact_id", "id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_positive_version_check" CHECK ("version" > 0);--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_resolution_check" CHECK (("status" = 'accepted' AND "accepted_response_id" IS NOT NULL AND "decision_id" IS NOT NULL) OR ("status" <> 'accepted' AND "accepted_response_id" IS NULL AND "decision_id" IS NULL));--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_json_shape_check" CHECK (jsonb_typeof("owner_ids") = 'array' AND jsonb_typeof("options") = 'array' AND jsonb_typeof("scope") = 'object');--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD CONSTRAINT "bridge_decisions_review_after_creation_check" CHECK ("review_at" > "created_at");--> statement-breakpoint
ALTER TABLE "bridge_artifacts" ADD CONSTRAINT "bridge_artifacts_json_shape_check" CHECK (jsonb_typeof("reviewer_ids") = 'array' AND jsonb_typeof("scope") = 'object');--> statement-breakpoint
ALTER TABLE "bridge_artifact_versions" ADD CONSTRAINT "bridge_artifact_versions_positive_version_check" CHECK ("version" > 0);--> statement-breakpoint
ALTER TABLE "bridge_artifact_versions" ADD CONSTRAINT "bridge_artifact_versions_sha256_check" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "bridge_artifact_versions" ADD CONSTRAINT "bridge_artifact_versions_json_shape_check" CHECK (jsonb_typeof("cited_decision_ids") = 'array');--> statement-breakpoint
ALTER TABLE "bridge_artifact_versions" ADD CONSTRAINT "bridge_artifact_versions_approval_check" CHECK ((("status" = 'approved' OR "status" = 'superseded') AND "approved_by_id" IS NOT NULL AND "approval_rationale" IS NOT NULL AND "approved_at" IS NOT NULL) OR (("status" = 'draft' OR "status" = 'in_review') AND "approved_by_id" IS NULL AND "approval_rationale" IS NULL AND "approved_at" IS NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_artifact_versions_one_approved_idx" ON "bridge_artifact_versions" ("artifact_id") WHERE "status" = 'approved';--> statement-breakpoint
ALTER TABLE "bridge_context_snapshots" ADD CONSTRAINT "bridge_context_snapshots_item_ids_shape_check" CHECK (jsonb_typeof("item_ids") = 'array');--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD CONSTRAINT "bridge_audit_events_subject_type_check" CHECK ("subject_type" IN ('question', 'response', 'decision', 'artifact', 'artifact_version', 'context_snapshot'));
