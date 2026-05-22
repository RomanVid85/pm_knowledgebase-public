// Prompt for compiling a topic page.
//
// Produces the 7-section structure described in agent_docs/architecture.md
// (Layer 3) using the topic's active verified rules + top-ranked chunks +
// active artifacts. Output is consumed by CompiledPageSchema in
// src/lib/compilation/schema.ts.
//
// Citation discipline is the load-bearing part of this prompt: every factual
// claim must reference an artifact_id, optionally with a chunk_id or rule_id,
// and a verbatim quote from that source. validate_citations.ts drops any
// citation that doesn't resolve to a live record.

import type {
  ArtifactForCompilation,
  ChunkForCompilation,
  RuleForCompilation,
  TopicForCompilation,
} from "@/lib/compilation/inputs";

export interface CompileTopicPagePromptInputs {
  topic: TopicForCompilation;
  rules: RuleForCompilation[];
  chunks: ChunkForCompilation[];
  artifacts: ArtifactForCompilation[];
}

export interface CompileTopicPagePrompt {
  systemPrompt: string;
  userPrompt: string;
}

const SYSTEM_PROMPT = `You are compiling a working-view "what do we currently know" page for a single topic in a product-management knowledge base.

You read the topic's verified business rules, top-ranked content chunks, and the set of source artifacts, and synthesize a 7-section page that PMs and engineers will use as their primary answer when they ask about this topic.

You are NOT the source of truth. The artifacts are. Your job is to faithfully synthesize what those artifacts say — every factual claim must be backed by a citation to a specific artifact, with a verbatim quote.

CITATION RULES (load-bearing — do not break these):
- Every factual claim in any section MUST be cited. Citations are objects with artifact_id (required), optionally chunk_id OR rule_id (never both), and a quote field.
- If you cannot find an artifact_id / chunk_id / rule_id for a claim in the inputs below, don't make the claim. Empty section text is fine.
- When you cite a rule, set rule_id (not chunk_id). When you cite raw chunk text, set chunk_id. When you cite at the artifact level without a specific chunk, omit both chunk_id and rule_id.
- The "quote" must be a VERBATIM substring of the source's text — the chunk's content, the rule's source_quote, or (in the source_artifacts section ONLY) the artifact's title from its input header. If a chunk says "Required: contact, leadSource", a valid quote is "Required: contact, leadSource". An invalid quote is your paraphrase of that.
- chunk_id ↔ artifact_id BINDING: each chunk in the inputs is tagged with BOTH [chunk_id=...] AND [artifact_id=...] in its header. When you cite chunk X, the artifact_id MUST be the one in chunk X's header — never copy-paste an artifact_id from a different chunk. Same for rule_id → its [artifact_id=...] in the rule header.

VOICE:
- Concise. PM-facing but technically precise. No marketing tone.
- Prefer specifics over generalities. "POST /leads requires contact and leadSource" beats "the API requires certain fields."
- Don't invent rules, deadlines, version histories, or stakeholders that the inputs don't support.

READABILITY (the page is scanned more than read):
- Lead with the answer. The first sentence of each section should state the conclusion plainly; evidence follows.
- Short paragraphs (2-4 sentences max). Long walls of prose lose readers.
- Use bulleted lists for: required fields, allowed values, constraints, open questions, recommended actions, source artifacts. Bullets beat run-on sentences for scanning.
- Plain language. Avoid the dense technical-paper voice. Imagine a PM skimming on a phone between meetings — would they get the point in 10 seconds?
- One claim per sentence in current_view. If two claims are related, two sentences or a bulleted sub-list.

CONFLICTS:
- If two sources disagree, surface the conflict in the contradictions section. Don't smooth it over by picking one.

EMPTY SECTIONS:
- If a section has no available evidence, return text="" and citations=[]. Do not invent content to fill space.`;

function formatTopic(topic: TopicForCompilation): string {
  return [
    `- id: ${topic.id}`,
    `- slug: ${topic.slug}`,
    `- name: ${topic.name}`,
    `- description: ${topic.description ?? "(none)"}`,
  ].join("\n");
}

