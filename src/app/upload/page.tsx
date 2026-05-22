import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { isTopicSuggestionEnabled } from "@/lib/ingest/topic_suggestion";
import { submitArtifact } from "./actions";
import { SubmitButton } from "./_components/SubmitButton";

type SearchParams = Promise<{ success?: string; error?: string }>;

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
    value: "vendor_canonical",
    label: "Vendor canonical",
    weight: "1.0",
    hint: "Official vendor publication (vendor portal, official spec, signed PDF). For competitor docs too — set the Vendor field to their name.",
  },
  {
    value: "vendor_reference",
    label: "Vendor reference",
    weight: "0.85",
    hint: "Vendor-published but not the primary spec (webinar, sample payload, blog post).",
  },
  {
    value: "external_authoritative",
    label: "External authoritative",
    weight: "0.7",
    hint: "Respected third party we haven't formally vouched for — industry analyst report, formal standards body, well-known industry whitepaper. Vendor field is usually blank.",
  },
  {
    value: "internal_canonical",
    label: "Internal canonical",
    weight: "0.75",
    hint: "Our team has deliberately blessed this as authoritative (ADR, owned API spec, an industry analyst report we reviewed and adopted, a verified integration pattern).",
  },
  {
    value: "internal_interpretive",
    label: "Internal interpretive",
    weight: "0.5",
    hint: "PM brief, meeting notes, draft PRD — valuable but subjective.",
  },
  {
    value: "speculative",
    label: "Speculative",
    weight: "0.2",
    hint: "Slack guess, tribal knowledge, partial info. Easier to promote later than to demote.",
  },
];

export default async function UploadPage({ searchParams }: { searchParams: SearchParams }) {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  // Use admin client for table reads (supabase-js typing is cleaner than ssr's;
  // user is already authenticated by the line above).
  const admin = adminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role,display_name,email")
    .eq("id", user.id)
    .single();

  const role = profile?.role ?? "viewer";
  const canUpload = ["admin", "pm", "sme"].includes(role);

  const suggestEnabled = await isTopicSuggestionEnabled(admin);

  // Topics multiselect is only needed in the manual-flow fallback (flag off).
  const { data: topics } = suggestEnabled
    ? { data: [] as Array<{ id: string; slug: string; name: string; vendor: string | null }> }
    : await admin
        .from("topics")
        .select("id,slug,name,vendor")
        .eq("status", "active")
        .order("name");

  const params = await searchParams;
  const successId = params.success;
  const errorMsg = params.error ? decodeURIComponent(params.error) : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Upload artifact</h1>
        <span className="text-sm text-gray-500">
          {profile?.display_name ?? user.email} · {role}
        </span>
      </header>

      {!canUpload && (
        <div className="rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          Your role (<code>{role}</code>) cannot upload artifacts. Ask an admin to promote you.
        </div>
      )}

      {successId && (
        <div className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Upload accepted. Artifact <code>{successId}</code> is ingesting in the background.
          {process.env.NODE_ENV === "development" && (
            <>
              {" "}
              Watch the local Inngest dashboard at{" "}
              <code>http://localhost:8288</code> to follow the run.
            </>
          )}
        </div>
      )}

      {errorMsg && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      {canUpload && (
        <form action={submitArtifact} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Title (optional — defaults to filename)</span>
            <input
              type="text"
              name="title"
              placeholder="e.g. Acme Lead Management API"
              className="rounded border border-gray-300 p-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Vendor (optional)</span>
            <input
              type="text"
              name="vendor"
              placeholder="Acme, Globex, Initech, … (leave blank for non-vendor content)"
              className="rounded border border-gray-300 p-2"
            />
            <span className="text-xs text-gray-500">
              Vendor the artifact is about. Blank for industry research, internal strategy, or
              vendor-agnostic content. For competitor docs, set their name (e.g.{" "}
              <code>Globex</code>).
            </span>
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
                    <span className="font-medium">{opt.label}</span>{" "}
                    <span className="text-gray-500">(weight {opt.weight})</span>
                  </div>
                  <div className="text-xs text-gray-500">{opt.hint}</div>
                </div>
              </label>
            ))}
          </fieldset>

          {suggestEnabled ? (
            <div className="rounded border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
              Topics are suggested automatically after upload. You&apos;ll review them on the next
              page before the artifact becomes active.
            </div>
          ) : (
            <fieldset className="flex flex-col gap-2 rounded border border-gray-200 p-3">
              <legend className="px-1 text-sm font-medium">Topics (select at least one)</legend>
              <p className="px-1 text-xs text-gray-500">
                Manual-flow mode (the <code>topic_suggestion.enabled</code> system_config flag is
                off). Topic suggestion is bypassed.
              </p>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {topics?.map((t) => (
                  <label key={t.id} className="flex gap-2 text-sm">
                    <input type="checkbox" name="topicIds" value={t.id} className="mt-1" />
                    <span>
                      {t.name}
                      {t.vendor && <span className="text-gray-500"> · {t.vendor}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">File</span>
            <input
              type="file"
              name="file"
              accept=".md,.markdown,.docx,.yaml,.yml,.json,.pdf"
              required
              className="rounded border border-gray-300 p-2"
            />
            <span className="text-xs text-gray-500">
              Supported: .md / .markdown / .docx / .yaml / .yml / .json (OpenAPI 3.x) / .pdf
              (parsed via LlamaParse — may take 30 s – 2 min)
            </span>
          </label>

          <SubmitButton />
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
