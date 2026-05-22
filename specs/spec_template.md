# Spec: [Feature Name]

**Status**: Not started | In progress | Complete | Blocked
**Target duration**: (estimate in Claude Code sessions)
**Owner**: (person accountable)

## Objective

One paragraph. What are we building and why? What problem does it solve?

## Success criteria

Specific, testable conditions that must ALL be true for this spec to be considered done:

1. ...
2. ...
3. ...

## Out of scope

What we're explicitly NOT doing in this spec. Prevents scope creep.

- ...
- ...

## Requirements

### R1: [Requirement category]

Specific functional requirements. Numbered so they're referenceable in tests and commits.

### R2: [Next category]

...

## Technical design

How we're building it. Architecture decisions, data flow, API contracts.

### Component: [Name]

- Location: `src/path/to/component`
- Responsibility: ...
- Interface: ...

### Data flow

```
User action → Component A → Service B → DB
```

### Key decisions

- Decision 1: We chose X over Y because...
- Decision 2: ...

## Test plan

### Unit tests

- What gets tested at the pure-function level

### Integration tests

- What gets tested against real DB / external APIs

### E2E tests (if applicable)

- Critical user flows to verify

### Manual verification

- Smoke checks to do before declaring done

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| ... | ... |

## Open questions

Questions that need resolution before or during implementation. Update as they're resolved.

- [ ] Question: ...
- [x] Resolved: ... → Answer: ...

## Dependencies

Other specs or external factors this depends on:

- Blocks on: (spec name or external thing)
- Blocked by: ...

## Hand-off criteria

When this spec is done, what happens next?

---

## Notes for Claude

When implementing this spec:
- Read related `agent_docs/` before starting
- Write failing tests first for the requirements
- Commit per completed requirement
- Update this spec's status when work begins and completes
- If requirements change during implementation, update this spec AND log in PLAN.md's decisions section
