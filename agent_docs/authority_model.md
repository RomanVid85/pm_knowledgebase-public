# Source Authority Model

This is the most important design element of the knowledge base. Read this before making any decision that involves the `source_authority` field.

## The six levels

Every artifact has one of six `source_authority` values. These drive retrieval weighting, determine what engineers see via MCP, and shape what compiled pages cite.

| Level | Weight | What it means | Examples |
|---|---|---|---|
| `vendor_canonical` | 1.0 | Official vendor documentation published by the vendor | Vendor OpenAPI spec, vendor admin guide, vendor integration docs |
| `vendor_reference` | 0.85 | Official vendor-adjacent material that's authoritative but not primary | Vendor webinars, developer portal blog posts, sample payloads the vendor provides |
| `internal_canonical` | 0.75 | Documents your team has deliberately blessed as authoritative — origin can be anything (vendor doc you excerpted, third-party report you adopted, your own ADR) | Architecture decision records, internal API specs you own, verified integration patterns, a third-party report the team has explicitly reviewed and adopted |
| `external_authoritative` | 0.7 | Respected third-party content that isn't vendor-published and the team hasn't formally vouched for — but the source has reputational trust | Industry analyst reports, formal standards bodies' specs, well-known industry whitepapers |
| `internal_interpretive` | 0.5 | Internal notes, PRDs, meeting summaries — valuable but subjective | PM briefs, meeting notes, strategy docs, draft PRDs, competitor positioning analysis |
| `speculative` | 0.2 | Unconfirmed, partial, or low-confidence content | Slack threads, tribal knowledge captured in a note, "I think X works this way" |

**The line between `internal_canonical` and `external_authoritative`**: explicit team blessing. A respected analyst report sitting unreviewed in a folder is `external_authoritative` — the source has reputational trust but you haven't vouched for it. The same report after a PM reads it, decides it's correct, and adds it to the team's reference set is `internal_canonical` — the team has explicitly endorsed it. The 0.05 weight difference (0.7 vs 0.75) reflects that the act of team review is a real evidentiary signal, even if the underlying content didn't change.

## Why authority matters

Without this model, retrieval treats every document as equally valid. A Slack guess could outrank the actual API documentation. This poisons briefs and creates subtly wrong engineering guardrails.

Authority weighting fixes this. When two documents discuss the same topic, the one with higher authority wins in the ranking. Low-authority documents are still retrievable — they just don't drive the primary answer.

## Assignment rules

### Default on upload

When a PM uploads a document without explicit authority tagging, default to `internal_interpretive`. Never default higher. Promotion to higher tiers is an explicit action requiring review.

### Automatic hints (NOT automatic assignment)

The ingestion pipeline can SUGGEST authority levels based on file characteristics, but the PM must confirm:

- Known vendor domain + published format (PDF, YAML, Swagger) → suggest `vendor_canonical`
- OpenAPI/Swagger spec from vendor → suggest `vendor_canonical`
- OpenAPI/Swagger spec from internal repo → suggest `internal_canonical`
- `.md` file in a known internal repo → suggest `internal_interpretive`
- Filename or metadata indicates a recognised industry / analyst / standards source → suggest `external_authoritative`
- Content contains "my understanding is," "I think," "not sure but" → suggest `speculative`

These are hints, not decisions. The PM confirms.

### Promotion

An artifact CAN be promoted if:
- An SME or topic owner (not the uploader) reviews it
- The reviewer leaves an explicit note about why
- The promotion is logged in `artifact_relationships` with `relationship_type='reviewed_by'`

An artifact CANNOT be promoted automatically. Ever. Hard rule.

### Demotion

An artifact CAN be demoted if:
- Contradicted by a higher-authority source
- Superseded (link via `superseded_by`)
- A reviewer determines it was mis-tagged

