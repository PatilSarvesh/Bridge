ALTER TABLE "bridge_decisions" ADD COLUMN "lifecycle_rationale" text;--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD COLUMN "lifecycle_changed_by_id" text;--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD COLUMN "lifecycle_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD COLUMN "replacement_decision_id" text;--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD CONSTRAINT "bridge_decisions_replacement_decision_id_bridge_decisions_id_fk" FOREIGN KEY ("replacement_decision_id") REFERENCES "public"."bridge_decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_decisions_organization_project_id_unique" ON "bridge_decisions" USING btree ("organization_id","project_id","id");--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD CONSTRAINT "bridge_decisions_replacement_scope_fk" FOREIGN KEY ("organization_id","project_id","replacement_decision_id") REFERENCES "public"."bridge_decisions"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD CONSTRAINT "bridge_decisions_version_check" CHECK ("version" > 0);--> statement-breakpoint
ALTER TABLE "bridge_decisions" ADD CONSTRAINT "bridge_decisions_lifecycle_check" CHECK (
  (
    "status" = 'active'
    AND "lifecycle_rationale" IS NULL
    AND "lifecycle_changed_by_id" IS NULL
    AND "lifecycle_changed_at" IS NULL
    AND "replacement_decision_id" IS NULL
  )
  OR (
    "status" = 'superseded'
    AND "lifecycle_rationale" IS NOT NULL
    AND "lifecycle_changed_by_id" IS NOT NULL
    AND "lifecycle_changed_at" IS NOT NULL
    AND "replacement_decision_id" IS NOT NULL
  )
  OR (
    "status" IN ('expired', 'revoked')
    AND "lifecycle_rationale" IS NOT NULL
    AND "lifecycle_changed_by_id" IS NOT NULL
    AND "lifecycle_changed_at" IS NOT NULL
    AND "replacement_decision_id" IS NULL
  )
) NOT VALID;--> statement-breakpoint
ALTER TABLE "bridge_notifications" DROP CONSTRAINT "bridge_notifications_type_check";--> statement-breakpoint
ALTER TABLE "bridge_notifications" ADD CONSTRAINT "bridge_notifications_type_check" CHECK ("type" IN ('question_assigned', 'question_response', 'question_comment', 'question_review', 'question_accepted', 'decision_lifecycle', 'artifact_review_requested', 'artifact_approved'));--> statement-breakpoint
ALTER TABLE "bridge_outbox_events" DROP CONSTRAINT "bridge_outbox_events_type_check";--> statement-breakpoint
ALTER TABLE "bridge_outbox_events" ADD CONSTRAINT "bridge_outbox_events_type_check" CHECK ("type" IN ('notification.created', 'decision.lifecycle_changed'));
