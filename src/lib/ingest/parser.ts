// File-type-aware parser for the ingestion pipeline.
//
// Supports:
//   .md / .markdown — direct read, ATX-heading section detection
//   .docx           — mammoth.convertToHtml + heading-tag walker
//   .yaml / .yml    — YAML.parse + SwaggerParser.validate, one section per endpoint
//   .json           — JSON.parse + SwaggerParser.validate, one section per endpoint

import * as mammoth from "mammoth";
import SwaggerParser from "@apidevtools/swagger-parser";
import YAML from "yaml";

export type Section = {
  heading: string;
  level: number; // 1-6 for h1-h6
  content: string; // plain text under this heading until the next heading
  startOffset: number; // char offset in the full text (markdown) or HTML (docx)
};

export type ExtractedEndpoint = {
  method: string; // HTTP method, uppercase (GET, POST, ...)
  path: string;
  operationId: string | null;
  summary: string | null;
  description: string | null;
  tags: string[];
  parameters: unknown[]; // OpenAPI Parameter Objects, stored as jsonb
  requestBody: unknown | null;
  responses: Record<string, unknown>;
  security: unknown[];
  deprecated: boolean;
};

export type ParsedDocument = {
  text: string; // full plain text
  sections: Section[];
  format: "markdown" | "docx" | "openapi_yaml" | "openapi_json" | "pdf";
  // Only populated for openapi_* formats; powers the Phase 2.B
  // api_endpoints persistence step in the Inngest function.
  endpoints?: ExtractedEndpoint[];
  // The raw OpenAPI document (or null if parsing failed) — useful for
  // downstream consumers that want schema details, server URLs, etc.
  spec?: unknown;
  // LlamaParse job id (PDFs only). Useful for re-fetching results or
  // surfacing the parse run in admin tooling.
  llamaparse_job_id?: string;
};

export class UnsupportedFormatError extends Error {
  override readonly name = "UnsupportedFormatError";
}

export class UnsupportedYetError extends Error {
  override readonly name = "UnsupportedYetError";
}

// =============================================================================
// Markdown
// =============================================================================

export function parseMarkdown(text: string): ParsedDocument {
  type HeadingMatch = {
    startOffset: number;
    contentStart: number;
    level: number;
    heading: string;
  };

  const matches: HeadingMatch[] = [];
  const lines = text.split("\n");
  let charIndex = 0;
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m && m[1] && m[2]) {
      matches.push({
        startOffset: charIndex,
        contentStart: charIndex + line.length + 1, // skip past the newline
        level: m[1].length,
        heading: m[2].trim(),
      });
    }
    charIndex += line.length + 1;
  }

  const sections: Section[] = matches.map((cur, i) => {
    const next = matches[i + 1];
    const end = next ? next.startOffset : text.length;
    return {
      heading: cur.heading,
      level: cur.level,
      content: text.slice(cur.contentStart, end).trim(),
      startOffset: cur.startOffset,
    };
  });

  if (sections.length === 0) {
    // No headings — return the whole document as one section.
    sections.push({
      heading: "(no heading)",
      level: 1,
      content: text.trim(),
      startOffset: 0,
    });
  }

  return { text, sections, format: "markdown" };
}

// =============================================================================
// DOCX (via mammoth)
// =============================================================================

const HTML_HEADING_RE = /<(h[1-6])>([\s\S]*?)<\/\1>/gi;

