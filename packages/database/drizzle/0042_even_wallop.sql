CREATE TABLE "bridge_github_pull_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"canonical_url" text NOT NULL,
	"head_branch" text NOT NULL,
	"base_branch" text NOT NULL,
	"head_sha" text NOT NULL,
	"decision_ids" jsonb NOT NULL,
	"artifact_version_ids" jsonb NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "bridge_github_pull_requests_repository_number_unique" UNIQUE("repository_id","number"),
	CONSTRAINT "bridge_github_pull_requests_number_check" CHECK ("bridge_github_pull_requests"."number" > 0),
	CONSTRAINT "bridge_github_pull_requests_state_check" CHECK ("bridge_github_pull_requests"."state" IN ('open', 'closed', 'merged')),
	CONSTRAINT "bridge_github_pull_requests_version_check" CHECK ("bridge_github_pull_requests"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "bridge_github_pull_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_github_pull_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_github_pull_requests" ADD CONSTRAINT "bridge_github_pull_requests_organization_id_bridge_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."bridge_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_github_pull_requests" ADD CONSTRAINT "bridge_github_pull_requests_repository_id_bridge_project_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."bridge_project_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_github_pull_requests" ADD CONSTRAINT "bridge_github_pull_requests_organization_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."bridge_projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_github_pull_requests_project_source_updated_idx" ON "bridge_github_pull_requests" USING btree ("project_id","source_updated_at");--> statement-breakpoint
CREATE POLICY "bridge_github_pull_requests_tenant" ON "bridge_github_pull_requests" AS PERMISSIVE FOR ALL TO public USING ("bridge_github_pull_requests"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_github_pull_requests"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));
