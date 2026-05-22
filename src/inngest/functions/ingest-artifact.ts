// Inngest function: orchestrates artifact ingestion.
//
// Triggered by 'ingest/artifact-uploaded' (sent by the /upload server action
// after the artifact row + storage object have been created with status='draft').
//
// Steps are idempotent so Inngest's retry policy is safe:
//   1. load-metadata     — fetch storage_path from artifacts row
//   2. download-file     — pull bytes from Storage
//   3. parse             — file-type-aware parser
//   4. chunk             — section-aware chunker
//   5. embed             — Voyage embed (with content-hash cache)
//   6. persist-chunks    — INSERT chunks rows
//   6b. extract-endpoints — OpenAPI specs only; populate api_endpoints
//   6c. suggest-topics   — Phase 2.5: prefilter taxonomy → Claude →
//                          version-detection → write topic_suggestions
//   7. finalize          — flip status='active' UNLESS topic_suggestions
//                          is populated (then artifact waits for PM review)

import { NonRetriableError } from "inngest";
import type { Json } from "@/types/supabase";
import { inngest } from "@/inngest/client";
import { adminClient } from "@/lib/supabase/admin";
import { downloadArtifact } from "@/lib/storage/artifacts";
import { parseFile, parseMarkdown, type ParsedDocument } from "@/lib/ingest/parser";
import { chunk } from "@/lib/ingest/chunker";
import { embedChunks } from "@/lib/ingest/embedder";
import { persistChunks, persistApiEndpoints, finalizeIngestion } from "@/lib/ingest/persister";
import { computeChunkMean, findSupersedesCandidate } from "@/lib/ingest/version_detection";
import { prefilterTopics } from "@/lib/ingest/topic_prefilter";
import {
  suggestTopics,
  isTopicSuggestionEnabled,
  stratifiedChunkSample,
} from "@/lib/ingest/topic_suggestion";
import { inferVendor } from "@/lib/ingest/vendor_inference";
import { inferVersion } from "@/lib/ingest/version_inference";

