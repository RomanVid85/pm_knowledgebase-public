// Suggest-topics module: schema + the high-level suggestTopics() function
// that bridges the prompt builder and the Claude client.
//
// Used by the Inngest suggest-topics step (R4) and indirectly by the
// review page (which reads the persisted result from `artifacts.topic_suggestions`).

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { callTool } from "@/lib/claude/client";
import {
  buildSuggestTopicsPrompt,
  type SuggestTopicsPromptInputs,
} from "@/lib/claude/prompts/suggest_topics";

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const ExistingMatchSchema = z.object({
  topic_id: z.string().uuid(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export const ProposedNewTopicSchema = z.object({
  slug: z.string().regex(SLUG_REGEX, "slug must be lowercase kebab-case"),
  name: z.string().min(1),
  description: z.string().min(1),
  vendor: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export const SuggestionSchema = z.object({
  existing: z.array(ExistingMatchSchema).max(10),
  proposed_new: z.array(ProposedNewTopicSchema).max(6),
});

export type ExistingMatch = z.infer<typeof ExistingMatchSchema>;
export type ProposedNewTopic = z.infer<typeof ProposedNewTopicSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;

const TOOL_NAME = "suggest_topics";
const TOOL_DESCRIPTION =
  "Return your topic suggestions for the artifact as structured data: existing-topic matches plus any new-topic proposals.";

const FEATURE_FLAG_KEY = "topic_suggestion.enabled";
const DEFAULT_SAMPLE_K = 12;

/**
 * Evenly-distributed chunk indices over [0, total). For total <= k, returns
 * [0, 1, ..., total-1] (everything). For total > k, returns floor(i*total/k)
 * for i in 0..k-1 — first, last-ish, and k-2 in between.
 *
 * Example: total=100, k=12 → [0, 8, 16, 25, 33, 41, 50, 58, 66, 75, 83, 91].
 */
export function stratifiedIndices(total: number, k: number): number[] {
  if (total <= 0 || k <= 0) return [];
  if (total <= k) return Array.from({ length: total }, (_, i) => i);
  return Array.from({ length: k }, (_, i) => Math.floor((i * total) / k));
}

/**
 * Sample up to k chunks from an artifact, evenly distributed across the
 * document (by chunk_index). Replaces the V1 "first 5 chunks" sampling so
 * megadocs get topic suggestions that reflect their full breadth, not just
 * the opening section. Two DB roundtrips: one for total count, one for the
 * selected indices' content.
 */
export async function stratifiedChunkSample(
  supabase: SupabaseClient<Database>,
  artifactId: string,
  k: number = DEFAULT_SAMPLE_K,
): Promise<string[]> {
  const { count, error: countErr } = await supabase
    .from("chunks")
    .select("*", { count: "exact", head: true })
    .eq("artifact_id", artifactId)
    .eq("status", "active");
  if (countErr) {
    throw new Error(`stratifiedChunkSample (count): ${countErr.message}`);
  }
  const total = count ?? 0;
  if (total === 0) return [];

  const indices = stratifiedIndices(total, k);
  const { data, error } = await supabase
    .from("chunks")
    .select("content, chunk_index")
    .eq("artifact_id", artifactId)
    .eq("status", "active")
    .in("chunk_index", indices)
    .order("chunk_index", { ascending: true });
  if (error) {
    throw new Error(`stratifiedChunkSample (select): ${error.message}`);
  }
  return (data ?? []).map((r) => r.content);
}

/**
 * Read the topic-suggestion feature flag from `system_config`. Defaults to
 * `true` when the row is absent (per spec R8: default true).
 */
export async function isTopicSuggestionEnabled(
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", FEATURE_FLAG_KEY)
    .maybeSingle();
  if (error || !data) return true;
  const v = data.value;
  // The seed may persist as bare `true` (jsonb boolean), string "true", or
  // even the number 1 — accept all truthy variants conservatively.
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null) return false;
  if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
  return true;
}

/**
 * Call Claude to generate topic suggestions for the given artifact + prefiltered
 * taxonomy. Returns the parsed-and-validated Suggestion shape.
 */
export async function suggestTopics(inputs: SuggestTopicsPromptInputs): Promise<Suggestion> {
  const { systemPrompt, userPrompt } = buildSuggestTopicsPrompt(inputs);
  return callTool({
    toolName: TOOL_NAME,
    toolDescription: TOOL_DESCRIPTION,
    outputSchema: SuggestionSchema,
    systemPrompt,
    userPrompt,
  });
}
