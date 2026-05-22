-- 0009_artifact_topic_suggestions.sql
-- Phase 2.5 R1: storage for LLM-generated topic suggestions per artifact, plus
-- description embeddings on topics for the always-prefilter pattern (Q5).
--
-- Adds:
--   - public.artifacts.topic_suggestions jsonb — stores Claude's structured
--     suggestion output: { existing: [...], proposed_new: [...],
--     supersedes_candidate?: {...} }. Nullable. Populated by the Inngest
--     suggest-topics step; consumed by the /artifacts/[id]/review page.
--   - public.topics.description_embedding vector(1024) — Voyage embedding of
--     `description`, used to prefilter taxonomy before sending to Claude
--     (top-K cosine search). Nullable; existing rows backfilled by
--     scripts/backfill_topic_embeddings.ts and future inserts embed inline
--     via the review server action.
--
-- No index on topics.description_embedding for now — at V1 taxonomy size
-- (~14 topics, growing slowly), a sequential cosine scan is faster than
-- ivfflat or HNSW. Add an index in a future migration if the taxonomy
-- crosses ~500 rows.

-- =============================================================================
-- artifacts.topic_suggestions
-- =============================================================================

ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS topic_suggestions jsonb;

COMMENT ON COLUMN public.artifacts.topic_suggestions IS
  'LLM-generated topic suggestions from the Inngest suggest-topics step. '
  'Shape: { existing: [{topic_id, confidence, reason}], '
  'proposed_new: [{slug, name, description, vendor, confidence, reason}], '
  'supersedes_candidate?: {prior_artifact_id, prior_title, prior_vendor_version, '
  'new_vendor_version, similarity} }. NULL means the step has not run yet '
  '(or was skipped via the topic_suggestion.enabled feature flag).';

-- =============================================================================
-- topics.description_embedding
-- =============================================================================

ALTER TABLE public.topics
  ADD COLUMN IF NOT EXISTS description_embedding vector(1024);

COMMENT ON COLUMN public.topics.description_embedding IS
  'Voyage voyage-4-large embedding of `description` (document input type). '
  'Used by the always-prefilter step in Inngest suggest-topics to pick the '
  'top-K most-similar topics to send to Claude. Backfilled for existing '
  'rows by scripts/backfill_topic_embeddings.ts; new rows embed inline '
  'when created via the review server action.';
