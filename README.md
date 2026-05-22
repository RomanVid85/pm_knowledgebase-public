# PM Knowledge Base

A team context layer for product managers. Captures source documentation, compiles AI-assisted topic pages, exposes structured business rules to engineers via MCP, and preserves contradictions rather than smoothing them over.

> **About this repo:** this is a vendor-agnostic starter scaffold. The architecture, data model, and authority/verification rules are the substance; pick a pilot domain that fits your team and grow the topic taxonomy from there.

## Architecture

Four-layer knowledge system:

1. **Raw source library** — original documents, PDFs, API specs
2. **Structured index** — embeddings + authority-weighted retrieval + topic graph
3. **Compiled pages** — AI-generated "current understanding" wiki
4. **Decisions & contradictions** — organizational memory

See `agent_docs/architecture.md` for detailed design.

## Tech stack

- **Frontend/API:** Next.js 15 (App Router) on Vercel, TypeScript strict
- **Database:** Supabase (Postgres 17 + pgvector + Auth + Storage)
- **Embeddings:** Voyage AI (`voyage-4-large`, 1024 dims)
- **PDF/Word ingestion:** LlamaParse v2
- **Background jobs:** Inngest
- **LLM:** Claude (Anthropic API)
- **MCP server:** Vercel Functions Node.js runtime

See `agent_docs/tech_stack.md` for versions and rationale.

## Local development setup

### Prerequisites

- Node 20+ and npm 10+
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started): `brew install supabase/tap/supabase`
- Docker Desktop (running) — Supabase local stack runs in containers

### First-time setup

```bash
# Clone (replace <your-username> with your GitHub user/org)
git clone git@github.com:<your-username>/pm-knowledge-base.git
cd pm-knowledge-base

# Install deps
npm install

# Start the local Supabase stack (Postgres, Auth, Storage, Studio)
supabase start

# Apply migrations + seed (creates the schema plus demo users and demo topics)
supabase db reset --local

# Capture local env values into .env.local
cp .env.example .env.local
supabase status -o env | grep -E "^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)" \
  | sed 's/^API_URL/NEXT_PUBLIC_SUPABASE_URL/' \
  | sed 's/^ANON_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY/' \
  | sed 's/^SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY/' >> .env.local
# (Or open `supabase status` and paste API_URL, ANON_KEY, SERVICE_ROLE_KEY into .env.local manually.)
```

You will also need API keys for the third-party services in `.env.example`: Anthropic, Voyage AI, LlamaParse (LlamaCloud), and Inngest. See the inline comments in `.env.example` for the dashboard URLs.

### Run the app

**Quickest — one-click launcher:** double-click `scripts/dev.command` in Finder. Starts local Supabase (if not already running), Next.js (port 3001), and the Inngest dev server (port 8288) in one terminal window. Close the window to stop everything.

**Or via terminal:**
```bash
npm run dev:all
# → Next.js:           http://localhost:3001
# → Inngest dashboard: http://localhost:8288
```

`npm run dev` alone starts only Next.js (no Inngest). Port 3001 is the default to avoid the common Docker collision on 3000.

Visit the URL — you'll be redirected to `/login`. For local development, create a user via local Supabase Studio Auth tab (http://127.0.0.1:54323 → Authentication → Add user) and sign in with those credentials. Public self-signup is disabled by default — adjust the policy and the login UI if your deployment needs open sign-up.

### Verify the setup

- **Supabase Studio:** http://127.0.0.1:54323 — Table Editor should show seeded users and topics.
- **Tests:** `npm run test`
- **Type-check + lint:** `npm run typecheck && npm run lint`
- **Production build:** `npm run build`

### Type generation (after schema changes)

```bash
supabase gen types typescript --local > src/types/supabase.ts
```

Commit the regenerated `src/types/supabase.ts` so CI and other devs see the same shape.

## Cloud deployment (Vercel + Supabase Cloud)

1. Create a Supabase Cloud project; capture URL, publishable (anon) key, and service-role secret.
2. `supabase login`, `supabase link --project-ref <ref>`, `supabase db push` to apply migrations to Cloud.
3. Apply `supabase/seed.sql` data via the REST API or psql against the Cloud DB. **Do not** run `supabase db reset --linked` after the first deploy — it will wipe rows that were created by the auth trigger.
4. Push the repo to GitHub, import on Vercel, set the env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus any LLM / ingestion / Inngest keys you use) for Production + Preview + Development, deploy.

## Working with Claude Code

This project is structured for use with Claude Code. Key context files:

- `CLAUDE.md` — entry point loaded by Claude on every session
- `PLAN.md` — phased execution plan (you populate as you build)
- `DECISIONS.md` — architectural decisions and what you deliberately deferred
- `DEFERRED.md` — tools/capabilities intentionally out of scope right now
- `agent_docs/` — detailed reference (architecture, schema, authority model, verification workflow)
- `specs/` — per-phase specs (start from `specs/spec_template.md`)
- `.claude/skills/` — auto-invoked skills (authority tagging, OpenAPI ingest, rule extraction)
- `.claude/agents/` — specialized subagents (`schema-designer`, `ingestion-builder`)

To start a session:
```bash
cd pm-knowledge-base
claude
```

## Project structure

```
pm-knowledge-base/
├── CLAUDE.md                      # Claude Code entry point
├── README.md                      # This file
├── PLAN.md                        # Phased execution plan
├── DECISIONS.md                   # Architectural decisions (cross-phase)
├── DEFERRED.md                    # Out-of-scope-for-now items
├── .env.example                   # Env-var template (.env.local is gitignored)
│
├── agent_docs/                    # Reference docs (progressive disclosure)
│   ├── architecture.md
│   ├── data_model.md
│   ├── tech_stack.md
│   ├── authority_model.md
│   ├── verification_workflow.md
│   └── coding_conventions.md
│
├── specs/                         # Per-phase specs
│   └── spec_template.md
│
├── .claude/                       # Claude Code config
│   ├── skills/                    # Auto-invoked
│   └── agents/                    # Specialized subagents
│
├── supabase/
│   ├── config.toml                # Local stack config (Postgres 17)
│   ├── migrations/                # 0001 → 0017
│   └── seed.sql                   # Demo users + demo topics (LOCAL only — see file header)
│
└── src/
    ├── app/                       # Next.js App Router
    ├── lib/                       # Shared utilities (Supabase, Voyage, LlamaParse, Claude, retrieval, compilation, ingest)
    ├── inngest/                   # Background job functions
    ├── components/                # React components
    ├── types/                     # Generated DB types + shared domain types
    └── middleware.ts              # Next.js middleware → updateSession
```

## Contributing

1. Read `agent_docs/coding_conventions.md`
2. Open `PLAN.md` and figure out what phase you're in
3. Branch from `main`: `git checkout -b feat/task-description`
4. Tests first (TDD) — see `agent_docs/coding_conventions.md` "Testing discipline"
5. Atomic commits (one PLAN.md task = one commit)
6. Run `npm run typecheck && npm run lint && npm run test` before pushing
7. Open a PR; rules-affecting changes always require review

## License

MIT.
