-- 0008_retrieval_helpers.sql
-- Phase 2.A R10/R11: retrieval-time configuration + scoring helpers + search RPC.
--
-- Adds:
--   - public.system_config: key/value table for runtime-tunable parameters
--     (authority weights, recency half-life, future config). Per Q1
--     resolution in DECISIONS.md 2026-05-08.
--   - public.authority_weight(authority): config-driven multiplicative
--     weight for retrieval ranking. Falls back to authority_model.md defaults
--     if config is missing.
--   - public.recency_decay(effective_date): exp(-ln(2) * months / half_life)
--     bounded to [0, 1]. NULL effective_date and future dates → 1.0.
--   - public.search_chunks(query_embedding, anchor_topic_id, result_limit):
--     pgvector cosine search joined to artifacts, multiplicatively scored,
--     ordered by score DESC.

-- =============================================================================
-- system_config table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.system_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS set_updated_at_system_config ON public.system_config;
CREATE TRIGGER set_updated_at_system_config
  BEFORE UPDATE ON public.system_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read system_config" ON public.system_config;
CREATE POLICY "Authenticated read system_config"
  ON public.system_config FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins write system_config" ON public.system_config;
CREATE POLICY "Admins write system_config"
  ON public.system_config FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

-- =============================================================================
-- Seed default authority weights + recency half-life
-- (defaults match agent_docs/authority_model.md)
-- =============================================================================

INSERT INTO public.system_config (key, value, description) VALUES
  ('authority_weight.vendor_canonical', '1.0'::jsonb,
    'Multiplicative weight for vendor_canonical artifacts in retrieval ranking.'),
  ('authority_weight.vendor_reference', '0.85'::jsonb,
    'Multiplicative weight for vendor_reference artifacts in retrieval ranking.'),
  ('authority_weight.internal_canonical', '0.75'::jsonb,
    'Multiplicative weight for internal_canonical artifacts in retrieval ranking.'),
  ('authority_weight.internal_interpretive', '0.5'::jsonb,
    'Multiplicative weight for internal_interpretive artifacts in retrieval ranking.'),
  ('authority_weight.speculative', '0.2'::jsonb,
    'Multiplicative weight for speculative artifacts in retrieval ranking.'),
  ('recency_decay.half_life_months', '18'::jsonb,
    'Half-life in months for the exponential recency decay function.')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- authority_weight(authority) → numeric in [0, 1]
-- =============================================================================

CREATE OR REPLACE FUNCTION public.authority_weight(authority public.source_authority)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT (value)::text::numeric
     FROM public.system_config
     WHERE key = 'authority_weight.' || authority::text),
    CASE authority
      WHEN 'vendor_canonical'      THEN 1.0
      WHEN 'vendor_reference'      THEN 0.85
      WHEN 'internal_canonical'    THEN 0.75
      WHEN 'internal_interpretive' THEN 0.5
      WHEN 'speculative'           THEN 0.2
      ELSE 0.5
    END::numeric
  );
$$;

-- =============================================================================
-- recency_decay(effective_date) → numeric in [0, 1]
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recency_decay(effective_date timestamptz)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  WITH cfg AS (
    SELECT COALESCE(
      (SELECT (value)::text::numeric
       FROM public.system_config
       WHERE key = 'recency_decay.half_life_months'),
      18.0
    ) AS half_life_months
  )
  SELECT CASE
    WHEN effective_date IS NULL THEN 1.0::numeric
    WHEN effective_date >= now() THEN 1.0::numeric
    ELSE exp(
      -ln(2.0) *
      EXTRACT(EPOCH FROM (now() - effective_date)) / (86400.0 * 30.0) /
      (SELECT half_life_months FROM cfg)
    )::numeric
  END;
$$;

-- =============================================================================
-- search_chunks(query_embedding, anchor_topic_id, result_limit)
-- Multiplicative score = similarity × authority × recency × confidence
-- Filters to artifacts with status='active' and chunks with non-NULL embedding.
-- Optional anchor_topic_id narrows to chunks via artifact_topics.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_chunks(
  query_embedding vector(1024),
  anchor_topic_id uuid DEFAULT NULL,
  result_limit integer DEFAULT 10
)
RETURNS TABLE (
  chunk_id uuid,
  content text,
  section text,
  artifact_id uuid,
  artifact_title text,
  similarity numeric,
  authority numeric,
  recency numeric,
  confidence numeric,
  score numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id AS chunk_id,
    c.content,
    c.section,
    a.id AS artifact_id,
    a.title AS artifact_title,
    (1 - (c.embedding <=> query_embedding))::numeric AS similarity,
    public.authority_weight(a.source_authority) AS authority,
    public.recency_decay(a.effective_date) AS recency,
    a.confidence AS confidence,
    (
      (1 - (c.embedding <=> query_embedding))::numeric
      * public.authority_weight(a.source_authority)
      * public.recency_decay(a.effective_date)
      * a.confidence
    ) AS score
  FROM public.chunks c
  JOIN public.artifacts a ON a.id = c.artifact_id
  WHERE a.status = 'active'
    AND c.embedding IS NOT NULL
    AND (
      anchor_topic_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.artifact_topics at
        WHERE at.artifact_id = a.id
          AND at.topic_id = anchor_topic_id
      )
    )
  ORDER BY score DESC
  LIMIT result_limit;
$$;
