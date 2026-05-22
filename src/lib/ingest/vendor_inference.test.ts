import { describe, it, expect } from "vitest";
import { inferVendor, KNOWN_VENDORS } from "./vendor_inference";

describe("inferVendor", () => {
  it("returns null for empty input", () => {
    const result = inferVendor([]);
    expect(result.vendor).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.counts).toEqual({});
  });

  it("returns null when no known vendors appear in the text", () => {
    const result = inferVendor(["random text about cars and dealers", "no brand names here"]);
    expect(result.vendor).toBeNull();
  });

  it("identifies a single-vendor doc", () => {
    const text = `
      This is the Acme Lead Management API guide. Acme provides
      a comprehensive CRM platform. Use the Acme endpoints to query leads.
    `;
    const result = inferVendor([text]);
    expect(result.vendor).toBe("Acme");
    expect(result.confidence).toBeGreaterThan(0.99);
    expect(result.counts.Acme).toBe(3);
  });

  it("resolves an alias to its canonical name", () => {
    // "Acme CRM" → Acme per the alias map
    const text = "Acme CRM is the platform. Acme CRM has many endpoints. Acme CRM users.";
    const result = inferVendor([text]);
    expect(result.vendor).toBe("Acme");
    expect(result.counts.Acme).toBe(3);
  });

  it("aggregates counts across multiple aliases of the same vendor", () => {
    const text = "Acme and Acme CRM both refer to the same product. AcmeConnect too.";
    const result = inferVendor([text]);
    expect(result.vendor).toBe("Acme");
    expect(result.counts.Acme).toBe(3);
  });

  it("returns null on ambiguous mentions (tie below minTopShare)", () => {
    // Equal mentions for two vendors → top share 0.5, default threshold is 0.5.
    // Note: minTopShare is < not <=, so exactly 0.5 should fail.
    const text = "Globex and Acme both compete here. Globex vs Acme.";
    const result = inferVendor([text]);
    expect(result.counts.Globex).toBe(2);
    expect(result.counts.Acme).toBe(2);
    expect(result.vendor).toBeNull();
  });

  it("returns the dominant vendor when one is clearly mentioned more than the other", () => {
    const text = `
      Acme is the main subject. Acme endpoints, Acme auth.
      A passing mention of Globex for context.
    `;
    const result = inferVendor([text]);
    expect(result.vendor).toBe("Acme");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("returns null when total matches are below minTotalMatches", () => {
    // One match of Acme, below default threshold of 3.
    const text = "Brief mention of Acme once in passing.";
    const result = inferVendor([text]);
    expect(result.vendor).toBeNull();
    expect(result.counts.Acme).toBe(1);
  });

  it("respects a custom minTotalMatches", () => {
    const text = "Acme appears just once.";
    const lenient = inferVendor([text], { minTotalMatches: 1 });
    expect(lenient.vendor).toBe("Acme");
  });

  it("respects a custom minTopShare", () => {
    // 60/40 split — passes default 0.5 but fails 0.7
    const text =
      "Acme Acme Acme Globex Globex";
    const easy = inferVendor([text]);
    expect(easy.vendor).toBe("Acme");

    const strict = inferVendor([text], { minTopShare: 0.7 });
    expect(strict.vendor).toBeNull();
  });

  it("is case-insensitive", () => {
    const text = "acme ACME Acme";
    const result = inferVendor([text]);
    expect(result.counts.Acme).toBe(3);
  });

  it("matches word boundaries (doesn't match substrings of unrelated words)", () => {
    // Made-up word containing "Acme" as a substring should NOT count.
    // Acme has no overlapping sub-aliases so this isolates the
    // word-boundary behavior cleanly.
    const text =
      "Some unrelated wordstart-vinsolutionsstuff doesn't count. " +
      "But Acme is mentioned three separate times. Acme is real. Acme too.";
    const result = inferVendor([text]);
    expect(result.counts.Acme).toBe(3);
  });

  it("handles punctuation and hyphens around the alias", () => {
    const text = '"Acme" runs (Acme) and -Acme- everywhere.';
    const result = inferVendor([text]);
    expect(result.counts.Acme).toBe(3);
  });

  it("concatenates multiple input texts (filename + title + chunks)", () => {
    const filename = "vinsolutions_guide.md";
    const title = "Acme Lead Management";
    const chunk = "Acme APIs are documented here.";
    const result = inferVendor([filename, title, chunk]);
    expect(result.vendor).toBe("Acme");
    expect(result.counts.Acme).toBe(3);
  });

  it("skips empty / whitespace-only input slots", () => {
    const result = inferVendor(["", "  ", "Acme twice. Acme again. Acme."]);
    expect(result.vendor).toBe("Acme");
  });

  it("KNOWN_VENDORS list has unique canonical names", () => {
    const names = KNOWN_VENDORS.map((v) => v.canonical);
    expect(new Set(names).size).toBe(names.length);
  });

  it("KNOWN_VENDORS aliases include the canonical name itself", () => {
    for (const v of KNOWN_VENDORS) {
      expect(v.aliases).toContain(v.canonical);
    }
  });
});
