ALTER TABLE "bridge_outbox_deliveries" ADD COLUMN "feedback_provider" text;--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD COLUMN "feedback_type" text;--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD COLUMN "feedback_received_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "bridge_outbox_deliveries_project_channel_provider_idx" ON "bridge_outbox_deliveries" USING btree ("project_id","channel","provider_message_id");--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD CONSTRAINT "bridge_outbox_deliveries_feedback_check" CHECK ((
        ("bridge_outbox_deliveries"."feedback_provider" IS NULL AND "bridge_outbox_deliveries"."feedback_type" IS NULL AND "bridge_outbox_deliveries"."feedback_received_at" IS NULL)
        OR (
          "bridge_outbox_deliveries"."feedback_provider" IN ('ses', 'slack')
          AND "bridge_outbox_deliveries"."feedback_type" IN ('bounce', 'complaint', 'provider_failure')
          AND "bridge_outbox_deliveries"."feedback_received_at" IS NOT NULL
          AND (
            ("bridge_outbox_deliveries"."channel" = 'email' AND "bridge_outbox_deliveries"."feedback_provider" = 'ses')
            OR ("bridge_outbox_deliveries"."channel" = 'slack' AND "bridge_outbox_deliveries"."feedback_provider" = 'slack')
          )
        )
      ));
