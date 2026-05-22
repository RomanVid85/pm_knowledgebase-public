---
name: openapi-ingest
description: Use when processing OpenAPI or Swagger YAML/JSON specification files to populate the api_endpoints table. Invoke whenever the user uploads or references a .yaml/.yml/.json file that contains API documentation. Handles OpenAPI 3.x specs, extracts endpoints, schemas, and authentication patterns into structured database rows.
---

# OpenAPI Ingest Skill

## When to use

Any time a file is uploaded that:
- Starts with `openapi: 3.` or `swagger: 2.`
- Has `.yaml`, `.yml`, or `.json` extension and contains `paths:` key
- Is identified by the user as an API specification

## What this skill does

Parses OpenAPI specs directly into structured rows in the `api_endpoints` table, avoiding the lossy chunking-then-embedding path. Also creates an `artifacts` row for the full spec file and embeds descriptions for semantic search.

## Pipeline

```
1. Validate the spec parses (use @apidevtools/swagger-parser)
2. Create artifacts row with source_authority (from authority-tagging skill)
3. For each path in spec.paths:
     For each operation (get, post, put, delete, patch):
       - Extract endpoint metadata
       - Resolve $ref references inline
       - Insert api_endpoints row
       - Generate a semantic chunk from the description + summary for embedding
4. Extract top-level info.description as a chunk (contains auth info)
5. Embed all chunks via Voyage AI
6. Populate api_endpoints, chunks, artifact_topics tables
```

## Critical parsing decisions

### Authentication extraction

OpenAPI specs typically describe auth in `info.description` (prose) OR in `components.securitySchemes` (structured). Check BOTH:

```typescript
function extractAuthInfo(spec: OpenAPISpec): AuthInfo {
  const structured = spec.components?.securitySchemes
  const proseHints = spec.info?.description?.match(/bearer|api.?key|oauth/gi)

  return {
    schemes: structured ?? {},
    description_hints: proseHints ?? [],
  }
}
```

### Version detection

The `info.version` field is the DOC version, not necessarily the API version. Some vendors version via `Accept` headers (e.g., `application/vnd.examplevendor.v3+json`) rather than URL path. Check `paths.*.*.responses.*.content` keys for these patterns.

```typescript
function detectVersioningStrategy(spec: OpenAPISpec): VersioningStrategy {
  // Check for URL path versioning: /v1/, /v2/
  const hasPathVersioning = Object.keys(spec.paths).some(p => /\/v\d+\//.test(p))

  // Check for header versioning in content types
  const contentTypes = getAllContentTypes(spec)
  const hasHeaderVersioning = contentTypes.some(ct => /vnd\.[\w.]+\.v\d+\+/.test(ct))

  if (hasHeaderVersioning) return 'header'
  if (hasPathVersioning) return 'path'
  return 'none'
}
```

### Enum extraction for rule candidates

When an operation parameter has an `enum`, that's a candidate for a `rules` row as a `validation` rule. Flag these during extraction:

```typescript
// Example: TypeEnum found in POST /resources request body
// → Candidate rule: example_vendor.resource.create.allowed_types
//   rule_type: validation
//   value: { allowed_values: ["TYPE_A", "TYPE_B", ...] }
```

Don't AUTO-create rules. Surface them as candidates for the rule-extraction pipeline to evaluate.

### Required field tracking

For request bodies with `required` arrays, extract as candidate `data_requirement` rules:

```typescript
// Example: ResourcePostRequest requires ["owner", "type", "name"]
// → Candidate rule: example_vendor.resource.create.required_fields
//   rule_type: data_requirement
//   value: { required: ["owner", "type", "name"] }
```

### Description vs summary

Both fields often present. `summary` is short (one line), `description` can be long and include HTML. Strategy:
- `api_endpoints.description` = cleaned description (strip HTML tags)
- `api_endpoints.summary` = summary field verbatim
- Chunk for embedding = `${summary}\n\n${cleanedDescription}`

### Handling $ref references

Use `@apidevtools/swagger-parser` to dereference all $refs before extraction. If a schema is referenced 10 times, store it inline in each `api_endpoints.openapi_spec` rather than fighting with reference resolution at query time.

## Topic tagging for endpoints

Each endpoint tags to topics based on:
1. OpenAPI `tags` array on the operation (e.g., `tags: ["Resource Management"]`)
2. Path pattern matching (e.g., `/resources` → Resource Lifecycle topic)
3. Semantic similarity of description to existing topic descriptions (fallback)

```typescript
async function tagEndpointToTopics(
  endpoint: ApiEndpoint,
  topics: Topic[]
): Promise<Array<{ topic_id: string; relevance_score: number }>> {
  const matches: Array<{ topic_id: string; relevance_score: number }> = []

  // Explicit OpenAPI tags
  for (const tag of endpoint.openapi_tags) {
    const topic = topics.find(t => t.name.toLowerCase().includes(tag.toLowerCase()))
    if (topic) matches.push({ topic_id: topic.id, relevance_score: 1.0 })
  }

  // Path-based matching
  const pathTopic = matchPathToTopic(endpoint.endpoint_path, topics)
  if (pathTopic) matches.push({ topic_id: pathTopic.id, relevance_score: 0.9 })

  // Semantic fallback if no explicit matches
  if (matches.length === 0) {
    const semantic = await semanticTopicMatch(endpoint.description, topics)
    matches.push(...semantic.filter(m => m.relevance_score > 0.7))
  }

  return deduplicateByTopicId(matches)
}
```

## What the final artifact row looks like

```typescript
const artifact = {
  title: spec.info.title,
  artifact_type: 'vendor_api_spec',
  source_authority: 'vendor_canonical', // confirmed by human before ingest
  vendor: detectVendor(spec), // inferred from title or contact URL
  vendor_version: spec.info.version,
  effective_date: extractEffectiveDate(spec),
  extracted_metadata: {
    versioning_strategy: 'header',
    auth_schemes: [...],
    operation_count: 32,
    topic_candidates: [...],
  },
  confidence: 0.95,
  status: 'active',
}
```

## Failure modes to handle

1. **Invalid YAML/JSON**: return error, don't partially ingest
2. **Missing `paths`**: probably not an OpenAPI spec; route to generic prose ingestion
3. **Circular $refs**: swagger-parser handles this, but wrap in try/catch
4. **Truly massive specs** (>10MB): chunk the parsing itself; may need to stream
5. **Non-standard OpenAPI extensions** (`x-` prefix): capture in `openapi_spec` JSONB but don't parse semantically

## Reference implementation location

Full implementation should live at `src/lib/ingest/openapi.ts`. Tests at `src/lib/ingest/openapi.test.ts` with a sample OpenAPI YAML fixture from your pilot domain.

## Related skills

- `authority-tagging` — used during step 2 to determine source_authority
- `rule-extraction` — uses the candidate rules flagged during endpoint extraction

## Dependencies

- `@apidevtools/swagger-parser` for robust OpenAPI parsing and $ref resolution
- `js-yaml` for YAML parsing (underlies swagger-parser)
- `zod` for validating parsed structures
