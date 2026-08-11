CREATE TABLE "bridge_service_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bridge_service_credentials" ADD CONSTRAINT "bridge_service_credentials_organization_id_bridge_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."bridge_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_service_credentials" ADD CONSTRAINT "bridge_service_credentials_principal_id_bridge_principal_identities_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."bridge_principal_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_service_credentials_token_hash_unique" ON "bridge_service_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "bridge_service_credentials_org_created_idx" ON "bridge_service_credentials" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "bridge_service_credentials_principal_idx" ON "bridge_service_credentials" USING btree ("principal_id");
--> statement-breakpoint
ALTER TABLE "bridge_service_credentials" ADD CONSTRAINT "bridge_service_credentials_positive_version_check" CHECK ("version" > 0);--> statement-breakpoint
ALTER TABLE "bridge_service_credentials" ADD CONSTRAINT "bridge_service_credentials_scopes_check" CHECK (jsonb_typeof("scopes") = 'array' AND jsonb_array_length("scopes") > 0);--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" DROP CONSTRAINT IF EXISTS "bridge_organization_audit_events_action_check";--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" DROP CONSTRAINT IF EXISTS "bridge_organization_audit_events_subject_check";--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" ADD CONSTRAINT "bridge_organization_audit_events_action_check" CHECK ("action" IN ('organization_member.created', 'organization_member.updated', 'service_identity.created', 'service_identity.revoked'));--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" ADD CONSTRAINT "bridge_organization_audit_events_subject_check" CHECK (("action" IN ('organization_member.created', 'organization_member.updated') AND "subject_type" = 'organization_membership') OR ("action" IN ('service_identity.created', 'service_identity.revoked') AND "subject_type" = 'service_credential'));
