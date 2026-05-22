import { describe, it, expect } from "vitest";
import {
  computeChunkMean,
  findSupersedesCandidate,
  versionsDiffer,
} from "./version_detection";

describe("versionsDiffer", () => {
  it("returns false for both NULL", () => {
    expect(versionsDiffer(null, null)).toBe(false);
  });
  it("returns false for equal versions", () => {
    expect(versionsDiffer("v1", "v1")).toBe(false);
  });
  it("returns true for different versions", () => {
    expect(versionsDiffer("v1", "v2")).toBe(true);
  });
  it("returns true when one side is NULL and the other is set", () => {
    expect(versionsDiffer(null, "v2")).toBe(true);
    expect(versionsDiffer("v1", null)).toBe(true);
  });
});

type ChunkRow = { embedding: string | number[] | null };
type ArtifactRow = { id: string; title: string; vendor_version: string | null };

// Builds a minimal stub supabase client whose behavior is fully driven by
// the test's input fixtures. Captures which queries get made so we can
// verify the filters used.
function makeStub(opts: {
  /** chunks[artifactId] = array of chunk rows */
  chunks: Record<string, ChunkRow[]>;
  /** artifacts returned by the candidate query */
  candidates?: ArtifactRow[];
  /** Force an error from one of the calls */
  errors?: { chunks?: { message: string }; artifacts?: { message: string } };
}) {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];

  return {
    calls,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const record = { table, filters };
      calls.push(record);

      function select(_cols: string) {
        void _cols;
        const builder = {
          eq(col: string, val: unknown) {
            filters[`eq:${col}`] = val;
            return builder;
          },
          neq(col: string, val: unknown) {
            filters[`neq:${col}`] = val;
            return builder;
          },
          then(resolve: (r: unknown) => void) {
            if (table === "chunks") {
              if (opts.errors?.chunks) {
                resolve({ data: null, error: opts.errors.chunks });
                return;
              }
              const artifactId = filters["eq:artifact_id"] as string;
              const rows = opts.chunks[artifactId] ?? [];
              resolve({ data: rows, error: null });
              return;
            }
            if (table === "artifacts") {
              if (opts.errors?.artifacts) {
                resolve({ data: null, error: opts.errors.artifacts });
                return;
              }
              resolve({ data: opts.candidates ?? [], error: null });
              return;
            }
            resolve({ data: [], error: null });
          },
        };
        return builder;
      }

      return { select };
    },
  };
}

