CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "bridge_questions_full_text_idx" ON "bridge_questions" USING gin ((
      setweight(to_tsvector('simple', coalesce("project_id", '')), 'D') ||
      setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
      setweight(to_tsvector('simple', coalesce("context", '')), 'B')
    ));--> statement-breakpoint
CREATE INDEX "bridge_questions_title_trigram_idx" ON "bridge_questions" USING gin (lower("project_id" || ':' || "title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bridge_questions_context_trigram_idx" ON "bridge_questions" USING gin (lower("project_id" || ':' || "context") gin_trgm_ops);
