import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type { Chunk } from "./chunker";

// Mock the Voyage client BEFORE importing the embedder.
vi.mock("@/lib/voyage/client", () => ({
  embedDocuments: vi.fn(),
  embedQuery: vi.fn(),
}));

import { embedDocuments } from "@/lib/voyage/client";
import { embedChunks } from "./embedder";

function makeChunk(content: string, hash: string, idx: number, section = "S"): Chunk {
  return { content, contentHash: hash, section, chunkIndex: idx, tokenCount: 10 };
}

function makeSupabaseMock(cached: Array<{ content_hash: string; embedding: number[] | string }>) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn(() => Promise.resolve({ data: cached, error: null })),
  };
  return {
    from: vi.fn().mockReturnValue(builder),
  } as unknown as SupabaseClient<Database>;
}

const v = (fill: number) => Array.from({ length: 1024 }, () => fill);

beforeEach(() => {
  vi.mocked(embedDocuments).mockReset();
});

describe("embedder", () => {
  it("returns empty for empty input without calling Voyage or DB", async () => {
    const mockDb = makeSupabaseMock([]);
    const { chunks, summary } = await embedChunks([], mockDb);
    expect(chunks).toEqual([]);
    expect(summary).toEqual({
      total: 0,
      cacheHits: 0,
      freshlyEmbedded: 0,
      uniqueHashesEmbedded: 0,
    });
    expect(embedDocuments).not.toHaveBeenCalled();
  });

  it("uses DB cache when all hashes are present — no Voyage call", async () => {
    const c1 = makeChunk("a", "hash1", 0);
    const c2 = makeChunk("b", "hash2", 1);
    const mockDb = makeSupabaseMock([
      { content_hash: "hash1", embedding: v(0.1) },
      { content_hash: "hash2", embedding: v(0.2) },
    ]);
    const { chunks, summary } = await embedChunks([c1, c2], mockDb);
    expect(embedDocuments).not.toHaveBeenCalled();
    expect(summary.cacheHits).toBe(2);
    expect(summary.freshlyEmbedded).toBe(0);
    expect(summary.uniqueHashesEmbedded).toBe(0);
    expect(chunks[0]?.cacheHit).toBe(true);
    expect(chunks[0]?.embedding[0]).toBe(0.1);
    expect(chunks[1]?.embedding[0]).toBe(0.2);
  });

  it("calls Voyage for uncached hashes only", async () => {
    const c1 = makeChunk("a", "hash1", 0);
    const c2 = makeChunk("b", "hash2", 1);
    const mockDb = makeSupabaseMock([{ content_hash: "hash1", embedding: v(0.1) }]);
    vi.mocked(embedDocuments).mockResolvedValue([v(0.2)]);
    const { chunks, summary } = await embedChunks([c1, c2], mockDb);
    expect(embedDocuments).toHaveBeenCalledTimes(1);
    expect(embedDocuments).toHaveBeenCalledWith(["b"]);
    expect(summary.cacheHits).toBe(1);
    expect(summary.freshlyEmbedded).toBe(1);
    expect(summary.uniqueHashesEmbedded).toBe(1);
    expect(chunks[0]?.cacheHit).toBe(true);
    expect(chunks[1]?.cacheHit).toBe(false);
  });

  it("dedups identical content within a single batch (one Voyage entry per hash)", async () => {
    // Same content appears twice in input.
    const c1 = makeChunk("dup", "samehash", 0);
    const c2 = makeChunk("dup", "samehash", 1);
    const mockDb = makeSupabaseMock([]);
    vi.mocked(embedDocuments).mockResolvedValue([v(0.5)]);
    const { chunks, summary } = await embedChunks([c1, c2], mockDb);
    expect(embedDocuments).toHaveBeenCalledTimes(1);
    expect(embedDocuments).toHaveBeenCalledWith(["dup"]);
    expect(summary.uniqueHashesEmbedded).toBe(1); // sent only once
    expect(summary.freshlyEmbedded).toBe(2); // both input chunks counted
    expect(chunks[0]?.embedding).toEqual(chunks[1]?.embedding);
  });

  it("parses pgvector returned as string", async () => {
    const c1 = makeChunk("a", "hash1", 0);
    const stringEmb = JSON.stringify(v(0.7));
    const mockDb = makeSupabaseMock([{ content_hash: "hash1", embedding: stringEmb }]);
    const { chunks } = await embedChunks([c1], mockDb);
    expect(chunks[0]?.cacheHit).toBe(true);
    expect(chunks[0]?.embedding[0]).toBe(0.7);
  });

  it("propagates Voyage errors", async () => {
    const c1 = makeChunk("a", "hash1", 0);
    const mockDb = makeSupabaseMock([]);
    vi.mocked(embedDocuments).mockRejectedValue(new Error("Voyage 500"));
    await expect(embedChunks([c1], mockDb)).rejects.toThrow("Voyage 500");
  });

  it("propagates DB cache errors", async () => {
    const c1 = makeChunk("a", "hash1", 0);
    const builder = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn(() =>
        Promise.resolve({ data: null, error: { message: "DB connection lost" } }),
      ),
    };
    const mockDb = {
      from: vi.fn().mockReturnValue(builder),
    } as unknown as SupabaseClient<Database>;
    await expect(embedChunks([c1], mockDb)).rejects.toThrow(/cache lookup failed/i);
  });
});
