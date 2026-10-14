# ADR-005: Defer revisions and lineage behind feature flags

Reach for when: touching revisions, lineage, the desktop flags, or save/undo scope.

- Status: Accepted
- Date: 2026-09-30
- Decider: Andres

## Context

Revisions must not clutter work folders with previous versions. Desktop v1 wants Obsidian-style auto-save with session-scoped undo/redo only, and may drop revisions and the lineage graph to avoid web/desktop divergence.

## Options considered

- Flags, never branches (chosen): one codebase, features hidden per product.
- Long-lived branch without the features: rejected, guarantees divergence.
- Ship revisions as version files in work folders: rejected, violates the no-clutter rule.

## Decision

Desktop v1 ships no revision history and no lineage graph. Both hide behind `ELEF_ENABLE_REVISIONS` and `ELEF_ENABLE_LINEAGE`, registered in [feature-flags.md](../feature-flags.md) with removal conditions; CI compares live flags to that register.

## Consequences

- When revisions return post-v1, version data lives in the SQLite cache or a single sidecar, never as version files inside work folders.
- Known cost: an accidental large deletion followed by closing the app cannot be recovered; v1 has no durable recovery snapshot, and any future safety net must honor the no-clutter rule.
- Both stay labeled experimental/deferred in UI copy and docs until shipped.

## Revisit when

Revisions are scheduled post-v1, or a durable recovery design is adopted.
