import { describe, it, expect, vi } from "vitest";
import {
  parseMarkdown,
  parseFile,
  parseOpenApi,
  UnsupportedFormatError,
} from "./parser";
import { loadFixture } from "@/test/fixtures/loadFixture";

// Mock the LlamaParse client so the PDF dispatcher route can be tested
// without hitting the network. The parser uses a dynamic import, which
// vi.mock intercepts the same way as a static import.
const parsePdfToMarkdownMock = vi.fn();
vi.mock("@/lib/llamaparse/client", () => ({
  parsePdfToMarkdown: (...args: unknown[]) => parsePdfToMarkdownMock(...args),
  LlamaParseFatalError: class LlamaParseFatalError extends Error {},
  LlamaParseRetriableError: class LlamaParseRetriableError extends Error {},
}));

describe("parseMarkdown", () => {
  it("extracts top-level sections from ATX headings", () => {
    const text = ["# First", "Body of first.", "", "# Second", "Body of second."].join("\n");
    const parsed = parseMarkdown(text);
    expect(parsed.format).toBe("markdown");
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]?.heading).toBe("First");
    expect(parsed.sections[0]?.content).toBe("Body of first.");
    expect(parsed.sections[1]?.heading).toBe("Second");
    expect(parsed.sections[1]?.content).toBe("Body of second.");
  });

  it("preserves heading levels (h1..h6)", () => {
    const text = ["# H1", "x", "## H2", "y", "### H3", "z"].join("\n");
    const parsed = parseMarkdown(text);
    expect(parsed.sections.map((s) => s.level)).toEqual([1, 2, 3]);
  });

  it("treats body content of nested sections as flat (siblings, not children)", () => {
    // V1 chunker only cares about flat sections. Hierarchy is a future concern.
    const text = ["# Parent", "before nested", "## Child", "child body"].join("\n");
    const parsed = parseMarkdown(text);
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]?.content).toBe("before nested");
    expect(parsed.sections[1]?.content).toBe("child body");
  });

  it("returns one no-heading section when the document has no ATX headings", () => {
    const text = "Just a paragraph with no heading.\n\nAnother paragraph.";
    const parsed = parseMarkdown(text);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.heading).toBe("(no heading)");
    expect(parsed.sections[0]?.content).toContain("Just a paragraph");
  });

  it("handles trailing whitespace and CRLF gracefully", () => {
    const text = "# Title  \r\nbody  \r\n";
    const parsed = parseMarkdown(text);
    expect(parsed.sections[0]?.heading).toBe("Title");
    expect(parsed.sections[0]?.content).toContain("body");
  });

  it("startOffset points at the beginning of each heading line", () => {
    const text = "intro line\n# First\nbody\n# Second\nmore body";
    const parsed = parseMarkdown(text);
    expect(parsed.sections[0]?.startOffset).toBe(text.indexOf("# First"));
    expect(parsed.sections[1]?.startOffset).toBe(text.indexOf("# Second"));
  });
});

