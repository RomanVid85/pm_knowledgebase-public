# Verification Workflow

This document defines the two-person verification rule for business rules in the `rules` table. This is a hard requirement, not a guideline.

## The rule

A business rule in the `rules` table cannot be marked `status='active'` unless:

1. It was extracted by one person (or AI — see below), AND
2. It was verified by a *different* person who is NOT the topic owner, AND
3. The verifier has role `SME`, `PM`, or `admin` (the two-person and topic-owner constraints still apply regardless of role; admin is not a privilege override)

This is enforced in BOTH the database (via a CHECK constraint for the same-row parts plus a BEFORE INSERT/UPDATE trigger for the cross-table topic-owner check, since Postgres forbids subqueries in CHECK) AND the application layer (via role-based access control in the UI). Defense in depth.

## Why

Rules surfaced via MCP become guardrails for engineers. A subtly wrong rule is worse than no rule — engineers trust the system and build against it. Real-world examples of why this matters:

- "Rate limit is 100 requests/second" when it's actually 100 requests/minute
- "Field X is required when status is 'active'" when it's only required during creation
- "API supports webhooks for record updates" when it actually only supports polling

Catching these at verification time is cheap. Catching them in production is expensive.

## Who can verify

The database enforcement is in two parts because Postgres CHECK can't reference other tables:

**CHECK constraint** (same-row only):

```sql
CHECK (
  verified_by IS NULL
  OR (
    (extracted_by IS NULL OR verified_by != extracted_by)
    AND
    (extracted_by_ai_job_invoker IS NULL OR verified_by != extracted_by_ai_job_invoker)
  )
)
```

**Trigger** (cross-table topic-owner check), `BEFORE INSERT OR UPDATE OF verified_by, topic_id ON rules`: looks up the topic's `owner_user_id` and raises `check_violation` if it matches `verified_by`. Implementation in `supabase/migrations/0003_compiled.sql` as `enforce_rules_verifier_not_topic_owner()`.

The application layer additionally enforces:

- Verifier's role must be `SME`, `PM`, or `admin` (engineers and viewers cannot verify)
- Verifier must be a different human than the extractor
- Verifier cannot be the topic owner for that rule's topic

## Why exclude the topic owner

Topic owners are accountable for their topic's knowledge being correct, so they have a natural incentive to rubber-stamp their own team's extractions. The two-person rule breaks this by requiring an *outside* perspective.

SMEs are often the ideal verifiers because they have domain expertise without being accountable for the topic's compiled output.

## The lifecycle of a rule

```
┌─────────────────┐
│  draft          │  ← Created in UI but not yet submitted
└────┬────────────┘
     │
     ▼
┌─────────────────┐
│  pending_verification │  ← Extracted by AI or person, waiting for verifier
└────┬────────────┘
     │
     │  (verifier from SME/PM pool, not extractor, not topic owner)
     │
     ▼
┌─────────────────┐
│  active         │  ← Verified, exposed via MCP, shown in retrieval
└────┬────────────┘
     │
     │  (new evidence emerges, rule needs update)
     │
     ▼
┌─────────────────┐
│  superseded     │  ← New version exists, old stays for audit
└─────────────────┘

  OR

┌─────────────────┐
│  disputed       │  ← Someone challenged the rule, needs re-verification
└─────────────────┘
```

## UI requirements

The verification queue UI must:

