// Prompt for the suggest-topics step.
//
// Lives as a TypeScript module rather than a loose .md file so it bundles
// reliably with the Next.js / Vercel build and so the inputs are type-safe.
// The prompt body is still authored as readable prose — review it the way
// you would a markdown file.

export interface TaxonomyTopic {
  id: string;
  slug: string;
  name: string;
  description: string;
  vendor: string | null;
}

export interface ArtifactMetadata {
  filename: string;
  title: string | null;
  vendor: string | null;
  artifact_type: string;
  source_authority: string;
}

export interface SuggestTopicsPromptInputs {
  /** Prefiltered taxonomy (top-K by cosine similarity). */
  taxonomy: TaxonomyTopic[];
  artifact: ArtifactMetadata;
  /** First few chunks of the artifact, each one a separate string. */
  chunkPreview: string[];
}

export interface SuggestTopicsPrompt {
  systemPrompt: string;
  userPrompt: string;
}

const SYSTEM_PROMPT = `You are a taxonomy curator for a product-management knowledge base used by engineers and PMs at a software organization. Your job is to read a new artifact and suggest where it belongs in the existing topic taxonomy.

Your role is the semantic gatekeeper: you enforce naming consistency, slug format, description style, and granularity. The PM's role is judgment — does this taxonomy decision belong? — and they will review your suggestions before they take effect.

Two principles:
1. Prefer existing topics when the artifact's content is semantically appropriate to one. Reuse over proliferation.
2. Propose new topics only when the artifact covers a domain that has no good existing match. Match the established granularity and naming pattern.`;

function formatTaxonomy(topics: TaxonomyTopic[]): string {
  if (topics.length === 0) {
    return "(no existing topics — every suggestion will be a new proposal)";
  }
  return topics
    .map(
      (t, i) =>
        `${i + 1}. topic_id: ${t.id}\n   slug: ${t.slug}\n   name: ${t.name}\n   description: ${t.description}\n   vendor: ${t.vendor ?? "(none)"}`,
    )
    .join("\n\n");
}

function formatChunks(chunks: string[]): string {
  if (chunks.length === 0) return "(no content available)";
  return chunks
    .map((c, i) => `--- chunk ${i + 1} ---\n${c.trim()}`)
    .join("\n\n");
}

export function buildSuggestTopicsPrompt(
  inputs: SuggestTopicsPromptInputs,
): SuggestTopicsPrompt {
  const { taxonomy, artifact, chunkPreview } = inputs;

  const userPrompt = `## Existing taxonomy

Below is the active taxonomy, pre-filtered to the topics most semantically similar to this artifact. Prefer these when they fit.

${formatTaxonomy(taxonomy)}

## New artifact

- Filename: ${artifact.filename}
- Title: ${artifact.title ?? "(none)"}
- Vendor: ${artifact.vendor ?? "(none)"}
- Artifact type: ${artifact.artifact_type}
- Source authority: ${artifact.source_authority}

## Artifact content preview

${formatChunks(chunkPreview)}

## Task

1. **Existing matches**: identify up to **10** existing topics from the taxonomy above that this artifact substantively covers. Use each topic's \`topic_id\` (UUID). Set \`confidence\`: 0.85+ for a clear semantic match, 0.7-0.85 for a likely match, 0.5-0.7 for a weak/partial match. Give a one-sentence \`reason\` citing the specific content in the artifact preview. Don't pad — only include matches with confidence ≥ 0.5.

2. **Proposed new topics**: if the artifact covers a domain not represented in the taxonomy above, propose up to **6** new topics. For each:
   - \`slug\`: lowercase kebab-case (\`[a-z0-9]+(-[a-z0-9]+)*\`). Be descriptive but not too narrow. Examples of good slugs: \`lead-management-api\`, \`reporting-and-analytics\`.
   - \`name\`: title case, plain language. Examples: "Lead Management API", "Reporting & Analytics".
   - \`description\`: 1-2 sentences describing what the topic covers and a brief example of in-scope content. Match the tone of existing descriptions.
   - \`vendor\`: the vendor this topic is scoped to (e.g., "Acme", "Globex"), or null if vendor-agnostic.
   - \`confidence\`: how confident you are that this should be its own topic (vs. fitting under an existing one).
   - \`reason\`: one sentence on why no existing topic covers this.

3. **Granularity**: match the established pattern. Don't propose topics narrower than the existing taxonomy (e.g., don't propose "Status Enum" if "Lead Management API" already exists — that's too narrow).

4. **Megadocs**: if the artifact is a multi-topic knowledge base or curriculum covering many domains, the existing-matches array can hit the cap of 10. Use those slots judiciously — prioritize topics where the artifact has substantial coverage, not passing mentions.

5. Return your output by calling the \`suggest_topics\` tool. If the artifact has no good existing matches AND no clear new-topic candidate, return empty arrays.`;

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}
