CREATE TABLE "bridge_organization_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"correlation_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_type" "bridge_principal_type" NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bridge_organization_memberships" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_project_memberships" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" ADD CONSTRAINT "bridge_organization_audit_events_organization_id_bridge_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."bridge_organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_organization_audit_events_org_created_idx" ON "bridge_organization_audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "bridge_organization_audit_events_correlation_idx" ON "bridge_organization_audit_events" USING btree ("correlation_id");--> statement-breakpoint
ALTER TABLE "bridge_organization_memberships" ADD CONSTRAINT "bridge_organization_memberships_positive_version_check" CHECK ("version" > 0);--> statement-breakpoint
ALTER TABLE "bridge_project_memberships" ADD CONSTRAINT "bridge_project_memberships_positive_version_check" CHECK ("version" > 0);--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" ADD CONSTRAINT "bridge_organization_audit_events_action_check" CHECK ("action" IN ('organization_member.created', 'organization_member.updated'));--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" ADD CONSTRAINT "bridge_organization_audit_events_subject_check" CHECK ("subject_type" = 'organization_membership');--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" ADD CONSTRAINT "bridge_organization_audit_events_correlation_check" CHECK ("correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');
