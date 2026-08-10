CREATE TYPE "public"."bridge_membership_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "bridge_organization_memberships" (
	"organization_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"status" "bridge_membership_status" NOT NULL,
	"roles" jsonb NOT NULL,
	"all_projects" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bridge_organization_memberships_organization_id_principal_id_pk" PRIMARY KEY("organization_id","principal_id")
);
--> statement-breakpoint
CREATE TABLE "bridge_organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"external_identity_provider_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bridge_organizations_external_identity_provider_id_unique" UNIQUE("external_identity_provider_id"),
	CONSTRAINT "bridge_organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "bridge_principal_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "bridge_principal_type" NOT NULL,
	"display_name" text NOT NULL,
	"oidc_issuer" text NOT NULL,
	"oidc_subject" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bridge_principal_identities_oidc_unique" UNIQUE("oidc_issuer","oidc_subject")
);
--> statement-breakpoint
CREATE TABLE "bridge_project_memberships" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"status" "bridge_membership_status" NOT NULL,
	"roles" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bridge_project_memberships_organization_id_project_id_principal_id_pk" PRIMARY KEY("organization_id","project_id","principal_id")
);
--> statement-breakpoint
INSERT INTO "bridge_organizations" (
	"id",
	"external_identity_provider_id",
	"slug",
	"name",
	"created_at"
)
SELECT DISTINCT
	"organization_id",
	'legacy:' || "organization_id",
	"organization_id",
	"organization_id",
	CURRENT_TIMESTAMP
FROM "bridge_projects"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "bridge_organization_memberships" ADD CONSTRAINT "bridge_organization_memberships_organization_id_bridge_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."bridge_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_organization_memberships" ADD CONSTRAINT "bridge_organization_memberships_principal_id_bridge_principal_identities_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."bridge_principal_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_project_memberships" ADD CONSTRAINT "bridge_project_memberships_organization_id_bridge_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."bridge_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_project_memberships" ADD CONSTRAINT "bridge_project_memberships_project_id_bridge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."bridge_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_project_memberships" ADD CONSTRAINT "bridge_project_memberships_principal_id_bridge_principal_identities_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."bridge_principal_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_project_memberships" ADD CONSTRAINT "bridge_project_memberships_organization_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."bridge_projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_organization_memberships_principal_idx" ON "bridge_organization_memberships" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "bridge_project_memberships_principal_idx" ON "bridge_project_memberships" USING btree ("principal_id");--> statement-breakpoint
ALTER TABLE "bridge_projects" ADD CONSTRAINT "bridge_projects_organization_id_bridge_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."bridge_organizations"("id") ON DELETE restrict ON UPDATE no action;
