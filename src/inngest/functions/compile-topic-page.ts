// Inngest function: compile a topic page from the topic's verified rules +
// top-ranked chunks + active artifacts.
//
// Triggered by `topic-page/compile-requested`. The trigger UI on
// /topics/[slug] fires this when a PM clicks "Compile this topic". The
// resulting topic_pages row lands at status='draft' for the topic owner
// to review and publish.
//
// Steps:
//   1. fetch-topic — verify topic exists, capture id (event carries it but
//                    we re-fetch to fail fast on bad IDs)
//   2. gather-inputs — assemble topic + rules + chunks + artifacts
//   3. call-claude — single Anthropic call via compileTopicPage()
//   4. validate-citations — drop hallucinated references, collect warnings
//   5. persist-draft — INSERT into topic_pages with status='draft' and
//                      next version number for the topic
//
// Compilation is a single Claude call, not a polling loop, so no step.sleep
// chains. Total runtime expected < 60s.

import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { adminClient } from "@/lib/supabase/admin";
import { gatherCompilationInputs } from "@/lib/compilation/inputs";
import { compileTopicPage } from "@/lib/compilation/compile_topic_page";
import { validateCitations } from "@/lib/compilation/validate_citations";

export const compileTopicPageFunction = inngest.createFunction(
  { id: "compile-topic-page", name: "Compile topic page" },
  { event: "topic-page/compile-requested" },
  async ({ event, step }) => {
    const { topicId, invokerUserId } = event.data as {
      topicId: string;
      invokerUserId: string;
    };
    if (!topicId || !invokerUserId) {
      throw new NonRetriableError(
        "topic-page/compile-requested missing topicId or invokerUserId",
      );
    }

    // 1. Verify the topic exists (fast-fail on bad IDs).
    await step.run("fetch-topic", async () => {
      const supabase = adminClient();
      const { data, error } = await supabase
        .from("topics")
        .select("id")
        .eq("id", topicId)
        .single();
      if (error || !data) {
        throw new NonRetriableError(
          `topic ${topicId} not found: ${error?.message ?? "no row"}`,
        );
      }
    });

    // 2. Gather inputs.
    const inputs = await step.run("gather-inputs", async () => {
      const supabase = adminClient();
      return gatherCompilationInputs(supabase, topicId);
    });

    // Refuse to compile from nothing — defensive guard so we don't burn a
    // Claude call (and a topic_pages row) on a topic with no substrate.
    if (inputs.rules.length === 0 && inputs.chunks.length === 0) {
      throw new NonRetriableError(
        `topic ${topicId} has no active rules and no chunks — ingest more artifacts before compiling`,
      );
    }

    // 3. Call Claude.
    const page = await step.run("call-claude", async () => {
      return compileTopicPage(inputs);
    });

    // 4. Validate citations against the input set.
    const { page: validatedPage, warnings } = await step.run(
      "validate-citations",
      async () => {
        return validateCitations(page, inputs);
      },
    );

    // 5. Persist as a new draft row.
    //
    // SELECT MAX(version) + INSERT is non-atomic — two concurrent compiles
    // for the same topic could both read the same MAX and INSERT the same
    // version, hitting the UNIQUE (topic_id, version) constraint. Catch the
    // 23505 unique-violation and retry up to MAX_RETRIES with a fresh MAX.
    // In V1's manual-button-per-PM flow this is mostly defensive; matters
    // more if/when an auto-recompile-on-rule-verified trigger lands.
    const persisted = await step.run("persist-draft", async () => {
      const supabase = adminClient();
      const sourceArtifactIds = inputs.artifacts.map((a) => a.id);
      const inputSnapshot = {
        rule_ids: inputs.rules.map((r) => r.id),
        chunk_ids: inputs.chunks.map((c) => c.chunk_id),
        artifact_ids: sourceArtifactIds,
      };

      const MAX_RETRIES = 3;
      let lastError: string | null = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const { data: latest, error: latestErr } = await supabase
          .from("topic_pages")
          .select("version")
          .eq("topic_id", topicId)
          .order("version", { ascending: false })
          .limit(1);
        if (latestErr) {
          throw new Error(`failed to read latest version: ${latestErr.message}`);
        }
        const nextVersion = (latest?.[0]?.version ?? 0) + 1;

        const { data: inserted, error: insertErr } = await supabase
          .from("topic_pages")
          .insert({
            topic_id: topicId,
            version: nextVersion,
            title: inputs.topic.name,
            summary: validatedPage.summary,
            sections: validatedPage.sections,
            source_artifact_ids: sourceArtifactIds,
            status: "draft",
            compiled_by: null,
            compiled_by_ai_job_id: event.id ?? "unknown",
            compiled_by_ai_job_invoker: invokerUserId,
            compile_inputs: inputSnapshot,
            metadata: { warnings },
          })
          .select("id, version")
          .single();

        if (!insertErr && inserted) {
          return { id: inserted.id, version: inserted.version };
        }
        // 23505 = unique_violation. Retry with re-read MAX.
        if (insertErr?.code === "23505") {
          lastError = insertErr.message;
          continue;
        }
        throw new Error(`failed to persist topic page: ${insertErr?.message ?? "unknown"}`);
      }
      throw new Error(
        `failed to persist topic page after ${MAX_RETRIES} retries on version conflict: ${lastError ?? "unknown"}`,
      );
    });

    return {
      topicId,
      topicPageId: persisted.id,
      version: persisted.version,
      ruleCount: inputs.rules.length,
      chunkCount: inputs.chunks.length,
      artifactCount: inputs.artifacts.length,
      warningCount: warnings.length,
    };
  },
);