export const ingestArtifact = inngest.createFunction(
  { id: "ingest-artifact", name: "Ingest artifact" },
  { event: "ingest/artifact-uploaded" },
  async ({ event, step }) => {
    const { artifactId } = event.data;

    // 1. Load metadata from the artifacts row.
    const { storagePath, filename } = await step.run("load-metadata", async () => {
      const supabase = adminClient();
      const { data, error } = await supabase
        .from("artifacts")
        .select("storage_path")
        .eq("id", artifactId)
        .single();
      if (error || !data) {
        throw new NonRetriableError(`artifact ${artifactId} not found: ${error?.message ?? ""}`);
      }
      if (!data.storage_path) {
        throw new NonRetriableError(`artifact ${artifactId} has no storage_path`);
      }
      const fname = data.storage_path.split("/").pop() ?? "unknown";
      return { storagePath: data.storage_path, filename: fname };
    });

    // 2. Download the file. Buffer can't survive step.run JSON serialization,
    // so we round-trip through base64.
    const fileBase64 = await step.run("download-file", async () => {
      const buf = await downloadArtifact(storagePath);
      return buf.toString("base64");
    });
    const fileBuffer = Buffer.from(fileBase64, "base64");

    // 3. Parse. PDFs take a split path because LlamaParse (Auto Mode) can
    // run 30 s – 2 min — longer than Vercel's per-invocation timeout. We
    // submit once, poll across steps with `step.sleep` between checks, then
    // fetch the markdown and run it through the same parseMarkdown() the
    // rest of the formats use. Non-PDF formats keep the single-step path.
    const isPdf = filename.toLowerCase().endsWith(".pdf");
    let parsed: ParsedDocument;
    if (isPdf) {
      const llamaparseJobId = await step.run("llamaparse-submit", async () => {
        const { submitJob } = await import("@/lib/llamaparse/client");
        return submitJob(fileBuffer, filename);
      });

      // Bounded poll loop — 30 attempts × 5 s waits = ~2.5 min upper bound,
      // generous for LlamaParse Auto Mode's typical 30-120 s. Each poll is
      // its own short step so Vercel's per-invocation timeout doesn't bite.
      const MAX_POLLS = 30;
      let succeeded = false;
      for (let i = 0; i < MAX_POLLS; i++) {
        if (i > 0) {
          await step.sleep(`llamaparse-wait-${i}`, "5s");
        }
        const status = await step.run(`llamaparse-poll-${i}`, async () => {
          const { getJobStatus } = await import("@/lib/llamaparse/client");
          return getJobStatus(llamaparseJobId);
        });
        if (status === "SUCCESS") {
          succeeded = true;
          break;
        }
        if (status === "ERROR" || status === "CANCELED") {
          throw new NonRetriableError(
            `LlamaParse job ${llamaparseJobId} ended in ${status}`,
          );
        }
      }
      if (!succeeded) {
        throw new NonRetriableError(
          `LlamaParse job ${llamaparseJobId} did not complete in ${MAX_POLLS} polls`,
        );
      }

      parsed = await step.run("llamaparse-fetch-result", async () => {
        const { getResultMarkdown } = await import("@/lib/llamaparse/client");
        const markdown = await getResultMarkdown(llamaparseJobId);
        const md = parseMarkdown(markdown);
        return { ...md, format: "pdf" as const, llamaparse_job_id: llamaparseJobId };
      });
    } else {
      parsed = await step.run("parse", async () => {
        return parseFile(fileBuffer, filename);
      });
    }

    // 4. Chunk.
    const chunks = await step.run("chunk", async () => {
      return chunk(parsed);
    });

    // 5. Embed (cache hits skip Voyage).
    const embedded = await step.run("embed", async () => {
      const supabase = adminClient();
      return embedChunks(chunks, supabase);
    });

    // 6. Persist chunks. The artifact row already exists in status='draft' —
    // the upload action created it before sending this event.
    await step.run("persist-chunks", async () => {
      const supabase = adminClient();
      return persistChunks(supabase, artifactId, embedded.chunks);
    });

    // 6b. Extract endpoints (OpenAPI specs only). Populates api_endpoints
    // table with one row per (method, path) — structured surface for
    // engineering queries via MCP later.
    const endpointCount = await step.run("extract-endpoints", async () => {
      if (!parsed.endpoints || parsed.endpoints.length === 0) {
        return 0;
      }
      const supabase = adminClient();
      const { data: artifactRow } = await supabase
        .from("artifacts")
        .select("vendor")
        .eq("id", artifactId)
        .single();
      await persistApiEndpoints(
        supabase,
        artifactId,
        parsed.endpoints,
        artifactRow?.vendor ?? undefined,
      );
      return parsed.endpoints.length;
    });

    // 6c. Suggest-topics (Phase 2.5): prefilter taxonomy by chunk-mean
    // similarity → Claude → write `topic_suggestions` on the artifact.
    // Also runs version-detection (R11) to surface supersession candidates.
    // Failures here are non-fatal — they just leave topic_suggestions NULL,
    // which routes the artifact to the legacy manual-flow at finalize.
    const suggestSummary = await step.run("suggest-topics", async () => {
      const supabase = adminClient();

      const enabled = await isTopicSuggestionEnabled(supabase);
      if (!enabled) return { status: "skipped", reason: "feature-flag-disabled" as const };

      const { data: artifactRow, error: aErr } = await supabase
        .from("artifacts")
        .select("title, vendor, vendor_version, artifact_type, source_authority, storage_path")
        .eq("id", artifactId)
        .single();
      if (aErr || !artifactRow) {
        return { status: "skipped", reason: "no-artifact-row" as const };
      }

      const chunkMean = await computeChunkMean(supabase, artifactId);
      if (!chunkMean) {
        return { status: "skipped", reason: "no-chunks-with-embeddings" as const };
      }

      const taxonomy = await prefilterTopics(chunkMean, supabase);

      // Stratified chunk sample (Phase 2.6) — picks ~12 chunks distributed
      // across the document so megadocs surface topics from sections beyond
      // the opening. Previously this was `limit(5)` on the first chunks,
      // which biased suggestions to whatever appeared early in the file.
      const chunkPreview = await stratifiedChunkSample(supabase, artifactId);

      const fname = artifactRow.storage_path?.split("/").pop() ?? "unknown";

      // Vendor inference (Phase 2.7) — if the PM left vendor blank at upload,
      // try to recover a vendor from filename + title + content. If we find
      // one, write it to the artifact row so version detection downstream
      // works. The PM still has to confirm or override at review time
      // (is_vendor_specific stays NULL until the review action commits).
      let inferredVendor: string | null = null;
      let inferenceCounts: Record<string, number> = {};
      if (!artifactRow.vendor) {
        const inference = inferVendor([fname, artifactRow.title ?? "", ...chunkPreview]);
        if (inference.vendor) {
          inferredVendor = inference.vendor;
          inferenceCounts = inference.counts;
          const { error: vErr } = await supabase
            .from("artifacts")
            .update({ vendor: inferredVendor })
            .eq("id", artifactId);
          if (!vErr) {
            artifactRow.vendor = inferredVendor;
          }
        } else {
          // Still record what we tried, even when nothing matched — useful
          // for the review UI to show "we looked but found nothing".
          inferenceCounts = inference.counts;
        }
      }

      // Version inference (Phase 4 polish) — same idea, scans filename +
      // title + sampled chunks for patterns like v1/v2.3/"version 3". Lets
      // supersession detection actually fire when the same content is
      // re-uploaded at a new version. PM confirms or overrides at review.
      let inferredVersion: string | null = null;
      let versionInferenceCounts: Record<string, number> = {};
      if (!artifactRow.vendor_version) {
        const inference = inferVersion([fname, artifactRow.title ?? "", ...chunkPreview]);
        versionInferenceCounts = inference.counts;
        if (inference.version) {
          inferredVersion = inference.version;
          const { error: vvErr } = await supabase
            .from("artifacts")
            .update({ vendor_version: inferredVersion })
            .eq("id", artifactId);
          if (!vvErr) {
            artifactRow.vendor_version = inferredVersion;
          }
        }
      }

      let suggestion;
      try {
        suggestion = await suggestTopics({
          taxonomy,
          artifact: {
            filename: fname,
            title: artifactRow.title ?? null,
            vendor: artifactRow.vendor ?? null,
            artifact_type: artifactRow.artifact_type,
            source_authority: artifactRow.source_authority,
          },
          chunkPreview,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Soft-fail: artifact falls back to manual flow at finalize.
        return { status: "skipped", reason: "claude-failed" as const, error: msg };
      }

      let supersedesCandidate = null;
      try {
        supersedesCandidate = await findSupersedesCandidate(supabase, {
          newArtifactId: artifactId,
          newVendor: artifactRow.vendor ?? null,
          newVendorVersion: artifactRow.vendor_version ?? null,
        });
      } catch {
        // Non-fatal — version detection failure does not block suggestion persistence.
      }

      const persisted = {
        model: "claude-opus-4-7",
        generated_at: new Date().toISOString(),
        existing: suggestion.existing,
        proposed_new: suggestion.proposed_new,
        ...(supersedesCandidate ? { supersedes_candidate: supersedesCandidate } : {}),
        ...(inferredVendor || Object.keys(inferenceCounts).length > 0
          ? {
              vendor_inference: {
                vendor: inferredVendor,
                counts: inferenceCounts,
              },
            }
          : {}),
        ...(inferredVersion || Object.keys(versionInferenceCounts).length > 0
          ? {
              version_inference: {
                version: inferredVersion,
                counts: versionInferenceCounts,
              },
            }
          : {}),
      };

      const { error: updateErr } = await supabase
        .from("artifacts")
        // jsonb column; cast through unknown — our typed interfaces are
        // structurally JSON-compatible but lack the explicit Json index signature.
        .update({ topic_suggestions: persisted as unknown as Json })
        .eq("id", artifactId);
      if (updateErr) {
        return {
          status: "skipped",
          reason: "update-failed" as const,
          error: updateErr.message,
        };
      }

      return {
        status: "ok" as const,
        existingCount: suggestion.existing.length,
        proposedNewCount: suggestion.proposed_new.length,
        supersedesCandidateId: supersedesCandidate?.prior_artifact_id ?? null,
        inferredVendor,
      };
    });

    // 7. Finalize: flip artifact status='draft' → 'active' UNLESS the
    // suggest-topics step populated `topic_suggestions`, in which case the
    // artifact waits in 'draft' for PM review at /artifacts/[id]/review.
    const finalizeResult = await step.run("finalize", async () => {
      const supabase = adminClient();
      return finalizeIngestion(supabase, artifactId);
    });

    return {
      artifactId,
      chunkCount: embedded.chunks.length,
      endpointCount,
      cacheHits: embedded.summary.cacheHits,
      uniqueHashesEmbedded: embedded.summary.uniqueHashesEmbedded,
      suggestSummary,
      activated: finalizeResult.activated,
      finalizeReason: finalizeResult.reason,
    };
  },
);
