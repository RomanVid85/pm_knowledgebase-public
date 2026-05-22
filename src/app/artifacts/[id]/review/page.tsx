// Review page for a freshly-ingested artifact whose Inngest suggest-topics
// step has populated `topic_suggestions`. The PM reviews / edits / confirms
// before the artifact transitions from 'draft' to 'active'.
//
// Three states:
//   - artifact status='draft' and topic_suggestions IS NULL → Inngest
//     either hasn't run yet or is mid-run. Render the polling loader; it
//     auto-refreshes until the data arrives or a 60s timeout fires.
//   - artifact status='draft' and topic_suggestions populated → render the
//     review form (existing matches + proposed new + supersession card +
//     manual-add section + Confirm).
//   - artifact status='active' → already activated via the manual fallback
//     path (suggest-topics step was disabled or soft-failed). Show a brief
//     "no review needed" notice and link to the artifact view.

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { ReviewLoader } from "./_components/ReviewLoader";
import { ReviewForm } from "./_components/ReviewForm";
import { AttachmentsSection } from "./_components/AttachmentsSection";
import type {
  Suggestion,
  ExistingMatch,
  ProposedNewTopic,
} from "@/lib/ingest/topic_suggestion";
import type { SupersedesCandidate } from "@/lib/ingest/version_detection";

type RouteParams = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

const REVIEW_ROLES = ["admin", "pm", "sme"] as const;

interface PersistedSuggestions {
  model: string;
  generated_at: string;
  existing: ExistingMatch[];
  proposed_new: ProposedNewTopic[];
  supersedes_candidate?: SupersedesCandidate;
  vendor_inference?: {
    /** Canonical vendor name when inference produced a confident result, else null. */
    vendor: string | null;
    /** Per-vendor raw match counts (for explainability). */
    counts: Record<string, number>;
  };
  version_inference?: {
    /** Canonical version string when inference was confident, else null. */
    version: string | null;
    /** Per-version raw match counts (for explainability). */
    counts: Record<string, number>;
  };
}

function asPersistedSuggestions(raw: unknown): PersistedSuggestions | null {
  if (!raw || typeof raw !== "object") return null;
  // Trust the writer (Inngest step writes a known shape). If the Zod validation
  // turns out to surface bad rows in practice, harden here.
  return raw as PersistedSuggestions;
}

