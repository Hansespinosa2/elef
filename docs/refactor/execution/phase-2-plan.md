# Phase 2 plan — Desktop quiet save

Status: FROZEN at 2026-10-07 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/02-desktop-quiet-save.md` (sha256 `93fa24de5b442039d1415f2e7c35b25c542779d6650750ad95907a02efb6d367`)
Phase base: `34d3ae80cefc58b3cf88b8eec1bad927f6666b4f`

## 1. Verified facts
| Fact | Evidence (file:line or command → result) |
|---|---|
| Shared save engine is `createSaveFlow` (650 ms default delay, backoff retry, conflict flow, injected timers) | `app/javascript/lib/save_flow.js:4-21` (RETRY_DELAYS, saveDelay 650, setTimer/clearTimer injection) |
| Desktop builds its flow in file_library_application with Tauri transport, no delay override (650 ms) | `app/javascript/lib/file_library_application.js:194-217`; no `saveDelay` key |
| Web builds its flow in autosave_controller (900 ms delay, Rails PATCH) | `app/javascript/controllers/autosave_controller.js:15,150-169,190` |
| `save_flow.js` has zero host branches | `grep __TAURI__\|isDesktop app/javascript/lib/*.js` → only `feature_flags.js` naming |
| Desktop boots Stimulus but loads a fixed controller list without dirty/autosave controllers | `app/javascript/lib/editor_runtime.js:28-44,77`; `controllers/index.js` is web importmap lazy-load |
| Save button/status/retry markup lives in the shared EDITOR_VIEW template; desktop assigns `save-state`/`retry-save` ids at render | `app/javascript/lib/editor_view.js:90-93,229-237`; button hidden via `config.showSubmit === false` |
| Desktop leave warning is `beforeunload` in the desktop-only file_library_application | `app/javascript/lib/file_library_application.js:1131-1135` |
| Desktop polls external changes every 2 s via `readSourceSnapshot` → `checkExternalChange` | `app/javascript/lib/file_library_application.js:1150-1172` |
| Menu Save (CmdOrCtrl+S) exists and flushes | `desktop/src-tauri/src/lib.rs:1108`; `file_library_application.js:1051` |
| No blur-triggered flush exists on desktop | `grep blur desktop/frontend/src/*.js` → no hits |
| Quit guard prevents close while dirty, flushes, stays open + non-modal error on failure | `desktop/frontend/src/close-flow.js:1-23`; `showError` is status+notice (`file_library_application.js:402-406`) |
| local-store has atomic `save_source` (temp+rename, fingerprint check, per-deck write lock, check-to-rename measurement) | `crates/local-store/src/lib.rs:686-782` |
| local-store has NO watch/merge/snapshot-history APIs (only `read_source_snapshot` for polling) | `grep pub fn` list; `grep snapshot\|merge\|watch` → only SourceSnapshot + tests |
| `notify` crate is not a dependency (not even transitive) | `grep 'name = "notify"' Cargo.lock` → no hits; registry reachable (`cargo fetch` downloads) |
| Kill matrix EXISTS for save: 4 points × 50 runs via `cfg(test)` fault hooks + child processes | `crates/local-store/src/lib.rs:3101-3175,2001-2023` |
| local-store discovery skips dot-dirs (snapshot home) | `crates/local-store/src/lib.rs:1240` (`starts_with(".")` → None) |
| Native confirm dialog helper exists for quit-fail warning | `confirm_native_action` in `desktop/src-tauri/src/lib.rs` (used by replace flow) |
| WorkSession contract shape: workId/kind/getText/applyLocalChange/replaceText/onExternalChange/onStatus/flush/dispose | `packages/contracts/src/session.ts:35-45` |
| `bin/check phase 2` is unimplemented (stub) | `bin/check` has `run_phase0`/`run_phase1` only; `phase N` → "not implemented in Phase 01" |
| Web save baseline tests: 7 system files + save_flow/autosave JS unit tests | `test/system/{documents,presentations,unified_workspace,vim_editor,media_pdf_export,mermaid_rendering,pptx_export}_test.rb`; `test/javascript/shared/save_flow.test.js`, `autosave_controller.test.mjs` |
| e2e asserts desktop `#save-state` text in 2+ places (must migrate to new UI) | `desktop/e2e/specs/desktop.spec.js:478,760` |

Open questions / unknowns (each is a blocker or has a resolution step): none. All Phase 02 design inputs are verified above; the two judgment calls (pull-drain watcher, in-memory ancestor) are decided in §5 with rollback triggers in §7.

## 2. Scope
In scope:
- local-store: file watcher (`notify`, debounced), `poll_file_events` drain API; deterministic line-based three-way `merge_sources(ancestor, local, external)`; `is_suspicious_external_change` with exact contract thresholds; snapshot history (`take_snapshot`/`list_snapshots`/`restore_snapshot` + 7-day prune) under library-root `.elef-history/`; in-memory last-persisted ancestor per open deck; fault-hook points for snapshot/merge kill coverage.
- Session factory: new shared module `app/javascript/lib/work_session.js` exporting `createWorkSession({ transport, policy })` implementing the contracts `WorkSession` surface over `createSaveFlow`; desktop quiet-save policy object defined in `desktop/frontend/src/` and injected through `startFileLibraryApplication` options (existing injection pattern).
- Desktop policy: 2.0 s schedule; immediate flush on work switch (exists), window blur (new listener), Cmd/Ctrl+S (exists, becomes silent), quit (close-flow change); automatic retry (exists in engine); quit warns via native confirm ONLY if final flush fails; clean external reload incl. suspicious-refusal with non-modal recovery; merge/snapshot cadence (5 min changed-editing timer calling snapshot API).
- Desktop chrome removal: render editor with `showSubmit: false`, do not assign/display save status + retry/dirty markers, remove `beforeunload` guard (all desktop-only paths; shared template keeps web markup).
- Tauri commands: `poll_file_events`, `take_snapshot`, `list_snapshots`, `restore_snapshot`, `merge_external_change` (thin, delegate to local-store); capability + e2e invoke allowlist updates.
- Tests: Rust unit (merge vectors, suspicious boundaries just-below/at/just-above, snapshot prune/restore, watcher replacement styles); kill-matrix extension (snapshot + merge points); JS unit (factory surface, policy timers with injected clocks, close-flow); desktop e2e quiet-save scenarios (new `specs/quiet-save.spec.js`, registered in `wdio.conf.js`); web baseline untouched.
- `bin/check phase 2` gate mirroring phase 1 (identity via shared snapshot helper with phase=2, quick, arch, fresh, stubs-still-nonzero, `phase-2-ci-evidence.json` with same required jobs + rails/tauri conformance sections); `run.mjs` unchanged except spec registration effects.
Non-goals (explicitly deferred to later phases):
- `client/` package or moving session code out of `app/javascript/lib` (Phases 03–09 own the migration; factory placement is documented as pre-migration).
- `work-model/`, `renderer/`, `spec/` changes; no new ElefHost ports (merge/snapshot/watch are desktop-local mechanics, not shared-client behavior — constitution §5 admission test fails by design).
- Any web behavior change (P02-12); web keeps autosave_controller + direct `createSaveFlow` untouched.
- Sync/collaboration/accounts, mobile, packaged-updater flow changes.

## 3. Ownership classification
| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| Watch/merge/snapshot/suspicious mechanics + fault hooks | `local-store` | Host-specific: local filesystem persistence engine (constitution §2.3, §4 local-store); web persists via database |
| `notify` dependency | `local-store` | Third-party dep, not an Elef package; justified by OS file events unimplementable in JS |
| `work_session.js` factory + `save_flow.js` extensions (merge hook, snapshot hook) | future `client/session`; current home `app/javascript/lib` | Shared: policy-injected, zero host branches; desktop policy supplied by desktop host, web keeps existing direct use |
| Desktop quiet-save policy object | desktop host (`desktop/frontend/src`, injected via app options) | Host-specific: desktop-only UX policy + Tauri transport |
| Save chrome removal / `showSubmit: false` / blur listener / close-flow change | desktop host + shared template config | Shared template gains config-only options (no host branches); desktop passes quiet config |
| Tauri commands (`poll_file_events`, snapshot ops, merge op) | desktop host adapter | Host-specific: IPC surface over local-store |
| Kill-matrix extension | `local-store` tests | Same owner as existing matrix |
| e2e quiet-save spec + web baseline | `tests/` + desktop e2e | Desktop scenarios host-specific; web baseline proves P02-12 |
| `bin/check phase 2` + CI evidence | `tooling` | Campaign machinery, mirrors phase 1 |

Package admission (only if a package/crate/top-level dir is added): none added. `notify` is a third-party crate dependency, not an Elef package. The session factory is a module inside the current shared JS home (default per §3); it graduates to `client/session/` in Phases 03–09, which own that move.

## 4. Behavior to preserve
| Behavior | Proving test/scenario/fixture |
|---|---|
| Web save/autosave/conflict/retry flows byte-identical | `test/system/documents_test.rb`, `presentations_test.rb`, `unified_workspace_test.rb`, `vim_editor_test.rb` + `test/javascript/shared/{save_flow,autosave_controller,title_save_flow}.test.*` (all must pass unmodified) |
| Atomic writes, no silent stale overwrite, losing side preserved | Extended kill matrix (save points still 4×50 green) + ADR-008 conflict scenarios in desktop e2e |
| `save_flow` engine state machine for existing consumers | `test/javascript/shared/save_flow.test.js` unmodified (engine keeps emitting states; desktop stops displaying them) |
| Offline desktop, updater, menus, import/export, assets | Unchanged desktop e2e specs + CI `desktop`/`desktop-macos` jobs |
| Contract conformance (fake/rails/tauri) | Existing suite + adapters green (no port changes) |
| Renderer output, tailwind/renderer freshness | Gate `run_fresh` (unchanged inputs) |

Intended behavior changes (only those named by the phase contract):
- P02-01: desktop Save button/status/unsaved marker/leave warning removed (e2e `#save-state` waits migrate to flow/file-based waits).
- P02-02: desktop schedule 650 ms → 2.0 s; new blur flush; Cmd+S silent; quit flushes silently.
- P02-03: quit warns (native confirm) only if final flush fails; write failure stays non-modal + auto-retry.
- P02-04/05/06/07: clean reload, deterministic merge, overlap-keeps-local, suspicious thresholds (new local-store + policy behavior).
- P02-08/09: snapshot history + watcher replace polling (2 s `readSourceSnapshot` poll removed once watcher e2e green).

## 5. Work breakdown
Ordered steps; structural moves and behavior changes in separate commits.
1. local-store pure mechanics (no behavior wiring): `merge_sources` + `is_suspicious_external_change` + unit vectors (incl. P02-07 boundary triplets) + in-memory ancestor tracking on open/save. Commit.
2. local-store snapshot history: `.elef-history/` layout, take/list/restore/prune, restore-before-restore, fault hooks. Unit tests. Commit.
3. local-store watcher: `notify` dep, debounced recursive watch, explicit enable, `poll_file_events` drain; replacement-style tests (direct/git/atomic-replace × idle/typing simulated). Commit.
4. Kill-matrix extension: snapshot + merge fault points in the existing child-process harness (same 50-run shape). Commit. (Proves P02-10.)
5. Tauri commands: `poll_file_events`, `take_snapshot`, `list_snapshots`, `restore_snapshot`, `merge_external_change`; capabilities + e2e allowlist; adapter `saveSource` unchanged. Commit.
6. Session factory: `work_session.js` `createWorkSession` over `createSaveFlow` with merge/snapshot/external-policy hooks; WorkSession surface test; save_flow extensions only (no behavior change yet). Commit.
7. Desktop policy injection: quiet-save policy in `desktop/frontend/src`, 2.0 s delay, blur listener, close-flow rework (flush-silently, native confirm only on failure), merge/snapshot cadence wiring, remove `beforeunload`. Commit.
8. Desktop chrome removal: `showSubmit: false` + status/retry/dirty marker removal on desktop render path; migrate desktop e2e `#save-state` waits. Commit.
9. Remove 2 s `readSourceSnapshot` polling (replaced by watcher drain) once quiet-save e2e green. Separate commit.
10. e2e `quiet-save.spec.js` (timing ≤2.5 s, immediate-flush triggers, merge, overlap, suspicious refusal, snapshot restore, watcher styles) + `wdio.conf.js` registration; web baseline run. Commit.
11. `bin/check phase 2` + CI evidence plumbing + gate + review to PASS.

Design decisions locked here: (a) pull-drain watcher (command, not push events) — keeps Tauri thin and tests deterministic; (b) in-memory ancestor — crash loses it, so post-crash external change takes the conflict path, never silent merge; (c) clean-but-suspicious external change is snapshotted + notified, never auto-loaded; (d) web does not adopt the factory this phase.

## 6. Deletions and temporary compatibility
| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| 2 s `readSourceSnapshot` polling loop | desktop host | Replaced by Rust watcher drain (step 9) | quiet-save watcher e2e green on Linux + macOS CI |
| Desktop Save button/status/retry/dirty markers + `beforeunload` guard | desktop host | P02-01 quiet UI | This phase (contract-named); e2e migrated in step 8 |
| `e2eNextSaveDelayMs` hook (if unused after retime) | desktop e2e | Superseded by timing spec | Keep if quiet-save spec uses it, else remove in step 10 |

Temporary compatibility paths: none. No shims; web and desktop diverge by injected policy only.

## 7. Risks and rollback triggers
| Risk | Trigger | Response |
|---|---|---|
| Silent data loss via merge/watcher | Any data-safety/kill-matrix/conflict test fails | Stop, fix root cause; if unfixable, roll back to `34d3ae8` and re-plan |
| Watcher flakiness (missed/coalesced events) | Watcher e2e fails 3× or flakes on either OS | Keep polling as fallback (revert step 9), re-plan watcher hardening |
| Web behavior drift | Any web system/JS save test fails | Stop; web diff must be zero — fix or roll back |
| Save-timing flakes (2.5 s ceiling) | Timing spec fails on loaded CI runners | Measure first; widen only with owner-approved evidence (never silently) |
| `notify` dependency risk (audit/size) | `cargo audit` denies or workspace friction | Pin + document; fallback is poll-based snapshot diff already proven |
| Conformance divergence | Any adapter suite result changes | Stop; no port changes allowed this phase |

Rollback reference: `phase_base_sha` `34d3ae80cefc58b3cf88b8eec1bad927f6666b4f`.

## 8. Proof map
| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P02-01 | e2e asserts no Save button/status/marker in desktop DOM + no `beforeunload` (new spec); reviewer greps desktop render path | phase + CI desktop jobs | Linux e2e locally; macOS on CI |
| P02-02 | Rust+JS unit (injected timers) + e2e disk-timing ≤2.5 s + flush-trigger tests (switch/blur/Cmd+S/quit) | affected + phase + CI | Local e2e + CI |
| P02-03 | JS unit (retry/backoff preserved) + e2e failure-injection (non-modal) + quit-fail native confirm test | phase + CI | Local e2e + CI |
| P02-04/05/06 | Rust merge unit vectors + e2e external-edit scenarios (clean/merge/overlap) | affected (rust) + phase + CI | Local + CI |
| P02-07 | Rust boundary tests (199/200/201 chars, 49/50/51% ratios, empty/non-empty) | quick (cargo) + reviewer reads thresholds | Local |
| P02-08 | Rust snapshot tests (cadence via policy-timer unit, 7-day prune with fake clock, restore-before-restore) + e2e restore | affected + phase | Local + CI |
| P02-09 | Rust watcher tests (3 replacement styles) + e2e idle/typing scenarios | affected + phase + CI | Local + CI |
| P02-10 | Extended kill matrix (`cargo test -p local-store`, save 4×50 + snapshot/merge points) | quick + phase | Local + CI |
| P02-11 | Reviewer grep: no host branches in `save_flow.js`/`work_session.js`; factory injection test | quick (unit) + review | Local |
| P02-12 | 7 web system files + save JS unit tests pass UNMODIFIED | affected + CI test job | CI (+ local if Ruby ready) |
| I01/I16/I17 | Boundary checker + reviewer: no new package, no allowlist growth | quick + review | Local |
| I02–I05/I08/I11/I12 | No new shared owners; desktop-only slice; reviewer checklist | review | — |
| I06/I07/I09/I13/I14 | Kill matrix + offline desktop e2e + factual docs + no compat paths + no weakening (save_flow tests unmodified) | phase + review | Local + CI |
| I10 | check-to-rename p95 + native perf artifacts; 2.5 s contract ceiling in e2e | CI | CI runners |
| I15 | `all`/`docs`/`perf` still fail nonzero in gate | phase gate | Local |
| I18 | Plan §5 + proof map route unseen changes; reviewer spot-checks | review | — |

Fixed fixture sets / finite reviewer checklists required by the contract:
- Merge test vectors (fixed): clean, non-overlap (both orders), overlap (local-wins), suspicious ×3 shapes, empty-file edges.
- Suspicious boundary triplets: local_len ∈ {199, 200, 201}, ext/local ratio ∈ {49%, 50%, 51%}, external empty × local {empty, non-empty}.
- Watcher styles: direct write, git-style (write temp + rename over), atomic-replace (rsync-like), each × {idle, typing}.
- Reviewer checklist: (1) grep `__TAURI__\|isDesktop\|DESKTOP` in `app/javascript/lib/save_flow.js` + `work_session.js` → zero; (2) web diff limited to zero outside tests? No — web diff must be ZERO, verify via `git diff phase_base -- app/javascript/controllers/autosave_controller.js app/views/works/`; (3) confirm no new ElefHost port in `packages/contracts`.

Human gates touched (constitution §8): none.

## 9. Re-plan log
<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->
