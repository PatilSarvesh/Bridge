ALTER TABLE "bridge_outbox_events" ADD CONSTRAINT "bridge_outbox_events_org_project_id_unique" UNIQUE("organization_id","project_id","id");--> statement-breakpoint
CREATE TABLE "bridge_outbox_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"outbox_event_id" text NOT NULL,
	"channel" text NOT NULL,
	"destination_hash" text NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer NOT NULL,
	"preference" text NOT NULL,
	"provider_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bridge_outbox_deliveries_event_channel_unique" UNIQUE("outbox_event_id","channel")
);
--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD CONSTRAINT "bridge_outbox_deliveries_event_scope_fk" FOREIGN KEY ("organization_id","project_id","outbox_event_id") REFERENCES "public"."bridge_outbox_events"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_outbox_deliveries_project_updated_idx" ON "bridge_outbox_deliveries" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "bridge_outbox_deliveries_status_updated_idx" ON "bridge_outbox_deliveries" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD CONSTRAINT "bridge_outbox_deliveries_channel_check" CHECK ("channel" IN ('email'));--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD CONSTRAINT "bridge_outbox_deliveries_status_check" CHECK ("status" IN ('delivered', 'failed', 'suppressed', 'deferred'));--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD CONSTRAINT "bridge_outbox_deliveries_preference_check" CHECK ("preference" IN ('immediate', 'digest', 'muted'));--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD CONSTRAINT "bridge_outbox_deliveries_attempt_check" CHECK ("attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD CONSTRAINT "bridge_outbox_deliveries_destination_hash_check" CHECK ("destination_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD CONSTRAINT "bridge_outbox_deliveries_time_check" CHECK ("updated_at" >= "created_at");--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD CONSTRAINT "bridge_outbox_deliveries_result_check" CHECK (
  ("status" = 'delivered' AND "provider_message_id" IS NOT NULL AND length(trim("provider_message_id")) > 0 AND "last_error" IS NULL)
  OR ("status" = 'failed' AND "provider_message_id" IS NULL AND "last_error" IS NOT NULL AND length(trim("last_error")) > 0)
  OR ("status" IN ('suppressed', 'deferred') AND "provider_message_id" IS NULL AND "last_error" IS NULL)
);
