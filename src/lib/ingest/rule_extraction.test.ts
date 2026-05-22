import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildExtractRulesPrompt } from "@/lib/claude/prompts/extract_rules";
import { ExtractedRuleSchema, RuleExtractionSchema } from "./rule_extraction";

describe("ExtractedRuleSchema", () => {
  function valid() {
    return {
      rule_key: "acme.lead.create.required_fields",
      rule_type: "data_requirement" as const,
      value: { required: ["contact", "leadSource"] },
      source_quote: "The lead the you want to create. Required: contact, leadSource",
      confidence: 0.95,
    };
  }

  it("accepts a minimal valid rule", () => {
    expect(ExtractedRuleSchema.safeParse(valid()).success).toBe(true);
  });

  it("accepts a rule with conditions, source_location, and extraction_notes", () => {
    const result = ExtractedRuleSchema.safeParse({
      ...valid(),
      conditions: { endpoint: "POST /leads", version: ["v2", "v3"] },
      source_location: { section: "POST /leads", chunk_index: 4 },
      extraction_notes: "Source doesn't describe v1 behavior — may be inferred only.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects rule_key that isn't dot-separated lowercase", () => {
    const bads = [
      "Acme.lead.required",
      "lead-management.required",
      "lead required fields",
      "lead",
      "lead..create",
      "lead.",
    ];
    for (const bad of bads) {
      expect(ExtractedRuleSchema.safeParse({ ...valid(), rule_key: bad }).success).toBe(false);
    }
  });

  it("rejects rule_type outside the enum", () => {
    expect(
      ExtractedRuleSchema.safeParse({ ...valid(), rule_type: "policy" }).success,
    ).toBe(false);
  });

  it("rejects empty source_quote", () => {
    expect(ExtractedRuleSchema.safeParse({ ...valid(), source_quote: "" }).success).toBe(false);
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(ExtractedRuleSchema.safeParse({ ...valid(), confidence: 1.5 }).success).toBe(false);
    expect(ExtractedRuleSchema.safeParse({ ...valid(), confidence: -0.1 }).success).toBe(false);
  });
});

describe("RuleExtractionSchema", () => {
  it("accepts empty rules array (no rules found is a valid response)", () => {
    expect(RuleExtractionSchema.safeParse({ rules: [] }).success).toBe(true);
  });

  it("enforces max 20 rules", () => {
    const r = {
      rule_key: "a.b.c",
      rule_type: "validation" as const,
      value: {},
      source_quote: "x",
      confidence: 0.9,
    };
    const ok = Array.from({ length: 20 }, () => r);
    const tooMany = Array.from({ length: 21 }, () => r);
    expect(RuleExtractionSchema.safeParse({ rules: ok }).success).toBe(true);
    expect(RuleExtractionSchema.safeParse({ rules: tooMany }).success).toBe(false);
  });
});

describe("buildExtractRulesPrompt", () => {
  const baseInputs = {
    artifact: {
      title: "Lead Management API",
      vendor: "Acme",
      vendor_version: "v3",
      artifact_type: "openapi_spec",
      source_authority: "vendor_canonical",
    },
    chunks: [
      "POST /leads creates a new lead. Required fields: contact, leadSource, leadType.",
      "Page size defaults to 10. Maximum of 100.",
    ],
  };

  it("returns non-empty system + user prompts", () => {
    const out = buildExtractRulesPrompt(baseInputs);
    expect(out.systemPrompt.length).toBeGreaterThan(0);
    expect(out.userPrompt.length).toBeGreaterThan(0);
  });

  it("embeds artifact metadata", () => {
    const out = buildExtractRulesPrompt(baseInputs);
    expect(out.userPrompt).toContain("Lead Management API");
    expect(out.userPrompt).toContain("Acme");
    expect(out.userPrompt).toContain("v3");
    expect(out.userPrompt).toContain("openapi_spec");
    expect(out.userPrompt).toContain("vendor_canonical");
  });

  it("embeds chunks with separators", () => {
    const out = buildExtractRulesPrompt(baseInputs);
    expect(out.userPrompt).toContain("POST /leads creates a new lead");
    expect(out.userPrompt).toContain("Page size defaults to 10");
    expect(out.userPrompt).toContain("--- chunk 1 ---");
    expect(out.userPrompt).toContain("--- chunk 2 ---");
  });

  it("lists already-extracted rule_keys when provided", () => {
    const out = buildExtractRulesPrompt({
      ...baseInputs,
      existingRuleKeys: ["acme.auth.bearer_token_required", "acme.pagination.limit_max"],
    });
    expect(out.userPrompt).toContain("acme.auth.bearer_token_required");
    expect(out.userPrompt).toContain("acme.pagination.limit_max");
  });

  it("handles missing optional inputs gracefully", () => {
    const out = buildExtractRulesPrompt({
      artifact: {
        title: "Test",
        vendor: null,
        vendor_version: null,
        artifact_type: "training_guide",
        source_authority: "internal_interpretive",
      },
      chunks: [],
    });
    expect(out.userPrompt).toContain("Vendor: (none)");
    expect(out.userPrompt).toContain("Vendor version: (none)");
    expect(out.userPrompt).toContain("(no content available)");
  });
});

// Mock the Claude client to verify extractRules() routes through callTool
// with the correct schema + prompt.
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

describe("extractRules()", () => {
  it("calls callTool with extract_rules tool, RuleExtractionSchema, and built prompts", async () => {
    mockCallTool.mockResolvedValue({ rules: [] });

    const { extractRules } = await import("./rule_extraction");
    const result = await extractRules({
      artifact: {
        title: "Test artifact",
        vendor: "Acme",
        vendor_version: null,
        artifact_type: "openapi_spec",
        source_authority: "vendor_canonical",
      },
      chunks: ["some content"],
    });

    expect(result).toEqual({ rules: [] });
    expect(mockCallTool).toHaveBeenCalledTimes(1);
    const args = mockCallTool.mock.calls[0]![0];
    expect(args.toolName).toBe("extract_rules");
    expect(args.outputSchema).toBeDefined();
    expect(args.maxTokens).toBe(8192);
    expect(args.userPrompt).toContain("some content");
    expect(typeof args.systemPrompt).toBe("string");
  });
});
