// Section-aware chunker for the ingestion pipeline.
//
// Token estimator: word-count × 1.3 (per spec Q2 resolution; see DECISIONS.md
// 2026-05-08 "Token estimator: word-count × 1.3"). Voyage's per-text limit is
// ~60× our chunk target, so ±20% variance from the true tokenizer is harmless.

import { createHash } from "node:crypto";
import type { ParsedDocument } from "@/lib/ingest/parser";

export type Chunk = {
  content: string;
  contentHash: string; // sha256 of content (powers the embed cache)
  section: string;
  chunkIndex: number; // 0-based across the artifact
  tokenCount: number;
};

export type ChunkOptions = {
  targetTokens?: number;
  overlapTokens?: number;
};

const DEFAULTS = {
  targetTokens: 500,
  overlapTokens: 50,
} as const;

// A section that fits in this many tokens is kept as a single chunk
// instead of split — preserves coherent topical units when possible.
const SECTION_FIT_RATIO = 1.5;

export function chunk(parsed: ParsedDocument, opts: ChunkOptions = {}): Chunk[] {
  const targetTokens = opts.targetTokens ?? DEFAULTS.targetTokens;
  const overlapTokens = opts.overlapTokens ?? DEFAULTS.overlapTokens;

  const accum: Array<Omit<Chunk, "chunkIndex">> = [];

  for (const section of parsed.sections) {
    const content = section.content.trim();
    if (content.length === 0) continue;
    accum.push(...chunkSection(content, section.heading, targetTokens, overlapTokens));
  }

  return accum.map((c, i) => ({ ...c, chunkIndex: i }));
}

function chunkSection(
  content: string,
  heading: string,
  target: number,
  overlap: number,
): Array<Omit<Chunk, "chunkIndex">> {
  const sectionTokens = estimateTokens(content);

  // If the whole section fits, keep it whole — preserves topical coherence.
  if (sectionTokens <= target * SECTION_FIT_RATIO) {
    return [makeChunk(content, heading)];
  }

  // Otherwise, split at paragraph boundaries with overlap.
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: Array<Omit<Chunk, "chunkIndex">> = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    // If a single paragraph exceeds the target, emit it whole — splitting
    // mid-paragraph degrades retrieval more than oversized chunks for V1.
    if (paraTokens > target && current.length === 0) {
      chunks.push(makeChunk(para, heading));
      continue;
    }

    if (currentTokens + paraTokens > target && current.length > 0) {
      chunks.push(makeChunk(current.join("\n\n"), heading));

      // Carry over the tail (up to `overlap` tokens) into the next chunk.
      const tail: string[] = [];
      let tailTokens = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const t = estimateTokens(current[i] ?? "");
        if (tailTokens + t > overlap && tail.length > 0) break;
        tail.unshift(current[i] ?? "");
        tailTokens += t;
      }
      current = [...tail, para];
      currentTokens = estimateTokens(current.join("\n\n"));
    } else {
      current.push(para);
      currentTokens += paraTokens;
    }
  }

  if (current.length > 0) {
    chunks.push(makeChunk(current.join("\n\n"), heading));
  }

  return chunks;
}

function makeChunk(content: string, section: string): Omit<Chunk, "chunkIndex"> {
  return {
    content,
    contentHash: sha256(content),
    section,
    tokenCount: estimateTokens(content),
  };
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
