# Phase 3 plan — Work model and renderer

Status: FROZEN at 2026-10-08 (hash recorded in `docs/refactor/status.json`)
Phase contract: `docs/refactor/phases/03-work-model-renderer.md` (sha256 `32f4bc7c3942c7e39d78ca700ccf55ae0a8c9bc196618c455607bb84e7d9be90`)
Phase base: `2931ae48b52a3553ac82845fa20f2308310e5312`

## 1. Verified facts
| Fact | Evidence (file:line or command → result) |
|---|---|
| JS renderer core is 458-line `renderer.js`: markdown-it + hljs + katex, exports `collectMediaReferences`, `renderMarkdownBlock`, `renderPreview` | `app/javascript/lib/renderer.js:1,157,168,180` |
| Renderer registers Elef syntax rules: `elef_display_math`, `elef_bracket_math`, `elef_math`, `elef_wiki_link` | `app/javascript/lib/renderer.js:34,54,78,98` |
| Renderer output embeds editor chrome: `contenteditable` + `data-action` shells, `data-controller` reader chrome, presentation toolbars/buttons/selects | `app/javascript/lib/renderer.js:236,248,268,319,335,337,344,346,354,360,366` |
| `renderPreview` is a pure function of its input object → `{html, warnings, editor_map, style}` | `app/javascript/lib/renderer.js:180-224` |
| Work structure in JS: `buildEditorMap`/`buildEditorStructure` (776-line `document_map.js`) with front matter, style, margins, blocks, ranges, warnings | `app/javascript/lib/document_map.js:4,8,74,88,109,497-502` |
| Link semantics in JS: `parseDocumentLinkAt`, `extractDocumentLinkTokens`, `createDocumentLinkResolver`, `buildDocumentGraph`, portable front-matter links | `app/javascript/lib/document_links.js:1,19,63,91,126,156` (244 lines) |
| Only 4 JS import sites for doc semantics: appearance_controller, file_library_application, renderer.js, renderer_global.js | `grep import` → `appearance_controller.js:2`, `file_library_application.js:8`, `renderer.js:4-5`, `renderer_global.js:2` |
| Bundle entry re-exports renderer + editor-map + appearance + library_card + graph fns as `globalThis.ElefRenderer` | `app/javascript/lib/renderer_global.js:1-24` |
| Bundle producer: esbuild `renderer_global.js` → `vendor/javascript/elef-renderer.bundle.js` (iife, es2022, minify) | `script/build_renderer.mjs:7-17` |
| Rails server JS engine is MiniRacer 0.22.1 through `Source::JavascriptRenderer` (4s timeout, 256MB, thread-local) | `Gemfile:55`, `app/lib/source/javascript_renderer.rb:3,6,7,117,131` |
| `Source::Renderer.render` defaults to the JS bundle; Ruby Redcarpet path only when `ELEF_RENDERER=ruby` | `app/lib/source/renderer.rb:92` |
| `ELEF_RENDERER` is set nowhere except `script/benchmark_shared_renderer.rb` (comparison) | scoped `muse.search` over test/.github/docs/script/bin → only benchmark script |
| redcarpet/rouge/katex gems used only by the Ruby renderer path | `grep Katex/Redcarpet/Rouge app/ lib/ config/` → only `app/lib/source/renderer.rb`; Gemfile:52-54 |
| Canonical Ruby parser is 711-line `Source::Document` (~25 module fns: parse, slides, blocks, margins, front matter, h1, links metadata, rewrites) | `app/lib/source/document.rb:18-707` |
| Ruby Slide/Block/Position are pure `Data.define` view models | `app/lib/source/document.rb:7-11` |
| Ruby `editor_map` already delegates to JS `buildEditorMap` via MiniRacer | `app/lib/source/document.rb:302-304`, `javascript_renderer.rb:51` |
| Ruby link Parser/Graph already delegate tokenizing to the JS bundle | `app/lib/document_links/parser.rb:6`, `app/lib/document_links/graph.rb:7` |
| Ruby `BlockRenderer.render` (192 lines) is server projection incl. editable shells/position controls | `app/lib/source/block_renderer.rb:5` |
| `preview_html`/`slides`/`blocks`/`preview_warnings`/`theme=` flow through `Source::Document`/`BlockRenderer` | `app/models/work.rb:76,94,102,111-130,134,138` |
| Views consume Ruby slide/block structs (`_slide.html.erb`) and BlockRenderer HTML (`_content.html.erb`) | `app/views/presentations/_slide.html.erb:29-51`, `app/views/documents/_content.html.erb:6,17` |
| pptx export consumes `slide.blocks[].position` + `Source::Renderer.render` per block | `app/services/presentations/pptx_export.rb:71-73,80-88` |
| Rust has zero Work-syntax parsing (only timestamp/UUID/asset-path parsing; source is opaque) | `crates/local-store/src/lib.rs:82,942,2254,2845`, `desktop/src-tauri/src/lib.rs:939` |
| Sanitizer is DOM-based (`installSanitizedPreview`), hostile cases inline in its test | `app/javascript/lib/preview_sanitizer.js:22`, `test/javascript/shared/preview_sanitizer.test.js:13-175` |
| Fixture corpus: 14 named cases in `renderer-inputs.json`, exact-byte outputs, maintenance-only regen script | `test/javascript/fixtures/renderer-inputs.json` (14 names), `script/update_renderer_fixtures.mjs:1` |
| Fixture test vm-loads the bundle and asserts block+preview+editorMap outputs | `test/javascript/renderer_fixtures.test.js:14-21` |
| Chromium runner exists: Playwright project `web` over `desktop/e2e/specs/web.spec.js` + own Rails test server | `desktop/e2e/playwright.config.js:1-29`, `desktop/e2e/package.json:8` |
| Tauri webview has ElefRenderer only inside the worker, via the copied bundle | `desktop/frontend/src/renderer-worker.js:1-4`, `desktop/frontend/build.mjs:106` |
| `packages/contracts` is the package template: private ESM, tsc build/typecheck, dist gitignored+built, npm workspaces | `packages/contracts/package.json`, `package.json:5`, `bin/check:658-674` |
| `incremental_list.js` has no renderer import (name-only search hit) — out of scope | `grep import app/javascript/lib/incremental_list.js` → empty |
| No `spec/` dir yet; corpus stays in `test/javascript/fixtures/` this phase | `ls spec` → missing; later phases own `spec/` |

