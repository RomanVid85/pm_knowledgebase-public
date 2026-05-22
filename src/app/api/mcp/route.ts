// MCP server endpoint (Phase 6).
//
// Exposes the verified PM Knowledge Base to MCP clients — engineering AI
// agents (Claude Code, Cursor, etc.) and PM brief-writing tools (Claude
// Desktop). Authentication is bearer-token via Supabase Auth: the token
// is the user's Supabase access JWT. Any authenticated user (any role)
// can read; we don't restrict reads by role because the knowledge base
// is intentionally team-wide.
//
// Four tools:
//   - search_knowledge        — semantic search across all chunks
//   - get_rules_for_topic     — verified rules for a topic (the
//                                belt-and-suspenders filter on
//                                status='active' AND human_verified=true
//                                lives here, per verification_workflow.md)
//   - get_api_endpoint        — structured endpoint lookup by method+path
//   - get_topic_page          — Layer 3 compiled topic page (the active
//                                version only — drafts and superseded
//                                versions never leak)
//
// Runtime: Node.js, NOT Edge. The Streamable HTTP transport requires
// Node APIs that Edge doesn't support — per the 2026-04-23 decision in
// DECISIONS.md.

import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/supabase/admin";
import { searchKnowledge } from "@/lib/retrieval/search";
import { getAuthEnv } from "@/lib/env";
import type { Database } from "@/types/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================================
// Tool implementations — pure functions that call into our existing libs
// ============================================================================

async function runSearchKnowledge(args: {
  query: string;
  limit?: number | undefined;
  anchor_topic_slug?: string | undefined;
}) {
  const supabase = adminClient();
  let anchorTopicId: string | undefined;
  if (args.anchor_topic_slug) {
    const { data } = await supabase
      .from("topics")
      .select("id")
      .eq("slug", args.anchor_topic_slug)
      .maybeSingle();
    anchorTopicId = data?.id;
    if (!anchorTopicId) {
      return {
        error: `topic '${args.anchor_topic_slug}' not found`,
        results: [],
      };
    }
  }
  const results = await searchKnowledge(supabase, args.query, {
    limit: args.limit ?? 8,
    ...(anchorTopicId !== undefined ? { anchorTopicId } : {}),
  });
  return {
    query: args.query,
    count: results.length,
    results: results.map((r) => ({
      content: r.content,
      section: r.section,
      artifact_id: r.artifactId,
      artifact_title: r.artifactTitle,
      score: r.score,
      similarity: r.components.similarity,
      authority: r.components.authority,
    })),
  };
}

async function runGetRulesForTopic(args: { topic_slug: string }) {
  const supabase = adminClient();
  const { data: topic } = await supabase
    .from("topics")
    .select("id, slug, name, vendor")
    .eq("slug", args.topic_slug)
    .maybeSingle();
  if (!topic) {
    return { error: `topic '${args.topic_slug}' not found`, rules: [] };
  }

  // Belt-and-suspenders per verification_workflow.md: BOTH status='active'
  // AND human_verified=true. Never expose pending or disputed rules to MCP.
  const { data: rules, error } = await supabase
    .from("rules")
    .select(
      "rule_key, rule_type, value, conditions, source_quote, confidence, source_artifact_id, verified_at",
    )
    .eq("topic_id", topic.id)
    .eq("status", "active")
    .eq("human_verified", true)
    .order("rule_key");
  if (error) {
    return { error: `rules query failed: ${error.message}`, rules: [] };
  }
  return {
    topic: { slug: topic.slug, name: topic.name, vendor: topic.vendor },
    count: rules?.length ?? 0,
    rules: rules ?? [],
  };
}

async function runGetTopicPage(args: { topic_slug: string }) {
  const supabase = adminClient();
  const { data: topic } = await supabase
    .from("topics")
    .select("id, slug, name, vendor, description")
    .eq("slug", args.topic_slug)
    .maybeSingle();
  if (!topic) {
    return { error: `topic '${args.topic_slug}' not found`, page: null };
  }

  // Only the currently-active version. Drafts and superseded versions
  // must NEVER reach MCP consumers — the same hygiene the rules table
  // enforces via status='active' AND human_verified=true.
  const { data: page, error } = await supabase
    .from("topic_pages")
    .select("id, version, title, summary, sections, source_artifact_ids, compiled_at")
    .eq("topic_id", topic.id)
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return { error: `topic_pages query failed: ${error.message}`, page: null };
  }
  if (!page) {
    return {
      topic: { slug: topic.slug, name: topic.name, vendor: topic.vendor },
      page: null,
      note: "No compiled page yet. Try search_knowledge for raw chunks.",
    };
  }
  return {
    topic: { slug: topic.slug, name: topic.name, vendor: topic.vendor },
    page: {
      version: page.version,
      title: page.title,
      summary: page.summary,
      sections: page.sections,
      source_artifact_ids: page.source_artifact_ids,
      compiled_at: page.compiled_at,
    },
  };
}

