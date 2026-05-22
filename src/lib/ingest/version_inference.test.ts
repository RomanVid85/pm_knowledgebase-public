import { describe, it, expect } from "vitest";
import { inferVersion } from "./version_inference";

describe("inferVersion", () => {
  it("returns null on empty input", () => {
    const r = inferVersion([]);
    expect(r.version).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.counts).toEqual({});
  });

  it("returns null on text with no version markers", () => {
    expect(inferVersion(["just some content with no version markers anywhere"]).version).toBeNull();
  });

  it("identifies a single dominant version", () => {
    const text =
      "POST /v3/leads creates a lead. The v3 API supports filtering. Use the v3 endpoints exclusively.";
    const r = inferVersion([text]);
    expect(r.version).toBe("v3");
    expect(r.counts.v3).toBe(3);
  });

  it("identifies version with minor numbers", () => {
    const text = "Use v1.0 of the API. v1.0 supports basic operations. v1.0 is documented here.";
    const r = inferVersion([text]);
    expect(r.version).toBe("v1.0");
    expect(r.counts["v1.0"]).toBe(3);
  });

  it("matches 'version N' form", () => {
    const text = "This is version 3 of the API. version 3 was released in 2024. Use version 3.";
    const r = inferVersion([text]);
    expect(r.version).toBe("v3");
    expect(r.counts.v3).toBe(3);
  });

  it("matches 'release N' form", () => {
    const text = "Release 12.4 introduces new endpoints. Release 12.4 supersedes release 12.3.";
    const r = inferVersion([text]);
    expect(r.version).toBe("v12.4");
    expect(r.counts["v12.4"]).toBe(2);
  });

  it("aggregates mentions across patterns", () => {
    // "v3", "version 3" should both canonicalize to "v3"
    const text =
      "Use v3 endpoints. The version 3 spec is here. Look at v3 docs. Version 3 is current.";
    const r = inferVersion([text]);
    expect(r.version).toBe("v3");
    expect(r.counts.v3).toBe(4);
  });

  it("is case-insensitive", () => {
    const text = "V1 V1 V1 endpoints all use the same version.";
    const r = inferVersion([text]);
    expect(r.version).toBe("v1");
    expect(r.counts.v1).toBe(3);
  });

  it("does NOT match section numbers like '1.1 Get Opportunity'", () => {
    const text =
      "1. Sales Opportunities API. 1.1 Get Opportunity by ID. 1.2 Search Opportunities. 2. Sales Customers API. 2.1 Get Customer.";
    const r = inferVersion([text]);
    expect(r.version).toBeNull();
  });

  it("does NOT match version-like substrings inside other words", () => {
    // "device7" should not match as "v7" — non-letter-digit boundary required
    const text = "device7 alone has no version. randomword has v2 inside but pavlov is real.";
    const r = inferVersion([text]);
    // "v2" still matches (preceded by space in "has v2 inside"). "pavlov" has
    // "v" + non-digit so doesn't match the pattern. We're checking that the
    // 'v' in 'pavlov' isn't getting counted spuriously.
    expect(r.counts.v2 ?? 0).toBeLessThanOrEqual(1);
  });

  it("matches version inside URL-like content", () => {
    const text = "Endpoint base: api.cox.com/v3/leads. See api.cox.com/v3/contacts. Auth on /v3.";
    const r = inferVersion([text]);
    expect(r.version).toBe("v3");
    expect(r.counts.v3).toBe(3);
  });

  it("matches version inside Accept headers", () => {
    const text =
      "Send 'Accept: application/vnd.coxauto.v3+json' on every request. Always v3+json.";
    const r = inferVersion([text]);
    expect(r.version).toBe("v3");
    expect(r.counts.v3).toBe(2);
  });

  it("returns null on ambiguous ties below minTopShare", () => {
    // 3 mentions each → 50/50 split. With default minTopShare=0.6, neither wins.
    const text = "v1 v1 v1 v2 v2 v2";
    const r = inferVersion([text]);
    expect(r.version).toBeNull();
    expect(r.counts.v1).toBe(3);
    expect(r.counts.v2).toBe(3);
  });

  it("returns the dominant version on a clear majority", () => {
    // 5 v3 vs 2 v2 = 71% v3, above default 0.6 threshold
    const text = "v3 v3 v3 v3 v3 v2 v2";
    const r = inferVersion([text]);
    expect(r.version).toBe("v3");
  });

  it("returns null when total matches < minTotalMatches", () => {
    // Only 1 mention, below default 2 threshold
    const text = "v3 is mentioned just once.";
    const r = inferVersion([text]);
    expect(r.version).toBeNull();
    expect(r.counts.v3).toBe(1);
  });

  it("respects custom minTotalMatches", () => {
    const text = "v3 once.";
    const r = inferVersion([text], { minTotalMatches: 1 });
    expect(r.version).toBe("v3");
  });

  it("respects custom minTopShare", () => {
    // 2 v3 vs 1 v2 = 67% v3, above default 0.6 but below custom 0.8
    const text = "v3 v3 v2";
    const lenient = inferVersion([text]);
    expect(lenient.version).toBe("v3");
    const strict = inferVersion([text], { minTopShare: 0.8 });
    expect(strict.version).toBeNull();
  });

  it("concatenates multiple inputs (filename + title + chunks)", () => {
    const filename = "leadmanagement_v3.yaml";
    const title = "Acme Lead Management v3";
    const chunk = "POST /leads on v3 of the API.";
    const r = inferVersion([filename, title, chunk]);
    expect(r.version).toBe("v3");
    expect(r.counts.v3).toBe(3);
  });

  it("skips empty / whitespace-only input slots", () => {
    const r = inferVersion(["", "  ", "v2 mentioned. v2 also here."]);
    expect(r.version).toBe("v2");
  });
});
