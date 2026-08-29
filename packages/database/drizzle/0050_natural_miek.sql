ALTER TABLE "bridge_artifact_versions" ADD COLUMN "reviewer_assignment" jsonb;--> statement-breakpoint
ALTER TABLE "bridge_artifact_versions" ADD CONSTRAINT "bridge_artifact_versions_reviewer_assignment_shape_check" CHECK ("bridge_artifact_versions"."reviewer_assignment" is null or (
        jsonb_typeof("bridge_artifact_versions"."reviewer_assignment") = 'object'
        and jsonb_typeof("bridge_artifact_versions"."reviewer_assignment"->'reviewerIds') = 'array'
        and jsonb_typeof("bridge_artifact_versions"."reviewer_assignment"->'requestedReviewerIds') = 'array'
        and jsonb_typeof("bridge_artifact_versions"."reviewer_assignment"->'requestedReviewerRoles') = 'array'
        and jsonb_typeof("bridge_artifact_versions"."reviewer_assignment"->'requestedReviewerTeamKeys') = 'array'
      ));