function formatRules(rules: RuleForCompilation[]): string {
  if (rules.length === 0) return "(no verified rules for this topic yet)";
  return rules
    .map((r) =>
      [
        `--- rule [rule_id=${r.id}] [artifact_id=${r.source_artifact_id ?? "unknown"}] ---`,
        `rule_key: ${r.rule_key}`,
        `rule_type: ${r.rule_type}`,
        `confidence: ${r.confidence}`,
        `value: ${JSON.stringify(r.value)}`,
        r.conditions !== null && r.conditions !== undefined
          ? `conditions: ${JSON.stringify(r.conditions)}`
          : null,
        r.source_quote ? `source_quote: ${r.source_quote}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    )
    .join("\n\n");
}

function formatChunks(chunks: ChunkForCompilation[]): string {
  if (chunks.length === 0) return "(no chunks available for this topic)";
  return chunks
    .map((c) =>
      [
        `--- chunk [chunk_id=${c.chunk_id}] [artifact_id=${c.artifact_id}] ---`,
        `artifact: ${c.artifact_title}`,
        c.section ? `section: ${c.section}` : null,
        `score: ${c.score.toFixed(3)}`,
        ``,
        c.content.trim(),
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    )
    .join("\n\n");
}

function formatArtifacts(artifacts: ArtifactForCompilation[]): string {
  if (artifacts.length === 0) return "(no artifacts tagged with this topic)";
  return artifacts
    .map((a) =>
      [
        `- [artifact_id=${a.id}] ${a.title}`,
        `  vendor=${a.vendor ?? "(none)"} version=${a.vendor_version ?? "(none)"}`,
        `  type=${a.artifact_type} authority=${a.source_authority}`,
        `  effective_date=${a.effective_date ?? "(unknown)"}`,
      ].join("\n"),
    )
    .join("\n");
}

export function buildCompileTopicPagePrompt(
  inputs: CompileTopicPagePromptInputs,
): CompileTopicPagePrompt {
  const { topic, rules, chunks, artifacts } = inputs;

  const userPrompt = `## Topic

${formatTopic(topic)}

## Active verified rules (${rules.length})

These have passed two-person verification. Cite them with rule_id when relevant.

${formatRules(rules)}

## Top chunks (${chunks.length})

Authority-, recency-, and similarity-weighted chunks from artifacts tagged with this topic. Cite them with chunk_id when you draw from a specific chunk.

${formatChunks(chunks)}

## Source artifacts (${artifacts.length})

Every active artifact tagged with this topic. The source_artifacts section should reference each of these by artifact_id.

${formatArtifacts(artifacts)}

## Task

Produce a compiled topic page by calling the \`compile_topic_page\` tool. The output has a top-level \`summary\` (≤1000 chars, plain prose, no markdown) and \`sections\` with all seven of the keys below:

1. **current_view** — what the team currently understands about this topic. The primary answer a PM lands on. 2-6 paragraphs of markdown prose, cited.
2. **why_we_believe_it** — the evidentiary basis. Which artifacts establish each major claim in current_view. Cite heavily.
3. **what_changed_recently** — anything from artifacts with effective_date within the last ~90 days (or, if no dates are known, recently superseded artifacts). Empty section is fine if nothing recent.
4. **open_questions** — gaps, ambiguities, low-confidence rules, missing coverage areas the LLM identifies from the inputs. Bullet list of questions.
5. **contradictions** — explicit disagreements between sources you can identify in the chunks/rules. Empty if none surfaced.
6. **recommended_next_actions** — what the topic owner should do based on gaps/freshness. Bullet list. Examples: "verify rule X (confidence 0.65)", "request vendor doc on Y", "reconcile contradiction Z".
7. **source_artifacts** — list every artifact with id, title, vendor, version, authority. Each artifact gets a citation entry: artifact_id required; quote is either a representative verbatim chunk excerpt from one of that artifact's chunks if available, OR the artifact's title (the carve-out in CITATION RULES allows artifact-title quotes in this section). chunk_id is optional.

For each section, return \`text\` (markdown string, possibly empty) and \`citations\` (array of {artifact_id, chunk_id?|rule_id?, quote}). Don't return citations for claims that aren't in the section's text.`;

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}
