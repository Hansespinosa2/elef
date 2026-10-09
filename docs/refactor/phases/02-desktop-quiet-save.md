# Phase 02 — Desktop quiet save

**Goal:** implement the constitution's desktop continuous-save behavior directly on `WorkSession` and `crates/local-store`; web behavior is unchanged.

## Frozen behavior

- no normal Save button/status/unsaved marker/leave warning;
- schedule save 2.0 s after last edit; acceptance ceiling 2.5 s; immediate flush on work switch, blur, Cmd/Ctrl+S and quit; Cmd/Ctrl+S is silent;
- write failure is non-modal and retries automatically; quit warns only if final flush fails;
- clean external change reloads silently; dirty non-overlap uses deterministic three-way merge from last persisted ancestor after snapshots of both sides; overlap keeps local and snapshots external;
- suspicious external change is never silently accepted when external text is empty while local is non-empty, or local is ≥200 characters and external is <50% of local character length;
- snapshot before merge/overwrite, at least every 5 minutes of active changed editing, retain 7 days, snapshot current text before restore;
- watcher covers direct writes, git-style replacement and atomic-replace/sync-tool behavior;
- all writes remain atomic and stale writers never silently win.

Persistence/watch/snapshot/merge mechanics live in `local-store`; session/user-facing policy lives behind `WorkSession` in client.

## PASS criteria

- **P02-01** no normal desktop Save button/status/unsaved marker/leave warning exists.
- **P02-02** changed text reaches disk within 2.5 s after last edit; switch/blur/Cmd-or-Ctrl+S/quit flush immediately.
- **P02-03** write failure is non-modal, retries automatically, and quit warns only if final flush fails.
- **P02-04** clean external edit reloads silently.
- **P02-05** dirty, non-overlapping external edit merges deterministically from last persisted ancestor after snapshots of both sides.
- **P02-06** overlapping edits preserve local text on disk/editor and preserve external text in history with non-modal recovery action.
- **P02-07** suspicious-change thresholds are exactly those in the constitution and boundary tests cover just-below/at/just-above cases.
- **P02-08** snapshot cadence/retention/restore-before-restore rules hold.
- **P02-09** watcher scenarios cover direct edit, git-style replacement and atomic replacement while idle and typing.
- **P02-10** kill/fault matrix proves no partial write or silent text loss during save, snapshot or merge.
- **P02-11** shared editor/session code contains no desktop/web branch; desktop policy is injected through the session factory.
- **P02-12** web save scenarios match baseline behavior.
