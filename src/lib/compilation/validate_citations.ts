// Citation validation for compiled topic pages.
//
// The LLM is instructed to cite only the artifacts/chunks/rules it was given,
// but hallucinated IDs do happen. This pass walks every section's citations
// and drops any that don't resolve against the input set:
//   - artifact_id must be in inputs.artifacts
//   - if chunk_id is set, it must belong to that artifact in inputs.chunks
//   - if rule_id is set, it must be in inputs.rules
//
// Validating against the input set (not the live DB) is the right move:
// inputs.ts already filtered to active + verified rows, so an ID that's
// in the inputs at compile time IS valid. An ID outside the inputs is a
// hallucination.
//
// Invalid citations are removed; the page is still saved. Warnings are
// logged on the topic_pages row so the topic owner sees them at review time.

import type {
  ArtifactForCompilation,
  ChunkForCompilation,
  CompilationInputs,
  RuleForCompilation,
} from "@/lib/compilation/inputs";
import {
  SECTION_KEYS,
  type Citation,
  type CompiledPage,
  type CompiledSection,
  type SectionKey,
} from "@/lib/compilation/schema";

export interface CitationWarning {
  section: SectionKey;
  citation: Citation;
  reason:
    | "unknown_artifact"
    | "unknown_chunk"
    | "unknown_rule"
    | "chunk_artifact_mismatch";
}

export interface ValidationResult {
  page: CompiledPage;
  warnings: CitationWarning[];
}

interface InputIndex {
  artifactIds: Set<string>;
  chunkById: Map<string, ChunkForCompilation>;
  ruleIds: Set<string>;
}

function buildIndex(inputs: {
  artifacts: ArtifactForCompilation[];
  chunks: ChunkForCompilation[];
  rules: RuleForCompilation[];
}): InputIndex {
  return {
    artifactIds: new Set(inputs.artifacts.map((a) => a.id)),
    chunkById: new Map(inputs.chunks.map((c) => [c.chunk_id, c])),
    ruleIds: new Set(inputs.rules.map((r) => r.id)),
  };
}

function classifyCitation(
  citation: Citation,
  index: InputIndex,
): CitationWarning["reason"] | null {
  if (!index.artifactIds.has(citation.artifact_id)) return "unknown_artifact";
  if (citation.chunk_id !== undefined) {
    const chunk = index.chunkById.get(citation.chunk_id);
    if (chunk === undefined) return "unknown_chunk";
    if (chunk.artifact_id !== citation.artifact_id) return "chunk_artifact_mismatch";
  }
  if (citation.rule_id !== undefined && !index.ruleIds.has(citation.rule_id)) {
    return "unknown_rule";
  }
  return null;
}

function validateSection(
  section: CompiledSection,
  sectionKey: SectionKey,
  index: InputIndex,
  warnings: CitationWarning[],
): CompiledSection {
  const validCitations: Citation[] = [];
  for (const citation of section.citations) {
    const reason = classifyCitation(citation, index);
    if (reason === null) {
      validCitations.push(citation);
    } else {
      warnings.push({ section: sectionKey, citation, reason });
    }
  }
  return { text: section.text, citations: validCitations };
}

export function validateCitations(
  page: CompiledPage,
  inputs: Pick<CompilationInputs, "artifacts" | "chunks" | "rules">,
): ValidationResult {
  const index = buildIndex(inputs);
  const warnings: CitationWarning[] = [];

  const validatedSections = Object.fromEntries(
    SECTION_KEYS.map((key) => [
      key,
      validateSection(page.sections[key], key, index, warnings),
    ]),
  ) as CompiledPage["sections"];

  return {
    page: { summary: page.summary, sections: validatedSections },
    warnings,
  };
}
