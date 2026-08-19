CREATE TABLE "bridge_project_ownership_configurations" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"roles" jsonb NOT NULL,
	"teams" jsonb NOT NULL,
	"rules" jsonb NOT NULL,
	"version" integer NOT NULL,
	"updated_by_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bridge_project_ownership_configurations_organization_id_project_id_pk" PRIMARY KEY("organization_id","project_id"),
	CONSTRAINT "bridge_project_ownership_configurations_version_check" CHECK ("bridge_project_ownership_configurations"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "bridge_project_ownership_configurations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_project_ownership_configurations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_project_ownership_configurations" ADD CONSTRAINT "bridge_project_ownership_configurations_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."bridge_projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_project_ownership_configurations" ADD CONSTRAINT "bridge_project_ownership_configurations_roles_shape_check" CHECK (jsonb_typeof("roles") = 'array' AND jsonb_array_length("roles") <= 50);--> statement-breakpoint
ALTER TABLE "bridge_project_ownership_configurations" ADD CONSTRAINT "bridge_project_ownership_configurations_teams_shape_check" CHECK (jsonb_typeof("teams") = 'array' AND jsonb_array_length("teams") <= 50);--> statement-breakpoint
ALTER TABLE "bridge_project_ownership_configurations" ADD CONSTRAINT "bridge_project_ownership_configurations_rules_shape_check" CHECK (jsonb_typeof("rules") = 'array' AND jsonb_array_length("rules") <= 100);--> statement-breakpoint
ALTER TABLE "bridge_audit_events" DROP CONSTRAINT "bridge_audit_events_subject_type_check";--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD CONSTRAINT "bridge_audit_events_subject_type_check" CHECK ("subject_type" IN ('project', 'repository', 'ownership_configuration', 'question', 'response', 'decision', 'assumption', 'artifact', 'artifact_version', 'context_snapshot', 'run', 'outbox_event', 'audit_export'));--> statement-breakpoint
CREATE INDEX "bridge_project_ownership_configurations_project_updated_idx" ON "bridge_project_ownership_configurations" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE POLICY "bridge_project_ownership_configurations_tenant" ON "bridge_project_ownership_configurations" AS PERMISSIVE FOR ALL TO public USING ("bridge_project_ownership_configurations"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_project_ownership_configurations"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));
