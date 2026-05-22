# Coding Conventions

## TypeScript

**Strict mode, always.** `tsconfig.json` with `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`.

**No `any` outside documented third-party boundaries.** When wrapping an external API that returns `unknown`, validate with Zod at the boundary and return typed data.

**Named exports preferred over default.** Makes refactoring and grep easier.

```typescript
// Good
export function ingestArtifact(input: IngestInput): Promise<Artifact> { ... }

// Avoid
export default function ingestArtifact(input) { ... }
```

**Type imports separated from value imports:**
```typescript
import type { Artifact, SourceAuthority } from '@/types/domain'
import { supabase } from '@/lib/supabase'
```

## Validation

**Zod for all runtime validation.** API inputs, LLM outputs, DB rows that need narrowing, environment variables at boot.

```typescript
const RuleExtractionSchema = z.object({
  rule_key: z.string().regex(/^[a-z_.]+$/),
  rule_type: z.enum(['validation', 'capability', 'constraint', 'workflow', 'data_requirement']),
  value: z.record(z.any()),
  conditions: z.record(z.any()).optional(),
  confidence: z.number().min(0).max(1),
})

type RuleExtraction = z.infer<typeof RuleExtractionSchema>
```

**Validate env vars at boot.** Crash loudly if a required env var is missing, don't let the app start in a broken state.

## Error handling

**Throw at boundaries, catch at integrators.** Don't sprinkle try/catch through deep call stacks. Let errors propagate until they hit a layer that can handle them meaningfully (API route, Inngest function, UI error boundary).

**Never swallow errors silently.** Either handle it explicitly (with a comment explaining why) or let it propagate.

```typescript
// Bad
try {
  await voyage.embed(texts)
} catch (e) {
  // ignore
}

// Good
try {
  return await voyage.embed(texts)
} catch (e) {
  if (isRateLimitError(e)) {
    // Inngest will retry with backoff
    throw new RetriableError('Voyage rate limit hit', { cause: e })
  }
  throw new FatalError('Voyage embedding failed', { cause: e })
}
```

**Custom error classes for control flow.** Use classes like `RetriableError`, `FatalError`, `ValidationError` so handlers can route based on type.

## Database access

**Typed Supabase client.** Regenerate types after schema changes:
```bash
supabase gen types typescript --local > src/types/supabase.ts
```

**Never use raw SQL in app code** unless there's a real reason (recursive CTE for graph traversal, vector similarity search). Prefer the typed client.

**Foreign keys never CASCADE on delete.** We never hard-delete. `ON DELETE RESTRICT` is the default. If you see a `CASCADE`, flag it as a bug.

**RLS on every table from day one.** Even if V1 is single-tenant, policies are in place so expansion is clean.

## File organization

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # API routes (MCP, webhooks)
│   ├── (authenticated)/    # Routes requiring auth
│   └── (public)/           # Public routes (none in V1)
├── components/             # React components
│   ├── ui/                 # Primitive UI components
│   └── features/           # Feature-specific components
├── lib/                    # Shared utilities
│   ├── supabase/           # Supabase client helpers
│   ├── voyage/             # Voyage AI client
│   ├── llamaparse/         # LlamaParse client
│   ├── claude/             # Anthropic API client
│   └── retrieval/          # Search and ranking logic
├── types/                  # Shared types
│   ├── supabase.ts         # Generated from DB schema
│   └── domain.ts           # Business domain types
└── inngest/                # Inngest functions
    ├── functions/
    └── client.ts
```

## Testing discipline

**Write tests before implementation (TDD).** Especially for anything involving the authority model, verification workflow, or retrieval ranking. Tests ARE the specification for correct behavior.

**Test categories:**
- Unit tests (Vitest): pure functions, validation schemas
- Integration tests (Vitest): against a local Supabase instance
- E2E tests (Playwright): critical user flows, added in Phase 4+

**One test file per source file.** `src/lib/retrieval/rank.ts` has `src/lib/retrieval/rank.test.ts` alongside it.

**Test fixtures live in `src/test/fixtures/`.** Sample OpenAPI YAMLs, PDFs, and prose documents belong here for ingestion tests.

## LLM interaction patterns

**Structured outputs via JSON schema.** Don't parse free-text. Claude API supports tool use with Zod schemas for structured returns.

**Separate prompt templates from calling code.** Prompts live in `src/lib/claude/prompts/` as `.md` files loaded at runtime. This makes them reviewable and versionable.

**Log every LLM call.** Include input, output, model, tokens used. Enables quality analysis and cost tracking.

**Confidence scores on every LLM extraction.** The LLM should self-report confidence. If confidence is below a threshold, the extraction doesn't proceed to active status.

## Performance

**Chunk processing in batches.** When embedding many chunks, batch to Voyage's `embed` endpoint in groups of ~100 (respecting token limits).

**Cache embeddings.** If the same text is embedded twice, return from cache. `content_hash` column on chunks enables this.

**Pgvector queries use the ivfflat index.** Make sure `SET LOCAL ivfflat.probes = 10;` is set appropriately for the quality/speed tradeoff needed.

**Stream long LLM responses.** Topic page compilation can be long. Use streaming to show progress in UI.

## Security

**Secrets in env vars only.** Never commit. Never log. Never return in API responses.

**Supabase RLS over app-layer auth.** The database is the authority on who can read what. App-layer checks are defense in depth.

**Input validation at every API boundary.** Zod-validate every inbound request before doing anything with it.

**No SQL injection opportunities.** Typed client prevents most, but parameterize any raw SQL.

## Git conventions

**Conventional commits:**
```
feat: add topic graph traversal
fix: correct authority weight for vendor_reference
chore: bump voyageai to 0.0.4
docs: update authority model for sample payloads
test: add verification workflow edge cases
refactor: extract ranking logic from search function
```

**Commit per task.** Each PLAN.md task = one logical commit.

**Branch naming:** `feat/<short-description>`, `fix/<short-description>`, `phase-<N>/<task-id>`.

**Never commit to main directly.** Even for tiny changes, use a branch and PR.

## Code review discipline

Even when Claude Code is the primary implementer, a human (usually the PM driving the session) should review:

1. Anything touching `source_authority` values
2. Anything touching the verification check constraint
3. Any DDL change
4. Any prompt template change (these silently affect quality)
5. Any change to retrieval ranking

Claude should explicitly flag these categories when making changes and wait for human OK before merging.

## Documentation in code

**JSDoc for public functions.** Private helpers can rely on TypeScript types alone.

```typescript
/**
 * Calculates the final retrieval score using authority weighting,
 * recency decay, and graph distance. See agent_docs/authority_model.md.
 * 
 * @param chunk - The candidate chunk from semantic search
 * @param anchorTopicId - The topic the query is anchored to (for graph distance)
 * @returns Score in [0, 1] for ranking
 */
export function scoreChunk(chunk: Chunk, anchorTopicId: string): number { ... }
```

**ADRs for architecture decisions.** When making a non-obvious architectural choice, write it to `docs/adr/NNNN-title.md` so future Claude sessions and humans understand the reasoning.

## What Claude should never do

- Write code that bypasses the verification check constraint
- Auto-delete artifacts (always soft-delete via status)
- Use `ON DELETE CASCADE` on any foreign key
- Silently change `source_authority` during ingestion
- Skip writing tests "because the code is simple"
- Update PLAN.md tasks to "done" without verification they actually work
- Commit without running `npm run typecheck` first
