# Architecture

This document describes the four-layer system. Claude should read this when working on cross-layer features or when making architectural decisions.

## The four layers

```
┌───────────────────────────────────────────────────────────────┐
│ Layer 4: Decisions & Contradictions Memory                    │
│   decisions, contradictions tables                            │
│   "What did we decide, what's unresolved, what changed?"      │
└───────────────────────────────────────────────────────────────┘
          ▲
          │
┌───────────────────────────────────────────────────────────────┐
│ Layer 3: Compiled Knowledge Pages                             │
│   topic_pages (versioned), rules, api_endpoints               │
│   "What do we currently believe about X?"                     │
│   AI-generated, refreshable, non-authoritative                │
└───────────────────────────────────────────────────────────────┘
          ▲
          │
┌───────────────────────────────────────────────────────────────┐
│ Layer 2: Structured Index                                     │
│   chunks (pgvector), artifact_topics, topic_relationships     │
│   Authority-weighted, graph-aware retrieval                   │
└───────────────────────────────────────────────────────────────┘
          ▲
          │
┌───────────────────────────────────────────────────────────────┐
│ Layer 1: Raw Source Library                                   │
│   artifacts, Supabase Storage                                 │
│   Close to original format, never hard-deleted                │
└───────────────────────────────────────────────────────────────┘
```

## Layer 1: Raw source library

Every document the system sees. Stored close to original format in Supabase Storage with metadata in the `artifacts` table.

**Principle**: Never hard-delete. Soft-delete via `status` field. Retention is indefinite. Prior versions linked via `supersedes` / `superseded_by` chains.

**What lives here**: vendor API specs, PDFs, sample payloads, meeting notes, PRDs, strategy memos, research, customer feedback.

**What Claude does here**: extraction of metadata, classification, storage. Never interpretation.

## Layer 2: Structured index

Makes Layer 1 content retrievable. Contains:

- `chunks` with pgvector embeddings (1024 dims, voyage-4-large)
- `artifact_topics` many-to-many linking artifacts to topics
- `topic_relationships` explicit graph edges between topics
- `artifact_relationships` explicit edges between artifacts (cites, supersedes, contradicts, illustrates)

**Retrieval formula** (applied in the search query):

```
final_score = semantic_similarity
            * authority_weight(artifact.source_authority)
            * recency_decay(artifact.effective_date)
            * artifact.confidence
            * graph_distance_decay(n_hops_from_anchor_topic)
            * (1 if artifact.status = 'active' else 0)
```

**Authority weights** (tunable config, not hardcoded):
- `vendor_canonical`: 1.0
- `vendor_reference`: 0.85
- `internal_canonical`: 0.75
- `internal_interpretive`: 0.5
- `speculative`: 0.2

**Graph distance decay**: direct topic match = 1.0, 1-hop = 0.7, 2-hop = 0.4, 3+ hops ignored unless explicitly expanded. Edge `strength` modulates.

## Layer 3: Compiled knowledge

AI-generated synthesis of Layer 1 content through Layer 2 retrieval. Three types:

**Topic pages** (`topic_pages` table, versioned). Seven sections:
1. Current view
2. Why we believe it
3. What changed recently
4. Open questions
5. Contradictions
6. Recommended next actions
7. Source artifacts

**Structured rules** (`rules` table). Machine-readable business rules for engineering guardrails. Example:
```json
{
  "rule_key": "example_vendor.resource.create.uniqueness_per_owner",
  "rule_type": "validation",
  "value": { "constraint": "Active resource per owner limited to 1" }
}
```

**API endpoints** (`api_endpoints` table). Structured endpoint specs extracted directly from OpenAPI YAML files.

**Principle**: Compiled pages are the working view, NOT the source of truth. Always cite source artifacts. Always refreshable.

## Layer 4: Decision & contradiction memory

The layer most knowledge bases fail at. Two tables:

**decisions**: what was decided, who decided, when, based on what evidence. Superseded by newer decisions via chain.

**contradictions**: detected conflicts between sources. Must be `resolved` / `dismissed` / `deferred` — not allowed to accumulate silently. Can link to a `decision` that resolves them.

**Principle**: This layer preserves the *shape* of what the team knows, including what they don't know and where they disagree. It's what prevents the system from becoming a polished but misleading wiki.

## How layers interact during ingestion

```
1. Artifact uploaded → Layer 1 (artifacts, Storage)
2. Text extracted, chunked, embedded → Layer 2 (chunks)
3. Topics tagged → Layer 2 (artifact_topics)
4. API endpoints extracted (if OpenAPI) → Layer 3 (api_endpoints)
5. Rules extracted → Layer 3 (rules, status=pending_verification)
6. Topic page refresh triggered → Layer 3 (topic_pages, new version)
7. Contradiction detection runs → Layer 4 (contradictions)
```

## How layers interact during query

```
User query
    ↓
Anchor topic identification (LLM-based)
    ↓
Layer 2 retrieval (authority + graph + recency weighted)
    ↓
Layer 3 compiled page (topic_page) used as primary answer
    ↓
Layer 4 contradictions surfaced as warnings
    ↓
Layer 1 citations linked for drill-down
```

## Why this architecture, specifically

**Why separate compiled pages from raw sources?** Because LLMs generate text that sounds authoritative even when it's synthesizing weak evidence. Forcing a separation makes the synthesis auditable.

**Why explicit topic graph?** Because cross-domain reasoning (system A → system B → governing program → offer) is how real briefs get written. Without explicit edges, retrieval can't traverse relationships correctly.

**Why contradictions as first-class objects?** Because unresolved tensions are signal, not noise. A team that surfaces and tracks disagreements makes better decisions than one that picks a winner silently.

**Why two-person verification for rules?** Because engineering guardrails must be correct. A subtly wrong rule in MCP is worse than no rule at all — engineers trust the system and build against it.

## Anti-patterns to avoid

- **Merging conflicting sources into one narrative.** Preserve the conflict in `contradictions`.
- **Treating compiled pages as source of truth.** They're derivative. Always link to source artifacts.
- **Over-indexing on the graph.** Topic-level edges only in V1. Entity-level graph (specific features, people, customers) comes later.
- **Making retrieval smarter before content is right.** Garbage in → garbage out. Authority tagging matters more than retrieval tuning in V1.
