-- 0001_core.sql
-- Core tables: users, artifacts, chunks, topics, artifact_topics
-- Plus: extensions, set_updated_at() trigger function, all enums.

-- =============================================================================
-- Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram search

-- =============================================================================
-- Shared: updated_at trigger function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- Enums
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE source_authority AS ENUM (
    'vendor_canonical',
    'vendor_reference',
    'internal_canonical',
    'internal_interpretive',
    'speculative'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE artifact_status AS ENUM (
    'draft',
    'active',
    'superseded',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE artifact_type AS ENUM (
    'openapi_spec',
    'pdf_guide',
    'sample_payload',
    'meeting_note',
    'prd',
    'strategy_doc',
    'adr',
    'slack_thread',
    'webinar',
    'blog_post',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'admin',
    'pm',
    'sme',
    'engineer',
    'viewer'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE topic_status AS ENUM (
    'draft',
    'active',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =============================================================================
-- users
-- FK to auth.users handled by an insert trigger in a later migration (task 1.7).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text,
  role user_role NOT NULL DEFAULT 'viewer',
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_users ON public.users;
CREATE TRIGGER set_updated_at_users
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON public.users(status);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read users" ON public.users;
CREATE POLICY "Authenticated read users"
  ON public.users FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins modify users" ON public.users;
CREATE POLICY "Admins modify users"
  ON public.users FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- =============================================================================
-- topics
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  -- ON DELETE SET NULL: a deactivated owner shouldn't break their topics; ownership reassigned by admin.
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  vendor text,
  status topic_status NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_topics ON public.topics;
CREATE TRIGGER set_updated_at_topics
  BEFORE UPDATE ON public.topics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_topics_owner ON public.topics(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_topics_status ON public.topics(status);
CREATE INDEX IF NOT EXISTS idx_topics_vendor ON public.topics(vendor);
CREATE INDEX IF NOT EXISTS idx_topics_name_trgm ON public.topics USING gin (name gin_trgm_ops);

ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read active topics" ON public.topics;
CREATE POLICY "Authenticated read active topics"
  ON public.topics FOR SELECT
  TO authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "Topic owners or admins modify topics" ON public.topics;
CREATE POLICY "Topic owners or admins modify topics"
  ON public.topics FOR ALL
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm'))
  )
  WITH CHECK (
    owner_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm'))
  );

-- =============================================================================
-- artifacts (Layer 1)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  artifact_type artifact_type NOT NULL DEFAULT 'other',
  source_authority source_authority NOT NULL DEFAULT 'internal_interpretive',
  status artifact_status NOT NULL DEFAULT 'draft',
  vendor text,
  vendor_version text,
  source_url text,
  storage_path text,                          -- path in Supabase Storage
  content_hash text,                          -- sha256 of canonical content for de-dup
  extracted_content text,                     -- full text after parsing
  effective_date timestamptz,                 -- date the document is "as of"
  confidence numeric(4,3) NOT NULL DEFAULT 1.000 CHECK (confidence >= 0 AND confidence <= 1),
  -- ON DELETE SET NULL: uploader account deletion shouldn't orphan-block the artifact.
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- supersedes/superseded_by intentionally RESTRICT: chain integrity matters.
  supersedes uuid REFERENCES public.artifacts(id),
  superseded_by uuid REFERENCES public.artifacts(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_artifacts ON public.artifacts;
CREATE TRIGGER set_updated_at_artifacts
  BEFORE UPDATE ON public.artifacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Indexes called out in data_model.md
CREATE INDEX IF NOT EXISTS idx_artifacts_status_authority
  ON public.artifacts(status, source_authority);
CREATE INDEX IF NOT EXISTS idx_artifacts_vendor_version
  ON public.artifacts(vendor, vendor_version);
CREATE INDEX IF NOT EXISTS idx_artifacts_content_hash
  ON public.artifacts(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_effective_date
  ON public.artifacts(effective_date DESC NULLS LAST);

ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read active artifacts" ON public.artifacts;
CREATE POLICY "Authenticated read active artifacts"
  ON public.artifacts FOR SELECT
  TO authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "PMs and admins write artifacts" ON public.artifacts;
CREATE POLICY "PMs and admins write artifacts"
  ON public.artifacts FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  );

-- =============================================================================
-- chunks (Layer 2)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE RESTRICT,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  content_hash text,                          -- enables embed-cache lookup
  token_count integer,
  embedding vector(1024),                     -- voyage-4-large Matryoshka 1024
  section text,                               -- section/heading for citation context
  page_number integer,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, chunk_index)
);

DROP TRIGGER IF EXISTS set_updated_at_chunks ON public.chunks;
CREATE TRIGGER set_updated_at_chunks
  BEFORE UPDATE ON public.chunks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_chunks_artifact ON public.chunks(artifact_id);
CREATE INDEX IF NOT EXISTS idx_chunks_content_hash
  ON public.chunks(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON public.chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read chunks of active artifacts" ON public.chunks;
CREATE POLICY "Authenticated read chunks of active artifacts"
  ON public.chunks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = chunks.artifact_id AND a.status = 'active'
    )
  );

DROP POLICY IF EXISTS "PMs and admins write chunks" ON public.chunks;
CREATE POLICY "PMs and admins write chunks"
  ON public.chunks FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  );

-- =============================================================================
-- artifact_topics (M:N)
-- Per-topic authority override supports the "vendor doc describing third party"
-- edge case from authority_model.md.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.artifact_topics (
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE RESTRICT,
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE RESTRICT,
  relevance_score numeric(4,3) NOT NULL DEFAULT 1.000
    CHECK (relevance_score >= 0 AND relevance_score <= 1),
  authority_override source_authority,        -- per-topic authority override
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artifact_id, topic_id)
);

DROP TRIGGER IF EXISTS set_updated_at_artifact_topics ON public.artifact_topics;
CREATE TRIGGER set_updated_at_artifact_topics
  BEFORE UPDATE ON public.artifact_topics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_artifact_topics_topic_score
  ON public.artifact_topics(topic_id, relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_artifact_topics_artifact
  ON public.artifact_topics(artifact_id);

ALTER TABLE public.artifact_topics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read artifact_topics" ON public.artifact_topics;
CREATE POLICY "Authenticated read artifact_topics"
  ON public.artifact_topics FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "PMs and admins write artifact_topics" ON public.artifact_topics;
CREATE POLICY "PMs and admins write artifact_topics"
  ON public.artifact_topics FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  );
