ALTER TABLE "bridge_questions" ADD COLUMN "owner_roles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_questions" DROP CONSTRAINT "bridge_questions_json_shape_check";--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_json_shape_check" CHECK (jsonb_typeof("owner_ids") = 'array' AND jsonb_typeof("owner_roles") = 'array' AND jsonb_typeof("options") = 'array' AND jsonb_typeof("scope") = 'object');
