---
name: rule-extraction
description: Use when extracting structured business rules from vendor documentation, API specs, or user guides. Converts prose constraints and validation requirements into machine-readable rules for the rules table. Invoke after artifact ingestion to populate engineering guardrails that will be exposed via MCP.
---

# Rule Extraction Skill

## Purpose

Convert prose vendor documentation into structured, machine-readable business rules that engineers can query via MCP. This is the guardrails layer of the system.

## When invoked

- After an artifact is ingested and before it's made searchable
- When a user explicitly asks to extract rules from a document
- During scheduled refresh jobs that re-extract from updated artifacts

## What makes a good rule

A rule is EXTRACTABLE when:
- It's a specific, verifiable constraint (not a general description)
- It has identifiable conditions (when it applies, to what)
- It would change behavior of code that implements against the system

A rule is NOT extractable when:
- It's marketing copy ("our API is powerful and flexible")
- It's a vague description without constraints ("records can be assigned to users")
- It's a UI instruction rather than a system rule ("click Save to create the record" — not a rule)

## Rule schema

Every extracted rule fits this structure:

```typescript
const RuleSchema = z.object({
  rule_key: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/),
  rule_type: z.enum([
    'validation',       // Constraint on input data (e.g., required fields)
    'capability',       // What the system can/cannot do (e.g., deprecated behavior)
    'constraint',       // Operational limits (e.g., rate limits, page sizes)
    'workflow',         // Required sequences or state transitions
    'data_requirement', // Data that must be provided or present
  ]),
  value: z.record(z.any()), // Structured rule-specific data
  conditions: z.record(z.any()).optional(), // When the rule applies
  source_quote: z.string().min(1), // Direct quote from the source
  source_location: z.object({
    artifact_id: z.string().uuid(),
    chunk_id: z.string().uuid().optional(),
    page_number: z.number().optional(),
    section: z.string().optional(),
  }),
  confidence: z.number().min(0).max(1),
  extraction_notes: z.string().optional(), // Flag ambiguities or concerns
})
```

## rule_key conventions

Dot-separated path. Format: `<vendor>.<domain>.<action>.<specificity>`

Examples:
- `example_vendor.auth.bearer_token_required`
- `example_vendor.resource.create.required_fields`
- `example_vendor.resource.create.uniqueness_per_owner`
- `example_vendor.pagination.limit_max`

Rules MUST be unique on `rule_key`. If re-extracting from updated sources, the newer rule supersedes the older via `superseded_by` chain.

## Prompt template for Claude

Use this as the core prompt for rule extraction. Lives at `src/lib/claude/prompts/extract_rules.ts` (or `.md` if you prefer file-based prompts):

```
You are extracting structured business rules from a vendor documentation artifact.

ARTIFACT METADATA:
- Title: {artifact.title}
- Vendor: {artifact.vendor}
- Version: {artifact.vendor_version}
- Type: {artifact.artifact_type}

CONTENT:
{artifact.extracted_content}

TASK:
Extract all discoverable business rules from this content. A business rule is a 
specific, verifiable constraint that would affect how an engineer implements 
against this system.

Focus on:
1. Required fields (for POSTs, PUTs, creation operations)
2. Enum constraints (allowed values for typed fields)
3. Rate limits, page sizes, and operational constraints
4. Authentication and authorization requirements
5. Uniqueness constraints (e.g., "only one active X per Y")
6. Deprecated behavior (what used to work but no longer does)
7. Version-specific behavior differences
8. Required preconditions (e.g., "consent must be captured before X")

DO NOT extract:
- Marketing descriptions ("our robust API...")
- UI instructions ("click Save to submit")
- Vague statements without constraints
- Information already captured in api_endpoints table (endpoint paths, methods, etc.)

OUTPUT FORMAT:
Return a JSON object matching this schema:
{
  "rules": [
    {
      "rule_key": "lowercase.dot.separated.path",
      "rule_type": "validation|capability|constraint|workflow|data_requirement",
      "value": { ... rule-specific structured data ... },
      "conditions": { ... when the rule applies ... },
      "source_quote": "exact quote from the content",
      "source_location": { "section": "section name if identifiable" },
      "confidence": 0.0-1.0,
      "extraction_notes": "any ambiguity or concern"
    }
  ],
  "extraction_summary": {
    "rule_count": N,
    "flags": ["list of things worth noting about this extraction"]
  }
}

Confidence scoring:
- 0.95+: Explicitly stated as a requirement, unambiguous
- 0.80-0.94: Strongly implied, clear from context
- 0.60-0.79: Inferred, has some ambiguity
- Below 0.60: Don't extract; flag in extraction_notes instead

When you find asymmetries (e.g., different enum values for CREATE vs FILTER on the 
same field), extract them as separate rules AND add an extraction_notes flag.

When you find apparent contradictions within the document itself, DON'T try to 
resolve them. Extract both as separate rules with the contradiction noted. The 
contradiction detection pipeline handles reconciliation.
```