Open questions / unknowns (each is a blocker or has a resolution step): none. The two judgment calls (chrome-adapter injection §5, Ruby-structs-stay-as-data §5) are decided below with proof in §8.

## 2. Scope
In scope:
- `packages/work-model`: pure Work semantics — parse/structure (both kinds), front matter, directives, margins, blocks, structural ranges, links, appearance/normalize, pure source transforms. Moved from `document_map.js` + `document_links.js` + pure string scanners (`findMathClose`, `isEscaped`, `stripUnsafeMarkdownLinks`) + theme/typography normalization (parity with Ruby `normalize_theme_value`/`normalize_typography_value`). No DOM/React/Rails/Tauri/filesystem/network; runs under `node --test`.
- `packages/renderer`: pure deterministic projection — markdown-it instance + Elef rules, image/math render rules, `renderMarkdownBlock`, `collectMediaReferences`, projection core of `renderPreview` with an injected chrome adapter (option, default none). Zero `data-action`/`data-controller`/`contenteditable`/`<button>`/`<select>` in package sources.
- Chrome composers: verbatim-extracted chrome functions stay in `app/javascript/lib/preview_chrome.js` (later `client/ui` owns them); the bundle composes core + chrome to byte-identical output.
- Bundle entry keeps living app-side (`renderer_global.js`), importing the two packages + chrome; MiniRacer path, worker path, importmap pin unchanged.
- Ruby: new `JavascriptRenderer` work-model methods; `Source::Document` internals delegate to JS (signatures + `Data` structs kept for views); `DocumentLinks` kept (already delegating); `BlockRenderer.render` delegates projection to the bundle; source-anchor line lists move to work-model.
- Ruby deletions: `HtmlRenderer` + `ELEF_RENDERER=ruby` branch + redcarpet/rouge/katex gems + ruby comparison in `benchmark_shared_renderer.rb`.
- Corpus: audit + extend fixtures to P03-06 (document-kind, front-matter/directive variants, malformed shapes); same corpus proven in Node 22, Chromium (Playwright + bundle `addScriptTag`), Tauri webview (worker-path e2e hook spec), MiniRacer (Rails test).
- Tooling: ownership/boundary checker package rules, `bin/check phase 3` gate mirroring phase 2.
Non-goals (explicitly deferred to later phases):
- `client/` package or moving chrome/sanitizer/session out of `app/javascript` (Phases 04–09 own the migration; `preview_chrome.js` + sanitizer placement is documented as pre-migration).
- `spec/` directory (no phase before 10 owns it; corpus stays in `test/javascript/fixtures/`).
- Any user-visible behavior change; web views/models/services keep their Ruby signatures.
- Sync/collaboration/accounts, mobile, packaged-updater flow changes.

