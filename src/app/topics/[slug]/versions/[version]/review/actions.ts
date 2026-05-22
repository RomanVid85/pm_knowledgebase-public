"use server";

// Server actions for the draft-review page.
//
// Publish: transactional supersede — prior active row -> 'superseded',
//   new draft row -> 'active', supersedes/superseded_by chain set.
//   Sequential UPDATEs (PostgREST doesn't support transactions natively).
//   The brief inconsistency window is acceptable for V1; a worst-case
//   "both active" state is recoverable via SQL.
//
// Reject: new draft row -> 'archived', reject_notes preserved in metadata.
//
// Authorization: topic-owner only (defense in depth on top of the RLS
// policy that already restricts writes to topic owners + admin/pm/sme).
// We enforce strict topic-owner gating here — the spec says owner-only
// publish is the right level of review for non-authoritative compiled pages.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";

interface ActionContext {
  slug: string;
  version: number;
  user_id: string;
  topic_id: string;
  draft_id: string;
}

async function loadDraftAndAuthorize(formData: FormData): Promise<ActionContext> {
  const slug = formData.get("slug");
  const versionRaw = formData.get("version");
  if (typeof slug !== "string" || typeof versionRaw !== "string") {
    redirect(`/topics?error=missing-params`);
  }
  const version = Number(versionRaw);
  if (!Number.isInteger(version) || version <= 0) {
    redirect(`/topics/${slug}?error=invalid-version`);
  }

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  const admin = adminClient();

  // Authorize BEFORE fetching topic/draft (Cubic P2): non-owners get the
  // SAME redirect regardless of whether the topic exists, so they can't
  // probe topic/draft existence by trial-and-error.
  const { data: topic } = await admin
    .from("topics")
    .select("id, owner_user_id")
    .eq("slug", slug)
    .single();

  if (topic?.owner_user_id !== user.id) {
    redirect(`/topics?error=forbidden`);
  }

  // From here on: user IS the topic owner; safe to fetch the draft and
  // surface real "draft not found" / "already published" errors.
  const { data: draft, error: draftErr } = await admin
    .from("topic_pages")
    .select("id, status")
    .eq("topic_id", topic.id)
    .eq("version", version)
    .single();
  if (draftErr || !draft) {
    redirect(`/topics/${slug}?error=draft-not-found`);
  }
  if (draft.status !== "draft") {
    redirect(`/topics/${slug}?error=draft-already-${draft.status}`);
  }

  return {
    slug,
    version,
    user_id: user.id,
    topic_id: topic.id,
    draft_id: draft.id,
  };
}

export async function publishDraftAction(formData: FormData): Promise<void> {
  const ctx = await loadDraftAndAuthorize(formData);
  const admin = adminClient();

  // Find currently-active row (if any) — that's what we'll supersede.
  const { data: prevActive } = await admin
    .from("topic_pages")
    .select("id")
    .eq("topic_id", ctx.topic_id)
    .eq("status", "active")
    .maybeSingle();

  if (prevActive) {
    const { error: superErr } = await admin
      .from("topic_pages")
      .update({ status: "superseded", superseded_by: ctx.draft_id })
      .eq("id", prevActive.id);
    if (superErr) {
      redirect(
        `/topics/${ctx.slug}?error=${encodeURIComponent(`supersede-failed:${superErr.message}`)}`,
      );
    }
  }

  const { error: activateErr } = await admin
    .from("topic_pages")
    .update({ status: "active", supersedes: prevActive?.id ?? null })
    .eq("id", ctx.draft_id);
  if (activateErr) {
    redirect(
      `/topics/${ctx.slug}?error=${encodeURIComponent(`activate-failed:${activateErr.message}`)}`,
    );
  }

  revalidatePath(`/topics/${ctx.slug}`);
  redirect(`/topics/${ctx.slug}?published=v${ctx.version}`);
}

export async function rejectDraftAction(formData: FormData): Promise<void> {
  const ctx = await loadDraftAndAuthorize(formData);
  const notes = formData.get("notes");
  const notesStr = typeof notes === "string" ? notes : "";

  const admin = adminClient();

  // Read the existing metadata so we can merge in reject_notes without
  // clobbering compile-time warnings.
  const { data: current } = await admin
    .from("topic_pages")
    .select("metadata")
    .eq("id", ctx.draft_id)
    .single();
  const existingMeta =
    current?.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
      ? (current.metadata as Record<string, unknown>)
      : {};

  const { error } = await admin
    .from("topic_pages")
    .update({
      status: "archived",
      metadata: { ...existingMeta, reject_notes: notesStr, rejected_by: ctx.user_id },
    })
    .eq("id", ctx.draft_id);
  if (error) {
    redirect(
      `/topics/${ctx.slug}?error=${encodeURIComponent(`reject-failed:${error.message}`)}`,
    );
  }

  revalidatePath(`/topics/${ctx.slug}`);
  redirect(`/topics/${ctx.slug}?rejected=v${ctx.version}`);
}