## Examples of well-extracted rules

### Validation rule

```json
{
  "rule_key": "example_vendor.resource.create.required_fields",
  "rule_type": "data_requirement",
  "value": {
    "required": ["owner", "type", "name"],
    "optional": ["description", "tags"],
    "notes": "owner must be an href ending in /id/{value}"
  },
  "conditions": {
    "endpoint": "POST /resources",
    "version": ["v2", "v3"]
  },
  "source_quote": "The resource you want to create. Required: owner, type, name.",
  "confidence": 0.98
}
```

### Capability rule (deprecation)

```json
{
  "rule_key": "example_vendor.resource.create.side_effect_deprecated",
  "rule_type": "capability",
  "value": {
    "deprecated_behavior": "Creating a resource could implicitly start an associated session",
    "deprecated_as_of_version": "v2",
    "current_behavior": "Resource creation no longer starts a session"
  },
  "conditions": { "endpoint": "POST /resources" },
  "source_quote": "As of V2, creating a resource will no longer be able to start a session.",
  "confidence": 0.95
}
```

### Constraint rule

```json
{
  "rule_key": "example_vendor.pagination.limit_max",
  "rule_type": "constraint",
  "value": { "max_page_size": 100, "default_page_size": 10 },
  "conditions": { "endpoint": "GET /resources" },
  "source_quote": "Page size to use for multi-record queries. Defaults to 10. Maximum of 100.",
  "confidence": 0.99
}
```

### Workflow rule

```json
{
  "rule_key": "example_vendor.communication.optin_precondition",
  "rule_type": "workflow",
  "value": {
    "prerequisite": "contact.opt_in_messaging = true",
    "blocked_action": "send messaging"
  },
  "conditions": { "channel": "messaging" },
  "source_quote": "In order to send a message, the contact must first be opted in.",
  "confidence": 0.9,
  "extraction_notes": "Source doesn't describe the API mechanism for capturing opt-in. Need Communication API spec to verify."
}
```

## Examples of BAD extractions to avoid

### Too vague
```json
{
  "rule_key": "example_vendor.resources.work_well",
  "value": { "description": "The API handles resources efficiently" }
}
```
✗ Not a rule. Marketing copy.

### UI instruction misclassified as rule
```json
{
  "rule_key": "example_vendor.mobile.click_save",
  "value": { "action": "click Save to submit form" }
}
```
✗ UI instruction, not a system rule.

### Hallucinated constraint
```json
{
  "rule_key": "example_vendor.auth.token_rotation",
  "value": { "rotation_required_days": 90 }
}
```
✗ If the source doesn't say this, don't extract it. Confidence below 0.6 → don't extract, flag instead.

## Post-extraction workflow

All extracted rules are inserted with `status='pending_verification'`. See `agent_docs/verification_workflow.md` for the verification process.

**Critical**: When AI extracts a rule, both `extracted_by_ai_job_id` AND `extracted_by_ai_job_invoker` must be captured. The invoker is the user who triggered the extraction — they cannot later verify the rule their job produced. See the verification workflow doc for the full constraint.

```typescript
async function persistExtractedRules(
  artifactId: string,
  extractions: RuleExtraction[],
  context: { jobRunId: string; invokerUserId: string }
): Promise<void> {
  for (const ext of extractions) {
    const existing = await getRuleByKey(ext.rule_key)

    if (existing) {
      await markSuperseded(existing.id)
    }

    await supabase.from('rules').insert({
      ...ext,
      source_artifact_id: artifactId,
      status: 'pending_verification',
      extracted_at: new Date().toISOString(),
      extracted_by: null,
      extracted_by_ai_job_id: context.jobRunId,
      extracted_by_ai_job_invoker: context.invokerUserId,
      supersedes: existing?.id,
    })
  }
}
```

The calling Inngest function MUST pass the invoker:

```typescript
export const extractRules = inngest.createFunction(
  { id: 'extract-rules' },
  { event: 'extraction/requested' },
  async ({ event, step }) => {
    const { artifactId, invokerUserId } = event.data
    // ... extraction logic ...
    await persistExtractedRules(artifactId, extractions, {
      jobRunId: event.id,
      invokerUserId,
    })
  }
)
```

When triggering extraction from the UI:

```typescript
await inngest.send({
  name: 'extraction/requested',
  data: {
    artifactId: selectedArtifact.id,
    invokerUserId: currentUser.id,
  },
})
```

For scheduled extraction jobs, the invoker is the admin who configured the schedule, captured at schedule-creation time, not run time.

## Quality metrics to track

- Confidence score distribution across extractions (too many low-confidence → prompt needs tuning)
- Verification approval rate (low rate → prompt is too aggressive)
- Duplicate rule_key collisions (may indicate over-splitting)
- Average rules per artifact (VERY high count → over-extraction)

## Related files

- `agent_docs/verification_workflow.md` — what happens after extraction
- `.claude/skills/authority-tagging` — authority of source affects rule trust
