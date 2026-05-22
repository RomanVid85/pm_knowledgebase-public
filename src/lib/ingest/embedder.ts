// Embedder with content-hash cache.
//
// For each input chunk, we look up `chunks.content_hash` in the DB. If we've
// already embedded this exact content before, reuse the stored vector. Only
// uniquely-uncached hashes get sent to Voyage. This makes re-ingestion of an
// artifact whose 90% of content is unchanged cheap — we only pay to embed
// the 10% that differs.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type { Chunk } from "./chunker";
import { embedDocuments } from "@/lib/voyage/client";

export type EmbeddedChunk = Chunk & {
  embedding: number[];
  cacheHit: boolean;
};

export type EmbedSummary = {
  total: number; // input chunk count
  cacheHits: number; // input chunks resolved from DB cache
  freshlyEmbedded: number; // input chunks needing a fresh Voyage call
  uniqueHashesEmbedded: number; // distinct content hashes sent to Voyage
};

// Voyage allows up to 128 inputs per call (per Voyage's published limits).
const VOYAGE_BATCH_MAX = 128;

export async function embedChunks(
  chunks: Chunk[],
  supabase: SupabaseClient<Database>,
): Promise<{ chunks: EmbeddedChunk[]; summary: EmbedSummary }> {
  if (chunks.length === 0) {
    return {
      chunks: [],
      summary: { total: 0, cacheHits: 0, freshlyEmbedded: 0, uniqueHashesEmbedded: 0 },
    };
  }

  // Collect distinct hashes from input.
  const inputHashes = Array.from(new Set(chunks.map((c) => c.contentHash)));

  // Look up cache.
  const cacheMap = await loadCacheMap(supabase, inputHashes);

  // Identify uncached unique hashes.
  const uncachedHashes = inputHashes.filter((h) => !cacheMap.has(h));

  // Map: hash → first-seen chunk content (for the Voyage call).
  const firstByHash = new Map<string, string>();
  for (const c of chunks) {
    if (!firstByHash.has(c.contentHash)) firstByHash.set(c.contentHash, c.content);
  }

  // Batch uncached texts to Voyage.
  const freshMap = new Map<string, number[]>();
  for (let i = 0; i < uncachedHashes.length; i += VOYAGE_BATCH_MAX) {
    const batchHashes = uncachedHashes.slice(i, i + VOYAGE_BATCH_MAX);
    const batchTexts = batchHashes.map((h) => firstByHash.get(h) ?? "");
    const embeddings = await embedDocuments(batchTexts);
    batchHashes.forEach((h, j) => {
      const emb = embeddings[j];
      if (!emb) {
        throw new Error(`Voyage returned no embedding for hash ${h.slice(0, 8)}`);
      }
      freshMap.set(h, emb);
    });
  }

  // Assemble result in input order.
  const result: EmbeddedChunk[] = chunks.map((c) => {
    const cached = cacheMap.get(c.contentHash);
    if (cached) return { ...c, embedding: cached, cacheHit: true };
    const fresh = freshMap.get(c.contentHash);
    if (!fresh) throw new Error(`No embedding produced for hash ${c.contentHash.slice(0, 8)}`);
    return { ...c, embedding: fresh, cacheHit: false };
  });

  const cacheHits = result.filter((c) => c.cacheHit).length;
  return {
    chunks: result,
    summary: {
      total: chunks.length,
      cacheHits,
      freshlyEmbedded: chunks.length - cacheHits,
      uniqueHashesEmbedded: uncachedHashes.length,
    },
  };
}

async function loadCacheMap(
  supabase: SupabaseClient<Database>,
  hashes: string[],
): Promise<Map<string, number[]>> {
  if (hashes.length === 0) return new Map();
  const { data, error } = await supabase
    .from("chunks")
    .select("content_hash, embedding")
    .in("content_hash", hashes)
    .not("embedding", "is", null);
  if (error) throw new Error(`Embed cache lookup failed: ${error.message}`);

  const map = new Map<string, number[]>();
  for (const row of data ?? []) {
    if (row.content_hash && !map.has(row.content_hash) && row.embedding) {
      // Supabase returns pgvector as either an array or a string like "[0.1,0.2]".
      const emb =
        typeof row.embedding === "string"
          ? (JSON.parse(row.embedding) as number[])
          : (row.embedding as unknown as number[]);
      map.set(row.content_hash, emb);
    }
  }
  return map;
}
