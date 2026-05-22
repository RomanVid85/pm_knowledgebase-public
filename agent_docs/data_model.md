# Data Model

This is the schema reference. The authoritative DDL lives in `supabase/migrations/` once implemented. This doc explains the model conceptually.

## Core tables overview

- `artifacts` — raw source library (Layer 1). Every uploaded document.
- `chunks` — embedded text chunks for semantic search. Has pgvector `embedding vector(1024)`.
- `topics` — subject matter domains (e.g., "Example Vendor Lead Lifecycle").
- `artifact_topics` — many-to-many joining artifacts to topics with relevance scores.
- `topic_relationships` — explicit graph edges between topics (the graph layer).
- `artifact_relationships` — explicit edges between artifacts (cites, supersedes, contradicts, illustrates).
- `topic_pages` — compiled "current understanding" wiki pages. Versioned.
- `rules` — structured business rules extracted from artifacts. The guardrails layer.
- `api_endpoints` — structured endpoint specs from OpenAPI YAML files.
- `decisions` — decision records. Organizational memory.
- `contradictions` — detected conflicts between sources.
- `brief_drafts` — PM brief drafting surface with first-class citations.
- `users` — extended from Supabase Auth with role and topic_ownerships.
- `ingest_jobs` — audit trail of ingestion operations.

## Design principles

These apply to every table in the schema:

1. **Never hard-delete.** Soft-delete via `status` field. Retention is indefinite.
2. **Authority is a first-class field.** Drives retrieval weighting.
3. **Versioning over editing.** Compiled pages, rules, decisions are versioned via `supersedes`/`superseded_by`.
4. **Extracted structure, not just prose.** API specs, rules, endpoints get their own tables.
5. **Contradictions are objects, not errors.** Conflicts are modeled.
6. **Two-person verification for rules.** Enforced at DB and app layers.
7. **Topics are a graph.** Relationships are explicit.

## Critical column semantics

### artifacts.source_authority

See `authority_model.md` for the full scheme. Enum:
- `vendor_canonical` (weight 1.0)
- `vendor_reference` (weight 0.85)
- `internal_canonical` (weight 0.75)
- `internal_interpretive` (weight 0.5)
- `speculative` (weight 0.2)

### artifacts.status

- `draft` — uploaded but not yet fully ingested
- `active` — live in the knowledge base
- `superseded` — newer version exists, still browsable
- `archived` — explicitly removed from default retrieval (but not deleted)

### rules.status

- `draft` — created but not submitted for verification
- `pending_verification` — awaiting two-person verification
- `active` — verified, exposed via MCP
- `superseded` — replaced by newer rule
- `disputed` — challenged, needs re-verification

### rules.verified_by (the critical column)

The rules table has THREE columns that participate in the verification constraint:

- `extracted_by` — user who extracted the rule (NULL if AI-extracted)
- `extracted_by_ai_job_id` — Inngest run ID (NULL if human-extracted)
- `extracted_by_ai_job_invoker` — user who triggered the AI job (required if AI-extracted)

Exactly one of `extracted_by` and `extracted_by_ai_job_id` must be non-NULL:

```sql
CHECK (
  (extracted_by IS NOT NULL AND extracted_by_ai_job_id IS NULL)
  OR
  (extracted_by IS NULL 
   AND extracted_by_ai_job_id IS NOT NULL 
   AND extracted_by_ai_job_invoker IS NOT NULL)
)
```

And `verified_by` must satisfy the two-person rule against the topic owner, the human extractor, AND the AI job invoker (if any). DB enforcement is split because Postgres forbids subqueries in CHECK constraints:

**Same-row part (CHECK constraint on `rules`):**

```sql
CHECK (
  verified_by IS NULL
  OR (
    -- Verifier cannot be the human extractor (if any)
    (extracted_by IS NULL OR verified_by != extracted_by)
    AND
    -- Verifier cannot be the AI job's invoker (if AI-extracted)
    (extracted_by_ai_job_invoker IS NULL OR verified_by != extracted_by_ai_job_invoker)
  )
)
```

**Cross-table part (BEFORE INSERT/UPDATE trigger on `rules`):** the trigger looks up `topics.owner_user_id` for the row's `topic_id` and raises a check-violation error if `verified_by` matches. See `enforce_rules_verifier_not_topic_owner()` in `supabase/migrations/0003_compiled.sql`. Like a CHECK, the trigger fires only on insert/update of the rules row — it does NOT re-validate already-verified rules when a topic's owner later changes. App-layer enforcement is the second line of defense.

