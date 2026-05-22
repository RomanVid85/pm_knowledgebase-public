// Artifact + chunks persister.
//
// Writes the ingestion outputs to public.artifacts, public.artifact_topics,
// and public.chunks. Artifact starts as status='draft'; the Inngest finalize
// step calls markArtifactActive() once everything has succeeded — this keeps
// half-ingested artifacts out of retrieval.
//
// Caller passes a service-role-keyed Supabase client so RLS policies don't
// apply (admin context for ingest pipeline).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type { EmbeddedChunk } from "./embedder";
import type { ExtractedEndpoint } from "./parser";

type ArtifactType = Database["public"]["Enums"]["artifact_type"];
type SourceAuthority = Database["public"]["Enums"]["source_authority"];

export type ArtifactInput = {
  title: string;
  artifactType: ArtifactType;
  sourceAuthority: SourceAuthority;
  vendor?: string;
  vendorVersion?: string;
  sourceUrl?: string;
  storagePath?: string;
  contentHash?: string;
  extractedContent?: string;
  effectiveDate?: string; // ISO timestamp
  uploadedBy: string; // user id
  metadata?: Record<string, unknown>;
};

export type ArtifactTopicInput = {
  topicId: string;
  relevanceScore?: number;
  authorityOverride?: SourceAuthority;
};

export type PersistResult = {
  artifactId: string;
  chunkIds: string[];
};

export async function persistArtifactAndChunks(
  supabase: SupabaseClient<Database>,
  input: {
    artifact: ArtifactInput;
    artifactTopics: ArtifactTopicInput[];
    chunks: EmbeddedChunk[];
  },
): Promise<PersistResult> {
  const { artifact, artifactTopics, chunks } = input;

  // Step 1: artifact row (status='draft' until finalize).
  const { data: artifactRow, error: artifactErr } = await supabase
    .from("artifacts")
    .insert({
      title: artifact.title,
      artifact_type: artifact.artifactType,
      source_authority: artifact.sourceAuthority,
      vendor: artifact.vendor ?? null,
      vendor_version: artifact.vendorVersion ?? null,
      source_url: artifact.sourceUrl ?? null,
      storage_path: artifact.storagePath ?? null,
      content_hash: artifact.contentHash ?? null,
      extracted_content: artifact.extractedContent ?? null,
      effective_date: artifact.effectiveDate ?? null,
      uploaded_by: artifact.uploadedBy,
      metadata: (artifact.metadata ?? {}) as never,
      status: "draft",
    })
    .select("id")
    .single();

  if (artifactErr || !artifactRow) {
    throw new Error(
      `artifact insert failed: ${artifactErr?.message ?? "no row returned"}`,
    );
  }
  const artifactId = artifactRow.id;

  // Step 2: artifact_topics rows.
  if (artifactTopics.length > 0) {
    const { error: topicsErr } = await supabase.from("artifact_topics").insert(
      artifactTopics.map((at) => ({
        artifact_id: artifactId,
        topic_id: at.topicId,
        relevance_score: at.relevanceScore ?? 1.0,
        authority_override: at.authorityOverride ?? null,
      })),
    );
    if (topicsErr) {
      throw new Error(`artifact_topics insert failed: ${topicsErr.message}`);
    }
  }

  // Step 3: chunks rows (with serialized pgvector embeddings).
  let chunkIds: string[] = [];
  if (chunks.length > 0) {
    const { data: chunkRows, error: chunksErr } = await supabase
      .from("chunks")
      .insert(
        chunks.map((c) => ({
          artifact_id: artifactId,
          chunk_index: c.chunkIndex,
          content: c.content,
          content_hash: c.contentHash,
          token_count: c.tokenCount,
          embedding: vectorLiteral(c.embedding),
          section: c.section,
          status: "active",
        })),
      )
      .select("id");
    if (chunksErr || !chunkRows) {
      throw new Error(`chunks insert failed: ${chunksErr?.message ?? "no rows returned"}`);
    }
    chunkIds = chunkRows.map((r) => r.id);
  }

  return { artifactId, chunkIds };
}

