CREATE TABLE "bridge_notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" text NOT NULL,
  "recipient_id" text NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "read_at" timestamp with time zone,
  CONSTRAINT "bridge_notifications_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."bridge_projects"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "bridge_notifications_type_check" CHECK ("type" IN ('question_assigned', 'question_response', 'question_comment', 'question_review', 'question_accepted', 'artifact_review_requested', 'artifact_approved'))
);--> statement-breakpoint
CREATE INDEX "bridge_notifications_recipient_created_idx" ON "bridge_notifications" USING btree ("recipient_id", "created_at");--> statement-breakpoint
CREATE INDEX "bridge_notifications_recipient_read_idx" ON "bridge_notifications" USING btree ("recipient_id", "read_at");--> statement-breakpoint
ALTER TABLE "bridge_notifications" ADD CONSTRAINT "bridge_notifications_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "bridge_projects" ("organization_id", "id") ON DELETE CASCADE ON UPDATE no action;
