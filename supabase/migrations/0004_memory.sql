-- 0004_memory.sql
-- Memory layer: decisions, contradictions, brief_drafts, ingest_jobs

-- =============================================================================
-- Enums
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE decision_status AS ENUM (
    'proposed',
    'active',
    'superseded',
    'rejected',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE contradiction_status AS ENUM (
    'open',
    'resolved',
    'dismissed',
    'deferred'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE contradiction_severity AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE brief_draft_status AS ENUM (
    'draft',
    'in_review',
    'final',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE ingest_job_status AS ENUM (
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =============================================================================
-- decisions
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  summary text,
  context text,                                -- the situation that prompted the decision
  decision text NOT NULL,                      -- what was decided
  rationale text,                              -- why
  alternatives_considered jsonb NOT NULL DEFAULT '[]'::jsonb,
  topic_ids uuid[] NOT NULL DEFAULT '{}',      -- topics this decision touches
  evidence_artifact_ids uuid[] NOT NULL DEFAULT '{}',
  status decision_status NOT NULL DEFAULT 'proposed',
  decided_at timestamptz,
  -- ON DELETE SET NULL: deactivated user shouldn't strip provenance from the record.
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  supersedes uuid REFERENCES public.decisions(id),
  superseded_by uuid REFERENCES public.decisions(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_decisions ON public.decisions;
CREATE TRIGGER set_updated_at_decisions
  BEFORE UPDATE ON public.decisions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_decisions_status ON public.decisions(status);
CREATE INDEX IF NOT EXISTS idx_decisions_decided_at
  ON public.decisions(decided_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_decisions_topic_ids
  ON public.decisions USING gin (topic_ids);

ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read active decisions" ON public.decisions;
CREATE POLICY "Authenticated read active decisions"
  ON public.decisions FOR SELECT
  TO authenticated
  USING (status IN ('active', 'proposed', 'superseded'));

DROP POLICY IF EXISTS "PMs and admins write decisions" ON public.decisions;
CREATE POLICY "PMs and admins write decisions"
  ON public.decisions FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  );

-- =============================================================================
-- contradictions
-- Detected conflicts between sources. First-class objects.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.contradictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid REFERENCES public.topics(id) ON DELETE RESTRICT,
  summary text NOT NULL,
  description text,
  severity contradiction_severity NOT NULL DEFAULT 'medium',
  status contradiction_status NOT NULL DEFAULT 'open',
  -- The two (or more) sides of the conflict.
  artifact_a_id uuid REFERENCES public.artifacts(id) ON DELETE RESTRICT,
  artifact_b_id uuid REFERENCES public.artifacts(id) ON DELETE RESTRICT,
  rule_a_id uuid REFERENCES public.rules(id) ON DELETE RESTRICT,
  rule_b_id uuid REFERENCES public.rules(id) ON DELETE RESTRICT,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,    -- quotes, chunk refs, structured payloads
  detected_at timestamptz NOT NULL DEFAULT now(),
  -- ON DELETE SET NULL: deactivated user shouldn't block historical detection record.
  detected_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  detected_by_ai_job_id text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolution_notes text,
  resolving_decision_id uuid REFERENCES public.decisions(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_contradictions ON public.contradictions;
CREATE TRIGGER set_updated_at_contradictions
  BEFORE UPDATE ON public.contradictions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_contradictions_open
  ON public.contradictions(status, detected_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_contradictions_topic
  ON public.contradictions(topic_id);
CREATE INDEX IF NOT EXISTS idx_contradictions_severity
  ON public.contradictions(severity);

ALTER TABLE public.contradictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read contradictions" ON public.contradictions;
CREATE POLICY "Authenticated read contradictions"
  ON public.contradictions FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "PMs and SMEs write contradictions" ON public.contradictions;
CREATE POLICY "PMs and SMEs write contradictions"
  ON public.contradictions FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  );

-- =============================================================================
-- brief_drafts
-- PM brief drafting surface with first-class citations.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.brief_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  -- ON DELETE SET NULL: brief outlives the user account.
  author_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  topic_ids uuid[] NOT NULL DEFAULT '{}',
  body text,                                       -- markdown body
  sections jsonb NOT NULL DEFAULT '{}'::jsonb,     -- structured sections if needed
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{artifact_id, chunk_id?, quote, location}]
  status brief_draft_status NOT NULL DEFAULT 'draft',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_brief_drafts ON public.brief_drafts;
CREATE TRIGGER set_updated_at_brief_drafts
  BEFORE UPDATE ON public.brief_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_brief_drafts_author ON public.brief_drafts(author_user_id);
CREATE INDEX IF NOT EXISTS idx_brief_drafts_status ON public.brief_drafts(status);
CREATE INDEX IF NOT EXISTS idx_brief_drafts_topic_ids
  ON public.brief_drafts USING gin (topic_ids);

ALTER TABLE public.brief_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authors and reviewers read brief_drafts" ON public.brief_drafts;
CREATE POLICY "Authors and reviewers read brief_drafts"
  ON public.brief_drafts FOR SELECT
  TO authenticated
  USING (
    author_user_id = auth.uid()
    OR status IN ('in_review', 'final')
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm'))
  );

DROP POLICY IF EXISTS "Authors write brief_drafts" ON public.brief_drafts;
CREATE POLICY "Authors write brief_drafts"
  ON public.brief_drafts FOR ALL
  TO authenticated
  USING (
    author_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm'))
  )
  WITH CHECK (
    author_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm'))
  );

-- =============================================================================
-- ingest_jobs
-- Audit trail of ingestion operations. Powers cost tracking + provenance.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ingest_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                          -- e.g. 'openapi_yaml', 'pdf_llamaparse', 'rule_extraction'
  status ingest_job_status NOT NULL DEFAULT 'queued',
  -- ON DELETE SET NULL: invoker may be deactivated; keep job record.
  invoker_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  source_artifact_id uuid REFERENCES public.artifacts(id) ON DELETE RESTRICT,
  inngest_run_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  steps_completed jsonb NOT NULL DEFAULT '[]'::jsonb,  -- step log + per-step cost/credits
  error jsonb,                                         -- structured error payload on failure
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_ingest_jobs ON public.ingest_jobs;
CREATE TRIGGER set_updated_at_ingest_jobs
  BEFORE UPDATE ON public.ingest_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status_started
  ON public.ingest_jobs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_source_artifact
  ON public.ingest_jobs(source_artifact_id);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_invoker
  ON public.ingest_jobs(invoker_user_id);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_inngest_run
  ON public.ingest_jobs(inngest_run_id) WHERE inngest_run_id IS NOT NULL;

ALTER TABLE public.ingest_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PMs and admins read ingest_jobs" ON public.ingest_jobs;
CREATE POLICY "PMs and admins read ingest_jobs"
  ON public.ingest_jobs FOR SELECT
  TO authenticated
  USING (
    invoker_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm'))
  );

DROP POLICY IF EXISTS "PMs and admins write ingest_jobs" ON public.ingest_jobs;
CREATE POLICY "PMs and admins write ingest_jobs"
  ON public.ingest_jobs FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm'))
  );
