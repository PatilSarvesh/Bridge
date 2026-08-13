ALTER TABLE "bridge_idempotency_records" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "bridge_idempotency_records" AS "record"
SET "organization_id" = COALESCE(
  (
    SELECT "question"."organization_id"
    FROM "bridge_questions" AS "question"
    WHERE "question"."id" = "record"."resource_id"
  ),
  (
    SELECT "artifact"."organization_id"
    FROM "bridge_artifact_versions" AS "version"
    JOIN "bridge_artifacts" AS "artifact" ON "artifact"."id" = "version"."artifact_id"
    WHERE "version"."id" = "record"."resource_id"
  ),
  (
    SELECT "run"."organization_id"
    FROM "bridge_agent_runs" AS "run"
    WHERE "run"."id" = "record"."resource_id"
  ),
  (
    SELECT "assumption"."organization_id"
    FROM "bridge_assumptions" AS "assumption"
    WHERE "assumption"."id" = "record"."resource_id"
  )
);--> statement-breakpoint
DELETE FROM "bridge_idempotency_records" WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "bridge_idempotency_records" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_idempotency_records" DROP CONSTRAINT "bridge_idempotency_records_pkey";--> statement-breakpoint
ALTER TABLE "bridge_idempotency_records" ADD CONSTRAINT "bridge_idempotency_records_organization_id_key_pk" PRIMARY KEY("organization_id","key");--> statement-breakpoint
ALTER TABLE "bridge_idempotency_records" ADD CONSTRAINT "bridge_idempotency_records_organization_id_bridge_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."bridge_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_idempotency_organization_idx" ON "bridge_idempotency_records" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_artifact_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_artifact_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_artifacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_artifacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_assumptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_assumptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_audit_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_context_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_context_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_idempotency_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_idempotency_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_organization_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_organization_memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_outbox_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_outbox_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_project_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_project_memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_question_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_question_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_questions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_run_continuation_locators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_run_continuation_locators" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "bridge_agent_runs_tenant" ON "bridge_agent_runs" AS PERMISSIVE FOR ALL TO public USING ("bridge_agent_runs"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_agent_runs"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_artifact_versions_tenant" ON "bridge_artifact_versions" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from "bridge_artifacts"
        where "bridge_artifacts"."id" = "bridge_artifact_versions"."artifact_id"
          and "bridge_artifacts"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')
      )) WITH CHECK (exists (
        select 1 from "bridge_artifacts"
        where "bridge_artifacts"."id" = "bridge_artifact_versions"."artifact_id"
          and "bridge_artifacts"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')
      ));--> statement-breakpoint
CREATE POLICY "bridge_artifacts_tenant" ON "bridge_artifacts" AS PERMISSIVE FOR ALL TO public USING ("bridge_artifacts"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_artifacts"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_assumptions_tenant" ON "bridge_assumptions" AS PERMISSIVE FOR ALL TO public USING ("bridge_assumptions"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_assumptions"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_audit_events_tenant" ON "bridge_audit_events" AS PERMISSIVE FOR ALL TO public USING ("bridge_audit_events"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_audit_events"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_context_snapshots_tenant" ON "bridge_context_snapshots" AS PERMISSIVE FOR ALL TO public USING ("bridge_context_snapshots"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_context_snapshots"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_decisions_tenant" ON "bridge_decisions" AS PERMISSIVE FOR ALL TO public USING ("bridge_decisions"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_decisions"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_idempotency_records_tenant" ON "bridge_idempotency_records" AS PERMISSIVE FOR ALL TO public USING ("bridge_idempotency_records"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_idempotency_records"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_notifications_tenant" ON "bridge_notifications" AS PERMISSIVE FOR ALL TO public USING ("bridge_notifications"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_notifications"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_organization_audit_events_tenant" ON "bridge_organization_audit_events" AS PERMISSIVE FOR ALL TO public USING ("bridge_organization_audit_events"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_organization_audit_events"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_organization_memberships_tenant" ON "bridge_organization_memberships" AS PERMISSIVE FOR ALL TO public USING ("bridge_organization_memberships"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_organization_memberships"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_outbox_deliveries_tenant" ON "bridge_outbox_deliveries" AS PERMISSIVE FOR ALL TO public USING ("bridge_outbox_deliveries"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_outbox_deliveries"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_outbox_events_tenant" ON "bridge_outbox_events" AS PERMISSIVE FOR ALL TO public USING ("bridge_outbox_events"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_outbox_events"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_project_memberships_tenant" ON "bridge_project_memberships" AS PERMISSIVE FOR ALL TO public USING ("bridge_project_memberships"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_project_memberships"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_projects_tenant" ON "bridge_projects" AS PERMISSIVE FOR ALL TO public USING ("bridge_projects"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_projects"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_question_responses_tenant" ON "bridge_question_responses" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from "bridge_questions"
        where "bridge_questions"."id" = "bridge_question_responses"."question_id"
          and "bridge_questions"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')
      )) WITH CHECK (exists (
        select 1 from "bridge_questions"
        where "bridge_questions"."id" = "bridge_question_responses"."question_id"
          and "bridge_questions"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')
      ));--> statement-breakpoint
CREATE POLICY "bridge_questions_tenant" ON "bridge_questions" AS PERMISSIVE FOR ALL TO public USING ("bridge_questions"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_questions"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_run_continuation_locators_tenant" ON "bridge_run_continuation_locators" AS PERMISSIVE FOR ALL TO public USING (exists (
      select 1 from "bridge_agent_runs"
      where "bridge_agent_runs"."id" = "bridge_run_continuation_locators"."run_id"
        and "bridge_agent_runs"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')
    )) WITH CHECK (exists (
      select 1 from "bridge_agent_runs"
      where "bridge_agent_runs"."id" = "bridge_run_continuation_locators"."run_id"
        and "bridge_agent_runs"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')
    ));
