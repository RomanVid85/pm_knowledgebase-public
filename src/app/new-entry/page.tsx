// Field-note creation page. The PM types the actual knowledge (a claim,
// a vendor confirmation, an internal note) and optionally attaches
// evidence files (screenshots, emails, recordings).
//
// Different from /upload in shape — there, the file is the source of
// truth. Here, the PM's prose is the source; attachments are evidence
// preserved for audit.

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { submitFieldNote } from "./actions";
import { SubmitButton } from "../upload/_components/SubmitButton";

const AUTHORITY_OPTIONS: Array<{
  value:
    | "vendor_canonical"
    | "vendor_reference"
    | "external_authoritative"
    | "internal_canonical"
    | "internal_interpretive"
    | "speculative";
  label: string;
  weight: string;
  hint: string;
}> = [
  {
    value: "vendor_reference",
    label: "Vendor reference",
    weight: "0.85",
    hint:
      "Vendor person/material confirming behavior — engineer's email, support response, vendor webinar Q&A. Most field notes are this tier.",
  },
  {
    value: "internal_interpretive",
    label: "Internal interpretive",
    weight: "0.5",
    hint: "Your team's notes, meeting summary, conjecture from a customer call.",
  },
  {
    value: "speculative",
    label: "Speculative",
    weight: "0.2",
    hint: "Slack guess, unconfirmed tribal knowledge. Easier to promote later than to demote.",
  },
  {
    value: "vendor_canonical",
    label: "Vendor canonical",
    weight: "1.0",
    hint: "Rarely the right pick for a field note. Pick this only if the source IS the vendor's official documentation (paste the relevant snippet).",
  },
  {
    value: "external_authoritative",
    label: "External authoritative",
    weight: "0.7",
    hint: "Third-party expert source we haven't formally vouched for — analyst, conference talk, standards body.",
  },
  {
    value: "internal_canonical",
    label: "Internal canonical",
    weight: "0.75",
    hint: "Our team has formally adopted this. ADR or signed-off integration pattern.",
  },
];

type SearchParams = Promise<{ error?: string }>;

export default async function NewEntryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
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
  const canCreate = ["admin", "pm", "sme"].includes(role);

  const params = await searchParams;
  const errorMsg = params.error ? decodeURIComponent(params.error) : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Write a field note</h1>
        <span className="text-sm text-gray-500">
          {profile?.display_name ?? user.email} · {role}
        </span>
      </header>

      <section className="rounded border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        Use this when the source is informal — a vendor engineer&apos;s email, a Slack
        screenshot, an internal phone-call summary. You write the prose (that&apos;s the
        searchable knowledge); attachments preserve the source for audit but are NOT parsed.
        For a published doc / API spec / structured file, use{" "}
        <Link href="/upload" className="underline">
          Upload
        </Link>{" "}
        instead.
      </section>

      {!canCreate && (
        <div className="rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          Your role (<code>{role}</code>) cannot create entries. Ask an admin to promote you.
        </div>
      )}

      {errorMsg && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      {canCreate && (
        <form action={submitFieldNote} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Title</span>
            <input
              type="text"
              name="title"
              required
              placeholder="e.g. Acme Showroom API supports notes (undocumented)"
              className="rounded border border-gray-300 p-2 text-gray-900"
            />
            <span className="text-xs text-gray-500">
              One-sentence summary of the claim. Becomes the artifact title.
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Content</span>
            <textarea
              name="content"
              required
              rows={10}
              placeholder={`Write the actual knowledge here. Examples of good content:

• "Vendor engineer [Name] confirmed via email on YYYY-MM-DD that the showroom API supports POSTing notes to /gateway/v1/record/{id}/notes. Not documented in the public dev portal. Caveat: undocumented behavior may change."

• "Customer call with [Customer] on YYYY-MM-DD: confirmed that appointment reminders only fire 24h ahead, not 1h. Their use case needs both — RFE."

Cite the source (who, when), state the claim, note caveats. The prose here is what the system indexes.`}
              className="rounded border border-gray-300 p-2 font-mono text-xs text-gray-900"
            />
            <span className="text-xs text-gray-500">
              The system parses this as markdown — headings (# or ##) become section breaks
              for chunking. Plain paragraphs are fine.
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Vendor (optional)</span>
            <input
              type="text"
              name="vendor"
              placeholder="Acme, Globex, Initech, … (leave blank for non-vendor notes)"
              className="rounded border border-gray-300 p-2 text-gray-900"
            />
            <span className="text-xs text-gray-500">
              Will be auto-inferred from content if you leave it blank. You can confirm or
              override on the review page.
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Vendor version (optional)</span>
            <input
              type="text"
              name="vendorVersion"
              placeholder="v3, 2.5.1, 2024-Q4, …"
              className="rounded border border-gray-300 p-2 text-gray-900"
            />
          </label>

          <fieldset className="flex flex-col gap-2 rounded border border-gray-200 p-3">
            <legend className="px-1 text-sm font-medium">Source authority</legend>
            {AUTHORITY_OPTIONS.map((opt, i) => (
              <label key={opt.value} className="flex gap-2 text-sm">
                <input
                  type="radio"
                  name="sourceAuthority"
                  value={opt.value}
                  defaultChecked={i === 0}
                  className="mt-1"
                />
                <div>
                  <div>
                    <span className="font-medium text-gray-900">{opt.label}</span>{" "}
                    <span className="text-gray-500">(weight {opt.weight})</span>
                  </div>
                  <div className="text-xs text-gray-500">{opt.hint}</div>
                </div>
              </label>
            ))}
          </fieldset>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Attachments (optional)</span>
            <input
              type="file"
              name="attachments"
              multiple
              accept="image/*,.pdf,.docx,.txt,.eml,.msg,.mp4,.mov,.m4a,.mp3"
              className="rounded border border-gray-300 p-2 text-gray-900"
            />
            <span className="text-xs text-gray-500">
              Screenshots, emails, recordings — anything that proves where the claim came
              from. Stored as evidence; not parsed for content. Up to ~25 MB per file.
            </span>
          </label>

          <SubmitButton label="Save field note" pendingLabel="Saving…" />
        </form>
      )}

      <footer className="mt-4 border-t pt-4 text-xs text-gray-500">
        <Link href="/" className="underline hover:no-underline">
          ← Back to home
        </Link>
      </footer>
    </main>
  );
}
