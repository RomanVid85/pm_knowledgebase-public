// Heuristic vendor_version inference for ingested artifacts.
//
// Mirrors the vendor_inference module (Phase 2.7) but for the orthogonal
// `vendor_version` field. Without a version string, supersession detection
// can't distinguish a re-upload of the same content from an upgrade, so
// inferring it from filename + content closes that gap automatically when
// the version is visible in the doc.
//
// Conservative by design — returns null when the signal is weak or
// ambiguous so the PM can fill the field in at review time. Better to
// ask than to mis-tag.

interface VersionPattern {
  regex: RegExp;
  /** Optional canonical-form transformer; default is "v" + captured digits. */
  canonicalize?: (capture: string) => string;
}

/**
 * Patterns that indicate an explicit version reference. Each must:
 *   - have global + case-insensitive flags
 *   - capture the version digits in group 1
 *   - be anchored on a non-digit boundary so it doesn't match section
 *     numbers like "1.1 Get Opportunity by ID"
 */
const VERSION_PATTERNS: VersionPattern[] = [
  // "v1", "V1", "v2.3", "v3.0.1", "v3+json" → captures "1", "2.3", etc.
  // Anchored on a non-letter-digit boundary before the v.
  { regex: /(?<=^|[^a-zA-Z0-9])v(\d+(?:\.\d+){0,3})\b/gi },
  // "version 3", "Version 1.0"
  { regex: /\bversion\s+(\d+(?:\.\d+){0,3})\b/gi },
  // "release 12", "Release 12.4"
  { regex: /\brelease\s+(\d+(?:\.\d+){0,3})\b/gi },
];

export interface VersionInferenceResult {
  /** Canonical version string (e.g., "v3", "v1.0"). Null if no confident signal. */
  version: string | null;
  /** Top version's share of all extracted version mentions (0-1). 0 when null. */
  confidence: number;
  /** Per-version raw match counts; useful for explainability. */
  counts: Record<string, number>;
}

const DEFAULT_MIN_TOTAL_MATCHES = 2;
const DEFAULT_MIN_TOP_SHARE = 0.6;

export interface InferVersionOptions {
  /** Minimum total version matches required to return a non-null result. */
  minTotalMatches?: number;
  /** Top version must account for at least this share of total matches (0-1). */
  minTopShare?: number;
}

/**
 * Infer the artifact's vendor_version from one or more text sources.
 * Sources are concatenated and scanned for version patterns; the top
 * canonical match wins if it clears the threshold. Returns null when:
 *   - No version patterns match anywhere
 *   - Total matches across all candidates is below minTotalMatches
 *   - Top candidate's share is below minTopShare (ambiguous)
 */
export function inferVersion(
  texts: string[],
  options: InferVersionOptions = {},
): VersionInferenceResult {
  const minTotalMatches = options.minTotalMatches ?? DEFAULT_MIN_TOTAL_MATCHES;
  const minTopShare = options.minTopShare ?? DEFAULT_MIN_TOP_SHARE;

  const corpus = texts.filter((t) => typeof t === "string" && t.length > 0).join("\n\n");
  if (corpus.length === 0) {
    return { version: null, confidence: 0, counts: {} };
  }

  const counts: Record<string, number> = {};
  let total = 0;

  for (const { regex, canonicalize } of VERSION_PATTERNS) {
    for (const match of corpus.matchAll(regex)) {
      const captured = match[1];
      if (!captured) continue;
      const canon = canonicalize ? canonicalize(captured) : `v${captured}`;
      counts[canon] = (counts[canon] ?? 0) + 1;
      total++;
    }
  }

  if (total < minTotalMatches) {
    return { version: null, confidence: 0, counts };
  }

  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = ranked[0]!;
  const topShare = top[1] / total;

  // Strict-less-equal so exact ties (50/50) return null.
  if (topShare <= minTopShare) {
    return { version: null, confidence: topShare, counts };
  }

  return { version: top[0], confidence: topShare, counts };
}
