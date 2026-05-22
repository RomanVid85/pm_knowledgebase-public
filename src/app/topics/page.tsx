// Topics index — browse all topics + see compile/draft state.
//
// One row per topic, ordered to surface what needs attention:
//   1. Topics with drafts the current user can publish (they own)
//   2. Topics with substrate (rules or artifacts) but no compiled page yet
//   3. Everything else
//
// Each row shows owner, vendor, verified rule count, artifact count, active
// version (if any), and a "Compile" or "Recompile" CTA for users who can act
// (admin/pm/sme/owner). Owners of a topic with a pending draft see a
// "Review draft" CTA that jumps to /topics/[slug]/versions/[version]/review.

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";

const COMPILE_ELIGIBLE_ROLES = ["admin", "pm", "sme"] as const;

type TopicRow = {
  id: string;
  slug: string;
  name: string;
  vendor: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  ruleCount: number;
  artifactCount: number;
  activeVersion: number | null;
  draftCount: number;
  // Highest-version pending draft on this topic (any owner). Used in the
  // all-drafts view so non-owners can still navigate to the review page
  // read-only and chase the owner.
  latestDraftVersion: number | null;
  // True when the current user is this topic's owner — drives whether the
  // CTA reads "Review draft" (actionable) or "Awaiting [Owner]" (FYI).
  isOwner: boolean;
};

