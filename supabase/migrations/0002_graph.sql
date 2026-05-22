-- 0002_graph.sql
-- Graph layer: topic_relationships, artifact_relationships

-- =============================================================================
-- Enums
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE topic_relationship_type AS ENUM (
    'depends_on',
    'integrates_with',
    'governed_by',
    'shares_data_with',
    'blocks',
    'supersedes',
    'alternative_to',
    'upstream_of',
    'downstream_of'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE artifact_relationship_type AS ENUM (
    'cites',
    'supersedes',
    'contradicts',
    'supplements',
    'implements',
    'illustrates',
    'derived_from',
    'reviewed_by'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE relationship_status AS ENUM (
    'active',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =============================================================================
-- topic_relationships
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.topic_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE RESTRICT,
  target_topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE RESTRICT,
  relationship_type topic_relationship_type NOT NULL,
  strength numeric(4,3) NOT NULL DEFAULT 1.000
    CHECK (strength >= 0 AND strength <= 1),
  status relationship_status NOT NULL DEFAULT 'active',
  notes text,
  -- ON DELETE SET NULL: deactivated user shouldn't break the edge.
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT topic_relationships_no_self_loop
    CHECK (source_topic_id <> target_topic_id),
  UNIQUE (source_topic_id, target_topic_id, relationship_type)
);

DROP TRIGGER IF EXISTS set_updated_at_topic_relationships ON public.topic_relationships;
CREATE TRIGGER set_updated_at_topic_relationships
  BEFORE UPDATE ON public.topic_relationships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_topic_rel_source_status
  ON public.topic_relationships(source_topic_id, status);
CREATE INDEX IF NOT EXISTS idx_topic_rel_target_status
  ON public.topic_relationships(target_topic_id, status);
CREATE INDEX IF NOT EXISTS idx_topic_rel_type
  ON public.topic_relationships(relationship_type);

ALTER TABLE public.topic_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read active topic_relationships" ON public.topic_relationships;
CREATE POLICY "Authenticated read active topic_relationships"
  ON public.topic_relationships FOR SELECT
  TO authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "PMs and admins write topic_relationships" ON public.topic_relationships;
CREATE POLICY "PMs and admins write topic_relationships"
  ON public.topic_relationships FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  );

-- =============================================================================
-- artifact_relationships
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.artifact_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE RESTRICT,
  target_artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE RESTRICT,
  relationship_type artifact_relationship_type NOT NULL,
  status relationship_status NOT NULL DEFAULT 'active',
  notes text,
  -- ON DELETE SET NULL: deactivated user shouldn't break the edge.
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifact_relationships_no_self_loop
    CHECK (source_artifact_id <> target_artifact_id),
  UNIQUE (source_artifact_id, target_artifact_id, relationship_type)
);

DROP TRIGGER IF EXISTS set_updated_at_artifact_relationships ON public.artifact_relationships;
CREATE TRIGGER set_updated_at_artifact_relationships
  BEFORE UPDATE ON public.artifact_relationships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_artifact_rel_source_status
  ON public.artifact_relationships(source_artifact_id, status);
CREATE INDEX IF NOT EXISTS idx_artifact_rel_target_status
  ON public.artifact_relationships(target_artifact_id, status);
CREATE INDEX IF NOT EXISTS idx_artifact_rel_type
  ON public.artifact_relationships(relationship_type);

ALTER TABLE public.artifact_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read active artifact_relationships" ON public.artifact_relationships;
CREATE POLICY "Authenticated read active artifact_relationships"
  ON public.artifact_relationships FOR SELECT
  TO authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "PMs and admins write artifact_relationships" ON public.artifact_relationships;
CREATE POLICY "PMs and admins write artifact_relationships"
  ON public.artifact_relationships FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'pm', 'sme'))
  );
