ALTER TABLE "bridge_audit_events" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD COLUMN "policy_rule_key" text;--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD COLUMN "assignment_id" text;--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD COLUMN "owner_route_source" text;--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD COLUMN "reviewer_route_source" text;--> statement-breakpoint
ALTER TABLE "bridge_organization_audit_events" ADD COLUMN "source" text;