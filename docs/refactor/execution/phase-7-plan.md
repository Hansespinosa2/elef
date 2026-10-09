# Phase 7 plan — Presentation and product export

Status: FROZEN at 2026-10-09 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/07-presentation-export.md` (sha256 `59bdd29ab5b49e6f8e8e59472c9dbc3686feef6a16a40dfe74e635795f4f4f86`)
Phase base: `873904da32953b513b89b073b331ce692c84cb0a`

## 1. Verified facts
| Fact | Evidence (file:line or command → result) |
|---|---|
| Presentation UI is Stimulus-owned on both hosts | `app/javascript/controllers/presentation_controller.js` (111 lines), `presentation_canvas_controller.js` (32), `presentation_editor_controller.js` (805); no client presentation feature exists (`packages/client/src/features/` has library/settings/graph only) |
| Presentation scenario already shared by both hosts | `test/e2e/scenarios/presentation-mode.js:3`; imported by `desktop/e2e/specs/desktop.spec.js:16,1764` and `desktop/e2e/specs/web.spec.js:12,908` |
| PPTX engine functions are already exported module functions | `app/javascript/controllers/pptx_export_controller.js:61-387` exports `loadPptxLibrary/createPresentation/primaryFont/createRenderStage/slideMarkup/blockMarkup/escapeHtml/dataUriToBlob/cssLineSpacingMultiple`; only `download()` (lines 11-52) is controller orchestration |
| PPTX behavior guarded by a system test | `test/system/pptx_export_test.rb` exists and passes on main CI |
| No TransferPort, export feature, or format registry exists | grep `TransferPort/transfer` across `packages/client/src app/javascript/lib crates/local-store` → zero hits; grep `pptx` in client/desktop sources → controller only |
| Renderer delegates slide chrome to the host | `packages/renderer/src/renderer.js:333,340` calls `chrome.slideToolbar/slideFrame` (host-owned `preview_chrome.js`), keeping renderer free of editor DOM |

Answered in DO-1 (verified before freeze):
1. `chrome.slideToolbar` renders EDITOR controls (Add slide/image, Delete, Move up/down with `data-presentation-editor-action` hooks; `app/javascript/lib/preview_chrome.js:45`); `slideFrame` mounts `data-controller="presentation-canvas"` (`preview_chrome.js:46`). P07-02 cut: toolbar + canvas controller move to the client presentation feature; renderer keeps projection structure only.
2. Format inventory: PPTX (`presentations#pptx` JSON model + client engine in `pptx_export_controller.js`), print (server views `documents#print`/`presentations#print`), PDF-via-print (`test/system/media_pdf_export_test.rb`), `.elef` transfer (`export_work`/`import_work` in both controllers, `config/routes.rb:45,65`). No TransferPort, export feature, or registry exists yet.
3. `presentation_editor_controller.js` buckets: connect/disconnect/mode (18-68), focus/caret (70-211), keydown/input (212-251), alignment (252-398), slide/block add/delete/move actions (399-575), preview sync (576-622+). Navigation extraction precedent exists: `app/javascript/lib/presentation_navigation.js` (tested).
4. No pixel screenshots anywhere: the frozen visual set is DOM assertions — `test/system/presentations_test.rb:222-231` (slide position-class assertions) + `test/e2e/scenarios/document-page-aspect-ratio.js`.
5. Baselines green pre-freeze: `pptx_export.test.mjs` + `presentation_controller.test.js` → 20/20 pass.

## 2. Scope
In scope:
- New `packages/client/src/features/presentation/` owning navigation, keyboard/fullscreen, editing chrome, stable styling; shared scenarios pass on both hosts (P07-01).
- Renderer keeps slide projection; any editor controls found in renderer move out (P07-02).
- New `packages/client/src/features/export/` owning user-facing export orchestration with explicit per-format implementations; `.elef` transfer stays a separate `TransferPort` concern (P07-03).
- PPTX engine separated from button/status/fetch orchestration into independently unit-testable logic; behavior preserved except where this plan names a change (P07-04).
- No new packages (P07-05 default); admission table below records the negative case.
- One export capability registry (Work kinds × formats × capabilities) replacing scattered format rules (P07-06).
- Fixed presentation screenshot/visual fixture set named here at freeze time (P07-07; list appended in DO-1 re-plan log entry, not by silent edit).
Non-goals (explicitly deferred):
- Source-editor link insertion (Phase 08), visual-editor affordances (Phase 09), host re-homing leftovers (Phase 11).

