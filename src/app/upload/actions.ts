"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { uploadArtifact as uploadFileToStorage, storagePathFor } from "@/lib/storage/artifacts";
import { inngest } from "@/inngest/client";
import { isTopicSuggestionEnabled } from "@/lib/ingest/topic_suggestion";
import type { Database } from "@/types/supabase";

type ArtifactType = Database["public"]["Enums"]["artifact_type"];

const SOURCE_AUTHORITIES = [
  "vendor_canonical",
  "vendor_reference",
  "external_authoritative",
  "internal_canonical",
  "internal_interpretive",
  "speculative",
] as const;

const SubmitSchema = z.object({
  title: z.string().optional(),
  vendor: z.string().optional(),
  sourceAuthority: z.enum(SOURCE_AUTHORITIES),
  // Topics multiselect is only used in the manual-flow fallback (feature flag
  // off). When suggest-topics is enabled, topics come from the review page
  // after Claude proposes them.
  topicIds: z.array(z.string().uuid()).optional(),
});

function inferArtifactType(filename: string): ArtifactType {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "training_guide";
  if (lower.endsWith(".docx")) return "api_documentation";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "openapi_spec";
  if (lower.endsWith(".json")) return "openapi_spec";
  if (lower.endsWith(".pdf")) return "pdf_guide";
  return "other";
}

function failTo(redirectMsg: string): never {
  redirect(`/upload?error=${encodeURIComponent(redirectMsg)}`);
}

export async function submitArtifact(formData: FormData) {
  // 1. Auth (user-context client reads the JWT cookie).
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  // Role check uses the admin client — supabase-js's typing is cleaner here
  // than @supabase/ssr's, and we're already auth-gated by the line above.
  const admin = adminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "pm", "sme"].includes(profile.role)) {
    failTo(`Your role (${profile?.role ?? "unknown"}) cannot upload artifacts`);
  }

  // 2. Validate form data.
  const parsed = SubmitSchema.safeParse({
    title: formData.get("title")?.toString() || undefined,
    vendor: formData.get("vendor")?.toString() || undefined,
    sourceAuthority: formData.get("sourceAuthority")?.toString(),
    topicIds: formData.getAll("topicIds").map((t) => t.toString()).filter(Boolean),
  });
  if (!parsed.success) {
    failTo(parsed.error.issues.map((i) => i.message).join("; "));
  }

  // Feature-flag branch: enabled → topics come from the review page (no
  // multiselect on upload). Disabled → manual flow, at least one topic required.
  const suggestEnabled = await isTopicSuggestionEnabled(admin);
  if (!suggestEnabled && (parsed.data.topicIds ?? []).length === 0) {
    failTo("Manual-flow mode (feature flag off) requires at least one topic.");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    failTo("No file provided");
  }
  const fileObj: File = file;
  const filename = fileObj.name;
  const artifactType = inferArtifactType(filename);
  if (artifactType === "other") {
    failTo(`Unsupported file extension: ${filename}`);
  }

  // 3. Upload to Storage (admin context — bypasses RLS).
  const path = storagePathFor(user.id, filename);
  await uploadFileToStorage(fileObj, path);

  // 4. INSERT artifact row (status='draft' until Inngest finishes).
  const title = parsed.data.title?.trim() || filename.replace(/\.[^.]+$/, "");
  const { data: artifactRow, error: artErr } = await admin
    .from("artifacts")
    .insert({
      title,
      artifact_type: artifactType,
      source_authority: parsed.data.sourceAuthority,
      vendor: parsed.data.vendor?.trim() || null,
      storage_path: path,
      uploaded_by: user.id,
      status: "draft",
      metadata: {
        capture_method: "user_upload",
        captured_at: new Date().toISOString(),
        original_filename: filename,
      } as never,
    })
    .select("id")
    .single();
  if (artErr || !artifactRow) {
    failTo(`Artifact insert failed: ${artErr?.message ?? "no row"}`);
  }
  const artifactId = artifactRow.id;

  // 5. INSERT artifact_topics — only in the manual-flow path. With suggest-topics
  // enabled, the review server action does this after PM confirms suggestions.
  if (!suggestEnabled && (parsed.data.topicIds ?? []).length > 0) {
    const { error: topicsErr } = await admin.from("artifact_topics").insert(
      (parsed.data.topicIds ?? []).map((tid) => ({
        artifact_id: artifactId,
        topic_id: tid,
        relevance_score: 1.0,
      })),
    );
    if (topicsErr) {
      failTo(`Topic link failed: ${topicsErr.message}`);
    }
  }

  // 6. INSERT ingest_jobs row (audit trail; updated by Inngest steps).
  const { error: jobErr } = await admin.from("ingest_jobs").insert({
    kind: "upload_ingest",
    status: "queued",
    invoker_user_id: user.id,
    source_artifact_id: artifactId,
  });
  if (jobErr) {
    failTo(`ingest_jobs insert failed: ${jobErr.message}`);
  }

  // 7. Send the Inngest event — orchestration takes over from here.
  await inngest.send({
    name: "ingest/artifact-uploaded",
    data: {
      artifactId,
      invokerUserId: user.id,
    },
  });

  // Suggest-topics flow → land on the review page (which polls until
  // topic_suggestions is populated, then renders the curation form).
  // Manual-flow → land on the success banner since there's nothing to review.
  if (suggestEnabled) {
    redirect(`/artifacts/${artifactId}/review`);
  }
  redirect(`/upload?success=${artifactId}`);
}