See `verification_workflow.md` for full rationale — particularly why the AI-extracted case uses `extracted_by_ai_job_invoker` rather than treating AI extraction as "no extractor to conflict with."

### topic_relationships.relationship_type

Enum covering the edges the graph supports:
- `depends_on` — A requires B
- `integrates_with` — A and B interact
- `governed_by` — A must comply with B
- `shares_data_with` — A and B exchange data
- `blocks` — A cannot proceed without B
- `supersedes` — A replaces B
- `alternative_to` — A is an alternative to B
- `upstream_of` / `downstream_of` — data flow direction

### artifact_relationships.relationship_type

Enum covering edges between artifacts:
- `cites` — A references B
- `supersedes` — A replaces B
- `contradicts` — A disagrees with B
- `supplements` — A adds context to B
- `implements` — A is an implementation of B
- `illustrates` — A shows an example of B
- `derived_from` — A was built from B

## Indexes that matter

```sql
-- pgvector similarity search
CREATE INDEX ON chunks USING ivfflat (embedding vector_cosine_ops);

-- Retrieval filters
CREATE INDEX ON artifacts (status, source_authority);
CREATE INDEX ON artifacts (vendor, vendor_version);
CREATE INDEX ON artifact_topics (topic_id, relevance_score DESC);

-- Graph traversal (recursive CTEs)
CREATE INDEX ON topic_relationships (source_topic_id, status);
CREATE INDEX ON topic_relationships (target_topic_id, status);

-- Verification queue
CREATE INDEX ON rules (status, topic_id) WHERE status = 'pending_verification';

-- Contradiction aging
CREATE INDEX ON contradictions (status, detected_at) WHERE status = 'open';
```

## Migration strategy

Break the schema into four migrations:

1. `0001_core.sql` — users, artifacts, chunks, topics, artifact_topics
2. `0002_graph.sql` — topic_relationships, artifact_relationships
3. `0003_compiled.sql` — topic_pages, rules, api_endpoints
4. `0004_memory.sql` — decisions, contradictions, brief_drafts, ingest_jobs

This ordering prevents foreign key issues and lets each migration be applied/tested independently.

## Row-Level Security (RLS) considerations

V1 is single-tenant, but design RLS policies from the start so expansion is clean:

```sql
-- Enable RLS on all tables
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;

-- Example policy: authenticated users can read active artifacts
CREATE POLICY "Authenticated users read active artifacts"
  ON artifacts FOR SELECT
  TO authenticated
  USING (status = 'active');

-- Example policy: only topic owners or admins can modify their topics
CREATE POLICY "Topic owners modify their topics"
  ON topics FOR UPDATE
  TO authenticated
  USING (owner_user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
  ));
```

Add RLS from day one even if all current users can see everything. It's much harder to retrofit.

## What NOT to model in V1

- Team-level multi-tenancy (just single team for now)
- Entity-level knowledge graph (people, customers, features as graph nodes) — topic-level only
- Rule conflict resolution engine (surface conflicts, don't auto-resolve)
- Full audit log of every change (ingest_jobs covers ingestion; per-field change tracking waits)

These can be added without breaking the core schema.

## Extension points for later

When we add user research, customer feedback, and application functionality domains:
- New `artifact_type` enum values (`user_interview`, `usability_test`, `customer_feedback`, etc.)
- Potentially a `research_sessions` table for session-level metadata
- A `features` and `feature_capabilities` table cross-referenced to `rules`

Core schema doesn't change.

## Open questions for the implementer

1. **Embedding dimensions**: voyage-4-large supports variable output dimensions. We chose 1024 for a balance of quality and storage. Lock this early — changing dimensions means re-embedding everything.
2. **Chunk size**: Start with 500 tokens / 50 overlap. Revisit after the pilot.
3. **Foreign key deletion behavior**: Most FKs should be `ON DELETE RESTRICT` because we never hard-delete. Using `ON DELETE CASCADE` anywhere is a bug waiting to happen.
4. **Confidence scoring**: LLM-assigned initially. Worth building a calibration pipeline post-pilot.
