ALTER TABLE "bridge_artifact_versions" ADD COLUMN "reviews" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_artifact_versions" ADD CONSTRAINT "bridge_artifact_versions_reviews_shape_check" CHECK (jsonb_typeof("reviews") = 'array');--> statement-breakpoint
ALTER TABLE "bridge_notifications" DROP CONSTRAINT "bridge_notifications_type_check";--> statement-breakpoint
ALTER TABLE "bridge_notifications" ADD CONSTRAINT "bridge_notifications_type_check" CHECK ("type" IN ('question_assigned', 'question_response', 'question_comment', 'question_review', 'question_accepted', 'decision_lifecycle', 'artifact_review_requested', 'artifact_review_feedback', 'artifact_approved'));
