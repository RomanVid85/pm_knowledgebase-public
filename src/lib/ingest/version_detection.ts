// Artifact-version detection per R11 (Phase 2.5 spec).
//
// Heuristic: a new artifact is a likely new VERSION of an existing one when
//   - same vendor (exact match)
//   - vendor_version differs (or one is NULL and the other isn't)
//   - chunk-mean embeddings are highly similar (cosine ≥ 0.75)
//
// This module computes the chunk-mean embedding for the new artifact and for
// each same-vendor candidate, then returns the highest-similarity candidate
// above the threshold. The Inngest suggest-topics step calls this after
// chunks have been persisted; the result is written to
// `artifacts.topic_suggestions.supersedes_candidate` for PM review.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { cosineSimilarity, parseEmbedding } from "./topic_prefilter";

const DEFAULT_SIMILARITY_THRESHOLD = 0.75;

export interface SupersedesCandidate {
  prior_artifact_id: string;
  prior_title: string;
  prior_vendor_version: string | null;
  new_vendor_version: string | null;
  similarity: number;
}

export interface FindSupersedesArgs {
  newArtifactId: string;
  newVendor: string | null;
  newVendorVersion: string | null;
  /** Cosine threshold for flagging a candidate. Default 0.75 per spec R11. */
  threshold?: number;
}

/**
 * Average the embeddings of every chunk for the given artifact_id. Returns
 * null if the artifact has no chunks or no chunks have embeddings.
 */
export async function computeChunkMean(
  supabase: SupabaseClient<Database>,
  artifactId: string,
): Promise<number[] | null> {
  const { data, error } = await supabase
    .from("chunks")
    .select("embedding")
    .eq("artifact_id", artifactId)
    .eq("status", "active");

  if (error) {
    throw new Error(`computeChunkMean: ${error.message}`);
  }
  const rows = data ?? [];
  const vectors: number[][] = [];
  for (const row of rows) {
    const v = parseEmbedding(row.embedding);
    if (v && v.length > 0) vectors.push(v);
  }
  if (vectors.length === 0) return null;

  const dims = vectors[0]!.length;
  const sum = new Array(dims).fill(0) as number[];
  for (const v of vectors) {
    if (v.length !== dims) continue;
    for (let i = 0; i < dims; i++) sum[i]! += v[i]!;
  }
  return sum.map((s) => s / vectors.length);
}

/**
 * Should this pair of (priorVersion, newVersion) be treated as a candidate
 * supersession? Returns true when versions differ in a meaningful way:
 *   - both set, not equal → yes
 *   - one NULL, one set → yes (an unversioned doc + a versioned doc could
 *     plausibly be the same content at two points in time)
 *   - both NULL → no
 *   - both set, equal → no
 */
export function versionsDiffer(prior: string | null, next: string | null): boolean {
  if (prior === null && next === null) return false;
  if (prior === null || next === null) return true;
  return prior !== next;
}

/**
 * Find the most-similar same-vendor active artifact whose vendor_version
 * differs from the new artifact's. Returns null if no candidate clears the
 * similarity threshold, if the new artifact has no vendor, or if it has no
 * chunks yet.
 */
export async function findSupersedesCandidate(
  supabase: SupabaseClient<Database>,
  args: FindSupersedesArgs,
): Promise<SupersedesCandidate | null> {
  const threshold = args.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  if (!args.newVendor) return null;

  const newMean = await computeChunkMean(supabase, args.newArtifactId);
  if (!newMean) return null;

  const { data, error } = await supabase
    .from("artifacts")
    .select("id, title, vendor_version")
    .eq("status", "active")
    .eq("vendor", args.newVendor)
    .neq("id", args.newArtifactId);

  if (error) {
    throw new Error(`findSupersedesCandidate (candidates): ${error.message}`);
  }
  const candidates = data ?? [];
  if (candidates.length === 0) return null;

  let best: SupersedesCandidate | null = null;
  for (const c of candidates) {
    if (!versionsDiffer(c.vendor_version, args.newVendorVersion)) continue;

    const priorMean = await computeChunkMean(supabase, c.id);
    if (!priorMean || priorMean.length !== newMean.length) continue;

    const sim = cosineSimilarity(newMean, priorMean);
    if (sim < threshold) continue;

    if (!best || sim > best.similarity) {
      best = {
        prior_artifact_id: c.id,
        prior_title: c.title,
        prior_vendor_version: c.vendor_version,
        new_vendor_version: args.newVendorVersion,
        similarity: sim,
      };
    }
  }

  return best;
}
