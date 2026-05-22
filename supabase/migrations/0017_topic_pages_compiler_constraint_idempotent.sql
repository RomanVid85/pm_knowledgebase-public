-- 0017_topic_pages_compiler_constraint_idempotent.sql
-- Phase 5 follow-up (Cubic P1): make the compiler-exclusive CHECK from
-- 0016 idempotent so future replays on populated databases don't fail
-- at ADD CONSTRAINT time.
--
-- Background: 0016 added the topic_pages_compiler_exclusive CHECK without
-- NOT VALID, which means PG re-checks every existing row at ADD CONSTRAINT
-- time. On the environments where 0016 has already applied successfully
-- (our Cloud + this branch's preview), this re-add is a no-op. On a NEW
-- environment cloned from a populated DB whose history doesn't include
-- 0016 yet, the bare ADD CONSTRAINT could fail if any pre-existing row
-- violated. NOT VALID + VALIDATE CONSTRAINT is the standard pattern: the
-- constraint applies to future writes immediately, existing rows are
-- scanned in a second step that can be run when the env can tolerate it.
--
-- On our DB: the only topic_pages rows are the three M1 drafts, all
-- properly populated; VALIDATE CONSTRAINT passes cleanly.

ALTER TABLE public.topic_pages
  DROP CONSTRAINT IF EXISTS topic_pages_compiler_exclusive;

ALTER TABLE public.topic_pages
  ADD CONSTRAINT topic_pages_compiler_exclusive CHECK (
    (compiled_by IS NOT NULL AND compiled_by_ai_job_id IS NULL)
    OR
    (compiled_by IS NULL
     AND compiled_by_ai_job_id IS NOT NULL
     AND compiled_by_ai_job_invoker IS NOT NULL)
  ) NOT VALID;

ALTER TABLE public.topic_pages
  VALIDATE CONSTRAINT topic_pages_compiler_exclusive;
