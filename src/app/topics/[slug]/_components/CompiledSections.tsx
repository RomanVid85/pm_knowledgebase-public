// Shared renderer for the 7-section compiled page body. Used by both the
// draft-review page and the topic detail page so they format identically.
//
// Server Component — markdown is rendered server-side via react-markdown.
// Citation links point to /artifacts/{artifact_id} for drill-down.

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import {
  SECTION_KEYS,
  type CompiledPageSections,
  type Citation,
  type SectionKey,
} from "@/lib/compilation/schema";

const SECTION_TITLES: Record<SectionKey, string> = {
  current_view: "Current view",
  why_we_believe_it: "Why we believe it",
  what_changed_recently: "What changed recently",
  open_questions: "Open questions",
  contradictions: "Contradictions",
  recommended_next_actions: "Recommended next actions",
  source_artifacts: "Source artifacts",
};

export interface CompiledSectionsProps {
  sections: Partial<CompiledPageSections>;
  artifactTitleById: Map<string, string>;
}

export function CompiledSections({
  sections,
  artifactTitleById,
}: CompiledSectionsProps): React.JSX.Element {
  return (
    <>
      {SECTION_KEYS.map((key) => {
        const section = sections[key];
        const text = section?.text ?? "";
        const citations = (section?.citations ?? []) as Citation[];
        return (
          <section key={key} className="rounded border border-gray-200 bg-white p-4">
            <h2 className="text-lg font-medium">{SECTION_TITLES[key]}</h2>
            {text.length === 0 && citations.length === 0 ? (
              <p className="mt-2 text-sm italic text-gray-500">No content for this section.</p>
            ) : (
              <>
                {text.length > 0 && (
                  <div className="prose prose-sm mt-2 max-w-none text-gray-900">
                    <ReactMarkdown>{text}</ReactMarkdown>
                  </div>
                )}
                {citations.length > 0 && (
                  <ol className="mt-3 list-decimal pl-5 text-xs text-gray-600">
                    {citations.map((c, i) => (
                      <li key={`${c.artifact_id}-${i}`} className="mt-1">
                        <Link
                          href={`/artifacts/${c.artifact_id}`}
                          className="font-medium text-blue-700 underline"
                        >
                          {artifactTitleById.get(c.artifact_id) ?? c.artifact_id}
                        </Link>
                        <span className="ml-2 text-gray-500">&ldquo;{c.quote}&rdquo;</span>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </section>
        );
      })}
    </>
  );
}

/**
 * Collect every artifact_id referenced in the sections (plus a separate
 * extra list) so the caller can fetch titles in one round-trip.
 */
export function collectArtifactIds(
  sections: Partial<CompiledPageSections>,
  extra: readonly string[] = [],
): string[] {
  const ids = new Set<string>(extra);
  for (const key of SECTION_KEYS) {
    const section = sections[key];
    const citations = (section?.citations ?? []) as Citation[];
    for (const c of citations) {
      if (typeof c.artifact_id === "string" && c.artifact_id.length > 0) {
        ids.add(c.artifact_id);
      }
    }
  }
  return Array.from(ids);
}
