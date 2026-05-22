// Gather inputs for compile_topic_page from the live DB.
//
// Three slices feed the prompt:
//   1. Topic row (name, description) — frames the compilation
//   2. Active verified rules for the topic — the structured guardrails
//   3. Top ~20 chunks for the topic via search_chunks RPC, using the topic's
//      description_embedding as the "query" (avoids a Voyage round-trip)
//   4. Active artifacts tagged with the topic — drives the source_artifacts
//      section + lets the LLM ground "what changed recently" in effective_date
//
// Returns a single CompilationInputs object the prompt builder consumes.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { parseEmbedding } from "@/lib/ingest/topic_prefilter";

const CHUNK_CAP = 20;
const ARTIFACT_CAP = 30;

export interface TopicForCompilation {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
}

export interface RuleForCompilation {
  id: string;
  rule_key: string;
  rule_type: string;
  value: unknown;
  conditions: unknown;
  source_quote: string | null;
  confidence: number;
  source_artifact_id: string | null;
}

export interface ChunkForCompilation {
  chunk_id: string;
  content: string;
  section: string | null;
  artifact_id: string;
  artifact_title: string;
  score: number;
}

export interface ArtifactForCompilation {
  id: string;
  title: string;
  vendor: string | null;
  vendor_version: string | null;
  source_authority: string;
  effective_date: string | null;
  artifact_type: string;
}

export interface CompilationInputs {
  topic: TopicForCompilation;
  rules: RuleForCompilation[];
  chunks: ChunkForCompilation[];
  artifacts: ArtifactForCompilation[];
}

export async function gatherCompilationInputs(
  supabase: SupabaseClient<Database>,
  topicId: string,
): Promise<CompilationInputs> {
  const { data: topic, error: topicError } = await supabase
    .from("topics")
    .select("id, slug, name, description, owner_user_id, description_embedding")
    .eq("id", topicId)
    .single();
  if (topicError || !topic) {
    throw new Error(`Topic ${topicId} not found: ${topicError?.message ?? "no row"}`);
  }

  const { data: rules, error: rulesError } = await supabase
    .from("rules")
    .select("id, rule_key, rule_type, value, conditions, source_quote, confidence, source_artifact_id")
    .eq("topic_id", topicId)
    .eq("status", "active")
    .eq("human_verified", true)
    .order("confidence", { ascending: false });
  if (rulesError) throw new Error(`Rules fetch failed: ${rulesError.message}`);

  const embedding = parseEmbedding(topic.description_embedding);
  const chunks = embedding ? await fetchTopChunks(supabase, topic.id, embedding) : [];

  const { data: artifactTopics, error: atError } = await supabase
    .from("artifact_topics")
    .select(
      "relevance_score, artifacts!inner(id, title, vendor, vendor_version, source_authority, effective_date, artifact_type, status)",
    )
    .eq("topic_id", topicId)
    .eq("artifacts.status", "active")
    .order("relevance_score", { ascending: false })
    .limit(ARTIFACT_CAP);
  if (atError) throw new Error(`Artifact-topics fetch failed: ${atError.message}`);

  const artifacts: ArtifactForCompilation[] = (artifactTopics ?? [])
    .map((row) => row.artifacts)
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .map((a) => ({
      id: a.id,
      title: a.title,
      vendor: a.vendor,
      vendor_version: a.vendor_version,
      source_authority: a.source_authority,
      effective_date: a.effective_date,
      artifact_type: a.artifact_type,
    }));

  // Drop rules without a source_artifact_id — they can't be cited usefully.
  const filteredRules: RuleForCompilation[] = (rules ?? [])
    .filter((r) => r.source_artifact_id !== null)
    .map((r) => ({
      id: r.id,
      rule_key: r.rule_key,
      rule_type: r.rule_type,
      value: r.value,
      conditions: r.conditions,
      source_quote: r.source_quote,
      confidence: Number(r.confidence),
      source_artifact_id: r.source_artifact_id,
    }));

  return {
    topic: {
      id: topic.id,
      slug: topic.slug,
      name: topic.name,
      description: topic.description,
      owner_user_id: topic.owner_user_id,
    },
    rules: filteredRules,
    chunks,
    artifacts,
  };
}

async function fetchTopChunks(
  supabase: SupabaseClient<Database>,
  topicId: string,
  embedding: number[],
): Promise<ChunkForCompilation[]> {
  const vectorLiteral = `[${embedding.join(",")}]`;
  const { data, error } = await supabase.rpc("search_chunks", {
    query_embedding: vectorLiteral,
    anchor_topic_id: topicId,
    result_limit: CHUNK_CAP,
  });
  if (error) throw new Error(`search_chunks failed: ${error.message}`);
  if (!data) return [];

  return data.map((row) => ({
    chunk_id: row.chunk_id,
    content: row.content,
    section: row.section,
    artifact_id: row.artifact_id,
    artifact_title: row.artifact_title,
    score: Number(row.score),
  }));
}