## 3. Ownership classification
| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| Presentation navigation/chrome/styling | `client` (`features/presentation/`) | Shared: one interaction model inherited by both hosts |
| Slide projection markup | `renderer` | Shared: pure projection from the slide model |
| Export orchestration + format engines | `client` (`features/export/`) | Shared: same formats/UX on both hosts |
| `.elef` transfer port | `contracts` (`TransferPort`) + host adapters | Host-specific edges: native file differently on Tauri vs Rails download |
| PPTX server model endpoint (`urlValue` JSON) | web host (Rails) unless desktop reuses | TBD in DO-1 inventory (desktop export path) |

Package admission (no package added): (1) deployable unit — no, ships in client bundle; (2) versioning cadence — no; (3) owner boundary — no, same client owner; (4) dependency direction — no, feature dirs satisfy §4; (5) size forcing split — no; (6) symmetry — no, settings/library/graph precedent is feature dirs. Driver: none. Default holds.

## 4. Behavior to preserve
| Behavior | Proving test/scenario/fixture |
|---|---|
| Presentation mode flow both hosts | `test/e2e/scenarios/presentation-mode.js` |
| PPTX download content | `test/system/pptx_export_test.rb` |
| Aspect-ratio/visual presentation checks | `test/e2e/scenarios/document-page-aspect-ratio.js` + `presentations_test.rb` visual set |
| Export engine unit behavior | NEW engine unit tests extracted from current outputs (baseline-first) |

Intended behavior changes (only those named by the phase contract): none at PLAN; any PPTX deltas discovered in DO are named in the re-plan log before implementation.

## 5. Work breakdown
Ordered steps; structural moves and behavior changes in separate commits.
1. DO-1: answer open questions 1–4 (chrome cut line, format inventory, editor-controller map, frozen visual set); baseline PPTX engine unit tests from current outputs.
2. DO-2 (structural): add `features/presentation/` ported from the three presentation controllers (no behavior change); client unit tests.
3. DO-3 (structural): add `features/export/` (registry + PPTX engine moved, orchestration ported); switch both hosts; retire Stimulus presentation/pptx controllers.
4. DO-4 (behavior, only if named): any PLAN-named PPTX deltas with regression tests.
5. DO-5: affected tier + CI; gate (`bin/check phase 7` to implement); review.

## 6. Deletions and temporary compatibility
| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| `presentation_controller.js` + `presentation_canvas_controller.js` | web host (Stimulus layer) | Move to client feature | Both hosts present via client + CI green |
| `presentation_editor_controller.js` | web host | Same | Same |
| `pptx_export_controller.js` orchestration | web host | Move to client export feature | Same (engine unit tests green) |

## 7. Risks and rollback triggers
| Risk | Trigger | Response |
|---|---|---|
| PPTX byte-output drift after engine move | `pptx_export_test.rb` red or engine unit mismatch | Keep Stimulus path until outputs byte-match; rollback ref `phase_base_sha` |
| Fullscreen/keyboard host differences | Shared scenario red on one host only | Host-specific capability branch with concrete platform reason (HostCapabilities) |
| Screenshot flakiness in frozen set | Flaky visual assertion blocks CI | Narrow to deterministic viewport/fixture subset; never delete coverage to go green |

## 8. Proof map
| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P07-01 | `presentation-mode.js` green in `desktop` + `desktop-macos` + web system-test | CI | CI runners |
| P07-02 | No editor-control markers in `packages/renderer/src`; chrome ownership test | affected + reviewer checklist | — |
| P07-03 | `features/export/` orchestration + per-format modules; `TransferPort` separate | affected + reviewer checklist | — |
| P07-04 | `pptx_export_test.rb` green + engine unit tests | CI + affected | — |
| P07-05 | `ls packages/` shows no new package; admission table §3 reviewed | reviewer checklist | — |
| P07-06 | Single registry module; grep shows no scattered format rules | affected | — |
| P07-07 | Frozen fixture list (DO-1) green; reviewer judges only against it | CI + review | — |
| I01–I18 | `bin/check phase 7 --json` exit 0 in isolated gate checkout + independent review | phase + review | gate checkout |

Fixed fixture sets / finite reviewer checklists required by the contract:
- Presentation visual fixture set, frozen (P07-07): `test/system/presentations_test.rb:222-231` slide position-class assertions + `test/e2e/scenarios/document-page-aspect-ratio.js`. No pixel comparisons exist; reviewer judges only against these.
- Reviewer checklist: no new packages; Stimulus presentation/pptx files absent; one scenario drives both hosts; registry is the only format-rule source.

Human gates touched (constitution §8):
- None at PLAN; owner-Mac/Linux acceptance and deployment gates remain pending per prior phases.

## 9. Re-plan log
<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->
