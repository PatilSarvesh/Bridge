ALTER TABLE "bridge_questions" ADD COLUMN "required_owner_roles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_questions" ADD CONSTRAINT "bridge_questions_required_owner_roles_shape_check" CHECK (jsonb_typeof("required_owner_roles") = 'array' AND jsonb_array_length("required_owner_roles") <= 20);
