"use server";

// Review server action — task 2.5.8 / 2.5.15 / 2.5.17 combined.
// Called by ReviewForm on Confirm. Steps:
//   1. Validate JSON payload (Zod). Auth-gate (admin/pm/sme).
//   2. Load artifact; ensure status='draft' (idempotency / replay safety).
//   3. Slug-uniqueness check for proposed_new + manual topics.
//   4. Embed every new topic's description via Voyage (single batched call).
//   5. INSERT topics (status='active', owner = artifact uploader).
//   6. INSERT artifact_topics rows: existing matches (relevance_score =
//      LLM confidence per Q2) + new topics (relevance_score = 1.0).
//   7. If PM confirmed supersession: update prior.status='superseded',
//      prior.superseded_by=this.id, this.supersedes=prior.id (R11).
//   8. Update artifact status='active'.
//   9. Redirect to /upload?success=...
//
// Any error rerenders the review page with `?error=...`.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { embedDocuments } from "@/lib/voyage/client";
import { inngest } from "@/inngest/client";
import { ReviewPayloadSchema, type ReviewPayload } from "./schema";

const REVIEW_ROLES = ["admin", "pm", "sme"] as const;

function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function errorRedirect(artifactId: string | null, message: string): never {
  const target = artifactId
    ? `/artifacts/${artifactId}/review?error=${encodeURIComponent(message)}`
    : `/upload?error=${encodeURIComponent(message)}`;
  redirect(target);
}

