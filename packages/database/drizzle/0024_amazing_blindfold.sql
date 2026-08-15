CREATE TABLE "bridge_adapter_diagnostics" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"client" "bridge_agent_run_client" NOT NULL,
	"reported_by_id" text NOT NULL,
	"reported_by_type" "bridge_principal_type" NOT NULL,
	"correlation_id" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"mcp_status" text NOT NULL,
	"checks" jsonb NOT NULL,
	"status" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bridge_adapter_diagnostics_organization_id_project_id_client_pk" PRIMARY KEY("organization_id","project_id","client"),
	CONSTRAINT "bridge_adapter_diagnostics_mcp_status_check" CHECK ("bridge_adapter_diagnostics"."mcp_status" IN ('ready', 'failed', 'not_configured')),
	CONSTRAINT "bridge_adapter_diagnostics_status_check" CHECK ("bridge_adapter_diagnostics"."status" IN ('pass', 'fail'))
);
--> statement-breakpoint
ALTER TABLE "bridge_adapter_diagnostics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_adapter_diagnostics" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_adapter_diagnostics" ADD CONSTRAINT "bridge_adapter_diagnostics_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."bridge_projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_adapter_diagnostics_project_observed_idx" ON "bridge_adapter_diagnostics" USING btree ("project_id","observed_at");--> statement-breakpoint
CREATE POLICY "bridge_adapter_diagnostics_tenant" ON "bridge_adapter_diagnostics" AS PERMISSIVE FOR ALL TO public USING ("bridge_adapter_diagnostics"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')) WITH CHECK ("bridge_adapter_diagnostics"."organization_id" = nullif(current_setting('bridge.organization_id', true), ''));