## 3. Ownership classification
| Change | Semantic owner (constitution §4) | Shared or host-specific (+ concrete reason) |
|---|---|---|
| `packages/work-model` (parse/structure/links/transforms) | `work-model` | Shared: pure semantics, zero environment imports; both hosts + MiniRacer consume it |
| `packages/renderer` (projection core) | `renderer` | Shared: deterministic projection; web MiniRacer + desktop worker + Chromium consume it |
| Chrome composers (`preview_chrome.js`) | future `client/ui`; current home `app/javascript/lib` | Shared pre-migration code: emits the interactive shells both hosts render; moves to `client/ui` in Phases 04–09 |
| Bundle entry + build script update | `apps/web` (Rails-owned asset pipeline) | Shared artifact: same bytes consumed by MiniRacer, importmap, desktop worker |
| `JavascriptRenderer` work-model methods | `apps/web` adapter | Host-specific: MiniRacer bridge is the Rails host's runtime adapter |
| `Source::Document` delegation (signatures kept) | `apps/web` | Host-specific: Rails model layer over the shared JS kernel |
| Ruby renderer deletion + Gemfile cleanup | `apps/web` | Host-specific: removes the host's duplicate interpretation per P03-07 |
| Sanitizer kept in app | future `client/ui` | Shared pre-migration: DOM-bound, cannot live in renderer (§4 forbids DOM) |
| 4-runtime fixture proof (incl. worker-hook spec) | `tests/` + desktop e2e | Runners are host-specific; the corpus is shared |
| `bin/check phase 3` + CI evidence | `tooling` | Campaign machinery, mirrors phase 2 |

Package admission (both packages are constitution §4 frozen boundaries; law applied in writing):
- `work-model`: (1) one responsibility — Work semantics; (2) small stable API — `parseWork/toStructure/frontMatter/links/blocks/appearance/transforms` over strings; (3) acyclic — depends on nothing executable, enforced by boundary checker; (4) independent tests — moved link tests + new structure/range/transform unit tests under Node; (5) payoff — deletes the 711-line duplicate Ruby parser, ends parser drift; (6) hides far more (fences/directives/margins/ranges/offsets) than it exposes. Driver: multiple runtimes (Node, Chromium, WebKit worker, MiniRacer V8) + domain-kernel isolation.
- `renderer`: (1) one responsibility — deterministic projection; (2) small stable API — `renderMarkdownBlock/renderPreviewCore/collectMediaReferences` + chrome-adapter seam; (3) acyclic — depends only on `work-model` + contract types; (4) independent tests — corpus projection cases under Node; (5) payoff — one projection for MiniRacer/worker/browser instead of three call paths around a mixed module; (6) hides markdown-it/katex/hljs wiring. Driver: multiple runtimes (same four).
- Size/symmetry alone did not drive this; the duplicated-interpretation deletion (P03-07) and the four-runtime proof (P03-05) did.

## 4. Behavior to preserve
| Behavior | Proving test/scenario/fixture |
|---|---|
| Renderer bundle bytes for all 14 existing cases | `test/javascript/renderer_fixtures.test.js` unmodified (regen script must be a no-op: `git diff` empty after run) |
| `renderPreview`/`renderMarkdownBlock` outputs incl. chrome | Same fixtures (composed bundle output, chrome included) |
| Web work/document/presentation/model/system behavior | `test/models/work_test.rb`, `document_links_test.rb`, `presentation_test.rb` + `test/system/*` unmodified |
| pptx/docx/pdf export bytes | Existing export tests unmodified (`pptx_export` consumes same struct shapes) |
| Desktop previews/worker output | Desktop e2e specs + CI `desktop`/`desktop-macos` jobs |
| Contract conformance (fake/rails/tauri) | Existing suite green (no port changes) |
| Phase 02 save/session/watcher behavior | `test/javascript/shared/{save_flow,work_session,desktop_host}.test.js` + quiet-save e2e unmodified |

Intended behavior changes (only those named by the phase contract):
- P03-07 mandates the end of independent Ruby interpretation: `ELEF_RENDERER=ruby` stops working (flag + Redcarpet path deleted). The JS path was already the default for every caller.

