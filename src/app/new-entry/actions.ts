"use server";

// Field-note creation. Differs from /upload's action only in shape: the
// "content" comes from a textarea (PM's prose), not from a parsed file,
// and zero-to-many evidence files ride along as `attachments`.
//
// We upload the PM's prose to Storage as a synthesized .md so the same
// Inngest pipeline (parse → chunk → embed → suggest-topics → finalize)
// runs unmodified. Attachments are NOT parsed; they're stored as
// evidence and surfaced on the review/artifact pages.

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import {
  uploadArtifact as uploadFileToStorage,
  storagePathFor,
} from "@/lib/storage/artifacts";
import { inngest } from "@/inngest/client";

const SOURCE_AUTHORITIES = [
  "vendor_canonical",
  "vendor_reference",
  "external_authoritative",
  "internal_canonical",
  "internal_interpretive",
  "speculative",
] as const;

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MiB per attachment

const FormSchema = z.object({
  title: z.string().min(1, "Title is required").max(300),
  content: z.string().min(20, "Content needs at least 20 characters"),
  vendor: z.string().optional(),
  vendorVersion: z.string().optional(),
  sourceAuthority: z.enum(SOURCE_AUTHORITIES),
});

function fail(message: string): never {
  redirect(`/new-entry?error=${encodeURIComponent(message)}`);
}

/** Sluggify a title into a filename-safe stem. Conservative, ASCII-only. */
function titleToFilename(title: string): string {
  const safe = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safe || "field-note"}.md`;
}

export async function submitFieldNote(formData: FormData): Promise<never> {
  // 1. Auth.
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
  if (!profile || !["admin", "pm", "sme"].includes(profile.role)) {
    fail(`Your role (${profile?.role ?? "unknown"}) cannot create field notes`);
  }

  // 2. Validate inputs.
  const parsed = FormSchema.safeParse({
    title: formData.get("title")?.toString() ?? "",
    content: formData.get("content")?.toString() ?? "",
    vendor: formData.get("vendor")?.toString() || undefined,
    vendorVersion: formData.get("vendorVersion")?.toString() || undefined,
    sourceAuthority: formData.get("sourceAuthority")?.toString(),
  });
  if (!parsed.success) {
    fail(parsed.error.issues.map((i) => i.message).join("; "));
  }

  // 3. Synthesize a markdown file from the PM's content. The Inngest
  //    pipeline parses .md via parseMarkdown(), so the prose flows
  //    through the same chunker / embedder / suggest-topics path as
  //    any uploaded .md. Front-matter intentionally omitted — the
  //    title lives in artifacts.title; embedding it again would
  //    pollute the first chunk.
  const synthesizedFilename = titleToFilename(parsed.data.title);
  const notePath = storagePathFor(user.id, synthesizedFilename);
  const noteBlob = new Blob([parsed.data.content], { type: "text/markdown" });
  await uploadFileToStorage(noteBlob, notePath);

  // 4. Upload attachments (if any). Each gets its own deterministic path.
  //    We collect metadata to persist on artifacts.attachments.
  const attachmentEntries = formData.getAll("attachments");
  type AttachmentRow = {
    storage_path: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string;
  };
  const attachments: AttachmentRow[] = [];
  for (const entry of attachmentEntries) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    if (entry.size > MAX_ATTACHMENT_BYTES) {
      fail(
        `Attachment "${entry.name}" is ${(entry.size / 1024 / 1024).toFixed(1)} MB — over the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit.`,
      );
    }
    const attPath = storagePathFor(user.id, `attachment-${entry.name}`);
    await uploadFileToStorage(entry, attPath);
    attachments.push({
      storage_path: attPath,
      filename: entry.name,
      mime_type: entry.type || "application/octet-stream",
      size_bytes: entry.size,
      uploaded_at: new Date().toISOString(),
    });
  }

  // 5. INSERT artifact.
  const { data: artifactRow, error: artErr } = await admin
    .from("artifacts")
    .insert({
      title: parsed.data.title,
      artifact_type: "field_note",
      source_authority: parsed.data.sourceAuthority,
      vendor: parsed.data.vendor?.trim() || null,
      vendor_version: parsed.data.vendorVersion?.trim() || null,
      storage_path: notePath,
      uploaded_by: user.id,
      status: "draft",
      attachments: attachments as never,
      metadata: {
        capture_method: "field_note",
        captured_at: new Date().toISOString(),
        original_filename: synthesizedFilename,
        attachment_count: attachments.length,
      } as never,
    })
    .select("id")
    .single();
  if (artErr || !artifactRow) {
    fail(`Field-note insert failed: ${artErr?.message ?? "no row"}`);
  }
  const artifactId = artifactRow.id;

  // 6. ingest_jobs audit row.
  const { error: jobErr } = await admin.from("ingest_jobs").insert({
    kind: "upload_ingest",
    status: "queued",
    invoker_user_id: user.id,
    source_artifact_id: artifactId,
  });
  if (jobErr) {
    fail(`ingest_jobs insert failed: ${jobErr.message}`);
  }

  // 7. Fire Inngest. Same event as /upload — the function parses the
  //    synthesized .md, runs suggest-topics, leaves it in draft for PM
  //    review. Auto-fire of rule extraction lives in the review action.
  await inngest.send({
    name: "ingest/artifact-uploaded",
    data: { artifactId, invokerUserId: user.id },
  });

  redirect(`/artifacts/${artifactId}/review`);
}
