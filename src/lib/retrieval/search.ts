// Authority-weighted semantic search.
//
// Embeds the query via Voyage (input_type='query') and runs the search_chunks
// SQL function (defined in migration 0008_retrieval_helpers.sql), which:
//   - Cosine-similarity against pgvector chunks.embedding
//   - Multiplied by authority_weight(source_authority)  (config-driven)
//   - Multiplied by recency_decay(effective_date)       (exp half-life decay)
//   - Multiplied by confidence
//   - Filtered to active artifacts and non-NULL embeddings
//   - Optional anchor_topic_id narrows to chunks via artifact_topics
//
// Returns ranked SearchResult[] with the score breakdown so callers can show
// "why this chunk ranks here" later.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { embedQuery } from "@/lib/voyage/client";

export type ScoreComponents = {
  similarity: number;
  authority: number;
  recency: number;
  confidence: number;
};

export type SearchResult = {
  chunkId: string;
  content: string;
  section: string | null;
  artifactId: string;
  artifactTitle: string;
  score: number;
  components: ScoreComponents;
};

export type SearchOptions = {
  limit?: number;
  anchorTopicId?: string;
};

const DEFAULT_LIMIT = 10;

export async function searchKnowledge(
  supabase: SupabaseClient<Database>,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const limit = options.limit ?? DEFAULT_LIMIT;

  // 1. Embed the query (Voyage applies the query-side prefix internally).
  const queryEmbedding = await embedQuery(trimmed);
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  // 2. Single-roundtrip ranked search via the SQL helper.
  const { data, error } = await supabase.rpc("search_chunks", {
    query_embedding: vectorLiteral,
    ...(options.anchorTopicId !== undefined ? { anchor_topic_id: options.anchorTopicId } : {}),
    result_limit: limit,
  });

  if (error) throw new Error(`Retrieval failed: ${error.message}`);
  if (!data) return [];

  return data.map((row) => ({
    chunkId: row.chunk_id,
    content: row.content,
    section: row.section,
    artifactId: row.artifact_id,
    artifactTitle: row.artifact_title,
    score: Number(row.score),
    components: {
      similarity: Number(row.similarity),
      authority: Number(row.authority),
      recency: Number(row.recency),
      confidence: Number(row.confidence),
    },
  }));
}
