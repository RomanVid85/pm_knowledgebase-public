import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

vi.mock("@/lib/voyage/client", () => ({
  embedQuery: vi.fn(),
  embedDocuments: vi.fn(),
}));

import { embedQuery } from "@/lib/voyage/client";
import { searchKnowledge } from "./search";

const v = (fill: number) => Array.from({ length: 1024 }, () => fill);

type RpcRow = {
  chunk_id: string;
  content: string;
  section: string | null;
  artifact_id: string;
  artifact_title: string;
  similarity: number;
  authority: number;
  recency: number;
  confidence: number;
  score: number;
};

function makeSupabaseMock(rpcRows: RpcRow[] | null, rpcError: { message: string } | null = null) {
  const rpc = vi.fn((fnName: string, args: unknown) => {
    if (fnName !== "search_chunks") {
      throw new Error(`unexpected rpc: ${fnName}; args=${JSON.stringify(args)}`);
    }
    return Promise.resolve({ data: rpcRows, error: rpcError });
  });
  return {
    rpc,
    rpcSpy: rpc,
  };
}

beforeEach(() => {
  vi.mocked(embedQuery).mockReset();
});

describe("searchKnowledge", () => {
  it("returns empty for empty query without calling Voyage or RPC", async () => {
    const mock = makeSupabaseMock([]);
    const supabase = mock as unknown as SupabaseClient<Database>;
    const result = await searchKnowledge(supabase, "");
    expect(result).toEqual([]);
    expect(embedQuery).not.toHaveBeenCalled();
    expect(mock.rpcSpy).not.toHaveBeenCalled();
  });

  it("returns empty for whitespace-only query", async () => {
    const mock = makeSupabaseMock([]);
    const supabase = mock as unknown as SupabaseClient<Database>;
    const result = await searchKnowledge(supabase, "   \t\n");
    expect(result).toEqual([]);
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it("embeds the query and calls search_chunks with the vector literal", async () => {
    vi.mocked(embedQuery).mockResolvedValue(v(0.42));
    const mock = makeSupabaseMock([]);
    const supabase = mock as unknown as SupabaseClient<Database>;
    await searchKnowledge(supabase, "what rebates apply?");
    expect(embedQuery).toHaveBeenCalledWith("what rebates apply?");
    expect(mock.rpcSpy).toHaveBeenCalledWith(
      "search_chunks",
      expect.objectContaining({
        query_embedding: expect.stringMatching(/^\[0\.42(,0\.42){1023}\]$/),
        result_limit: 10,
      }),
    );
  });

  it("forwards anchorTopicId to the RPC call when provided", async () => {
    vi.mocked(embedQuery).mockResolvedValue(v(0.1));
    const mock = makeSupabaseMock([]);
    const supabase = mock as unknown as SupabaseClient<Database>;
    await searchKnowledge(supabase, "trade-ins", {
      anchorTopicId: "11111111-2222-3333-4444-555555555555",
    });
    expect(mock.rpcSpy).toHaveBeenCalledWith(
      "search_chunks",
      expect.objectContaining({
        anchor_topic_id: "11111111-2222-3333-4444-555555555555",
      }),
    );
  });

  it("omits anchor_topic_id key when anchorTopicId not provided", async () => {
    vi.mocked(embedQuery).mockResolvedValue(v(0.1));
    const mock = makeSupabaseMock([]);
    const supabase = mock as unknown as SupabaseClient<Database>;
    await searchKnowledge(supabase, "trade-ins");
    const call = mock.rpcSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(call.anchor_topic_id).toBeUndefined();
  });

  it("uses options.limit when provided", async () => {
    vi.mocked(embedQuery).mockResolvedValue(v(0.1));
    const mock = makeSupabaseMock([]);
    const supabase = mock as unknown as SupabaseClient<Database>;
    await searchKnowledge(supabase, "x", { limit: 25 });
    expect(mock.rpcSpy).toHaveBeenCalledWith(
      "search_chunks",
      expect.objectContaining({ result_limit: 25 }),
    );
  });

  it("maps rpc rows to SearchResult shape with numeric scores", async () => {
    vi.mocked(embedQuery).mockResolvedValue(v(0.1));
    const mock = makeSupabaseMock([
      {
        chunk_id: "c1",
        content: "rebates can be added via Programs tab",
        section: "Adding Incentives",
        artifact_id: "a1",
        artifact_title: "Acme Learning Center",
        similarity: 0.85,
        authority: 1.0,
        recency: 1.0,
        confidence: 1.0,
        score: 0.85,
      },
    ]);
    const supabase = mock as unknown as SupabaseClient<Database>;
    const result = await searchKnowledge(supabase, "how to add rebates");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      chunkId: "c1",
      content: "rebates can be added via Programs tab",
      section: "Adding Incentives",
      artifactId: "a1",
      artifactTitle: "Acme Learning Center",
      score: 0.85,
      components: { similarity: 0.85, authority: 1.0, recency: 1.0, confidence: 1.0 },
    });
  });

  it("propagates RPC errors", async () => {
    vi.mocked(embedQuery).mockResolvedValue(v(0.1));
    const mock = makeSupabaseMock(null, { message: "vector dim mismatch" });
    const supabase = mock as unknown as SupabaseClient<Database>;
    await expect(searchKnowledge(supabase, "q")).rejects.toThrow(/Retrieval failed.*vector dim/);
  });

  it("returns [] when RPC returns null data with no error", async () => {
    vi.mocked(embedQuery).mockResolvedValue(v(0.1));
    const mock = makeSupabaseMock(null);
    const supabase = mock as unknown as SupabaseClient<Database>;
    const result = await searchKnowledge(supabase, "q");
    expect(result).toEqual([]);
  });
});
