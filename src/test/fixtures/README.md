# Test fixtures

Small **synthetic** files that exercise the ingest pipeline (parser → chunker
→ embedder → persister) without committing real vendor IP into the repo.

## What lives here

| File | Purpose |
|---|---|
| `training_guide.md` | Minimal markdown with ATX headings, used by `parser.test.ts` |
| `openapi.yaml` | Small OpenAPI 3.0 spec with two endpoints, parameters, a deprecated flag |
| `loadFixture.ts` | Test-side helper for reading fixtures by relative name |

## Rules

- **No real vendor docs.** Real vendor IP stays out of the repo regardless of
  whether the repo is private. Use synthetic prose that exercises the same
  code paths.
- **Small.** A few hundred words / a handful of endpoints is enough. Tests
  should run fast.
- **Stable.** Don't churn the fixtures unless the parser contract changes —
  every test that loads a fixture pins on its current shape.

## Adding a fixture

1. Drop the file here.
2. Update this README's table.
3. Reference it in a test via `loadFixture("yourfile.md")`.