export default async function TopicsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}): Promise<React.JSX.Element> {
  const { filter } = await searchParams;
  // Both "drafts" and the legacy "my-drafts" param value land on the
  // all-open-drafts view. The user wants visibility into anyone's drafts
  // so they can follow up; the badge in the sidebar still counts only
  // drafts the current user can act on (publish).
  const draftsOnly = filter === "drafts" || filter === "my-drafts";

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  const admin = adminClient();

  const { data: profile } = await admin
    .from("users")
    .select("role, display_name")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? "viewer";
  const isPrivileged = (COMPILE_ELIGIBLE_ROLES as readonly string[]).includes(role);

  // Pull every topic + their owner display name, rule count, artifact count,
  // and any topic_pages (active or draft). Five queries — fine at the V1
  // scale of ~18 topics.
  const [topics, owners, rules, artifactTopics, topicPages] = await Promise.all([
    admin.from("topics").select("id, slug, name, vendor, owner_user_id").order("name"),
    admin.from("users").select("id, display_name, email"),
    admin
      .from("rules")
      .select("topic_id")
      .eq("status", "active")
      .eq("human_verified", true),
    admin.from("artifact_topics").select("topic_id"),
    admin
      .from("topic_pages")
      .select("topic_id, version, status")
      .in("status", ["active", "draft"]),
  ]);

  const ownerNameById = new Map<string, string>(
    (owners.data ?? []).map((u) => [u.id, u.display_name ?? u.email ?? "(unknown)"]),
  );

  const ruleCountByTopic = new Map<string, number>();
  for (const r of rules.data ?? []) {
    ruleCountByTopic.set(r.topic_id, (ruleCountByTopic.get(r.topic_id) ?? 0) + 1);
  }

  const artifactCountByTopic = new Map<string, number>();
  for (const at of artifactTopics.data ?? []) {
    artifactCountByTopic.set(at.topic_id, (artifactCountByTopic.get(at.topic_id) ?? 0) + 1);
  }

  const activeVersionByTopic = new Map<string, number>();
  const draftCountByTopic = new Map<string, number>();
  const draftVersionsByTopic = new Map<string, number[]>();
  for (const p of topicPages.data ?? []) {
    if (p.status === "active") {
      const cur = activeVersionByTopic.get(p.topic_id) ?? 0;
      if (p.version > cur) activeVersionByTopic.set(p.topic_id, p.version);
    } else if (p.status === "draft") {
      draftCountByTopic.set(p.topic_id, (draftCountByTopic.get(p.topic_id) ?? 0) + 1);
      const list = draftVersionsByTopic.get(p.topic_id) ?? [];
      list.push(p.version);
      draftVersionsByTopic.set(p.topic_id, list);
    }
  }

  const rows: TopicRow[] = (topics.data ?? []).map((t) => {
    const draftVersions = draftVersionsByTopic.get(t.id) ?? [];
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      vendor: t.vendor,
      owner_user_id: t.owner_user_id,
      owner_name: t.owner_user_id ? ownerNameById.get(t.owner_user_id) ?? null : null,
      ruleCount: ruleCountByTopic.get(t.id) ?? 0,
      artifactCount: artifactCountByTopic.get(t.id) ?? 0,
      activeVersion: activeVersionByTopic.get(t.id) ?? null,
      draftCount: draftCountByTopic.get(t.id) ?? 0,
      latestDraftVersion:
        draftVersions.length > 0 ? Math.max(...draftVersions) : null,
      isOwner: t.owner_user_id === user.id,
    };
  });

  // Sort priority differs by view:
  // - All-drafts view: drafts I own first (action), then everyone else's
  //   drafts (FYI), then alphabetical.
  // - All-topics view: drafts I can publish first, then topics with
  //   substrate but no active page, then rest.
  rows.sort((a, b) => {
    if (draftsOnly) {
      const aP = a.latestDraftVersion !== null && a.isOwner ? 0 : a.latestDraftVersion !== null ? 1 : 2;
      const bP = b.latestDraftVersion !== null && b.isOwner ? 0 : b.latestDraftVersion !== null ? 1 : 2;
      if (aP !== bP) return aP - bP;
      return a.name.localeCompare(b.name);
    }
    const aPriority = a.latestDraftVersion !== null && a.isOwner ? 0 : a.activeVersion === null && (a.ruleCount > 0 || a.artifactCount > 0) ? 1 : 2;
    const bPriority = b.latestDraftVersion !== null && b.isOwner ? 0 : b.activeVersion === null && (b.ruleCount > 0 || b.artifactCount > 0) ? 1 : 2;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.name.localeCompare(b.name);
  });

  // Filter: all-drafts view keeps every topic with a pending draft (any owner)
  // so the current user can chase down owners who haven't reviewed yet.
  const visibleRows = draftsOnly
    ? rows.filter((r) => r.latestDraftVersion !== null)
    : rows;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {draftsOnly ? "Open topic drafts" : "Topics"}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {draftsOnly ? (
            <>
              All compiled drafts awaiting review. Drafts you own appear first (you can
              publish them); the rest list their owner so you can follow up.{" "}
              <Link href="/topics" className="text-blue-700 underline">
                See all topics
              </Link>
              .
            </>
          ) : (
            <>
              Browse every topic, see what&apos;s been compiled, and trigger new compilations.
            </>
          )}
        </p>
      </header>

      <div className="overflow-hidden rounded border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">Topic</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 text-right font-medium">Rules</th>
              <th className="px-3 py-2 text-right font-medium">Artifacts</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-500">
                  {draftsOnly
                    ? "No drafts awaiting your review."
                    : "No topics yet."}
                </td>
              </tr>
            )}
            {visibleRows.map((r) => {
              const canCompile = r.isOwner || isPrivileged;
              const hasSubstrate = r.ruleCount > 0 || r.artifactCount > 0;
              return (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <Link
                      href={`/topics/${r.slug}`}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {r.name}
                    </Link>
                    <div className="text-xs text-gray-500">
                      <code>{r.slug}</code>
                      {r.vendor && <span className="ml-2">{r.vendor}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {r.owner_name ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">{r.ruleCount}</td>
                  <td className="px-3 py-2 text-right text-xs">{r.artifactCount}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.activeVersion !== null ? (
                      <span className="text-green-700">v{r.activeVersion} active</span>
                    ) : (
                      <span className="text-gray-500">no page</span>
                    )}
                    {r.draftCount > 0 && (
                      <span className="ml-2 text-amber-700">
                        +{r.draftCount} draft{r.draftCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {r.latestDraftVersion !== null && r.isOwner ? (
                      <Link
                        href={`/topics/${r.slug}/versions/${r.latestDraftVersion}/review`}
                        className="rounded bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700"
                      >
                        Review draft
                      </Link>
                    ) : r.latestDraftVersion !== null ? (
                      <Link
                        href={`/topics/${r.slug}/versions/${r.latestDraftVersion}/review`}
                        className="text-gray-600 hover:underline"
                        title="View read-only; only the owner can publish"
                      >
                        Awaiting {r.owner_name ?? "owner"}
                      </Link>
                    ) : canCompile && hasSubstrate ? (
                      <Link
                        href={`/topics/${r.slug}`}
                        className="rounded border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50"
                      >
                        Open
                      </Link>
                    ) : (
                      <Link
                        href={`/topics/${r.slug}`}
                        className="text-gray-500 hover:underline"
                      >
                        view
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
