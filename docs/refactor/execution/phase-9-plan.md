# Phase 9 plan — Visual editor, slide overview, and shared authoring

Status: FROZEN at 2026-10-09 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/09-visual-editor.md` (sha256 `e39bba95d6d5a8fd8db65de9a221cf2b37333fe18737ab13c9b8080e39c04ba0`)
Phase base: `e5df421d15332a2e25b4ee045ef9bcf154699e2b`

## 1. Verified facts
| Fact | Evidence (file:line or command → result) |
|---|---|
| Zero Stimulus/Turbo imports in client | `grep -rn hotwired packages/client/src` → zero; `extends Controller`/`Application.start`/`turbo` → zero; client deps are only contracts/renderer/react/react-dom (`packages/client/package.json:2-6`) |
| Stimulus residue is emitted attribute contracts | `chrome.js:13,23,34,42,46` emit `data-action="…->media#…/presentation-editor#…"` + `data-controller="mermaid-diagrams"`; `LibraryCard.tsx:487-488` emits `data-controller="document-pages mermaid-diagrams"`; `sanitize.ts:19-26,93-104,146-147` allowlists them; consumed by host controllers (`media_controller.js:1,90`, `mermaid_diagrams_controller.js:1,8`, `document_pages_controller.js:1,9`) |
| 26 ERB files; index already mounts shell | `find app/views -name *.erb` → 26 files; `documents_controller.rb:14`, `presentations_controller.rb:17` render `library/shell`; edit/new/show/present/print use conventional ERB |
| Graph/lineage slots are server-rendered into shell | `shell.html.erb:20-21` renders `presentations/document_graph` + `presentations/lineage_graph` partials into slot templates; client `GraphController` already exists for graph |
| Visual editor is DOM-heavy, CM-free | `visual_editor_controller.js` 1028 lines, zero CodeMirror imports; touches source only via value/replaceRange(s)/commitSource; portable math (kind classifier `:707-714`, range shift `:606-647`, block ranges `:306-328`) interleaved with contenteditable/selection/focus/geometry code |
| Overview is model+DOM mix | `slide_overview_controller.js` 339 lines: portable slide array ops (`:54-91`), ranges (`:269-323`) vs render/measure/scroll (`:125-267`); commit seam only at `applySlides` (`:98-123`) |
| Client already owns presentation-kind editing | `features/presentation/editor.js` 898 lines: slide/block ops (`:464-639`), alignment (`:313-462`), typing flush, caret, guards; document-kind logic stays in Stimulus |
| work-model is parser+map+3 helpers, zero op transforms | Barrel re-exports only `document_map.js` + `document_links.js`; transforms are front-matter/title only (`withFrontMatterValue :117-139`, `withAppearanceValue :109-115`, `replaceFirstHeading :184-211`); zero work-model hits in any op path |
| Deep links split by kind | Library/settings links resolve through shell/client both hosts (`router.ts`, `shell.tsx`, `client_shell_controller.js:15-91`, `file_library_application.js:1151-1164`); per-work links (`/<kind>/<id>[/edit]`, present/print/history/export/fork/publish) are server pages on web, `openDeck`/embedded editor on desktop; no custom URL scheme (`tauri.conf.json` has only `.elef` association + updater endpoint) |
| No baseline/budget/threshold file may move | Perf policy locked (constitution product-performance); typing exact-equality gate stands |

Open questions resolved before freeze: the web-only inventory is enumerated in §2 (frozen classification); per-work link resolution is shell routes on web + openDeck mapping on desktop (no custom scheme — OS gating is out of scope).

## 2. Scope
In scope:
- Client `features/document/` (document-kind visual editor ported from `visual_editor_controller.js`) and `features/overview/` (from `slide_overview_controller.js`) with narrow DOM adapters (`contenteditable`/selection/focus/geometry/measure/scroll stay host-bound behind client-defined interfaces, mirroring the Phase-08 adapter pattern) (P09-01).
- New `packages/work-model/src/document_transforms.js` (pure string functions): slide add/delete/move, block add/delete/move with group-scope guards, alignment upsert/remove (H+V and H-only variants), snippet-expand text, media-markdown insert+spacing. Both editors consume them; unit-tested in work-model (P09-02).
- Framework-neutral action contracts: client emits `data-editor-action` / `data-client-mount` instead of Stimulus-shaped `data-action="…->…#…"` / `data-controller="…"`; host Stimulus controllers bind to the neutral names; sanitizer allowlist switches to neutral names (P09-03).
- ERB deletion (DO-6 correction, §9): product authoring surfaces go (`documents/edit,new`, `presentations/edit,new`, `presentations/_form` wrapper); server projection partials stay as web-only read/publish implementation because the retained pages render them. Edit/new actions + failure re-renders render the new `works/shell`; show/present/print/history stay server-rendered web-only pages (ADR split — no desktop counterpart). Client recognizes every per-work URL via new `parseWorkRoute` (P09-04, P09-05-web).
- Desktop per-work mapping: work targets resolve to `openDeck`/embedded editor/file-open flows through the existing navigate seam; file association unchanged (P09-05-desktop).
- Shared authoring proof on both hosts (§8 proof map) (P09-06).

Non-goals (explicitly deferred):
- Projection text round-trip (`markdownForVisibleText`, offsets), caret-target computation, snippet tab-stop sessions, math active-span lifecycle, media upload/auth/transport: DOM- or transport-bound, stay host-side ("where applicable" excludes them).
- Enter-split/continue matrix: stays host-side (selection/DOM-bound), covered by existing suites, not moved to work-model.
- Custom URL scheme / OS file-type handling beyond the existing `.elef` association: needs owner/OS gating, out of scope.
- `dev` reconciliation stays deferred to endgame per `docs/refactor/deferred-dev-reconciliation.md`.
- No new packages.

Frozen web-only ERB inventory (these stay; everything else under `app/views` goes):
`library/shell.html.erb`, `works/shell.html.erb`, `shared/settings_page.html.erb`, `shared/_client_settings_mount.html.erb`, `layouts/_settings_navigation.html.erb`, `layouts/_new_work_menu.html.erb`, `layouts/application.html.erb`, `layouts/presentation.html.erb`, `documents/show.html.erb`, `presentations/show.html.erb`, `presentations/present.html.erb`, `documents/print.html.erb`, `presentations/print.html.erb`, `pwa/manifest.json.erb` (+ `pwa/service-worker.js`, layouts as web shell).
Retained partials (rendered only by inventory pages; not product views): `documents/_content`, `presentations/_slide`, `presentations/_slides`, `works/_form`, `works/_preview`, `works/_warnings`, `presentations/_document_graph`, `presentations/_lineage_graph`.
Rationale: authoring surfaces move to the works shell+client (edit/new/forms — one shell for all four entries + failure re-renders); read/publish pages have no desktop counterpart (ADR split) and remain web-only server-rendered surfaces with their projection partials. Fully client-rendered read/publish is a separate phase-scale effort (deferred, §9).

## 3. Ownership classification
| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| `features/document/`, `features/overview/`, work-model transforms, neutral action contracts, `parseWorkRoute` | Shared authoring behavior, implemented once | Shared: both hosts mount the same client features through the same DOM adapters (desktop reuses the Rails-built bundle, Phase-08 pattern) |
| DOM adapter implementations (contenteditable, selection, focus, geometry, scroll, dialogs) | Host editor binding | Host-specific implementation of shared interfaces; one implementation serves both hosts in this phase |
| Neutral-action Stimulus bindings (`media#`, `presentation-editor#`, `visual-editor#`, `mermaid-diagrams`, `document-pages` rebinding) | Host product surface | Host-specific: Stimulus exists only on web; desktop binds the same neutral contracts in its webview shell |
| Shell per-work routes + Rails actions rendering shell | Host routing surface | Host-specific (web): URL space exists only on web |
| Desktop openDeck/file-open mapping for work targets | Host routing surface | Host-specific (desktop): no URL routing by design |
| ERB deletions | Dead product surface | Shared benefit; deleted files are host-only artifacts |

