ALTER TABLE "bridge_outbox_deliveries" DROP CONSTRAINT IF EXISTS "bridge_outbox_deliveries_channel_check";--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD CONSTRAINT "bridge_outbox_deliveries_channel_check" CHECK ("bridge_outbox_deliveries"."channel" IN ('email', 'slack'));
