// Heuristic vendor inference for ingested artifacts.
//
// At upload time the PM can leave `vendor` blank. Without a signal there,
// supersession detection can't link version pairs and downstream filters
// lose specificity. This module scans the artifact's filename, title, and
// content for known-vendor names and returns the most-mentioned canonical
// name (or null if no clear signal).
//
// The inference is intentionally conservative — it returns null when the
// signal is ambiguous so the review UI can prompt the PM to type the vendor
// or explicitly opt out via the "Not vendor-specific" checkbox. We'd rather
// ask the PM than silently mis-tag.

/** A vendor and the substrings that should match to it. Aliases are
 * matched case-insensitively with word boundaries. */
interface VendorEntry {
  canonical: string;
  aliases: string[];
}

/**
 * Known-vendors list. Populate this with the vendors your pilot domain
 * covers (canonical names should match how they appear in your docs).
 * Order doesn't matter; the inference ranks by match count.
 *
 * The entries below are placeholders so the tests have something concrete
 * to match against. Replace them with your real vendor list before going
 * to production.
 */
export const KNOWN_VENDORS: VendorEntry[] = [
  { canonical: "Acme", aliases: ["Acme", "Acme Corp", "AcmeCo"] },
  { canonical: "Globex", aliases: ["Globex", "Globex Corporation"] },
  { canonical: "Initech", aliases: ["Initech", "Initech Software"] },
];

export interface VendorInferenceResult {
  /** Canonical vendor name. Null when no candidate clears the confidence threshold. */
  vendor: string | null;
  /** Top vendor's share of total matches (0-1). 0 when vendor is null. */
  confidence: number;
  /** Per-vendor raw match counts; useful for explainability + debugging. */
  counts: Record<string, number>;
}

const DEFAULT_MIN_TOTAL_MATCHES = 3;
const DEFAULT_MIN_TOP_SHARE = 0.5;

export interface InferOptions {
  /** Minimum total matches across all vendors for a result to be returned. */
  minTotalMatches?: number;
  /** Top vendor must account for at least this share of total matches (0-1). */
  minTopShare?: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatchesInText(text: string, entry: VendorEntry): number {
  let count = 0;
  for (const alias of entry.aliases) {
    // Word-boundary via lookbehind/lookahead so adjacent mentions (e.g.
    // "Acme Acme") aren't undercounted by the trailing
    // character being consumed. Punctuation, quotes, hyphens around the
    // alias all count as boundaries.
    const pattern = new RegExp(
      `(?<=^|[^a-zA-Z0-9])${escapeRegex(alias)}(?=[^a-zA-Z0-9]|$)`,
      "gi",
    );
    const matches = text.match(pattern);
    count += matches?.length ?? 0;
  }
  return count;
}

/**
 * Run vendor inference over a set of text sources. The sources are
 * concatenated into a single corpus and scanned for each known vendor's
 * aliases. Higher-weighted sources (filename, title) tend to dominate
 * because their text is short relative to chunks.
 *
 * Returns `vendor: null` when:
 *   - No alias matches anywhere
 *   - Total matches across all vendors is below `minTotalMatches`
 *   - The top vendor's share is below `minTopShare` (ambiguous tie)
 */
export function inferVendor(
  texts: string[],
  options: InferOptions = {},
): VendorInferenceResult {
  const minTotalMatches = options.minTotalMatches ?? DEFAULT_MIN_TOTAL_MATCHES;
  const minTopShare = options.minTopShare ?? DEFAULT_MIN_TOP_SHARE;

  const corpus = texts.filter((t) => typeof t === "string" && t.length > 0).join("\n\n");
  if (corpus.length === 0) {
    return { vendor: null, confidence: 0, counts: {} };
  }

  const counts: Record<string, number> = {};
  let total = 0;
  for (const entry of KNOWN_VENDORS) {
    const n = countMatchesInText(corpus, entry);
    if (n > 0) {
      counts[entry.canonical] = n;
      total += n;
    }
  }

  if (total < minTotalMatches) {
    return { vendor: null, confidence: 0, counts };
  }

  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = ranked[0]!;
  const topShare = top[1] / total;

  // Strict-less-than would let exact ties (50/50) pass — we want ambiguous
  // ties to return null so the PM is prompted to disambiguate.
  if (topShare <= minTopShare) {
    return { vendor: null, confidence: topShare, counts };
  }

  return { vendor: top[0], confidence: topShare, counts };
}
