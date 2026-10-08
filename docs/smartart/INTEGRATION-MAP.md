# Elef Art v1 Integration Map

Phase 0 audit and current implementation map for [Constitution v6.0](CONSTITUTION.md).

## Baseline and repository audit

- Branch: `feat/list-smartart-v1`, based on `dev` at `26d6ad247e5b55dfa63589d16af9a8f250f2c51c` before Art implementation.
- Agent instructions and doctrine reviewed: repository `AGENTS.md`, `ELEF-DOCTRINE.md`, `docs/architecture.md`, and `docs/development.md`.
- Initial search across `app/`, `desktop/`, `test/`, `script/`, and docs found no existing Art renderer, `data-elef-art` state, `art{flow}` syntax, snake layout, or SmartArt feature. `.new-work-chevron` is unrelated.
- Baseline JavaScript suite: 334 passed.
- Baseline Rails suite using isolated SQLite compatibility mode: 343 tests, 2,725 assertions, no failures/errors/skips. The configured PostgreSQL test endpoint was unavailable at `127.0.0.1:5432`.
- Baseline desktop frontend: 26 tests passed; desktop E2E unit tier: 7 passed; Rust core: 40 passed; frontend ownership check passed.

## Current integration points

| Concern | Current implementation | Art integration |
|---|---|---|
| Source grammar and binding | `app/javascript/lib/art_source.js#resolveArtBindings` | A shared line/context resolver recognizes exact root Art directives, barriers, modifiers, diagnostics, and source ranges. `analyzeArtList` derives meaning from markdown-it tokens. |
| Editor source map | `app/javascript/lib/document_map.js#buildEditorStructure`, `editorBlocks`, `markdownBlocks`; `#elef/art-source` | Both visual editing and preview projections consume the resolver's binding result. Rails importmap loads the generated `vendor/javascript/art_source.bundle.js`; Node and Tauri resolve the same `app/javascript/lib/art_source.js` source directly. |
| Canonical Markdown parser and semantic renderer | `app/javascript/lib/renderer.js#renderArtBlock`, `renderMarkdownBlock`, `renderPreview` | One Rails-owned renderer preserves native root/nested lists, derives root mode/density, detects unsupported content, and emits the DOM state enums. |
| Rails editor preview | `app/helpers/application_helper.rb#shared_editor_projection` → `app/lib/source/javascript_renderer.rb#editor_preview` → `vendor/javascript/elef-renderer.bundle.js` | Calls the shared renderer and editor map. The vendor bundle is generated from Rails-owned sources. |
| Saved document model/rendering | `app/lib/source/document.rb#parse_blocks`, `markdown_blocks`, `parsed_block`; `app/lib/source/block_renderer.rb#render` | Ruby model obtains binding metadata from `Source::JavascriptRenderer`; saved, editable, and print paths use shared Art rendering. |
| Saved presentation and print | `app/helpers/presentations_helper.rb#render_markdown`; `app/views/presentations/_slide.html.erb`; `app/lib/source/renderer.rb` | Shared Art rendering supplies complete fallback/status markup. Presentation content host is marked fixed and positioned. |
| Desktop consumer | `app/javascript/lib/renderer_global.js`; `script/build_renderer.mjs`; `desktop/frontend/build.mjs` | Tauri bundles Rails-owned JS and the pinned `markdown-it@14.3.2`; no desktop-specific Art renderer or CSS copy. |
| Document pagination | `app/javascript/controllers/document_pages_controller.js#splitBlock`, `splitArtBlock`, `artFragments`, `childFragment`, `mergeFlowFragment` | Art is an atomic pagination unit split only between direct root items. Remainder numbering uses explicit `start`, including zero. Oversized single items remain intact and emit `ART_ITEM_TOO_TALL`. |
| Fixed presentation lifecycle | `app/javascript/controllers/art_layout_controller.js`; `app/javascript/lib/art_layout.js` | One presentation-level controller batches decisions and reads, uses CSS custom properties for the width decision, applies the containment oracle, and performs at most one horizontal-to-vertical fallback pass. |
| Shared CSS tokens/layout | `app/assets/stylesheets/tokens.css`; `app/assets/stylesheets/components/art.css` | One token source drives Peer basis, Sequence eligibility, spacing, radius, padding, and typography. CSS supplies Peer wrapping, native Sequence markers, and logical/decorative connectors. |
| Block ownership | `app/javascript/lib/editor_block_ranges.js#blockOperationStart`; `visual_editor_controller.js#blockSourceRange`; `presentation_editor_controller.js#deleteBlock`, `moveBlock` | Existing source-range operations include the Art directive with its root list. Visual move/delete integration is covered by a browser system test. |
| `:` authoring | `app/lib/authoring_registry.rb`; `app/lib/snippets/catalog.rb`; `app/javascript/data/default_authoring_registry.json` | `:art` inserts only `:::art`; its argument schema is empty. |
| Diagnostics | `app/javascript/lib/document_map.js#artDiagnosticMessage`; `app/javascript/controllers/preview_controller.js`; `art_layout_controller.js#setDiagnostic`; `document_pages_controller.js#markArtItemTooTall` | Stable codes are exposed in rendered DOM and hydrated into the existing editor warning list. |
| Tests and parity harness | `test/javascript/art_source.test.js`, `art_generated.test.js`, `art_layout.test.js`, `renderer.test.js`; `test/system/art_test.rb`, `test/system/presentations_test.rb`; `test/e2e/scenarios/art-rendering.js`; `desktop/e2e/` | Binding corpus, 400 seeded cases, layout/renderer checks, pagination and lifecycle browser checks, block operations, and shared web/Tauri Art semantic scenarios are identified. |
| Traceability | `docs/smartart/VERIFICATION.json`; `script/check_art_traceability.py` | Every numbered constitution requirement maps to a test or named static assertion; CI rejects duplicate/missing IDs and stale verification references. |

