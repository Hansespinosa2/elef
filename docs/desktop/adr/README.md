# Architecture decision records

Reach for when: asking why a load-bearing desktop choice was made, whether its acceptance evidence is complete, or when a choice may be revisited.

These records capture why load-bearing choices were made and whether their acceptance evidence is complete. Current implementation lives in the [architecture](../../architecture.md) and [development](../../development.md) guides; technical contracts live in [data-format.md](../data-format.md) and the [transport adapter](../../../apps/desktop/frontend/src/transport-adapter.js) header. Records were rewritten in place for the 2026-10-11 docs cull with owner approval; decisions, rationale, and acceptance evidence are unchanged.

| ADR | Decision | Status | Remaining acceptance evidence |
|---|---|---|---|
| [001](001-folders-as-source-of-truth.md) | Folders on disk via a file backend, no bundled Rails | Accepted | — |
| [002](002-tauri-shell.md) | Tauri shell with signed updates via GitHub Releases | Proposed | Owner-device install acceptance in [#128](https://github.com/Hansespinosa2/elef/issues/128); production key ceremony in [#129](https://github.com/Hansespinosa2/elef/issues/129) |
| [005](005-defer-revisions-lineage.md) | Defer desktop revisions and lineage | Accepted | — |
| [006](006-security-model.md) | Layered desktop security | Accepted | — |
| [007](007-single-shared-js-renderer.md) | Shared JavaScript renderer | Accepted | — |
| [008](008-safe-writes-and-conflict-detection.md) | Atomic source writes and conflict handling | Accepted | — |
| [010](010-portable-document-links.md) | Portable document-link metadata | Accepted | — |
| [011](011-neutral-editor-runtime-package.md) | Shared editor shell in a neutral package | Accepted | — |
| [012](012-deck-to-work-rename.md) | Retired container term (`deck`) replaced by Work and WorkFolder | Accepted | — |

Accepted decisions are stable records. Change one with a dated amendment or a new ADR that supersedes it; do not erase its history. Proposed records may be updated as evidence arrives. ADRs explain decisions rather than serve as implementation plans.

## Retired

- ADR-003 (file backend, no bundled Rails) merged into ADR-001; ADR-009 (signed update channel) merged into ADR-002. Numbers stay retired so existing references keep their meaning.
- ADR-004 (Rails `app/` owns shareable UI) retired as superseded by ADR-011; its arrangement no longer exists in the tree.

## Open acceptance work

- [#126 — shared renderer, library, and editor parity](https://github.com/Hansespinosa2/elef/issues/126): records the remaining gaps. In particular, web card Preview opens a saved read-only view while desktop opens the editable visual editor; web Present publishes and presents a release while desktop presents the local draft; and desktop omits web-only fork actions while lineage stays deferred. The issue tracks remaining renderer comparisons, workflow coverage, and soak.
- [#128 — signed updates and real-device acceptance](https://github.com/Hansespinosa2/elef/issues/128): target-device performance and install checks, update failure recovery, explicit residual save-race acceptance, and week-long use.
- [#129 — updater key ceremony](https://github.com/Hansespinosa2/elef/issues/129): production signing setup, offline key backups, and draft release verification.
