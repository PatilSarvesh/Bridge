ALTER TABLE "bridge_audit_events" ADD COLUMN "before_version" integer;--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD COLUMN "after_version" integer;--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" ADD COLUMN "before_version" integer;--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" ADD COLUMN "after_version" integer;