function stripHtml(html: string): string {
  return (
    html
      // Preserve paragraph + heading + line-break structure BEFORE stripping tags.
      // The chunker splits on `\n\s*\n`, so we need real newlines here — otherwise
      // a long DOCX collapses to one giant paragraph and never gets chunked.
      .replace(/<\/(p|h[1-6]|li|tr|div|section|article|blockquote)>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      // Now strip remaining tags.
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Collapse intra-line whitespace (spaces and tabs) but NOT newlines.
      .replace(/[ \t]+/g, " ")
      // Trim spaces around line boundaries.
      .replace(/ *\n */g, "\n")
      // Cap consecutive newlines at 2 so the paragraph splitter sees clean boundaries.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const text = stripHtml(html);

  type HeadingMatch = {
    startInHtml: number; // index of the opening <hN>
    contentStartInHtml: number; // index after the closing </hN>
    level: number;
    heading: string;
  };

  const matches: HeadingMatch[] = [];
  HTML_HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HTML_HEADING_RE.exec(html)) !== null) {
    const tag = m[1];
    const rawHeading = m[2];
    if (!tag || rawHeading === undefined) continue;
    matches.push({
      startInHtml: m.index,
      contentStartInHtml: m.index + m[0].length,
      level: parseInt(tag.charAt(1), 10),
      heading: stripHtml(rawHeading),
    });
  }

  const sections: Section[] = matches.map((cur, i) => {
    const next = matches[i + 1];
    const end = next ? next.startInHtml : html.length;
    return {
      heading: cur.heading,
      level: cur.level,
      content: stripHtml(html.slice(cur.contentStartInHtml, end)),
      startOffset: cur.startInHtml,
    };
  });

  if (sections.length === 0) {
    sections.push({
      heading: "(no heading)",
      level: 1,
      content: text,
      startOffset: 0,
    });
  }

  return { text, sections, format: "docx" };
}

// =============================================================================
// OpenAPI (YAML / JSON)
// =============================================================================

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"] as const;
type HttpMethodLower = (typeof HTTP_METHODS)[number];