## 5. Work breakdown
Ordered steps; structural moves and behavior changes in separate commits.
1. Scaffold `packages/work-model` (package.json `@elef/work-model`, ESM JS, exports map, node --test script): move `document_map.js` + `document_links.js` verbatim; move `document_links.test.js`; add unit tests for structure/ranges/front-matter/margins/appearance/transforms. Pure move + new tests. Commit.
2. Scaffold `packages/renderer` (same shape): move markdown-it core + Elef rules + image/math rules + `renderMarkdownBlock` + `collectMediaReferences` + pure scanners; `renderPreviewCore` without chrome; corpus projection tests. Commit.
3. Chrome seam: `renderPreviewCore(input, { chrome })` where `chrome` supplies shell/toolbar/control/media-caption emitters (default: none); extract verbatim chrome emitters to `app/javascript/lib/preview_chrome.js`; bundle entry recomposes. Fixtures byte-identical (regen no-op). Commit.
4. Importer rewire (4 sites): appearance_controller, file_library_application, bundle entry, worker client path; root `#elef/*` + desktop `build.mjs` alias wiring for `@elef/*`; delete moved lib files. Tests green. Commit.
5. Ruby delegation: `JavascriptRenderer` work-model methods (`parse_work`, structure/front-matter/link/margin ops as needed by `Source::Document` signatures); `Source::Document` internals delegate (signatures + `Data` structs unchanged); `BlockRenderer.render` delegates projection to the bundle; anchor line lists via work-model. All Rails tests unmodified + green. Commit.
6. Ruby deletion: `HtmlRenderer` + `ELEF_RENDERER` branches + gems from Gemfile (+lockfile) + benchmark script ruby comparison; docs-sync the architecture table row. Tests green. Commit.
7. Corpus + 4 runtimes: audit P03-06 coverage, add document-kind/front-matter/malformed cases (exact-byte outputs via maintenance script); Node assertions in package tests; Playwright Chromium spec via bundle `addScriptTag`; Tauri worker-hook e2e spec; MiniRacer Rails test. Commit.
8. Tooling + gate: boundary/ownership rules for the two packages (import + dependency-direction checks); `bin/check phase 3` mirroring phase 2; CI evidence; gate + review to PASS.

Design decisions locked here: (a) chrome-adapter injection (not string post-processing or template duplication) — single code path, grep-provable purity, byte-identical composition; (b) Ruby structs stay as data, parsing delegates — views/models/services keep signatures; (c) JavaScript (not TS) for the two runtime packages — matches moved sources byte-for-byte and keeps the MiniRacer/esbuild/importmap chain identical; (d) sanitizer stays in app (DOM forbids renderer membership; later `client/ui` owns it); (e) corpus stays in `test/javascript/fixtures` (no `spec/` owner yet).

## 6. Deletions and temporary compatibility
| Item | Owner | Reason | Deletion condition |
|---|---|---|---|
| Ruby `HtmlRenderer` + `ELEF_RENDERER=ruby` branch | apps/web | P03-07: ends duplicate interpretation (step 6) | This phase; JS path already default everywhere |
| redcarpet/rouge/katex gems | apps/web | Unused after deletion (verified zero other users) | Same commit as above |
| `Source::Document` parsing internals | apps/web | Replaced by JS delegation (signatures kept) | Step 5 green (Rails tests unmodified) |
| `document_map.js`/`document_links.js` in lib | work-model | Moved to package (step 1) | Importers rewired (step 4) |
| Renderer chrome in `renderer.js` | renderer/app | Moved to `preview_chrome.js` via adapter (step 3) | Fixtures byte-identical |
| Ruby comparison in `benchmark_shared_renderer.rb` | apps/web | Comparand deleted | Step 6 |

Temporary compatibility paths: none. No shims; delegation keeps signatures, composition keeps bytes.

## 7. Risks and rollback triggers
| Risk | Trigger | Response |
|---|---|---|
| Ruby/JS parser drift surfaces (behavior change) | Any Rails test fails or fixture byte differs | Stop; fix JS to match proven behavior (JS is the mover, tests are the contract); if irreconcilable, roll back to `2931ae4` and re-plan |
| MiniRacer shape mismatch (positions/regions/blocks) | pptx/export/view test fails | Fix the JS→Ruby mapping (structs unchanged); never change view contracts silently |
| Bundle bytes drift | Regen script produces any diff | Treat as bug, not an update; fix composition |
| Performance regression (MiniRacer parse per request) | Rails perf-sensitive test or review flags >10% | Measure first; memoize at call sites already memoizing (`@parsed_document`) |
| Scope creep into client/editor | Any edit outside packages/bundle/Ruby-lib/test/tooling | Stop; client moves belong to Phases 04–09 |
| Conformance divergence | Any adapter suite result changes | Stop; no port changes allowed this phase |

