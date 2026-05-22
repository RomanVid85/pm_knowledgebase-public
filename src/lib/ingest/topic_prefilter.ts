// Topic prefilter: at V1 scale (~14-50 active topics), pull every active
// topic's description embedding and compute cosine similarity in JS rather
// than going through a Postgres RPC. Simpler to test, no migration churn,
// negligible cost at this size. Revisit when active topics > ~1000.
//
// Per Q5 (DECISIONS.md 2026-05-12): always-prefilter — we send the top-K
// most-similar topics to Claude regardless of taxonomy size. At ≤K topics,
// this degrades to "send all", which is the V1 reality.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type { TaxonomyTopic } from "@/lib/claude/prompts/suggest_topics";

const DEFAULT_K = 25;
const CONFIG_KEY = "topic_suggestion.prefilter_top_k";

/**
 * Cosine similarity between two equal-length numeric vectors.
 * Returns a value in [-1, 1]; 1 = identical direction, 0 = orthogonal.
 * Returns 0 if either vector is zero-magnitude (avoids NaN).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: vector length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    aMag += ai * ai;
    bMag += bi * bi;
  }
  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

/**
 * Parse a pgvector value that supabase-js returns. The supabase JS client
 * returns vector columns as either an array of numbers (when fetched as JSON)
 * or as the string serialization `"[0.1,0.2,...]"`. Handle both.
 */
export function parseEmbedding(raw: unknown): number[] | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === "string") {
    // pgvector stringified form: "[a,b,c]"
    const trimmed = raw.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
    const parts = trimmed.slice(1, -1).split(",");
    return parts.map((p) => Number(p.trim()));
  }
  return null;
}

async function readKFromConfig(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { data, error } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", CONFIG_KEY)
    .maybeSingle();
  if (error || !data) return DEFAULT_K;
  // value is jsonb; could be a bare number like `25` or a wrapper.
  const v = data.value;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  return DEFAULT_K;
}

export interface PrefilterOptions {
  /** Override the configured K (skips the system_config read). */
  k?: number;
}

/**
 * Return the top-K topics whose `description_embedding` is most similar
 * (cosine) to `queryEmbedding`. Filters to `status='active'` and to topics
 * that have an embedding (NULL embeddings are skipped — they're un-rankable
 * but indicate a backfill gap; log if you hit this in production).
 */
export async function prefilterTopics(
  queryEmbedding: number[],
  supabase: SupabaseClient<Database>,
  options: PrefilterOptions = {},
): Promise<TaxonomyTopic[]> {
  const k = options.k ?? (await readKFromConfig(supabase));

  const { data, error } = await supabase
    .from("topics")
    .select("id, slug, name, description, vendor, description_embedding")
    .eq("status", "active");

  if (error) {
    throw new Error(`prefilterTopics: ${error.message}`);
  }

  const rows = data ?? [];
  const scored: Array<{ topic: TaxonomyTopic; score: number }> = [];

  for (const row of rows) {
    const embedding = parseEmbedding(row.description_embedding);
    if (!embedding || embedding.length !== queryEmbedding.length) continue;
    const score = cosineSimilarity(queryEmbedding, embedding);
    scored.push({
      topic: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description ?? "",
        vendor: row.vendor,
      },
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.topic);
}