export async function parseOpenApi(text: string, format: "yaml" | "json"): Promise<ParsedDocument> {
  // 1. Parse raw text into an object.
  let raw: unknown;
  try {
    raw = format === "yaml" ? YAML.parse(text) : JSON.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse OpenAPI ${format.toUpperCase()}: ${(e as Error).message}`);
  }

  // 2. Parse + resolve $refs via SwaggerParser. We deliberately use
  //    `parse()` rather than `validate()` — parse handles both Swagger 2.0
  //    and OpenAPI 3.x, resolves $refs, but doesn't strictly validate
  //    against the spec schema. That tolerance matters: real vendor specs
  //    (e.g., Initech's Direct Post Sales Leads YAML) have minor non-conformance
  //    — missing required fields on a parameter, non-standard `in:` values,
  //    extra properties. `validate()` would reject those outright; `parse()`
  //    lets us best-effort extract what's there. The downside (we won't
  //    catch wholly malformed specs at parse time) is acceptable since
  //    downstream steps will just produce fewer endpoints.
  let parsed: unknown;
  try {
    parsed = await SwaggerParser.parse(raw as never);
  } catch (e) {
    throw new Error(`OpenAPI parse failed: ${(e as Error).message}`);
  }
  const spec = parsed as {
    info?: { title?: string; description?: string };
    paths?: Record<string, Record<string, unknown>>;
  };

  // 3. Walk paths to extract endpoints.
  const endpoints: ExtractedEndpoint[] = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<HttpMethodLower, unknown>)[method];
      if (!op || typeof op !== "object") continue;
      const o = op as Record<string, unknown>;
      endpoints.push({
        method: method.toUpperCase(),
        path,
        operationId: typeof o.operationId === "string" ? o.operationId : null,
        summary: typeof o.summary === "string" ? o.summary : null,
        description: typeof o.description === "string" ? o.description : null,
        tags: Array.isArray(o.tags) ? (o.tags as string[]) : [],
        parameters: Array.isArray(o.parameters) ? o.parameters : [],
        requestBody: o.requestBody ?? null,
        responses: (o.responses as Record<string, unknown>) ?? {},
        security: Array.isArray(o.security) ? o.security : [],
        deprecated: o.deprecated === true,
      });
    }
  }

  // 4. Build one prose-shaped section per endpoint so the existing chunker
  //    handles them. Each section becomes one chunk (well below target size).
  const apiTitle = spec.info?.title ?? "API";
  const apiSummary = spec.info?.description ?? null;

  const sections: Section[] = [
    // Lead with an overview section so a query about the API as a whole has
    // something to hit.
    {
      heading: `${apiTitle} — Overview`,
      level: 1,
      content: [apiSummary, `Endpoints: ${endpoints.length}`].filter(Boolean).join("\n\n"),
      startOffset: 0,
    },
    ...endpoints.map((ep, i) => ({
      heading: `${ep.method} ${ep.path}`,
      level: 2,
      content: endpointToProse(ep, apiTitle),
      startOffset: i + 1, // synthetic; chunks don't rely on this offset
    })),
  ];

  const fullText = sections.map((s) => `# ${s.heading}\n${s.content}`).join("\n\n");

  return {
    text: fullText,
    sections,
    format: format === "yaml" ? "openapi_yaml" : "openapi_json",
    endpoints,
    spec,
  };
}

function endpointToProse(ep: ExtractedEndpoint, apiTitle: string): string {
  const parts: string[] = [];
  parts.push(`API: ${apiTitle}`);
  parts.push(`${ep.method} ${ep.path}`);
  if (ep.operationId) parts.push(`Operation: ${ep.operationId}`);
  if (ep.tags.length > 0) parts.push(`Tags: ${ep.tags.join(", ")}`);
  if (ep.summary) parts.push(`Summary: ${ep.summary}`);
  if (ep.description) parts.push(`Description: ${ep.description}`);
  if (ep.parameters.length > 0) {
    const paramLines = ep.parameters
      .map((p) => {
        const param = p as Record<string, unknown>;
        const name = String(param.name ?? "(unnamed)");
        const where = String(param.in ?? "?");
        const req = param.required === true ? ", required" : "";
        const desc = typeof param.description === "string" ? `: ${param.description}` : "";
        return `- ${name} (${where}${req})${desc}`;
      })
      .join("\n");
    parts.push(`Parameters:\n${paramLines}`);
  }
  if (ep.requestBody && typeof ep.requestBody === "object") {
    const rb = ep.requestBody as Record<string, unknown>;
    if (typeof rb.description === "string") parts.push(`Request body: ${rb.description}`);
  }
  if (Object.keys(ep.responses).length > 0) {
    const respLines = Object.entries(ep.responses)
      .map(([code, resp]) => {
        const r = resp as Record<string, unknown>;
        const desc = typeof r.description === "string" ? `: ${r.description}` : "";
        return `- ${code}${desc}`;
      })
      .join("\n");
    parts.push(`Responses:\n${respLines}`);
  }
  if (ep.deprecated) parts.push("Status: DEPRECATED");
  return parts.join("\n\n");
}

// =============================================================================
// PDF (via LlamaParse v2, polling)
// =============================================================================

/**
 * Parse a PDF by submitting it to LlamaParse (polling pattern), then
 * running the returned markdown through parseMarkdown() so the rest of
 * the ingest pipeline (chunker, embedder, persister, suggest-topics)
 * receives the same `Section[]` shape it does for any other format.
 *
 * The LlamaParse job id is captured in `llamaparse_job_id` for audit /
 * re-fetch if a parse needs to be inspected later.
 */
export async function parsePdf(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  // Lazy import so non-PDF parse paths don't pull the LlamaParse module
  // (and its env-validation side effects) at module-load time.
  const { parsePdfToMarkdown } = await import("@/lib/llamaparse/client");
  const { jobId, markdown } = await parsePdfToMarkdown(buffer, filename);
  const parsed = parseMarkdown(markdown);
  return {
    ...parsed,
    format: "pdf",
    llamaparse_job_id: jobId,
  };
}

// =============================================================================
// Dispatcher
// =============================================================================

export async function parseFile(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return parseMarkdown(buffer.toString("utf8"));
  }
  if (lower.endsWith(".docx")) {
    return parseDocx(buffer);
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return parseOpenApi(buffer.toString("utf8"), "yaml");
  }
  if (lower.endsWith(".json")) {
    return parseOpenApi(buffer.toString("utf8"), "json");
  }
  if (lower.endsWith(".pdf")) {
    return parsePdf(buffer, filename);
  }
  throw new UnsupportedFormatError(`Unsupported file extension: ${filename}`);
}