describe("computeChunkMean", () => {
  it("averages embeddings element-wise", async () => {
    const stub = makeStub({
      chunks: {
        a: [
          { embedding: [1, 0, 0] },
          { embedding: [0, 1, 0] },
          { embedding: [0, 0, 1] },
        ],
      },
    });
    const mean = await computeChunkMean(stub as never, "a");
    expect(mean).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("parses pgvector string-form embeddings", async () => {
    const stub = makeStub({
      chunks: {
        a: [{ embedding: "[1, 2, 3]" }, { embedding: "[3, 4, 5]" }],
      },
    });
    const mean = await computeChunkMean(stub as never, "a");
    expect(mean).toEqual([2, 3, 4]);
  });

  it("skips NULL embeddings", async () => {
    const stub = makeStub({
      chunks: { a: [{ embedding: [2, 2] }, { embedding: null }, { embedding: [4, 4] }] },
    });
    const mean = await computeChunkMean(stub as never, "a");
    expect(mean).toEqual([3, 3]);
  });

  it("returns null when artifact has no chunks", async () => {
    const stub = makeStub({ chunks: { a: [] } });
    const mean = await computeChunkMean(stub as never, "a");
    expect(mean).toBeNull();
  });

  it("returns null when every chunk has NULL embedding", async () => {
    const stub = makeStub({ chunks: { a: [{ embedding: null }, { embedding: null }] } });
    const mean = await computeChunkMean(stub as never, "a");
    expect(mean).toBeNull();
  });

  it("propagates errors", async () => {
    const stub = makeStub({ chunks: {}, errors: { chunks: { message: "denied" } } });
    await expect(computeChunkMean(stub as never, "a")).rejects.toThrow(/denied/);
  });
});

describe("findSupersedesCandidate", () => {
  it("returns null when new artifact has no vendor", async () => {
    const stub = makeStub({ chunks: { new: [{ embedding: [1, 0, 0] }] } });
    const out = await findSupersedesCandidate(stub as never, {
      newArtifactId: "new",
      newVendor: null,
      newVendorVersion: "v2",
    });
    expect(out).toBeNull();
  });

  it("returns null when new artifact has no chunks", async () => {
    const stub = makeStub({ chunks: { new: [] } });
    const out = await findSupersedesCandidate(stub as never, {
      newArtifactId: "new",
      newVendor: "Acme",
      newVendorVersion: "v2",
    });
    expect(out).toBeNull();
  });

  it("returns the highest-similarity candidate above the threshold", async () => {
    // new artifact embedding = [1, 0, 0]
    // candidate "old1" (v1): [0.95, 0.05, 0] → cosine ~0.998 (above 0.75) ✓
    // candidate "old2" (v0): [0, 1, 0]       → cosine 0 (below 0.75) ✗
    const stub = makeStub({
      chunks: {
        new: [{ embedding: [1, 0, 0] }],
        old1: [{ embedding: [0.95, 0.05, 0] }],
        old2: [{ embedding: [0, 1, 0] }],
      },
      candidates: [
        { id: "old1", title: "Old One", vendor_version: "v1" },
        { id: "old2", title: "Old Two", vendor_version: "v0" },
      ],
    });
    const out = await findSupersedesCandidate(stub as never, {
      newArtifactId: "new",
      newVendor: "Acme",
      newVendorVersion: "v2",
    });
    expect(out).not.toBeNull();
    expect(out!.prior_artifact_id).toBe("old1");
    expect(out!.prior_title).toBe("Old One");
    expect(out!.prior_vendor_version).toBe("v1");
    expect(out!.new_vendor_version).toBe("v2");
    expect(out!.similarity).toBeGreaterThan(0.99);
  });

  it("skips candidates whose vendor_version equals the new artifact's", async () => {
    // Same vendor_version → not a supersession even if highly similar.
    const stub = makeStub({
      chunks: {
        new: [{ embedding: [1, 0, 0] }],
        old: [{ embedding: [1, 0, 0] }],
      },
      candidates: [{ id: "old", title: "Old", vendor_version: "v2" }],
    });
    const out = await findSupersedesCandidate(stub as never, {
      newArtifactId: "new",
      newVendor: "Acme",
      newVendorVersion: "v2",
    });
    expect(out).toBeNull();
  });

  it("returns null when no candidate clears the threshold", async () => {
    const stub = makeStub({
      chunks: {
        new: [{ embedding: [1, 0, 0] }],
        old: [{ embedding: [0, 1, 0] }],
      },
      candidates: [{ id: "old", title: "Old", vendor_version: "v1" }],
    });
    const out = await findSupersedesCandidate(stub as never, {
      newArtifactId: "new",
      newVendor: "Acme",
      newVendorVersion: "v2",
    });
    expect(out).toBeNull();
  });

  it("filters by same vendor and excludes the new artifact's id", async () => {
    const stub = makeStub({
      chunks: { new: [{ embedding: [1, 0, 0] }], old: [{ embedding: [1, 0, 0] }] },
      candidates: [{ id: "old", title: "Old", vendor_version: "v1" }],
    });
    await findSupersedesCandidate(stub as never, {
      newArtifactId: "new",
      newVendor: "Acme",
      newVendorVersion: "v2",
    });
    const artifactsCall = stub.calls.find((c) => c.table === "artifacts");
    expect(artifactsCall).toBeDefined();
    expect(artifactsCall!.filters["eq:status"]).toBe("active");
    expect(artifactsCall!.filters["eq:vendor"]).toBe("Acme");
    expect(artifactsCall!.filters["neq:id"]).toBe("new");
  });

  it("treats NULL prior vendor_version vs set new vendor_version as a difference", async () => {
    const stub = makeStub({
      chunks: { new: [{ embedding: [1, 0, 0] }], old: [{ embedding: [1, 0, 0] }] },
      candidates: [{ id: "old", title: "Old", vendor_version: null }],
    });
    const out = await findSupersedesCandidate(stub as never, {
      newArtifactId: "new",
      newVendor: "Acme",
      newVendorVersion: "v2",
    });
    expect(out).not.toBeNull();
    expect(out!.prior_vendor_version).toBeNull();
  });

  it("respects a custom threshold", async () => {
    // Cosine sim of [1,0,0] and [0.7,0.3,0] is ~0.919 — above default 0.75
    // but below a custom 0.95.
    const stub = makeStub({
      chunks: { new: [{ embedding: [1, 0, 0] }], old: [{ embedding: [0.7, 0.3, 0] }] },
      candidates: [{ id: "old", title: "Old", vendor_version: "v1" }],
    });
    const lo = await findSupersedesCandidate(stub as never, {
      newArtifactId: "new",
      newVendor: "Acme",
      newVendorVersion: "v2",
    });
    expect(lo).not.toBeNull();

    const hi = await findSupersedesCandidate(stub as never, {
      newArtifactId: "new",
      newVendor: "Acme",
      newVendorVersion: "v2",
      threshold: 0.95,
    });
    expect(hi).toBeNull();
  });
});
