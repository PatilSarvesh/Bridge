CREATE TABLE "bridge_project_repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"canonical_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bridge_project_repositories_org_provider_owner_name_unique" UNIQUE("organization_id","provider","owner","name")
);
--> statement-breakpoint
ALTER TABLE "bridge_project_repositories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_project_repositories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_project_repositories" ADD CONSTRAINT "bridge_project_repositories_organization_id_bridge_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."bridge_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_project_repositories" ADD CONSTRAINT "bridge_project_repositories_organization_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."bridge_projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_project_repositories_project_name_idx" ON "bridge_project_repositories" USING btree ("project_id","name");--> statement-breakpoint
CREATE POLICY "bridge_project_repositories_tenant" ON "bridge_project_repositories" AS PERMISSIVE FOR ALL TO public USING ("bridge_project_repositories"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_project_repositories"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));
