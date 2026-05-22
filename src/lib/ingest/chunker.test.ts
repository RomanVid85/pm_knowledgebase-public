import { describe, it, expect } from "vitest";
import { chunk, estimateTokens, type Chunk } from "./chunker";
import type { ParsedDocument, Section } from "./parser";

function makeParsed(sections: Section[]): ParsedDocument {
  return {
    text: sections.map((s) => `# ${s.heading}\n${s.content}`).join("\n\n"),
    sections,
    format: "markdown",
  };
}

function makeSection(heading: string, content: string, level = 1): Section {
  return { heading, level, content, startOffset: 0 };
}

// Roughly N words, separated by spaces. Used to construct sections of a
// known approximate token count.
function nWords(n: number, prefix = "word"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");
}

// Build a paragraph of n words; concat with \n\n to create multi-paragraph content.
function paragraphOf(n: number, prefix = "word"): string {
  return nWords(n, prefix);
}

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
  });

  it("scales roughly as words × 1.3", () => {
    // 10 words → ceil(10 * 1.3) = 13
    expect(estimateTokens(nWords(10))).toBe(13);
    expect(estimateTokens(nWords(100))).toBe(130);
  });
});

describe("chunk — small inputs", () => {
  it("emits one chunk per fits-in-section", () => {
    const parsed = makeParsed([
      makeSection("Intro", "Short body."),
      makeSection("Body", "Another short body."),
    ]);
    const chunks = chunk(parsed);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.section).toBe("Intro");
    expect(chunks[1]?.section).toBe("Body");
  });

  it("skips empty sections", () => {
    const parsed = makeParsed([
      makeSection("Empty", "   "),
      makeSection("Real", "has content"),
    ]);
    const chunks = chunk(parsed);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.section).toBe("Real");
  });

  it("assigns chunkIndex 0..N-1 sequentially", () => {
    const parsed = makeParsed([
      makeSection("A", "a"),
      makeSection("B", "b"),
      makeSection("C", "c"),
    ]);
    const chunks = chunk(parsed);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("contentHash is stable for identical content", () => {
    const parsed1 = makeParsed([makeSection("X", "hello world")]);
    const parsed2 = makeParsed([makeSection("X", "hello world")]);
    const chunks1 = chunk(parsed1);
    const chunks2 = chunk(parsed2);
    expect(chunks1[0]?.contentHash).toBe(chunks2[0]?.contentHash);
    expect(chunks1[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("contentHash differs for different content", () => {
    const a = chunk(makeParsed([makeSection("X", "alpha")]));
    const b = chunk(makeParsed([makeSection("X", "beta")]));
    expect(a[0]?.contentHash).not.toBe(b[0]?.contentHash);
  });
});

describe("chunk — splitting large sections", () => {
  it("splits a section that exceeds 1.5× target into multiple chunks", () => {
    // Target 100 tokens, section ~520 tokens (400 words × 1.3) → must split.
    const big = [
      paragraphOf(80, "p1"),
      paragraphOf(80, "p2"),
      paragraphOf(80, "p3"),
      paragraphOf(80, "p4"),
      paragraphOf(80, "p5"),
    ].join("\n\n");
    const parsed = makeParsed([makeSection("Big", big)]);
    const chunks = chunk(parsed, { targetTokens: 100, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Every chunk inherits the section heading.
    for (const c of chunks) {
      expect(c.section).toBe("Big");
    }
  });

  it("includes overlap content in subsequent chunks", () => {
    // Use paragraphs smaller than target so multiple pack into one chunk
    // and the overlap path can carry the tail into the next chunk. With
    // 80-word paragraphs above target, each goes to its own chunk via
    // the single-paragraph-too-big branch (no overlap by design).
    const paragraphs = [
      paragraphOf(30, "alpha"),
      paragraphOf(30, "beta"),
      paragraphOf(30, "gamma"),
      paragraphOf(30, "delta"),
      paragraphOf(30, "epsilon"),
    ];
    const big = paragraphs.join("\n\n");
    const parsed = makeParsed([makeSection("Big", big)]);
    const chunks = chunk(parsed, { targetTokens: 60, overlapTokens: 30 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // The end of one chunk's content should appear at the start of the next.
    const firstTail = chunks[0]!.content.split(/\s+/).slice(-5).join(" ");
    expect(chunks[1]!.content).toContain(firstTail);
  });

  it("emits an oversized single paragraph as one whole chunk (no mid-paragraph split)", () => {
    // A single paragraph far above target — V1 keeps it whole.
    const huge = paragraphOf(500); // ~650 tokens, target 100
    const parsed = makeParsed([makeSection("Huge", huge)]);
    const chunks = chunk(parsed, { targetTokens: 100, overlapTokens: 20 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.tokenCount).toBeGreaterThan(100);
  });

  it("preserves heading on every produced chunk for retrieval citation", () => {
    const big = [paragraphOf(80, "x"), paragraphOf(80, "y"), paragraphOf(80, "z")].join("\n\n");
    const parsed = makeParsed([makeSection("HeadingA", big)]);
    const chunks = chunk(parsed, { targetTokens: 100, overlapTokens: 20 });
    expect(chunks.every((c: Chunk) => c.section === "HeadingA")).toBe(true);
  });
});

describe("chunk — multi-section inputs", () => {
  it("flattens multiple sections into a single chunk array with sequential indexes", () => {
    const big = [paragraphOf(80, "x"), paragraphOf(80, "y"), paragraphOf(80, "z")].join("\n\n");
    const parsed = makeParsed([
      makeSection("First", "short"),
      makeSection("Second", big),
      makeSection("Third", "short again"),
    ]);
    const chunks = chunk(parsed, { targetTokens: 100, overlapTokens: 20 });
    // First and third sections produce 1 chunk each; second produces multiple.
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0]?.section).toBe("First");
    expect(chunks.at(-1)?.section).toBe("Third");
    // chunkIndex is a contiguous range.
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]?.chunkIndex).toBe(i);
    }
  });
});
