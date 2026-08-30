ALTER TABLE "bridge_outbox_deliveries" DROP CONSTRAINT IF EXISTS "bridge_outbox_deliveries_result_check";--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD CONSTRAINT "bridge_outbox_deliveries_result_check" CHECK ((
        (
          "bridge_outbox_deliveries"."status" = 'delivered'
          AND "bridge_outbox_deliveries"."provider_message_id" IS NOT NULL
          AND length(trim("bridge_outbox_deliveries"."provider_message_id")) > 0
          AND "bridge_outbox_deliveries"."last_error" IS NULL
          AND "bridge_outbox_deliveries"."feedback_provider" IS NULL
          AND "bridge_outbox_deliveries"."feedback_type" IS NULL
          AND "bridge_outbox_deliveries"."feedback_received_at" IS NULL
        )
        OR (
          "bridge_outbox_deliveries"."status" = 'failed'
          AND "bridge_outbox_deliveries"."provider_message_id" IS NULL
          AND "bridge_outbox_deliveries"."last_error" IS NOT NULL
          AND length(trim("bridge_outbox_deliveries"."last_error")) > 0
          AND "bridge_outbox_deliveries"."feedback_provider" IS NULL
          AND "bridge_outbox_deliveries"."feedback_type" IS NULL
          AND "bridge_outbox_deliveries"."feedback_received_at" IS NULL
        )
        OR (
          "bridge_outbox_deliveries"."status" = 'failed'
          AND "bridge_outbox_deliveries"."provider_message_id" IS NOT NULL
          AND length(trim("bridge_outbox_deliveries"."provider_message_id")) > 0
          AND "bridge_outbox_deliveries"."last_error" IS NOT NULL
          AND length(trim("bridge_outbox_deliveries"."last_error")) > 0
          AND "bridge_outbox_deliveries"."feedback_provider" IS NOT NULL
          AND "bridge_outbox_deliveries"."feedback_type" IS NOT NULL
          AND "bridge_outbox_deliveries"."feedback_received_at" IS NOT NULL
        )
        OR (
          "bridge_outbox_deliveries"."status" IN ('suppressed', 'deferred')
          AND "bridge_outbox_deliveries"."provider_message_id" IS NULL
          AND "bridge_outbox_deliveries"."last_error" IS NULL
          AND "bridge_outbox_deliveries"."feedback_provider" IS NULL
          AND "bridge_outbox_deliveries"."feedback_type" IS NULL
          AND "bridge_outbox_deliveries"."feedback_received_at" IS NULL
        )
      ));
