// Topic detail page — currently-active compiled page + drafts + version history.
//
// R5 (this PR) lands the minimal version: topic header + active page summary
// (if any) + Compile button + drafts panel (owner-only) + status badges.
// R7 will expand the rendering of the 7 sections + markdown + citations.

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import type { CompiledPageSections } from "@/lib/compilation/schema";
import { CompiledSections, collectArtifactIds } from "./_components/CompiledSections";
import { CompileButton } from "./_components/CompileButton";

const COMPILE_ELIGIBLE_ROLES = ["admin", "pm", "sme"] as const;

export default async function TopicDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ compiling?: string; error?: string }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;
  const sp = await searchParams;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  const admin = adminClient();

  const { data: topic, error: topicErr } = await admin
    .from("topics")
    .select("id, slug, name, description, owner_user_id, vendor")
    .eq("slug", slug)
    .single();
  if (topicErr || !topic) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Topic not found</h1>
        <p className="text-sm text-gray-600">
          No topic with slug <code>{slug}</code>.{" "}
          <Link href="/" className="text-blue-700 underline">
            Back home
          </Link>
        </p>
      </main>
    );
  }

  const { data: profile } = await admin
    .from("users")
    .select("role, display_name")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? "viewer";
  const isOwner = topic.owner_user_id === user.id;
  const canCompile =
    isOwner || (COMPILE_ELIGIBLE_ROLES as readonly string[]).includes(role);

  // Owner display name for context.
  let ownerName: string | null = null;
  if (topic.owner_user_id) {
    const { data: ownerRow } = await admin
      .from("users")
      .select("display_name, email")
      .eq("id", topic.owner_user_id)
      .single();
    ownerName = ownerRow?.display_name ?? ownerRow?.email ?? null;
  }

  // Active compiled page (if any).
  const { data: activePage } = await admin
    .from("topic_pages")
    .select("id, version, summary, sections, source_artifact_ids, compiled_at")
    .eq("topic_id", topic.id)
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Draft pages (owners + privileged roles only).
  const { data: drafts } = canCompile
    ? await admin
        .from("topic_pages")
        .select("id, version, summary, compiled_at, compiled_by_ai_job_invoker")
        .eq("topic_id", topic.id)
        .eq("status", "draft")
        .order("version", { ascending: false })
    : { data: null };

  // Superseded versions for history panel.
  const { data: history } = await admin
    .from("topic_pages")
    .select("id, version, compiled_at")
    .eq("topic_id", topic.id)
    .eq("status", "superseded")
    .order("version", { ascending: false })
    .limit(20);

  // Resolve artifact titles for citation drill-down — one query.
  const activeSections = (activePage?.sections ?? {}) as Partial<CompiledPageSections>;
  const artifactIdsToResolve = activePage
    ? collectArtifactIds(
        activeSections,
        Array.isArray(activePage.source_artifact_ids) ? activePage.source_artifact_ids : [],
      )
    : [];
  const { data: artifactRows } =
    artifactIdsToResolve.length > 0
      ? await admin.from("artifacts").select("id, title").in("id", artifactIdsToResolve)
      : { data: null };
  const artifactTitleById = new Map<string, string>(
    (artifactRows ?? []).map((a) => [a.id, a.title]),
  );

  // Rule + chunk counts so PMs can decide whether to compile now or wait.
  const { count: ruleCount } = await admin
    .from("rules")
    .select("*", { count: "exact", head: true })
    .eq("topic_id", topic.id)
    .eq("status", "active")
    .eq("human_verified", true);
  const { count: artifactCount } = await admin
    .from("artifact_topics")
    .select("*", { count: "exact", head: true })
    .eq("topic_id", topic.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{topic.name}</h1>
          <p className="mt-1 text-sm text-gray-600">
            <code>{topic.slug}</code>
            {topic.vendor && <span className="ml-2 text-gray-500">vendor: {topic.vendor}</span>}
            {ownerName && <span className="ml-2 text-gray-500">owner: {ownerName}</span>}
          </p>
          {topic.description && (
            <p className="mt-2 text-sm text-gray-700">{topic.description}</p>
          )}
        </div>
      </header>

      {sp.error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {sp.error === "forbidden"
            ? "You can't compile this topic — admin/PM/SME or the topic owner only."
            : `Error: ${sp.error}`}
        </div>
      )}

      {sp.compiling === "1" && (
        <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          Compilation triggered. Refresh in ~20-60s to see the new draft.
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 rounded border border-gray-200 bg-gray-50 p-4 text-sm">
        <div>
          <div className="font-medium text-gray-700">Verified rules</div>
          <div className="mt-1 text-2xl text-gray-900">{ruleCount ?? 0}</div>
        </div>
        <div>
          <div className="font-medium text-gray-700">Tagged artifacts</div>
          <div className="mt-1 text-2xl text-gray-900">{artifactCount ?? 0}</div>
        </div>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Compiled page</h2>
          {canCompile && (
            <CompileButton
              slug={topic.slug}
              hasActivePage={Boolean(activePage)}
              pendingDraftVersion={
                drafts && drafts.length > 0 ? Math.max(...drafts.map((d) => d.version)) : null
              }
              disabled={(ruleCount ?? 0) === 0 && (artifactCount ?? 0) === 0}
            />
          )}
        </div>
        {activePage ? (
          <div className="mt-3">
            <p className="text-xs text-gray-500">
              v{activePage.version} · compiled {new Date(activePage.compiled_at).toLocaleString()}
            </p>
            <p className="mt-2 text-sm text-gray-800">{activePage.summary ?? "(no summary)"}</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-500">
            No compiled page yet for this topic.
            {(ruleCount ?? 0) === 0 && (artifactCount ?? 0) === 0
              ? " Ingest artifacts and verify rules first."
              : " Click compile to generate one."}
          </p>
        )}
      </section>

      {activePage && (
        <CompiledSections sections={activeSections} artifactTitleById={artifactTitleById} />
      )}

      {history && history.length > 0 && (
        <section className="rounded border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-medium text-gray-700">Version history</h2>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-gray-600">
            {history.map((h) => (
              <li key={h.id}>
                v{h.version} · superseded · compiled{" "}
                {new Date(h.compiled_at).toLocaleString()}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canCompile && drafts && drafts.length > 0 && (
        <section className="rounded border border-yellow-200 bg-yellow-50 p-4">
          <h2 className="text-lg font-medium text-yellow-900">
            Drafts awaiting review ({drafts.length})
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {drafts.map((d) => (
              <li key={d.id} className="rounded border border-yellow-300 bg-white p-3">
                <Link
                  href={`/topics/${topic.slug}/versions/${d.version}/review`}
                  className="block hover:underline"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">v{d.version} draft</span>
                    <span className="text-xs text-gray-500">
                      {new Date(d.compiled_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-gray-700">{d.summary ?? ""}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