async function runGetApiEndpoint(args: {
  http_method: string;
  path: string;
  vendor?: string | undefined;
}) {
  const supabase = adminClient();
  let q = supabase
    .from("api_endpoints")
    .select(
      "http_method, path, operation_id, summary, description, parameters, request_body, responses, security, deprecated, tags, vendor, api_version, source_artifact_id",
    )
    .eq("http_method", args.http_method.toUpperCase())
    .eq("path", args.path)
    .eq("status", "active");
  if (args.vendor) q = q.eq("vendor", args.vendor);
  const { data: endpoints, error } = await q.limit(5);
  if (error) {
    return { error: `endpoint query failed: ${error.message}`, endpoints: [] };
  }
  return {
    method: args.http_method.toUpperCase(),
    path: args.path,
    count: endpoints?.length ?? 0,
    endpoints: endpoints ?? [],
  };
}

// ============================================================================
// Helpers — uniform MCP response shape
// ============================================================================

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

// ============================================================================
// MCP handler — declares tools, no auth yet
// ============================================================================

const baseHandler = createMcpHandler(
  // `basePath: "/api"` tells mcp-handler to expect the Streamable HTTP
  // endpoint at "/api/mcp" (basePath + "/mcp" by convention). Without it,
  // the handler defaults to "/mcp" at the root and 404s every request to
  // our Next.js route at /api/mcp/route.ts. SSE and message endpoints
  // would similarly be /api/sse and /api/message — not used here.
  (server) => {
    server.registerTool(
      "search_knowledge",
      {
        description:
          "Semantic search across the team's verified knowledge base. Returns ranked chunks with citations. Use for open-ended questions like 'what does our team know about X?' Tip: pass anchor_topic_slug to narrow results to one topic.",
        inputSchema: {
          query: z
            .string()
            .describe(
              "Natural-language query. Embedded via Voyage and matched against artifact chunks.",
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe("Max results (default 8)."),
          anchor_topic_slug: z
            .string()
            .optional()
            .describe(
              "Optional topic slug (e.g. 'connect-crm-lead-management-api') to filter to one topic.",
            ),
        },
      },
      async (args) => jsonResult(await runSearchKnowledge(args)),
    );

    server.registerTool(
      "get_rules_for_topic",
      {
        description:
          "Return the verified business rules for a topic — required fields, allowed values, rate limits, deprecated behavior, etc. Only returns rules with status='active' AND human_verified=true (the two-person verification gate).",
        inputSchema: {
          topic_slug: z
            .string()
            .describe(
              "Topic slug, e.g. 'connect-crm-lead-management-api'. Get the full list via search_knowledge.",
            ),
        },
      },
      async (args) => jsonResult(await runGetRulesForTopic(args)),
    );

    server.registerTool(
      "get_topic_page",
      {
        description:
          "Return the currently-active compiled topic page — a synthesized 7-section view of what the team knows about a topic, with citations to source artifacts. Returns null page if no version has been published. Drafts and superseded versions are never exposed.",
        inputSchema: {
          topic_slug: z
            .string()
            .describe("Topic slug, e.g. 'connect-crm-lead-management-api'."),
        },
      },
      async (args) => jsonResult(await runGetTopicPage(args)),
    );

    server.registerTool(
      "get_api_endpoint",
      {
        description:
          "Look up a structured API endpoint by HTTP method and path. Returns operation_id, summary, parameters, request body, responses, security, and deprecation status. Populated from ingested OpenAPI specs.",
        inputSchema: {
          http_method: z
            .string()
            .describe("HTTP method — GET, POST, PUT, DELETE, PATCH (case-insensitive)."),
          path: z
            .string()
            .describe("Endpoint path, e.g. '/leads' or '/vehicles/trade/id/{id}'."),
          vendor: z
            .string()
            .optional()
            .describe(
              "Optional vendor filter (e.g., 'Acme') to disambiguate when the same path exists across vendors.",
            ),
        },
      },
      async (args) => jsonResult(await runGetApiEndpoint(args)),
    );
  },
  {},
  { basePath: "/api" },
);

// ============================================================================
// Auth — bearer token validated against Supabase Auth
// ============================================================================

async function verifySupabaseToken(req: Request, token?: string) {
  void req;
  if (!token) return undefined;
  const env = getAuthEnv();
  // Plain client (not adminClient) — we want auth.getUser() to interpret
  // the provided token as the user, not as the service role.
  const sb = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return undefined;
  // Returning an AuthInfo shape that mcp-handler accepts — the token,
  // client id (we use the user id), and scopes (none required).
  return {
    token,
    clientId: data.user.id,
    scopes: [],
    extra: { userId: data.user.id, email: data.user.email },
  };
}

const handler = withMcpAuth(baseHandler, verifySupabaseToken, { required: true });

export { handler as GET, handler as POST, handler as DELETE };