Rollback reference: `phase_base_sha` `2931ae48b52a3553ac82845fa20f2308310e5312`.

## 8. Proof map
| Criterion / invariant | Proof (command, test, CI job, reviewer checklist) | Tier | Environment needs |
|---|---|---|---|
| P03-01 | work-model tests (parse/structure/front-matter/directives/ranges/links/transforms, both kinds) + corpus | quick + affected | Local node |
| P03-02 | `node --test` green + reviewer grep: no `document\|window\|React\|Tauri\|fs\|fetch\|MiniRacer` in `packages/work-model/src` | quick + review | Local |
| P03-03 | Reviewer grep: no `data-action\|data-controller\|contenteditable\|<button\|<select\|Stimulus\|save\|fetch\|localStorage` in `packages/renderer/src`; chrome lives only in `preview_chrome.js` + views | review + phase | Local |
| P03-04 | Sanitizer tests unmodified + hostile corpus case in all 4 runtimes + determinism (identical bytes across runtimes) | affected + CI | Local + CI |
| P03-05 | Same corpus asserts: node (`packages/renderer` test), Chromium (Playwright `addScriptTag` spec), Tauri webview (worker-hook e2e spec), MiniRacer (Rails test) | phase + CI | Local node/MiniRacer; CI for Chromium/Tauri... (see note) |
| P03-06 | Corpus audit table in review (each required family → named case) | review | — |
| P03-07 | Reviewer grep: no Redcarpet/markdown-parse/fence-scan in `app/lib`, `crates`; `ELEF_RENDERER` gone; Ruby delegates via `JavascriptRenderer` | review | Local |
| P03-08 | Reviewer records one-sentence justification per production package (in report) | review | — |
| I01/I16/I17 | Boundary checker enforces direction; no allowlist growth | quick + review | Local |
| I06/I09 | Fixtures byte-identical; factual docs-sync for the architecture row | phase + review | Local |
| I13/I14 | Deletion table executed; no compat paths; no test weakening (regen no-op proof) | phase + review | Local + CI |
| I15 | `all`/`docs`/`perf` still fail nonzero in gate | phase gate | Local |

Fixed fixture sets / finite reviewer checklists required by the contract:
- Corpus families → cases audit (P03-06): documents, presentations, directives, math, media, links, malformed source, line endings, source ranges — reviewer maps each to ≥1 named fixture case.
- Renderer purity grep (P03-03): `grep -rEn 'data-action|data-controller|contenteditable|<button|<select|Stimulus|presentation-editor|visual-editor|media#' packages/renderer/src` → zero hits.
- Ruby/Rust reinterpretation grep (P03-07): `grep -rEn 'Redcarpet|Rouge|ELEF_RENDERER|parse_margin|parse_blocks|slide_source_ranges|protect_math' app/lib crates desktop/src-tauri` → zero hits (signatures replaced by delegation; structs kept).
- work-model environment grep (P03-02): `grep -rEn 'document\.|window\.|from "react"|__TAURI__|node:|process\.env|MiniRacer' packages/work-model/src` → zero hits.
- Package justifications (P03-08): reviewer writes one sentence each in the report.

Human gates touched (constitution §8): none.

Note on P03-05 environments: Chromium Playwright specs need the Rails test server (CI `desktop` job has it; local runs need `ELEF_E2E_START_WEB_SERVER=1`, allowed — own test server/DB, never the owner's). Tauri webview proof runs in the desktop e2e suite (local + CI). If local Chromium/Tauri prerequisites are missing, CI supplies that evidence per the campaign's exact-candidate rule.

## 9. Re-plan log
<!-- Append dated entries: defect found, what changed, new hash. Never rewrite earlier sections silently. -->
- 2026-10-08: P03-07 proof-grep defect. The frozen grep demands zero hits for
  `slide_source_ranges` in `app/lib`, but `test/models/presentation_test.rb:53`
  (frozen unmodified by §4) calls `Source::Document.slide_source_ranges`, so the
  delegating wrapper must keep that literal name. Amended proof: the
  `Redcarpet|Rouge|ELEF_RENDERER|parse_margin|parse_blocks|protect_math` grep
  reads zero in `app/lib crates desktop/src-tauri`, and
  `slide_source_ranges|fence_marker|toggle_fence|display_math_fence|
  markdown_blocks|split_sections` reads zero EXCEPT the delegating wrapper
  (`def slide_source_ranges` + editor_map call + UTF-16 conversion, 12 lines),
  which the reviewer verifies by reading. No behavior or scope change.
