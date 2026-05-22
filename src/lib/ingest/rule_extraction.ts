// Rule extraction module — schema + the high-level extractRules() function.
//
// Schema follows `.claude/skills/rule-extraction/SKILL.md`. The Inngest
// extract-rules function calls extractRules() and persists results to
// `rules` with status='pending_verification' awaiting two-person review.

import { z } from "zod";
import { callTool } from "@/lib/claude/client";
import {
  buildExtractRulesPrompt,
  type ExtractRulesPromptInputs,
} from "@/lib/claude/prompts/extract_rules";

// rule_key format per SKILL.md: dot-separated path of [a-z0-9_]+ segments.
// Examples: acme.auth.bearer_token_required, cdk.service.appointment.minimum_lead_time
const RULE_KEY_REGEX = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

export const RULE_TYPES = [
  "validation",
  "capability",
  "constraint",
  "workflow",
  "data_requirement",
] as const;

export const ExtractedRuleSchema = z.object({
  rule_key: z
    .string()
    .regex(RULE_KEY_REGEX, "rule_key must be lowercase dot-separated, e.g. vendor.domain.action"),
  rule_type: z.enum(RULE_TYPES),
  // jsonb-typed fields — using passthrough record schemas so the LLM can
  // return arbitrary rule-specific data without us having to enumerate
  // every possible shape.
  value: z.record(z.unknown()),
  conditions: z.record(z.unknown()).optional(),
  source_quote: z.string().min(1),
  source_location: z
    .object({
      section: z.string().optional(),
      chunk_index: z.number().int().min(0).optional(),
    })
    .optional(),
  confidence: z.number().min(0).max(1),
  extraction_notes: z.string().optional(),
});

export const RuleExtractionSchema = z.object({
  rules: z.array(ExtractedRuleSchema).max(20),
});

export type ExtractedRule = z.infer<typeof ExtractedRuleSchema>;
export type RuleExtractionResult = z.infer<typeof RuleExtractionSchema>;

const TOOL_NAME = "extract_rules";
const TOOL_DESCRIPTION =
  "Return the structured business rules extracted from the artifact content. Empty array if no rules found.";

/**
 * Call Claude to extract rules from the given artifact content. Returns the
 * parsed-and-validated rule list. The Inngest function is responsible for
 * persisting these with the right ai_job_id / ai_job_invoker metadata so
 * the two-person verification rule can enforce its constraints.
 */
export async function extractRules(
  inputs: ExtractRulesPromptInputs,
): Promise<RuleExtractionResult> {
  const { systemPrompt, userPrompt } = buildExtractRulesPrompt(inputs);
  return callTool({
    toolName: TOOL_NAME,
    toolDescription: TOOL_DESCRIPTION,
    outputSchema: RuleExtractionSchema,
    systemPrompt,
    userPrompt,
    // Rule extractions can run long — bump the cap from the default 4096.
    maxTokens: 8192,
  });
}
