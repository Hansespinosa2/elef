# Architecture decision records

These records capture why load-bearing choices were made and whether their acceptance evidence is complete. Current implementation lives in the [architecture](../../architecture.md) and [development](../../development.md) guides; technical contracts live in the data-format, transport, and security docs.

| ADR | Decision | Status | Remaining acceptance evidence |
|---|---|---|---|
| [001](001-folders-as-source-of-truth.md) | Desktop deck folders are the source of truth | Accepted | — |
| [002](002-tauri-shell.md) | Tauri desktop shell | Proposed | Owner-device install acceptance in [#128](https://github.com/Hansespinosa2/elef/issues/128) |
| [003](003-file-backend-no-bundled-rails.md) | File-backed desktop backend | Proposed | Remaining parity evidence in [#126](https://github.com/Hansespinosa2/elef/issues/126) |
| [004](004-frontend-reuse-transport-adapter.md) | Shared web and desktop product frontend | Proposed | Supported shared flows in [#126](https://github.com/Hansespinosa2/elef/issues/126) |
| [005](005-defer-revisions-lineage.md) | Defer desktop revisions and lineage | Accepted | — |
| [006](006-security-model.md) | Layered desktop security | Accepted | — |
| [007](007-single-shared-js-renderer.md) | Shared JavaScript renderer | Proposed | Consumer, fixture, soak, and rollback-removal gates in [#126](https://github.com/Hansespinosa2/elef/issues/126) |
| [008](008-safe-writes-and-conflict-detection.md) | Atomic source writes and conflict handling | Accepted | — |
| [009](009-distribution-and-update-channel.md) | Signed desktop updates | Proposed | Device acceptance in [#128](https://github.com/Hansespinosa2/elef/issues/128); production key ceremony in [#129](https://github.com/Hansespinosa2/elef/issues/129) |
| [010](010-portable-document-links.md) | Portable document-link metadata | Accepted | — |

Accepted decisions are stable records. Change one with a dated amendment or a new ADR that supersedes it; do not erase its history. Proposed records may be updated as evidence arrives. ADRs explain decisions rather than serve as implementation plans.

## Open acceptance work

- [#126 — shared renderer, library, and editor parity](https://github.com/Hansespinosa2/elef/issues/126): records the remaining gaps. In particular, web card Preview opens a saved read-only view while desktop opens the editable visual editor; web Present publishes and presents a release while desktop presents the local draft; and desktop omits web-only fork actions while lineage stays deferred. The issue tracks remaining renderer comparisons, workflow coverage, soak, and Ruby rollback removal.
- [#128 — signed updates and real-device acceptance](https://github.com/Hansespinosa2/elef/issues/128): target-device performance and install checks, update failure recovery, explicit residual save-race acceptance, and week-long use.
- [#129 — updater key ceremony](https://github.com/Hansespinosa2/elef/issues/129): production signing setup, offline key backups, and draft release verification.
