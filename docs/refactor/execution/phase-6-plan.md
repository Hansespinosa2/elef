# Phase 6 plan — Work links and graph

Status: FROZEN at 2026-10-08 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/06-graph.md` (sha256 `b1d5bf64b406f60d80f745606da3c73ffc504c09f83eaa53a1bb2f796c374bd9`)
Phase base: `dff371c49ced594eb228123ec0d28cd753007f6e`

## 1. Verified facts
| Fact | Evidence (file:line or command → result) |
|---|---|
| Link semantics already exist in work-model | `packages/work-model/src/index.js:19-29` exports `buildDocumentGraph`, `createDocumentLinkResolver`, `extractDocumentLinkTitles/Tokens`, `parseDocumentLinkAt`, `parsePortableDocumentLinks`; impl in `packages/work-model/src/document_links.js` (244 lines) + `document_map.js` (871 lines); tests `packages/work-model/test/document_links.test.js` (143 lines) |
| Ruby semantics own the Rails render path today | `app/lib/document_links/graph.rb` (20 lines), `parser.rb` (67), `renderer.rb` (29); `app/controllers/documents_controller.rb:13` builds `@document_graph` via `DocumentLinks::Graph` |
| Graph visualization is Stimulus-owned, shared by both hosts | `app/javascript/controllers/document_graph_controller.js` (307 lines: force simulation, pan/zoom, highlight, node activation); `app/javascript/lib/document_graph_view.js` (173 lines); `app/javascript/lib/document_graph_cache.js` (40 lines); markup `app/views/presentations/_document_graph.html.erb:1-4`; desktop bundles the same controller chunk (`desktop/frontend/dist/assets/chunks/document_graph_controller-*.js`) |
| No client graph feature module exists | `packages/client/src/features/` contains only `library/` + `settings/` |
| One shared scenario already covers graph on both hosts | `test/e2e/scenarios/library-and-graph.js:23-26` (show graph, assert 2 docs incl. "E2E linked", open graph doc); imported by `desktop/e2e/specs/desktop.spec.js:8` and `desktop/e2e/specs/web.spec.js:4,920` |
| Desktop graph data flows through the file-library transport | `desktop/frontend/src/file-library-transport.js:10` `readDocumentGraph` invokes Tauri `document_graph` (Rust `crates/local-store/src/lib.rs`); `app/javascript/lib/file_library_application.js:112` caches `buildDocumentGraph(await fileLibrary.readDocumentGraph())` |
| No stale-async guards exist on the graph path | grep for `requestId/request_id/stale/abort/navigat` in `document_graph_cache.js` + `document_graph_controller.js` → zero hits |
| No ambiguous/broken-link baseline fixtures exist | grep `ambiguous/broken.link/dangling` across `test/ tests/ packages/work-model/test/` → only unrelated mermaid hit |

Open questions / unknowns (each is a blocker or has a resolution step):
1. Do Ruby `DocumentLinks::{Graph,Parser}` and work-model `document_links.js` agree on every link edge case today? → Resolution: DO step 1 differential probe (Ruby vs work-model over seed + tricky titles) before moving the render path.
2. Which async flows need request/work identity (graph fetch only, or search too)? → Resolution: DO step 1 inventory of async graph/search call sites; scope P06-05 to the inventoried set.
3. Does the desktop host render `_document_graph` markup or its own copy? → Resolution: DO step 1 trace of desktop graph markup origin (same selectors asserted in `desktop.spec.js:1578-1604`).

## 2. Scope
In scope:
- Move semantic node/edge derivation for the rendered graph onto work-model (`buildDocumentGraph` + resolvers); Rails render path consumes work-model output instead of `DocumentLinks::Graph` (P06-01).
- New `packages/client/src/features/graph/` module owning layout, coordinates, selection, zoom, visual interaction; Stimulus `document-graph` controller + `document_graph_view.js` retired after switch-over (P06-02).
- No `packages/graph` (P06-03 default); package-admission table below records the negative case.
- Baseline fixtures capturing current ambiguous/broken-link behavior, enforced by tests (P06-04).
- Request/work identity rejection of stale async graph/search results after navigation (P06-05).
- Graph scenarios green on both hosts from the single `library-and-graph.js` definition (P06-06).
Non-goals (explicitly deferred to later phases):
- Source-editor link insertion UX (Phase 08), visual-editor link affordances (Phase 09), export link rewriting (Phase 07), host re-homing of remaining Rails JS (Phase 11).

## 3. Ownership classification
| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| Link syntax/resolution, node/edge derivation | `work-model` | Shared: pure derivation from document source, no platform capability involved |
| Graph layout/coords/selection/zoom/interaction | `client` (`features/graph/`) | Shared: one canvas/DOM interaction model inherited by both hosts via the client shell |
| Rails `documents_controller` graph assignment | web host | Host-specific: serves the pre-client markup slot until switch-over; deleted after |
| Tauri `document_graph` command + transport | desktop host | Host-specific: concrete capability difference (native store vs HTTP) |
| E2E scenario + fixtures | `contracts`/tooling | Shared: single definition executed by both host harnesses |

Package admission (no package added): (1) independent deployable unit — no, graph UI ships inside the client bundle; (2) separate versioning cadence — no; (3) distinct owner team boundary — no, same client owner; (4) dependency-direction requirement — no, feature module inside `client` satisfies §4; (5) size/complexity forcing split — no (~500 lines moving into one feature dir); (6) symmetry with an existing package — no, settings/library precedent is feature dirs. Driver: none. Default holds: module inside its semantic owner.

## 4. Behavior to preserve
| Behavior | Proving test/scenario/fixture |
|---|---|
| Library+graph flow incl. 2 graph docs, open "E2E linked" | `test/e2e/scenarios/library-and-graph.js` on both hosts |
| Portable graph keys/aliases resolve after archive import | `desktop.spec.js:2236` (+ web counterpart) |
| Link extraction/resolution unit behavior | `packages/work-model/test/document_links.test.js` |
| Ambiguous/broken-link rendering | NEW baseline fixtures (P06-04) captured from pre-move behavior in DO step 1 |

Intended behavior changes (only those named by the phase contract):
- Stale async graph/search results after navigation are rejected instead of applied (P06-05; previously unguarded).

## 5. Work breakdown
Ordered steps; structural moves and behavior changes in separate commits.
1. DO-1: differential probe Ruby-vs-work-model link semantics; capture ambiguous/broken-link baseline fixtures; inventory async graph/search call sites + desktop markup origin (answers open questions 1–3).
2. DO-2 (structural): add `packages/client/src/features/graph/` with layout/interaction ported from `document_graph_view.js` + controller (no behavior change); client unit tests for layout/selection/zoom.
3. DO-3 (structural): switch both hosts to the client graph module; Rails `DocumentLinks::Graph` render path + Stimulus controller/view/cache retired (deletion table §6).
4. DO-4 (behavior): request/work identity guards on inventoried async flows (P06-05) with regression tests.
5. DO-5: affected tier + CI; gate; review.

## 6. Deletions and temporary compatibility
| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| `app/javascript/controllers/document_graph_controller.js` | web host (Stimulus layer) | Visualization moves to client feature | Both hosts render via `features/graph` + CI green |
| `app/javascript/lib/document_graph_view.js` | web host | Same | Same |
| `app/javascript/lib/document_graph_cache.js` | web host | Superseded by client-side cache+identity | Same (or earlier if unused after DO-2) |
| `app/lib/document_links/graph.rb` render path | web host | Semantics single-sourced in work-model | Differential probe parity + CI green |
| `_document_graph.html.erb` Stimulus mount attrs | web host | Client owns the mount | Same as controller |

## 7. Risks and rollback triggers
| Risk | Trigger | Response |
|---|---|---|
| Ruby/JS link-semantics divergence | Differential probe mismatch in DO-1 | Do not move render path; record divergence as BLOCKED input, resolve before DO-3; rollback ref `phase_base_sha` |
| Graph perf regression (force layout in client) | Perf probe >10% vs baseline or `affected` perf job red | Keep Stimulus path until layout cost is bounded; chunk or memoize |
| Contract conformance diverges between adapters | Host-conformance `settings`/graph legs differ web vs desktop | Fix the adapter, never the shared expectation |

## 8. Proof map
| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P06-01 | `DocumentLinks::Graph` unused by render path (grep); work-model derivation covered by `document_links.test.js` + differential probe | affected + CI | Node 22 |
| P06-02 | `features/graph/` owns layout/zoom/selection; Stimulus graph files absent; `check_boundaries.py` green | quick + phase gate | — |
| P06-03 | `ls packages/` shows no `graph/`; admission table §3 reviewed | reviewer checklist | — |
| P06-04 | Baseline fixture tests fail if link rendering changes | affected | — |
| P06-05 | Stale-response regression tests (navigate-then-resolve) | affected | — |
| P06-06 | `library-and-graph.js` green in `desktop` + `desktop-macos` + web system-test CI jobs | CI | CI runners |
| I01–I18 | `bin/check phase 6 --json` exit 0 in isolated gate checkout + independent review | phase + review | gate checkout |

Fixed fixture sets / finite reviewer checklists required by the contract:
- Ambiguous/broken-link baseline fixture set (created DO-1, frozen for the phase).
- Reviewer checklist: no `packages/graph`; Stimulus graph files absent; one scenario file drives both hosts; stale-guard tests present.

Human gates touched (constitution §8):
- None at PLAN; owner-Mac/Linux acceptance and deployment gates remain pending per prior phases.

## 9. Re-plan log
<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->
