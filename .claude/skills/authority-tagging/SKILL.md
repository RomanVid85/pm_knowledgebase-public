---
name: authority-tagging
description: Use when uploading, ingesting, or classifying any new artifact to the knowledge base. Determines the source_authority level (vendor_canonical, vendor_reference, internal_canonical, internal_interpretive, speculative). Invoke whenever working with artifact creation, bulk ingest pipelines, or when a user asks about how to tag a document. Critical for retrieval quality.
---

# Authority Tagging Skill

## When to use this skill

Any time an artifact is being created, imported, or classified. The `source_authority` field drives retrieval weighting throughout the system, so getting it right matters.

## The six levels

| Level | Weight | Definition |
|---|---|---|
| `vendor_canonical` | 1.0 | Official vendor documentation published by the vendor |
| `vendor_reference` | 0.85 | Official vendor-adjacent material (webinars, sample payloads from vendor) |
| `internal_canonical` | 0.75 | Internal docs the team has deliberately blessed as authoritative |
| `external_authoritative` | 0.7 | Third-party content with reputational trust but no team review |
| `internal_interpretive` | 0.5 | Internal notes, PRDs, meeting summaries |
| `speculative` | 0.2 | Unconfirmed content (Slack threads, tribal knowledge) |

## Decision algorithm

Apply these checks IN ORDER and stop at the first match:

### Step 1: Check the file origin

Is the file from a known vendor domain?

Maintain a list of known vendor domains in your config (e.g., `src/lib/ingest/vendor_inference.ts`). The list is project-specific — populate it with the vendors your pilot covers.

If a known vendor domain is detected → candidate is `vendor_canonical`. Continue to Step 2 to confirm.

### Step 2: Check the file format

For `vendor_canonical` candidates:
- `.yaml` / `.yml` containing `openapi:` → confirmed `vendor_canonical`
- `.json` containing OpenAPI spec → confirmed `vendor_canonical`
- `.pdf` published by vendor → confirmed `vendor_canonical`
- `.html` / `.md` scraped from vendor docs site → confirmed `vendor_canonical`
- `.json` that's a sample API response → demote to `vendor_reference`

### Step 3: Check for speculation markers

Scan the first 500 chars of the document for these phrases:
- "I think", "my understanding is", "not sure but", "probably", "I believe"
- "AFAIK", "TBD", "needs confirmation"
- "@channel", "@here" (suggests chat content)

If found → strong signal for `speculative`. Override to `speculative`.

### Step 4: Check for known third-party / standards sources

If the file origin matches a known industry analyst, standards body, or research source (project-configured list), suggest `external_authoritative`.

### Step 5: Check internal repo signals

If the file lives in:
- `/internal-docs/` or `/team-notes/` → default to `internal_interpretive`
- A known internal repo flagged in config as "blessed" → suggest `internal_canonical` but require human confirmation
- A draft folder or labeled "WIP" → `internal_interpretive`

### Step 6: Default

If no signals matched, default to `internal_interpretive`. This is the safe fallback — low enough to not poison retrieval, but present in the system.

## Critical rules

1. **Never automatically assign `vendor_canonical` without human confirmation.** The pipeline can SUGGEST this level, but a PM must click "confirm" in the UI.

2. **Never automatically assign `internal_canonical`.** This tier is for documents the organization has deliberately decided are authoritative, which requires explicit promotion by a topic owner or SME.

3. **When in doubt, tag lower.** Easier to promote later than to un-poison briefs.

4. **Surface the decision to the user.** Any authority assignment must be shown in the UI with its reasoning, so PMs can override if wrong.

## Implementation in code

```typescript
type AuthorityHint = {
  suggested: SourceAuthority
  confidence: number
  reasoning: string[]
  requires_confirmation: boolean
}

function suggestAuthority(file: FileMetadata, content: string): AuthorityHint {
  const reasoning: string[] = []

  // Step 1: Domain check (project-configured vendor list)
  const vendorDomain = detectVendorDomain(file.origin_url || file.filename)
  if (vendorDomain) {
    reasoning.push(`File appears to be from ${vendorDomain}`)
  }

  // Step 3: Speculation markers
  const specMarkers = detectSpeculationMarkers(content.slice(0, 500))
  if (specMarkers.length > 0) {
    return {
      suggested: 'speculative',
      confidence: 0.9,
      reasoning: [...reasoning, `Contains speculation markers: ${specMarkers.join(', ')}`],
      requires_confirmation: false,
    }
  }

  // Step 2: Format check for vendor files
  if (vendorDomain) {
    if (isOpenApiSpec(file, content)) {
      return {
        suggested: 'vendor_canonical',
        confidence: 0.95,
        reasoning: [...reasoning, 'File is an OpenAPI specification'],
        requires_confirmation: true, // still require PM confirmation
      }
    }
    if (isSamplePayload(file, content)) {
      return {
        suggested: 'vendor_reference',
        confidence: 0.9,
        reasoning: [...reasoning, 'File appears to be a sample payload'],
        requires_confirmation: true,
      }
    }
    return {
      suggested: 'vendor_canonical',
      confidence: 0.7,
      reasoning: [...reasoning, 'Vendor-origin file of unspecified type'],
      requires_confirmation: true,
    }
  }

  // Step 5/6: Default
  return {
    suggested: 'internal_interpretive',
    confidence: 0.5,
    reasoning: ['No vendor or strong authority signals detected'],
    requires_confirmation: false,
  }
}
```

## Always flag these for human review

- Vendor domain but no typical vendor-doc format (might be a copy-paste, might be a third-party commentary)
- File named like "notes" or "draft" but on vendor domain
- File containing mixed content (vendor excerpts + PM commentary)
- File where the date is more than 2 years old (may be stale vendor content)

## Reference

See `agent_docs/authority_model.md` for the full authority model, edge cases, and rationale.
