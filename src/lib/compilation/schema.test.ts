import { describe, it, expect } from "vitest";
import {
  CitationSchema,
  CompiledPageSchema,
  SectionSchema,
  SECTION_KEYS,
} from "./schema";

const UUID = "00000000-0000-0000-0000-000000000001";
const UUID2 = "00000000-0000-0000-0000-000000000002";

function fullSections() {
  return Object.fromEntries(
    SECTION_KEYS.map((k) => [k, { text: "x", citations: [] }]),
  );
}

describe("CitationSchema", () => {
  it("accepts citation with artifact_id + quote", () => {
    expect(() =>
      CitationSchema.parse({ artifact_id: UUID, quote: "abc" }),
    ).not.toThrow();
  });

  it("accepts chunk_id with the artifact_id", () => {
    expect(() =>
      CitationSchema.parse({ artifact_id: UUID, chunk_id: UUID2, quote: "abc" }),
    ).not.toThrow();
  });

  it("accepts rule_id with the artifact_id", () => {
    expect(() =>
      CitationSchema.parse({ artifact_id: UUID, rule_id: UUID2, quote: "abc" }),
    ).not.toThrow();
  });

  it("rejects citation with both chunk_id and rule_id", () => {
    expect(() =>
      CitationSchema.parse({
        artifact_id: UUID,
        chunk_id: UUID2,
        rule_id: UUID2,
        quote: "abc",
      }),
    ).toThrow();
  });

  it("rejects empty quote", () => {
    expect(() =>
      CitationSchema.parse({ artifact_id: UUID, quote: "" }),
    ).toThrow();
  });

  it("rejects non-uuid artifact_id", () => {
    expect(() =>
      CitationSchema.parse({ artifact_id: "not-a-uuid", quote: "abc" }),
    ).toThrow();
  });
});

describe("SectionSchema", () => {
  it("accepts an empty section (text='', citations=[])", () => {
    expect(() => SectionSchema.parse({ text: "", citations: [] })).not.toThrow();
  });

  it("accepts a section with markdown + citations", () => {
    expect(() =>
      SectionSchema.parse({
        text: "Some **markdown** text.",
        citations: [{ artifact_id: UUID, quote: "x" }],
      }),
    ).not.toThrow();
  });
});

describe("CompiledPageSchema", () => {
  it("accepts a full 7-section page", () => {
    expect(() =>
      CompiledPageSchema.parse({
        summary: "A topic about leads.",
        sections: fullSections(),
      }),
    ).not.toThrow();
  });

  it("rejects when a section is missing", () => {
    const sections = fullSections();
    delete (sections as Record<string, unknown>).current_view;
    expect(() =>
      CompiledPageSchema.parse({ summary: "x", sections }),
    ).toThrow();
  });

  it("rejects when summary is empty", () => {
    expect(() =>
      CompiledPageSchema.parse({ summary: "", sections: fullSections() }),
    ).toThrow();
  });

  it("rejects when summary is > 1000 chars", () => {
    expect(() =>
      CompiledPageSchema.parse({
        summary: "x".repeat(1001),
        sections: fullSections(),
      }),
    ).toThrow();
  });

  it("accepts a long-but-bounded summary (≤1000 chars)", () => {
    expect(() =>
      CompiledPageSchema.parse({
        summary: "x".repeat(1000),
        sections: fullSections(),
      }),
    ).not.toThrow();
  });
});
