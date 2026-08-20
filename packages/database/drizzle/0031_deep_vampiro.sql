ALTER TABLE "bridge_audit_events" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD COLUMN "required_reviewer_quorum" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD COLUMN "approval_override" jsonb;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_required_reviewer_quorum_shape_check" CHECK ("bridge_questions"."required_reviewer_quorum" IS NOT NULL AND jsonb_typeof("bridge_questions"."required_reviewer_quorum") = 'object');