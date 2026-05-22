-- 0003_compiled.sql
-- Compiled knowledge layer: topic_pages, rules, api_endpoints

-- =============================================================================
-- Enums
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE topic_page_status AS ENUM (
    'draft',
    'active',
    'superseded',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE rule_status AS ENUM (
    'draft',
    'pending_verification',
    'active',
    'superseded',
    'disputed'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE rule_type AS ENUM (
    'validation',
    'capability',
    'constraint',
    'workflow',
    'data_requirement'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE api_endpoint_status AS ENUM (
    'draft',
    'active',
    'deprecated',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =============================================================================
-- topic_pages
-- Versioned compiled "current understanding" pages.
-- Sections per architecture.md:
--   1 current_view, 2 why_we_believe_it, 3 what_changed_recently,
--   4 open_questions, 5 contradictions, 6 recommended_next_actions, 7 source_artifacts
-- Stored as jsonb to keep the schema flexible while compilation prompt evolves.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.topic_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  summary text,
  sections jsonb NOT NULL DEFAULT '{}'::jsonb,   -- the seven compiled sections
  source_artifact_ids uuid[] NOT NULL DEFAULT '{}',
  status topic_page_status NOT NULL DEFAULT 'draft',
  -- ON DELETE SET NULL: deactivated user shouldn't block the page record.
  compiled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  compiled_by_ai_job_id text,
  compiled_at timestamptz NOT NULL DEFAULT now(),
  supersedes uuid REFERENCES public.topic_pages(id),
  superseded_by uuid REFERENCES public.topic_pages(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_id, version)
);

DROP TRIGGER IF EXISTS set_updated_at_topic_pages ON public.topic_pages;
CREATE TRIGGER set_updated_at_topic_pages
  BEFORE UPDATE ON public.topic_pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_topic_pages_topic_status
  ON public.topic_pages(topic_id, status);
CREATE INDEX IF NOT EXISTS idx_topic_pages_topic_version
  ON public.topic_pages(topic_id, version DESC);

ALTER TABLE public.topic_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read active topic_pages" ON public.topic_pages;
CREATE POLICY "Authenticated read active topic_pages"
  ON public.topic_pages FOR SELECT
  TO authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "Topic owners or PMs write topic_pages" ON public.topic_pages;
CREATE POLICY "Topic owners or PMs write topic_pages"
  ON public.topic_pages FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.topics t
      WHERE t.id = topic_pages.topic_id AND t.owner_user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.topics t
      WHERE t.id = topic_pages.topic_id AND t.owner_user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  );

-- =============================================================================
-- rules
-- The guardrails layer with two-person verification (verification_workflow.md).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL,
  rule_type rule_type NOT NULL,
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE RESTRICT,
  source_artifact_id uuid REFERENCES public.artifacts(id) ON DELETE RESTRICT,
  source_chunk_id uuid REFERENCES public.chunks(id) ON DELETE RESTRICT,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  conditions jsonb,
  source_quote text,
  source_location jsonb,
  confidence numeric(4,3) NOT NULL DEFAULT 0.000
    CHECK (confidence >= 0 AND confidence <= 1),
  status rule_status NOT NULL DEFAULT 'draft',
  human_verified boolean NOT NULL DEFAULT false,
  -- Extraction provenance — exactly one of {extracted_by, extracted_by_ai_job_id} is non-NULL.
  extracted_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  extracted_by_ai_job_id text,
  extracted_by_ai_job_invoker uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  extraction_notes text,
  -- Verification (two-person rule enforced via CHECK below).
  verified_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  verified_at timestamptz,
  verification_notes text,
  -- Versioning.
  supersedes uuid REFERENCES public.rules(id),
  superseded_by uuid REFERENCES public.rules(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Exactly one of extracted_by / extracted_by_ai_job_id is non-NULL;
  -- if AI-extracted, the invoker MUST be captured (per verification_workflow.md).
  CONSTRAINT rules_extractor_exclusive CHECK (
    (extracted_by IS NOT NULL AND extracted_by_ai_job_id IS NULL)
    OR
    (extracted_by IS NULL
     AND extracted_by_ai_job_id IS NOT NULL
     AND extracted_by_ai_job_invoker IS NOT NULL)
  ),

  -- Same-row part of the two-person rule: verifier ≠ extractor (if any),
  -- ≠ AI job invoker (if any). Postgres CHECK can't reference other tables,
  -- so the verifier ≠ topic_owner check is enforced by a trigger below.
  CONSTRAINT rules_verifier_not_extractor CHECK (
    verified_by IS NULL
    OR (
      (extracted_by IS NULL OR verified_by != extracted_by)
      AND
      (extracted_by_ai_job_invoker IS NULL OR verified_by != extracted_by_ai_job_invoker)
    )
  )
);

-- Cross-table part of the two-person rule: verifier ≠ topic owner.
-- Implemented as a trigger because Postgres forbids subqueries in CHECK.
-- Note: like a CHECK constraint, this fires on INSERT/UPDATE of the rules row;
-- it does not re-validate existing rules when a topic's owner changes (matches
-- documented behavior in verification_workflow.md). App-layer enforcement is
-- the second line of defense.
CREATE OR REPLACE FUNCTION public.enforce_rules_verifier_not_topic_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  IF NEW.verified_by IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT owner_user_id INTO v_owner_id
    FROM public.topics
    WHERE id = NEW.topic_id;

  IF v_owner_id IS NOT NULL AND NEW.verified_by = v_owner_id THEN
    RAISE EXCEPTION
      'rules.verified_by (%) cannot be the topic owner of topic %',
      NEW.verified_by, NEW.topic_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_rules_verifier_not_topic_owner_trg ON public.rules;
CREATE TRIGGER enforce_rules_verifier_not_topic_owner_trg
  BEFORE INSERT OR UPDATE OF verified_by, topic_id ON public.rules
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rules_verifier_not_topic_owner();

DROP TRIGGER IF EXISTS set_updated_at_rules ON public.rules;
CREATE TRIGGER set_updated_at_rules
  BEFORE UPDATE ON public.rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- rule_key uniqueness is "one active version at a time"; older versions are
-- superseded and remain in the table for audit, so the unique index is partial.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rules_rule_key_active
  ON public.rules(rule_key)
  WHERE status IN ('active', 'pending_verification', 'draft', 'disputed');

CREATE INDEX IF NOT EXISTS idx_rules_topic_status ON public.rules(topic_id, status);
CREATE INDEX IF NOT EXISTS idx_rules_pending_verification
  ON public.rules(status, topic_id) WHERE status = 'pending_verification';
CREATE INDEX IF NOT EXISTS idx_rules_active_verified
  ON public.rules(topic_id, status) WHERE status = 'active' AND human_verified = true;
CREATE INDEX IF NOT EXISTS idx_rules_source_artifact
  ON public.rules(source_artifact_id);
CREATE INDEX IF NOT EXISTS idx_rules_rule_key ON public.rules(rule_key);

ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read active verified rules" ON public.rules;
CREATE POLICY "Authenticated read active verified rules"
  ON public.rules FOR SELECT
  TO authenticated
  USING (status = 'active' AND human_verified = true);

DROP POLICY IF EXISTS "PMs and SMEs see all rules" ON public.rules;
CREATE POLICY "PMs and SMEs see all rules"
  ON public.rules FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  );

