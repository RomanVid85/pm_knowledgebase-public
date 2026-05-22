-- 0012_external_authoritative_weight.sql
-- Phase 2.6 (part 2 of 2): seed authority_weight.external_authoritative in
-- system_config and recreate the authority_weight() SQL function to include
-- the new tier in its hardcoded fallback CASE. Split from 0011 because
-- Postgres forbids referencing a freshly-added enum value in the same
-- transaction.

-- =============================================================================
-- 1. Seed the weight in system_config
-- =============================================================================
INSERT INTO public.system_config (key, value, description) VALUES
  (
    'authority_weight.external_authoritative',
    '0.7'::jsonb,
    'Multiplicative weight for external_authoritative artifacts in retrieval ranking. Respected third-party content (industry analyst reports, formal standards bodies, well-known whitepapers) without team blessing.'
  )
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 2. Recreate authority_weight() with the new fallback CASE
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
      WHEN 'vendor_canonical'        THEN 1.0
      WHEN 'vendor_reference'        THEN 0.85
      WHEN 'external_authoritative'  THEN 0.7
      WHEN 'internal_canonical'      THEN 0.75
      WHEN 'internal_interpretive'   THEN 0.5
      WHEN 'speculative'             THEN 0.2
      ELSE 0.5
    END::numeric
  );
$$;
