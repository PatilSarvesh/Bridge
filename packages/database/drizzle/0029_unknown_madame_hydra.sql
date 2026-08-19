ALTER TABLE "bridge_questions" ADD COLUMN "reviewer_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD COLUMN "reviewer_roles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD COLUMN "routing" jsonb;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD COLUMN "assignment_history" jsonb;--> statement-breakpoint
UPDATE "bridge_questions" SET
  "routing" = jsonb_build_object(
    'ownerSource', CASE WHEN jsonb_array_length("owner_ids") + jsonb_array_length("owner_roles") > 0 THEN 'legacy_assignment' ELSE 'admin_fallback' END,
    'reviewerSource', 'none',
    'ownershipVersion', 0,
    'policyVersion', "policy_version"
  );--> statement-breakpoint
UPDATE "bridge_questions" SET "assignment_history" = jsonb_build_array(jsonb_build_object(
  'id', 'qas_legacy_' || "id",
  'kind', 'initial',
  'changedById', "created_by_id",
  'changedByType', "created_by_type"::text,
  'ownerIds', "owner_ids",
  'ownerRoles', "owner_roles",
  'reviewerIds', "reviewer_ids",
  'reviewerRoles', "reviewer_roles",
  'route', "routing",
  'createdAt', to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'questionVersion', 1
));--> statement-breakpoint
ALTER TABLE "bridge_questions" ALTER COLUMN "routing" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_questions" ALTER COLUMN "assignment_history" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_reviewer_ids_shape_check" CHECK (jsonb_typeof("reviewer_ids") = 'array' AND jsonb_array_length("reviewer_ids") <= 20);--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_reviewer_roles_shape_check" CHECK (jsonb_typeof("reviewer_roles") = 'array' AND jsonb_array_length("reviewer_roles") <= 20);--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_routing_shape_check" CHECK (jsonb_typeof("routing") = 'object');--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_assignment_history_shape_check" CHECK (jsonb_typeof("assignment_history") = 'array');--> statement-breakpoint
ALTER TABLE "bridge_outbox_events" DROP CONSTRAINT "bridge_outbox_events_type_check";--> statement-breakpoint
ALTER TABLE "bridge_outbox_events" ADD CONSTRAINT "bridge_outbox_events_type_check" CHECK ("type" IN ('notification.created', 'decision.lifecycle_changed', 'question.reassigned'));
