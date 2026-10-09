# ADR-005: Defer revisions and lineage behind feature flags

- Status: **Accepted** (from the elicited preferences)
- Date: 2026-09-30
- Decider: Andres
- Confidence: high

## Context

Revisions must not "blow up someone's folders with a bunch of previous versions." What Andres wants from the desktop: Obsidian-style auto-write/auto-save with in-app undo/redo that lives for the session only — not persisted across close/reopen. Revisions and the lineage graph can be dropped from desktop v1 if that avoids web/desktop divergence.

## Options considered

- **Flags, never branches** (chosen): one codebase, features hidden per product.
- **Long-lived branch without the features.** Rejected: guarantees divergence.
- **Ship revisions as version files in deck folders.** Rejected: violates the no-clutter preference.

## Decision

Desktop v1 ships **no revision history and no lineage graph**. Saving is automatic and continuous; undo/redo is session-scoped. Both features hide behind flags:

- `ELEF_ENABLE_REVISIONS`
- `ELEF_ENABLE_LINEAGE`

## Consequences

- The web app keeps revisions and lineage; the flags keep the codebases from diverging while desktop v1 ships without them.
- When revisions return (post-v1) they must honor the no-clutter rule: version data lives in the SQLite cache or a single sidecar, never as version files inside deck folders.
- Both are labeled experimental/deferred in UI copy and docs until shipped.
- **Flag hygiene:** each flag has an entry in the register in [delivery-plan.md](../delivery-plan.md) with a removal condition; CI compares live flags to that register.
- **Known cost:** with session-only undo, an accidental large deletion followed by closing the app cannot be recovered. Desktop v1 has no durable recovery snapshot; any future safety net must honor the no-clutter rule.

## Revisit when

Revisions are scheduled post-v1, or a durable recovery design is adopted.

### Documentation amendment — 2026-10-07

The removed open-questions draft was replaced with the current recovery limitation and revisit trigger above. The feature decision is unchanged.
