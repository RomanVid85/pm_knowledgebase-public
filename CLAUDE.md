# PM Knowledge Base

## What this project is

A team context layer for product managers. It captures source documentation (API specs, user guides, sample payloads, briefs, field notes), compiles AI-assisted topic pages, exposes structured business rules to engineers via MCP, and preserves contradictions rather than smoothing them over.

It is vendor-agnostic by design. Pick a pilot domain that fits your team and grow the taxonomy from there.

## Why it exists

- PMs rebuild context from scratch every brief. Engineers ask the same integration questions repeatedly. Source documentation updates are silent. Tribal knowledge dies with turnover.
- Existing wikis go stale and smooth over disagreements. We need a system that preserves source authority, surfaces contradictions, and supports agentic development workflows.

## How it's built

- **Frontend/API**: Next.js 15 on Vercel (App Router, TypeScript, Server Components where possible)
- **Database**: Supabase (Postgres + pgvector + Auth + Storage)
- **Embeddings**: Voyage AI (voyage-4-large, 1024 dimensions)
- **PDF ingestion**: LlamaParse v2 (Auto Mode)
- **Background jobs**: Inngest
- **LLM for synthesis/extraction**: Claude via Anthropic API
- **MCP server**: Hosted on Vercel Functions with Node.js runtime (NOT Edge), using `mcp-handler` package

See @agent_docs/tech_stack.md for versions and rationale.

## Read these before starting work

- @PLAN.md — phased execution plan (current phase status lives here)
- @DECISIONS.md — architectural decisions made and deliberately deferred (cross-phase memory)
- @DEFERRED.md — tools and capabilities intentionally out of scope right now
- @agent_docs/architecture.md — four-layer system design
- @agent_docs/data_model.md — full schema reference
- @agent_docs/authority_model.md — source_authority rules (CRITICAL — drives retrieval)
- @agent_docs/verification_workflow.md — two-person rule for business rules
- @agent_docs/coding_conventions.md — code style and testing discipline

## Workflow rules

- **Spec before code.** Non-trivial features get a spec in `specs/` before implementation. Use the AskUserQuestion interview pattern when scope is ambiguous.
- **Tests first.** Write failing tests before implementation. The tests are the contract.
- **Commit per task.** Each PLAN.md task completion = one commit with a descriptive message.
- **Stop on ambiguity.** If requirements are unclear, stop and ask rather than guessing.
- **Never silently drift from PLAN.md.** If a task's scope needs to change, update PLAN.md explicitly and flag it.
- **Maintain DECISIONS.md and DEFERRED.md.** Whenever the conversation produces a real decision (made or explicitly deferred), record it in `DECISIONS.md`. When a tool/capability is punted, add it to `DEFERRED.md`. Don't let these decay — they're cross-phase memory.

## Code style

- TypeScript strict mode. No `any` types except at well-documented boundaries with third-party APIs.
- Named exports preferred over default exports.
- Zod schemas for all runtime validation (API inputs, LLM outputs, DB row parsing).
- Error handling via Result types or explicit throw-and-catch at boundaries — never swallow errors.
- Server components by default in Next.js; client components only when interactivity requires it.
- Database access via Supabase client with typed schemas (generate types via `supabase gen types`).

## What Claude should never do

- **Never hard-delete artifacts.** Always soft-delete via `status` field. Retention is indefinite.
- **Never bypass the two-person verification rule for `rules` table.** If code lets a PM verify their own extractions, that's a bug.
- **Never assume source documents are canonical without checking `source_authority`.** A Slack guess and a vendor's API spec are not the same kind of evidence.
- **Never smooth over contradictions.** If two sources disagree, create a contradiction record. Don't pick a winner silently.
- **Never reduce the graph to implicit relationships.** Explicit `topic_relationships` edges matter for retrieval quality.
- **Never put secrets in code.** All API keys go in `.env.local` (gitignored) or Vercel env vars.

## Tooling expectations

- Run `npm run typecheck` after making type changes. Don't commit if it fails.
- Run `npm run test` for the affected area. Full suite only pre-commit.
- Use `supabase db reset --local` when schema changes during dev.
- Use `supabase gen types typescript` after schema changes to regenerate TS types.

## When you're confused

Ask the human driving the session. Don't guess. This project's value depends on correctness in the `source_authority` tagging, verification workflow, and contradiction detection. Guessing in those areas creates invisible correctness bugs that are expensive to find later.
