# ADR-001: Folders on disk as the source of truth

- Status: **Accepted** (from the elicited preferences)
- Date: 2026-09-30
- Decider: Andres
- Confidence: high

## Context

Andres wants to own his data the Obsidian way: a deck is a folder with Markdown and images, portable, human-readable, editable in any editor. No database server — Postgres is out. SQLite is acceptable only as an invisible, rebuildable cache.

## Options considered

- **Folders canonical, derived cache optional** (chosen). Matches the ownership preference; survives any tool change.
- **Embedded database canonical (SQLite).** Simpler queries and transactions, but the data is no longer plain files and external editing breaks.
- **Hybrid with two sources of truth.** Rejected: guarantees drift.

## Decision

Deck folders on disk are the canonical store. Everything else (SQLite cache, `.elef` exports) is derived and rebuildable from folders.

## Consequences

- The storage seam is specified in [data-format.md](../data-format.md): folder layout, source-file rule, `elef.json` manifest, `.elef` zip format, case and Unicode rules.
- The backend must handle external edits (rescan/refresh, last-write-wins in v1). *Amended 2026-10-01: superseded by [ADR-008](008-safe-writes-and-conflict-detection.md) — external edits are detected and never silently overwritten.*
- A cache, when it exists, must be provably rebuildable: "delete it and the app still works" is a release-gate test. The cache itself is deferred until it has a consumer; see the [architecture map](../../architecture.md).
- Moving decks between devices is folder copy or `.elef` file — no sync service in v1.

## Revisit when

Search or a substantially larger library makes folder scans miss the measured performance targets.

### Documentation amendment — 2026-10-07

The architecture reference now points to the consolidated repository architecture guide. The superseded draft requirements link was removed; the source-of-truth decision is unchanged.
