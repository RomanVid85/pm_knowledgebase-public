// Artifact detail page — citation drill-down target.
//
// When a compiled topic page (or any other surface) links a reader to
// "the artifact this claim is from", they land here. Shows:
//   - Header: title, vendor + version, source authority, status, ingest date
//   - Topics this artifact is tagged with
//   - Attachments (if any — field-note bundles ride here)
//   - Chunks list — the searchable units, with section headers + content
//
// Server Component. Read-only. Role-restricted to authenticated users only
// (no role gating beyond that — knowledge base is intentionally team-readable).

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";

type RouteParams = Promise<{ id: string }>;

export default async function ArtifactDetailPage({
  params,
}: {
  params: RouteParams;
}): Promise<React.JSX.Element> {
  const { id } = await params;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  const admin = adminClient();

  const { data: artifact, error } = await admin
    .from("artifacts")
    .select(
      "id, title, vendor, vendor_version, artifact_type, source_authority, status, effective_date, created_at, uploaded_by",
    )
    .eq("id", id)
    .single();
  if (error || !artifact) notFound();

  const { data: topicLinks } = await admin
    .from("artifact_topics")
    .select("relevance_score, topics!inner(id, name, slug)")
    .eq("artifact_id", id)
    .order("relevance_score", { ascending: false });

  const { data: chunks } = await admin
    .from("chunks")
    .select("id, chunk_index, section, content")
    .eq("artifact_id", id)
    .order("chunk_index", { ascending: true });

  const { data: uploader } = artifact.uploaded_by
    ? await admin
        .from("users")
        .select("display_name, email")
        .eq("id", artifact.uploaded_by)
        .single()
    : { data: null };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{artifact.title}</h1>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
          {artifact.vendor && (
            <span>
              vendor: <span className="font-medium">{artifact.vendor}</span>
              {artifact.vendor_version && <span> ({artifact.vendor_version})</span>}
            </span>
          )}
          <span>
            authority: <code className="text-gray-700">{artifact.source_authority}</code>
          </span>
          <span>
            type: <code className="text-gray-700">{artifact.artifact_type}</code>
          </span>
          <span>
            status: <code className="text-gray-700">{artifact.status}</code>
          </span>
          {artifact.effective_date && (
            <span>
              effective: {new Date(artifact.effective_date).toLocaleDateString()}
            </span>
          )}
          <span>uploaded: {new Date(artifact.created_at).toLocaleString()}</span>
          {uploader && (
            <span>by: {uploader.display_name ?? uploader.email}</span>
          )}
        </div>
      </header>

      {topicLinks && topicLinks.length > 0 && (
        <section className="rounded border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-medium text-gray-700">
            Tagged topics ({topicLinks.length})
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {topicLinks.map((t, i) => (
              <li
                key={`${t.topics?.id ?? i}`}
                className="rounded border border-gray-200 bg-gray-50 px-2 py-1"
              >
                {t.topics?.slug ? (
                  <Link
                    href={`/topics/${t.topics.slug}`}
                    className="text-blue-700 underline"
                  >
                    {t.topics.name}
                  </Link>
                ) : (
                  <span>{t.topics?.name ?? "(unknown)"}</span>
                )}
                <span className="ml-2 text-gray-500">
                  rel: {Number(t.relevance_score ?? 0).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-700">
          Chunks ({chunks?.length ?? 0})
        </h2>
        {!chunks || chunks.length === 0 ? (
          <p className="mt-2 text-sm italic text-gray-500">
            No chunks. Ingest may still be running, or the artifact has no extractable content.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {chunks.map((c) => (
              <li key={c.id} className="rounded border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-baseline justify-between text-xs text-gray-500">
                  <span>chunk #{c.chunk_index}</span>
                  {c.section && (
                    <span className="font-medium text-gray-700">{c.section}</span>
                  )}
                </div>
                <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-gray-900">
                  {c.content}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
