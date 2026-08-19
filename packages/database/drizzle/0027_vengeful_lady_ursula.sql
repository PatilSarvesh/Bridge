CREATE TABLE "bridge_project_policy_configurations" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"rules" jsonb NOT NULL,
	"version" integer NOT NULL,
	"updated_by_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bridge_project_policy_configurations_organization_id_project_id_pk" PRIMARY KEY("organization_id","project_id"),
	CONSTRAINT "bridge_project_policy_configurations_version_check" CHECK ("bridge_project_policy_configurations"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "bridge_project_policy_configurations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_project_policy_configurations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD COLUMN "policy_version" integer;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD COLUMN "policy_action" text;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD COLUMN "policy_version" integer;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD COLUMN "policy_rule_key" text;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD COLUMN "required_reviewer_roles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "bridge_questions" SET
  "policy_action" = CASE WHEN "risk" = 'protected' THEN 'protected_approval' WHEN "blocking" THEN 'block' ELSE 'ask_async' END,
  "policy_version" = 0,
  "policy_rule_key" = CASE WHEN "risk" = 'protected' THEN 'bridge-legacy-protected' WHEN "blocking" THEN 'bridge-question-blocking' ELSE 'bridge-question-async' END;--> statement-breakpoint
ALTER TABLE "bridge_questions" ALTER COLUMN "policy_action" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_questions" ALTER COLUMN "policy_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_questions" ALTER COLUMN "policy_rule_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_project_policy_configurations" ADD CONSTRAINT "bridge_project_policy_configurations_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."bridge_projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_project_policy_configurations" ADD CONSTRAINT "bridge_project_policy_configurations_rules_shape_check" CHECK (jsonb_typeof("rules") = 'array' AND jsonb_array_length("rules") <= 100);--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_policy_action_check" CHECK ("policy_action" IN ('assume_and_log', 'ask_async', 'block', 'protected_approval'));--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_policy_version_check" CHECK ("policy_version" >= 0);--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_policy_rule_key_check" CHECK (length("policy_rule_key") > 0);--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_required_reviewer_roles_shape_check" CHECK (jsonb_typeof("required_reviewer_roles") = 'array' AND jsonb_array_length("required_reviewer_roles") <= 20);--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD CONSTRAINT "bridge_audit_events_policy_version_check" CHECK ("policy_version" IS NULL OR "policy_version" >= 0);--> statement-breakpoint
ALTER TABLE "bridge_audit_events" DROP CONSTRAINT "bridge_audit_events_subject_type_check";--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD CONSTRAINT "bridge_audit_events_subject_type_check" CHECK ("subject_type" IN ('project', 'repository', 'ownership_configuration', 'policy_configuration', 'question', 'response', 'decision', 'assumption', 'artifact', 'artifact_version', 'context_snapshot', 'run', 'outbox_event', 'audit_export'));--> statement-breakpoint
CREATE INDEX "bridge_project_policy_configurations_project_updated_idx" ON "bridge_project_policy_configurations" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE POLICY "bridge_project_policy_configurations_tenant" ON "bridge_project_policy_configurations" AS PERMISSIVE FOR ALL TO public USING ("bridge_project_policy_configurations"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_project_policy_configurations"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));
