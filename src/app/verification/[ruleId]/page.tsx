// Verification detail page — shows a single rule's full context and
// lets a verifier accept or reject it with notes.

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { acceptRule, rejectRule } from "./actions";

const VERIFIER_ROLES = ["admin", "sme", "pm"] as const;

type RouteParams = Promise<{ ruleId: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function VerificationDetailPage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: SearchParams;
}) {
  const { ruleId } = await params;
  const sp = await searchParams;
  const errorMsg = sp.error ? decodeURIComponent(sp.error) : undefined;

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
  if (!(VERIFIER_ROLES as readonly string[]).includes(role)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Verify rule</h1>
        <div className="rounded border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          Your role (<code>{role}</code>) cannot verify rules.
        </div>
      </main>
    );
  }

  const { data: rule, error: ruleErr } = await admin
    .from("rules")
    .select(
      `
        id, rule_key, rule_type, status, confidence,
        value, conditions, source_quote, source_location, extraction_notes,
        extracted_at, extracted_by, extracted_by_ai_job_invoker, extracted_by_ai_job_id,
        topic:topic_id (id, name, slug, vendor, owner_user_id),
        artifact:source_artifact_id (id, title, vendor, vendor_version, artifact_type, source_authority)
      `,
    )
    .eq("id", ruleId)
    .single();
  if (ruleErr || !rule) notFound();

  // The eligibility check is also enforced in the server actions, but
  // surfacing it here lets us hide the form rather than show buttons the
  // server will reject.
  const blockers: string[] = [];
  if (rule.status !== "pending_verification") {
    blockers.push(`Rule is in status '${rule.status}', not pending_verification.`);
  }
  if (rule.extracted_by === user.id) {
    blockers.push("You extracted this rule — a different verifier is required.");
  }
  if (rule.extracted_by_ai_job_invoker === user.id) {
    blockers.push("You triggered the AI extraction that produced this rule.");
  }
  if (rule.topic && rule.topic.owner_user_id === user.id) {
    blockers.push("You are the topic owner — a different verifier is required.");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Verify rule</h1>
          <p className="mt-1 font-mono text-sm text-gray-700">{rule.rule_key}</p>
        </div>
        <Link href="/verification" className="text-sm text-blue-700 hover:underline">
          ← Back to queue
        </Link>
      </header>

      {errorMsg && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      <section className="rounded border border-gray-200 bg-gray-50 p-4">
        <h2 className="text-sm font-medium text-gray-700">Rule</h2>
        <dl className="mt-2 grid grid-cols-3 gap-x-6 gap-y-1 text-sm">
          <dt className="font-medium text-gray-600">Type</dt>
          <dd className="col-span-2">
            <code>{rule.rule_type}</code>
          </dd>
          <dt className="font-medium text-gray-600">Confidence</dt>
          <dd className="col-span-2">{rule.confidence.toFixed(2)}</dd>
          <dt className="font-medium text-gray-600">Topic</dt>
          <dd className="col-span-2">
            {rule.topic?.name ?? "(none)"} <code className="text-xs text-gray-500">{rule.topic?.slug ?? ""}</code>
          </dd>
          <dt className="font-medium text-gray-600">Source</dt>
          <dd className="col-span-2">
            {rule.artifact?.title ?? "(no artifact)"} ·{" "}
            <code className="text-xs text-gray-500">{rule.artifact?.source_authority ?? ""}</code>
          </dd>
          <dt className="font-medium text-gray-600">Extracted</dt>
          <dd className="col-span-2 text-gray-600">
            {new Date(rule.extracted_at).toLocaleString()}{" "}
            {rule.extracted_by_ai_job_id && <span className="text-xs">(AI · {rule.extracted_by_ai_job_id.slice(0, 8)}…)</span>}
          </dd>
        </dl>
      </section>

      <section className="rounded border border-gray-200 p-4">
        <h2 className="text-sm font-medium text-gray-700">Source quote</h2>
        <blockquote className="mt-2 rounded bg-gray-50 p-3 text-sm text-gray-800 italic">
          &ldquo;{rule.source_quote}&rdquo;
        </blockquote>
      </section>

      <section className="rounded border border-gray-200 p-4">
        <h2 className="text-sm font-medium text-gray-700">Rule value</h2>
        <pre className="mt-2 overflow-auto rounded bg-gray-50 p-3 text-xs">
          {JSON.stringify(rule.value, null, 2)}
        </pre>
        {rule.conditions !== null && rule.conditions !== undefined && (
          <>
            <h3 className="mt-3 text-sm font-medium text-gray-700">Conditions</h3>
            <pre className="mt-1 overflow-auto rounded bg-gray-50 p-3 text-xs">
              {JSON.stringify(rule.conditions, null, 2)}
            </pre>
          </>
        )}
        {rule.extraction_notes && (
          <>
            <h3 className="mt-3 text-sm font-medium text-gray-700">Extraction notes</h3>
            <p className="mt-1 text-sm text-gray-700">{rule.extraction_notes}</p>
          </>
        )}
      </section>

      {blockers.length > 0 ? (
        <section className="rounded border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
          <p className="font-medium">You cannot verify this rule:</p>
          <ul className="mt-1 list-inside list-disc">
            {blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded border border-gray-200 p-4">
          <h2 className="text-base font-semibold">Decision</h2>
          <p className="mt-1 text-xs text-gray-600">
            Notes are optional on accept, required on reject. Captured for audit.
          </p>
          <form className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="rule_id" value={rule.id} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">Notes</span>
              <textarea
                name="notes"
                rows={3}
                placeholder="Briefly state your reasoning (required if rejecting)."
                className="rounded border border-gray-300 p-2 text-sm"
              />
            </label>
            <div className="flex gap-3">
              <button
                type="submit"
                formAction={acceptRule}
                className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
              >
                Accept &amp; activate
              </button>
              <button
                type="submit"
                formAction={rejectRule}
                className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Reject (dispute)
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