/**
 * Persist chunks for an artifact that already exists. Used by the Inngest
 * `ingest-artifact` function after the upload server action has already
 * INSERTed the artifact row in 'draft' status.
 *
 * Idempotent: uses upsert with onConflict on the chunks_artifact_id_chunk_index_key
 * UNIQUE constraint. If a previous run partially succeeded (chunks inserted but
 * a later step failed), an Inngest replay won't double-insert and crash —
 * existing rows are skipped, the step returns cleanly, and the function
 * proceeds to finalize.
 */
export async function persistChunks(
  supabase: SupabaseClient<Database>,
  artifactId: string,
  chunks: EmbeddedChunk[],
): Promise<{ chunkIds: string[] }> {
  if (chunks.length === 0) return { chunkIds: [] };

  const { data, error } = await supabase
    .from("chunks")
    .upsert(
      chunks.map((c) => ({
        artifact_id: artifactId,
        chunk_index: c.chunkIndex,
        content: c.content,
        content_hash: c.contentHash,
        token_count: c.tokenCount,
        embedding: vectorLiteral(c.embedding),
        section: c.section,
        status: "active",
      })),
      {
        onConflict: "artifact_id,chunk_index",
        ignoreDuplicates: true,
      },
    )
    .select("id");

  if (error) {
    throw new Error(`chunks upsert failed: ${error.message}`);
  }
  return { chunkIds: (data ?? []).map((r) => r.id) };
}

/**
 * Persist OpenAPI endpoints extracted from a parsed spec. Idempotent on the
 * api_endpoints UNIQUE constraint (source_artifact_id, http_method, path) so
 * Inngest retries are safe.
 */
export async function persistApiEndpoints(
  supabase: SupabaseClient<Database>,
  artifactId: string,
  endpoints: ExtractedEndpoint[],
  vendor?: string,
): Promise<{ endpointIds: string[] }> {
  if (endpoints.length === 0) return { endpointIds: [] };

  const { data, error } = await supabase
    .from("api_endpoints")
    .upsert(
      endpoints.map((ep) => ({
        source_artifact_id: artifactId,
        vendor: vendor ?? null,
        http_method: ep.method,
        path: ep.path,
        operation_id: ep.operationId,
        summary: ep.summary,
        description: ep.description,
        parameters: ep.parameters as never,
        request_body: ep.requestBody as never,
        responses: ep.responses as never,
        security: ep.security as never,
        tags: ep.tags,
        deprecated: ep.deprecated,
        status: "active" as const,
      })),
      {
        onConflict: "source_artifact_id,http_method,path",
        ignoreDuplicates: true,
      },
    )
    .select("id");

  if (error) {
    throw new Error(`api_endpoints upsert failed: ${error.message}`);
  }
  return { endpointIds: (data ?? []).map((r) => r.id) };
}

export async function markArtifactActive(
  supabase: SupabaseClient<Database>,
  artifactId: string,
): Promise<void> {
  const { error } = await supabase
    .from("artifacts")
    .update({ status: "active" })
    .eq("id", artifactId);
  if (error) {
    throw new Error(`Failed to activate artifact ${artifactId}: ${error.message}`);
  }
}

/**
 * Persist extracted rules for an artifact.
 *
 * Rules carry `extracted_by_ai_job_id` (Inngest event id) and
 * `extracted_by_ai_job_invoker` (the user who triggered the job) per
 * `agent_docs/verification_workflow.md` so the two-person verification
 * rule can be enforced — the invoker cannot also be the verifier.
 *
 * Idempotency: skips rules whose `rule_key` already exists in any
 * non-superseded state (draft / pending_verification / active / disputed).
 * That matches the partial unique index `uq_rules_rule_key_active`. If a
 * rule needs to be re-extracted from updated content, that's a separate
 * supersession flow — not handled here.
 */
