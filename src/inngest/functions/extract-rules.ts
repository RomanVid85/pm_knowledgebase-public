// Inngest function: extract structured business rules from an artifact.
//
// Triggered by `rule-extraction/requested` events. The Phase 4 design
// fires this automatically after a PM confirms an artifact at review;
// it can also be triggered manually for existing artifacts via the
// scripts/extract_rules.ts CLI.
//
// Steps:
//   1. load-context — fetch artifact metadata + primary topic_id
//                     (highest relevance_score in artifact_topics) +
//                     existing rule_keys for this artifact (avoid duplicates)
//   2. sample-chunks — stratified sample for breadth on megadocs
//   3. extract — call Claude with extract_rules tool
//   4. persist — INSERT rules with status='pending_verification' +
//                ai_job_id + ai_job_invoker per verification_workflow.md
//
// Two-person rule enforcement: this function writes
//   - extracted_by = NULL  (AI extraction)
//   - extracted_by_ai_job_id = event.id  (deterministic across retries)
//   - extracted_by_ai_job_invoker = event.data.invokerUserId
// The DB CHECK + trigger prevent the invoker from later verifying these.

import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { adminClient } from "@/lib/supabase/admin";
import { extractRules } from "@/lib/ingest/rule_extraction";
import { stratifiedChunkSample } from "@/lib/ingest/topic_suggestion";
import { persistRules } from "@/lib/ingest/persister";

const RULE_EXTRACTION_CHUNK_K = 40;

export const extractRulesFunction = inngest.createFunction(
  { id: "extract-rules", name: "Extract rules from artifact" },
  { event: "rule-extraction/requested" },
  async ({ event, step }) => {
    // Event shape: { data: { artifactId: string, invokerUserId: string } }
    const { artifactId, invokerUserId } = event.data as {
      artifactId: string;
      invokerUserId: string;
    };
    if (!artifactId || !invokerUserId) {
      throw new NonRetriableError(
        "rule-extraction/requested missing artifactId or invokerUserId",
      );
    }

    // 1. Load context — artifact metadata + primary topic + existing rule_keys.
    const ctx = await step.run("load-context", async () => {
      const supabase = adminClient();
      const { data: artifact, error: aErr } = await supabase
        .from("artifacts")
        .select(
          "id, title, vendor, vendor_version, artifact_type, source_authority, status",
        )
        .eq("id", artifactId)
        .single();
      if (aErr || !artifact) {
        throw new NonRetriableError(
          `artifact ${artifactId} not found: ${aErr?.message ?? ""}`,
        );
      }
      if (artifact.status !== "active") {
        throw new NonRetriableError(
          `artifact ${artifactId} is in status '${artifact.status}', expected 'active'`,
        );
      }

      // Primary topic: the artifact_topics row with the highest relevance_score.
      // Rule extraction associates extracted rules with this topic by default;
      // the verifier can reassign at verification time if a rule belongs better
      // to a different topic.
      const { data: topics, error: tErr } = await supabase
        .from("artifact_topics")
        .select("topic_id, relevance_score")
        .eq("artifact_id", artifactId)
        .order("relevance_score", { ascending: false })
        .limit(1);
      if (tErr) {
        throw new NonRetriableError(`failed to load artifact_topics: ${tErr.message}`);
      }
      const primaryTopicId = topics?.[0]?.topic_id;
      if (!primaryTopicId) {
        throw new NonRetriableError(
          `artifact ${artifactId} has no linked topics — cannot extract rules without a primary topic`,
        );
      }

      // Existing rule_keys for this artifact: helps Claude avoid duplicates
      // (rare, but possible if rules were partially extracted before).
      const { data: existingRules } = await supabase
        .from("rules")
        .select("rule_key")
        .eq("source_artifact_id", artifactId)
        .in("status", ["draft", "pending_verification", "active", "disputed"]);

      return {
        artifact: {
          title: artifact.title,
          vendor: artifact.vendor,
          vendor_version: artifact.vendor_version,
          artifact_type: artifact.artifact_type,
          source_authority: artifact.source_authority,
        },
        primaryTopicId,
        existingRuleKeys: (existingRules ?? []).map((r) => r.rule_key),
      };
    });

    // 2. Sample chunks for breadth.
    const chunks = await step.run("sample-chunks", async () => {
      const supabase = adminClient();
      return stratifiedChunkSample(supabase, artifactId, RULE_EXTRACTION_CHUNK_K);
    });
    if (chunks.length === 0) {
      return { artifactId, status: "skipped" as const, reason: "no-chunks" };
    }

    // 3. Extract via Claude.
    const extraction = await step.run("extract", async () => {
      return extractRules({
        artifact: ctx.artifact,
        chunks,
        existingRuleKeys: ctx.existingRuleKeys,
      });
    });

    // 4. Persist.
    const persistResult = await step.run("persist", async () => {
      const supabase = adminClient();
      return persistRules(supabase, {
        artifactId,
        topicId: ctx.primaryTopicId,
        rules: extraction.rules,
        inngestJobId: event.id ?? "unknown",
        invokerUserId,
      });
    });

    return {
      artifactId,
      status: "ok" as const,
      extractedCount: extraction.rules.length,
      insertedCount: persistResult.insertedCount,
      skippedDuplicateCount: persistResult.skippedCount,
      primaryTopicId: ctx.primaryTopicId,
    };
  },
);
