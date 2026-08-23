ALTER TABLE "bridge_agent_runs" ADD COLUMN "continuation_mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ALTER COLUMN "continuation_mode" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bridge_run_continuation_locators" ADD COLUMN "vendor_session_id" text;--> statement-breakpoint
ALTER TABLE "bridge_agent_runs" ADD CONSTRAINT "bridge_agent_runs_continuation_mode_check" CHECK ((
        "bridge_agent_runs"."continuation_mode" = 'manual' OR
        ("bridge_agent_runs"."continuation_mode" = 'automatic' AND "bridge_agent_runs"."client" = 'codex' AND "bridge_agent_runs"."capability" IN ('hooks', 'orchestrated'))
      ));--> statement-breakpoint
ALTER TABLE "bridge_run_continuation_locators" ADD CONSTRAINT "bridge_run_continuation_locators_vendor_session_check" CHECK ("bridge_run_continuation_locators"."vendor_session_id" IS NULL OR "bridge_run_continuation_locators"."vendor_session_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');--> statement-breakpoint
ALTER TABLE "bridge_outbox_events" DROP CONSTRAINT IF EXISTS "bridge_outbox_events_type_check";--> statement-breakpoint
ALTER TABLE "bridge_outbox_events" ADD CONSTRAINT "bridge_outbox_events_type_check" CHECK ("type" IN ('notification.created', 'decision.lifecycle_changed', 'question.reassigned', 'run.continuation_ready'));--> statement-breakpoint
ALTER POLICY "bridge_run_continuation_locators_tenant" ON "bridge_run_continuation_locators" TO public USING (exists (
        select 1 from "bridge_agent_runs"
        where "bridge_agent_runs"."id" = "bridge_run_continuation_locators"."run_id"
          and "bridge_agent_runs"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')
      )) WITH CHECK (exists (
        select 1 from "bridge_agent_runs"
        where "bridge_agent_runs"."id" = "bridge_run_continuation_locators"."run_id"
          and "bridge_agent_runs"."organization_id" = nullif(current_setting('bridge.organization_id', true), '')
      ));
