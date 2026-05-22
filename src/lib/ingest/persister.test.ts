import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import {
  persistArtifactAndChunks,
  persistChunks,
  markArtifactActive,
  finalizeIngestion,
  type ArtifactInput,
  type ArtifactTopicInput,
} from "./persister";
import type { EmbeddedChunk } from "./embedder";

type InsertCall = {
  table: string;
  rows: unknown;
  method: "insert" | "upsert";
  upsertOptions?: unknown;
};

function makeSupabaseMock(opts: {
  artifactId?: string;
  chunkIds?: string[];
  artifactInsertError?: { message: string };
  topicsInsertError?: { message: string };
  chunksInsertError?: { message: string };
  updateError?: { message: string };
}) {
  const insertCalls: InsertCall[] = [];
  const updateCalls: Array<{ table: string; values: unknown; eq: [string, unknown] | null }> = [];

  function handleInsertOrUpsert(table: string, rows: unknown, method: "insert" | "upsert") {
    if (table === "artifacts") {
      if (opts.artifactInsertError) {
        return {
          select: () => ({
            single: () => Promise.resolve({ data: null, error: opts.artifactInsertError }),
          }),
        };
      }
      return {
        select: () => ({
          single: () =>
            Promise.resolve({ data: { id: opts.artifactId ?? "art-1" }, error: null }),
        }),
      };
    }
    if (table === "artifact_topics") {
      return Promise.resolve({ data: null, error: opts.topicsInsertError ?? null });
    }
    if (table === "chunks") {
      if (opts.chunksInsertError) {
        return {
          select: () => Promise.resolve({ data: null, error: opts.chunksInsertError }),
        };
      }
      const ids = (opts.chunkIds ?? []).map((id) => ({ id }));
      return { select: () => Promise.resolve({ data: ids, error: null }) };
    }
    void method;
    return Promise.resolve({ data: null, error: null });
  }

  const mock = {
    from: vi.fn((table: string) => ({
      insert: vi.fn((rows: unknown) => {
        insertCalls.push({ table, rows, method: "insert" });
        return handleInsertOrUpsert(table, rows, "insert");
      }),
      upsert: vi.fn((rows: unknown, upsertOptions?: unknown) => {
        insertCalls.push({ table, rows, method: "upsert", upsertOptions });
        return handleInsertOrUpsert(table, rows, "upsert");
      }),
      update: vi.fn((values: unknown) => {
        updateCalls.push({ table, values, eq: null });
        return {
          eq: vi.fn((col: string, val: unknown) => {
            const last = updateCalls[updateCalls.length - 1];
            if (last) last.eq = [col, val];
            return Promise.resolve({ data: null, error: opts.updateError ?? null });
          }),
        };
      }),
    })),
  } as unknown as SupabaseClient<Database>;

  return { supabase: mock, insertCalls, updateCalls };
}

const baseArtifact: ArtifactInput = {
  title: "Test Doc",
  artifactType: "training_guide",
  sourceAuthority: "vendor_canonical",
  vendor: "Acme",
  uploadedBy: "user-roman",
};

const baseTopic: ArtifactTopicInput = {
  topicId: "topic-deal-central-manager",
  relevanceScore: 0.9,
};

const baseChunk = (idx: number): EmbeddedChunk => ({
  content: `chunk ${idx}`,
  contentHash: `hash-${idx}`,
  section: "Intro",
  chunkIndex: idx,
  tokenCount: 10,
  embedding: Array.from({ length: 1024 }, () => 0.1),
  cacheHit: false,
});

