import { describe, it, expect } from "vitest";
import { ReviewPayloadSchema } from "./schema";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("ReviewPayloadSchema", () => {
  function baseValid() {
    return {
      artifact_id: UUID_A,
      vendor: "Acme",
      vendor_version: "v3",
      is_vendor_specific: true,
      existing: [{ topic_id: UUID_B, confidence: 0.91 }],
      proposed_new: [],
      manual: [],
      supersedes: null,
    };
  }

  it("accepts a minimal valid payload", () => {
    expect(ReviewPayloadSchema.safeParse(baseValid()).success).toBe(true);
  });

  it("accepts proposed_new + manual + supersedes", () => {
    const result = ReviewPayloadSchema.safeParse({
      artifact_id: UUID_A,
      vendor: "Acme",
      vendor_version: "v3",
      is_vendor_specific: true,
      existing: [],
      proposed_new: [
        {
          slug: "new-thing",
          name: "New Thing",
          description: "Covers something new.",
          vendor: "Acme",
          confidence: 0.85,
        },
      ],
      manual: [
        { slug: "manual-add", name: "Manual", description: "PM added.", vendor: null },
      ],
      supersedes: { prior_artifact_id: UUID_B },
    });
    expect(result.success).toBe(true);
  });

  it("accepts non-vendor opt-out (vendor=null + is_vendor_specific=false)", () => {
    const result = ReviewPayloadSchema.safeParse({
      ...baseValid(),
      vendor: null,
      vendor_version: null,
      is_vendor_specific: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts vendor_version=null when vendor is set (version is optional)", () => {
    const result = ReviewPayloadSchema.safeParse({
      ...baseValid(),
      vendor_version: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts free-form vendor_version strings (v3, semver, date)", () => {
    for (const v of ["v3", "2.5.1", "2024-Q4", "r12.4", "1.0"]) {
      expect(
        ReviewPayloadSchema.safeParse({ ...baseValid(), vendor_version: v }).success,
      ).toBe(true);
    }
  });

  it("rejects empty-string vendor_version (must be null)", () => {
    const result = ReviewPayloadSchema.safeParse({
      ...baseValid(),
      vendor_version: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects vendor=null with is_vendor_specific=true (inconsistent)", () => {
    const result = ReviewPayloadSchema.safeParse({
      ...baseValid(),
      vendor: null,
      is_vendor_specific: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects vendor=set with is_vendor_specific=false (inconsistent)", () => {
    const result = ReviewPayloadSchema.safeParse({
      ...baseValid(),
      vendor: "Acme",
      is_vendor_specific: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty-string vendor (must be null instead)", () => {
    const result = ReviewPayloadSchema.safeParse({
      ...baseValid(),
      vendor: "",
      is_vendor_specific: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects payload with non-uuid artifact_id", () => {
    expect(
      ReviewPayloadSchema.safeParse({ ...baseValid(), artifact_id: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("rejects proposed_new slug that isn't kebab-case", () => {
    const result = ReviewPayloadSchema.safeParse({
      ...baseValid(),
      proposed_new: [
        {
          slug: "Has-Uppercase",
          name: "X",
          description: "x",
          vendor: null,
          confidence: 0.9,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects manual topic missing description", () => {
    const result = ReviewPayloadSchema.safeParse({
      ...baseValid(),
      manual: [{ slug: "ok", name: "Name", description: "", vendor: null }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence outside [0, 1] on an existing match", () => {
    const result = ReviewPayloadSchema.safeParse({
      ...baseValid(),
      existing: [{ topic_id: UUID_B, confidence: 1.5 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts supersedes=null and rejects supersedes with non-uuid", () => {
    expect(
      ReviewPayloadSchema.safeParse({ ...baseValid(), supersedes: null }).success,
    ).toBe(true);
    expect(
      ReviewPayloadSchema.safeParse({
        ...baseValid(),
        supersedes: { prior_artifact_id: "nope" },
      }).success,
    ).toBe(false);
  });

  it("accepts new-topic vendor=null", () => {
    const result = ReviewPayloadSchema.safeParse({
      ...baseValid(),
      proposed_new: [
        {
          slug: "vendor-agnostic",
          name: "Vendor agnostic",
          description: "Covers cross-vendor stuff.",
          vendor: null,
          confidence: 0.9,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
