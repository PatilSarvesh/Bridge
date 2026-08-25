CREATE TYPE "public"."bridge_membership_provisioning" AS ENUM('manual', 'directory');--> statement-breakpoint
CREATE TABLE "bridge_directory_group_members" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"group_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"external_subject" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "bridge_directory_group_members_group_subject_unique" UNIQUE("group_id","external_subject"),
	CONSTRAINT "bridge_directory_group_members_status_check" CHECK ("bridge_directory_group_members"."status" IN ('active', 'removed')),
	CONSTRAINT "bridge_directory_group_members_version_check" CHECK ("bridge_directory_group_members"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "bridge_directory_group_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_directory_group_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bridge_directory_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"issuer" text NOT NULL,
	"external_group_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"source_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "bridge_directory_groups_provider_identity_unique" UNIQUE("organization_id","provider","issuer","external_group_id"),
	CONSTRAINT "bridge_directory_groups_status_check" CHECK ("bridge_directory_groups"."status" IN ('active', 'disabled')),
	CONSTRAINT "bridge_directory_groups_version_check" CHECK ("bridge_directory_groups"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "bridge_directory_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_directory_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" DROP CONSTRAINT "bridge_organization_audit_events_action_check";--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" DROP CONSTRAINT "bridge_organization_audit_events_subject_check";--> statement-breakpoint
ALTER TABLE "bridge_organization_memberships" ADD COLUMN "provisioning" "bridge_membership_provisioning" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_organization_memberships" ALTER COLUMN "provisioning" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bridge_directory_group_members" ADD CONSTRAINT "bridge_directory_group_members_organization_id_bridge_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."bridge_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_directory_group_members" ADD CONSTRAINT "bridge_directory_group_members_group_id_bridge_directory_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."bridge_directory_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_directory_group_members" ADD CONSTRAINT "bridge_directory_group_members_principal_id_bridge_principal_identities_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."bridge_principal_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_directory_groups" ADD CONSTRAINT "bridge_directory_groups_organization_id_bridge_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."bridge_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_directory_group_members_principal_status_idx" ON "bridge_directory_group_members" USING btree ("organization_id","principal_id","status");--> statement-breakpoint
CREATE INDEX "bridge_directory_groups_org_status_name_idx" ON "bridge_directory_groups" USING btree ("organization_id","status","display_name");--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" ADD CONSTRAINT "bridge_organization_audit_events_action_check" CHECK ("bridge_organization_audit_events"."action" IN ('organization_member.created', 'organization_member.updated', 'service_identity.created', 'service_identity.rotated', 'service_identity.revoked', 'audit.exported', 'authentication.succeeded', 'authentication.logged_out', 'directory_group.created', 'directory_group.synced'));--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" ADD CONSTRAINT "bridge_organization_audit_events_subject_check" CHECK ((("bridge_organization_audit_events"."action" IN ('organization_member.created', 'organization_member.updated') AND "bridge_organization_audit_events"."subject_type" = 'organization_membership') OR ("bridge_organization_audit_events"."action" IN ('service_identity.created', 'service_identity.rotated', 'service_identity.revoked') AND "bridge_organization_audit_events"."subject_type" = 'service_credential') OR ("bridge_organization_audit_events"."action" = 'audit.exported' AND "bridge_organization_audit_events"."subject_type" = 'audit_export') OR ("bridge_organization_audit_events"."action" IN ('authentication.succeeded', 'authentication.logged_out') AND "bridge_organization_audit_events"."subject_type" = 'principal_identity') OR ("bridge_organization_audit_events"."action" IN ('directory_group.created', 'directory_group.synced') AND "bridge_organization_audit_events"."subject_type" = 'directory_group')));--> statement-breakpoint
CREATE POLICY "bridge_directory_group_members_tenant" ON "bridge_directory_group_members" AS PERMISSIVE FOR ALL TO public USING ("bridge_directory_group_members"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_directory_group_members"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "bridge_directory_groups_tenant" ON "bridge_directory_groups" AS PERMISSIVE FOR ALL TO public USING ("bridge_directory_groups"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_directory_groups"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));