export default async function ReviewArtifactPage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: SearchParams;
}) {
  const { id: artifactId } = await params;
  const sp = await searchParams;
  const errorMsg = sp.error ? decodeURIComponent(sp.error) : undefined;

  // Auth gate
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  const admin = adminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role,display_name,email")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? "viewer";
  const canReview = (REVIEW_ROLES as readonly string[]).includes(role);

  if (!canReview) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Review artifact</h1>
        <div className="rounded border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          Your role (<code>{role}</code>) cannot review artifacts. Ask an admin to promote you.
        </div>
      </main>
    );
  }

  // Load the artifact (incl. topic_suggestions)
  const { data: artifact, error: artifactError } = await admin
    .from("artifacts")
    .select(
      "id, title, vendor, vendor_version, artifact_type, source_authority, status, created_at, storage_path, topic_suggestions, attachments",
    )
    .eq("id", artifactId)
    .single();
  if (artifactError || !artifact) notFound();

  // Already activated (fallback / feature flag disabled / soft-fail)?
  if (artifact.status === "active") {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Review not needed</h1>
        <p className="text-sm text-gray-700">
          Artifact <code>{artifact.id}</code> is already <code>active</code>. Suggest-topics either
          was disabled or fell back to the manual flow. Topics can still be added via the upload
          form.
        </p>
        <Link href="/upload" className="text-sm text-blue-700 hover:underline">
          ← Back to upload
        </Link>
      </main>
    );
  }

  // Still waiting on suggestions?
  if (artifact.topic_suggestions === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold">Analyzing content…</h1>
          <p className="mt-1 text-sm text-gray-600">
            Topic suggestions are being generated in the background. This usually takes 5–30
            seconds.
          </p>
        </header>
        <ReviewLoader artifactId={artifact.id} />
      </main>
    );
  }

  const suggestions = asPersistedSuggestions(artifact.topic_suggestions);
  if (!suggestions) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Review artifact</h1>
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          The suggestion data on this artifact is malformed. Re-trigger the ingestion or use the
          manual flow.
        </div>
      </main>
    );
  }

  // Look up topic detail for the suggested existing matches so the UI can
  // show names + descriptions, not bare UUIDs.
  const existingTopicIds = suggestions.existing.map((e) => e.topic_id);
  const { data: existingTopics } = existingTopicIds.length
    ? await admin
        .from("topics")
        .select("id, slug, name, description, vendor")
        .in("id", existingTopicIds)
    : { data: [] };

  // First 3 chunks for the content preview
  const { data: chunkPreview } = await admin
    .from("chunks")
    .select("section, content")
    .eq("artifact_id", artifact.id)
    .eq("status", "active")
    .order("chunk_index", { ascending: true })
    .limit(3);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Review topic suggestions</h1>
          <p className="mt-1 text-sm text-gray-600">
            Accept, edit, or reject below — the artifact stays <code>draft</code> until you
            confirm.
          </p>
        </div>
        <span className="text-sm text-gray-500">
          {profile?.display_name ?? user.email} · {role}
        </span>
      </header>

      {errorMsg && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      <section className="rounded border border-gray-200 bg-gray-50 p-4">
        <h2 className="text-sm font-medium text-gray-700">Artifact</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="font-medium text-gray-600">Title</dt>
          <dd>{artifact.title ?? "(none)"}</dd>
          <dt className="font-medium text-gray-600">Vendor</dt>
          <dd>{artifact.vendor ?? "(none)"}</dd>
          <dt className="font-medium text-gray-600">Vendor version</dt>
          <dd>{artifact.vendor_version ?? "(none)"}</dd>
          <dt className="font-medium text-gray-600">Type</dt>
          <dd>{artifact.artifact_type}</dd>
          <dt className="font-medium text-gray-600">Source authority</dt>
          <dd>
            <code>{artifact.source_authority}</code>
          </dd>
          <dt className="font-medium text-gray-600">Generated</dt>
          <dd className="text-gray-600">{new Date(suggestions.generated_at).toLocaleString()}</dd>
        </dl>
      </section>

      {(chunkPreview ?? []).length > 0 && (
        <section className="rounded border border-gray-200 p-4">
          <h2 className="text-sm font-medium text-gray-700">Content preview</h2>
          <div className="mt-2 space-y-2 text-sm text-gray-700">
            {(chunkPreview ?? []).map((c, i) => (
              <div key={i} className="rounded bg-gray-50 p-2">
                {c.section && <p className="text-xs font-medium text-gray-500">{c.section}</p>}
                <p className="whitespace-pre-wrap">{c.content.slice(0, 400)}{c.content.length > 400 ? "…" : ""}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <AttachmentsSection artifactId={artifact.id} attachments={artifact.attachments} />

      <ReviewForm
        artifactId={artifact.id}
        suggestions={suggestions as unknown as Suggestion & { supersedes_candidate?: SupersedesCandidate }}
        existingTopics={(existingTopics ?? []).map((t) => ({
          id: t.id,
          slug: t.slug,
          name: t.name,
          description: t.description ?? "",
          vendor: t.vendor,
        }))}
        initialVendor={artifact.vendor}
        initialVendorVersion={artifact.vendor_version}
        {...(suggestions.vendor_inference
          ? { vendorInference: suggestions.vendor_inference }
          : {})}
        {...(suggestions.version_inference
          ? { versionInference: suggestions.version_inference }
          : {})}
      />
    </main>
  );
}