Package admission: no new package (`features/` additions live in existing client; transforms live in existing work-model). Negative six-criteria case as in Phase 08.

## 4. Behavior to preserve
| Behavior | Proving test/scenario/fixture |
|---|---|
| Visual/document editing (ops, caret save/restore, alignment, positions, typing parity, CRLF offsets) | System presentations 534/613/639/825/862/1169/1216 + documents 885/976 + client presentation-editor suite |
| Overview (range-safe edits, slide ops undo as one edit, overflow) | System 1406 + overview controller unit tests |
| Snippets/math/media insert paths | Snippet palette, math shorthand, media controller tests + system coverage |
| Autosave/session/conflict/draft behavior (Phase-08 surface) | Phase-08 proof set re-run where touched (autosave unit, conflict e2e, quiet-save desktop spec) |
| Deep-link behavior (library tabs, settings, per-work open/edit/show) | Shell/client_shell controller tests + system navigation tests + desktop file-open/graph flows |
| Graph/lineage slot content | Client graph tests + shell slot tests (slots stay server-rendered under the DO-6 correction) |
| Typing never drops input; perf locked | Native benchmark `inputPreservedRuns == samples`; no budget/baseline/threshold file touched (diff gate) |

Intended behavior changes (only those named by the phase contract):
- P09-03: Stimulus-shaped attribute strings become neutral `data-editor-action`/`data-client-mount` contracts (host bindings updated in the same commits).
- P09-04/05: edit/new URLs + failure re-renders serve the new works shell mounting the client editor; show/present/print/history stay server-rendered web-only pages; the client recognizes every per-work URL (`parseWorkRoute` matrix) and desktop maps work targets to openDeck (no custom scheme).
- P09-02: structural ops compute through work-model transforms (byte-identical output pinned by unit tests before rewiring).

