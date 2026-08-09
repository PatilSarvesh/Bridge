CREATE INDEX "bridge_decisions_full_text_idx" ON "bridge_decisions" USING gin ((
        setweight(to_tsvector('simple', coalesce("answer", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce("rationale", '')), 'B') ||
        setweight(to_tsvector('simple', coalesce("category", '')), 'C')
      ));