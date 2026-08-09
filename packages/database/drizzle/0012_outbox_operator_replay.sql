ALTER TABLE "bridge_audit_events" DROP CONSTRAINT "bridge_audit_events_subject_type_check";--> statement-breakpoint
ALTER TABLE "bridge_audit_events" ADD CONSTRAINT "bridge_audit_events_subject_type_check" CHECK ("subject_type" IN ('project', 'question', 'response', 'decision', 'assumption', 'artifact', 'artifact_version', 'context_snapshot', 'run', 'outbox_event'));