describe("parseFile dispatcher", () => {
  it("routes .md to parseMarkdown", async () => {
    const parsed = await parseFile(Buffer.from("# H\nbody"), "doc.md");
    expect(parsed.format).toBe("markdown");
  });

  it("routes .markdown to parseMarkdown", async () => {
    const parsed = await parseFile(Buffer.from("# H\nbody"), "doc.markdown");
    expect(parsed.format).toBe("markdown");
  });

  it("routes .yaml to parseOpenApi", async () => {
    const yaml = `openapi: 3.0.1
info:
  title: Test API
  version: '1.0'
paths:
  /ping:
    get:
      operationId: ping
      summary: Health check
      responses:
        '200':
          description: OK
`;
    const parsed = await parseFile(Buffer.from(yaml), "spec.yaml");
    expect(parsed.format).toBe("openapi_yaml");
    expect(parsed.endpoints).toHaveLength(1);
  });

  it("routes .json to parseOpenApi", async () => {
    const json = JSON.stringify({
      openapi: "3.0.1",
      info: { title: "Test API", version: "1.0" },
      paths: { "/ping": { get: { operationId: "ping", responses: { "200": { description: "OK" } } } } },
    });
    const parsed = await parseFile(Buffer.from(json), "spec.json");
    expect(parsed.format).toBe("openapi_json");
    expect(parsed.endpoints).toHaveLength(1);
  });

  it("throws UnsupportedFormatError for unrecognized extensions", async () => {
    await expect(parseFile(Buffer.from(""), "weird.xyz")).rejects.toThrow(UnsupportedFormatError);
  });

  it("routes .pdf through LlamaParse and parses returned markdown into sections", async () => {
    parsePdfToMarkdownMock.mockResolvedValueOnce({
      jobId: "job-pdf-123",
      markdown: "# From PDF\n\nfirst section body\n\n# Second\n\nsecond section body",
    });
    const parsed = await parseFile(Buffer.from("fake-pdf-bytes"), "guide.pdf");
    expect(parsed.format).toBe("pdf");
    expect(parsed.llamaparse_job_id).toBe("job-pdf-123");
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]?.heading).toBe("From PDF");
    expect(parsed.sections[1]?.heading).toBe("Second");
    expect(parsePdfToMarkdownMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      "guide.pdf",
    );
  });
});

describe("parseOpenApi", () => {
  const minimalSpec = `openapi: 3.0.1
info:
  title: Lead Management
  version: '1.0'
  description: Manage leads for the Acme CRM.
paths:
  /leads:
    get:
      operationId: listLeads
      summary: List leads
      description: Returns leads filtered by status.
      tags: [leads]
      parameters:
        - name: leadStatus
          in: query
          required: false
          description: Filter by status.
          schema:
            type: string
        - name: userId
          in: query
          required: true
          description: Requesting user id.
          schema:
            type: integer
      responses:
        '200':
          description: List of leads
        '401':
          description: Unauthorized
    post:
      operationId: createLead
      summary: Create a lead
      tags: [leads]
      responses:
        '201':
          description: Lead created
`;

  it("extracts one endpoint per (path, method) combo", async () => {
    const parsed = await parseOpenApi(minimalSpec, "yaml");
    expect(parsed.format).toBe("openapi_yaml");
    expect(parsed.endpoints).toHaveLength(2);
    const methods = parsed.endpoints!.map((e) => `${e.method} ${e.path}`).sort();
    expect(methods).toEqual(["GET /leads", "POST /leads"]);
  });

  it("preserves operationId, summary, description, tags, parameters", async () => {
    const parsed = await parseOpenApi(minimalSpec, "yaml");
    const get = parsed.endpoints!.find((e) => e.method === "GET")!;
    expect(get.operationId).toBe("listLeads");
    expect(get.summary).toBe("List leads");
    expect(get.description).toBe("Returns leads filtered by status.");
    expect(get.tags).toEqual(["leads"]);
    expect(get.parameters).toHaveLength(2);
  });

  it("builds one section per endpoint plus an overview section", async () => {
    const parsed = await parseOpenApi(minimalSpec, "yaml");
    expect(parsed.sections).toHaveLength(3); // overview + 2 endpoints
    expect(parsed.sections[0]?.heading).toContain("Overview");
    expect(parsed.sections[1]?.heading).toMatch(/^(GET|POST) \/leads$/);
  });

  it("endpoint section content includes method, path, summary, parameters", async () => {
    const parsed = await parseOpenApi(minimalSpec, "yaml");
    const getSection = parsed.sections.find((s) => s.heading === "GET /leads");
    expect(getSection).toBeDefined();
    expect(getSection!.content).toContain("GET /leads");
    expect(getSection!.content).toContain("listLeads");
    expect(getSection!.content).toContain("List leads");
    expect(getSection!.content).toContain("leadStatus");
    expect(getSection!.content).toContain("userId");
    expect(getSection!.content).toContain("required");
  });

  it("flags deprecated endpoints", async () => {
    const spec = `openapi: 3.0.1
info: { title: T, version: '1' }
paths:
  /old:
    get:
      deprecated: true
      responses: { '200': { description: ok } }
`;
    const parsed = await parseOpenApi(spec, "yaml");
    expect(parsed.endpoints![0]?.deprecated).toBe(true);
    expect(parsed.sections.find((s) => s.heading === "GET /old")?.content).toContain("DEPRECATED");
  });

  it("throws on malformed YAML", async () => {
    await expect(parseOpenApi("openapi: 3.0.1\n: : :", "yaml")).rejects.toThrow(/Failed to parse|parse failed/i);
  });

  it("tolerates structurally-incomplete specs (best-effort extraction)", async () => {
    // We deliberately use SwaggerParser.parse(), not validate(), so vendor
    // specs with minor non-conformance still produce best-effort output.
    // A spec missing `info` returns zero endpoints rather than throwing.
    const parsed = await parseOpenApi("openapi: 3.0.1\npaths: {}", "yaml");
    expect(parsed.endpoints).toEqual([]);
  });

  it("parses Swagger 2.0 specs (in addition to OpenAPI 3.x)", async () => {
    // Real vendor specs (e.g., the Initech Direct Post Sales Leads YAML) use
    // Swagger 2.0 + may have non-standard parameter shapes. The parser
    // should still extract method+path even when the spec doesn't strictly
    // validate against either schema.
    const swagger2 = `swagger: "2.0"
info:
  version: "1.0.0"
  title: Test API
paths:
  /leads:
    post:
      operationId: createLead
      summary: Create a lead
      parameters:
        - name: body
          in: body
          required: true
          schema:
            type: object
        - name: weird-param
          in: nonStandardLocation
          extraProperty: true
      responses:
        "200":
          description: OK
`;
    const parsed = await parseOpenApi(swagger2, "yaml");
    expect(parsed.endpoints).toHaveLength(1);
    expect(parsed.endpoints?.[0]?.method).toBe("POST");
    expect(parsed.endpoints?.[0]?.path).toBe("/leads");
    expect(parsed.endpoints?.[0]?.operationId).toBe("createLead");
  });
});

