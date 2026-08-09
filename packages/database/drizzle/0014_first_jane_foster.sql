ALTER TABLE "bridge_audit_events" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "bridge_outbox_events" ADD COLUMN "correlation_id" text;--> statement-breakpoint
UPDATE "bridge_audit_events"
SET "correlation_id" = 'cor_legacy_' || md5('audit:' || "id")
WHERE "correlation_id" IS NULL;--> statement-breakpoint
UPDATE "bridge_outbox_events"
SET "correlation_id" = 'cor_legacy_' || md5('outbox:' || "id")
WHERE "correlation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ALTER COLUMN "correlation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_outbox_events" ALTER COLUMN "correlation_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "bridge_audit_events_correlation_idx" ON "bridge_audit_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "bridge_outbox_correlation_idx" ON "bridge_outbox_events" USING btree ("correlation_id");--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD CONSTRAINT "bridge_audit_events_correlation_check" CHECK ("correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');--> statement-breakpoint
ALTER TABLE "bridge_outbox_events" ADD CONSTRAINT "bridge_outbox_events_correlation_check" CHECK ("correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');
