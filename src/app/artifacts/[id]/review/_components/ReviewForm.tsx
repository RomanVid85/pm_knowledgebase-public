// Review form for an ingested artifact's topic suggestions.
//
// State is held client-side. On submit, the entire form state is serialized
// to a single JSON `payload` field and posted to the submitReview server
// action — the server validates with Zod and performs the topic / artifact_topic
// / supersedes-chain writes.
//
// Sections:
//   - Existing matches (R5.1): checkbox per suggestion, pre-checked if
//     confidence ≥ PRECHECK_THRESHOLD. Hover/click shows the LLM reason.
//   - Proposed new (R5.2): editable name/slug/description/vendor + accept
//     checkbox per row. Never pre-checked — the PM must explicitly opt in.
//   - Supersession card (R5/R11): three radio choices, default chosen by
//     similarity threshold (0.85).
//   - Manual add (R5.3): expandable form for topics the LLM missed.

"use client";

import { useMemo, useState } from "react";
import { submitReview } from "../actions";
import type {
  Suggestion,
  ExistingMatch,
  ProposedNewTopic,
} from "@/lib/ingest/topic_suggestion";
import type { SupersedesCandidate } from "@/lib/ingest/version_detection";

const PRECHECK_THRESHOLD = 0.7;
const SUPERSEDES_AUTO_THRESHOLD = 0.85;
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface TopicSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  vendor: string | null;
}

type SupersedesChoice = "supersedes" | "separate" | "skip";

interface ProposedNewEdit extends ProposedNewTopic {
  /** PM accepted this proposal? Never pre-checked. */
  accepted: boolean;
}

interface ManualTopic {
  slug: string;
  name: string;
  description: string;
  vendor: string;
}

interface ReviewFormProps {
  artifactId: string;
  suggestions: Suggestion & { supersedes_candidate?: SupersedesCandidate };
  /** Topic details for the existing-match topic_ids; keyed by id. */
  existingTopics: TopicSummary[];
  /** Current vendor value on the artifact row (may have been inferred). */
  initialVendor: string | null;
  /** Current vendor_version on the artifact row (may have been inferred). */
  initialVendorVersion: string | null;
  /**
   * Inngest's vendor inference attempt. Present if inference ran; `vendor`
   * is non-null when inference produced a confident match. Used to show the
   * "Inferred from content" provenance hint vs "We tried but found nothing".
   */
  vendorInference?: {
    vendor: string | null;
    counts: Record<string, number>;
  };
  /** Inngest's version inference attempt. Same shape as vendorInference. */
  versionInference?: {
    version: string | null;
    counts: Record<string, number>;
  };
}

function defaultSupersedesChoice(c: SupersedesCandidate | undefined): SupersedesChoice {
  if (!c) return "skip";
  return c.similarity >= SUPERSEDES_AUTO_THRESHOLD ? "supersedes" : "separate";
}

function classifyConfidence(c: number): "strong" | "likely" | "weak" {
  if (c >= 0.85) return "strong";
  if (c >= 0.7) return "likely";
  return "weak";
}

function confidenceColor(c: number): string {
  if (c >= 0.85) return "text-green-700";
  if (c >= 0.7) return "text-blue-700";
  return "text-gray-600";
}

