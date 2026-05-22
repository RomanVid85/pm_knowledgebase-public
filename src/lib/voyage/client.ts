// Voyage AI embeddings client.
//
// Uses native fetch against Voyage's REST API rather than the `voyageai` 0.0.3
// SDK because that SDK predates voyage-4-large's `output_dimension` parameter.
// We need 1024-dim Matryoshka-shortened vectors (matches our pgvector(1024)
// schema). See DECISIONS.md "Voyage client uses native fetch, not the SDK".

import { z } from "zod";
import { getServerEnv } from "@/lib/env";

const EMBED_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-4-large";
const OUTPUT_DIM = 1024;

const EmbedResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
      index: z.number(),
    }),
  ),
  usage: z
    .object({
      total_tokens: z.number(),
    })
    .optional(),
});

export type VoyageInputType = "document" | "query";

export class VoyageRetriableError extends Error {
  override readonly name = "VoyageRetriableError";
}

export class VoyageFatalError extends Error {
  override readonly name = "VoyageFatalError";
}

async function embed(inputs: string[], inputType: VoyageInputType): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const env = getServerEnv();
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: inputs,
      model: MODEL,
      input_type: inputType,
      output_dimension: OUTPUT_DIM,
    }),
  });

  // Inngest retries on RetriableError; fail-loudly on everything else.
  if (res.status === 429 || res.status >= 500) {
    throw new VoyageRetriableError(`Voyage ${res.status}: ${await safeReadText(res)}`);
  }
  if (!res.ok) {
    throw new VoyageFatalError(`Voyage ${res.status}: ${await safeReadText(res)}`);
  }

  const json = (await res.json()) as unknown;
  const parsed = EmbedResponseSchema.parse(json);

  // Defense in depth: every vector must match our pgvector(1024) schema.
  for (const item of parsed.data) {
    if (item.embedding.length !== OUTPUT_DIM) {
      throw new VoyageFatalError(
        `Voyage returned ${item.embedding.length}-dim embedding; expected ${OUTPUT_DIM}.`,
      );
    }
  }

  // Voyage's response items carry their own `index` — sort to guarantee we
  // return embeddings in the same order as the input array.
  return [...parsed.data]
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable response body>";
  }
}

/**
 * Embed an array of texts as documents (for indexing / storage).
 * Voyage applies a different prefix internally for `input_type='document'`
 * vs `'query'`. Use the document variant when storing chunks.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  return embed(texts, "document");
}

/**
 * Embed a single search query. Use this at retrieval time, not at indexing.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embed([text], "query");
  if (!embedding) {
    throw new VoyageFatalError("Voyage returned no embedding for query");
  }
  return embedding;
}