## 5. Work breakdown
Ordered steps; structural moves and behavior changes in separate commits:
1. DO-1 (move, no behavior): `slide_overview_controller.js` model+ops → `packages/client/src/features/overview/` with DOM adapter interface; Stimulus controller becomes the thin adapter; overview unit tests move/extend.
2. DO-2 (new, tested): `packages/work-model/src/document_transforms.js` slide/block/alignment/snippet-text/media-markdown transforms with unit tests pinning byte-identical output against current string surgery (fixture pairs).
3. DO-3 (behavior): both editors consume the transforms (client `editor.js` + `visual_editor_controller.js`); authoring suites green.
4. DO-4 (move, no behavior): document-kind visual editor → `packages/client/src/features/document/` with contenteditable/selection/focus adapter interface; Stimulus controller becomes the thin adapter.
5. DO-5 (behavior): neutral action contracts (`data-editor-action`/`data-client-mount`) across chrome/sanitize/LibraryCard + host bindings; sanitizer tests + system action tests green.
6. DO-6 (behavior): client per-work routes (`parseWorkRoute` for new/edit/show/present/print/history) + edit/new/failure actions render `works/shell` + amended ERB deletions (§2 inventory, §6 table); desktop unchanged (work targets already map through openDeck; `resolveWorkUrl` stays a web-only seam); navigation/deep-link suites green.
7. DO-7 (prove): P02 re-proof where touched + perf re-proof + full proof map (§8); freeze candidate.

## 6. Deletions and temporary compatibility
| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| Stimulus `visual_editor_controller.js` internals (moved to client) | Shared | Graduated to `client/features/document/` | Removed in DO-4; controller remains as the DOM adapter |
| Stimulus `slide_overview_controller.js` internals (moved to client) | Shared | Graduated to `client/features/overview/` | Removed in DO-1; controller remains as the DOM adapter |
| Stimulus-shaped `data-action`/`data-controller` emission in client | Shared | Replaced by neutral contracts (P09-03) | Rewired in DO-5; host bindings updated atomically |
| Product ERB authoring surfaces (5 files: `documents/edit,new`, `presentations/edit,new`, `presentations/_form` wrapper) | Host | Superseded by works/shell+client (P09-04) | Deleted in DO-6; edit/new/failure render works/shell (system navigation tests) |
| Server projection partials (8 files: `documents/_content`, `presentations/_slide,_slides`, `works/_form,_preview,_warnings`, `presentations/_document_graph,_lineage_graph`) | Host | Web-only read/publish implementation — retained pages render them (§9) | Kept; deletion condition is a future client read/publish port (out of phase) |
| `render :new`/`render :edit` failure paths in controllers | Host | Pages no longer exist | Rewired in DO-6 to works/shell with error payload (behavior: validation errors surface in shell, proven by system tests) |

## 7. Risks and rollback triggers
| Risk | Trigger | Response |
|---|---|---|
| ERB deletion breaks web flows (edit/new/show/present/print/history) | Any system navigation/authoring test fails in DO-6 | Roll back DO-6 per area (restore ERB + action render); shell routes stay until fixed |
| Neutral-action rename breaks host bindings (media/mermaid/pages/editors) | Sanitizer, action, or system tests fail in DO-5 | Roll back DO-5 renames per consumer; Stimulus-shaped strings stay until fixed |
| Transform parity drift (byte differences vs string surgery) | work-model unit or authoring suites fail in DO-2/DO-3 | Fix the transform (fixture pair pins both sides); ops keep legacy path until green |
| Caret/undo granularity regresses in moved editors | Visual/overview/caret system tests fail in DO-1/DO-4 | Roll back the move per area; Stimulus controller keeps logic until fixed |
| Desktop file-open/deep-link flows break | Desktop e2e file-open/graph flows fail | Roll back openDeck mapping; hash routes unchanged |
| /tmp pressure crashes browser suites (512M tmpfs) | Selenium tab-crash / ENOSPC | Clear `/tmp/elef-client-tests-*` + rerun; serialize browser groups (proven Phase-08 procedure) |

