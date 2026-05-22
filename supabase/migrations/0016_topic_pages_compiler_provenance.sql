-- 0016_topic_pages_compiler_provenance.sql
-- Phase 5 R1: add compiler-provenance columns to topic_pages so compilation
-- can be attributed the same way rule extraction is, and so we can rehydrate
-- a compile's inputs for debugging.
--
-- Two columns + one CHECK constraint, mirroring the rules.extracted_by /
-- extracted_by_ai_job_id / extracted_by_ai_job_invoker pattern from
-- 0003_compiled.sql. There's no two-person rule on topic_pages (the review
-- workflow is owner-only publish — see DECISIONS.md and
-- specs/phase_5_topic_page_compilation.md), so no verifier CHECK.

ALTER TABLE public.topic_pages
  ADD COLUMN IF NOT EXISTS compiled_by_ai_job_invoker uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.topic_pages
  ADD COLUMN IF NOT EXISTS compile_inputs jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Exactly one of compiled_by / compiled_by_ai_job_id is non-NULL; if
-- AI-compiled, the invoker MUST be captured.
ALTER TABLE public.topic_pages
  DROP CONSTRAINT IF EXISTS topic_pages_compiler_exclusive;
ALTER TABLE public.topic_pages
  ADD CONSTRAINT topic_pages_compiler_exclusive CHECK (
    (compiled_by IS NOT NULL AND compiled_by_ai_job_id IS NULL)
    OR
    (compiled_by IS NULL
     AND compiled_by_ai_job_id IS NOT NULL
     AND compiled_by_ai_job_invoker IS NOT NULL)
  );

COMMENT ON COLUMN public.topic_pages.compiled_by_ai_job_invoker IS
  'User who triggered the AI compilation job. Required when compiled_by_ai_job_id is set. Enables attribution but does NOT participate in a two-person rule (owner-only publish is sufficient for non-authoritative compiled pages).';

COMMENT ON COLUMN public.topic_pages.compile_inputs IS
  'Snapshot of the prompt inputs (rule_ids, chunk_ids, artifact_ids) used to produce this version. ID-only; rehydrate via JOIN when debugging.';