describe("persistArtifactAndChunks", () => {
  it("INSERTs artifact with status='draft'", async () => {
    const { supabase, insertCalls } = makeSupabaseMock({});
    await persistArtifactAndChunks(supabase, {
      artifact: baseArtifact,
      artifactTopics: [],
      chunks: [],
    });
    const artifactCall = insertCalls.find((c) => c.table === "artifacts");
    expect(artifactCall).toBeDefined();
    expect(artifactCall?.rows).toMatchObject({
      title: "Test Doc",
      artifact_type: "training_guide",
      source_authority: "vendor_canonical",
      uploaded_by: "user-roman",
      status: "draft",
    });
  });

  it("INSERTs artifact_topics with relevance_score and topic_id", async () => {
    const { supabase, insertCalls } = makeSupabaseMock({ artifactId: "art-42" });
    await persistArtifactAndChunks(supabase, {
      artifact: baseArtifact,
      artifactTopics: [baseTopic, { topicId: "topic-bdc-appointments" }],
      chunks: [],
    });
    const topicCall = insertCalls.find((c) => c.table === "artifact_topics");
    expect(topicCall).toBeDefined();
    const rows = topicCall?.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      artifact_id: "art-42",
      topic_id: "topic-deal-central-manager",
      relevance_score: 0.9,
    });
    expect(rows[1]).toMatchObject({
      artifact_id: "art-42",
      topic_id: "topic-bdc-appointments",
      relevance_score: 1.0, // default
    });
  });

  it("INSERTs chunks with vector serialized as Postgres array literal", async () => {
    const { supabase, insertCalls } = makeSupabaseMock({
      artifactId: "art-1",
      chunkIds: ["c1", "c2"],
    });
    const result = await persistArtifactAndChunks(supabase, {
      artifact: baseArtifact,
      artifactTopics: [],
      chunks: [baseChunk(0), baseChunk(1)],
    });
    const chunkCall = insertCalls.find((c) => c.table === "chunks");
    const rows = chunkCall?.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      artifact_id: "art-1",
      chunk_index: 0,
      content_hash: "hash-0",
      section: "Intro",
      token_count: 10,
    });
    // Embedding stringified as "[0.1,0.1,...]".
    expect(rows[0]?.embedding).toMatch(/^\[0\.1(,0\.1){1023}\]$/);
    expect(result.chunkIds).toEqual(["c1", "c2"]);
  });

  it("returns the new artifact id", async () => {
    const { supabase } = makeSupabaseMock({ artifactId: "art-xyz" });
    const result = await persistArtifactAndChunks(supabase, {
      artifact: baseArtifact,
      artifactTopics: [],
      chunks: [],
    });
    expect(result.artifactId).toBe("art-xyz");
  });

  it("skips artifact_topics insert when empty", async () => {
    const { supabase, insertCalls } = makeSupabaseMock({});
    await persistArtifactAndChunks(supabase, {
      artifact: baseArtifact,
      artifactTopics: [],
      chunks: [],
    });
    expect(insertCalls.find((c) => c.table === "artifact_topics")).toBeUndefined();
  });

  it("skips chunks insert when empty", async () => {
    const { supabase, insertCalls } = makeSupabaseMock({});
    const result = await persistArtifactAndChunks(supabase, {
      artifact: baseArtifact,
      artifactTopics: [],
      chunks: [],
    });
    expect(insertCalls.find((c) => c.table === "chunks")).toBeUndefined();
    expect(result.chunkIds).toEqual([]);
  });

  it("propagates artifact insert errors", async () => {
    const { supabase } = makeSupabaseMock({
      artifactInsertError: { message: "FK violation" },
    });
    await expect(
      persistArtifactAndChunks(supabase, {
        artifact: baseArtifact,
        artifactTopics: [],
        chunks: [],
      }),
    ).rejects.toThrow(/artifact insert failed.*FK violation/);
  });

  it("propagates chunks insert errors", async () => {
    const { supabase } = makeSupabaseMock({
      artifactId: "art-1",
      chunksInsertError: { message: "vector dim mismatch" },
    });
    await expect(
      persistArtifactAndChunks(supabase, {
        artifact: baseArtifact,
        artifactTopics: [],
        chunks: [baseChunk(0)],
      }),
    ).rejects.toThrow(/chunks insert failed.*vector dim mismatch/);
  });
});

