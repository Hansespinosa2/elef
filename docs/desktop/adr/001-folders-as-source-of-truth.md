# ADR-001: Desktop persistence is user-owned folders via a file backend

Reach for when: touching desktop storage, discovery, manifests, archives, or the local-store boundary.

- Status: Accepted
- Date: 2026-09-30 (file-backend decision merged in 2026-10-11; decisions unchanged)
- Decider: Andres

## Context

Andres owns his data the Obsidian way: a work is a folder with Markdown and images, portable and editable in any editor. Desktop works must remain ordinary folders and work with no local server or database service.

## Options considered

- Folders canonical with an optional derived cache, read and written through a Rust file backend (chosen).
- Embedded database canonical (SQLite): simpler queries, but data stops being plain files and external editing breaks.
- Hybrid with two sources of truth, or a bundled Rails server: rejected, guarantees drift or replaces web persistence.

## Decision

Work folders on disk are the canonical store; SQLite is acceptable only as an invisible, rebuildable cache. Desktop uses Tauri commands backed by `local-store`, which has no Tauri dependency; it does not bundle Rails or a database server. Rails remains responsible for web persistence.

## Consequences

- The storage seam is specified in [data-format.md](../data-format.md): folder layout, source-file rule, `elef.json` manifest, `.elef` format, case and Unicode rules.
- External edits are detected and never silently overwritten ([ADR-008](008-safe-writes-and-conflict-detection.md)).
- A cache, when it exists, must be provably rebuildable: deleting it never breaks the app. The cache is deferred until it has a consumer.
- Moving works between devices is folder copy or a `.elef` file; no sync service in v1.
- File operations are testable without the UI or Tauri runtime; the architecture check enforces the `local-store` boundary.

## Revisit when

Search or library size makes folder scans miss measured performance targets, or a desktop feature cannot go through the file-backed command boundary.
