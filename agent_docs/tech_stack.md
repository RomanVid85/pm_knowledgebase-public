# Tech Stack

Every choice here has a rationale. If you're considering changing one, read the "why" before you do.

## Frontend / API

**Next.js 15+ with App Router**
- TypeScript strict mode
- Server Components by default, Client Components only when interactivity requires
- Deployed to Vercel with Fluid Compute enabled
- Why: best developer experience for a React stack, first-class MCP support, Vercel hosting is simple

## Database & Auth

**Supabase**
- Postgres 15+ with pgvector extension
- Supabase Auth for user authentication
- Supabase Storage for raw document binaries
- Row-Level Security (RLS) enabled from day one
- Why: collapses four services (DB, vector, storage, auth) into one vendor; fastest path to working V1

**Trade-off accepted**: Vendor lock-in. Migration later would be painful. Worth it for V1 speed.

## Embeddings

**Voyage AI — voyage-4-large**
- 1024 dimensions (Matryoshka shortening; ~0.3% quality cost for ~50% storage savings)
- Input type discriminator: `document` for indexing, `query` for search
- Why: Anthropic's officially recommended embedding provider; 14% retrieval improvement over OpenAI text-embedding-3-large; shared embedding space across voyage-4 family lets us switch to cheaper models for queries later without re-indexing

**Free tier**: 200M tokens. Comfortably covers a single-domain V1 pilot.

**Post-V1 consideration**: Evaluate `voyage-context-3` (contextualized chunk embeddings) against voyage-4-large baseline for dense technical docs.

## PDF Ingestion

**LlamaParse v2 with Auto Mode**
- Default tier: "Cost Effective"
- Auto Mode upgrades to premium parsing on pages with tables or images
- Webhook-based async processing
- 10K free credits per month
- Why: handles heterogeneous vendor content (prose + tables + images) without paying premium on every page; production-proven for complex PDFs

**Integration pattern**: Inngest kicks off parse → receives webhook → downstream chunking/embedding

**Cost guardrail**: Track credits per artifact in `ingest_jobs.steps_completed` so we notice if any doc type consumes more than expected.

## Background Jobs

**Inngest**
- Triggered via Next.js API routes
- Hosted on Inngest Cloud
- Why: native Next.js integration, better observability than a cron + queue setup, handles retries and failure modes natively

**Alternative considered**: n8n. Rejected because Inngest integrates more cleanly into the Next.js app codebase.

## LLM for Synthesis

**Claude via Anthropic API**
- Opus 4.7 for complex synthesis (topic page compilation, contradiction detection)
- Haiku 4.5 for lighter tasks (extraction classification, simple tagging)
- Via official Anthropic SDK
- Why: reasoning quality for contradiction detection and topic page compilation matters more than cost at V1 volumes

**Budget model**: Start with Opus everywhere, downgrade tasks to Haiku only where quality holds.

## MCP Server

**Vercel Functions — Node.js Runtime (NOT Edge)**
- `mcp-handler` package
- Streamable HTTP transport only (SSE being deprecated mid-2026)
- `withMcpAuth()` wrapper integrated with Supabase Auth
- Firewall bypass rule on `/api/mcp` path
- Why: Vercel's official path, used by Zapier/Vapi/Composio in production

**Critical gotcha**: Do NOT use Edge Runtime. `StreamableHTTPServerTransport` requires Node.js APIs that Edge doesn't support.

**Fluid Compute enabled** for ~250ms cold starts and ~90% cost savings on irregular AI workloads.

## Package Versions (lock these)

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "@supabase/supabase-js": "^2.45.0",
    "@supabase/ssr": "^0.5.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "voyageai": "^0.0.3",
    "llama-cloud-services": "^0.1.0",
    "inngest": "^3.27.0",
    "mcp-handler": "^1.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0",
    "tailwindcss": "^4.0.0"
  }
}
```

Run `npm outdated` quarterly. Update Claude API and voyageai packages whenever new models ship.

## Dev Tools

- **TypeScript**: strict mode, no `any` outside of documented third-party boundaries
- **ESLint**: with `@typescript-eslint/strict` config
- **Prettier**: default config, no fighting over style
- **Vitest**: for unit and integration tests
- **Playwright**: for end-to-end tests (added in Phase 4+)
- **Supabase CLI**: for local DB dev and type generation

## Infrastructure

- **Vercel**: for Next.js app and MCP server
- **Supabase Cloud**: for Postgres, Auth, Storage (production)
- **Inngest Cloud**: for background jobs
- **LlamaParse Cloud**: for PDF ingestion
- **Voyage AI API**: for embeddings
- **Anthropic API**: for Claude

All secrets in Vercel environment variables or Supabase Vault. Never commit secrets.

## Monitoring (Phase 5+)

- Vercel Analytics for frontend
- Inngest dashboard for job success rates
- Supabase logs for DB queries
- Custom metrics in a `system_metrics` table for things like rules-in-verification-aging

## Why NOT these alternatives

- **Pinecone / Weaviate for vector DB**: pgvector is good enough at V1 scale and keeps everything in Postgres. Introducing a separate vector DB doubles ops surface area.
- **LangChain / LlamaIndex as orchestration**: direct Anthropic SDK + custom code is more debuggable. Framework abstractions obscure what's happening.
- **tRPC or GraphQL**: Next.js Server Actions and API routes are enough. Don't add layers unless the pain is real.
- **Prisma or Drizzle ORM**: Supabase's typed client is sufficient. Adding an ORM is premature.
- **Separate Node service for MCP**: Vercel Functions with Node runtime handles this without the ops overhead of another service.

## Upgrade discipline

When a dependency ships a major version:
1. Read the changelog carefully
2. Create a branch for the upgrade
3. Run the full test suite
4. Deploy to preview
5. Only merge after manual smoke test

Don't auto-update major versions. Claude should flag when it sees a major version difference during routine work.