## 8. Proof map
| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P09-01 client owns visual editor + overview | `features/document/` + `features/overview/` exist with adapter interfaces; Stimulus controllers are thin adapters (reviewer: no op logic remains — grep gate on ported method names); renderer-free/DOM-free client core (ownership gate green) | affected + reviewer | — |
| P09-02 transforms behind text channel | `document_transforms.js` unit tests (byte-identical fixture pairs); zero string-surgery op paths in both editors (reviewer grep); no contract change (diff gate on `packages/contracts/`) | quick (unit) + affected | — |
| P09-03 no Stimulus in client | Zero `hotwired`/`extends Controller`/Stimulus-shaped emission in client (grep gates in host test); sanitizer allowlist neutral; host bindings updated (system action tests) | quick + affected | headless Chromium |
| P09-04 ERB gone except inventory | Finite checklist: exactly the §2 inventory pages + retained partials remain under `app/views` (22 files; reviewer: `find` + diff); edit/new render works/shell (navigation system tests) | affected + reviewer | headless Chromium |
| P09-05 deep links through shell/client | Criterion interpretation (reviewer judges): "resolves through the shell/client" means the shell routing authority recognizes every per-work URL (`parseWorkRoute` matrix: six views × two kinds) and reaches its designated surface — client-rendered shell views for authoring (new/edit), designated host surfaces for read/publish (web-only pages / openDeck). Uniform client rendering cannot be the reading: P09-04 itself contemplates remaining pages, and read/publish links have no desktop counterpart (ADR split). Proof: link matrix (system navigation + desktop file-open/graph e2e); no custom URL scheme (config diff gate) | affected + desktop e2e | headless Chromium + Tauri runner |
| P09-06 shared authoring on both hosts | Desktop e2e full suite (incl. quiet-save 13 + shared editing scenarios) + Rails authoring system set + client/work-model suites, all green at candidate | affected + e2e + benchmark | Tauri runner + Chromium |
| P02 re-proof (where touched) | Quiet-save e2e, local-store matrix (suspicious/kill/snapshot), close-flow, web baseline scenarios re-run green | affected (matrix) | Rust + Chromium |
| Perf locked | No budget/baseline/threshold file touched (diff gate); typing exact-equality (`inputPreservedRuns == samples`) via native benchmark; stage p95s within noise | affected + native benchmark | Tauri runner |

Fixed fixture sets: transform byte-identical fixture pairs (new, frozen at DO-2); frozen 14-scenario web baseline; frozen perf budgets triple; graph/lineage slots stay server-rendered (shell slot tests; no JSON-ification under the DO-6 correction).

Human gates touched (constitution §8): none — no signing/updater/owner-acceptance/deploy/soak step is triggered by this phase.

## 9. Re-plan log
<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->
- 2026-10-09: frozen (initial).
- 2026-10-09 (DO-5): `data-presentation-editor-target` / `data-presentation-editor-align` / `data-visual-editor-block-id` stay host-neutral query hooks (client-consumed, no Stimulus controller behind them); only `data-action` Stimulus strings and `data-controller` mounts go neutral in DO-5. Server ERB keeps legacy action strings until DO-6 deletion; sanitizer carries a dual allowlist transitionally.
- 2026-10-09 (DO-6): ERB deletion scope corrected against evidence. The frozen §2 list wrongly slated shared projection components for deletion, but the web-only read/publish pages kept by the same inventory render them (`documents/show`, `documents/print` → `documents/content`; `presentations/show`, `present`, `print` → `presentations/slides` → `_slide`; library shell slots → `_document_graph`, `_lineage_graph`; `show` → `works/_warnings`; preview transport + editor bootstrap → `works/_preview`, `works/_form`). Deleting those would break the retained web-only surfaces, and fully client-rendered read/publish pages are a separate phase-scale effort. Amended deletions: `documents/edit,new`, `presentations/edit,new`, `presentations/_form` (wrapper). Edit/new/failure paths now render the new `works/shell` (one shell for all four authoring entries + failure re-renders). `works/_form` stays as the shell editor slot (host form machinery, not a product view). The preview endpoint stays server-rendered transport; the sanitizer dual allowlist therefore persists past DO-6. Desktop needs no code change: work targets already map through openDeck (navigate workId, onOpenDeck, presentWork); no client flow emits server work URLs on desktop (no resolveWorkUrl), so there is no work-URL branch to map.
- 2026-10-09 (re-freeze): adopted the DO-6 correction through a DO→PLAN→DO excursion (prior session left the DO-5/DO-6 log appends unfrozen plus DO-6 production uncommitted; render chains and the desktop claim re-verified from the tree before adoption). §2 (deletion bullet, inventory +`works/shell`, retained-partials rule, rationale), §4 (P09-04/05 behavior + graph/lineage row), §5 step 6, §6 (ERB row narrowed to 5 files, retained-partials row, works/shell failure paths), §8 (P09-04 checklist, P09-05 criterion interpretation, fixture sets) rewritten to match. New hash below.