export async function persistRules(
  supabase: SupabaseClient<Database>,
  args: {
    artifactId: string;
    topicId: string;
    rules: Array<{
      rule_key: string;
      rule_type: Database["public"]["Enums"]["rule_type"];
      value: Record<string, unknown>;
      conditions?: Record<string, unknown>;
      source_quote: string;
      source_location?: { section?: string; chunk_index?: number };
      confidence: number;
      extraction_notes?: string;
    }>;
    inngestJobId: string;
    invokerUserId: string;
  },
): Promise<{ insertedCount: number; skippedCount: number; insertedRuleIds: string[] }> {
  const { artifactId, topicId, rules, inngestJobId, invokerUserId } = args;
  if (rules.length === 0) {
    return { insertedCount: 0, skippedCount: 0, insertedRuleIds: [] };
  }

  // Pre-check: any rule_keys already live in a non-superseded state get
  // skipped. The partial unique index would reject them at INSERT anyway;
  // checking up front is clearer semantically and lets us report counts.
  const keys = rules.map((r) => r.rule_key);
  const { data: existing, error: lookupErr } = await supabase
    .from("rules")
    .select("rule_key")
    .in("rule_key", keys)
    .in("status", ["draft", "pending_verification", "active", "disputed"]);
  if (lookupErr) {
    throw new Error(`persistRules lookup failed: ${lookupErr.message}`);
  }
  const existingKeys = new Set((existing ?? []).map((r) => r.rule_key));
  const fresh = rules.filter((r) => !existingKeys.has(r.rule_key));
  if (fresh.length === 0) {
    return { insertedCount: 0, skippedCount: rules.length, insertedRuleIds: [] };
  }

  const rows = fresh.map((r) => ({
    rule_key: r.rule_key,
    rule_type: r.rule_type,
    topic_id: topicId,
    source_artifact_id: artifactId,
    value: r.value as never,
    conditions: (r.conditions as never) ?? null,
    source_quote: r.source_quote,
    source_location: (r.source_location as never) ?? null,
    confidence: r.confidence,
    extraction_notes: r.extraction_notes ?? null,
    status: "pending_verification" as const,
    extracted_at: new Date().toISOString(),
    extracted_by: null,
    extracted_by_ai_job_id: inngestJobId,
    extracted_by_ai_job_invoker: invokerUserId,
  }));

  const { data: inserted, error: insertErr } = await supabase
    .from("rules")
    .insert(rows)
    .select("id");
  if (insertErr) {
    throw new Error(`persistRules insert failed: ${insertErr.message}`);
  }
  const insertedRuleIds = (inserted ?? []).map((r) => r.id);
  return {
    insertedCount: insertedRuleIds.length,
    skippedCount: rules.length - fresh.length,
    insertedRuleIds,
  };
}

/**
 * Finalize the ingestion run for an artifact, respecting the Phase 2.5 review
 * gate: if `topic_suggestions` is populated, the artifact stays in `'draft'`
 * pending PM review on `/artifacts/[id]/review`. If `topic_suggestions IS NULL`
 * (suggest-topics step skipped, failed, or disabled by feature flag), the
 * artifact transitions straight to `'active'` — the legacy manual-flow path.
 */
export async function finalizeIngestion(
  supabase: SupabaseClient<Database>,
  artifactId: string,
): Promise<{ activated: boolean; reason: "no-suggestions" | "review-pending" }> {
  const { data, error } = await supabase
    .from("artifacts")
    .select("topic_suggestions")
    .eq("id", artifactId)
    .single();
  if (error || !data) {
    throw new Error(
      `finalizeIngestion: cannot read artifact ${artifactId}: ${error?.message ?? "not found"}`,
    );
  }
  if (data.topic_suggestions !== null) {
    return { activated: false, reason: "review-pending" };
  }
  await markArtifactActive(supabase, artifactId);
  return { activated: true, reason: "no-suggestions" };
}

// Postgres pgvector accepts the literal "[v0,v1,v2,...]" string.
function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
