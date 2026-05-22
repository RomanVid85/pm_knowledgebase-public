-- 0010_topic_suggestion_config.sql
-- Phase 2.5 R8 / task 2.5.10: seed the topic-suggestion feature config in
-- public.system_config. Defaults here mirror the in-code fallbacks so the
-- runtime behavior is unchanged on a fresh install — these rows exist so
-- the /admin/config UI can surface and tune them per spec R8/R9.
--
-- Idempotent: ON CONFLICT DO NOTHING preserves prior tuning if these
-- rows have been edited via the admin UI before re-running migrations.

INSERT INTO public.system_config (key, value, description) VALUES
  (
    'topic_suggestion.enabled',
    'true'::jsonb,
    'Master switch for the Phase 2.5 suggest-topics flow. When true, uploads skip the topic multiselect, run the Inngest suggest-topics step, and route the PM to /artifacts/{id}/review for curation. When false, the legacy manual-flow path is used: the upload form shows the topic multiselect and Inngest skips suggest-topics.'
  ),
  (
    'topic_suggestion.existing_precheck_threshold',
    '0.7'::jsonb,
    'Confidence threshold above which an existing-topic match is pre-checked on the review page. PMs can still uncheck. Spec R9.'
  ),
  (
    'topic_suggestion.prefilter_top_k',
    '25'::jsonb,
    'Top-K topics (by cosine similarity on description_embedding) to send to Claude in the suggest-topics prompt. At taxonomy size <= K, all topics are sent — graceful degradation. Spec Q5.'
  )
ON CONFLICT (key) DO NOTHING;