describe("fixtures", () => {
  it("parses the markdown training-guide fixture into expected sections", () => {
    const text = loadFixture("training_guide.md");
    const parsed = parseMarkdown(text);
    expect(parsed.format).toBe("markdown");
    const headings = parsed.sections.map((s) => s.heading);
    expect(headings).toContain("Sample Training Guide");
    expect(headings).toContain("Lead Capture Workflow");
    expect(headings).toContain("Appointment Scheduling");
    expect(headings).toContain("Reporting");
  });

  it("parses the OpenAPI fixture and extracts endpoints + deprecated flag", async () => {
    const text = loadFixture("openapi.yaml");
    const parsed = await parseOpenApi(text, "yaml");
    expect(parsed.format).toBe("openapi_yaml");
    expect(parsed.endpoints).toBeDefined();
    const ops = parsed.endpoints!.map((e) => `${e.method} ${e.path}`).sort();
    expect(ops).toEqual([
      "DELETE /widgets/{id}",
      "GET /widgets",
      "GET /widgets/{id}",
      "POST /widgets",
    ]);
    const del = parsed.endpoints!.find((e) => e.method === "DELETE")!;
    expect(del.deprecated).toBe(true);
    const list = parsed.endpoints!.find((e) => e.operationId === "listWidgets")!;
    // parameters is typed `unknown[]` because OpenAPI Parameter Objects vary
    // by schema; cast for the assertion on .name (a string in any param shape).
    const paramNames = (list.parameters as Array<{ name: string }>).map((p) => p.name).sort();
    expect(paramNames).toEqual(["ownerId", "status"]);
  });
});