## Baseline failures and external environment

- The configured PostgreSQL endpoint at `127.0.0.1:5432` was unavailable at baseline. A disposable PostgreSQL instance and `elef_test` database were later started on `127.0.0.1:55432` and used for Rails validation.
- The existing port-3000 listener was left untouched. The E2E harness now accepts `ELEF_E2E_WEB_PORT`; its Rails test server ran on 43127 and embedded Tauri WebDriver on 4457. Linux Tauri/WebKit parity completed against the real desktop binary.

## Implementation commits

- `b8ed9cb` Add shared Elef Art source and rendering
- `6c77635` Integrate Elef Art with saved content and authoring
- `c213a12` Harden Art fit and pagination diagnostics
- `f2e5dad` Keep Art ownership scoped to its root list
- `55d6184` Add Elef Art geometry and parity coverage
- `564102f` Verify bounded Art fallback lifecycle
- `a582131` Preserve attached media in Art fallbacks
- `f4ccf49` Assert Art fit diagnostics and safe fallbacks
- `0ed62ea` Document Art verification and architecture map
- `494f5b5` Keep Art checks within shared frontend ownership
- `f8afbf5` Tighten Art binding and fixture coverage
- `aafc6a9` Update Art integration audit trail
- `8f65eaa` Allow E2E services on alternate ports
- `7a1bffb` Bundle shared Art parser for Rails
- `e86bb61` Verify Art semantics across web and desktop
- `e9dc9be` Read Art item text across tight lists

FIX-06 and FIX-07 now pass the mandatory whole-host containment oracle at the measured 535×416 and 341×416 CSS-pixel regions. In inferred-column Art hosts, `.slide-region-block` retains the block's position classes and editor controls are overlays, so editor chrome does not consume authored slide height or create false no-fit warnings. Authored headings, Art roots, and all slide-region siblings remain part of the host measurement.

FIX-04, FIX-06, and FIX-07 required tuning the single-source Art tokens. Current values include `--art-gap: 16px`, compact/rich fixed vertical Sequence gaps of 20px/4px, `--art-card-padding: 2px`, and presentation lead/body sizes of 22px/15px. The same values keep the eight-item compact Sequence in explicit no-fit. The CSS token source is `app/assets/stylesheets/tokens.css`; fixed-layout eligibility still reads the computed `--art-gap` and `--art-sequence-min-inline` values.

The existing stylesheet-index architecture test intentionally changes its expected import count from 12 to 13 and asserts the new `components/art.css` import. This is the only baseline assertion changed to account for the new shared component partial.

## Final verification snapshot

- `npm run test:javascript`: 392 passed.
- `RAILS_ENV=test PARALLEL_WORKERS=1 PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGTESTDATABASE=elef_test bin/rails test`: 351 tests, 2,796 assertions, no failures/errors/skips, against isolated PostgreSQL 18.6.
- `RAILS_ENV=test PARALLEL_WORKERS=1 PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGTESTDATABASE=elef_test bin/rails test test/system/art_test.rb`: 12 tests, 160 assertions passed, covering canonical fixtures, pagination, 100-root lifecycle bounds, print, reflow, and Art position modifiers.
- `npm test --prefix desktop/frontend`: 26 passed; `npm run test:unit --prefix desktop/e2e`: 10 passed.
- Full Linux E2E: 18 Playwright web scenarios and 35 real Tauri/WebKitGTK 605.1.15 scenarios passed, including shared Art semantics in both products. The harness used Rails port 43127, Tauri WebDriver port 4457, PostgreSQL port 55432, Xvfb, and Openbox; it left the existing port-3000 service untouched.
- `npm run renderer:build`, `bin/rails tailwindcss:build`, `npm run build --prefix desktop/frontend`, and the test-only Tauri build completed successfully.
- Art static assertions (12), traceability (97 unique normative IDs), frontend ownership, Tauri architecture, and `git diff --check` passed.
- FIX-01 through FIX-10 and PAG-FIX-01 through PAG-FIX-04 are verified in the browser/system tier. FIX-06/FIX-07 pass at 535×416 and 341×416 CSS-pixel hosts with whole-host containment; FIX-05 still reports explicit no-fit.
- Rust core tests (40), formatting, and Clippy passed during initial implementation validation; no Rust files changed in the later integration fixes.