Automatic demotion is allowed in one case: when `superseded_by` is set, `status` becomes `superseded` (doesn't change authority but removes from default retrieval).

## Edge cases

### Vendor doc describing a third party's behavior

Vendor A's guide describing a Vendor B integration.

**Rule**: The doc is `vendor_canonical` for Vendor A topics. For Vendor B topics it's `vendor_reference` at best (Vendor A is not authoritative about Vendor B). Multi-tag via `artifact_topics` with different authority per topic, or split into logical sections if tagging per-topic authority isn't enough.

### Internal doc that reproduces vendor content

A PM copies vendor doc content into Notion and adds commentary.

**Rule**: The original vendor doc (when ingested directly) is `vendor_canonical`. The Notion page is `internal_interpretive` — it's a derivative. Link via `artifact_relationships` with `relationship_type='derived_from'`. Don't use the Notion page as authority for facts that exist in the vendor doc — use it only for the PM's commentary.

### Old vendor doc contradicting new vendor doc

Vendor API v2 docs from one year, then v3 docs three years later.

**Rule**: Both remain `vendor_canonical` (both are official). The older gets `status=active` but linked via `supersedes` to v3. In retrieval, the older still scores well on authority but loses on `recency_decay`. If content actively conflicts (not just "newer version"), create a `contradictions` record.

### Sample payload from production traffic

An engineer captures a real API response.

**Rule**: `vendor_reference`. Authoritative about actual behavior (often more than the spec) but not vendor-published. Tag as `artifact_type='sample_payload'`, link to the endpoint via `artifact_relationships` with `relationship_type='illustrates'`.

### Competitor documentation

A competitor product's integration guide brought in for competitive analysis.

**Rule**: Still a vendor doc, just a different vendor. Set `vendor='<CompetitorName>'`, `source_authority='vendor_canonical'`. The vendor field captures *who*, not *whether they're your pilot partner*. Topics proposed by the LLM will naturally be competitor-scoped, which is fine — they coexist with your pilot vendor's topics in the taxonomy.

### Industry analyst report

A well-known analyst's market-overview PDF.

**Rule**: `external_authoritative`. Set `vendor=null` (it's not about a specific vendor). The source has reputational trust but the team hasn't formally reviewed it — so it's not `internal_canonical`. If a PM later reads it, decides it's accurate, and the team adopts its claims, promote to `internal_canonical` via the usual review path. The promotion records *team endorsement*, not a content change.

### Internal competitor analysis brief

A PM's strategy doc analyzing a competitor's product.

**Rule**: `internal_interpretive` + `vendor=null`. It's the team's interpretation, valuable but subjective. Even if it cites vendor sources, the analysis layer is interpretive. Don't tag the brief as `vendor_canonical` for the competitor — the underlying vendor source (if ingested) would carry that tag separately.

### Cross-vendor or vendor-agnostic content

A doc explaining the difference between two product categories generally.

**Rule**: `vendor=null`. Authority depends on origin (vendor publication → `vendor_reference` since it's not authoritative about competitors; internal team doc → `internal_*`; analyst report → `external_authoritative`).

## Anti-patterns

- **Over-promoting internal docs.** Most PM notes are `internal_interpretive`. `internal_canonical` is for documents the org has *deliberately decided* are authoritative after review.
- **Under-promoting vendor sample code.** Sample payloads from vendors are authoritative about real behavior. Don't tag `speculative` just because they're examples.
- **Tagging by file type instead of source.** A PDF can be vendor canonical or a PM's note. Authority is about *source*, not *format*.
- **Silently changing authority during ingestion.** If the pipeline decides to change a level, surface it to the PM for confirmation. Silent changes erode trust.

## Interaction with retrieval

Final retrieval score:

```
final_score = semantic_similarity
            * authority_weight
            * recency_decay
            * confidence
            * graph_distance_decay
            * (1 if status='active' else 0)
```

Two important properties:

1. **Multiplication, not addition.** Low authority AND low recency is penalized twice. Weak sources fall sharply in ranking. This is intentional.
2. **Multiplicative with confidence.** Low confidence (0.6) AND low authority (0.5) gives combined weight 0.3. Both axes must be strong.

## Implementation requirements

When building any feature that uses `source_authority`:

1. Read weights from config, never hardcode
2. Surface authority in UI wherever retrieval results are shown (PMs need to see what's backing an answer)
3. Surface authority in MCP responses (engineers need to know evidence quality)
4. Log algorithmic authority changes for audit
5. Make authority levels filterable in search ("show me only vendor_canonical sources")

## Claude's rule of thumb

When in doubt, tag lower. Easier to promote a low-authority doc later than to discover that a `vendor_canonical`-tagged document was actually a PM's interpretation and has been poisoning briefs for months.
