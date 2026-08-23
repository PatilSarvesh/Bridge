ALTER TABLE "bridge_outbox_deliveries" ADD COLUMN "digest_available_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD COLUMN "digest_lease_until" timestamp with time zone;--> statement-breakpoint
UPDATE "bridge_outbox_deliveries"
SET "digest_available_at" = "updated_at"
WHERE "channel" = 'email' AND "status" = 'deferred' AND "digest_available_at" IS NULL;--> statement-breakpoint
ALTER TABLE "bridge_outbox_deliveries" ADD CONSTRAINT "bridge_outbox_deliveries_digest_schedule_check" CHECK (
  "status" <> 'deferred' OR "preference" <> 'digest' OR "digest_available_at" IS NOT NULL
);--> statement-breakpoint
CREATE INDEX "bridge_outbox_deliveries_digest_available_idx" ON "bridge_outbox_deliveries" USING btree ("status","channel","digest_available_at");
