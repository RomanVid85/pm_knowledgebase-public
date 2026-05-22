// Verification queue page — lists rules the current user can verify.
//
// Per agent_docs/verification_workflow.md, a verifier must:
//   - have role admin, sme, or pm (NOT viewer or engineer)
//   - NOT be the rule's extractor (extracted_by != current user)
//   - NOT be the AI job invoker (extracted_by_ai_job_invoker != current user)
//   - NOT be the rule's topic owner (topics.owner_user_id != current user)
//
// The DB CHECK + BEFORE INSERT/UPDATE trigger enforce these too (defense
// in depth), but filtering at the queue surface prevents PMs from
// clicking into a rule they can't act on.

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";

const VERIFIER_ROLES = ["admin", "sme", "pm"] as const;

export default async function VerificationQueuePage() {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  const admin = adminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role, display_name, email")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? "viewer";
  const canVerify = (VERIFIER_ROLES as readonly string[]).includes(role);

  if (!canVerify) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Verification queue</h1>
        <div className="rounded border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          Your role (<code>{role}</code>) cannot verify rules. Verifiers must be admin, SME, or PM.
        </div>
      </main>
    );
  }

  // Pull every pending rule with its topic + source artifact context.
  // Filter in JS for the per-user "can verify this one" rules — simpler
  // than expressing the OR/NULL semantics through PostgREST filters.
  const { data: rules, error } = await admin
    .from("rules")
    .select(
      `
        id, rule_key, rule_type, confidence, source_quote, extracted_at,
        extracted_by, extracted_by_ai_job_invoker,
        topic:topic_id (id, name, slug, owner_user_id),
        artifact:source_artifact_id (id, title, vendor)
      `,
    )
    .eq("status", "pending_verification")
    .order("confidence", { ascending: false });

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Verification queue</h1>
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load rules: {error.message}
        </div>
      </main>
    );
  }

  const verifiable = (rules ?? []).filter((r) => {
    if (r.extracted_by === user.id) return false;
    if (r.extracted_by_ai_job_invoker === user.id) return false;
    if (r.topic && r.topic.owner_user_id === user.id) return false;
    return true;
  });

  const blocked = (rules ?? []).length - verifiable.length;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Verification queue</h1>
          <p className="mt-1 text-sm text-gray-600">
            Rules awaiting two-person verification. The list below excludes ones you cannot
            verify (your own extractions, your own topics, or jobs you triggered).
          </p>
        </div>
        <span className="text-sm text-gray-500">
          {profile?.display_name ?? user.email} · {role}
        </span>
      </header>

      <section className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <div className="flex gap-6">
          <div>
            <span className="font-medium">You can verify:</span> {verifiable.length}
          </div>
          {blocked > 0 && (
            <div className="text-gray-500">
              <span className="font-medium">Hidden (cannot verify):</span> {blocked}
            </div>
          )}
        </div>
      </section>

      {verifiable.length === 0 ? (
        <div className="rounded border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          {(rules ?? []).length === 0
            ? "No rules pending verification."
            : "No rules left for you to verify. The queue isn't empty, but you cannot act on what remains."}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {verifiable.map((r) => (
            <li
              key={r.id}
              className="rounded border border-gray-200 bg-white p-3 hover:border-gray-400"
            >
              <Link href={`/verification/${r.id}`} className="block">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-sm font-medium">{r.rule_key}</span>
                  <span
                    className={`text-xs ${
                      r.confidence >= 0.85
                        ? "text-green-700"
                        : r.confidence >= 0.7
                          ? "text-blue-700"
                          : "text-gray-600"
                    }`}
                  >
                    {r.confidence.toFixed(2)} · {r.rule_type}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-gray-600">
                  &ldquo;{r.source_quote}&rdquo;
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Topic: <code>{r.topic?.slug ?? "(none)"}</code>
                  {r.artifact && (
                    <>
                      {" · Source: "}
                      <span>{r.artifact.title}</span>
                    </>
                  )}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
