import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSuggestTopicsPrompt } from "@/lib/claude/prompts/suggest_topics";
import {
  ExistingMatchSchema,
  ProposedNewTopicSchema,
  SuggestionSchema,
  stratifiedIndices,
  stratifiedChunkSample,
} from "./topic_suggestion";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("SuggestionSchema", () => {
  it("accepts a well-formed suggestion", () => {
    const result = SuggestionSchema.safeParse({
      existing: [{ topic_id: VALID_UUID, confidence: 0.9, reason: "matches" }],
      proposed_new: [
        {
          slug: "new-thing",
          name: "New Thing",
          description: "Covers new thing.",
          vendor: "Acme",
          confidence: 0.8,
          reason: "no existing match",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty arrays (no matches, no new proposals)", () => {
    expect(SuggestionSchema.safeParse({ existing: [], proposed_new: [] }).success).toBe(true);
  });

  it("rejects existing match with non-uuid topic_id", () => {
    const result = ExistingMatchSchema.safeParse({
      topic_id: "not-a-uuid",
      confidence: 0.9,
      reason: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(
      ExistingMatchSchema.safeParse({ topic_id: VALID_UUID, confidence: 1.5, reason: "x" })
        .success,
    ).toBe(false);
    expect(
      ExistingMatchSchema.safeParse({ topic_id: VALID_UUID, confidence: -0.1, reason: "x" })
        .success,
    ).toBe(false);
  });

  it("rejects empty reason", () => {
    expect(
      ExistingMatchSchema.safeParse({ topic_id: VALID_UUID, confidence: 0.9, reason: "" }).success,
    ).toBe(false);
  });

  it("rejects new-topic slug that isn't kebab-case", () => {
    const base = {
      name: "n",
      description: "d",
      vendor: null,
      confidence: 0.9,
      reason: "r",
    };
    expect(ProposedNewTopicSchema.safeParse({ ...base, slug: "Has-Uppercase" }).success).toBe(
      false,
    );
    expect(ProposedNewTopicSchema.safeParse({ ...base, slug: "spaces here" }).success).toBe(false);
    expect(ProposedNewTopicSchema.safeParse({ ...base, slug: "_underscore" }).success).toBe(false);
    expect(ProposedNewTopicSchema.safeParse({ ...base, slug: "trailing-" }).success).toBe(false);
  });

  it("accepts vendor=null on a new-topic proposal", () => {
    const result = ProposedNewTopicSchema.safeParse({
      slug: "vendor-agnostic-topic",
      name: "Vendor-Agnostic",
      description: "Covers cross-vendor stuff.",
      vendor: null,
      confidence: 0.9,
      reason: "r",
    });
    expect(result.success).toBe(true);
  });

  it("enforces max 10 existing matches and max 6 proposed_new", () => {
    const okExisting = Array.from({ length: 10 }, () => ({
      topic_id: VALID_UUID,
      confidence: 0.9,
      reason: "r",
    }));
    expect(SuggestionSchema.safeParse({ existing: okExisting, proposed_new: [] }).success).toBe(
      true,
    );

    const tooManyExisting = Array.from({ length: 11 }, () => ({
      topic_id: VALID_UUID,
      confidence: 0.9,
      reason: "r",
    }));
    expect(
      SuggestionSchema.safeParse({ existing: tooManyExisting, proposed_new: [] }).success,
    ).toBe(false);

    const okProposed = Array.from({ length: 6 }, (_, i) => ({
      slug: `proposed-topic-${i}`,
      name: "n",
      description: "d",
      vendor: null,
      confidence: 0.9,
      reason: "r",
    }));
    expect(SuggestionSchema.safeParse({ existing: [], proposed_new: okProposed }).success).toBe(
      true,
    );

    const tooManyProposed = Array.from({ length: 7 }, (_, i) => ({
      slug: `proposed-topic-${i}`,
      name: "n",
      description: "d",
      vendor: null,
      confidence: 0.9,
      reason: "r",
    }));
    expect(
      SuggestionSchema.safeParse({ existing: [], proposed_new: tooManyProposed }).success,
    ).toBe(false);
  });
});

describe("buildSuggestTopicsPrompt", () => {
  const baseInputs = {
    taxonomy: [
      {
        id: VALID_UUID,
        slug: "connect-crm-sales",
        name: "Acme CRM — Sales Workflow",
        description: "Lead lifecycle, salesperson assignment, follow-up sequences.",
        vendor: "Acme",
      },
    ],
    artifact: {
      filename: "lead-management.docx",
      title: "Lead Management Guide",
      vendor: "Acme",
      artifact_type: "api_documentation",
      source_authority: "vendor_canonical",
    },
    chunkPreview: [
      "Leads are assigned to a salesperson on creation.",
      "Filtering supports leadStatus and isHot booleans.",
    ],
  };

  it("returns a system prompt and a user prompt as strings", () => {
    const out = buildSuggestTopicsPrompt(baseInputs);
    expect(typeof out.systemPrompt).toBe("string");
    expect(out.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof out.userPrompt).toBe("string");
    expect(out.userPrompt.length).toBeGreaterThan(0);
  });

  it("embeds every taxonomy topic's id, slug, and name in the prompt", () => {
    const out = buildSuggestTopicsPrompt(baseInputs);
    expect(out.userPrompt).toContain(VALID_UUID);
    expect(out.userPrompt).toContain("connect-crm-sales");
    expect(out.userPrompt).toContain("Acme CRM — Sales Workflow");
  });

  it("embeds artifact metadata", () => {
    const out = buildSuggestTopicsPrompt(baseInputs);
    expect(out.userPrompt).toContain("lead-management.docx");
    expect(out.userPrompt).toContain("Lead Management Guide");
    expect(out.userPrompt).toContain("api_documentation");
    expect(out.userPrompt).toContain("vendor_canonical");
  });

  it("embeds chunk content with separators", () => {
    const out = buildSuggestTopicsPrompt(baseInputs);
    expect(out.userPrompt).toContain("Leads are assigned to a salesperson on creation.");
    expect(out.userPrompt).toContain("Filtering supports leadStatus");
    expect(out.userPrompt).toContain("--- chunk 1 ---");
    expect(out.userPrompt).toContain("--- chunk 2 ---");
  });

  it("handles empty taxonomy gracefully", () => {
    const out = buildSuggestTopicsPrompt({ ...baseInputs, taxonomy: [] });
    expect(out.userPrompt).toContain("(no existing topics");
  });

  it("handles empty chunkPreview gracefully", () => {
    const out = buildSuggestTopicsPrompt({ ...baseInputs, chunkPreview: [] });
    expect(out.userPrompt).toContain("(no content available)");
  });

  it("renders vendor=null as a readable placeholder", () => {
    const out = buildSuggestTopicsPrompt({
      ...baseInputs,
      artifact: { ...baseInputs.artifact, vendor: null },
    });
    expect(out.userPrompt).toContain("Vendor: (none)");
  });
});

// Mock the Claude client and verify suggestTopics() routes through callTool
// with the expected schema + prompts.
const mockCallTool = vi.fn();
vi.mock("@/lib/claude/client", () => ({
  callTool: (...args: unknown[]) => mockCallTool(...args),
  ClaudeFatalError: class ClaudeFatalError extends Error {},
  ClaudeRetriableError: class ClaudeRetriableError extends Error {},
}));

beforeEach(() => {
  mockCallTool.mockReset();
});
afterEach(() => {
  vi.resetModules();
});

describe("stratifiedIndices", () => {
  it("returns [] for non-positive total or k", () => {
    expect(stratifiedIndices(0, 5)).toEqual([]);
    expect(stratifiedIndices(10, 0)).toEqual([]);
  });

  it("returns all indices when total <= k (no stratification needed)", () => {
    expect(stratifiedIndices(3, 12)).toEqual([0, 1, 2]);
    expect(stratifiedIndices(12, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("returns k evenly-distributed indices when total > k", () => {
    const idx = stratifiedIndices(100, 12);
    expect(idx).toHaveLength(12);
    expect(idx[0]).toBe(0); // always starts at 0
    expect(idx).toEqual([0, 8, 16, 25, 33, 41, 50, 58, 66, 75, 83, 91]);
  });

  it("never includes an out-of-range index", () => {
    for (const total of [13, 50, 100, 199, 1000]) {
      const idx = stratifiedIndices(total, 12);
      for (const i of idx) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(total);
      }
    }
  });

  it("returns sorted, unique indices", () => {
    const idx = stratifiedIndices(50, 12);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(new Set(idx).size).toBe(idx.length);
  });
});

describe("stratifiedChunkSample", () => {
  type ChunkRow = { content: string; chunk_index?: number };

  function makeStub(opts: {
    total?: number;
    rows?: ChunkRow[];
    countError?: { message: string };
    selectError?: { message: string };
  }) {
    return {
      from(_table: string) {
        void _table;
        return {
          select: (_cols: string, opts2?: { count?: string; head?: boolean }) => {
            void _cols;
            const isCountQuery = opts2?.head === true;
            const builder = {
              eq() {
                return builder;
              },
              in() {
                return builder;
              },
              order() {
                return builder;
              },
              then(resolve: (r: unknown) => void) {
                if (isCountQuery) {
                  if (opts.countError) {
                    resolve({ data: null, error: opts.countError, count: null });
                  } else {
                    resolve({ data: null, error: null, count: opts.total ?? 0 });
                  }
                } else {
                  if (opts.selectError) {
                    resolve({ data: null, error: opts.selectError });
                  } else {
                    resolve({ data: opts.rows ?? [], error: null });
                  }
                }
              },
            };
            return builder;
          },
        };
      },
    };
  }

  it("returns empty array when artifact has 0 chunks", async () => {
    const stub = makeStub({ total: 0 });
    const out = await stratifiedChunkSample(stub as never, "art-1");
    expect(out).toEqual([]);
  });

  it("returns chunk contents in ascending chunk_index order", async () => {
    const stub = makeStub({
      total: 50,
      rows: [
        { content: "first", chunk_index: 0 },
        { content: "middle", chunk_index: 25 },
        { content: "last-ish", chunk_index: 49 },
      ],
    });
    const out = await stratifiedChunkSample(stub as never, "art-1", 3);
    expect(out).toEqual(["first", "middle", "last-ish"]);
  });

  it("propagates count errors", async () => {
    const stub = makeStub({ countError: { message: "denied" } });
    await expect(stratifiedChunkSample(stub as never, "art-1")).rejects.toThrow(/count.*denied/);
  });

  it("propagates select errors", async () => {
    const stub = makeStub({ total: 100, selectError: { message: "select failed" } });
    await expect(stratifiedChunkSample(stub as never, "art-1")).rejects.toThrow(/select.*select failed/);
  });
});

describe("isTopicSuggestionEnabled", () => {
  function makeStub(opts: { value?: unknown; error?: { message: string }; missing?: boolean }) {
    return {
      from(_table: string) {
        void _table;
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () => {
                    if (opts.error) {
                      return Promise.resolve({ data: null, error: opts.error });
                    }
                    if (opts.missing) {
                      return Promise.resolve({ data: null, error: null });
                    }
                    return Promise.resolve({ data: { value: opts.value }, error: null });
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  it("returns true when the config row is missing (default)", async () => {
    const { isTopicSuggestionEnabled } = await import("./topic_suggestion");
    const result = await isTopicSuggestionEnabled(makeStub({ missing: true }) as never);
    expect(result).toBe(true);
  });

  it("returns true when the row says true", async () => {
    const { isTopicSuggestionEnabled } = await import("./topic_suggestion");
    expect(await isTopicSuggestionEnabled(makeStub({ value: true }) as never)).toBe(true);
  });

  it("returns false when the row says false", async () => {
    const { isTopicSuggestionEnabled } = await import("./topic_suggestion");
    expect(await isTopicSuggestionEnabled(makeStub({ value: false }) as never)).toBe(false);
  });

  it("treats string 'true'/'false' as their boolean equivalents", async () => {
    const { isTopicSuggestionEnabled } = await import("./topic_suggestion");
    expect(await isTopicSuggestionEnabled(makeStub({ value: "true" }) as never)).toBe(true);
    expect(await isTopicSuggestionEnabled(makeStub({ value: "false" }) as never)).toBe(false);
  });

  it("returns true (default) on a read error", async () => {
    const { isTopicSuggestionEnabled } = await import("./topic_suggestion");
    const result = await isTopicSuggestionEnabled(
      makeStub({ error: { message: "rls" } }) as never,
    );
    expect(result).toBe(true);
  });
});

describe("suggestTopics()", () => {
  it("calls callTool with SuggestionSchema, the suggest_topics tool name, and the built prompts", async () => {
    mockCallTool.mockResolvedValue({ existing: [], proposed_new: [] });

    const { suggestTopics } = await import("./topic_suggestion");
    const inputs = {
      taxonomy: [],
      artifact: {
        filename: "x.md",
        title: null,
        vendor: null,
        artifact_type: "training_guide",
        source_authority: "internal_interpretive",
      },
      chunkPreview: ["some text"],
    };
    const result = await suggestTopics(inputs);

    expect(result).toEqual({ existing: [], proposed_new: [] });
    expect(mockCallTool).toHaveBeenCalledTimes(1);

    const args = mockCallTool.mock.calls[0]![0];
    expect(args.toolName).toBe("suggest_topics");
    expect(args.outputSchema).toBeDefined();
    expect(typeof args.userPrompt).toBe("string");
    expect(args.userPrompt).toContain("some text");
    expect(typeof args.systemPrompt).toBe("string");
  });
});
