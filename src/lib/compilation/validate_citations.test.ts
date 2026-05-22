import { describe, it, expect } from "vitest";
import { validateCitations } from "./validate_citations";
import { SECTION_KEYS, type CompiledPage } from "./schema";
import type {
  ArtifactForCompilation,
  ChunkForCompilation,
  RuleForCompilation,
} from "./inputs";

const A_OK = "00000000-0000-0000-0000-000000000001";
const A_OTHER = "00000000-0000-0000-0000-000000000002";
const A_GHOST = "00000000-0000-0000-0000-0000000000ff";
const C_OK = "00000000-0000-0000-0000-000000000010";
const C_OTHER_ARTIFACT = "00000000-0000-0000-0000-000000000011";
const C_GHOST = "00000000-0000-0000-0000-0000000000fe";
const R_OK = "00000000-0000-0000-0000-000000000020";
const R_GHOST = "00000000-0000-0000-0000-0000000000fd";

function inputs() {
  const artifacts: ArtifactForCompilation[] = [
    {
      id: A_OK,
      title: "Artifact A",
      vendor: "Acme",
      vendor_version: "v3",
      source_authority: "vendor_canonical",
      effective_date: null,
      artifact_type: "api_documentation",
    },
    {
      id: A_OTHER,
      title: "Artifact B",
      vendor: "Acme",
      vendor_version: "v3",
      source_authority: "vendor_canonical",
      effective_date: null,
      artifact_type: "api_documentation",
    },
  ];
  const chunks: ChunkForCompilation[] = [
    {
      chunk_id: C_OK,
      content: "Required: contact, leadSource",
      section: null,
      artifact_id: A_OK,
      artifact_title: "Artifact A",
      score: 0.9,
    },
    {
      chunk_id: C_OTHER_ARTIFACT,
      content: "Other artifact content",
      section: null,
      artifact_id: A_OTHER,
      artifact_title: "Artifact B",
      score: 0.7,
    },
  ];
  const rules: RuleForCompilation[] = [
    {
      id: R_OK,
      rule_key: "acme.lead.create.required_fields",
      rule_type: "data_requirement",
      value: { required: ["contact"] },
      conditions: null,
      source_quote: "Required: contact, leadSource",
      confidence: 0.95,
      source_artifact_id: A_OK,
    },
  ];
  return { artifacts, chunks, rules };
}

function pageWith(citations: CompiledPage["sections"]["current_view"]["citations"]): CompiledPage {
  return {
    summary: "test",
    sections: Object.fromEntries(
      SECTION_KEYS.map((k) => [
        k,
        k === "current_view" ? { text: "x", citations } : { text: "", citations: [] },
      ]),
    ) as CompiledPage["sections"],
  };
}

describe("validateCitations", () => {
  it("keeps a valid artifact-only citation", () => {
    const page = pageWith([{ artifact_id: A_OK, quote: "ok" }]);
    const { page: result, warnings } = validateCitations(page, inputs());
    expect(result.sections.current_view.citations).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("keeps a valid chunk citation", () => {
    const page = pageWith([{ artifact_id: A_OK, chunk_id: C_OK, quote: "ok" }]);
    const { page: result, warnings } = validateCitations(page, inputs());
    expect(result.sections.current_view.citations).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("keeps a valid rule citation", () => {
    const page = pageWith([{ artifact_id: A_OK, rule_id: R_OK, quote: "ok" }]);
    const { page: result, warnings } = validateCitations(page, inputs());
    expect(result.sections.current_view.citations).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("drops a citation to an unknown artifact", () => {
    const bad = { artifact_id: A_GHOST, quote: "ok" };
    const page = pageWith([bad]);
    const { page: result, warnings } = validateCitations(page, inputs());
    expect(result.sections.current_view.citations).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.reason).toBe("unknown_artifact");
  });

  it("drops a citation with an unknown chunk_id", () => {
    const bad = { artifact_id: A_OK, chunk_id: C_GHOST, quote: "ok" };
    const page = pageWith([bad]);
    const { page: result, warnings } = validateCitations(page, inputs());
    expect(result.sections.current_view.citations).toEqual([]);
    expect(warnings[0]?.reason).toBe("unknown_chunk");
  });

  it("drops a citation where chunk belongs to a different artifact", () => {
    const bad = { artifact_id: A_OK, chunk_id: C_OTHER_ARTIFACT, quote: "ok" };
    const page = pageWith([bad]);
    const { page: result, warnings } = validateCitations(page, inputs());
    expect(result.sections.current_view.citations).toEqual([]);
    expect(warnings[0]?.reason).toBe("chunk_artifact_mismatch");
  });

  it("drops a citation with an unknown rule_id", () => {
    const bad = { artifact_id: A_OK, rule_id: R_GHOST, quote: "ok" };
    const page = pageWith([bad]);
    const { page: result, warnings } = validateCitations(page, inputs());
    expect(result.sections.current_view.citations).toEqual([]);
    expect(warnings[0]?.reason).toBe("unknown_rule");
  });

  it("preserves valid citations and drops only the bad ones", () => {
    const page = pageWith([
      { artifact_id: A_OK, quote: "good" },
      { artifact_id: A_GHOST, quote: "bad" },
      { artifact_id: A_OK, chunk_id: C_OK, quote: "good chunk" },
    ]);
    const { page: result, warnings } = validateCitations(page, inputs());
    expect(result.sections.current_view.citations).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });

  it("preserves section text untouched", () => {
    const page = pageWith([{ artifact_id: A_GHOST, quote: "bad" }]);
    const { page: result } = validateCitations(page, inputs());
    expect(result.sections.current_view.text).toBe("x");
  });
});