export function ReviewForm({
  artifactId,
  suggestions,
  existingTopics,
  initialVendor,
  initialVendorVersion,
  vendorInference,
  versionInference,
}: ReviewFormProps) {
  const topicMap = useMemo(() => {
    const m = new Map<string, TopicSummary>();
    for (const t of existingTopics) m.set(t.id, t);
    return m;
  }, [existingTopics]);

  // ---- state ----
  const [acceptedExisting, setAcceptedExisting] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const e of suggestions.existing) {
      if (e.confidence >= PRECHECK_THRESHOLD) s.add(e.topic_id);
    }
    return s;
  });

  const [proposedNew, setProposedNew] = useState<ProposedNewEdit[]>(() =>
    suggestions.proposed_new.map((p) => ({ ...p, accepted: false })),
  );

  const [manualTopics, setManualTopics] = useState<ManualTopic[]>([]);
  const [showManual, setShowManual] = useState(false);

  const [supersedesChoice, setSupersedesChoice] = useState<SupersedesChoice>(() =>
    defaultSupersedesChoice(suggestions.supersedes_candidate),
  );

  // Vendor classification gate (Phase 2.7).
  // The PM must commit one of two states before activating:
  //   - vendor non-empty AND "not vendor-specific" unchecked  (is_vendor_specific=true)
  //   - vendor empty     AND "not vendor-specific" checked    (is_vendor_specific=false)
  const [vendor, setVendor] = useState<string>(initialVendor ?? "");
  const [vendorVersion, setVendorVersion] = useState<string>(initialVendorVersion ?? "");
  const [isNotVendorSpecific, setIsNotVendorSpecific] = useState<boolean>(false);
  const vendorWasInferred = Boolean(
    vendorInference?.vendor && initialVendor === vendorInference.vendor,
  );
  const vendorInferenceTried = Boolean(vendorInference);
  const versionWasInferred = Boolean(
    versionInference?.version && initialVendorVersion === versionInference.version,
  );

  // ---- handlers ----
  const toggleExisting = (topicId: string) => {
    setAcceptedExisting((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  };

  const editProposed = (i: number, patch: Partial<ProposedNewEdit>) => {
    setProposedNew((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };

  const addManual = () => {
    setManualTopics((prev) => [...prev, { slug: "", name: "", description: "", vendor: "" }]);
    setShowManual(true);
  };

  const editManual = (i: number, patch: Partial<ManualTopic>) => {
    setManualTopics((prev) => prev.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  };

  const removeManual = (i: number) => {
    setManualTopics((prev) => prev.filter((_, j) => j !== i));
  };

  // ---- derived ----
  const vendorTrim = vendor.trim();
  const vendorChoiceValid =
    (vendorTrim !== "" && !isNotVendorSpecific) ||
    (vendorTrim === "" && isNotVendorSpecific);

  const vendorVersionTrim = vendorVersion.trim();
  const payload = useMemo(
    () => ({
      artifact_id: artifactId,
      vendor: vendorTrim === "" ? null : vendorTrim,
      vendor_version: vendorVersionTrim === "" ? null : vendorVersionTrim,
      is_vendor_specific: isNotVendorSpecific ? false : vendorTrim !== "" ? true : null,
      existing: suggestions.existing
        .filter((e) => acceptedExisting.has(e.topic_id))
        .map((e) => ({
          topic_id: e.topic_id,
          confidence: e.confidence,
        })),
      proposed_new: proposedNew
        .filter((p) => p.accepted)
        .map((p) => ({
          slug: p.slug,
          name: p.name,
          description: p.description,
          vendor: p.vendor,
          confidence: p.confidence,
        })),
      manual: manualTopics
        .filter((m) => m.slug.trim() !== "")
        .map((m) => ({
          slug: m.slug,
          name: m.name,
          description: m.description,
          vendor: m.vendor.trim() === "" ? null : m.vendor,
        })),
      supersedes:
        suggestions.supersedes_candidate && supersedesChoice === "supersedes"
          ? {
              prior_artifact_id: suggestions.supersedes_candidate.prior_artifact_id,
            }
          : null,
    }),
    [
      artifactId,
      vendorTrim,
      vendorVersionTrim,
      isNotVendorSpecific,
      suggestions.existing,
      suggestions.supersedes_candidate,
      acceptedExisting,
      proposedNew,
      manualTopics,
      supersedesChoice,
    ],
  );

  const totalSelected =
    acceptedExisting.size +
    proposedNew.filter((p) => p.accepted).length +
    manualTopics.filter((m) => m.slug.trim() !== "").length;

  const proposedSlugInvalid = (slug: string) => slug.length > 0 && !SLUG_REGEX.test(slug);

  return (
    <form action={submitReview} className="flex flex-col gap-6">
      <input type="hidden" name="artifact_id" value={artifactId} />
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      {suggestions.supersedes_candidate && (
        <SupersessionCard
          candidate={suggestions.supersedes_candidate}
          choice={supersedesChoice}
          onChange={setSupersedesChoice}
        />
      )}

      <section className="rounded border border-gray-200 p-4">
        <h2 className="text-base font-semibold">Vendor classification</h2>
        <p className="mt-1 text-xs text-gray-600">
          Either set the vendor this artifact is about, or mark it as not vendor-specific
          (industry research, internal strategy, customer feedback). Required before activating.
        </p>
        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <span className="flex-1">
              <span className="block font-medium text-gray-700">Vendor</span>
              <input
                type="text"
                value={vendor}
                onChange={(e) => {
                  setVendor(e.target.value);
                  // Typing a vendor clears the "not specific" toggle automatically.
                  if (e.target.value.trim() !== "" && isNotVendorSpecific) {
                    setIsNotVendorSpecific(false);
                  }
                }}
                placeholder="Acme, Globex, Initech, …"
                disabled={isNotVendorSpecific}
                className="mt-1 w-full rounded border border-gray-300 p-2 text-sm disabled:bg-gray-100"
              />
              {vendorWasInferred && vendor === initialVendor && (
                <span className="mt-1 inline-block text-xs text-blue-700">
                  Inferred from content — confirm or edit.
                </span>
              )}
              {vendorInferenceTried && !vendorWasInferred && vendor.trim() === "" && !isNotVendorSpecific && (
                <span className="mt-1 inline-block text-xs text-yellow-800">
                  We scanned filename + content but couldn&apos;t identify a known vendor.
                  Type one, or check the box below if this isn&apos;t vendor-related.
                </span>
              )}
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <span className="flex-1">
              <span className="block font-medium text-gray-700">
                Vendor version (optional)
              </span>
              <input
                type="text"
                value={vendorVersion}
                onChange={(e) => setVendorVersion(e.target.value)}
                placeholder="v3, 2.5.1, 2024-Q4, …"
                disabled={isNotVendorSpecific}
                className="mt-1 w-full rounded border border-gray-300 p-2 text-sm disabled:bg-gray-100"
              />
              {versionWasInferred && vendorVersion === initialVendorVersion && (
                <span className="mt-1 inline-block text-xs text-blue-700">
                  Inferred from content — confirm or edit.
                </span>
              )}
              <span className="mt-1 block text-xs text-gray-500">
                Drives supersession detection. Leave blank if there&apos;s no clear version
                on the doc.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={isNotVendorSpecific}
              onChange={(e) => {
                setIsNotVendorSpecific(e.target.checked);
                if (e.target.checked) {
                  setVendor("");
                  setVendorVersion("");
                }
              }}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Not vendor-specific</span>
              <span className="block text-xs text-gray-500">
                Industry research, internal strategy, customer feedback, compliance, or
                vendor-agnostic content.
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="rounded border border-gray-200 p-4">
        <h2 className="text-base font-semibold">Existing topic matches</h2>
        <p className="mt-1 text-xs text-gray-600">
          The LLM thinks the artifact substantively covers these existing topics. Pre-checked when
          confidence ≥ {PRECHECK_THRESHOLD}.
        </p>
        {suggestions.existing.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            No existing topics matched. See the proposed-new section below.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {suggestions.existing.map((m: ExistingMatch) => {
              const topic = topicMap.get(m.topic_id);
              const checked = acceptedExisting.has(m.topic_id);
              return (
                <li
                  key={m.topic_id}
                  className="flex items-start gap-3 rounded bg-gray-50 p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleExisting(m.topic_id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex items-baseline justify-between">
                      <span className="font-medium">
                        {topic?.name ?? "(unknown topic)"}{" "}
                        <code className="text-xs text-gray-500">{topic?.slug ?? m.topic_id}</code>
                      </span>
                      <span className={`text-xs ${confidenceColor(m.confidence)}`}>
                        {m.confidence.toFixed(2)} · {classifyConfidence(m.confidence)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-700">{m.reason}</p>
                    {topic && (
                      <p className="mt-1 text-xs text-gray-500">{topic.description}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded border border-gray-200 p-4">
        <h2 className="text-base font-semibold">Proposed new topics</h2>
        <p className="mt-1 text-xs text-gray-600">
          The LLM proposes adding these to the taxonomy. Editable; accept-checkbox required.
        </p>
        {proposedNew.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No new topics proposed.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {proposedNew.map((p, i) => (
              <li key={i} className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="mb-2 flex items-start justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={p.accepted}
                      onChange={(e) => editProposed(i, { accepted: e.target.checked })}
                    />
                    Accept this new topic
                  </label>
                  <span className={`text-xs ${confidenceColor(p.confidence)}`}>
                    {p.confidence.toFixed(2)} · {classifyConfidence(p.confidence)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-gray-600">Slug</span>
                    <input
                      type="text"
                      value={p.slug}
                      onChange={(e) => editProposed(i, { slug: e.target.value })}
                      className={`rounded border p-1.5 ${proposedSlugInvalid(p.slug) ? "border-red-300 bg-red-50" : "border-gray-300"}`}
                    />
                    {proposedSlugInvalid(p.slug) && (
                      <span className="text-red-700">Must be lowercase kebab-case.</span>
                    )}
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-gray-600">Name</span>
                    <input
                      type="text"
                      value={p.name}
                      onChange={(e) => editProposed(i, { name: e.target.value })}
                      className="rounded border border-gray-300 p-1.5"
                    />
                  </label>
                  <label className="col-span-2 flex flex-col gap-1 text-xs">
                    <span className="font-medium text-gray-600">Description</span>
                    <textarea
                      value={p.description}
                      onChange={(e) => editProposed(i, { description: e.target.value })}
                      rows={2}
                      className="rounded border border-gray-300 p-1.5"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-gray-600">Vendor (optional)</span>
                    <input
                      type="text"
                      value={p.vendor ?? ""}
                      onChange={(e) =>
                        editProposed(i, { vendor: e.target.value === "" ? null : e.target.value })
                      }
                      className="rounded border border-gray-300 p-1.5"
                    />
                  </label>
                </div>
                <details className="mt-2 text-xs text-gray-600">
                  <summary className="cursor-pointer">Why proposed</summary>
                  <p className="mt-1">{p.reason}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-gray-200 p-4">
        <h2 className="text-base font-semibold">Add a topic manually</h2>
        <p className="mt-1 text-xs text-gray-600">
          Topic the LLM missed? Add it here. Slug must be lowercase kebab-case.
        </p>
        {(showManual || manualTopics.length > 0) && (
          <ul className="mt-3 space-y-3">
            {manualTopics.map((m, i) => (
              <li key={i} className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-gray-600">Slug *</span>
                    <input
                      type="text"
                      value={m.slug}
                      onChange={(e) => editManual(i, { slug: e.target.value })}
                      className={`rounded border p-1.5 ${proposedSlugInvalid(m.slug) ? "border-red-300 bg-red-50" : "border-gray-300"}`}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-gray-600">Name *</span>
                    <input
                      type="text"
                      value={m.name}
                      onChange={(e) => editManual(i, { name: e.target.value })}
                      className="rounded border border-gray-300 p-1.5"
                    />
                  </label>
                  <label className="col-span-2 flex flex-col gap-1 text-xs">
                    <span className="font-medium text-gray-600">Description *</span>
                    <textarea
                      value={m.description}
                      onChange={(e) => editManual(i, { description: e.target.value })}
                      rows={2}
                      className="rounded border border-gray-300 p-1.5"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-gray-600">Vendor (optional)</span>
                    <input
                      type="text"
                      value={m.vendor}
                      onChange={(e) => editManual(i, { vendor: e.target.value })}
                      className="rounded border border-gray-300 p-1.5"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => removeManual(i)}
                  className="mt-2 text-xs text-red-700 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={addManual}
          className="mt-3 rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
        >
          + Add manual topic
        </button>
      </section>

      <footer className="sticky bottom-0 -mx-6 flex items-center justify-between border-t border-gray-200 bg-white px-6 py-3">
        <div className="flex flex-col text-sm text-gray-600">
          <span>
            {totalSelected} topic{totalSelected === 1 ? "" : "s"} selected
          </span>
          {!vendorChoiceValid && (
            <span className="text-xs text-yellow-800">
              Set a vendor or check &ldquo;Not vendor-specific&rdquo; to activate.
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={totalSelected === 0 || !vendorChoiceValid}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Confirm &amp; activate
        </button>
      </footer>
    </form>
  );
}

function SupersessionCard({
  candidate,
  choice,
  onChange,
}: {
  candidate: SupersedesCandidate;
  choice: SupersedesChoice;
  onChange: (c: SupersedesChoice) => void;
}) {
  return (
    <section className="rounded border border-amber-300 bg-amber-50 p-4">
      <h2 className="text-base font-semibold text-amber-900">Possible new version</h2>
      <p className="mt-1 text-sm text-amber-900">
        This artifact looks like an update of <strong>{candidate.prior_title}</strong>{" "}
        <span className="text-xs">
          ({candidate.prior_vendor_version ?? "no version"} → {candidate.new_vendor_version ?? "no version"})
        </span>
        . Content similarity: <code>{(candidate.similarity * 100).toFixed(0)}%</code>.
      </p>
      <div className="mt-3 flex flex-col gap-2 text-sm">
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="__supersedes_choice"
            value="supersedes"
            checked={choice === "supersedes"}
            onChange={() => onChange("supersedes")}
            className="mt-0.5"
          />
          <span>
            <strong>Yes, this supersedes that version.</strong> The prior artifact will be marked
            <code> superseded</code>; its chunks stay searchable for audit, but retrieval prefers
            this new version.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="__supersedes_choice"
            value="separate"
            checked={choice === "separate"}
            onChange={() => onChange("separate")}
            className="mt-0.5"
          />
          <span>
            <strong>No, this is a separate artifact.</strong> Both stay active in retrieval.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="__supersedes_choice"
            value="skip"
            checked={choice === "skip"}
            onChange={() => onChange("skip")}
            className="mt-0.5"
          />
          <span>
            <strong>Different version of unrelated content.</strong> Skip this question; treat as
            independent.
          </span>
        </label>
      </div>
    </section>
  );
}
