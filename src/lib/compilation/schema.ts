// Compiled topic-page schema. Section structure follows
// agent_docs/architecture.md (Layer 3) and specs/phase_5_topic_page_compilation.md.
//
// Each of the 7 sections is `{text, citations}` — text is markdown prose,
// citations are first-class objects so the UI can render them as clickable
// drill-down links rather than parsing inline markdown footnotes.

import { z } from "zod";

export const CitationSchema = z
  .object({
    artifact_id: z.string().uuid(),
    chunk_id: z.string().uuid().optional(),
    rule_id: z.string().uuid().optional(),
    quote: z.string().min(1),
  })
  .refine((c) => !(c.chunk_id && c.rule_id), {
    message: "citation cannot reference both chunk_id and rule_id",
  });

export const SectionSchema = z.object({
  // Empty string is valid — used when a section has no evidence in the corpus.
  text: z.string(),
  citations: z.array(CitationSchema),
});

export const SECTION_KEYS = [
  "current_view",
  "why_we_believe_it",
  "what_changed_recently",
  "open_questions",
  "contradictions",
  "recommended_next_actions",
  "source_artifacts",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export const CompiledPageSectionsSchema = z.object({
  current_view: SectionSchema,
  why_we_believe_it: SectionSchema,
  what_changed_recently: SectionSchema,
  open_questions: SectionSchema,
  contradictions: SectionSchema,
  recommended_next_actions: SectionSchema,
  source_artifacts: SectionSchema,
});

export const CompiledPageSchema = z.object({
  // Cap is generous so we don't fail validation on Opus's natural verbosity.
  // Phase 5 originally specced 500 chars; bumped to 1000 after first M1
  // compile hit the limit. PM-facing summaries land 200-800 chars typically.
  summary: z.string().min(1).max(1000),
  sections: CompiledPageSectionsSchema,
});

export type Citation = z.infer<typeof CitationSchema>;
export type CompiledSection = z.infer<typeof SectionSchema>;
export type CompiledPageSections = z.infer<typeof CompiledPageSectionsSchema>;
export type CompiledPage = z.infer<typeof CompiledPageSchema>;