export async function submitReview(formData: FormData): Promise<never> {
  const payloadRaw = formData.get("payload");
  if (typeof payloadRaw !== "string") {
    errorRedirect(null, "missing payload");
  }

  let parsed: ReviewPayload;
  try {
    parsed = ReviewPayloadSchema.parse(JSON.parse(payloadRaw));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid payload";
    errorRedirect(null, `invalid payload: ${msg}`);
  }

  // ---- auth ----
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  const admin = adminClient();

  const { data: profile } = await admin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? "viewer";
  if (!(REVIEW_ROLES as readonly string[]).includes(role)) {
    errorRedirect(parsed.artifact_id, `role '${role}' cannot review artifacts`);
  }

  // ---- artifact must be draft ----
  const { data: artifact, error: aErr } = await admin
    .from("artifacts")
    .select("id, status, uploaded_by")
    .eq("id", parsed.artifact_id)
    .single();
  if (aErr || !artifact) {
    errorRedirect(parsed.artifact_id, "artifact not found");
  }
  if (artifact.status !== "draft") {
    errorRedirect(parsed.artifact_id, `artifact already in status '${artifact.status}'`);
  }

  // ---- at least one topic required ----
  const totalTopics =
    parsed.existing.length + parsed.proposed_new.length + parsed.manual.length;
  if (totalTopics === 0) {
    errorRedirect(parsed.artifact_id, "select at least one topic before confirming");
  }

  // ---- slug uniqueness (against existing topics) ----
  const newTopics: Array<{
    slug: string;
    name: string;
    description: string;
    vendor: string | null;
  }> = [
    ...parsed.proposed_new.map((p) => ({
      slug: p.slug,
      name: p.name,
      description: p.description,
      vendor: p.vendor,
    })),
    ...parsed.manual,
  ];

  // Also catch dup slugs *within* the same submission.
  const slugsInPayload = newTopics.map((t) => t.slug);
  if (new Set(slugsInPayload).size !== slugsInPayload.length) {
    errorRedirect(parsed.artifact_id, "duplicate slug within submission");
  }

  if (newTopics.length > 0) {
    const { data: collisions, error: cErr } = await admin
      .from("topics")
      .select("slug")
      .in("slug", slugsInPayload);
    if (cErr) {
      errorRedirect(parsed.artifact_id, `slug check failed: ${cErr.message}`);
    }
    if (collisions && collisions.length > 0) {
      errorRedirect(
        parsed.artifact_id,
        `slug collision with existing topics: ${collisions.map((c) => c.slug).join(", ")}`,
      );
    }
  }

  // ---- embed new topic descriptions (single batched Voyage call) ----
  let embeddings: number[][] = [];
  if (newTopics.length > 0) {
    try {
      embeddings = await embedDocuments(newTopics.map((t) => t.description));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errorRedirect(parsed.artifact_id, `embedding new topic descriptions failed: ${msg}`);
    }
  }

  // ---- INSERT topics ----
  const ownerUserId = artifact.uploaded_by ?? user.id;
  const newTopicIds: string[] = [];
  for (let i = 0; i < newTopics.length; i++) {
    const t = newTopics[i]!;
    const e = embeddings[i]!;
    const { data, error: tErr } = await admin
      .from("topics")
      .insert({
        slug: t.slug,
        name: t.name,
        description: t.description,
        vendor: t.vendor,
        owner_user_id: ownerUserId,
        status: "active",
        description_embedding: vectorLiteral(e),
      })
      .select("id")
      .single();
    if (tErr || !data) {
      errorRedirect(
        parsed.artifact_id,
        `topic insert failed for '${t.slug}': ${tErr?.message ?? "unknown"}`,
      );
    }
    newTopicIds.push(data.id);
  }

  // ---- INSERT artifact_topics ----
  const linkRows = [
    ...parsed.existing.map((e) => ({
      artifact_id: parsed.artifact_id,
      topic_id: e.topic_id,
      relevance_score: e.confidence,
    })),
    ...newTopicIds.map((id) => ({
      artifact_id: parsed.artifact_id,
      topic_id: id,
      relevance_score: 1.0,
    })),
  ];

  const { error: linkErr } = await admin
    .from("artifact_topics")
    .upsert(linkRows, { onConflict: "artifact_id,topic_id" });
  if (linkErr) {
    errorRedirect(parsed.artifact_id, `linking artifact_topics failed: ${linkErr.message}`);
  }

  // ---- supersedes chain (R11) ----
  if (parsed.supersedes) {
    const priorId = parsed.supersedes.prior_artifact_id;
    const { error: priorErr } = await admin
      .from("artifacts")
      .update({ status: "superseded", superseded_by: parsed.artifact_id })
      .eq("id", priorId);
    if (priorErr) {
      errorRedirect(parsed.artifact_id, `prior artifact update failed: ${priorErr.message}`);
    }
    const { error: linkSupErr } = await admin
      .from("artifacts")
      .update({ supersedes: priorId })
      .eq("id", parsed.artifact_id);
    if (linkSupErr) {
      errorRedirect(parsed.artifact_id, `supersedes link update failed: ${linkSupErr.message}`);
    }
  }

  // ---- commit vendor classification + activate ----
  // Done in a single UPDATE so the DB CHECK constraint (artifacts_vendor_consistency)
  // sees vendor + is_vendor_specific transition together.
  const { error: actErr } = await admin
    .from("artifacts")
    .update({
      status: "active",
      vendor: parsed.vendor,
      vendor_version: parsed.vendor_version,
      is_vendor_specific: parsed.is_vendor_specific,
    })
    .eq("id", parsed.artifact_id);
  if (actErr) {
    errorRedirect(parsed.artifact_id, `activation failed: ${actErr.message}`);
  }

  // ---- Phase 4: fire rule extraction ----
  // Failures here are non-fatal — the artifact is already active, rule
  // extraction can be re-triggered manually via scripts/extract_rules.ts.
  // The invoker is the confirming PM; the verification-workflow rules
  // will prevent them from later verifying their own auto-extracted rules.
  try {
    await inngest.send({
      name: "rule-extraction/requested",
      data: { artifactId: parsed.artifact_id, invokerUserId: user.id },
    });
  } catch {
    // swallow — observability for failed sends comes later (Phase 5+)
  }

  redirect(`/upload?success=${parsed.artifact_id}`);
}