DROP POLICY IF EXISTS "PMs and SMEs write rules" ON public.rules;
CREATE POLICY "PMs and SMEs write rules"
  ON public.rules FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  );

-- =============================================================================
-- api_endpoints
-- Structured endpoint specs from OpenAPI YAML files.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.api_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE RESTRICT,
  topic_id uuid REFERENCES public.topics(id) ON DELETE RESTRICT,
  vendor text,
  api_version text,
  http_method text NOT NULL,
  path text NOT NULL,
  operation_id text,
  summary text,
  description text,
  parameters jsonb NOT NULL DEFAULT '[]'::jsonb,
  request_body jsonb,
  responses jsonb NOT NULL DEFAULT '{}'::jsonb,
  security jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  status api_endpoint_status NOT NULL DEFAULT 'active',
  deprecated boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_artifact_id, http_method, path)
);

DROP TRIGGER IF EXISTS set_updated_at_api_endpoints ON public.api_endpoints;
CREATE TRIGGER set_updated_at_api_endpoints
  BEFORE UPDATE ON public.api_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_api_endpoints_topic ON public.api_endpoints(topic_id);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_vendor_version
  ON public.api_endpoints(vendor, api_version);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_method_path
  ON public.api_endpoints(http_method, path);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_status
  ON public.api_endpoints(status);

ALTER TABLE public.api_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read active api_endpoints" ON public.api_endpoints;
CREATE POLICY "Authenticated read active api_endpoints"
  ON public.api_endpoints FOR SELECT
  TO authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "PMs and SMEs write api_endpoints" ON public.api_endpoints;
CREATE POLICY "PMs and SMEs write api_endpoints"
  ON public.api_endpoints FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  );
