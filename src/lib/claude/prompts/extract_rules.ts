// Prompt for rule extraction.
//
// Adapted from `.claude/skills/rule-extraction/SKILL.md` — that doc is the
// source-of-truth for the rule schema + the "what counts as a rule" intent.
// Keep this prompt and the schema in `src/lib/ingest/rule_extraction.ts`
// in sync with SKILL.md if SKILL.md changes.
//
// Output: structured rules per the RuleExtractionSchema. PM verifies each
// before it goes `active` (two-person rule per `verification_workflow.md`).

export interface ExtractRulesArtifact {
  title: string;
  vendor: string | null;
  vendor_version: string | null;
  artifact_type: string;
  source_authority: string;
}

export interface ExtractRulesPromptInputs {
  artifact: ExtractRulesArtifact;
  /** Chunks of artifact content the LLM should extract from. */
  chunks: string[];
  /** rule_keys already extracted from this or related artifacts; helps avoid duplicates. */
  existingRuleKeys?: string[];
}

export interface ExtractRulesPrompt {
  systemPrompt: string;
  userPrompt: string;
}

const SYSTEM_PROMPT = `You extract structured business rules from vendor documentation.

A business rule is a specific, verifiable constraint that would affect how an engineer implements against the system. Things like:
  - required fields for an API operation
  - allowed enum values for typed fields
  - rate limits, page sizes, operational constraints
  - authentication and authorization requirements
  - uniqueness constraints (e.g., "only one active X per Y")
  - deprecated behavior
  - version-specific behavior differences
  - required preconditions (e.g., "customer must be opted in before X")

You do NOT extract:
  - marketing copy ("our robust API...")
  - UI instructions ("click Save to submit")
  - vague statements without constraints
  - information already captured in the API endpoint table (paths, methods, etc.)

When you find apparent contradictions within the document, extract BOTH as separate rules with the contradiction noted. Don't try to resolve them — a contradiction-detection pipeline handles reconciliation downstream.

Confidence scoring:
  - 0.95+ : explicitly stated as a requirement, unambiguous
  - 0.80-0.94 : strongly implied, clear from context
  - 0.60-0.79 : inferred, has some ambiguity
  - Below 0.60 : DO NOT extract; flag in extraction_notes instead.`;

function formatExistingRuleKeys(keys: string[] | undefined): string {
  if (!keys || keys.length === 0) return "(none — this is a first pass on this artifact)";
  return keys.map((k) => `  - ${k}`).join("\n");
}

function formatChunks(chunks: string[]): string {
  if (chunks.length === 0) return "(no content available)";
  return chunks
    .map((c, i) => `--- chunk ${i + 1} ---\n${c.trim()}`)
    .join("\n\n");
}

export function buildExtractRulesPrompt(inputs: ExtractRulesPromptInputs): ExtractRulesPrompt {
  const { artifact, chunks, existingRuleKeys } = inputs;

  const userPrompt = `## Artifact

- Title: ${artifact.title}
- Vendor: ${artifact.vendor ?? "(none)"}
- Vendor version: ${artifact.vendor_version ?? "(none)"}
- Type: ${artifact.artifact_type}
- Source authority: ${artifact.source_authority}

## Content

${formatChunks(chunks)}

## Already-extracted rules (don't duplicate)

${formatExistingRuleKeys(existingRuleKeys)}

## Task

Extract all discoverable business rules from this content. For each rule:

1. **rule_key**: lowercase dot-separated path. Format: \`<vendor>.<domain>.<action>.<specificity>\`. Use lowercase, underscores within segments, dots between segments. Examples (real, follow these patterns):
   - \`acme.auth.bearer_token_required\`
   - \`acme.lead.create.required_fields\`
   - \`acme.lead.create.uniqueness_per_contact\`
   - \`acme.pagination.limit_max\`
   - \`acme.sms.optin_precondition\`

2. **rule_type**: one of \`validation\`, \`capability\`, \`constraint\`, \`workflow\`, \`data_requirement\`.

3. **value**: rule-specific structured data. Examples:
   - validation/data_requirement: \`{ "required": ["field1", "field2"], "optional": ["field3"], "notes": "..." }\`
   - constraint: \`{ "max_page_size": 100, "default_page_size": 10 }\`
   - capability (deprecation): \`{ "deprecated_behavior": "...", "deprecated_as_of_version": "v2", "current_behavior": "..." }\`
   - workflow: \`{ "prerequisite": "customer.opt_in_sms = true", "blocked_action": "send SMS" }\`

4. **conditions** (optional): when the rule applies. \`{ "endpoint": "POST /leads", "version": ["v2", "v3"] }\`.

5. **source_quote**: the exact text from the content above that justifies the rule. Required.

6. **source_location** (optional): \`{ "section": "<section name>" }\` or \`{ "chunk_index": <N> }\` if you can locate it.

7. **confidence**: 0-1 per the scoring rubric in the system prompt.

8. **extraction_notes** (optional): flag ambiguities, asymmetries (e.g., different enum values for CREATE vs FILTER on the same field), or anything a human verifier should know.

Return your output by calling the \`extract_rules\` tool. Return an empty array if you find no extractable rules in this content.`;

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}