describe("persistChunks (Inngest step — idempotent)", () => {
  it("upserts chunks with onConflict on (artifact_id, chunk_index) and ignoreDuplicates", async () => {
    const { supabase, insertCalls } = makeSupabaseMock({
      artifactId: "art-1",
      chunkIds: ["c1", "c2"],
    });
    await persistChunks(supabase, "art-existing", [baseChunk(0), baseChunk(1)]);
    const chunkCall = insertCalls.find((c) => c.table === "chunks");
    expect(chunkCall?.method).toBe("upsert");
    expect(chunkCall?.upsertOptions).toMatchObject({
      onConflict: "artifact_id,chunk_index",
      ignoreDuplicates: true,
    });
  });

  it("returns chunk ids from inserted rows", async () => {
    const { supabase } = makeSupabaseMock({ chunkIds: ["c1", "c2"] });
    const result = await persistChunks(supabase, "art-x", [baseChunk(0), baseChunk(1)]);
    expect(result.chunkIds).toEqual(["c1", "c2"]);
  });

  it("returns empty for empty input without calling supabase", async () => {
    const { supabase, insertCalls } = makeSupabaseMock({});
    const result = await persistChunks(supabase, "art-x", []);
    expect(result.chunkIds).toEqual([]);
    expect(insertCalls).toEqual([]);
  });

  it("propagates upsert errors", async () => {
    const { supabase } = makeSupabaseMock({
      chunksInsertError: { message: "vector dim mismatch" },
    });
    await expect(persistChunks(supabase, "art-x", [baseChunk(0)])).rejects.toThrow(
      /chunks upsert failed.*vector dim mismatch/,
    );
  });
});

describe("markArtifactActive", () => {
  it("UPDATEs artifacts SET status='active' WHERE id=...", async () => {
    const { supabase, updateCalls } = makeSupabaseMock({});
    await markArtifactActive(supabase, "art-99");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.table).toBe("artifacts");
    expect(updateCalls[0]?.values).toEqual({ status: "active" });
    expect(updateCalls[0]?.eq).toEqual(["id", "art-99"]);
  });

  it("propagates update errors", async () => {
    const { supabase } = makeSupabaseMock({ updateError: { message: "row locked" } });
    await expect(markArtifactActive(supabase, "art-99")).rejects.toThrow(
      /Failed to activate artifact art-99.*row locked/,
    );
  });
});

describe("finalizeIngestion", () => {
  /**
   * Builds a Supabase mock that supports both:
   *   - SELECT topic_suggestions FROM artifacts WHERE id = X (read)
   *   - UPDATE artifacts SET status='active' WHERE id = X (write)
   */
  function makeFinalizeMock(opts: {
    topicSuggestions: unknown;
    readError?: { message: string };
    updateError?: { message: string };
  }) {
    const updateCalls: Array<{ table: string; values: unknown; eq: [string, unknown] | null }> =
      [];
    const mock = {
      from: vi.fn((table: string) => ({
        select: vi.fn((_cols: string) => {
          void _cols;
          return {
            eq: vi.fn((_col: string, _val: unknown) => {
              void _col;
              void _val;
              return {
                single: () =>
                  Promise.resolve(
                    opts.readError
                      ? { data: null, error: opts.readError }
                      : { data: { topic_suggestions: opts.topicSuggestions }, error: null },
                  ),
              };
            }),
          };
        }),
        update: vi.fn((values: unknown) => {
          updateCalls.push({ table, values, eq: null });
          return {
            eq: vi.fn((col: string, val: unknown) => {
              const last = updateCalls[updateCalls.length - 1];
              if (last) last.eq = [col, val];
              return Promise.resolve({ data: null, error: opts.updateError ?? null });
            }),
          };
        }),
      })),
    };
    return { supabase: mock as unknown as SupabaseClient<Database>, updateCalls };
  }

  it("activates the artifact when topic_suggestions IS NULL (no review needed)", async () => {
    const { supabase, updateCalls } = makeFinalizeMock({ topicSuggestions: null });
    const result = await finalizeIngestion(supabase, "art-1");
    expect(result).toEqual({ activated: true, reason: "no-suggestions" });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.table).toBe("artifacts");
    expect(updateCalls[0]?.values).toEqual({ status: "active" });
    expect(updateCalls[0]?.eq).toEqual(["id", "art-1"]);
  });

  it("leaves the artifact in 'draft' when topic_suggestions is populated", async () => {
    const { supabase, updateCalls } = makeFinalizeMock({
      topicSuggestions: { existing: [], proposed_new: [] },
    });
    const result = await finalizeIngestion(supabase, "art-2");
    expect(result).toEqual({ activated: false, reason: "review-pending" });
    expect(updateCalls).toEqual([]);
  });

  it("throws when the artifact row cannot be read", async () => {
    const { supabase } = makeFinalizeMock({
      topicSuggestions: null,
      readError: { message: "rls denied" },
    });
    await expect(finalizeIngestion(supabase, "missing")).rejects.toThrow(
      /finalizeIngestion.*missing.*rls denied/,
    );
  });
});
