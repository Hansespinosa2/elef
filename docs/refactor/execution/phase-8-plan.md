# Phase 8 plan — Source editor

Status: FROZEN at 2026-10-09 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/08-source-editor.md` (sha256 `da19b3dbe451ac9193aee7771166b9ae4c8cef0e16fe2e063d85b630fc29e0f`)
Phase base: `c5456e79e4007f70ab41b9877baabe4bd51aa4a1`

## 1. Verified facts
| Fact | Evidence (file:line or command → result) |
|---|---|
| Two live persistence stacks share one engine | Web editors use `createSaveFlow` directly (`app/javascript/controllers/autosave_controller.js:151`) with zero `WorkSession` involvement; desktop uses `createWorkSession` (`app/javascript/lib/file_library_application.js:191`), a thin wrapper over the same `createSaveFlow` (`app/javascript/lib/work_session.js:142`) |
| Contract-style session/save methods on the new hosts are dead code | `app/javascript/host/rails-http-host.js:379,163,222`, `desktop/frontend/src/tauri-host.js:401,165,212` have no callers (`grep createWorkSession packages/client/src` → nothing); the hosts' inline `saveWork` copies lack debounce, materialize, and merge hooks |
| Session already defines the narrow editor binding | Policy `{ getText, setText, materializeEdits }` (`work_session.js:60-76`); `replaceText`/`applyLocalChange` (`work_session.js:295-317`) are pure range math over `getText`/`setText` but have no live callers |
| CodeMirror owns selection/undo; controller mirrors to a hidden textarea | Getters read `view.state.selection.main`/`view.state.doc` (`editor_controller.js:342-356`); `syncInput` mirrors doc+selection (`:553-559`); undo is implicit from `basicSetup` with `userEvent:"input"` marking typed history (M6-M8 `:417-442`) vs no `userEvent` on server/external sync (M5/M9) |
| Mutation surface is 14 dispatch shells, cleanly splittable | M1-M14 mapped with lines (`editor_controller.js:200-752`): portable range arithmetic (M5 diff core `:394-403`, clamps, line-ending helpers `:570-577`, frontmatter regex `:701`) vs CM-bound application (`Compartment.reconfigure`, fold effects, `ChangeSet.mapPos`, `state.field`) vs Stimulus/DOM shell (form submit/formdata, focusout change events, geometry, prefs) |
| All structural ops are string surgery through `replaceRange*` | Slide/block move/add/delete (`packages/client/src/features/presentation/editor.js:538,561,576,603`), overview splice (`slide_overview_controller.js:54-110`), visual-editor line ops (`visual_editor_controller.js:410-877`) — all commit via `editorController.replaceRange(s)`; work-model is read-only graph only (`file_library_application.js:8,113`) |
| Work switch is already a history boundary with dispose+recreate | Desktop `openDeckNow` flushes, `closeSession()` disposes, `loadDocument` does `view.setState` + recreates session (`file_library_application.js:550-634`); no caret restore (`editor_controller.js:530-546`, intent documented `editor_document_state.js:1`) |
| Stale guards exist but are scattered | `applyEditorSource` deck/expected-source check (`editor_source.js:1-12`), `createRequestGuard` generation counter (`request_identity.js`), `replaceServerSource` equality short-circuit (`editor_controller.js:387-392`); no session identity or setText generation check exists |
| Title rename is a separate debounced flow with ordered flush | `createTitleSaveFlow` (`file_library_application.js:235`) → `renameDeck`; `flushSave`/`flushForClose` flush title before source (`:770,778`); web saves title+theme+typography+source atomically as one joined snapshot (`autosave_controller.js:379`) |
| Perf policy is locked and measurable | Constitution product-performance policy (≤10% vs locked baseline median, no hard-ceiling crossing); frozen budgets `coldStart 1500/open100Slides 300/warmLibrary 500` (`bin/check:349-351`); typing probe asserts exact+disk equality with `inputPreservedRuns == samples` gate (`bin/check:361-362`); `bin/check perf` is a stub tier, native benchmark needs the Tauri runner |
| Phase-02 mechanics to keep green | Policy consts (`quiet_save_policy.js:3-11`, delay 2000 < budget 2500), `local-store` engine (suspicious thresholds `:2367`, atomic writes `:2108`, fault points `:2600`, kill matrix `:3797-4034`), web `save_flow.js:1-35` mirror, 14-scenario web baseline (`baseline.json:188-206`) |

Open questions resolved before freeze: none remaining — the three mapper reports closed the inventory (controller split, persistence paths, criteria support). The one judgment call frozen below is the meaning of "atomically" in P08-02 (single ordered flush, title-first, under one session dirty model).

## 2. Scope
In scope:
- New `packages/client/src/session/` owning `createWorkSession`, `createSaveFlow`, `createTitleSaveFlow` (moved verbatim first, then adapted), the portable range/selection arithmetic extracted from the controller, and the editor-adapter interface definition with contract tests (P08-01, P08-02).
- Web `autosave_controller` migrated from direct `createSaveFlow` onto `createWorkSession` with a Rails transport/policy preserving today's exact behavior: 900 ms debounce, atomic joined snapshot, IndexedDB drafts, 409 conflict dialog, canonical-server sync (P08-02, P08-03).
- All structural source operations (client presentation editor ops, slide overview, visual editor) routed through session `replaceText`/`applyLocalChange`; the session policy `setText` fans out to the bound adapter (P08-03).
- Session identity + generation: each session carries `(workId, epoch)`; adapter binds to exactly one live session; `setText` from a stale/disposed session is rejected; dead contract-session duplicates deleted from both hosts (P08-04).
- Concurrent-stale rejection kept and extended: request guards + `applyEditorSource` + server-source equality stay; session `flush` carries expected-revision so out-of-order save responses cannot win (P08-05).
- Perf probes locked: no threshold/baseline/budget change; typing exact-equality and stage p95s re-proven (P08-06).
- Phase-02 desktop save criteria re-proven end to end on the moved code (P02-01-P02-12 as applicable).

Non-goals (explicitly deferred):
- CodeMirror stays host-provided: the CM-backed adapter implementation remains in `app/javascript/lib/`; `packages/client` gains no CodeMirror dependency. ProseMirror/TipTap reuse is interface-readiness only (later phase provides a second adapter).
- No work-model text transforms: structural ops keep string surgery through the session this phase; moving them onto work-model transforms is a later phase.
- No new packages (P08 default); admission table records the negative case.
- `dev` reconciliation stays deferred to endgame per `docs/refactor/deferred-dev-reconciliation.md`.

## 3. Ownership classification
| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| `session/` in client (WorkSession, save/title flows, range math, adapter interface) | Shared editing behavior, implemented once | Shared: both hosts persist through it; desktop policy (delays, polling, snapshots) and web policy (debounce, joined snapshot, drafts) injected via the session factory — extends the P02-11 no-branch rule to the web stack |
| Rails transport + policy for the web session | Host persistence surface | Host-specific (Rails host): FormData PATCH, CSRF, revision tokens, IndexedDB drafts exist only on web |
| Tauri transport + quiet-save policy | Host persistence surface | Host-specific (desktop host): `save_source`/`poll_file_events` invokes, 2 s delay, 1 s poll, 5 min snapshots exist only on desktop |
| CM-backed adapter implementation | Host editor binding | Host-specific implementation of the shared interface: both hosts run the same Rails-built bundle in this phase, so one implementation in `app/javascript/lib/` serves both; interface in client stays renderer-free for later ProseMirror/TipTap adapters |
| Session identity/epoch + stale-setText rejection | Shared correctness invariant | Shared: enforced in client session code, no host branch |
| Structural-op call-site rewiring (client editor.js, overview, visual editor) | Shared editing behavior | Shared: ops already live in client/host-lib; only their commit path changes (session instead of direct controller calls) |

Package admission: no new package is added (`packages/client/src/session/` is a directory in the existing client package). Six-criteria table is therefore the negative case: no new dependency boundary, no new build artifact, no new versioning surface, no new host binding, no new test runner, no new constitution owner — driver: keep the save family in the existing client package.

## 4. Behavior to preserve
| Behavior | Proving test/scenario/fixture |
|---|---|
| Web autosave timing/shape (900 ms debounce, atomic joined title+theme+typography+source, 15 s timeout, retry classes, 409 → dialog, canonical sync) | `test/e2e/scenarios/edit-and-preview.js` + frozen 14-scenario web baseline; autosave unit tests; system autosave tests |
| Desktop quiet save (2 s→disk ≤2.5 s, flush on switch/blur/Cmd+S/quit, non-modal retry, silent clean reload, deterministic merge, overlap keeps local, suspicious thresholds, 5-min snapshots, watcher styles) | P02-01–P02-12 proofs mapped in §1 (quiet-save e2e, local-store kill/fault matrix, close-flow tests, boundary tests `lib.rs:4207-4223`) |
| Cursor/selection/undo semantics (CM owns; server sync maps selection; external apply restores textarea selection; work switch resets history+caret; mode switch preserves caret) | Existing editor/visual mode tests; new client unit tests for extracted range math pin the mapping |
| Conflict UX (non-dismissible while conflicted, use-disk stashes restorable draft / web keeps IndexedDB draft) | `external-edit-conflict.js` scenario; conflict dialog tests |
| Typing never drops input during save | Benchmark `inputPreservedRuns == samples` gate; e2e typing-during-save hooks |
| No Save UI on desktop; web policy baseline unchanged | `showSubmit/showSaveStatus false` assertions; web baseline scenarios |

Intended behavior changes (only those named by the phase contract):
- P08-02: web stack gains session identity (epoch) and participates in the session dirty model; title rename + source save share one ordered flush (title-first, unchanged order) under the session.
- P08-04: second-session/duplicate-session construction becomes impossible — dead host session code is deleted, and binding a second adapter to a live session throws.
- P08-05: out-of-order save responses are rejected by expected-revision where previously last-writer-won inside the debounce window.

## 5. Work breakdown
Ordered steps; structural moves and behavior changes in separate commits:
1. DO-1 (move, no behavior): move `work_session.js`, `save_flow.js`, `title_save_flow.js` to `packages/client/src/session/` with import-path updates only; full affected tier green.
2. DO-2 (move, no behavior): extract portable range math (M5 diff core, clamps, line-ending normalize, frontmatter-range regex) to `session/source_ops.js` with unit tests pinning current mapping; controller delegates.
3. DO-3 (interface): define the editor-adapter interface in client (`session/editor_adapter.js`: `getText/setText/materializeEdits` + binding contract) with contract tests; `editor_controller` implements it against CM (thin shell, no logic change).
4. DO-4 (behavior): migrate `autosave_controller` onto `createWorkSession` (Rails transport/policy); web baseline scenarios green.
5. DO-5 (behavior): rewire structural ops to `replaceText`/`applyLocalChange`; delete dead host session duplicates; add session identity/epoch + stale-setText rejection with unit tests.
6. DO-6 (behavior): expected-revision on session flush; concurrent-stale unit tests (out-of-order responses, cross-work application rejected).
7. DO-7 (prove): P02 re-proof + perf re-proof + data-safety checklist (§8); freeze candidate.

## 6. Deletions and temporary compatibility
| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| Dead `createWorkSession`/`saveWork`/`flush` on `rails-http-host.js:379,163,222` | Host | Superseded by session-owned path; lacks debounce/materialize/merge | Deleted in DO-5; no callers exist |
| Dead `createWorkSession`/`save_source` copy on `tauri-host.js:401,165,212` | Host | Same | Deleted in DO-5; no callers exist |
| Direct `editorController.replaceRange*` commit paths in structural ops | Shared | Bypass the session dirty model (P08-03) | Rewired in DO-5; controller methods remain as the adapter's application primitive |
| Direct `createSaveFlow` use in `autosave_controller.js:151` | Host | Bypassed session (P08-02) | Replaced in DO-4; `save_flow` module itself moves to client in DO-1 |
| Pre-migration `lib/work_session.js` (and moved flows) originals | Shared | Graduated to `client/session/` per the module's own header (`work_session.js:4-5`) | Removed in DO-1; re-export shims only if a host import is missed by tests (none expected — single caller) |

## 7. Risks and rollback triggers
| Risk | Trigger | Response |
|---|---|---|
| Web autosave migration changes save timing/shape | Any web baseline scenario or autosave system test fails in DO-4 | Roll back DO-4 commit only (moves in DO-1–DO-3 stay); re-freeze with narrower web scope |
| Structural-op rewiring drops caret or undo granularity | Visual/overview/presentation editor tests fail, or caret assertions regress | Roll back DO-5 op rewiring per area; session keeps direct-controller fallback until fixed |
| Session identity breaks desktop work-switch flow | Quiet-save e2e or switch-flush tests fail | Roll back DO-5 identity enforcement; dispose+recreate ordering is preserved verbatim from `file_library_application.js:550-634` |
| Expected-revision rejects legitimate saves | Flush-failure or retry tests fail | Loosen to warn-and-refetch; never to last-writer-wins |
| Client gains a CodeMirror dependency by accident | Ownership gate (`check_frontend_ownership.py`) or import lint fails | Move the offending import back to host lib; client session code stays renderer-free |
| /tmp pressure crashes browser suites (512M tmpfs) | Selenium tab-crash / ENOSPC | Clear `/tmp/elef-client-tests-*` + rerun; serialize browser groups |

## 8. Proof map
| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P08-01 session owns text in client | `packages/client/src/session/` exists; controller holds no buffer (only adapter shell); adapter surface ≤ `{getText,setText,materializeEdits}` + binding contract; renderer-free (ownership gate green) | affected | — |
| P08-02 single WorkSession path both hosts | Web `autosave_controller` constructs `createWorkSession`; no direct `createSaveFlow` outside `session/`; title+source share ordered flush (title-first) | affected + web baseline scenarios | headless Chromium |
| P08-03 all mutations through session | No structural op calls `editorController.replaceRange*` (grep gate); `applyLocalChange`/`replaceText` have live callers (coverage); session continuity across work switches (quiet-save e2e) | affected + e2e | headless Chromium |
| P08-04 lifecycle identity/generation | Unit: double-bind throws; stale/disposed `setText` rejected; one constructed editor per host (reviewer checklist: grep constructed editors) | quick (unit) + reviewer | — |
| P08-05 concurrent stale rejected | Unit: out-of-order save responses rejected by expected-revision; cross-work application rejected via `applyEditorSource` guard; preview/save/search/graph guards intact (existing tests) | quick + affected | — |
| P08-06 perf locked | No budget/baseline/threshold file touched (diff gate); typing exact-equality unit path; native benchmark via exact-candidate CI evidence where runner unavailable locally | affected + advisory CI | Tauri runner or CI evidence |
| P08-07 data safety | Checklist below, each item with a named test/command; kill/fault matrix + suspicious boundaries re-run green | affected (matrix) | Rust toolchain |
| P02-01–P02-12 re-proof | Proofs mapped in §1 re-run green on moved code (quiet-save e2e, local-store matrix, close-flow, boundary tests, web baseline) | affected | headless Chromium + Rust |

P08-07 data-safety checklist (every item proven, none waived):
1. All disk writes atomic (`write_file_atomic`, `lib.rs:2108-2127`).
2. Stale writers never silently win (expected-revision on flush + suspicious-change refusal + `save_rejects_a_symlink_source`).
3. Snapshot before merge/overwrite/restore; 5-min cadence; 7-day retention (`lib.rs:865-1035`).
4. Web IndexedDB draft written on every keystroke and cleared only on clean save (`autosave_controller.js:446-457`).
5. Desktop discarded drafts capped at 10 and restorable (`save_flow.js:86`, `restoreDraft`).
6. Conflict dialog non-dismissible while conflicted on both hosts (`file_library_application.js:1125`, `autosave_controller.js:29`).
7. Kill/fault matrix green (save/snapshot/merge points).
8. No dropped input during save (`inputPreservedRuns == samples`).

Fixed fixture sets: frozen 14-scenario web baseline (`baseline.json:188-206`); frozen perf budgets triple (`bin/check:349-351`); suspicious boundary fixtures at/around 200 chars (`lib.rs:4217-4223`).

Human gates touched (constitution §8): none — no signing/updater/owner-acceptance/deploy/soak step is triggered by this phase.

## 9. Re-plan log
<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->
- 2026-10-09: frozen (initial).

