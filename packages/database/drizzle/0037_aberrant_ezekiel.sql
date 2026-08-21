CREATE TABLE "bridge_notification_preferences" (
	"organization_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"channel" text NOT NULL,
	"preference" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bridge_notification_preferences_organization_id_principal_id_channel_pk" PRIMARY KEY("organization_id","principal_id","channel"),
	CONSTRAINT "bridge_notification_preferences_channel_check" CHECK ("bridge_notification_preferences"."channel" IN ('email')),
	CONSTRAINT "bridge_notification_preferences_preference_check" CHECK ("bridge_notification_preferences"."preference" IN ('immediate', 'digest', 'muted'))
);
--> statement-breakpoint
ALTER TABLE "bridge_notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_notification_preferences" ADD CONSTRAINT "bridge_notification_preferences_membership_fk" FOREIGN KEY ("organization_id","principal_id") REFERENCES "public"."bridge_organization_memberships"("organization_id","principal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_notification_preferences_principal_idx" ON "bridge_notification_preferences" USING btree ("organization_id","principal_id");--> statement-breakpoint
CREATE POLICY "bridge_notification_preferences_tenant" ON "bridge_notification_preferences" AS PERMISSIVE FOR ALL TO public USING ("bridge_notification_preferences"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_notification_preferences"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));