1. Filter rules to only those the current user CAN verify (not theirs, not their topic's owner, has right role)
2. Show the source artifact clearly so the verifier can check against evidence
3. Require the verifier to either accept, reject, or modify the rule
4. Capture the verifier's reasoning in a notes field
5. Log the full verification action in an audit table

## What to do when verification stalls

Rules stuck in `pending_verification` for more than 14 days should:

1. Trigger a nudge notification to available verifiers
2. Appear on the topic owner's dashboard as aged items
3. Not be silently promoted — stalled verification is a signal, not a bug

## The MCP exposure rule

CRITICAL: MCP must only return rules with `status='active'` AND `human_verified=true`. Never return `pending_verification` rules to engineering agents. The whole point of verification is that engineers can trust what comes back from MCP.

### Both conditions required — not one

The MCP query MUST check both `status='active'` AND `human_verified=true` even though in correct operation these should always be true simultaneously for the same row. This is defense in depth, and it is intentional, not redundant.

**Why both checks matter:**

1. **Bugs in state transitions.** If a future code path sets `status='active'` without also setting `human_verified=true` (or vice versa), the single-condition check would leak unverified rules to engineers. The double check catches the divergence.
2. **Data import or backfill.** If rules are ever seeded or imported from another system, the two fields could be inconsistent. MCP's filter catches this.
3. **Manual database intervention.** An admin fixing a rule directly in the DB might change one flag and forget the other. MCP's filter still protects downstream consumers.

### Regression watch

If a future refactor proposes simplifying to a single condition — "these are always the same, let's just use `status='active'`" — REJECT IT. The single-condition simplification is a regression, not a cleanup. The justification must be written down here if the belt-and-suspenders is ever removed, which it shouldn't be.

Code enforcement:

```typescript
// In MCP tool handler
async function getRulesForTopic(topicId: string): Promise<Rule[]> {
  return supabase
    .from('rules')
    .select('*')
    .eq('topic_id', topicId)
    .eq('status', 'active')         // ← required
    .eq('human_verified', true)     // ← also required; do not remove
}
```

Add a unit test that specifically asserts BOTH conditions are present in the query:

```typescript
it('MCP rule query requires both status=active AND human_verified=true', () => {
  const query = buildMcpRuleQuery('some-topic-id')
  expect(query.filters).toContainEqual({ column: 'status', op: 'eq', value: 'active' })
  expect(query.filters).toContainEqual({ column: 'human_verified', op: 'eq', value: true })
})
```

If this test gets deleted or its assertions get relaxed, that's a red flag in code review.

## Edge cases

### AI-only extraction (no human extractor)

When a rule is extracted by a scheduled job with no human in the loop, `extracted_by` is `NULL` and `extracted_by_ai_job_id` is populated instead. This is the default case for bulk rule extraction after ingestion.

**The hidden hazard**: "verification by the AI's invoker" would violate the spirit of the two-person rule. If a PM kicks off an AI extraction job, they cannot be the verifier of rules that job produced — even though no human was the extractor. The PM effectively authored the extraction by initiating it.

**Required behavior:**

1. `extracted_by` is set to `NULL` (no human extractor)
2. `extracted_by_ai_job_id` references the Inngest job that produced the rule
3. `extracted_by_ai_job_invoker` captures the `user_id` of whoever triggered the job (even for scheduled jobs — capture the admin who set up the schedule)
4. The verification check constraint uses `extracted_by_ai_job_invoker` as the "extractor" for comparison purposes when `extracted_by IS NULL`

**DB enforcement** (split because Postgres CHECK can't reference other tables — see "Who can verify" above):

- Same-row CHECK on `rules`: verifier ≠ extracted_by (if any), ≠ extracted_by_ai_job_invoker (if any).
- BEFORE INSERT/UPDATE trigger on `rules` (`enforce_rules_verifier_not_topic_owner`): verifier ≠ topic owner.

**Schema columns required** (add to Phase 1 rules table migration):

```sql
extracted_by              uuid REFERENCES users(id),          -- NULL if AI-extracted
extracted_by_ai_job_id    text,                                -- Inngest function run ID
extracted_by_ai_job_invoker uuid REFERENCES users(id),        -- Who triggered the job
```

Exactly one of `extracted_by` and `extracted_by_ai_job_id` must be non-NULL. Add a CHECK constraint:

```sql
CHECK (
  (extracted_by IS NOT NULL AND extracted_by_ai_job_id IS NULL)
  OR
  (extracted_by IS NULL AND extracted_by_ai_job_id IS NOT NULL AND extracted_by_ai_job_invoker IS NOT NULL)
)
```

**App layer enforcement:**

When an AI extraction job starts, the app MUST capture the invoker:

```typescript
// When a PM manually triggers extraction
await inngest.send({
  name: 'extraction/requested',
  data: {
    artifactId,
    invokerUserId: currentUser.id,  // ← always captured
  },
})

// When a scheduled job runs, invoker is the admin who configured the schedule
// (captured at schedule-creation time, not at run time)
```

**Required test coverage:**

```typescript
describe('AI-extractor verification constraint', () => {
  it('rejects verification by the AI job invoker', async () => {
    const pmUser = await seedUser({ role: 'pm' })
    const rule = await seedAiExtractedRule({
      extracted_by_ai_job_invoker: pmUser.id,
    })
    
    await expect(
      verifyRule({ ruleId: rule.id, verifiedBy: pmUser.id })
    ).rejects.toThrow(/cannot be the AI job invoker/)
  })
  
  it('allows verification by a different PM', async () => {
    const invokerPm = await seedUser({ role: 'pm' })
    const otherPm = await seedUser({ role: 'pm' })
    const rule = await seedAiExtractedRule({
      extracted_by_ai_job_invoker: invokerPm.id,
    })
    
    await expect(
      verifyRule({ ruleId: rule.id, verifiedBy: otherPm.id })
    ).resolves.toBeDefined()
  })
  
  it('rejects verification by the topic owner even when AI-extracted', async () => {
    const ownerPm = await seedUser({ role: 'pm' })
    const topic = await seedTopic({ owner_user_id: ownerPm.id })
    const rule = await seedAiExtractedRule({ topic_id: topic.id })
    
    await expect(
      verifyRule({ ruleId: rule.id, verifiedBy: ownerPm.id })
    ).rejects.toThrow(/cannot be the topic owner/)
  })
})
```

**Why this matters**: The two-person rule is the whole value proposition of the rules layer. If AI extraction creates a loophole where the PM who triggered the job can also verify its outputs, we've effectively made extraction a one-person operation for AI-driven rules — which is most rules in the system. That would be a silent correctness failure, not a visible bug.

### SME suggests a rule they also extracted

If an SME both extracts and wants to verify, they have to choose. Someone else has to verify. The system is explicit: extractor and verifier must be different people.

### Re-verification after dispute

When a rule is disputed, status goes to `disputed` and requires a new verification before returning to `active`. The original verifier cannot be the re-verifier (fresh eyes requirement).

### Topic owner change

If the topic owner changes while a rule is pending verification, the constraint check re-evaluates against the new owner. If the new owner was the extractor of the pending rule, the rule has to be re-extracted or verified by the old owner (unusual but possible).

## What Claude should implement

When building the verification workflow:

1. Add the DB check constraint explicitly (not just app logic)
2. Build the queue UI with the filtering logic baked in (not bolted on)
3. Surface verification status prominently on any view that shows rules
4. Never allow a code path where `status='active'` can be set without the check passing
5. Write tests specifically for the constraint violation cases:
   - Extractor tries to verify their own rule → should fail
   - Topic owner tries to verify a rule in their topic → should fail
   - Engineer (non-SME, non-PM) tries to verify → should fail
   - Valid SME verifier → should succeed

## Rule of thumb

If there's any code path where a rule becomes `active` without going through this verification, that's a bug, regardless of how convenient the shortcut seems. The verification is the whole value proposition of the rules table.
