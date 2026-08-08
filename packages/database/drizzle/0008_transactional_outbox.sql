CREATE TABLE "bridge_outbox_events" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" text NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL,
  "attempts" integer NOT NULL,
  "available_at" timestamp with time zone NOT NULL,
  "lease_until" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "processed_at" timestamp with time zone,
  "last_error" text,
  CONSTRAINT "bridge_outbox_events_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."bridge_projects"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "bridge_outbox_events_type_check" CHECK ("type" IN ('notification.created')),
  CONSTRAINT "bridge_outbox_events_status_check" CHECK ("status" IN ('pending', 'processing', 'processed', 'failed', 'dead_letter')),
  CONSTRAINT "bridge_outbox_events_attempts_check" CHECK ("attempts" >= 0)
);--> statement-breakpoint
ALTER TABLE "bridge_outbox_events" ADD CONSTRAINT "bridge_outbox_events_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "bridge_projects" ("organization_id", "id") ON DELETE CASCADE ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_outbox_status_available_idx" ON "bridge_outbox_events" USING btree ("status", "available_at");--> statement-breakpoint
CREATE INDEX "bridge_outbox_project_created_idx" ON "bridge_outbox_events" USING btree ("project_id", "created_at");
