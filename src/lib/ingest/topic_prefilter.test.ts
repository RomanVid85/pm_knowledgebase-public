import { describe, it, expect, vi } from "vitest";
import { cosineSimilarity, parseEmbedding, prefilterTopics } from "./topic_prefilter";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("is direction-only (ignores magnitude)", () => {
    expect(cosineSimilarity([2, 0], [10, 0])).toBeCloseTo(1);
  });

  it("returns 0 when either vector is zero-magnitude (no NaN)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1, 1], [0, 0, 0])).toBe(0);
  });

  it("throws when lengths mismatch", () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow(/length mismatch/);
  });
});

describe("parseEmbedding", () => {
  it("returns null for null/undefined", () => {
    expect(parseEmbedding(null)).toBeNull();
    expect(parseEmbedding(undefined)).toBeNull();
  });

  it("returns numeric array unchanged when given an array", () => {
    expect(parseEmbedding([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("parses pgvector string form '[a,b,c]'", () => {
    expect(parseEmbedding("[0.1, 0.2, 0.3]")).toEqual([0.1, 0.2, 0.3]);
  });

  it("returns null for unparseable strings", () => {
    expect(parseEmbedding("not a vector")).toBeNull();
    expect(parseEmbedding("0.1, 0.2, 0.3")).toBeNull();
  });

  it("coerces stringified numbers in an array", () => {
    expect(parseEmbedding(["0.1", "0.2"])).toEqual([0.1, 0.2]);
  });
});

type TopicRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  vendor: string | null;
  description_embedding: number[] | null;
};

function makeSupabaseStub(rows: TopicRow[], configValue?: number) {
  const stub = {
    from(table: string) {
      if (table === "system_config") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () =>
                    Promise.resolve(
                      configValue !== undefined
                        ? { data: { value: configValue }, error: null }
                        : { data: null, error: null },
                    ),
                };
              },
            };
          },
        };
      }
      if (table === "topics") {
        return {
          select() {
            return {
              eq: () => Promise.resolve({ data: rows, error: null }),
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return stub;
}

const A_UUID = "11111111-1111-4111-8111-111111111111";
const B_UUID = "22222222-2222-4222-8222-222222222222";
const C_UUID = "33333333-3333-4333-8333-333333333333";

describe("prefilterTopics", () => {
  const rows: TopicRow[] = [
    {
      id: A_UUID,
      slug: "a",
      name: "A",
      description: "topic a",
      vendor: null,
      description_embedding: [1, 0, 0],
    },
    {
      id: B_UUID,
      slug: "b",
      name: "B",
      description: "topic b",
      vendor: "Acme",
      description_embedding: [0, 1, 0],
    },
    {
      id: C_UUID,
      slug: "c",
      name: "C",
      description: "topic c",
      vendor: null,
      description_embedding: [0.9, 0.1, 0],
    },
  ];

  it("returns topics sorted by cosine similarity to the query", async () => {
    const supabase = makeSupabaseStub(rows) as never;
    const out = await prefilterTopics([1, 0, 0], supabase, { k: 5 });
    expect(out.map((t) => t.slug)).toEqual(["a", "c", "b"]);
  });

  it("limits to top-K", async () => {
    const supabase = makeSupabaseStub(rows) as never;
    const out = await prefilterTopics([1, 0, 0], supabase, { k: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.slug)).toEqual(["a", "c"]);
  });

  it("skips topics with NULL or mismatched-length embeddings", async () => {
    const mixed: TopicRow[] = [
      ...rows,
      {
        id: "44444444-4444-4444-8444-444444444444",
        slug: "no-embedding",
        name: "X",
        description: "x",
        vendor: null,
        description_embedding: null,
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        slug: "wrong-dim",
        name: "Y",
        description: "y",
        vendor: null,
        description_embedding: [1, 0],
      },
    ];
    const supabase = makeSupabaseStub(mixed) as never;
    const out = await prefilterTopics([1, 0, 0], supabase, { k: 10 });
    expect(out.map((t) => t.slug)).not.toContain("no-embedding");
    expect(out.map((t) => t.slug)).not.toContain("wrong-dim");
  });

  it("reads K from system_config when no explicit k option is passed", async () => {
    const supabase = makeSupabaseStub(rows, 2) as never;
    const out = await prefilterTopics([1, 0, 0], supabase);
    expect(out).toHaveLength(2);
  });

  it("falls back to default K=25 when no config row exists", async () => {
    const supabase = makeSupabaseStub(rows) as never;
    const out = await prefilterTopics([1, 0, 0], supabase);
    // 3 rows, no truncation; the default K (25) is just larger than the row count.
    expect(out).toHaveLength(3);
  });

  it("returns empty array when there are no topics", async () => {
    const supabase = makeSupabaseStub([]) as never;
    const out = await prefilterTopics([1, 0, 0], supabase, { k: 5 });
    expect(out).toEqual([]);
  });

  it("propagates supabase errors", async () => {
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq: () =>
                Promise.resolve({
                  data: null,
                  error: { message: "rls violation" },
                }),
            };
          },
        };
      },
    } as never;
    await expect(prefilterTopics([1, 0, 0], supabase, { k: 5 })).rejects.toThrow(/rls violation/);
  });
});

// Self-check on the test fixture - silences "unused" warnings for vi from the import.
describe("test infrastructure", () => {
  it("vi is available", () => {
    expect(typeof vi.fn).toBe("function");
  });
});
