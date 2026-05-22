// Review a draft compiled topic page before publishing.
//
// Topic owners see Publish + Reject buttons. Other admin/pm/sme users see
// the same content read-only with a note that the owner needs to approve.
// Non-privileged users get redirected away.

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import type { CompiledPageSections } from "@/lib/compilation/schema";
import { CompiledSections, collectArtifactIds } from "../../../_components/CompiledSections";
import { publishDraftAction, rejectDraftAction } from "./actions";

const PRIVILEGED_ROLES = ["admin", "pm", "sme"] as const;

export default async function DraftReviewPage({
  params,
}: {
  params: Promise<{ slug: string; version: string }>;
}): Promise<React.JSX.Element> {
  const { slug, version: versionStr } = await params;
  const version = Number(versionStr);
  if (!Number.isInteger(version) || version <= 0) {
    redirect(`/topics/${slug}?error=invalid-version`);
  }

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  const admin = adminClient();

  // Authorize BEFORE fetching topic/draft (Cubic P2): an unauthorized user
  // shouldn't be able to probe topic/draft existence via differing error
  // redirects. Fetch role first, then fetch topic + check ownership in one
  // step so non-privileged non-owners get the SAME redirect whether the
  // topic exists or not.
  const { data: profile } = await admin
    .from("users")
    .select("role, display_name")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? "viewer";
  const isPrivileged = (PRIVILEGED_ROLES as readonly string[]).includes(role);

  const { data: topic } = await admin
    .from("topics")
    .select("id, slug, name, owner_user_id")
    .eq("slug", slug)
    .single();
  const isOwner = topic?.owner_user_id === user.id;

  // Combined access check — same redirect whether topic missing or just
  // not yours. Privileged users (admin/pm/sme) bypass and get the real
  // missing-topic redirect below.
  if (!isPrivileged && !isOwner) {
    redirect(`/topics?error=forbidden`);
  }
  if (!topic) {
    redirect(`/topics?error=topic-not-found`);
  }

  const { data: draft, error: draftErr } = await admin
    .from("topic_pages")
    .select("id, version, status, title, summary, sections, source_artifact_ids, compiled_at, metadata")
    .eq("topic_id", topic.id)
    .eq("version", version)
    .single();
  if (draftErr || !draft) {
    redirect(`/topics/${slug}?error=draft-not-found`);
  }

  const sections = (draft.sections ?? {}) as Partial<CompiledPageSections>;

  // Resolve artifact titles for citation links — one query rather than N.
  const artifactIdsInPage = collectArtifactIds(
    sections,
    Array.isArray(draft.source_artifact_ids) ? draft.source_artifact_ids : [],
  );
  const { data: artifactRows } =
    artifactIdsInPage.length > 0
      ? await admin.from("artifacts").select("id, title").in("id", artifactIdsInPage)
      : { data: null };
  const artifactTitleById = new Map<string, string>(
    (artifactRows ?? []).map((a) => [a.id, a.title]),
  );

  const warningsCount =
    draft.metadata &&
    typeof draft.metadata === "object" &&
    !Array.isArray(draft.metadata) &&
    Array.isArray((draft.metadata as Record<string, unknown>).warnings)
      ? ((draft.metadata as Record<string, unknown>).warnings as unknown[]).length
      : 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <header>
        <div className="text-xs text-gray-500">
          <Link href={`/topics/${slug}`} className="underline">
            ← {topic.name}
          </Link>
        </div>
        <h1 className="mt-1 text-2xl font-semibold">
          {draft.title} — v{draft.version} draft
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Compiled {new Date(draft.compiled_at).toLocaleString()} · status:{" "}
          <code>{draft.status}</code>
        </p>
        {warningsCount > 0 && (
          <p className="mt-1 text-xs text-amber-700">
            {warningsCount} citation warning{warningsCount === 1 ? "" : "s"} during compilation —
            see metadata for details.
          </p>
        )}
      </header>

      {draft.status !== "draft" && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This page is no longer a draft (current status: <code>{draft.status}</code>). Publish
          and reject actions are disabled.
        </div>
      )}

      {!isOwner && (
        <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          You can review this draft, but only the topic owner can publish or reject.
        </div>
      )}

      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-500">Summary</h2>
        <p className="mt-2 text-sm text-gray-900">{draft.summary ?? "(no summary)"}</p>
      </section>

      <CompiledSections sections={sections} artifactTitleById={artifactTitleById} />

      {isOwner && draft.status === "draft" && (
        <div className="flex flex-col gap-3 rounded border border-gray-300 bg-gray-50 p-4">
          <h2 className="text-lg font-medium">Decide</h2>
          <form action={publishDraftAction} className="flex items-center gap-3">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="version" value={String(version)} />
            <button
              type="submit"
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Publish v{version}
            </button>
            <span className="text-xs text-gray-600">
              Sets this draft to active and supersedes the current published version (if any).
            </span>
          </form>
          <form action={rejectDraftAction} className="flex flex-col gap-2 border-t border-gray-200 pt-3">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="version" value={String(version)} />
            <label className="text-xs font-medium text-gray-700">
              Reject notes (required)
              <textarea
                name="notes"
                required
                minLength={1}
                rows={2}
                className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
                placeholder="Why is this draft not ready? (e.g., bad citation in current_view, hallucinated next action)"
              />
            </label>
            <button
              type="submit"
              className="self-start rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Reject draft
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
